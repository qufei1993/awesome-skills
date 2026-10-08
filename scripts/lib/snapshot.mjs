import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { unzipSync } from 'fflate';
import { validateCollection, indexItem } from './site-contract.mjs';

const SHA=/^[a-f0-9]{40}$/i, HASH=/^[a-f0-9]{64}$/;
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const LIMITS={maxFiles:10000,maxFileBytes:10*1024*1024,maxTotalBytes:100*1024*1024,maxArchiveBytes:40*1024*1024};
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
export function decodeSnapshotZip(input,{maxFileBytes=LIMITS.maxFileBytes,maxTotalBytes=LIMITS.maxTotalBytes,maxFiles=LIMITS.maxFiles,maxArchiveBytes=LIMITS.maxArchiveBytes}={}) {
  const bytes=Buffer.from(input);
  if (bytes.length>maxArchiveBytes || bytes.length<22) throw new Error('ZIP archive size limit or invalid archive');
  let end=-1;
  for (let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if (bytes.readUInt32LE(i)===0x06054b50 && i+22+bytes.readUInt16LE(i+20)===bytes.length) {end=i;break;}
  if (end<0 || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0) throw new Error('Invalid or multipart ZIP archive');
  const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);
  if (count!==bytes.readUInt16LE(end+8) || count>maxFiles || count===65535 || start+size!==end) throw new Error('ZIP file count, size limit or ZIP64 is unsupported');
  const names=new Map();let cursor=start,total=0;
  for (let i=0;i<count;i++) {
    if (cursor+46>end || bytes.readUInt32LE(cursor)!==0x02014b50) throw new Error('Invalid ZIP central directory');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),expanded=bytes.readUInt32LE(cursor+24),compressed=bytes.readUInt32LE(cursor+20),nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42);
    const next=cursor+46+nameLength+extra+comment;
    if (next>end || (flags&1) || ![0,8].includes(method)) throw new Error('Invalid or unsupported ZIP entry');
    const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+nameLength));
    const directory=name.endsWith('/'),normalized=directory?name.slice(0,-1):name;safePath(normalized);
    const mode=bytes.readUInt32LE(cursor+38)>>>16;
    if ((mode&0o170000)===0o120000) throw new Error('ZIP symbolic link is forbidden');
    if ((mode&0o170000) && ![0o100000,0o040000].includes(mode&0o170000)) throw new Error('ZIP special file is forbidden');
    if (names.has(normalized) || expanded>maxFileBytes || (total+=expanded)>maxTotalBytes) throw new Error('ZIP duplicate path or size limit exceeded');
    if (local+30>start || bytes.readUInt32LE(local)!==0x04034b50 || bytes.readUInt16LE(local+8)!==method || bytes.readUInt16LE(local+6)!==flags) throw new Error('ZIP local entry does not match directory');
    const localNameLength=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28);
    if (local+30+localNameLength+localExtra+compressed>start || !bytes.subarray(local+30,local+30+localNameLength).equals(bytes.subarray(cursor+46,cursor+46+nameLength))) throw new Error('Invalid ZIP local path or size');
    names.set(normalized,{name,directory,size:expanded});cursor=next;
  }
  if (cursor!==end) throw new Error('ZIP directory size mismatch');
  const decoded=unzipSync(bytes),files=new Map();
  for (const entry of names.values()) {
    const data=decoded[entry.name];
    if (!data || data.length!==entry.size) throw new Error('ZIP decompressed size mismatch');
    if (!entry.directory) files.set(entry.name,Buffer.from(data));
  }
  return files;
}
async function limitedResponse(response,limit) {
  if (!response?.ok) throw new Error(`Snapshot download failed (${response?.status ?? 'no response'})`);
  if (Number(response.headers.get('content-length'))>limit) throw new Error('Snapshot response size limit exceeded');
  const reader=response.body?.getReader();if (!reader) throw new Error('Missing snapshot response body');
  const chunks=[];let size=0;
  try { for (;;) {const {done,value}=await reader.read();if(done)break;if((size+=value.length)>limit)throw new Error('Snapshot response size limit exceeded');chunks.push(Buffer.from(value));} }
  finally {await reader.cancel();}
  return Buffer.concat(chunks);
}
export async function downloadSnapshot({repo,ref,fetchImpl=fetch}={}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repo ?? '')) throw new Error('Repository must be owner/name');
  if (!SHA.test(ref ?? '')) throw new Error('Remote source revision must be a full 40-character SHA');
  ref=ref.toLowerCase();const tag=`snapshot-${ref}`;
  const request=url=>fetchImpl(url,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(30000)});
  const release=parseJSON(await limitedResponse(await request(`https://api.github.com/repos/${repo}/releases/tags/${tag}`),2*1024*1024),'release');
  if (release.tag_name!==tag || release.draft || !Array.isArray(release.assets)) throw new Error('Release tag does not match requested revision');
  function asset(name) {
    const matching=release.assets.filter(a=>a.name===name);
    const expected=`https://github.com/${repo}/releases/download/${tag}/${name}`;
    if (matching.length!==1 || matching[0].browser_download_url!==expected) throw new Error('Release asset URL does not match repository and fixed revision');
    return expected;
  }
  const zipURL=asset('catalog.zip'),checksumURL=asset('catalog.zip.sha256');
  const checksum=(await limitedResponse(await request(checksumURL),1024)).toString('utf8').trim();
  if (!/^[a-f0-9]{64}\s+\*?catalog\.zip$/.test(checksum)) throw new Error('Invalid archive checksum file');
  const zip=await limitedResponse(await request(zipURL),LIMITS.maxArchiveBytes);
  if (digest(zip)!==checksum.slice(0,64)) throw new Error('Archive checksum mismatch');
  return verifyFiles(decodeSnapshotZip(zip),{expectedRevision:ref});
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
