import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildCatalog } from '../scripts/lib/catalog.mjs';
import { serializeContributionMarkdown } from '../scripts/lib/contribution.mjs';
import { serializeCollectionMarkdown } from '../scripts/lib/markdown.mjs';

const sha='a'.repeat(40);
const blob=Buffer.from('---\nname: plan-work\ndescription: Plan the work before implementing it.\n---\n\nDo not execute this fixture.\n');
const blobSha=createHash('sha1').update(`blob ${blob.length}\0`).update(blob).digest('hex');
async function request(endpoint) {
  if (endpoint.includes('/commits/')) {
    if (decodeURIComponent(endpoint.split('/commits/')[1])!==sha) throw Object.assign(new Error('Unknown fixture ref'),{status:404});
    return {sha,commit:{tree:{sha},committer:{date:'2026-10-01T00:00:00Z'}}};
  }
  if (endpoint.includes('/git/trees/')) return {sha, truncated:false,tree:[{path:'skills/plan-work/SKILL.md',type:'blob',mode:'100644',sha:blobSha}]};
  if (endpoint.includes('/git/blobs/')) return {sha:blobSha,size:blob.length,encoding:'base64',content:blob.toString('base64')};
  if (endpoint.endsWith('/repos/example/skills')) return {default_branch:'main',owner:{login:'example'}};
  throw new Error(`Unexpected fixture request: ${endpoint}`);
}
async function fixture(t) {
  const rootDir=await mkdtemp(path.join(os.tmpdir(),'automatic-catalog-'));
  t.after(()=>rm(rootDir,{recursive:true,force:true}));
  const directory=path.join(rootDir,'collections/development/planning');
  await mkdir(directory,{recursive:true});
  const data={title:'Planning',description:'Plan work with an upstream Skill.',overview:'Use the planning Skill before implementation.',scenarios:['Planning a feature'],usage:'Read the plan, then implement it.',links:[`https://github.com/example/skills/tree/${sha}/skills`]};
  await writeFile(path.join(directory,'README.md'),serializeContributionMarkdown(data));
  return {rootDir,directory,data};
}
test('README-only submission generates a complete preview without a source JSON',async t=>{
  const {rootDir}=await fixture(t);
  const result=await buildCatalog({rootDir,preview:true,resolveSources:true,request});
  assert.equal(result.records.length,1);
  assert.equal(result.incomplete.length,0);
  const [record]=result.records;
  assert.equal(record.skills.length,1);
  assert.equal(record.skills[0].originalDescription,'Plan the work before implementing it.');
  assert.equal(record.skills[0].entry.commit,sha);
  assert.equal(record.skills[0].installationItems[0].directory,'skills/plan-work');
  assert.equal(record.skills[0].installationItems[0].license.identifier,'NOASSERTION');
  assert.equal(record.review.status,'pending');
  assert.equal(record.verification.installation,'not-tested');
  assert.equal(record.verification.workflow,'not-tested');
  await assert.rejects(access(path.join(rootDir,'.catalog/planning.json')),{code:'ENOENT'});
  const again=await buildCatalog({rootDir,preview:true,resolveSources:true,request:()=>{throw new Error('Unchanged inputs must reuse the recorded source pins');}});
  assert.deepEqual(again.records,result.records);
  assert.equal((await buildCatalog({rootDir,resolveSources:true,request})).records.length,0);
});
test('README edits advance generated revision and failed resolution preserves published output',async t=>{
  const {rootDir,directory,data}=await fixture(t);
  const first=await buildCatalog({rootDir,preview:true,resolveSources:true,request});
  await writeFile(path.join(directory,'README.md'),serializeContributionMarkdown({...data,title:'Planning updated'}));
  const next=await buildCatalog({rootDir,preview:true,resolveSources:true,request});
  assert.equal(next.records[0].id,first.records[0].id);
  assert.equal(next.records[0].revision,first.records[0].revision+1);
  assert.ok(Date.parse(next.records[0].updatedAt)>Date.parse(first.records[0].updatedAt));
  const before=await readFile(path.join(next.outputDir,'index.json'));
  await writeFile(path.join(directory,'README.md'),serializeContributionMarkdown({...data,title:'Unavailable upstream'}));
  await assert.rejects(buildCatalog({rootDir,preview:true,resolveSources:true,request:()=>{throw new Error('Upstream unavailable');}}),/Upstream unavailable/);
  assert.deepEqual(await readFile(path.join(next.outputDir,'index.json')),before);
});
test('an unpublished main change becomes the proposal baseline even when the last release is older',async t=>{
  const current=await fixture(t),base=await fixture(t);
  const published=(await buildCatalog({rootDir:current.rootDir,preview:true,resolveSources:true,request})).records[0];
  await writeFile(path.join(base.directory,'README.md'),serializeContributionMarkdown({...base.data,title:'Unpublished main change'}));
  await writeFile(path.join(current.directory,'README.md'),serializeContributionMarkdown({...current.data,title:'Next proposal'}));
  const result=await buildCatalog({rootDir:current.rootDir,baseDir:base.rootDir,previousRecords:new Map([[published.slug,published]]),preview:true,resolveSources:true,request});
  assert.equal(result.records[0].revision,published.revision+2);
  assert.equal(result.records[0].sourceKeys.filter(k=>k.startsWith('readme:')).length,3);
});
test('legacy presentation updates advance revision without editing retained system data',async t=>{
  const current=await fixture(t),base=await fixture(t);
  const old=JSON.parse(await readFile(new URL('./fixtures/site/d2ca0659-07ee-44a5-8d99-d3295f5e2f0c.json',import.meta.url)));
  old.category='development';old.cover={kind:'concept',preset:'engineering',alt:'Engineering'};
  for (const f of [current,base]) await rm(path.join(f.rootDir,'collections'),{recursive:true});
  for (const [f,document] of [[base,old],[current,{...old,description:'A revised introduction.'}]]) {
    const directory=path.join(f.rootDir,'collections/development',old.slug);
    await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'README.md'),serializeCollectionMarkdown(document));
  }
  const result=await buildCatalog({rootDir:current.rootDir,baseDir:base.rootDir,preview:true,resolveSources:true,request});
  assert.equal(result.records[0].revision,old.revision+1);
  assert.equal(result.records[0].id,old.id);
  assert.deepEqual(result.records[0].skills,old.skills);
  assert.equal(result.records[0].review.status,'pending');
});
