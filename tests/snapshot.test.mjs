import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink, cp, chmod, rm, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { execFileSync } from 'node:child_process';
import { buildCatalog } from '../scripts/lib/catalog.mjs';
import { serializeCollectionMarkdown } from '../scripts/lib/markdown.mjs';
import { verifySnapshot, installSnapshot, rollbackSnapshot, decodeSnapshotZip, downloadSnapshot } from '../scripts/lib/snapshot.mjs';

const SHA = 'a'.repeat(40);
const hash = b => createHash('sha256').update(b).digest('hex');
async function snapshot(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'catalog-snapshot-test-'));
  const bytes = Buffer.from(JSON.stringify({schemaVersion:1, collections:[]}));
  const manifest = {schemaVersion:1, preview:false, sourceRevision:SHA, files:[{path:'index.json',size:bytes.length,sha256:hash(bytes)}],...options};
  await writeFile(path.join(root,'index.json'),bytes);
  await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));
  return {root,manifest,bytes};
}
async function site() { return mkdtemp(path.join(os.tmpdir(), 'catalog-site-test-')); }
async function zipSnapshot(data) {
  return zipSync({'index.json':data.bytes,'manifest.json':strToU8(JSON.stringify(data.manifest))});
}
async function displayMigrationSnapshot(t, change=()=>{}) {
  const root=await site();t.after(()=>rm(root,{recursive:true,force:true}));
  const document=JSON.parse(await readFile(new URL('./fixtures/site/de64301b-09cf-4968-9fc2-24ede5cd4dd6.json',import.meta.url),'utf8'));
  document.category='media';document.verification.source='needs-review';
  document.cover={kind:'source-image',url:'/assets/cover.png',sourceUrl:'https://example.com/source',alt:'Archived cover',rightsStatus:'needs-review'};
  change(document);
  const directory=path.join(root,'collections/media',document.slug);await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'README.md'),serializeCollectionMarkdown(document,{language:'zh',coverFile:'cover.png'}));
  await writeFile(path.join(directory,'cover.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64'));
  const result=await buildCatalog({rootDir:root,preview:true,sourceRevision:SHA});
  const manifestPath=path.join(result.outputDir,'manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  manifest.preview=false;await writeFile(manifestPath,JSON.stringify(manifest));
  return {fromDir:result.outputDir,document};
}
test('production verifier preserves approved display migrations with outstanding verification', async t => {
  const {fromDir,document}=await displayMigrationSnapshot(t);
  const result=await verifySnapshot({fromDir});
  assert.equal(result.index.collections.length,1);
  const detail=JSON.parse(result.files.get(`${document.id}.json`));
  assert.equal(detail.review.status,'approved');
  assert.equal(detail.verification.source,'needs-review');assert.equal(detail.verification.files,'needs-review');
  assert.equal(detail.verification.installation,'not-tested');assert.equal(detail.verification.workflow,'not-tested');
  assert.deepEqual(detail.skills.map(skill=>skill.resourceCheck),['needs-review','needs-review','needs-review']);
  assert.equal(detail.cover.rightsStatus,'needs-review');
});
test('production verifier rejects failed tests and pending display approval', async t => {
  for (const field of ['installation','workflow']) {
    const {fromDir}=await displayMigrationSnapshot(t,document=>{
      document.verification[field]='failed';
      document.verification[`${field}Evidence`]={testedAt:'2026-10-01',versions:[{repo:'obra/superpowers',commit:'8ca22dba9a94f28898bbce59f2537ff4d87c747d'}],itemIds:['brainstorming'],resultRef:'test-result.txt',environment:'temporary test fixture'};
    });
    await assert.rejects(verifySnapshot({fromDir}),/unpublished|failed/i);
  }
  const {fromDir}=await displayMigrationSnapshot(t,document=>{document.review={status:'pending',notes:[]};});
  await assert.rejects(verifySnapshot({fromDir}),/unpublished|approved/i);
});
test('external-cover support still rejects missing local assets and index/detail cover disagreements with valid hashes', async t => {
  for (const change of ['missing-asset','different-index-cover']) {
    const {fromDir,document}=await displayMigrationSnapshot(t);
    const manifestPath=path.join(fromDir,'manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    if (change === 'missing-asset') {
      const asset=`assets/${document.id}/cover.png`;
      await rm(path.join(fromDir,asset)); manifest.files=manifest.files.filter(file=>file.path !== asset);
    } else {
      const indexPath=path.join(fromDir,'index.json'),index=JSON.parse(await readFile(indexPath,'utf8'));
      index.collections[0].cover.url='https://images.example.com/different-cover.png';
      const bytes=Buffer.from(JSON.stringify(index)); await writeFile(indexPath,bytes);
      const entry=manifest.files.find(file=>file.path === 'index.json'); entry.size=bytes.length; entry.sha256=hash(bytes);
    }
    await writeFile(manifestPath,JSON.stringify(manifest));
    await assert.rejects(verifySnapshot({fromDir}),change === 'missing-asset' ? /cover.*(existing|asset)/i : /index.*details.*disagree/i);
  }
});
test('verifies a fixed revision and installs the complete snapshot', async () => {
  const data=await snapshot(), target=await site();
  const result=await verifySnapshot({fromDir:data.root,expectedRevision:SHA});
  assert.equal(result.manifest.sourceRevision,SHA);
  await installSnapshot({fromDir:data.root,targetDir:target,expectedRevision:SHA});
  assert.equal(await readFile(path.join(target,'public/data/collections/index.json'),'utf8'),data.bytes.toString());
});
test('corrupt update keeps the installed snapshot and its manifest', async () => {
  const good=await snapshot(), bad=await snapshot(),target=await site();
  await installSnapshot({fromDir:good.root,targetDir:target});
  await writeFile(path.join(bad.root,'index.json'),'corrupt');
  await assert.rejects(installSnapshot({fromDir:bad.root,targetDir:target}),/checksum|size/i);
  assert.equal(await readFile(path.join(target,'public/data/collections/index.json'),'utf8'),good.bytes.toString());
  assert.deepEqual(await readdir(path.join(target,'public/data/collections')),['index.json','manifest.json']);
});
test('production refuses previews, while explicit local preview succeeds', async () => {
  const data=await snapshot({preview:true}),target=await site();
  await assert.rejects(installSnapshot({fromDir:data.root,targetDir:target}),/preview/i);
  await installSnapshot({fromDir:data.root,targetDir:target,allowPreview:true});
});
test('snapshot must match requested revision and contain all manifest files', async () => {
  const data=await snapshot();
  await assert.rejects(verifySnapshot({fromDir:data.root,expectedRevision:'b'.repeat(40)}),/revision/i);
  data.manifest.files.push({path:'missing.json',sha256:'0'.repeat(64),size:4});
  await writeFile(path.join(data.root,'manifest.json'),JSON.stringify(data.manifest));
  await assert.rejects(verifySnapshot({fromDir:data.root}),/missing|file set/i);
});
test('rejects traversal, unknown files, duplicate manifest entries and symlinks', async () => {
  const traversal=await snapshot(); traversal.manifest.files[0].path='../index.json';
  await writeFile(path.join(traversal.root,'manifest.json'),JSON.stringify(traversal.manifest));
  await assert.rejects(verifySnapshot({fromDir:traversal.root}),/path/i);
  const extra=await snapshot(); await writeFile(path.join(extra.root,'unlisted.json'),'{}');
  await assert.rejects(verifySnapshot({fromDir:extra.root}),/file set|unlisted/i);
  const duplicate=await snapshot();duplicate.manifest.files.push(duplicate.manifest.files[0]);
  await writeFile(path.join(duplicate.root,'manifest.json'),JSON.stringify(duplicate.manifest));
  await assert.rejects(verifySnapshot({fromDir:duplicate.root}),/duplicate/i);
  const linked=await snapshot(); await symlink(path.join(extra.root,'index.json'),path.join(linked.root,'link.json'));
  await assert.rejects(verifySnapshot({fromDir:linked.root}),/symbolic|symlink/i);
});
test('index and details must agree, even if every file hash is correct', async () => {
  const data=await snapshot(); const index=Buffer.from(JSON.stringify({schemaVersion:1,collections:[{id:'missing'}]}));
  data.manifest.files[0]={path:'index.json',size:index.length,sha256:hash(index)};
  await writeFile(path.join(data.root,'index.json'),index);await writeFile(path.join(data.root,'manifest.json'),JSON.stringify(data.manifest));
  await assert.rejects(verifySnapshot({fromDir:data.root}),/details|index/i);
});
test('successful update keeps previous snapshot for verified rollback', async () => {
  const old=await snapshot(),next=await snapshot({sourceRevision:'b'.repeat(40)}),target=await site();
  await installSnapshot({fromDir:old.root,targetDir:target});
  await installSnapshot({fromDir:next.root,targetDir:target});
  await rollbackSnapshot({targetDir:target});
  assert.equal(JSON.parse(await readFile(path.join(target,'public/data/collections/manifest.json'),'utf8')).sourceRevision,SHA);
});
test('a competing sync lock prevents concurrent publication', async () => {
  const data=await snapshot(),target=await site();
  await mkdir(path.join(target,'.catalog-sync/lock'),{recursive:true});
  await assert.rejects(installSnapshot({fromDir:data.root,targetDir:target}),/already|lock/i);
});
test('backup cleanup failure preserves the previous version and reports the successful switch accurately', {skip:process.platform==='win32'}, async () => {
  const old=await snapshot(),next=await snapshot({sourceRevision:'b'.repeat(40)}),target=await site();
  await installSnapshot({fromDir:old.root,targetDir:target});
  const locked=path.join(target,'.catalog-sync/previous/locked');
  await mkdir(locked,{recursive:true});await writeFile(path.join(locked,'entry'),'locked');await chmod(locked,0);
  try {
    const result=await installSnapshot({fromDir:next.root,targetDir:target});
    assert.equal(result.sourceRevision,'b'.repeat(40));assert.equal(result.cleanupPending,true);
    assert.equal(JSON.parse(await readFile(path.join(target,'public/data/collections/manifest.json'),'utf8')).sourceRevision,'b'.repeat(40));
    assert.equal(JSON.parse(await readFile(path.join(target,'.catalog-sync/previous/manifest.json'),'utf8')).sourceRevision,SHA);
  } finally {
    for(const item of await readdir(path.join(target,'.catalog-sync'))) {
      const candidate=path.join(target,'.catalog-sync',item,'locked');
      try{await chmod(candidate,0o700);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    await rm(target,{recursive:true,force:true});
  }
});
test('ZIP reader rejects traversal and declared oversize before extraction', async () => {
  const evil=zipSync({'../escape.json':strToU8('evil')});
  assert.throws(()=>decodeSnapshotZip(evil),/path/i);
  const data=await snapshot();
  const zip=await zipSnapshot(data);
  assert.equal(decodeSnapshotZip(zip).get('index.json').toString(),data.bytes.toString());
  assert.throws(()=>decodeSnapshotZip(zip,{maxTotalBytes:10}),/limit|size/i);
});
test('ZIP reader rejects Unix symlinks in central-directory metadata', async () => {
  const zip=Buffer.from(zipSync({'link':strToU8('target')}));
  const position=zip.indexOf(Buffer.from('504b0102','hex'));
  zip[position+5]=3;zip.writeUInt32LE((0o120777 * 65536)>>>0,position+38);
  assert.throws(()=>decodeSnapshotZip(zip),/symlink|symbolic/i);
});
test('remote consumer pins release, checks archive hash and manifest revision', async () => {
  const data=await snapshot(),zip=await zipSnapshot(data),calls=[];
  const responses=new Map([
    [`https://api.github.com/repos/team/catalog/releases/tags/snapshot-${SHA}`,new Response(JSON.stringify({tag_name:`snapshot-${SHA}`,assets:[
      {name:'catalog.zip',browser_download_url:`https://github.com/team/catalog/releases/download/snapshot-${SHA}/catalog.zip`},
      {name:'catalog.zip.sha256',browser_download_url:`https://github.com/team/catalog/releases/download/snapshot-${SHA}/catalog.zip.sha256`}
    ]}))],
    [`https://github.com/team/catalog/releases/download/snapshot-${SHA}/catalog.zip`,new Response(zip)],
    [`https://github.com/team/catalog/releases/download/snapshot-${SHA}/catalog.zip.sha256`,new Response(`${hash(zip)}  catalog.zip\n`)]
  ]);
  const result=await downloadSnapshot({repo:'team/catalog',ref:SHA,fetchImpl:async url=>{calls.push(url);return responses.get(url);}});
  assert.equal(result.manifest.sourceRevision,SHA);assert.equal(calls.length,3);
  await assert.rejects(downloadSnapshot({repo:'team/catalog',ref:'main'}),/40|SHA|revision/i);
});
test('remote consumer refuses release assets from another host or repository', async () => {
  await assert.rejects(downloadSnapshot({repo:'team/catalog',ref:SHA,fetchImpl:async()=>new Response(JSON.stringify({tag_name:`snapshot-${SHA}`,assets:[
    {name:'catalog.zip',browser_download_url:'https://evil.invalid/catalog.zip'},
    {name:'catalog.zip.sha256',browser_download_url:'https://evil.invalid/checksum'}
  ]}))}),/asset|URL|host/i);
});
test('real three-collection preview installs through the CLI with all details and covers', async () => {
  const target=await site(),root=await site(),output=path.join(root,'snapshot');
  await cp(path.join(process.cwd(),'tests/fixtures/migrated/collections'),path.join(root,'collections'),{recursive:true});
  for (const [slug,category] of [['taste','design'],['engineering','development'],['product-video','media']]) {
    const directory=path.join(root,'collections',slug),file=path.join(directory,'README.md');
    await writeFile(file,(await readFile(file,'utf8')).replace(/^category:.*\n/m,''));
    await mkdir(path.join(root,'collections',category),{recursive:true});
    await rename(directory,path.join(root,'collections',category,slug));
  }
  await writeFile(path.join(root,'README.md'),'# Snapshot integration\n');
  await buildCatalog({rootDir:root,outputDir:output,preview:true,sourceRevision:SHA});
  const verified=await verifySnapshot({fromDir:output,allowPreview:true,expectedRevision:SHA});
  assert.deepEqual(verified.index.collections.map(c=>[c.itemCount,c.installationCount]),[[13,13],[31,31],[3,14]]);
  execFileSync(process.execPath,['scripts/sync-site.mjs','--from',output,'--target',target,'--preview'],{cwd:process.cwd()});
  const installed=await verifySnapshot({fromDir:path.join(target,'public/data/collections'),allowPreview:true});
  assert.deepEqual(installed.index,verified.index);
  assert.deepEqual([...installed.files.keys()].sort(),[...verified.files.keys()].sort());
  for(const [name,bytes] of verified.files)assert.deepEqual(installed.files.get(name),bytes);
});
