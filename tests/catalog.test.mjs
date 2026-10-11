import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCatalog, loadCatalog, validateCatalog } from '../scripts/lib/catalog.mjs';
import { verifySnapshot } from '../scripts/lib/snapshot.mjs';
import { fixtureUpstream, writeSubmission, skillText, UPSTREAM_SHA, PNG } from './helpers/submission.mjs';

const request=fixtureUpstream();
const run=promisify(execFile);
const cli=new URL('../scripts/catalog.mjs',import.meta.url).pathname;
const approval={status:'approved',reviewer:'Maintainer',reviewedAt:'2026-10-08T00:00:00Z',notes:[]};
async function root(t) {
  const rootDir=await mkdtemp(path.join(os.tmpdir(),'catalog-test-'));
  t.after(()=>rm(rootDir,{recursive:true,force:true}));
  await mkdir(path.join(rootDir,'collections'));
  await writeFile(path.join(rootDir,'README.md'),'# Intro\n\nHandwritten introduction.\n');
  return rootDir;
}
const preview=rootDir=>buildCatalog({rootDir,preview:true,resolveSources:true,request,sourceRevision:UPSTREAM_SHA});
const previousMap=document=>new Map([[document.slug,structuredClone(document)]]);
const chinese={title:'计划合集',description:'帮助制定实施计划。',overview:'先梳理任务，再制定计划。',scenarios:['规划功能'],usage:'先阅读计划，再开始实施。'};

test('offline validation derives category and readable fields without resolving upstream',async t=>{
  const rootDir=await root(t);
  const {data}=await writeSubmission(rootDir,{category:'productivity'});
  const result=await validateCatalog({rootDir,request:()=>{throw new Error('Offline validation must not use network');}});
  assert.equal(result.count,1);
  assert.equal(result.incomplete.length,1);
  assert.equal(result.records[0].document.category,'productivity');
  assert.equal(result.records[0].document.title,'Planning');
  assert.deepEqual(result.records[0].document.links,data.links);
  assert.equal(result.records[0].document.id,undefined);
  assert.equal(result.records[0].document.status,'draft');
  assert.equal(result.records[0].complete,false);
});

test('preview includes generated pending Skills and a verified source manifest',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  const result=await preview(rootDir);
  assert.equal(result.records.length,1);
  assert.equal(result.index.collections[0].itemCount,1);
  assert.equal(result.index.collections[0].installationCount,1);
  assert.equal(result.records[0].review.status,'pending');
  assert.equal(result.records[0].skills[0].originalDescription,'Use plan-work for useful work.');
  assert.equal(result.records[0].skills[0].entry.commit,UPSTREAM_SHA);
  assert.equal(result.records[0].verification.source,'verified');
  assert.equal(result.records[0].verification.installation,'not-tested');
  assert.equal(result.records[0].verification.workflow,'not-tested');
  assert.equal(result.incomplete.length,0);
  await verifySnapshot({fromDir:result.outputDir,expectedRevision:UPSTREAM_SHA,allowPreview:true});
});

test('production approval is separate from local generated state',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  const pending=await buildCatalog({rootDir,resolveSources:true,request});
  assert.equal(pending.records.length,0);
  const approved=await buildCatalog({rootDir,resolveSources:true,reviewApproval:approval,request});
  assert.equal(approved.records.length,1);
  assert.equal(approved.records[0].verification.installation,'not-tested');
  assert.equal((await buildCatalog({rootDir,resolveSources:true,request})).records.length,0);
  assert.equal((await buildCatalog({rootDir,resolveSources:true,request,previousRecords:previousMap(approved.records[0])})).records.length,1);
});

test('an unchanged generated source reuses fixed versions without calling upstream',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  const first=await preview(rootDir);
  const again=await buildCatalog({rootDir,preview:true,resolveSources:true,request:()=>{throw new Error('Source pins were already resolved');}});
  assert.deepEqual(again.records,first.records);
  assert.equal(again.records[0].revision,1);
});

test('a previous snapshot contributes only records generated from collection READMEs',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  const first=(await preview(rootDir)).records[0];
  const unrelated={...first,sourceKeys:['manually-maintained-source'],revision:50,review:approval};
  const result=await buildCatalog({rootDir,preview:true,resolveSources:true,request,previousRecords:previousMap(unrelated)});
  assert.equal(result.records[0].id,first.id);
  assert.equal(result.records[0].revision,1);
  assert.equal(result.records[0].review.status,'pending');
  assert.equal(result.records[0].sourceKeys.includes('manually-maintained-source'),false);
  unrelated.id='11111111-1111-4111-8111-111111111111';
  unrelated.sourceKeys=first.sourceKeys;
  const again=await buildCatalog({rootDir,preview:true,resolveSources:true,request,previousRecords:previousMap(unrelated)});
  assert.equal(again.records[0].id,first.id);
  assert.equal(again.records[0].revision,1);
});

test('failed upstream resolution preserves the complete output and generated state',async t=>{
  const rootDir=await root(t);
  const {data}=await writeSubmission(rootDir);
  const first=await preview(rootDir);
  const beforeIndex=await readFile(path.join(first.outputDir,'index.json'));
  const beforeState=await readFile(path.join(rootDir,'dist/generated-catalog.json'));
  await writeSubmission(rootDir,{...data,title:'Changed'});
  await assert.rejects(buildCatalog({rootDir,preview:true,resolveSources:true,request:()=>{throw new Error('Unavailable upstream');}}),/Unavailable upstream/);
  assert.deepEqual(await readFile(path.join(first.outputDir,'index.json')),beforeIndex);
  assert.deepEqual(await readFile(path.join(rootDir,'dist/generated-catalog.json')),beforeState);
});

test('fixed category paths reject unknown categories, flat collections and invalid slugs',async t=>{
  for (const category of ['unlisted','video']) {
    const rootDir=await root(t);
    await writeSubmission(rootDir,{category});
    await assert.rejects(loadCatalog({rootDir}),/fixed category|unknown/);
  }
  const rootDir=await root(t);
  const {directory}=await writeSubmission(rootDir);
  await writeFile(path.join(rootDir,'collections/development/README.md'),await readFile(path.join(directory,'README.md')));
  await assert.rejects(loadCatalog({rootDir}),/nested slug/);
  const invalid=await root(t);
  await writeSubmission(invalid,{slug:'Upper_Case'});
  await assert.rejects(loadCatalog({rootDir:invalid}),/lowercase slug/);
});

test('baseline applies the same nested category format as new submissions',async t=>{
  const rootDir=await root(t),baseDir=await root(t);
  await writeSubmission(rootDir);
  await mkdir(path.join(baseDir,'collections/development'));
  await writeFile(path.join(baseDir,'collections/development/README.md'),await readFile(path.join(rootDir,'collections/development/planning/README.md')));
  await assert.rejects(loadCatalog({rootDir,baseDir}),/nested slug/);
});

test('collection slugs remain globally unique across categories',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  await writeSubmission(rootDir,{category:'design'});
  await assert.rejects(loadCatalog({rootDir}),/slug.*conflicts/);
});

test('one Skill can belong to multiple collections with independent identities',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  await writeSubmission(rootDir,{slug:'another',category:'design'});
  const result=await preview(rootDir);
  assert.equal(result.records.length,2);
  assert.notEqual(result.records[0].id,result.records[1].id);
  assert.equal(result.records[0].skills[0].id,result.records[1].skills[0].id);
  const sourceKeys=result.records.flatMap(document=>document.sourceKeys);
  assert.equal(new Set(sourceKeys).size,sourceKeys.length);
  for (const document of result.records) assert.ok(document.sourceKeys.includes(`generator:skill-entry-v1:${document.slug}`));
  const again=await buildCatalog({rootDir,preview:true,resolveSources:true,request:()=>{throw new Error('Unchanged collections must reuse their fixed sources');}});
  assert.deepEqual(again.records,result.records);
});

test('shared historical source keys cannot identify two generated collections',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  await writeSubmission(rootDir,{slug:'another',title:'Another selection'});
  const first=await preview(rootDir);
  const previousRecords=new Map(first.records.map(document=>[document.slug,{...document,sourceKeys:[...document.sourceKeys,'github:example/shared']}]));
  await assert.rejects(loadCatalog({rootDir,resolveSources:true,previousRecords,request}),/sourceKeys.*conflicts/);
});

test('categories, collection directories and README symlinks remain contained',async t=>{
  for (const location of ['category','collection','readme']) {
    const rootDir=await root(t),outside=await root(t);
    const {directory}=await writeSubmission(outside);
    if (location==='category') await symlink(path.dirname(directory),path.join(rootDir,'collections/development'));
    if (location==='collection') {
      await mkdir(path.join(rootDir,'collections/development'));
      await symlink(directory,path.join(rootDir,'collections/development/planning'));
    }
    if (location==='readme') {
      const local=await writeSubmission(rootDir);
      await rm(path.join(local.directory,'README.md'));
      await symlink(path.join(directory,'README.md'),path.join(local.directory,'README.md'));
    }
    await assert.rejects(loadCatalog({rootDir}),/symbolic link.*escapes/);
  }
});

test('all visible README covers stay within their collection directory',async t=>{
  for (const mode of ['missing','directory','symlink']) {
    const rootDir=await root(t),outside=await root(t);
    const {directory}=await writeSubmission(rootDir,{cover:{url:'cover.png',alt:'Cover'}});
    if (mode==='directory') await mkdir(path.join(directory,'cover.png'));
    if (mode==='symlink') {
      await writeFile(path.join(outside,'cover.png'),PNG);
      await symlink(path.join(outside,'cover.png'),path.join(directory,'cover.png'));
    }
    await assert.rejects(loadCatalog({rootDir}),mode==='missing' ? /ENOENT/ : /file inside|symbolic link.*escapes/);
  }
});

test('cover generation verifies file bytes and preserves the previous snapshot on failure',async t=>{
  const rootDir=await root(t);
  const {directory}=await writeSubmission(rootDir,{cover:{url:'cover.png',alt:'Cover'}});
  await writeFile(path.join(directory,'cover.png'),PNG);
  const first=await preview(rootDir);
  const before=await readFile(path.join(first.outputDir,'index.json'));
  for (const bytes of [Buffer.from('fake PNG'),Buffer.alloc(0),Buffer.alloc(5*1024*1024+1)]) {
    await writeFile(path.join(directory,'cover.png'),bytes);
    await assert.rejects(preview(rootDir),/magic bytes|nonempty image/);
    assert.deepEqual(await readFile(path.join(first.outputDir,'index.json')),before);
  }
});

test('Unicode local cover names export ASCII assets covered by snapshot hashes',async t=>{
  const rootDir=await root(t);
  const {directory}=await writeSubmission(rootDir,{cover:{url:encodeURIComponent('封面 图.PNG'),alt:'Cover'}});
  await writeFile(path.join(directory,'封面 图.PNG'),PNG);
  const result=await preview(rootDir);
  const document=result.records[0];
  assert.equal(document.cover.url,`/data/collections/assets/${document.id}/cover.png`);
  assert.deepEqual(await readFile(path.join(result.outputDir,'assets',document.id,'cover.png')),PNG);
  await verifySnapshot({fromDir:result.outputDir,expectedRevision:UPSTREAM_SHA,allowPreview:true});
});

test('HTTPS covers remain remote URLs without creating archived assets',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir,{cover:{url:'https://images.example.com/cover.png',alt:'Remote cover'}});
  const result=await preview(rootDir);
  assert.equal(result.records[0].cover.url,'https://images.example.com/cover.png');
  assert.equal(result.records[0].cover.sourceUrl,'https://images.example.com/cover.png');
  assert.equal(result.manifest.files.some(file=>file.path.startsWith('assets/')),false);
});

test('bilingual READMEs produce their own display text with shared Skill installation data',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir,{cover:{url:'https://images.example.com/cover.png',alt:'English cover'}});
  await writeSubmission(rootDir,{language:'zh',...chinese,cover:{url:'https://images.example.com/cover.png',alt:'中文封面'}});
  const result=await preview(rootDir);
  const document=result.records[0];
  assert.equal(document.title,'计划合集');
  assert.equal(document.overview,'先梳理任务，再制定计划。');
  assert.equal(document.localizations.en.title,'Planning');
  assert.equal(document.localizations.en.coverAlt,'English cover');
  assert.equal(document.cover.alt,'中文封面');
  assert.equal(document.skills[0].originalDescription,'Use plan-work for useful work.');
  assert.equal(document.skills[0].installationItems[0].directory,'skills/plan-work');
  assert.equal(document.localizations.zh,undefined);
  const again=await preview(rootDir);
  assert.deepEqual(again.records,result.records);
});

test('bilingual cover text defaults to the title in its own language',async t=>{
  const rootDir=await root(t);
  const cover={url:'https://images.example.com/cover.png',alt:''};
  await writeSubmission(rootDir,{cover});
  await writeSubmission(rootDir,{language:'zh',...chinese,cover});
  const document=(await preview(rootDir)).records[0];
  assert.equal(document.cover.alt,'计划合集');
  assert.equal(document.localizations.en.coverAlt,'Planning');
});

test('translated READMEs retain matching normalized Skill links, attribution and cover URLs',async t=>{
  for (const change of [{links:['https://github.com/other/tools']},{sourceUrl:'https://example.com/elsewhere'},{cover:{url:'https://images.example.com/other.png',alt:'另一张封面'}}]) {
    const rootDir=await root(t);
    await writeSubmission(rootDir,{sourceUrl:'https://example.com/source',cover:{url:'https://images.example.com/cover.png',alt:'Cover'}});
    await writeSubmission(rootDir,{language:'zh',...chinese,sourceUrl:'https://example.com/source',cover:{url:'https://images.example.com/cover.png',alt:'封面'},...change});
    await assert.rejects(loadCatalog({rootDir}),/must match.*canonical/);
  }
});

test('Chinese-only README validates and generates its own complete collection',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir,{language:'zh',...chinese});
  const rows=await loadCatalog({rootDir});
  assert.equal(rows[0].language,'zh');
  assert.equal(rows[0].document.title,'计划合集');
  const result=await preview(rootDir);
  assert.equal(result.records[0].title,'计划合集');
  assert.equal(result.records[0].skills.length,1);
  assert.equal(result.records[0].localizations,undefined);
});

test('each root README links its matching collection README while preserving introductions and footers',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  await writeSubmission(rootDir,{language:'zh',...chinese});
  await writeFile(path.join(rootDir,'README.md'),'# Intro\nEnglish introduction.\n<!-- catalog:start -->\nold\n<!-- catalog:end -->\nEnglish footer.\n');
  await writeFile(path.join(rootDir,'README.zh.md'),'# 介绍\n中文介绍。\n<!-- catalog:start -->\n旧目录\n<!-- catalog:end -->\n中文页脚。\n');
  await preview(rootDir);
  const en=await readFile(path.join(rootDir,'README.md'),'utf8'),zh=await readFile(path.join(rootDir,'README.zh.md'),'utf8');
  assert.match(en,/\[Planning\]\(collections\/development\/planning\/README.md\)/);
  assert.match(en,/### Development & Engineering/);
  assert.match(en,/English introduction\./); assert.match(en,/English footer\./); assert.doesNotMatch(en,/[\u3400-\u9fff]/);
  assert.match(zh,/\[计划合集\]\(collections\/development\/planning\/README.zh.md\)/);
  assert.match(zh,/### 开发与工程/); assert.match(zh,/中文介绍。/); assert.match(zh,/中文页脚。/);
  assert.doesNotMatch(zh,/Planning|pending review|Development/);
});

test('README directories stay neutral without changing pending or approved publication records',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  await writeSubmission(rootDir,{language:'zh',...chinese});
  await writeFile(path.join(rootDir,'README.zh.md'),'# 目录\n');
  const pending=await preview(rootDir);
  assert.equal(pending.records[0].review.status,'pending');
  const before=await Promise.all(['README.md','README.zh.md'].map(name=>readFile(path.join(rootDir,name),'utf8')));
  for(const text of before) assert.doesNotMatch(text,/pending review|待审核|approved|已审核/);
  const approved=await buildCatalog({rootDir,resolveSources:true,reviewApproval:approval,request});
  assert.equal(approved.records[0].review.status,'approved');
  assert.equal(approved.records[0].verification.installation,'not-tested');
  const after=await Promise.all(['README.md','README.zh.md'].map(name=>readFile(path.join(rootDir,name),'utf8')));
  assert.deepEqual(after,before);
});

test('missing collection translations use slug and local status in the optional Chinese root README',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  await preview(rootDir);
  await assert.rejects(readFile(path.join(rootDir,'README.zh.md')),{code:'ENOENT'});
  await writeFile(path.join(rootDir,'README.zh.md'),'# 中文介绍\n');
  await preview(rootDir);
  const zh=await readFile(path.join(rootDir,'README.zh.md'),'utf8');
  assert.match(zh,/\[planning\].*待翻译/);
  assert.doesNotMatch(zh,/Planning|Plan work/);
});

test('root README marker failures leave the previous snapshot intact',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  const first=await preview(rootDir);
  const before=await readFile(path.join(first.outputDir,'index.json'));
  for (const malformed of ['<!-- catalog:start -->','<!-- catalog:end -->\n<!-- catalog:start -->','<!-- catalog:start -->\n<!-- catalog:start -->\n<!-- catalog:end -->']) {
    await writeFile(path.join(rootDir,'README.md'),malformed);
    await assert.rejects(preview(rootDir),/malformed catalog markers/);
    assert.deepEqual(await readFile(path.join(first.outputDir,'index.json')),before);
  }
});

test('second README replacement failure restores both root READMEs and previous snapshot',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  await writeFile(path.join(rootDir,'README.zh.md'),'# 中文介绍\n');
  const first=await preview(rootDir);
  const beforeEn=await readFile(path.join(rootDir,'README.md')),beforeZh=await readFile(path.join(rootDir,'README.zh.md'));
  const beforeIndex=await readFile(path.join(first.outputDir,'index.json'));
  await writeSubmission(rootDir,{title:'Updated planning'});
  const original=fs.rename;
  fs.rename=async(source,target)=>{
    if (target===path.join(rootDir,'README.zh.md') && source.endsWith('.tmp')) throw new Error('Injected Chinese README replacement failure');
    return original(source,target);
  };
  syncBuiltinESMExports();
  try {await assert.rejects(preview(rootDir),/Injected Chinese README replacement failure/);}
  finally {fs.rename=original;syncBuiltinESMExports();}
  assert.deepEqual(await readFile(path.join(rootDir,'README.md')),beforeEn);
  assert.deepEqual(await readFile(path.join(rootDir,'README.zh.md')),beforeZh);
  assert.deepEqual(await readFile(path.join(first.outputDir,'index.json')),beforeIndex);
});

test('snapshot destinations protect collection sources including directory aliases',async t=>{
  const rootDir=await root(t);
  const {directory}=await writeSubmission(rootDir);
  const original=await readFile(path.join(directory,'README.md'));
  await symlink(path.join(rootDir,'collections'),path.join(rootDir,'source-alias'));
  for (const outputDir of [rootDir,path.join(rootDir,'collections'),path.join(directory,'generated'),path.join(rootDir,'source-alias/generated')]) {
    await assert.rejects(buildCatalog({rootDir,outputDir,preview:true,resolveSources:true,request}),/outputDir.*source collections/);
    assert.deepEqual(await readFile(path.join(directory,'README.md')),original);
  }
});

test('an escaping output parent leaves external directories and previous snapshot unchanged',async t=>{
  const rootDir=await root(t),outside=await root(t);
  await writeSubmission(rootDir);
  const first=await preview(rootDir);
  const before=await readFile(path.join(first.outputDir,'index.json'));
  await symlink(outside,path.join(rootDir,'escaped-output'));
  await assert.rejects(buildCatalog({rootDir,outputDir:path.join(rootDir,'escaped-output/new/collections'),preview:true,resolveSources:true,request}),/symbolic.*escapes/);
  assert.deepEqual(await readFile(path.join(first.outputDir,'index.json')),before);
  assert.deepEqual((await readdir(outside)).sort(),['README.md','collections']);
});

test('an explicitly external snapshot destination remains supported',async t=>{
  const rootDir=await root(t),outside=await root(t);
  await writeSubmission(rootDir);
  const result=await buildCatalog({rootDir,outputDir:path.join(outside,'exports'),preview:true,resolveSources:true,request,sourceRevision:UPSTREAM_SHA});
  assert.equal(result.records.length,1);
  await verifySnapshot({fromDir:result.outputDir,expectedRevision:UPSTREAM_SHA,allowPreview:true});
});

test('README edits preserve identity and historical source keys while advancing generated revisions',async t=>{
  const rootDir=await root(t),baseDir=await root(t);
  await writeSubmission(baseDir);
  const old=(await buildCatalog({rootDir:baseDir,resolveSources:true,reviewApproval:approval,request})).records[0];
  assert.equal(old.review.status,'approved');
  await writeSubmission(rootDir,{title:'Next planning'});
  const result=await buildCatalog({rootDir,baseDir,previousRecords:previousMap(old),preview:true,resolveSources:true,request});
  assert.equal(result.records[0].id,old.id);
  assert.equal(result.records[0].createdAt,old.createdAt);
  assert.equal(result.records[0].revision,old.revision+1);
  assert.ok(Date.parse(result.records[0].updatedAt)>Date.parse(old.updatedAt));
  for (const key of old.sourceKeys) assert.ok(result.records[0].sourceKeys.includes(key));
  assert.equal(result.records[0].review.status,'pending');
  const production=await buildCatalog({rootDir,baseDir,previousRecords:previousMap(old),resolveSources:true,request});
  assert.deepEqual(production.index.collections,[]);
  const renewed={...approval,reviewedAt:'2026-10-09T00:00:00Z'};
  const approved=await buildCatalog({rootDir,baseDir,previousRecords:previousMap(old),resolveSources:true,reviewApproval:renewed,request});
  assert.equal(approved.records.length,1);
  assert.equal(approved.records[0].review.reviewedAt,renewed.reviewedAt);
});

test('removing an established collection fails baseline validation',async t=>{
  const rootDir=await root(t),baseDir=await root(t);
  await writeSubmission(baseDir);
  await assert.rejects(loadCatalog({rootDir,baseDir}),/stable identity was removed/);
  await assert.rejects(loadCatalog({rootDir,baseDir,resolveSources:true,request}),/stable identity was removed/);
});

test('first submissions permit an empty baseline while the current source directory stays required',async t=>{
  const rootDir=await root(t),baseDir=await root(t);
  await rm(path.join(baseDir,'collections'),{recursive:true});
  await writeSubmission(rootDir);
  assert.equal((await loadCatalog({rootDir,baseDir})).length,1);
  await rm(path.join(rootDir,'collections'),{recursive:true});
  await assert.rejects(loadCatalog({rootDir,baseDir}),/ENOENT/);
});

test('failed installation and workflow evidence prevents an approved production release',async t=>{
  for (const field of ['installation','workflow']) {
    const rootDir=await root(t);
    await writeSubmission(rootDir);
    const document=(await preview(rootDir)).records[0];
    document.review=approval;
    document.verification[field]='failed';
    document.verification[`${field}Evidence`]={testedAt:'2026-10-08T00:00:00Z',versions:[{repo:'example/tools',commit:UPSTREAM_SHA}],itemIds:[document.skills[0].id],resultRef:'test-result.txt',environment:'temporary test directory'};
    await assert.rejects(buildCatalog({rootDir,resolveSources:true,request,previousRecords:previousMap(document)}),/failed tests prevent publication/);
  }
});

test('verification evidence must correspond to the current Skill and fixed version',async t=>{
  const rootDir=await root(t);
  await writeSubmission(rootDir);
  const document=(await preview(rootDir)).records[0];
  document.verification.installationEvidence={testedAt:'2026-10-08T00:00:00Z',versions:[{repo:'example/tools',commit:'c'.repeat(40)}],itemIds:[document.skills[0].id],resultRef:'test-result.txt',environment:'temporary test directory'};
  await assert.rejects(loadCatalog({rootDir,resolveSources:true,request,previousRecords:previousMap(document)}),/current tested Skill versions/);
});

test('different upstream directories retain author names with stable distinct installation aliases',async t=>{
  const rootDir=await root(t);
  const {data}=await writeSubmission(rootDir);
  const files={'skills/first/SKILL.md':skillText('same-name'),'skills/second/SKILL.md':skillText('same-name')};
  const first=await buildCatalog({rootDir,preview:true,resolveSources:true,request:fixtureUpstream({files})});
  const skills=first.records[0].skills;
  assert.deepEqual(skills.map(skill=>skill.name),['same-name','same-name']);
  const installationNames=skills.map(skill=>skill.installationItems[0].name);
  assert.equal(new Set(installationNames.map(name=>name.toLowerCase())).size,2);
  for (const name of installationNames) assert.match(name,/^same-name-[a-f0-9]{12}$/);
  assert.equal(first.records[0].verification.installation,'not-tested');
  for (const skill of skills) assert.match(skill.resourceNotes,/desktop collection installation requires name mapping/);
  await writeSubmission(rootDir,{...data,title:'Updated planning'});
  const again=await buildCatalog({rootDir,preview:true,resolveSources:true,request:fixtureUpstream({files:Object.fromEntries(Object.entries(files).reverse())})});
  assert.deepEqual(again.records[0].skills.map(skill=>({id:skill.id,name:skill.name,installationName:skill.installationItems[0].name})),skills.map(skill=>({id:skill.id,name:skill.name,installationName:skill.installationItems[0].name})));
});

test('new CLI writes an English README by default and preserves existing collections',async t=>{
  const rootDir=await root(t);
  await run(process.execPath,[cli,'new','my-planning','--category','development'],{cwd:rootDir});
  const file=path.join(rootDir,'collections/development/my-planning/README.md');
  const before=await readFile(file);
  const rows=await loadCatalog({rootDir});
  assert.equal(rows[0].language,'en');
  assert.equal(rows[0].document.slug,'my-planning');
  assert.equal(rows[0].document.status,'draft');
  assert.deepEqual(rows[0].document.links,['https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md']);
  await assert.rejects(run(process.execPath,[cli,'new','my-planning','--category','design'],{cwd:rootDir}),/already exists/);
  assert.deepEqual(await readFile(file),before);
  await assert.rejects(run(process.execPath,[cli,'new','../oops'],{cwd:rootDir}),/SLUG/);
  await assert.rejects(run(process.execPath,[cli,'new','unknown','--category','unknown'],{cwd:rootDir}),/fixed category/);
  await assert.rejects(run(process.execPath,[cli,'build','--publsih'],{cwd:rootDir}),/Unknown option/);
});

test('new CLI supports Chinese READMEs and category names as slugs',async t=>{
  const rootDir=await root(t);
  await run(process.execPath,[cli,'new','design','--category','product','--lang','zh'],{cwd:rootDir});
  const rows=await loadCatalog({rootDir});
  assert.equal(rows[0].language,'zh');
  assert.equal(rows[0].document.category,'product');
  assert.equal(rows[0].document.slug,'design');
  await assert.rejects(readFile(path.join(rootDir,'collections/product/design/README.md')),{code:'ENOENT'});
});

test('new CLI rejects escaping categories while accepting a repository root alias',async t=>{
  const rootDir=await root(t),outside=await root(t);
  await symlink(outside,path.join(rootDir,'collections/design'));
  await assert.rejects(run(process.execPath,[cli,'new','escape','--category','design'],{cwd:rootDir}),/symbolic link/);
  const clean=await root(t),alias=path.join(outside,'root-alias');
  await symlink(clean,alias);
  await run(process.execPath,[cli,'new','alias-planning','--category','development'],{cwd:alias});
  assert.equal((await loadCatalog({rootDir:clean}))[0].document.slug,'alias-planning');
});

test('collection inputs are readable contribution Markdown with one public README per language',async t=>{
  const rootDir=await root(t);
  const {directory}=await writeSubmission(rootDir);
  await writeFile(path.join(directory,'README.en.md'),'Ignored alternate filename.');
  assert.equal((await loadCatalog({rootDir}))[0].document.title,'Planning');
  await writeFile(path.join(directory,'README.md'),'---\nid: manual-id\n---\n\n# Manual collection\n');
  await assert.rejects(loadCatalog({rootDir}),/title/);
  await rm(path.join(directory,'README.md'));
  await writeFile(path.join(directory,'record.md'),'A separate record is not a public contribution.');
  await assert.rejects(loadCatalog({rootDir}),/ENOENT/);
});
