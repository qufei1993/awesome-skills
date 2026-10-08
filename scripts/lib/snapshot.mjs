import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateCollection, indexItem } from './site-contract.mjs';

const SHA=/^[a-f0-9]{40}$/i, HASH=/^[a-f0-9]{64}$/;
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const LIMITS={maxFiles:10000,maxFileBytes:10*1024*1024,maxTotalBytes:100*1024*1024};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function safePath(name) {
  if (typeof name!=='string' || !name || /[\u0000-\u0020\u007f\\%?#:]/.test(name) || path.posix.isAbsolute(name) || name.split('/').some(p=>!p || p==='.' || p==='..')) throw new Error(`Unsafe snapshot path: ${name}`);
  return name;
}
function object(value) { return value && typeof value==='object' && !Array.isArray(value); }
function exactKeys(value,keys,label) {
  if (!object(value) || Object.keys(value).some(k=>!keys.includes(k)) || keys.some(k=>!(k in value))) throw new Error(`Invalid ${label} fields`);
}
function parseJSON(bytes,label) {
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new Error(`Invalid JSON in ${label}`); }
}
async function verifyFiles(files,{allowPreview=false,expectedRevision,limits=LIMITS}={}) {
  const manifest=parseJSON(files.get('manifest.json'),'manifest.json');
  exactKeys(manifest,['schemaVersion','preview','sourceRevision','files'],'manifest');
  if (manifest.schemaVersion!==1 || typeof manifest.preview!=='boolean' || !SHA.test(manifest.sourceRevision ?? '')) throw new Error('Invalid manifest schema or source revision');
  if (manifest.preview && !allowPreview) throw new Error('Preview snapshots cannot be used for production');
  if (expectedRevision && manifest.sourceRevision.toLowerCase()!==expectedRevision.toLowerCase()) throw new Error('Snapshot source revision does not match requested revision');
  if (!Array.isArray(manifest.files) || manifest.files.length>limits.maxFiles) throw new Error('Invalid manifest file count or size limit');
  const listed=new Set(), allowed=new RegExp(`^(?:index\\.json|${UUID}\\.json|assets/${UUID}/[a-zA-Z0-9._-]+\\.(?:png|jpe?g|webp|gif))$`,'i');
  let total=0;
  for (const file of manifest.files) {
    exactKeys(file,['path','sha256','size'],'manifest file');safePath(file.path);
    if (!allowed.test(file.path)) throw new Error(`Unsupported snapshot file path: ${file.path}`);
    if (listed.has(file.path)) throw new Error(`Duplicate manifest entry: ${file.path}`);
    listed.add(file.path);
    if (!HASH.test(file.sha256 ?? '') || !Number.isSafeInteger(file.size) || file.size<0 || file.size>limits.maxFileBytes || (total+=file.size)>limits.maxTotalBytes) throw new Error('Invalid file checksum or size limit');
    const bytes=files.get(file.path);
    if (!bytes) throw new Error(`Missing manifest file: ${file.path}`);
    if (bytes.length!==file.size || digest(bytes)!==file.sha256) throw new Error(`Snapshot checksum or size mismatch: ${file.path}`);
  }
  if (!listed.has('index.json') || files.size!==listed.size+1 || [...files.keys()].some(k=>k!=='manifest.json' && !listed.has(k))) throw new Error('Snapshot file set contains missing or unlisted files');
  const index=parseJSON(files.get('index.json'),'index.json');
  exactKeys(index,['schemaVersion','collections'],'index');
  if (index.schemaVersion!==1 || !Array.isArray(index.collections)) throw new Error('Invalid snapshot index');
  const ids=new Set(),slugs=new Set(),usedAssets=new Set();
  for (const item of index.collections) {
    if (!object(item) || !new RegExp(`^${UUID}$`,'i').test(item.id ?? '') || ids.has(item.id)) throw new Error('Invalid or duplicate index identity / missing details');
    ids.add(item.id);
    const filename=`${item.id}.json`,bytes=files.get(filename);
    if (!bytes) throw new Error(`Missing details for index item ${item.id}`);
    const document=parseJSON(bytes,filename);
    await validateCollection(document,filename,'.',{validateLocalCover:async url=>{
      const prefix='/data/collections/';
      if (!url.startsWith(prefix)) throw new Error('Cover must belong to this snapshot');
      const asset=safePath(url.slice(prefix.length));
      if (!asset.startsWith(`assets/${document.id}/`) || !files.has(asset)) throw new Error('Missing cover asset');
      usedAssets.add(asset);return {isFile:()=>true};
    }});
    if (!manifest.preview && (document.status!=='active' || document.review.status!=='approved' || ['installation','workflow'].some(k=>document.verification[k]==='failed'))) throw new Error('Production snapshot contains unpublished details or failed tests');
    if (slugs.has(document.slug)) throw new Error('Duplicate collection slug');slugs.add(document.slug);
    if (document.id!==item.id || !isDeepStrictEqual(indexItem(document),item)) throw new Error(`Index and details disagree: ${filename}`);
  }
  for (const filename of listed) {
    if (filename==='index.json') continue;
    if (filename.startsWith('assets/')) { if (!usedAssets.has(filename)) throw new Error(`Unreferenced asset: ${filename}`); }
    else if (!ids.has(filename.slice(0,-5))) throw new Error(`Unreferenced details: ${filename}`);
  }
  return {manifest,index,files};
}
export async function verifySnapshot({fromDir,allowPreview=false,expectedRevision,limits:customLimits}={}) {
  const limits={...LIMITS,...customLimits},files=new Map();let total=0;
  const root=await realpath(fromDir);
  async function visit(directory,prefix='') {
    for (const entry of await readdir(directory,{withFileTypes:true})) {
      const filename=prefix+entry.name;safePath(filename);
      const full=path.join(directory,entry.name),info=await lstat(full);
      if (info.isSymbolicLink()) throw new Error(`Snapshot symbolic link is forbidden: ${filename}`);
      if (info.isDirectory()) await visit(full,`${filename}/`);
      else {
        if (!info.isFile() || info.size>limits.maxFileBytes || (total+=info.size)>limits.maxTotalBytes || files.size>=limits.maxFiles+1) throw new Error('Snapshot file size or count limit exceeded');
        files.set(filename,await readFile(full));
      }
    }
  }
  await visit(root);return verifyFiles(files,{allowPreview,expectedRevision,limits});
}
async function targetPaths(targetDir) {
  const root=await realpath(targetDir),state=path.join(root,'.catalog-sync'),parent=path.join(root,'public/data');
  for (const directory of [state,path.join(root,'public'),parent]) {
    await mkdir(directory,{recursive:true});
    if (await realpath(directory)!==directory) throw new Error('Website target symbolic link is forbidden');
  }
  return {state,parent,destination:path.join(parent,'collections')};
}
async function withLock(paths,operation) {
  const lock=path.join(paths.state,'lock');
  try {await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw new Error('A catalog sync is already running (lock exists)');throw error;}
  try {return await operation();}finally{await rm(lock,{recursive:true,force:true});}
}
async function replaceSnapshot(paths,verified) {
  const stage=await mkdtemp(path.join(paths.parent,'.catalog-stage-')),old=path.join(paths.state,`old-${path.basename(stage)}`);
  const previous=path.join(paths.state,'previous'),superseded=path.join(paths.state,`superseded-${path.basename(stage)}`);
  let hadOld=false,hadPrevious=false,switched=false,cleanupPending=false;
  try {
    for (const [filename,bytes] of verified.files) {await mkdir(path.dirname(path.join(stage,filename)),{recursive:true});await writeFile(path.join(stage,filename),bytes);}
    let hasDestination=false;
    try {const info=await lstat(paths.destination);if(info.isSymbolicLink() || !info.isDirectory())throw new Error('Website collection target must be a directory');hasDestination=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    try {
      if(hasDestination) {
        try{await rename(previous,superseded);hadPrevious=true;}catch(error){if(error.code!=='ENOENT')throw error;}
        await rename(paths.destination,old);hadOld=true;
      }
      await rename(stage,paths.destination);switched=true;
      if(hadOld)await rename(old,previous);
    }catch(error) {
      try {
        if(switched)await rename(paths.destination,stage);
        if(hadOld)await rename(old,paths.destination);
        if(hadPrevious)await rename(superseded,previous);
      }catch(restoreError){throw new AggregateError([error,restoreError],'Snapshot switch and restoration failed; saved directories are retained for recovery');}
      throw error;
    }
    if(hadPrevious)try{await rm(superseded,{recursive:true,force:true});}catch{cleanupPending=true;}
    return {sourceRevision:verified.manifest.sourceRevision,count:verified.index.collections.length,preview:verified.manifest.preview,...(cleanupPending?{cleanupPending:true}:{})};
  }finally{await rm(stage,{recursive:true,force:true});}
}
export async function installSnapshot({fromDir,targetDir,allowPreview=false,expectedRevision}={}) {
  const verified=await verifySnapshot({fromDir,allowPreview,expectedRevision}),paths=await targetPaths(targetDir);
  return withLock(paths,()=>replaceSnapshot(paths,verified));
}
export async function rollbackSnapshot({targetDir,allowPreview=false}={}) {
  const paths=await targetPaths(targetDir);
  return withLock(paths,async()=>replaceSnapshot(paths,await verifySnapshot({fromDir:path.join(paths.state,'previous'),allowPreview})));
}
