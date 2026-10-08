import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildCatalog, loadCatalog, validateCatalog } from '../scripts/lib/catalog.mjs';
import { serializeCollectionMarkdown } from '../scripts/lib/markdown.mjs';

const fixtureDir = new URL('./fixtures/site/', import.meta.url);
async function fixture(name = 'de64301b-09cf-4968-9fc2-24ede5cd4dd6') {
  const data = JSON.parse(await readFile(new URL(`${name}.json`, fixtureDir), 'utf8'));
  data.review.status = 'pending';
  if (data.category === 'video') data.category = 'media';
  data.cover = { kind: 'concept', preset: 'video', alt: 'Concept cover' };
  return data;
}
async function root(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'catalog-test-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  await mkdir(path.join(dir, 'collections'));
  await writeFile(path.join(dir, 'README.md'), '# Intro\n\nHandwritten introduction.\n');
  return dir;
}
async function put(dir, data, coverFile) {
  const target = path.join(dir, 'collections', data.category, data.slug);
  await mkdir(target, {recursive:true});
  await writeFile(path.join(target, 'README.md'), serializeCollectionMarkdown(data, {language:'zh', coverFile}));
}
function approve(data) {
  data.review = {status:'approved', reviewer:'Maintainer', reviewedAt:'2026-10-01', notes:[]};
  data.verification.source = data.verification.files = 'verified';
  data.verification.installation = data.verification.workflow = 'not-tested';
  for (const skill of data.skills) skill.resourceCheck = 'verified';
  return data;
}
test('real collections preserve display and deduplicated installation counts in preview', async t => {
  const dir = await root(t);
  for (const id of ['e3a003dc-3ea5-4cc5-b5a4-088d1b74985c','d2ca0659-07ee-44a5-8d99-d3295f5e2f0c','de64301b-09cf-4968-9fc2-24ede5cd4dd6']) await put(dir, await fixture(id));
  const {index, records} = await buildCatalog({rootDir:dir, preview:true, sourceRevision:'a'.repeat(40)});
  assert.equal(records.length, 3);
  const counts = Object.fromEntries(index.collections.map(c => [c.slug, [c.itemCount,c.installationCount]]));
  assert.deepEqual(counts, {taste:[13,13],engineering:[31,31],'product-video':[3,14]});
  const manifest = JSON.parse(await readFile(path.join(dir,'dist/collections/manifest.json'),'utf8'));
  assert.equal(manifest.preview,true);
  assert.equal(manifest.sourceRevision,'a'.repeat(40));
  assert.ok(manifest.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)));
  const readme = await readFile(path.join(dir,'README.md'),'utf8');
  assert.match(readme,/Handwritten introduction/);
  assert.match(readme,/catalog:start/);
});
test('production excludes pending and gates approved records without inventing test results', async t => {
  const dir = await root(t); const data = await fixture(); await put(dir,data);
  assert.equal((await buildCatalog({rootDir:dir})).records.length,0);
  approve(data); await put(dir,data);
  assert.equal((await buildCatalog({rootDir:dir})).records.length,1);
  data.verification.workflow='failed'; await put(dir,data);
  await assert.rejects(buildCatalog({rootDir:dir}), /failed|Evidence/);
});
test('production preserves approved display migrations with outstanding verification', async t => {
  const dir=await root(t),data=await fixture();
  data.review={status:'approved',reviewer:'user',reviewedAt:'2026-10-01',notes:['Existing display migration approved.']};
  data.verification.source='needs-review';
  data.cover={kind:'source-image',url:'/assets/cover.png',sourceUrl:'https://example.com/source',alt:'Archived cover',rightsStatus:'needs-review'};
  const verification=structuredClone(data.verification),resources=data.skills.map(skill=>skill.resourceCheck);
  await put(dir,data,'cover.png');
  await writeFile(path.join(dir,'collections/media/product-video/cover.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64'));
  const result=await buildCatalog({rootDir:dir});
  assert.equal(result.records.length,1);
  const detail=JSON.parse(await readFile(path.join(result.outputDir,`${data.id}.json`),'utf8'));
  assert.deepEqual(detail.verification,verification);
  assert.deepEqual(detail.skills.map(skill=>skill.resourceCheck),resources);
  assert.equal(detail.review.status,'approved');
  assert.equal(detail.verification.installation,'not-tested');
  assert.equal(detail.verification.workflow,'not-tested');
  assert.equal(detail.cover.rightsStatus,'needs-review');
});
test('approved display migrations still block failed installation and workflow', async t => {
  for (const field of ['installation','workflow']) {
    const dir=await root(t),data=await fixture();
    data.review={status:'approved',reviewer:'user',reviewedAt:'2026-10-01',notes:[]};
    data.verification[field]='failed';
    data.verification[`${field}Evidence`]={testedAt:'2026-10-01',versions:[{repo:'obra/superpowers',commit:'8ca22dba9a94f28898bbce59f2537ff4d87c747d'}],itemIds:['brainstorming'],resultRef:'test-result.txt',environment:'temporary test fixture'};
    await put(dir,data);
    await assert.rejects(buildCatalog({rootDir:dir}),/failed tests prevent publication/i);
  }
});
test('duplicate identities, slugs and historical source keys include archived records', async t => {
  const dir = await root(t); const data = await fixture(); await put(dir,data);
  const other = structuredClone(data); other.slug='another'; other.status='archived'; await put(dir,other);
  await assert.rejects(loadCatalog({rootDir:dir}),/id.*conflict|duplicate.*id/i);
  other.id=randomUUID(); await put(dir,other);
  await assert.rejects(loadCatalog({rootDir:dir}),/sourceKeys.*conflict|duplicate.*source/i);
});
test('safe paths reject traversal, encoded separators and installation conflicts', async t => {
  const dir = await root(t); const data=await fixture();
  for (const bad of ['../x','%2e%2e/x','skills%2fx','C:/x','\\\\server\\x','a\u0000b']) {
    data.skills[0].installationItems[0].directory=bad; await put(dir,data);
    await assert.rejects(loadCatalog({rootDir:dir}),/path|directory|control|safe|encoding/i);
  }
  const clean=await fixture(); clean.skills[1].installationItems[0].name=clean.skills[0].installationItems[0].name;
  await put(dir,clean); await assert.rejects(loadCatalog({rootDir:dir}),/installation.*conflict|name.*conflict/i);
});
test('base enforces stable identity and revision rules including removal bypass', async t => {
  const base=await root(t), dir=await root(t); const data=await fixture(); await put(base,data); await put(dir,data);
  await loadCatalog({rootDir:dir,baseDir:base});
  data.title+=' changed'; await put(dir,data);
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/revision/);
  data.revision++; data.updatedAt='2026-10-02T00:00:00Z'; await put(dir,data);
  await loadCatalog({rootDir:dir,baseDir:base});
  data.id=randomUUID(); await put(dir,data);
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/identity|removed|id|stable/);
});
test('failed validation preserves complete previous snapshot', async t => {
  const dir=await root(t); const data=approve(await fixture()); await put(dir,data);
  await buildCatalog({rootDir:dir,sourceRevision:'a'.repeat(40)});
  const before=await readFile(path.join(dir,'dist/collections/index.json'),'utf8');
  data.skills[0].entry.entryPoint='../SKILL.md'; await put(dir,data);
  await assert.rejects(buildCatalog({rootDir:dir}));
  assert.equal(await readFile(path.join(dir,'dist/collections/index.json'),'utf8'),before);
});
test('cover bytes and symlink escapes are rejected', async t => {
  const dir=await root(t), outside=await root(t); const data=await fixture();
  data.cover={kind:'source-image',url:'/assets/cover.png',sourceUrl:'https://example.com/cover',alt:'Cover',rightsStatus:'needs-review'};
  await put(dir,data,'cover.png'); await writeFile(path.join(dir,'collections/media/product-video/cover.png'),'fake image');
  await assert.rejects(loadCatalog({rootDir:dir}),/format|magic|image/);
  await rm(path.join(dir,'collections/media/product-video/cover.png'));
  await writeFile(path.join(outside,'outside.png'),Buffer.from('89504e470d0a1a0a','hex'));
  await symlink(path.join(outside,'outside.png'),path.join(dir,'collections/media/product-video/cover.png'));
  await assert.rejects(loadCatalog({rootDir:dir}),/escape|symbolic|repository|symlink/);
});

test('incomplete draft passes submission without manufactured versions but cannot preview', async t => {
  const dir=await root(t),data=await fixture();
  for (const key of ['id','revision','createdAt','updatedAt','sourceKeys','verification','review']) delete data[key];
  for (const skill of data.skills) { delete skill.entry.commit; for (const item of skill.installationItems) delete item.commit; }
  await put(dir,data);
  const rows=await loadCatalog({rootDir:dir}); assert.equal(rows[0].document.id,undefined);
  const result=await buildCatalog({rootDir:dir,preview:true}); assert.equal(result.records.length,0); assert.equal(result.incomplete.length,1);
  data.revision=null; await put(dir,data); await assert.rejects(loadCatalog({rootDir:dir}),/revision/);
});
test('test evidence must match the checked source version even if not-tested', async t => {
  const dir=await root(t),data=await fixture();
  data.verification.installationEvidence={testedAt:'2026-10-01',versions:[{repo:data.skills[0].entry.repo,commit:'a'.repeat(40)}],itemIds:[data.skills[0].id],resultRef:'report.txt',environment:'isolated temporary install'};
  await put(dir,data); await assert.rejects(loadCatalog({rootDir:dir}),/versions.*correspond/);
});
test('unchanged content cannot increase revision and changed approved revision needs fresh review', async t => {
  const base=await root(t),dir=await root(t),data=approve(await fixture()); await put(base,data);
  data.revision++; await put(dir,data); await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/revision/);
  data.description+=' edited'; data.updatedAt='2026-10-02T00:00:00Z'; await put(dir,data);
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/fresh approval/);
  data.review.reviewedAt='2026-10-02T01:00:00Z'; await put(dir,data); await loadCatalog({rootDir:dir,baseDir:base});
});
test('English overlay retains identity and installation data', async t => {
  const { serializeTranslationMarkdown } = await import('../scripts/lib/markdown.mjs');
  const dir=await root(t),data=await fixture(); await put(dir,data);
  const presentation={title:'Product video',description:'Build a product video',overview:'Coordinate product video Skills',scenarios:['Product launch'],usage:'Clarify, create, preview',skills:Object.fromEntries(data.skills.map(s=>[s.id,{summary:`Role of ${s.name}`}]))};
  await writeFile(path.join(dir,'collections',data.category,data.slug,'README.en.md'),serializeTranslationMarkdown(presentation,{id:data.id,language:'en'}));
  const records=await loadCatalog({rootDir:dir});
  assert.equal(records[0].document.localizations.en.title,'Product video');
  assert.deepEqual(records[0].document.skills,data.skills);
});
test('new CLI creates a simple pending submission, rejects overwrite and invalid parameters', async t => {
  const {execFile}=await import('node:child_process'); const {promisify}=await import('node:util'); const run=promisify(execFile);
  const dir=await root(t),cli=new URL('../scripts/catalog.mjs',import.meta.url).pathname;
  await run(process.execPath,[cli,'new','new-skill','--lang','en'],{cwd:dir});
  const before=await readFile(path.join(dir,'collections/other/new-skill/README.md'),'utf8');
  assert.doesNotMatch(before,/^---|status:|review:|verification:|license:|commit:|[a-f0-9]{8}-[a-f0-9-]{27}/m);
  const data=(await loadCatalog({rootDir:dir}))[0].document;
  assert.equal(data.id,undefined); assert.equal(data.status,'draft');
  assert.deepEqual(data.links,['https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md']);
  await assert.rejects(run(process.execPath,[cli,'new','new-skill','--lang','en'],{cwd:dir}));
  assert.equal(await readFile(path.join(dir,'collections/other/new-skill/README.md'),'utf8'),before);
  await assert.rejects(run(process.execPath,[cli,'new','../oops'],{cwd:dir}));
  await assert.rejects(run(process.execPath,[cli,'build','--publsih'],{cwd:dir}));
});
test('README failure and an escaping output parent leave old snapshot intact', async t => {
  const dir=await root(t),outside=await root(t),data=approve(await fixture()); await put(dir,data); await buildCatalog({rootDir:dir});
  const before=await readFile(path.join(dir,'dist/collections/index.json'),'utf8');
  await writeFile(path.join(dir,'README.md'),'Handwritten intro\n<!-- catalog:start -->\n');
  await assert.rejects(buildCatalog({rootDir:dir}),/markers/);
  assert.equal(await readFile(path.join(dir,'dist/collections/index.json'),'utf8'),before);
  await writeFile(path.join(dir,'README.md'),'Handwritten intro\n');
  await symlink(outside,path.join(dir,'escaped-output'));
  await assert.rejects(buildCatalog({rootDir:dir,outputDir:path.join(dir,'escaped-output/new/collections')}),/symbolic.*escape/);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(outside),['README.md','collections']);
});
test('English canonical plus Chinese overlay maps display fields without changing installation data', async t => {
  const { serializeTranslationMarkdown } = await import('../scripts/lib/markdown.mjs');
  const dir=await root(t),data=await fixture(); delete data.localizations;
  data.title='English original';
  const target=path.join(dir,'collections',data.category,data.slug); await mkdir(target,{recursive:true});
  await writeFile(path.join(target,'README.md'),serializeCollectionMarkdown(data,{language:'en'}));
  const presentation={title:'中文标题',description:'中文简介',overview:'中文概览',scenarios:['中文场景'],usage:'中文建议',skills:Object.fromEntries(data.skills.map(s=>[s.id,{summary:`用途：${s.name}`}]))};
  await writeFile(path.join(target,'README.zh.md'),serializeTranslationMarkdown(presentation,{id:data.id,language:'zh'}));
  const rows=await loadCatalog({rootDir:dir});
  assert.equal(rows[0].document.title,'中文标题'); assert.equal(rows[0].document.localizations.en.title,'English original');
  assert.equal(rows[0].document.localizations.zh,undefined);
  assert.deepEqual(rows[0].document.skills.map(s=>s.installationItems),data.skills.map(s=>s.installationItems));
});
test('pending source commits may be independently omitted without changing recorded sources', async t => {
  const dir=await root(t),data=await fixture('e3a003dc-3ea5-4cc5-b5a4-088d1b74985c');
  delete data.skills[0].entry.commit;
  await put(dir,data);
  const rows=await loadCatalog({rootDir:dir}); assert.equal(rows[0].document.skills[0].entry.commit,undefined);
});
test('draft baseline accepts content edits before maintainer revision metadata exists', async t => {
  const base=await root(t),dir=await root(t),data=await fixture();
  delete data.id; delete data.revision; delete data.createdAt; delete data.updatedAt;
  await put(base,data); data.title+=' edit'; await put(dir,data);
  await loadCatalog({rootDir:dir,baseDir:base});
});
test('baseline matches stable item IDs before nonunique display names', async t => {
  const base=await root(t),dir=await root(t),data=await fixture();
  data.skills[1].name=data.skills[0].name;
  await put(base,data); await put(dir,data);
  await loadCatalog({rootDir:dir,baseDir:base});
  const oldId=data.skills[1].id,newId='replacement-id';
  data.skills[1].id=newId;
  for (const evidence of data.provenance.evidence) evidence.supportsItemIds=evidence.supportsItemIds.map(id=>id === oldId ? newId : id);
  if (data.localizations?.en?.skills?.[oldId]) {
    data.localizations.en.skills[newId]=data.localizations.en.skills[oldId]; delete data.localizations.en.skills[oldId];
  }
  data.revision++; data.updatedAt='2026-10-02T00:00:00Z'; await put(dir,data);
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/existing item identity/);
});
test('partial English overlays preserve untouched fields per Skill and evidence ID', async t => {
  const {serializeTranslationMarkdown}=await import('../scripts/lib/markdown.mjs');
  const dir=await root(t),data=await fixture(),skillId=data.skills[0].id,evidenceId=data.provenance.evidence[0].id;
  data.localizations.en.skills[skillId]={summary:'Previous summary',role:'Preserved role'};
  data.localizations.en.provenance={evidence:{[evidenceId]:{title:'Previous evidence title',location:'Preserved location',finding:'Preserved finding'}}};
  await put(dir,data);
  const presentation={title:'Product video',description:'Build a video',overview:'A product video collection',scenarios:['Launch'],usage:'Plan and create',skills:{[skillId]:{summary:'Updated summary'}},provenance:{evidence:{[evidenceId]:{title:'Updated title'}}}};
  await writeFile(path.join(dir,'collections',data.category,data.slug,'README.en.md'),serializeTranslationMarkdown(presentation,{id:data.id,language:'en'}));
  const rows=await loadCatalog({rootDir:dir}),english=rows[0].document.localizations.en;
  assert.deepEqual(english.skills[skillId],{summary:'Updated summary',role:'Preserved role'});
  assert.deepEqual(english.provenance.evidence[evidenceId],{title:'Updated title',location:'Preserved location',finding:'Preserved finding'});
});
test('Unicode cover filenames export stable ASCII assets accepted by snapshot verification', async t => {
  const {verifySnapshot}=await import('../scripts/lib/snapshot.mjs');
  const dir=await root(t),data=approve(await fixture());
  data.cover={kind:'source-image',url:'/assets/cover.png',sourceUrl:'https://example.com/cover',alt:'Cover',rightsStatus:'verified',rightsEvidenceUrl:'https://example.com/permission'};
  await put(dir,data,'封面.PNG');
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
  await writeFile(path.join(dir,'collections',data.category,data.slug,'封面.PNG'),bytes);
  const result=await buildCatalog({rootDir:dir,sourceRevision:'a'.repeat(40)});
  assert.equal(result.records[0].cover.url,`/data/collections/assets/${data.id}/cover.png`);
  assert.equal(await readFile(path.join(result.outputDir,'assets',data.id,'cover.png')).then(b=>b.equals(bytes)),true);
  await verifySnapshot({fromDir:result.outputDir,expectedRevision:'a'.repeat(40)});
});
test('initial migration accepts a baseline without collections while current catalog remains required', async t => {
  const base=await root(t),dir=await root(t),data=await fixture();
  await rm(path.join(base,'collections'),{recursive:true}); await put(dir,data);
  const rows=await loadCatalog({rootDir:dir,baseDir:base}); assert.equal(rows.length,1);
  await rm(path.join(dir,'collections'),{recursive:true});
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/ENOENT/);
});
test('editorial curator is attributed in exported detail, index and synchronized snapshot', async t => {
  const {installSnapshot}=await import('../scripts/lib/snapshot.mjs');
  const dir=await root(t),site=await root(t),data=approve(await fixture());
  data.sourceKind='editorial-selection'; data.provenance.selectionReason='Alice selected these Skills for a complete video workflow.';
  const curator={name:'Alice',url:'https://example.com/alice'};
  const directory=path.join(dir,'collections',data.category,data.slug); await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'README.md'),serializeCollectionMarkdown(data,{language:'zh',curator}));
  const result=await buildCatalog({rootDir:dir,sourceRevision:'a'.repeat(40)});
  assert.deepEqual(result.records[0].curator,curator);
  assert.equal(result.index.collections[0].authorLabel,'Alice 整理');
  assert.equal(result.records[0].provenance.author,undefined);
  await installSnapshot({fromDir:result.outputDir,targetDir:site,expectedRevision:'a'.repeat(40)});
  const detail=JSON.parse(await readFile(path.join(site,'public/data/collections',`${data.id}.json`),'utf8'));
  assert.deepEqual(detail.curator,curator);
  await writeFile(path.join(directory,'README.md'),serializeCollectionMarkdown(data,{language:'zh',curator:'Alice'}));
  const rows=await loadCatalog({rootDir:dir}); assert.deepEqual(rows[0].document.curator,{name:'Alice'});
});
test('optional website curator requires a name, safe optional URL and supported fields', async () => {
  const {validateCollection}=await import('../scripts/lib/site-contract.mjs');
  for (const curator of [{url:'https://example.com'}, {name:'Alice',url:'https://token@example.com'}, {name:'Alice',unrecognized:true}]) {
    const data=await fixture(); data.curator=curator;
    await assert.rejects(validateCollection(data,`${data.id}.json`,'/unused'),/curator/);
  }
});
test('generated English and Chinese directories use their own presentation and preserve introductions', async t => {
  const dir=await root(t),data=await fixture(); await put(dir,data);
  const englishIntro='# English introduction\n\nHandwritten English text.\n<!-- catalog:start -->\nold\n<!-- catalog:end -->\nEnglish footer.\n';
  const chineseIntro='# 中文介绍\n\n手写中文正文。\n<!-- catalog:start -->\n旧目录\n<!-- catalog:end -->\n中文页脚。\n';
  await writeFile(path.join(dir,'README.md'),englishIntro);
  await writeFile(path.join(dir,'README.zh.md'),chineseIntro);
  await buildCatalog({rootDir:dir,preview:true});
  const en=await readFile(path.join(dir,'README.md'),'utf8'),zh=await readFile(path.join(dir,'README.zh.md'),'utf8');
  assert.match(en,new RegExp(data.localizations.en.title)); assert.match(en,new RegExp(data.localizations.en.description));
  assert.doesNotMatch(en,/[\u3400-\u9fff]/); assert.match(en,/Handwritten English text/); assert.match(en,/English footer/);
  assert.match(zh,new RegExp(data.title)); assert.match(zh,new RegExp(data.description)); assert.match(zh,/待审核/);
  assert.match(zh,/手写中文正文/); assert.match(zh,/中文页脚/); assert.doesNotMatch(zh,/pending review/);
});
test('missing translations use only a slug and localized status without creating the optional Chinese README', async t => {
  const dir=await root(t),data=await fixture(); delete data.localizations; await put(dir,data);
  await buildCatalog({rootDir:dir,preview:true});
  const english=await readFile(path.join(dir,'README.md'),'utf8');
  assert.match(english,/\[product-video\].*Translation pending/); assert.doesNotMatch(english,/[\u3400-\u9fff]/);
  await assert.rejects(readFile(path.join(dir,'README.zh.md')),/ENOENT/);
  await writeFile(path.join(dir,'README.zh.md'),'# 中文介绍\n');
  data.title='Product video'; data.description='Coordinate a product video';
  await writeFile(path.join(dir,'collections',data.category,data.slug,'README.md'),serializeCollectionMarkdown(data,{language:'en'}));
  await buildCatalog({rootDir:dir,preview:true});
  const chinese=await readFile(path.join(dir,'README.zh.md'),'utf8');
  assert.match(chinese,/\[product-video\].*待翻译/); assert.doesNotMatch(chinese,/Product video|Coordinate a product video/);
});
test('English canonical with Chinese overlay generates both page languages without altering website JSON', async t => {
  const {serializeTranslationMarkdown}=await import('../scripts/lib/markdown.mjs');
  const dir=await root(t),data=await fixture(); delete data.localizations;
  data.title='Product video'; data.description='Create a launch video';
  const directory=path.join(dir,'collections',data.category,data.slug); await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'README.md'),serializeCollectionMarkdown(data,{language:'en'}));
  const zh={title:'产品视频',description:'制作发布视频',overview:'中文概览',scenarios:['中文场景'],usage:'中文建议',skills:Object.fromEntries(data.skills.map(s=>[s.id,{summary:`用途：${s.name}`}]))};
  await writeFile(path.join(directory,'README.zh.md'),serializeTranslationMarkdown(zh,{id:data.id,language:'zh'}));
  await writeFile(path.join(dir,'README.zh.md'),'# 中文目录\n');
  const before=(await loadCatalog({rootDir:dir}))[0].document;
  const result=await buildCatalog({rootDir:dir,preview:true});
  assert.deepEqual(result.records[0],before); assert.equal(result.records[0].baseLanguage,undefined);
  const enPage=await readFile(path.join(dir,'README.md'),'utf8'),zhPage=await readFile(path.join(dir,'README.zh.md'),'utf8');
  assert.match(enPage,/Product video.*Create a launch video/); assert.doesNotMatch(enPage,/[\u3400-\u9fff]/);
  assert.match(zhPage,/产品视频.*制作发布视频/);
});
test('second README replacement failure restores the first README and previous snapshot', async t => {
  const dir=await root(t),data=await fixture(); await put(dir,data);
  await writeFile(path.join(dir,'README.zh.md'),'# 手写中文介绍\n'); await buildCatalog({rootDir:dir,preview:true});
  const beforeEn=await readFile(path.join(dir,'README.md'),'utf8'),beforeZh=await readFile(path.join(dir,'README.zh.md'),'utf8');
  const beforeSnapshot=await readFile(path.join(dir,'dist/collections/index.json'),'utf8');
  data.localizations.en.description='Updated English description'; data.description='更新后的中文简介'; await put(dir,data);
  const filesystem=(await import('node:fs/promises')).default,{syncBuiltinESMExports}=await import('node:module');
  const originalRename=filesystem.rename; let injected=false;
  t.mock.method(filesystem,'rename',async (source,destination)=>{
    if (!injected && destination === path.join(dir,'README.zh.md') && path.basename(source).startsWith('.catalog-readme-')) {
      injected=true; throw Object.assign(new Error('Injected Chinese README replacement failure'),{code:'EIO'});
    }
    return originalRename(source,destination);
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  await assert.rejects(buildCatalog({rootDir:dir,preview:true}),/Injected Chinese README replacement failure/);
  assert.equal(injected,true);
  assert.equal(await readFile(path.join(dir,'README.md'),'utf8'),beforeEn);
  assert.equal(await readFile(path.join(dir,'README.zh.md'),'utf8'),beforeZh);
  assert.equal(await readFile(path.join(dir,'dist/collections/index.json'),'utf8'),beforeSnapshot);
});
test('new CLI defaults to an English pending draft', async t => {
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const dir=await root(t),cli=new URL('../scripts/catalog.mjs',import.meta.url).pathname;
  await promisify(execFile)(process.execPath,[cli,'new','english-default'],{cwd:dir});
  const markdown=await readFile(path.join(dir,'collections/other/english-default/README.md'),'utf8');
  assert.match(markdown,/# english-default/); assert.doesNotMatch(markdown,/^---|language:/m); assert.doesNotMatch(markdown,/[\u3400-\u9fff]/);
  for (const section of ['Overview','Scenarios','Usage','Skills']) assert.match(markdown,new RegExp(`^## ${section}$`,'m'));
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.language,'en'); assert.equal(record.complete,false);
  assert.ok(record.document.overview); assert.ok(record.document.usage); assert.equal(record.document.scenarios.length,1);
});

test('partial Chinese metadata never supplies untranslated English prose to the Chinese directory', async t => {
  for (const chinese of [{tags:['中文标签']},{title:'中文局部标题'}]) {
    const dir=await root(t),data=await fixture();
    data.title='English collection'; data.description='English description';
    data.localizations={zh:chinese};
    const directory=path.join(dir,'collections',data.category,data.slug); await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'README.md'),serializeCollectionMarkdown(data,{language:'en'}));
    await writeFile(path.join(dir,'README.zh.md'),'# 中文介绍\n');
    const before=(await loadCatalog({rootDir:dir}))[0].document;
    const result=await buildCatalog({rootDir:dir,preview:true});
    assert.deepEqual(result.records[0],before);
    assert.equal(result.records[0].directoryPresentations,undefined);
    const zh=await readFile(path.join(dir,'README.zh.md'),'utf8'),en=await readFile(path.join(dir,'README.md'),'utf8');
    assert.match(zh,/\[product-video\].*待翻译/);
    assert.doesNotMatch(zh,/English collection|English description|中文局部标题/);
    assert.match(en,/English collection.*English description/);
  }
});

test('category directory derives metadata and rejects conflicts, unknown categories and flat submissions', async t => {
  const dir=await root(t),data=await fixture();
  delete data.category;
  const directory=path.join(dir,'collections','media',data.slug);
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'README.md'),serializeCollectionMarkdown(data,{language:'zh'}));
  assert.equal((await loadCatalog({rootDir:dir}))[0].document.category,'media');
  data.category='design';
  await writeFile(path.join(directory,'README.md'),serializeCollectionMarkdown(data,{language:'zh'}));
  await assert.rejects(loadCatalog({rootDir:dir}),/category.*match/);
  await rm(path.join(dir,'collections'),{recursive:true});
  await mkdir(path.join(dir,'collections','unknown'),{recursive:true});
  await assert.rejects(loadCatalog({rootDir:dir}),/category.*unknown|unknown.*category/);
  await rm(path.join(dir,'collections'),{recursive:true});
  await mkdir(path.join(dir,'collections',data.slug),{recursive:true});
  await writeFile(path.join(dir,'collections',data.slug,'README.md'),serializeCollectionMarkdown(data));
  await assert.rejects(loadCatalog({rootDir:dir}),/category/);
});
test('historical flat video baseline migrates without a revision while category changes require one', async t => {
  const base=await root(t),dir=await root(t),data=await fixture();
  const old=structuredClone(data); old.category='video';
  const directory=path.join(base,'collections',old.slug);
  await mkdir(directory); await writeFile(path.join(directory,'README.md'),serializeCollectionMarkdown(old,{language:'zh'}));
  await put(dir,data);
  await loadCatalog({rootDir:dir,baseDir:base});
  await rm(path.join(dir,'collections'),{recursive:true});
  data.category='design'; await put(dir,data);
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/revision/);
});
test('slugs are globally unique across categories and category symlinks cannot escape', async t => {
  const dir=await root(t),outside=await root(t),data=await fixture(); await put(dir,data);
  const other=structuredClone(data); other.category='design';other.id=randomUUID();other.sourceKeys=['editorial:another-source'];await put(dir,other);
  await assert.rejects(loadCatalog({rootDir:dir}),/slug.*conflict/);
  await rm(path.join(dir,'collections/design'),{recursive:true});
  await symlink(outside,path.join(dir,'collections/design'));
  await assert.rejects(loadCatalog({rootDir:dir}),/symbolic.*escape/);
});
test('new category option omits duplicate metadata and rejects cross-category duplicates and escaping symlinks', async t => {
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const run=promisify(execFile),cli=new URL('../scripts/catalog.mjs',import.meta.url).pathname;
  const dir=await root(t),outside=await root(t);
  await run(process.execPath,[cli,'new','design-draft','--category','design'],{cwd:dir});
  const source=await readFile(path.join(dir,'collections/design/design-draft/README.md'),'utf8');
  assert.doesNotMatch(source,/^category:/m);
  assert.equal((await loadCatalog({rootDir:dir}))[0].document.category,'design');
  await assert.rejects(run(process.execPath,[cli,'new','design-draft','--category','media'],{cwd:dir}),/already exists/);
  await assert.rejects(run(process.execPath,[cli,'new','unknown-draft','--category','unknown'],{cwd:dir}),/fixed category/);
  await symlink(outside,path.join(dir,'collections/media'));
  await assert.rejects(run(process.execPath,[cli,'new','escape-draft','--category','media'],{cwd:dir}),/symbolic link/);
});
test('generated directories link moved sources and show only populated category labels in their own language', async t => {
  const dir=await root(t),data=await fixture();await put(dir,data);
  await writeFile(path.join(dir,'README.zh.md'),'# 中文目录\n');
  await buildCatalog({rootDir:dir,preview:true});
  const en=await readFile(path.join(dir,'README.md'),'utf8'),zh=await readFile(path.join(dir,'README.zh.md'),'utf8');
  assert.match(en,/### Audio & Video/);assert.match(zh,/### 音视频制作/);
  assert.match(en,/\(collections\/media\/product-video\/README.md\)/);
  assert.doesNotMatch(en,/### Development|### Design/);
});
test('flat collections with a fixed-category slug are rejected now and retained in historical baselines', async t => {
  const base=await root(t),dir=await root(t),data=await fixture();data.slug='design';
  const flat=path.join(base,'collections/design');await mkdir(flat);
  await writeFile(path.join(flat,'README.md'),serializeCollectionMarkdown(data,{language:'zh'}));
  await assert.rejects(loadCatalog({rootDir:base}),/category|nested|slug directory/);
  await put(dir,data);await loadCatalog({rootDir:dir,baseDir:base});
  await rm(path.join(dir,'collections'),{recursive:true});await mkdir(path.join(dir,'collections'));
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/stable identity.*removed/);
});
test('new CLI accepts a root path alias while preserving category containment', async t => {
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const run=promisify(execFile),cli=new URL('../scripts/catalog.mjs',import.meta.url).pathname;
  const dir=await root(t),parent=await root(t),alias=path.join(parent,'root-alias');await symlink(dir,alias);
  await run(process.execPath,['--input-type=module','-e',`process.cwd=()=>${JSON.stringify(alias)};process.argv=['node','cli','new','alias-draft','--category','design'];await import(${JSON.stringify(cli)});`],{cwd:alias});
  assert.match(await readFile(path.join(dir,'collections/design/alias-draft/README.md'),'utf8'),/alias-draft/);
});

async function putSubmission(dir,{slug='useful-skills',category='other',filename='README.md',title='Useful Skills',description='A collection for everyday tasks.',overview='Choose Skills for planning, creating, and reviewing everyday work.',scenarios=['Planning a task','Reviewing the result'],usage='Choose a Skill for the current task, then review its output before continuing.',links=['https://github.com/anthropics/skills'],sourceUrl,cover}={}) {
  const directory=path.join(dir,'collections',category,slug);
  await mkdir(directory,{recursive:true});
  const sections=filename === 'README.zh.md' ? ['合集介绍','适用场景','使用建议','技能','来源'] : ['Overview','Scenarios','Usage','Skills','Source'];
  const source=`# ${title}\n\n${description}\n${cover ? `\n![${cover.alt}](${cover.url})\n` : ''}\n## ${sections[0]}\n\n${overview}\n\n## ${sections[1]}\n\n${scenarios.map(scenario=>`- ${scenario}`).join('\n')}\n\n## ${sections[2]}\n\n${usage}\n\n## ${sections[3]}\n\n${links.map(link=>`- ${link}`).join('\n')}\n${sourceUrl ? `\n## ${sections[4]}\n\n${sourceUrl}\n` : ''}`;
  const file=path.join(directory,filename);
  await writeFile(file,source);
  return file;
}
test('copyable plain submission validates mixed repository, directory and single Skill links without publication metadata', async t => {
  const dir=await root(t);
  const links=['https://github.com/anthropics/skills','https://github.com/anthropics/skills/tree/main/skills','https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md'];
  const file=await putSubmission(dir,{links,sourceUrl:'https://example.com/article'});
  const result=await validateCatalog({rootDir:dir,mode:'production'}),record=result.records[0];
  assert.equal(result.count,1); assert.deepEqual(result.incomplete,[file]);
  assert.equal(record.kind,'submission'); assert.equal(record.complete,false);
  assert.deepEqual(record.document,{slug:'useful-skills',category:'other',title:'Useful Skills',description:'A collection for everyday tasks.',overview:'Choose Skills for planning, creating, and reviewing everyday work.',scenarios:['Planning a task','Reviewing the result'],usage:'Choose a Skill for the current task, then review its output before continuing.',status:'draft',skills:[],links,sourceUrl:'https://example.com/article'});
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const cli=new URL('../scripts/catalog.mjs',import.meta.url).pathname;
  const {stdout}=await promisify(execFile)(process.execPath,[cli,'validate','--publish'],{cwd:dir});
  assert.match(stdout,/Validated 1 collections.*1 drafts/);
});
test('Chinese-only submission is canonical and browsable while both website exports skip it', async t => {
  const dir=await root(t);
  await writeFile(path.join(dir,'README.zh.md'),'# 中文目录\n');
  const presentation={title:'实用技能',description:'处理日常任务的技能合集。',overview:'按任务选择规划、创建和审查所需的技能。',scenarios:['规划任务','审查结果'],usage:'先选择适合当前任务的技能，检查结果后再继续。'};
  const file=await putSubmission(dir,{filename:'README.zh.md',...presentation});
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.file,file); assert.equal(record.language,'zh');
  assert.deepEqual(record.directoryPresentations.zh,presentation);
  for (const [field,value] of Object.entries(presentation)) assert.deepEqual(record.document[field],value);
  for (const preview of [false,true]) {
    const result=await buildCatalog({rootDir:dir,preview});
    assert.deepEqual(result.records,[]); assert.deepEqual(result.index.collections,[]); assert.deepEqual(result.incomplete,[file]);
  }
  assert.match(await readFile(path.join(dir,'README.zh.md'),'utf8'),/\[实用技能\]\(collections\/other\/useful-skills\/README.zh.md\).*处理日常任务.*待审核/);
  assert.match(await readFile(path.join(dir,'README.md'),'utf8'),/\[useful-skills\].*Translation pending.*pending review/);
});
test('two lightweight language files retain their own presentation and agree on normalized links and attribution', async t => {
  const dir=await root(t);
  const en={title:'Useful Skills',description:'A collection for everyday tasks.',overview:'Choose Skills for planning, creating, and reviewing everyday work.',scenarios:['Planning a task','Reviewing the result'],usage:'Choose a Skill for the current task, then review its output before continuing.'};
  const zh={title:'实用技能',description:'处理日常任务。',overview:'用于规划任务和检查结果的技能。',scenarios:['规划任务','检查结果','团队协作'],usage:'先规划任务，再创建内容，最后检查结果。'};
  await putSubmission(dir,{links:['https://github.com/Anthropics/Skills/?tab=readme'],sourceUrl:'https://example.com/article'});
  await putSubmission(dir,{filename:'README.zh.md',...zh,links:['https://github.com/anthropics/skills'],sourceUrl:'https://example.com/article'});
  await writeFile(path.join(dir,'README.zh.md'),'# 中文目录\n');
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.language,'en'); assert.equal(record.document.title,'Useful Skills');
  assert.deepEqual(record.directoryPresentations,{en,zh});
  for (const [field,value] of Object.entries(en)) assert.deepEqual(record.document[field],value);
  await buildCatalog({rootDir:dir,preview:true});
  assert.match(await readFile(path.join(dir,'README.md'),'utf8'),/Useful Skills.*A collection for everyday tasks/);
  assert.match(await readFile(path.join(dir,'README.zh.md'),'utf8'),/实用技能.*处理日常任务/);
  assert.match(await readFile(path.join(dir,'README.md'),'utf8'),/collections\/other\/useful-skills\/README.md/);
  assert.match(await readFile(path.join(dir,'README.zh.md'),'utf8'),/collections\/other\/useful-skills\/README.zh.md/);
});
test('submission detail prose and five ordered scenarios survive catalog validation in either language', async t => {
  for (const [filename,presentation] of [
    ['README.md',{title:'Engineering workflow',description:'Use Skills across a development task.',overview:'Combine **planning**, implementation, and review Skills from the linked directories.',scenarios:['Clarify requirements','Explore alternatives','Implement a change','Review the change','Maintain the project'],usage:'Start with planning, then choose the Skill for the current stage. Review each result before continuing.'}],
    ['README.zh.md',{title:'工程协作',description:'用技能配合完成开发任务。',overview:'组合链接目录中的**规划**、实现和审查技能。',scenarios:['澄清需求','探索方案','实现改动','审查改动','维护项目'],usage:'先规划任务，再按阶段选择技能；检查每次结果后继续。'}],
  ]) {
    const dir=await root(t);
    await putSubmission(dir,{filename,...presentation});
    const result=await validateCatalog({rootDir:dir,mode:'production'}),record=result.records[0];
    for (const [field,value] of Object.entries(presentation)) assert.deepEqual(record.document[field],value);
    assert.deepEqual(record.directoryPresentations[record.language],presentation);
    assert.equal(record.kind,'submission'); assert.equal(record.complete,false); assert.equal(result.incomplete.length,1);
    assert.deepEqual(record.document.skills,[]); assert.equal(record.document.review,undefined); assert.equal(record.document.verification,undefined);
  }
});
test('lightweight translations cannot change Skill links or source attribution', async t => {
  const dir=await root(t); await putSubmission(dir,{sourceUrl:'https://example.com/article'});
  await putSubmission(dir,{filename:'README.zh.md',links:['https://github.com/obra/superpowers'],sourceUrl:'https://example.com/article'});
  await assert.rejects(loadCatalog({rootDir:dir}),/README.zh.md.*links.*match/);
  await putSubmission(dir,{filename:'README.zh.md',sourceUrl:'https://example.com/different'});
  await assert.rejects(loadCatalog({rootDir:dir}),/README.zh.md.*source.*match/);
  await putSubmission(dir,{filename:'README.zh.md'});
  await assert.rejects(loadCatalog({rootDir:dir}),/README.zh.md.*source.*match/);
});
test('lightweight baseline updates need no machine metadata but still preserve their slug', async t => {
  const base=await root(t),dir=await root(t);
  const detail={overview:'Discuss a design before building it.',scenarios:['Design exploration'],usage:'Describe the audience, then discuss the alternatives.'};
  await putSubmission(base); await putSubmission(dir,{category:'design',title:'Updated selection',description:'Updated task.',...detail,links:['https://github.com/obra/superpowers']});
  const [record]=await loadCatalog({rootDir:dir,baseDir:base});
  assert.equal(record.document.revision,undefined); assert.equal(record.document.id,undefined);
  for (const [field,value] of Object.entries(detail)) assert.deepEqual(record.document[field],value);
  await rm(path.join(dir,'collections/design/useful-skills'),{recursive:true});
  await putSubmission(dir,{slug:'different-slug'});
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/stable identity.*removed/);
});
test('lightweight submissions cannot replace complete baseline identities', async t => {
  const base=await root(t),dir=await root(t),data=await fixture(); await put(base,data);
  await putSubmission(dir,{slug:data.slug,category:data.category});
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/stable identity.*removed/);
});
test('complete Chinese canonical file skips itself when reading English presentation overlays', async t => {
  const {serializeTranslationMarkdown}=await import('../scripts/lib/markdown.mjs');
  const dir=await root(t),data=await fixture(); delete data.localizations;
  const directory=path.join(dir,'collections',data.category,data.slug); await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'README.zh.md'),serializeCollectionMarkdown(data,{language:'zh'}));
  const presentation={title:'Product video',description:'Create a product video',overview:'Plan the video',scenarios:['Product launch'],usage:'Create and preview',skills:Object.fromEntries(data.skills.map(skill=>[skill.id,{summary:`Role of ${skill.name}`}]))};
  await writeFile(path.join(directory,'README.en.md'),serializeTranslationMarkdown(presentation,{id:data.id,language:'en'}));
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.complete,true); assert.equal(record.language,'zh');
  assert.deepEqual(record.document.skills,data.skills); assert.equal(record.document.localizations.en.title,'Product video');
});
test('lightweight slugs remain globally unique and Chinese flat paths are rejected', async t => {
  const dir=await root(t); await putSubmission(dir); await putSubmission(dir,{category:'design'});
  await assert.rejects(loadCatalog({rootDir:dir}),/slug.*conflict/);
  const base=await root(t),flat=path.join(base,'collections','useful-skills'); await mkdir(flat);
  await writeFile(path.join(flat,'README.zh.md'),'# 实用技能\n\n处理日常任务。\n\n## Skills\n\n- https://github.com/anthropics/skills\n');
  await assert.rejects(loadCatalog({rootDir:base}),/category|nested/);
});
test('plain validation preserves complete exports and never manufactures approval', async t => {
  const dir=await root(t),data=approve(await fixture()); await put(dir,data); await putSubmission(dir);
  const before=(await loadCatalog({rootDir:dir})).find(record=>record.document.id === data.id).document;
  for (const preview of [false,true]) {
    const result=await buildCatalog({rootDir:dir,preview});
    assert.deepEqual(result.records,[before]); assert.equal(result.incomplete.length,1);
    const exported=JSON.parse(await readFile(path.join(dir,'dist/collections',`${data.id}.json`),'utf8'));
    assert.deepEqual(exported,before);
  }
  const pending=(await loadCatalog({rootDir:dir})).find(record=>record.kind === 'submission').document;
  assert.equal(pending.review,undefined); assert.equal(pending.verification,undefined);
});
test('new Chinese CLI writes only README.zh.md and reports example replacement without inventing identities', async t => {
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const dir=await root(t),cli=new URL('../scripts/catalog.mjs',import.meta.url).pathname;
  const {stdout}=await promisify(execFile)(process.execPath,[cli,'new','chinese-submission','--lang','zh'],{cwd:dir});
  const source=await readFile(path.join(dir,'collections/other/chinese-submission/README.zh.md'),'utf8');
  await assert.rejects(readFile(path.join(dir,'collections/other/chinese-submission/README.md')),/ENOENT/);
  assert.doesNotMatch(source,/^---|review:|license:|commit:/m);
  for (const section of ['合集介绍','适用场景','使用建议','技能']) assert.match(source,new RegExp(`^## ${section}$`,'m'));
  assert.doesNotMatch(source,/^## (Overview|Scenarios|Usage|Skills)$/m);
  assert.match(source,/brainstorming\/SKILL.md/); assert.match(stdout,/替换示例链接后提交PR/);
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.language,'zh'); assert.equal(record.complete,false);
  assert.ok(record.document.overview); assert.ok(record.document.usage); assert.equal(record.document.scenarios.length,1);
});
test('new CLI allows a category name as a slug but preserves same-named historical flat collections', async t => {
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const run=promisify(execFile),cli=new URL('../scripts/catalog.mjs',import.meta.url).pathname;
  const dir=await root(t); await mkdir(path.join(dir,'collections/design'));
  await run(process.execPath,[cli,'new','design','--category','other'],{cwd:dir});
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.document.slug,'design'); assert.equal(record.document.category,'other');
  await assert.rejects(run(process.execPath,[cli,'new','design','--category','media'],{cwd:dir}),/already exists/);
  for (const filename of ['README.md','README.zh.md']) {
    const legacy=await root(t),flat=path.join(legacy,'collections/design'); await mkdir(flat);
    await writeFile(path.join(flat,filename),'# Historical collection\n');
    await assert.rejects(run(process.execPath,[cli,'new','design','--category','other'],{cwd:legacy}),/already exists/);
    await assert.rejects(readFile(path.join(legacy,'collections/other/design/README.md')),/ENOENT/);
    assert.equal(await readFile(path.join(flat,filename),'utf8'),'# Historical collection\n');
  }
});

function detailPresentation(data) {
  return Object.fromEntries(['title','description','overview','scenarios','usage'].map(field=>[field,data[field]]));
}
function installationLinks(data) {
  return [...new Set(data.skills.flatMap(skill=>skill.installationItems.map(item=>`https://github.com/${item.repo}/blob/${item.commit}/${item.directory === '.' ? '' : `${item.directory}/`}SKILL.md`)))];
}
async function putMaintainerRecord(dir,data,{filename='record.zh.md',language='zh',coverFile}={}) {
  const directory=path.join(dir,'collections',data.category,data.slug);
  await mkdir(directory,{recursive:true});
  const file=path.join(directory,filename);
  await writeFile(file,serializeCollectionMarkdown(data,{language,coverFile}));
  return file;
}
async function putPublicReadmes(dir,data,{links=installationLinks(data),cover,en={},zh={}}={}) {
  const common={slug:data.slug,category:data.category,links,cover};
  await putSubmission(dir,{...common,...detailPresentation(data.localizations.en),...en});
  await putSubmission(dir,{...common,filename:'README.zh.md',...detailPresentation(data),...zh});
}
test('public READMEs override their language display fields while the maintainer record preserves full data and identity', async t => {
  const dir=await root(t),data=approve(await fixture()),original=structuredClone(data);
  const recordFile=await putMaintainerRecord(dir,data);
  const en={title:'Video workflow',overview:'Use the linked Skills to plan, make, and refine a video.'},zh={description:'用技能配合制作视频。',usage:'先讨论目标，再制作视频并预览。'};
  await putPublicReadmes(dir,data,{en,zh});
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.file,recordFile); assert.equal(record.complete,true); assert.notEqual(record.kind,'submission');
  for (const field of ['id','revision','sourceKeys','status','skills','review','verification','provenance','cover']) assert.deepEqual(record.document[field],original[field]);
  for (const [field,value] of Object.entries({...detailPresentation(data),...zh})) assert.deepEqual(record.document[field],value);
  assert.deepEqual(record.document.localizations.en,{...original.localizations.en,...en});
  assert.deepEqual(record.directoryPresentations.en,{...detailPresentation(data.localizations.en),...en});
  assert.deepEqual(record.directoryPresentations.zh,{...detailPresentation(data),...zh});
  await writeFile(path.join(dir,'README.zh.md'),'# 中文目录\n');
  for (const preview of [false,true]) {
    const result=await buildCatalog({rootDir:dir,preview});
    assert.equal(result.records.length,1); assert.equal(result.index.collections[0].itemCount,3); assert.equal(result.index.collections[0].installationCount,14);
  }
  assert.match(await readFile(path.join(dir,'README.md'),'utf8'),/collections\/media\/product-video\/README.md/);
  assert.match(await readFile(path.join(dir,'README.zh.md'),'utf8'),/collections\/media\/product-video\/README.zh.md/);
  assert.doesNotMatch(await readFile(path.join(dir,'README.md'),'utf8'),/record.zh.md/);
});
test('unchanged public display can move beside a record without bypassing later baseline revision checks', async t => {
  const base=await root(t),dir=await root(t),data=await fixture(); await put(base,data);
  const before=(await loadCatalog({rootDir:base}))[0].document;
  await putMaintainerRecord(dir,data); await putPublicReadmes(dir,data);
  assert.deepEqual((await loadCatalog({rootDir:dir,baseDir:base}))[0].document,before);
  await putPublicReadmes(dir,data,{en:{description:'Changed public description.'}});
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/revision/);
  data.revision+=1; data.updatedAt='2026-10-02T10:00:00Z'; await putMaintainerRecord(dir,data);
  const [updated]=await loadCatalog({rootDir:dir,baseDir:base}); assert.equal(updated.document.localizations.en.description,'Changed public description.');
});
test('English maintainer records normalize a new Chinese public README without losing English item presentation or machine data', async t => {
  const dir=await root(t),data=await fixture(),zh=detailPresentation(data),en=structuredClone(data.localizations.en);
  Object.assign(data,detailPresentation(en));
  for (const skill of data.skills) Object.assign(skill,en.skills[skill.id]);
  delete data.localizations;
  const original=structuredClone(data);
  await putMaintainerRecord(dir,data,{filename:'record.md',language:'en'});
  const common={slug:data.slug,category:data.category,links:installationLinks(data)};
  await putSubmission(dir,{...common,...detailPresentation(en)});
  assert.equal((await loadCatalog({rootDir:dir}))[0].complete,true);
  await putSubmission(dir,{...common,filename:'README.zh.md',...zh});
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.complete,true); assert.equal(record.language,'en'); assert.equal(record.baseLanguage,'zh');
  for (const [field,value] of Object.entries(zh)) assert.deepEqual(record.document[field],value);
  for (const [field,value] of Object.entries(detailPresentation(en))) assert.deepEqual(record.document.localizations.en[field],value);
  assert.deepEqual(record.document.localizations.en.skills,Object.fromEntries(original.skills.map(skill=>[skill.id,{summary:skill.summary,role:skill.role}])));
  assert.equal(record.document.localizations.zh,undefined);
  for (const field of ['id','revision','skills','review','verification','provenance','cover']) assert.deepEqual(record.document[field],original[field]);
});
test('public links cover recorded installation directories exactly and reject missing, added, widened, or wrong-version scope', async t => {
  const dir=await root(t),data=await fixture(); await putMaintainerRecord(dir,data);
  const links=installationLinks(data);
  for (const changed of [links.slice(1),[...links,'https://github.com/anthropics/skills'],links.map((link,index)=>index === 0 ? link.replace(data.skills[0].entry.commit,'f'.repeat(40)) : link)]) {
    await putPublicReadmes(dir,data,{links:changed});
    await assert.rejects(loadCatalog({rootDir:dir}),/links.*(scope|installation|commit|version|cover|match)/i);
  }
  const remotion=data.skills[1].entry;
  const bundled=[links[0],`https://github.com/${remotion.repo}/tree/${remotion.commit}/skills`,links.at(-1)];
  await putPublicReadmes(dir,data,{links:bundled});
  assert.equal((await loadCatalog({rootDir:dir}))[0].document.skills[1].installationItems.length,12);
  await putPublicReadmes(dir,data,{links:bundled.map((link,index)=>index === 1 ? `https://github.com/${remotion.repo}` : link)});
  await assert.rejects(loadCatalog({rootDir:dir}),/links.*(scope|installation|directory|match)/i);
});
test('declared repository groups prevent public links from widening engineering into other directories', async t => {
  const dir=await root(t),data=await fixture('d2ca0659-07ee-44a5-8d99-d3295f5e2f0c');
  const scope=data.provenance.repositoryScope;
  await putMaintainerRecord(dir,data);
  const links=scope.directories.map(directory=>`https://github.com/${scope.repo}/tree/${scope.commit}/${directory}`);
  await putPublicReadmes(dir,data,{links}); assert.equal((await loadCatalog({rootDir:dir}))[0].document.skills.length,31);
  await putPublicReadmes(dir,data,{links:[`https://github.com/${scope.repo}/tree/${scope.commit}/skills`]});
  await assert.rejects(loadCatalog({rootDir:dir}),/links.*scope/i);
});
test('record files cannot be duplicated, escape the repository, or silently replace public Markdown', async t => {
  const dir=await root(t),outside=await root(t),data=await fixture();
  const file=await putMaintainerRecord(dir,data); await putPublicReadmes(dir,data);
  await putMaintainerRecord(dir,data,{filename:'record.md',language:'en'});
  await assert.rejects(loadCatalog({rootDir:dir}),/record.*(one|multiple|duplicate|ambiguous)/i);
  await rm(path.join(path.dirname(file),'record.md')); await rm(file);
  const external=path.join(outside,'record.zh.md'); await writeFile(external,serializeCollectionMarkdown(data,{language:'zh'})); await symlink(external,file);
  await assert.rejects(loadCatalog({rootDir:dir}),/escape|symbolic/);
  await rm(file); await putMaintainerRecord(dir,data);
  await put(dir,data);
  await assert.rejects(loadCatalog({rootDir:dir}),/README.md.*(simple|plain|contribution|public)/i);
});
test('optional public covers are checked inside each collection and bilingual URLs agree while alt text translates', async t => {
  const dir=await root(t),data=await fixture(),cover={url:'cover.png',alt:'Video concept cover'};
  data.cover={kind:'source-image',url:'/assets/cover.png',sourceUrl:'https://example.com/source',alt:'Cover',rightsStatus:'needs-review'};
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
  const file=await putMaintainerRecord(dir,data,{coverFile:'cover.png'}); await putPublicReadmes(dir,data,{cover,zh:{cover:{...cover,alt:'视频概念封面'}}});
  await assert.rejects(loadCatalog({rootDir:dir}),/cover|ENOENT/);
  await writeFile(path.join(path.dirname(file),'cover.png'),bytes);
  const [record]=await loadCatalog({rootDir:dir}); assert.equal(record.document.cover.url,`/data/collections/assets/${data.id}/cover.png`); assert.equal(record.complete,true);
  await putPublicReadmes(dir,data);
  assert.equal((await loadCatalog({rootDir:dir}))[0].complete,true);
  await putPublicReadmes(dir,data,{cover,zh:{cover:{url:'different.png',alt:'另一张图'}}});
  await assert.rejects(loadCatalog({rootDir:dir}),/cover.*match|ENOENT/);
  await putPublicReadmes(dir,data,{cover});
  const sibling=path.join(dir,'collections/media/sibling'); await mkdir(sibling); await writeFile(path.join(sibling,'cover.png'),'other');
  await rm(path.join(path.dirname(file),'cover.png')); await symlink(path.join(sibling,'cover.png'),path.join(path.dirname(file),'cover.png'));
  await assert.rejects(loadCatalog({rootDir:dir}),/cover.*(escape|collection)|symbolic.*escape/);
});
test('simple drafts retain visible covers and reject missing files or collection escapes without gaining publication metadata', async t => {
  const dir=await root(t),cover={url:'cover.png',alt:'Useful Skills cover'};
  const file=await putSubmission(dir,{cover});
  await assert.rejects(loadCatalog({rootDir:dir}),/cover|ENOENT/);
  await writeFile(path.join(path.dirname(file),'cover.png'),'visible cover');
  const [record]=await loadCatalog({rootDir:dir});
  assert.deepEqual(record.document.cover,cover); assert.equal(record.complete,false); assert.equal(record.document.id,undefined);
  const outside=await root(t); await writeFile(path.join(outside,'cover.png'),'outside'); await rm(path.join(path.dirname(file),'cover.png')); await symlink(path.join(outside,'cover.png'),path.join(path.dirname(file),'cover.png'));
  await assert.rejects(loadCatalog({rootDir:dir}),/escape|symbolic/);
  await putSubmission(dir,{cover:{url:'https://example.com/cover.png',alt:'Remote cover'}});
  assert.deepEqual((await loadCatalog({rootDir:dir}))[0].document.cover,{url:'https://example.com/cover.png',alt:'Remote cover'});
});
test('safe encoded public cover URLs resolve to their actual Unicode or space-containing local filenames', async t => {
  for (const url of ['images/caf%C3%A9.png','images/my%20cover.png']) {
    const dir=await root(t),cover={url,alt:'Local cover'},file=await putSubmission(dir,{cover});
    await mkdir(path.join(path.dirname(file),'images'));
    await writeFile(path.join(path.dirname(file),decodeURIComponent(url)),'visible cover');
    assert.deepEqual((await loadCatalog({rootDir:dir}))[0].document.cover,cover);
  }
});
function systemMetadata(data,{language='zh',coverFile}={}) {
  const document=structuredClone(data);
  for (const field of ['title','description','overview','scenarios','usage']) {
    delete document[field];
    for (const presentation of Object.values(document.localizations ?? {})) delete presentation[field];
  }
  return {language,document,...(coverFile !== undefined ? {coverFile}:{})};
}
async function putSystemMetadata(dir,data,options) {
  const directory=path.join(dir,'.catalog'); await mkdir(directory,{recursive:true});
  const file=path.join(directory,`${data.slug}.json`);
  await writeFile(file,JSON.stringify(systemMetadata(data,options),null,2));
  return file;
}
test('internal metadata restores the complete document only from public display fields without duplicate record files', async t => {
  const base=await root(t),dir=await root(t),data=approve(await fixture()); await put(base,data);
  const expected=(await loadCatalog({rootDir:base}))[0].document;
  const file=await putSystemMetadata(dir,data); await putPublicReadmes(dir,data);
  const [record]=await loadCatalog({rootDir:dir,baseDir:base});
  assert.equal(record.file,file); assert.equal(record.complete,true); assert.deepEqual(record.document,expected);
  await writeFile(path.join(dir,'README.zh.md'),'# 中文目录\n');
  const result=await buildCatalog({rootDir:dir});
  assert.equal(result.records.length,1); assert.deepEqual(result.records[0],expected);
  assert.equal(result.index.collections[0].itemCount,3); assert.equal(result.index.collections[0].installationCount,14);
  assert.match(await readFile(path.join(dir,'README.md'),'utf8'),/collections\/media\/product-video\/README.md/);
  assert.match(await readFile(path.join(dir,'README.zh.md'),'utf8'),/collections\/media\/product-video\/README.zh.md/);
  assert.doesNotMatch(await readFile(path.join(dir,'README.md'),'utf8'),/\.catalog|record.zh.md/);
  await putPublicReadmes(dir,data,{zh:{description:'新的公开简介。'}});
  await assert.rejects(loadCatalog({rootDir:dir,baseDir:base}),/revision/);
});
test('internal metadata rejects duplicate display prose at the document and every localized presentation', async t => {
  const dir=await root(t),data=await fixture(); await putPublicReadmes(dir,data);
  const file=await putSystemMetadata(dir,data);
  for (const field of ['title','description','overview','scenarios','usage']) for (const language of [null,'en','zh']) {
    const metadata=systemMetadata(data);
    if (language) {metadata.document.localizations??={};metadata.document.localizations[language]??={};metadata.document.localizations[language][field]=field === 'scenarios' ? ['Duplicate'] : 'Duplicate';}
    else metadata.document[field]=field === 'scenarios' ? ['Duplicate'] : 'Duplicate';
    await writeFile(file,JSON.stringify(metadata));
    await assert.rejects(loadCatalog({rootDir:dir}),new RegExp(`metadata.*${field}.*(README|display|source)`,'i'));
  }
});
test('internal metadata wrappers strictly validate keys, language, document, slug and machine fields', async t => {
  const dir=await root(t),data=await fixture(); await putPublicReadmes(dir,data);
  const file=await putSystemMetadata(dir,data);
  for (const changed of [null,[],{...systemMetadata(data),extra:true},{...systemMetadata(data),language:'fr'},{language:'zh',document:[]},{...systemMetadata(data),document:{...systemMetadata(data).document,slug:'wrong-slug'}},{...systemMetadata(data),document:{...systemMetadata(data).document,unknown:true}},{...systemMetadata(data),document:{...systemMetadata(data).document,revision:'bad'}}]) {
    await writeFile(file,JSON.stringify(changed));
    await assert.rejects(loadCatalog({rootDir:dir}),/metadata|revision|slug|unknown|supported/i);
  }
  await writeFile(file,'{ invalid'); await assert.rejects(loadCatalog({rootDir:dir}),/metadata.*JSON|JSON.*metadata/i);
});
test('internal metadata cannot coexist with old record files or a full public README', async t => {
  const dir=await root(t),data=await fixture(); await putSystemMetadata(dir,data); await putPublicReadmes(dir,data);
  const old=await putMaintainerRecord(dir,data);
  await assert.rejects(loadCatalog({rootDir:dir}),/metadata.*(record|ambiguous|coexist)/i);
  await rm(old); await put(dir,data);
  await assert.rejects(loadCatalog({rootDir:dir}),/metadata.*(README|ambiguous|coexist)/i);
});
test('orphan internal metadata rejects removed collections even when historical baselines lack a collections directory', async t => {
  const dir=await root(t),data=await fixture(); await putSystemMetadata(dir,data);
  await assert.rejects(loadCatalog({rootDir:dir}),/metadata.*(orphan|collection|match)/i);
  const base=await root(t),current=await root(t); await putSystemMetadata(base,data); await rm(path.join(base,'collections'),{recursive:true});
  await assert.rejects(loadCatalog({rootDir:current,baseDir:base}),/metadata.*(orphan|collection|match)/i);
});
test('internal metadata directories and JSON symlinks cannot escape the repository', async t => {
  const dir=await root(t),outside=await root(t),data=await fixture(); await putPublicReadmes(dir,data);
  const external=await putSystemMetadata(outside,data); await symlink(path.dirname(external),path.join(dir,'.catalog'));
  await assert.rejects(loadCatalog({rootDir:dir}),/metadata.*escape|symbolic.*escape/i);
  await rm(path.join(dir,'.catalog')); await mkdir(path.join(dir,'.catalog')); await symlink(external,path.join(dir,'.catalog',`${data.slug}.json`));
  await assert.rejects(loadCatalog({rootDir:dir}),/metadata.*escape|symbolic.*escape/i);
});
test('internal metadata requires the public README for its stripped base language', async t => {
  for (const language of ['en','zh']) {
    const dir=await root(t),data=await fixture(); await putSystemMetadata(dir,data,{language}); await putPublicReadmes(dir,data);
    const missing=language === 'en' ? 'README.md' : 'README.zh.md';
    await rm(path.join(dir,'collections',data.category,data.slug,missing));
    await assert.rejects(loadCatalog({rootDir:dir}),new RegExp(`metadata.*${missing.replaceAll('.','\\.')}.*(required|missing)|${missing.replaceAll('.','\\.')}.*metadata`,'i'));
  }
});
test('internal metadata keeps archived source images in the collection and rejects unsafe coverFile paths', async t => {
  const dir=await root(t),data=await fixture(),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
  data.cover={kind:'source-image',url:'/assets/cover.png',sourceUrl:'https://example.com/source',alt:'Cover',rightsStatus:'needs-review'};
  await putSystemMetadata(dir,data,{coverFile:'cover.png'}); await putPublicReadmes(dir,data);
  const directory=path.join(dir,'collections',data.category,data.slug); await writeFile(path.join(directory,'cover.png'),bytes);
  const [record]=await loadCatalog({rootDir:dir}); assert.equal(record.complete,true); assert.ok(record.asset.bytes.equals(bytes)); assert.equal(record.document.cover.url,`/data/collections/assets/${data.id}/cover.png`);
  await putSystemMetadata(dir,data,{coverFile:'../cover.png'}); await assert.rejects(loadCatalog({rootDir:dir}),/cover.*safe|cover.*path/i);
  await putSystemMetadata(dir,data,{coverFile:'cover.png'}); await rm(path.join(directory,'cover.png'));
  const sibling=path.join(dir,'collections/media/sibling'); await mkdir(sibling); await writeFile(path.join(sibling,'cover.png'),bytes); await symlink(path.join(sibling,'cover.png'),path.join(directory,'cover.png'));
  await assert.rejects(loadCatalog({rootDir:dir}),/cover.*escape|symbolic.*escape/i);
});
test('archived local covers cannot differ from the cover shown in public READMEs', async t => {
  for (const metadata of [false,true]) {
    const dir=await root(t),data=approve(await fixture()),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
    data.cover={kind:'source-image',url:'/assets/cover.png',sourceUrl:'https://example.com/source',alt:'Cover',rightsStatus:'needs-review'};
    if (metadata) await putSystemMetadata(dir,data,{coverFile:'cover.png'});
    else await putMaintainerRecord(dir,data,{coverFile:'cover.png'});
    await putPublicReadmes(dir,data,{cover:{url:'new-cover.png',alt:'New cover'}});
    const directory=path.join(dir,'collections',data.category,data.slug);
    await writeFile(path.join(directory,'cover.png'),bytes);
    await writeFile(path.join(directory,'new-cover.png'),bytes);
    await assert.rejects(loadCatalog({rootDir:dir,mode:'production'}),/cover.file.*match.*local cover/i);
  }
});
test('complete records cannot show a local public cover without an archived coverFile', async t => {
  for (const metadata of [false,true]) {
    const dir=await root(t),data=await fixture();
    if (metadata) await putSystemMetadata(dir,data);
    else await putMaintainerRecord(dir,data);
    await putPublicReadmes(dir,data,{cover:{url:'cover.png',alt:'Local cover'}});
    await writeFile(path.join(dir,'collections',data.category,data.slug,'cover.png'),'visible cover');
    await assert.rejects(loadCatalog({rootDir:dir}),/cover.file.*local cover/i);
  }
});
test('archived local covers match normalized public image paths and retain legacy imports without public READMEs', async t => {
  for (const coverFile of ['images/café.png','images/my cover.png']) {
    const dir=await root(t),data=await fixture(),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
    data.cover={kind:'source-image',url:'/assets/cover.png',sourceUrl:'https://example.com/source',alt:'Cover',rightsStatus:'needs-review'};
    await putSystemMetadata(dir,data,{coverFile});
    const url=coverFile.split('/').map(encodeURIComponent).join('/');
    await putPublicReadmes(dir,data,{cover:{url,alt:'Local cover'}});
    const directory=path.join(dir,'collections',data.category,data.slug);
    await mkdir(path.join(directory,'images'));
    await writeFile(path.join(directory,coverFile),bytes);
    const [record]=await loadCatalog({rootDir:dir});
    assert.equal(record.complete,true); assert.ok(record.asset.bytes.equals(bytes));
  }
  const dir=await root(t),data=await fixture(),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
  data.cover={kind:'source-image',url:'/assets/cover.png',sourceUrl:'https://example.com/source',alt:'Cover',rightsStatus:'needs-review'};
  await put(dir,data,'cover.png');
  await writeFile(path.join(dir,'collections',data.category,data.slug,'cover.png'),bytes);
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.complete,true); assert.ok(record.asset.bytes.equals(bytes));
});
test('HTTPS source covers match public READMEs after URL normalization without archiving or changing evidence', async t => {
  const dir=await root(t),data=approve(await fixture());
  data.cover={kind:'source-image',url:'HTTPS://IMAGES.EXAMPLE.COM:443/covers/video.png',sourceUrl:'https://example.com/author',alt:'Author cover',rightsStatus:'needs-review'};
  await putSystemMetadata(dir,data); await putPublicReadmes(dir,data,{cover:{url:'https://images.example.com/covers/video.png',alt:'Author cover'}});
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.complete,true); assert.equal(record.asset,undefined);
  assert.deepEqual(record.document.cover,{...data.cover,url:'https://images.example.com/covers/video.png'});
  assert.deepEqual(record.document.verification,data.verification);
  const result=await buildCatalog({rootDir:dir,sourceRevision:'a'.repeat(40)});
  assert.equal(result.records.length,1);
  assert.equal(result.index.collections[0].cover.url,'https://images.example.com/covers/video.png');
  assert.equal(result.manifest.files.some(file=>file.path.startsWith('assets/')),false);
});
test('complete records cannot ignore a public HTTPS cover by keeping a concept cover', async t => {
  for (const metadata of [false,true]) {
    const dir=await root(t),data=approve(await fixture()),url='https://images.example.com/cover.png';
    if (metadata) await putSystemMetadata(dir,data);
    else await putMaintainerRecord(dir,data);
    await putPublicReadmes(dir,data,{cover:{url,alt:'Author cover'}});
    await assert.rejects(loadCatalog({rootDir:dir,mode:'production'}),/cover.kind.*source-image/i);
    data.cover={kind:'source-image',url,sourceUrl:'https://example.com/author',alt:'Author cover',rightsStatus:'needs-review'};
    if (metadata) await putSystemMetadata(dir,data);
    else await putMaintainerRecord(dir,data);
    const [record]=await loadCatalog({rootDir:dir,mode:'production'});
    assert.equal(record.complete,true); assert.equal(record.asset,undefined);
    assert.equal(record.document.cover.kind,'source-image'); assert.equal(record.document.cover.url,url);
  }
});
test('external source-image metadata requires the same visible HTTPS cover in public READMEs', async t => {
  for (const cover of [undefined,{url:'https://images.example.com/other.png',alt:'Other cover'},{url:'cover.png',alt:'Archived cover'}]) {
    const dir=await root(t),data=await fixture();
    data.cover={kind:'source-image',url:'https://images.example.com/cover.png',sourceUrl:'https://example.com/author',alt:'Author cover',rightsStatus:'needs-review'};
    await putSystemMetadata(dir,data); await putPublicReadmes(dir,data,{cover});
    await writeFile(path.join(dir,'collections',data.category,data.slug,'cover.png'),'visible local image');
    await assert.rejects(loadCatalog({rootDir:dir}),/cover.*(match|public README)/i);
  }
});
test('omitting coverFile cannot bypass local archiving or allow insecure external cover URLs', async t => {
  for (const url of ['/data/collections/assets/example/cover.png','/assets/cover.png','cover.png','//images.example.com/cover.png','http://images.example.com/cover.png','https://user:password@images.example.com/cover.png']) {
    const dir=await root(t),data=await fixture();
    data.cover={kind:'source-image',url,sourceUrl:'https://example.com/author',alt:'Cover',rightsStatus:'needs-review'};
    await putSystemMetadata(dir,data); await putPublicReadmes(dir,data,{cover:{url:'https://images.example.com/cover.png',alt:'Cover'}});
    await assert.rejects(loadCatalog({rootDir:dir}),/cover.*(HTTPS|archived|credentials)/i);
  }
});
test('a remote public cover cannot coexist with a local coverFile as a second image source', async t => {
  for (const url of ['https://images.example.com/cover.png','/assets/cover.png']) {
    const dir=await root(t),data=await fixture();
    data.cover={kind:'source-image',url,sourceUrl:'https://example.com/author',alt:'Cover',rightsStatus:'needs-review'};
    await putSystemMetadata(dir,data,{coverFile:'cover.png'});
    await putPublicReadmes(dir,data,{cover:{url:'https://images.example.com/cover.png',alt:'Cover'}});
    await writeFile(path.join(dir,'collections',data.category,data.slug,'cover.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64'));
    await assert.rejects(loadCatalog({rootDir:dir}),/cover.*(conflict|coexist|external|remote)/i);
  }
});
test('catalog output cannot contain, overwrite or enter internal metadata including a symbolic-link alias', async t => {
  const dir=await root(t),outside=await root(t),data=approve(await fixture()); const file=await putSystemMetadata(dir,data); await putPublicReadmes(dir,data);
  const before=await readFile(file,'utf8'); await symlink(path.join(dir,'.catalog'),path.join(dir,'metadata-alias'));
  await symlink(path.join(dir,'.catalog'),path.join(outside,'metadata-alias'));
  for (const outputDir of [path.join(dir,'.catalog'),path.join(dir,'.catalog/output'),path.join(dir,'metadata-alias'),path.join(dir,'metadata-alias/output'),path.join(dir,'metadata-alias/missing/output'),path.join(outside,'metadata-alias'),path.join(outside,'metadata-alias/output')]) {
    await assert.rejects(buildCatalog({rootDir:dir,outputDir}),/outputDir.*(source|metadata|catalog)/i);
    assert.equal(await readFile(file,'utf8'),before);
  }
});
test('an explicit external snapshot destination remains supported without entering internal metadata', async t => {
  const dir=await root(t),outside=await root(t),data=approve(await fixture()); await putSystemMetadata(dir,data); await putPublicReadmes(dir,data);
  const result=await buildCatalog({rootDir:dir,outputDir:path.join(outside,'new/snapshot')});
  assert.equal(result.records.length,1); assert.equal(JSON.parse(await readFile(path.join(result.outputDir,'index.json'),'utf8')).collections[0].id,data.id);
});
test('internal metadata ignores old presentation overlays as a second source of public display', async t => {
  const {serializeTranslationMarkdown}=await import('../scripts/lib/markdown.mjs');
  const dir=await root(t),data=await fixture(); await putSystemMetadata(dir,data); await putPublicReadmes(dir,data);
  const presentation={title:'Wrong legacy title',description:'Wrong legacy description',overview:'Wrong legacy overview',scenarios:['Wrong legacy scenario'],usage:'Wrong legacy usage',skills:{[data.skills[0].id]:{summary:'Wrong legacy summary'}}};
  await writeFile(path.join(dir,'collections',data.category,data.slug,'README.en.md'),serializeTranslationMarkdown(presentation,{id:data.id,language:'en'}));
  const [record]=await loadCatalog({rootDir:dir});
  assert.deepEqual(record.document.localizations.en,data.localizations.en);
  assert.deepEqual(detailPresentation(record.document),detailPresentation(data));
});
test('English internal metadata and bilingual public READMEs preserve fine translations while normalizing display', async t => {
  const dir=await root(t),data=await fixture(),zh=detailPresentation(data),en=structuredClone(data.localizations.en);
  Object.assign(data,detailPresentation(en)); for (const skill of data.skills) Object.assign(skill,en.skills[skill.id]);
  const installations=structuredClone(data.skills.map(skill=>skill.installationItems));
  data.localizations={zh:{tags:['中文标签'],skills:{[data.skills[0].id]:{summary:'中文技能说明',role:'明确目标'}}}};
  await putSystemMetadata(dir,data,{language:'en'});
  const common={slug:data.slug,category:data.category,links:installationLinks(data)};
  await putSubmission(dir,{...common,...detailPresentation(en)}); await putSubmission(dir,{...common,filename:'README.zh.md',...zh});
  const [record]=await loadCatalog({rootDir:dir});
  assert.equal(record.complete,true); assert.equal(record.baseLanguage,'zh'); assert.equal(record.document.id,data.id); assert.equal(record.document.revision,data.revision);
  assert.deepEqual(detailPresentation(record.document),zh); assert.deepEqual(detailPresentation(record.document.localizations.en),detailPresentation(en));
  assert.deepEqual(record.document.tags,['中文标签']); assert.equal(record.document.skills[0].summary,'中文技能说明'); assert.equal(record.document.localizations.en.skills[data.skills[0].id].summary,en.skills[data.skills[0].id].summary);
  assert.deepEqual(record.document.skills.map(skill=>skill.installationItems),installations); assert.equal(record.document.localizations.zh,undefined);
});
test('localized internal metadata cannot inject installation, entry, review or evidence machine fields during language normalization', async t => {
  const dir=await root(t),data=approve(await fixture()),zh=detailPresentation(data),en=structuredClone(data.localizations.en);
  Object.assign(data,detailPresentation(en)); for (const skill of data.skills) Object.assign(skill,en.skills[skill.id]); delete data.localizations;
  const file=await putSystemMetadata(dir,data,{language:'en'}),common={slug:data.slug,category:data.category,links:installationLinks(data)};
  await putSubmission(dir,{...common,...detailPresentation(en)}); await putSubmission(dir,{...common,filename:'README.zh.md',...zh});
  const remotion=data.skills[1],evidence=data.provenance.evidence[0];
  for (const presentation of [
    {skills:{[remotion.id]:{installationMode:'skill',installationItems:[remotion.installationItems[0]]}}},
    {skills:{[remotion.id]:{entry:remotion.entry}}},
    {provenance:{evidence:{[evidence.id]:{supportsItemIds:[remotion.id]}}}},
    {provenance:{repositoryScope:{repo:remotion.entry.repo,commit:remotion.entry.commit,directories:['skills']}}},
    {review:{status:'approved'}},{skills:[]},{skills:{[remotion.id]:null}},{provenance:{evidence:{[evidence.id]:null}}},
  ]) {
    const metadata=systemMetadata(data,{language:'en'}); metadata.document.localizations={zh:presentation}; await writeFile(file,JSON.stringify(metadata));
    await assert.rejects(loadCatalog({rootDir:dir,mode:'production'}),/metadata|translation|supported|object/i);
  }
});
