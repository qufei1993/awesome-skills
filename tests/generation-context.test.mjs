import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { indexItem } from '../scripts/lib/site-contract.mjs';
import { collectionInputs, loadPreviousSnapshot, mergedMainApproval } from '../scripts/lib/generation-context.mjs';

const SHA='a'.repeat(40),REPO='qufei1993/awesome-skills';
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
async function archive({preview=false,revision=SHA,documentRevision=2,localCover}={}) {
  const document=JSON.parse(await readFile(new URL('./fixtures/site/e3a003dc-3ea5-4cc5-b5a4-088d1b74985c.json',import.meta.url),'utf8'));
  document.revision=documentRevision;
  document.cover={kind:'concept',preset:'neutral',alt:'A concept cover'};
  if(localCover)document.cover={kind:'source-image',url:`/data/collections/assets/${document.id}/cover.png`,sourceUrl:`https://github.com/${REPO}`,alt:'A local cover',rightsStatus:'needs-review'};
  const files={'index.json':Buffer.from(JSON.stringify({schemaVersion:1,collections:[indexItem(document)]})),[`${document.id}.json`]:Buffer.from(JSON.stringify(document))};
  if(localCover)files[`assets/${document.id}/cover.png`]=localCover;
  files['manifest.json']=Buffer.from(JSON.stringify({schemaVersion:1,preview,sourceRevision:revision,files:Object.entries(files).map(([name,bytes])=>({path:name,size:bytes.length,sha256:hash(bytes)}))}));
  return {document,bytes:Buffer.from(zipSync(files))};
}
function release(sha=SHA) {
  return {tag_name:`snapshot-${sha}`,draft:false,prerelease:false,published_at:'2026-10-01T00:00:00Z',assets:['catalog.zip','catalog.zip.sha256'].map(name=>({name,browser_download_url:`https://github.com/${REPO}/releases/download/snapshot-${sha}/${name}`}))};
}
function remote(data,{listed=[release()],checksum=hash(data.bytes),tagRelease=release(),zip=data.bytes}={}) {
  return async url=>{
    if(url===`https://api.github.com/repos/${REPO}/releases?per_page=100`)return new Response(JSON.stringify(listed));
    if(url===`https://api.github.com/repos/${REPO}/releases/tags/snapshot-${SHA}`)return new Response(JSON.stringify(tagRelease));
    if(url===`https://github.com/${REPO}/releases/download/snapshot-${SHA}/catalog.zip`)return new Response(zip);
    if(url===`https://github.com/${REPO}/releases/download/snapshot-${SHA}/catalog.zip.sha256`)return new Response(`${checksum}  catalog.zip\n`);
    throw new Error(`Unexpected request ${url}`);
  };
}
function releaseHistory(releases,archives) {
  return async url=>{
    if(url===`https://api.github.com/repos/${REPO}/releases?per_page=100`)return new Response(JSON.stringify(releases));
    for(const [revision,data] of archives){
      if(url===`https://api.github.com/repos/${REPO}/releases/tags/snapshot-${revision}`)return new Response(JSON.stringify(release(revision)));
      if(url===`https://github.com/${REPO}/releases/download/snapshot-${revision}/catalog.zip`)return new Response(data.bytes);
      if(url===`https://github.com/${REPO}/releases/download/snapshot-${revision}/catalog.zip.sha256`)return new Response(`${hash(data.bytes)}  catalog.zip\n`);
    }
    throw new Error(`Unexpected request ${url}`);
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
test('a verified production release is reused without following a later moving latest release',async t=>{
  const root=await temporary(t),data=await archive();
  const previous=await loadPreviousSnapshot({rootDir:root,request:remote(data)});
  assert.equal(previous.get('taste').id,'e3a003dc-3ea5-4cc5-b5a4-088d1b74985c');assert.equal(previous.get('taste').revision,2);
  const reused=await loadPreviousSnapshot({rootDir:root,request:async()=>{throw new Error('Moving latest release must not be queried again');}});
  assert.deepEqual(reused.get('taste'),previous.get('taste'));
});
test('previous snapshot exposes verified local cover hashes without sharing a mutable hash map',async t=>{
  const root=await temporary(t),localCover=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
  const data=await archive({localCover}),previous=await loadPreviousSnapshot({rootDir:root,request:remote(data)});
  assert.equal(previous.assetHashes.get('taste'),'1e3084c779c1f2892590abab46c93e1b8e7a272c116bc861b11efa8b7f23b369');
  previous.assetHashes.set('taste','Changed by consumer');
  const reused=await loadPreviousSnapshot({rootDir:root,request:async()=>{throw new Error('Do not refetch the pinned baseline');}});
  assert.equal(reused.assetHashes.get('taste'),'1e3084c779c1f2892590abab46c93e1b8e7a272c116bc861b11efa8b7f23b369');
});
test('rebuilding an older checkout ignores future and unknown revisions when choosing its baseline',async t=>{
  const root=await temporary(t);initialize(root);await writeFile(path.join(root,'README.md'),'First');const ancestor=commit(root,'First','2026-10-01T00:00:00Z');
  await writeFile(path.join(root,'README.md'),'Current');const head=commit(root,'Current','2026-10-02T00:00:00Z');
  await writeFile(path.join(root,'README.md'),'Future');const future=commit(root,'Future','2026-10-03T00:00:00Z');git(root,['checkout','-q',head]);
  const result=await loadPreviousSnapshot({rootDir:root,request:releaseHistory([release(future),release('f'.repeat(40)),release(ancestor)],new Map([
    [ancestor,await archive({revision:ancestor,documentRevision:2})],[future,await archive({revision:future,documentRevision:9})],
  ]))});
  assert.equal(result.get('taste').revision,2);
});
test('an existing snapshot of the exact HEAD takes precedence over a newer-published ancestor',async t=>{
  const root=await temporary(t);initialize(root);await writeFile(path.join(root,'README.md'),'First');const ancestor=commit(root,'First','2026-10-01T00:00:00Z');
  await writeFile(path.join(root,'README.md'),'Current');const head=commit(root,'Current','2026-10-02T00:00:00Z');
  const previous=release(ancestor);previous.published_at='2026-10-05T00:00:00Z';
  const current=release(head);current.published_at='2026-10-02T00:00:00Z';
  const result=await loadPreviousSnapshot({rootDir:root,request:releaseHistory([previous,current],new Map([
    [ancestor,await archive({revision:ancestor,documentRevision:2})],[head,await archive({revision:head,documentRevision:3})],
  ]))});
  assert.equal(result.get('taste').revision,3);
});
test('missing release baselines permit first publication but network failures do not',async t=>{
  for(const response of [new Response('[]'),new Response('{}',{status:404})]){
    const root=await temporary(t);assert.equal((await loadPreviousSnapshot({rootDir:root,request:async()=>response})).size,0);
  }
  const root=await temporary(t);await assert.rejects(loadPreviousSnapshot({rootDir:root,request:async()=>new Response('Service unavailable',{status:503})}),/503|failed/i);
});
test('corrupt checksums, preview releases and revision mismatches cannot become empty baselines',async t=>{
  for(const options of [{checksum:'0'.repeat(64)},{data:await archive({preview:true})},{data:await archive({revision:'b'.repeat(40)})}]){
    const root=await temporary(t),data=options.data??await archive();
    await assert.rejects(loadPreviousSnapshot({rootDir:root,request:remote(data,options)}),/checksum|preview|revision/i);
  }
});
test('release assets from another repository are refused before downloading',async t=>{
  const root=await temporary(t),data=await archive(),invalid=release();invalid.assets[0].browser_download_url='https://github.com/another/repository/releases/download/catalog.zip';
  await assert.rejects(loadPreviousSnapshot({rootDir:root,request:remote(data,{tagRelease:invalid})}),/asset|repository|URL/i);
});
test('API credentials cannot follow an API redirect to a foreign host',async t=>{
  const root=await temporary(t),previous=process.env.GH_TOKEN;process.env.GH_TOKEN='test-credential';t.after(()=>{if(previous===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=previous;});
  await assert.rejects(loadPreviousSnapshot({rootDir:root,request:async()=>new Response(null,{status:302,headers:{Location:'https://foreign.example/collect'}})}),/redirect|302|failed/i);
});
test('release asset downloads do not carry the GitHub API credential',async t=>{
  const root=await temporary(t),data=await archive(),respond=remote(data),previous=process.env.GH_TOKEN;
  process.env.GH_TOKEN='test-api-credential';t.after(()=>{if(previous===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=previous;});
  const result=await loadPreviousSnapshot({rootDir:root,request:async(url,options)=>{
    if(new URL(url).hostname==='github.com')assert.equal(options.headers.Authorization,undefined);
    else assert.equal(options.headers.Authorization,'Bearer test-api-credential');
    return respond(url);
  }});
  assert.equal(result.get('taste').slug,'taste');
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
