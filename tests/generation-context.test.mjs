import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { indexItem } from '../scripts/lib/site-contract.mjs';
import { collectionInputs, loadPreviousSnapshot, mergedMainApproval } from '../scripts/lib/generation-context.mjs';

const SHA='a'.repeat(40),REPO='qufei1993/awesome-skills',BASE='https://data.example.com/catalog/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function temporary(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'catalog-generation-context-'));
  t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
function git(root,args,environment={}) {
  return execFileSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,...environment},stdio:['ignore','pipe','ignore']}).trim();
}
function initialize(root) {git(root,['init','-q']);git(root,['config','user.name','Test']);git(root,['config','user.email','test@example.com']);}
function commit(root,message,date) {
  git(root,['add','.']);git(root,['commit','-qm',message],{GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date});return git(root,['rev-parse','HEAD']);
}
function contribution(title='A collection') {
  return `# ${title}\n\nA short description.\n\n![Cover](cover.png)\n\n## Overview\n\nA complete overview.\n\n## Scenarios\n\n- Development\n\n## Usage\n\nUse the selected Skills.\n\n## Skills\n\n- https://github.com/obra/superpowers/tree/${SHA}/skills\n`;
}
async function inputDirectory(root) {
  const directory=path.join(root,'collections/development/example');await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'README.md'),contribution());await writeFile(path.join(directory,'cover.png'),'first cover');return directory;
}
async function published({preview=false,revision=SHA,documentRevision=2,localCover}={}) {
  const document=JSON.parse(await readFile(new URL('./fixtures/site/e3a003dc-3ea5-4cc5-b5a4-088d1b74985c.json',import.meta.url),'utf8'));
  document.revision=documentRevision;
  document.cover={kind:'concept',preset:'neutral',alt:'A concept cover'};
  if(localCover)document.cover={kind:'source-image',url:`/data/collections/assets/${document.id}/cover.png`,sourceUrl:`https://github.com/${REPO}`,alt:'A local cover',rightsStatus:'needs-review'};
  const files={'index.json':Buffer.from(JSON.stringify({schemaVersion:1,collections:[indexItem(document)]})),[`${document.id}.json`]:Buffer.from(JSON.stringify(document))};
  if(localCover)files[`assets/${document.id}/cover.png`]=localCover;
  files['manifest.json']=Buffer.from(JSON.stringify({schemaVersion:1,preview,sourceRevision:revision,files:Object.entries(files).map(([name,bytes])=>({path:name,size:bytes.length,sha256:hash(bytes)}))}));
  const version=hash(files['manifest.json']),snapshotPath=`snapshots/${version}/`;
  const assets=Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('assets/')).map(([name,bytes])=>[name,`images/${hash(bytes)}.png`]));
  const release={schemaVersion:1,version,sourceRevision:revision,preview,snapshotPath,assets};
  const releaseBytes=Buffer.from(JSON.stringify(release));
  const objects=new Map([['current.json',releaseBytes],[`${snapshotPath}release.json`,releaseBytes],...Object.entries(files).map(([name,bytes])=>[assets[name] || `${snapshotPath}${name}`,bytes])]);
  return {document,files,release,objects};
}
function remote(data,baseUrl=BASE) {
  return async url=>{
    if(!url.startsWith(baseUrl))throw new Error(`Unexpected request ${url}`);
    const bytes=data.objects.get(url.slice(baseUrl.length));
    return bytes ? new Response(bytes) : new Response('Missing object',{status:404});
  };
}
function actionEnvironment(t,sha,changes={}) {
  const values={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:REPO,GITHUB_SHA:sha,...changes};
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));Object.assign(process.env,values);
  t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
}

test('input identity includes both public languages and cover bytes while committed dates remain stable',async t=>{
  const root=await temporary(t),directory=await inputDirectory(root);initialize(root);
  commit(root,'Introduce collection','2026-10-01T03:00:00Z');
  const first=await collectionInputs({rootDir:root,directory});
  assert.deepEqual(first.dates,{createdAt:'2026-10-01T03:00:00.000Z',updatedAt:'2026-10-01T03:00:00.000Z'});
  assert.deepEqual(await collectionInputs({rootDir:root,directory}),first);
  await writeFile(path.join(root,'README.md'),'Unrelated root documentation');commit(root,'Unrelated documentation','2026-10-01T05:00:00Z');
  assert.deepEqual(await collectionInputs({rootDir:root,directory}),first);
  await writeFile(path.join(directory,'README.zh.md'),contribution('翻译'));
  const translated=await collectionInputs({rootDir:root,directory});assert.notEqual(translated.inputDigest,first.inputDigest);
  assert.equal(translated.dates.updatedAt,'2026-10-01T03:00:00.001Z');
  commit(root,'Add translation','2026-10-02T04:00:00Z');
  const committed=await collectionInputs({rootDir:root,directory});
  assert.deepEqual(committed.dates,{createdAt:'2026-10-01T03:00:00.000Z',updatedAt:'2026-10-02T04:00:00.000Z'});
  await writeFile(path.join(directory,'cover.png'),'new cover');
  assert.notEqual((await collectionInputs({rootDir:root,directory})).inputDigest,committed.inputDigest);
});
test('temporary inputs without Git use fixed dates and never the current clock',async t=>{
  const root=await temporary(t),directory=await inputDirectory(root);
  const result=await collectionInputs({rootDir:root,directory});
  assert.deepEqual(result.dates,{createdAt:'1970-01-01T00:00:00.000Z',updatedAt:'1970-01-01T00:00:00.000Z'});
  assert.deepEqual(await collectionInputs({rootDir:root,directory}),result);
});
test('a verified R2 production baseline is pinned when current changes later',async t=>{
  const root=await temporary(t),data=await published();
  const previous=await loadPreviousSnapshot({rootDir:root,baseUrl:BASE,request:remote(data)});
  assert.equal(previous.get('taste').id,'e3a003dc-3ea5-4cc5-b5a4-088d1b74985c');assert.equal(previous.get('taste').revision,2);
  const reused=await loadPreviousSnapshot({rootDir:root,baseUrl:BASE,request:async()=>{throw new Error('Moving current must not be queried again');}});
  assert.deepEqual(reused.get('taste'),previous.get('taste'));
});
test('previous snapshot exposes verified local cover hashes without sharing mutable maps',async t=>{
  const root=await temporary(t),localCover=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
  const data=await published({localCover}),previous=await loadPreviousSnapshot({rootDir:root,baseUrl:BASE,request:remote(data)});
  assert.equal(previous.assetHashes.get('taste'),'1e3084c779c1f2892590abab46c93e1b8e7a272c116bc861b11efa8b7f23b369');
  previous.assetHashes.set('taste','Changed by consumer');previous.get('taste').revision=9;
  const reused=await loadPreviousSnapshot({rootDir:root,baseUrl:BASE,request:async()=>{throw new Error('Do not refetch the pinned baseline');}});
  assert.equal(reused.assetHashes.get('taste'),'1e3084c779c1f2892590abab46c93e1b8e7a272c116bc861b11efa8b7f23b369');
  assert.equal(reused.get('taste').revision,2);
});
test('published ancestors and the exact checkout can establish the production baseline',async t=>{
  const root=await temporary(t);initialize(root);await writeFile(path.join(root,'README.md'),'First');const ancestor=commit(root,'First','2026-10-01T00:00:00Z');
  await writeFile(path.join(root,'README.md'),'Current');const head=commit(root,'Current','2026-10-02T00:00:00Z');
  const data=await published({revision:ancestor});
  assert.equal((await loadPreviousSnapshot({rootDir:root,baseUrl:BASE,request:remote(data)})).get('taste').revision,2);
  const current=await published({revision:head,documentRevision:3}),otherBase='https://current.example.com/';
  assert.equal((await loadPreviousSnapshot({rootDir:root,baseUrl:otherBase,request:remote(current,otherBase)})).get('taste').revision,3);
});
test('future and unknown published commits cannot become empty or trusted baselines',async t=>{
  const root=await temporary(t);initialize(root);await writeFile(path.join(root,'README.md'),'Current');const head=commit(root,'Current','2026-10-01T00:00:00Z');
  await writeFile(path.join(root,'README.md'),'Future');const future=commit(root,'Future','2026-10-02T00:00:00Z');git(root,['checkout','-q',head]);
  for(const revision of [future,'f'.repeat(40)]){
    await assert.rejects(loadPreviousSnapshot({rootDir:root,baseUrl:BASE,request:remote(await published({revision}))}),/ancestor|checkout/i);
  }
});
test('only a missing current pointer permits first publication',async t=>{
  const root=await temporary(t);assert.equal((await loadPreviousSnapshot({rootDir:root,baseUrl:BASE,request:async()=>new Response('Missing',{status:404})})).size,0);
  for(const status of [403,503]){
    const root=await temporary(t);await assert.rejects(loadPreviousSnapshot({rootDir:root,baseUrl:BASE,request:async()=>new Response('Unavailable',{status})}),new RegExp(`${status}|failed`,'i'));
  }
  const missing=await published();missing.objects.delete(`${missing.release.snapshotPath}index.json`);
  await assert.rejects(loadPreviousSnapshot({rootDir:await temporary(t),baseUrl:BASE,request:remote(missing)}),/missing/i);
});
test('corrupt files, preview data and mismatched pointer revisions are rejected',async t=>{
  for(const {options,change} of [
    {change:data=>data.objects.set(`${data.release.snapshotPath}index.json`,Buffer.from('{}'))},
    {options:{preview:true}},
    {change:data=>data.objects.set('current.json',Buffer.from(JSON.stringify({...data.release,sourceRevision:'b'.repeat(40)})))},
    {change:data=>data.objects.set(`${data.release.snapshotPath}manifest.json`,Buffer.from('{}'))},
  ]){
    const data=await published(options);change?.(data);
    await assert.rejects(loadPreviousSnapshot({rootDir:await temporary(t),baseUrl:BASE,request:remote(data)}),/checksum|preview|revision|manifest|disagree|match/i);
  }
});
test('baseline cache identity includes the public data URL',async t=>{
  const root=await temporary(t),first=await published(),second=await published({documentRevision:3}),otherBase='https://other.example.com/catalog/';
  assert.equal((await loadPreviousSnapshot({rootDir:root,baseUrl:BASE,request:remote(first)})).get('taste').revision,2);
  assert.equal((await loadPreviousSnapshot({rootDir:root,baseUrl:otherBase,request:remote(second,otherBase)})).get('taste').revision,3);
  const moduleUrl=new URL('../scripts/lib/generation-context.mjs',import.meta.url).href;
  const source=`import {loadPreviousSnapshot} from ${JSON.stringify(moduleUrl)};const result=await loadPreviousSnapshot({rootDir:${JSON.stringify(root)},baseUrl:${JSON.stringify(BASE)},request:()=>{throw new Error('Disk cache must be used');}});console.log(result.get('taste').revision);`;
  assert.equal(execFileSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'}).trim(),'2');
});
test('public baseline requests carry no credentials and reject redirects',async t=>{
  const previous=process.env.GH_TOKEN;process.env.GH_TOKEN='test-api-credential';t.after(()=>{if(previous===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=previous;});
  const data=await published(),respond=remote(data);
  const result=await loadPreviousSnapshot({rootDir:await temporary(t),baseUrl:BASE,request:async(url,options)=>{
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.redirect,'manual');assert.ok(options.signal);
    return respond(url);
  }});
  assert.equal(result.get('taste').slug,'taste');
  await assert.rejects(loadPreviousSnapshot({rootDir:await temporary(t),baseUrl:BASE,request:async()=>new Response(null,{status:302,headers:{Location:'https://foreign.example/collect'}})}),/redirect|302|failed/i);
});
test('baseline URLs must be canonical HTTPS URLs without embedded credentials or URL parameters',async t=>{
  const root=await temporary(t);
  for(const baseUrl of ['http://data.example.com','https://user:secret@data.example.com','https://data.example.com/?token=x','https://data.example.com/#fragment','https://data.example.com/?','https://data.example.com/#','https://data.example.com/../catalog/']){
    await assert.rejects(loadPreviousSnapshot({rootDir:root,baseUrl,request:()=>{throw new Error('Invalid URL must fail before requesting');}}),/URL|HTTPS|canonical/i);
  }
});
test('public baseline bodies are bounded by declared and streamed sizes',async t=>{
  for(const response of [
    new Response('{}',{headers:{'content-length':String(10*1024*1024+1)}}),
    new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10*1024*1024+1));controller.close();}})),
  ]){
    await assert.rejects(loadPreviousSnapshot({rootDir:await temporary(t),baseUrl:BASE,request:async()=>response}),/size|large|limit/i);
  }
});
test('main approval requires a real merged PR matching the exact checkout',async t=>{
  const root=await temporary(t);initialize(root);await writeFile(path.join(root,'README.md'),'A repository');const sha=commit(root,'Initial commit','2026-10-01T00:00:00Z');actionEnvironment(t,sha);
  const pr={number:2,merged:true,merged_at:'2026-10-02T00:00:00Z',merge_commit_sha:sha,merged_by:{login:'maintainer'},base:{ref:'main',repo:{full_name:REPO}}};
  const request=async url=>{
    if(url===`https://api.github.com/repos/${REPO}/commits/${sha}/pulls`)return new Response(JSON.stringify([pr]));
    if(url===`https://api.github.com/repos/${REPO}/pulls/2`)return new Response(JSON.stringify(pr));
    throw new Error(`Unexpected ${url}`);
  };
  const result=await mergedMainApproval({rootDir:root,request});
  assert.equal(result.status,'approved');assert.equal(result.reviewer,'maintainer');assert.equal(result.reviewedAt,'2026-10-02T00:00:00Z');
  assert.match(result.notes[0],/pull\/2/);
});
test('spoofed main environment or unmerged PR cannot approve a collection',async t=>{
  const root=await temporary(t);initialize(root);await writeFile(path.join(root,'README.md'),'A repository');const sha=commit(root,'Initial commit','2026-10-01T00:00:00Z');actionEnvironment(t,sha);
  await assert.rejects(mergedMainApproval({rootDir:root,request:async()=>new Response('[]')}),/merged|approval/i);
  process.env.GITHUB_SHA='b'.repeat(40);await assert.rejects(mergedMainApproval({rootDir:root,request:async()=>{throw new Error('must refuse before network');}}),/checkout|revision|SHA/i);
  process.env.GITHUB_SHA=sha;process.env.GITHUB_EVENT_NAME='pull_request';await assert.rejects(mergedMainApproval({rootDir:root,request:async()=>{throw new Error('must refuse before network');}}),/event|main|Actions/i);
});
test('an associated open PR or foreign base does not establish merged main approval',async t=>{
  const root=await temporary(t);initialize(root);await writeFile(path.join(root,'README.md'),'A repository');const sha=commit(root,'Initial commit','2026-10-01T00:00:00Z');actionEnvironment(t,sha);
  for(const change of [{merged:false,merged_at:null},{base:{ref:'main',repo:{full_name:'another/repository'}}}]){
    const candidate={number:2,merged:true,merged_at:'2026-10-02T00:00:00Z',merge_commit_sha:sha,merged_by:{login:'maintainer'},base:{ref:'main',repo:{full_name:REPO}}};
    await assert.rejects(mergedMainApproval({rootDir:root,request:async url=>new Response(JSON.stringify(url.endsWith('/pulls')?[candidate]:{...candidate,...change}))}),/merged|approval/i);
  }
});
test('GitHub approval requests refuse redirects with their credentials',async t=>{
  const root=await temporary(t);initialize(root);await writeFile(path.join(root,'README.md'),'A repository');const sha=commit(root,'Initial commit','2026-10-01T00:00:00Z');actionEnvironment(t,sha,{GH_TOKEN:'test-credential'});
  await assert.rejects(mergedMainApproval({rootDir:root,request:async(url,options)=>{
    assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(options.headers.Authorization,'Bearer test-credential');assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://foreign.example/collect'}});
  }}),/redirect/i);
});
