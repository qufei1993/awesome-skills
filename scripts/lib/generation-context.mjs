import { readFile, writeFile, mkdir, mkdtemp, rename, rm, realpath, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseContributionMarkdown } from './contribution.mjs';
import { verifySnapshot } from './snapshot.mjs';
import { readCurrentSnapshot } from './publication.mjs';

const execute=promisify(execFile),SHA=/^[a-f0-9]{40}$/i;
const REPOSITORY='qufei1993/awesome-skills',EPOCH='1970-01-01T00:00:00.000Z';
const baselineLoads=new Map();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function within(root,target) {
  const relative=path.relative(root,target);
  return relative==='' || !relative.startsWith(`..${path.sep}`) && relative!=='..' && !path.isAbsolute(relative);
}
async function git(rootDir,args) {
  const {stdout}=await execute('git',args,{cwd:rootDir,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});return stdout.trim();
}
async function gitRoot(rootDir) {
  try {return await realpath(await git(rootDir,['rev-parse','--show-toplevel']))===await realpath(rootDir);}
  catch(error) {if(error.code==='ENOENT' || error.code===128)return false;throw error;}
}
async function checkout(rootDir) {
  if(!await gitRoot(rootDir))return null;
  const sha=await git(rootDir,['rev-parse','--verify','HEAD']);if(!SHA.test(sha))throw new Error('Invalid Git checkout revision');return sha.toLowerCase();
}
async function ancestorRevision(rootDir,revision,head) {
  if(!head || revision===head)return true;
  try {await git(rootDir,['cat-file','-e',`${revision}^{commit}`]);}
  catch(error) {if(error.code===1 || error.code===128)return false;throw error;}
  try {await git(rootDir,['merge-base','--is-ancestor',revision,head]);return true;}
  catch(error) {if(error.code===1)return false;throw error;}
}
export async function collectionInputs({rootDir,directory,record}={}) {
  const root=await realpath(rootDir),location=await realpath(directory);
  if(!within(root,location))throw new Error('Collection inputs must remain inside the repository');
  const inputs=new Map(),covers=new Set();
  for(const name of ['README.md','README.zh.md']){
    const file=path.join(location,name);let bytes;
    try {if(!within(location,await realpath(file)))throw new Error('Collection README symbolic link escapes its directory');bytes=await readFile(file);}
    catch(error) {if(error.code==='ENOENT')continue;throw error;}
    inputs.set(path.relative(root,file).split(path.sep).join('/'),bytes);
    const parsed=parseContributionMarkdown(bytes.toString('utf8'),{filename:file});
    if(parsed.cover && !parsed.cover.url.startsWith('https://'))covers.add(decodeURIComponent(parsed.cover.url));
  }
  for(const contribution of Object.values(record?.publicReadmes??{}))if(contribution.cover && !contribution.cover.url.startsWith('https://'))covers.add(decodeURIComponent(contribution.cover.url));
  for(const name of covers){
    const file=path.resolve(location,name);
    if(!within(location,file) || !within(location,await realpath(file)))throw new Error('Collection cover must remain inside its directory');
    inputs.set(path.relative(root,file).split(path.sep).join('/'),await readFile(file));
  }
  if(!inputs.size)throw new Error('Collection inputs require at least one public README');
  const fingerprint=createHash('sha256');
  for(const [name,bytes] of [...inputs].sort(([a],[b])=>a<b?-1:a>b?1:0))fingerprint.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`).update(bytes);
  let dates={createdAt:EPOCH,updatedAt:EPOCH};
  if(await gitRoot(root)){
    if(await git(root,['rev-parse','--is-shallow-repository'])==='true')throw new Error('Collection dates require complete Git history (fetch-depth: 0)');
    const files=[...inputs.keys()];
    const history=(await git(root,['log','--format=%cI','--reverse','--',...files])).split('\n').filter(Boolean).map(value=>new Date(value).toISOString());
    if(history.length)dates={createdAt:history[0],updatedAt:history.at(-1)};
    if(await git(root,['status','--porcelain','--untracked-files=all','--',...files]))dates.updatedAt=new Date(Date.parse(dates.updatedAt)+1).toISOString();
  }
  return {inputDigest:fingerprint.digest('hex'),dates};
}
function safeRequest(request=fetch) {
  return async (input,options={})=>{
    const url=new URL(input),api=url.origin==='https://api.github.com';
    if(url.protocol!=='https:' || url.username || url.password || !['api.github.com','github.com'].includes(url.hostname))throw new Error('Untrusted GitHub request URL');
    const token=process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    const response=await request(url.href,{...options,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(api && token ? {Authorization:`Bearer ${token}`}:{})},redirect:api?'manual':'follow',signal:AbortSignal.timeout(30000)});
    if(api && response?.status>=300 && response.status<400)throw new Error('GitHub API redirect refused; credentials cannot leave the API host');
    return response;
  };
}
async function responseJSON(response,label) {
  if(!response?.ok)throw new Error(`${label} request failed (${response?.status??'no response'})`);
  if(Number(response.headers.get('content-length'))>2*1024*1024)throw new Error(`${label} response is too large`);
  const bytes=await response.arrayBuffer();if(bytes.byteLength>2*1024*1024)throw new Error(`${label} response is too large`);
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {throw new Error(`${label} response is not valid JSON`);}
}
function snapshotDocuments(verified) {
  const assetHashes=new Map();
  const documents=new Map(verified.index.collections.map(item=>{
    const document=JSON.parse(verified.files.get(`${item.id}.json`).toString('utf8'));
    if(document.cover.kind==='source-image' && document.cover.url.startsWith('/data/collections/')){
      const bytes=verified.files.get(document.cover.url.slice('/data/collections/'.length));
      if(!bytes)throw new Error('Verified previous snapshot is missing its local cover');
      assetHashes.set(document.slug,digest(bytes));
    }
    return [document.slug,document];
  }));
  documents.assetHashes=assetHashes;
  return documents;
}
function canonicalBaseUrl(value) {
  let url;
  try {url=new URL(value);}catch {throw new Error('Baseline requires a canonical HTTPS data URL');}
  if(typeof value!=='string' || url.protocol!=='https:' || url.username || url.password || /[?#]/.test(value) || /[%\\]/.test(url.pathname) || value!==url.href && `${value}/`!==url.href)throw new Error('Baseline requires a canonical HTTPS data URL without credentials or URL parameters');
  if(!url.pathname.endsWith('/'))url.pathname+='/';
  return url.href;
}
function publicStore(baseUrl,request) {
  const limit=10*1024*1024;
  return {async get(key) {
    if(typeof key!=='string' || !key || key.split('/').some(part=>!part || part==='.' || part==='..') || /[\u0000-\u0020\u007f\\%?#:]/.test(key))throw new Error('Invalid public snapshot object key');
    const response=await request(`${baseUrl}${key}`,{headers:{Accept:'application/json'},redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(30000)});
    if(response?.redirected || response?.status>=300 && response.status<400)throw new Error('Public snapshot redirect refused');
    if(response?.status===404 && key==='current.json')return null;
    if(response?.status===404)throw new Error(`Missing publication file: ${key}`);
    if(!response?.ok)throw new Error(`Public snapshot request failed (HTTP ${response?.status??'unknown'})`);
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new Error('Public snapshot response size limit exceeded');}
    const reader=response.body?.getReader();if(!reader)throw new Error('Public snapshot response body is missing');
    const chunks=[];let size=0;
    try {
      for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>limit)throw new Error('Public snapshot response size limit exceeded');chunks.push(Buffer.from(value));}
    }finally{await reader.cancel();}
    return Buffer.concat(chunks);
  }};
}
async function snapshotCache(rootDir,baseUrl,revision) {
  const root=await realpath(rootDir),parent=path.join(root,'dist/generated-context/baselines');
  await mkdir(parent,{recursive:true});if(!within(root,await realpath(parent)))throw new Error('Previous snapshot cache escapes the repository');
  return {parent,target:path.join(parent,digest(Buffer.from(`${baseUrl}\0${revision??'local'}`)))};
}
async function existingBaseline(target,baseUrl,head,rootDir) {
  let info;
  try {info=await lstat(target);}catch(error){if(error.code==='ENOENT')return undefined;throw error;}
  if(!info.isDirectory() || info.isSymbolicLink())throw new Error('Previous snapshot cache must be a directory');
  const metadataPath=path.join(target,'metadata.json');if((await lstat(metadataPath)).isSymbolicLink())throw new Error('Previous snapshot metadata cannot be a symbolic link');
  const metadata=JSON.parse(await readFile(metadataPath,'utf8'));
  if(metadata.baseUrl!==baseUrl || metadata.head!==head || typeof metadata.empty!=='boolean')throw new Error('Previous snapshot cache identity mismatch');
  if(metadata.empty)return new Map();
  if(!SHA.test(metadata.sourceRevision??''))throw new Error('Invalid cached source revision');
  if(!await ancestorRevision(rootDir,metadata.sourceRevision,head))throw new Error('Cached baseline revision is not an ancestor of this checkout');
  return snapshotDocuments(await verifySnapshot({fromDir:path.join(target,'snapshot'),expectedRevision:metadata.sourceRevision}));
}
async function retrieveBaseline({rootDir,baseUrl,request}) {
  const head=await checkout(rootDir),{parent,target}=await snapshotCache(rootDir,baseUrl,head);
  const cached=await existingBaseline(target,baseUrl,head,rootDir);if(cached!==undefined)return cached;
  const verified=await readCurrentSnapshot({store:publicStore(baseUrl,request)});
  const sourceRevision=verified?.manifest.sourceRevision;
  if(verified && !await ancestorRevision(rootDir,sourceRevision,head))throw new Error('Published baseline revision is not an ancestor of this checkout');
  const stage=await mkdtemp(path.join(parent,'.previous-snapshot-'));
  try {
    if(verified)for(const [name,bytes] of verified.files){const file=path.join(stage,'snapshot',name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);}
    await writeFile(path.join(stage,'metadata.json'),JSON.stringify({baseUrl,head,empty:!verified,...(verified?{sourceRevision}:{})})+'\n');
    await rename(stage,target);
  }finally{await rm(stage,{recursive:true,force:true});}
  return verified?snapshotDocuments(verified):new Map();
}
export async function loadPreviousSnapshot({rootDir,baseUrl,request=fetch}={}) {
  baseUrl=canonicalBaseUrl(baseUrl);
  const key=`${await realpath(rootDir)}\0${baseUrl}\0${await checkout(rootDir)??'local'}`;
  if(!baselineLoads.has(key))baselineLoads.set(key,retrieveBaseline({rootDir,baseUrl,request}));
  try {
    const baseline=await baselineLoads.get(key),copy=new Map([...baseline].map(([slug,document])=>[slug,structuredClone(document)]));
    copy.assetHashes=new Map(baseline.assetHashes??[]);return copy;
  }catch(error){baselineLoads.delete(key);throw error;}
}
export async function mergedMainApproval({rootDir,request=fetch}={}) {
  if(process.env.GITHUB_ACTIONS!=='true' || !['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || process.env.GITHUB_REF!=='refs/heads/main' || process.env.GITHUB_REPOSITORY!==REPOSITORY)throw new Error('Reviewed main approval requires a trusted GitHub Actions main event');
  const head=await checkout(rootDir);
  if(!head || process.env.GITHUB_SHA!==head)throw new Error('Reviewed main approval requires GITHUB_SHA to match the exact Git checkout');
  const fetcher=safeRequest(request),pulls=await responseJSON(await fetcher(`https://api.github.com/repos/${REPOSITORY}/commits/${head}/pulls`),'Associated pull requests');
  if(!Array.isArray(pulls))throw new Error('Associated pull requests must be an array');
  for(const candidate of pulls){
    if(!Number.isSafeInteger(candidate.number) || candidate.number<1 || candidate.merge_commit_sha!==head || candidate.base?.ref!=='main' || candidate.base?.repo?.full_name!==REPOSITORY)continue;
    const pr=await responseJSON(await fetcher(`https://api.github.com/repos/${REPOSITORY}/pulls/${candidate.number}`),'Merged pull request');
    if(pr.merged!==true || pr.merge_commit_sha!==head || pr.base?.ref!=='main' || pr.base?.repo?.full_name!==REPOSITORY || !Number.isFinite(Date.parse(pr.merged_at)) || typeof pr.merged_by?.login!=='string' || !/^[a-z\d][a-z\d-]*(?:\[bot\])?$/i.test(pr.merged_by.login))continue;
    return {status:'approved',reviewer:pr.merged_by.login,reviewedAt:pr.merged_at,notes:[`Accepted through merged main pull request https://github.com/${REPOSITORY}/pull/${candidate.number}; merge revision ${head}. Automated source checks do not establish installation or workflow results.`]};
  }
  throw new Error('No merged main pull request proves publication approval for this checkout');
}
