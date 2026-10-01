import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildCatalog, loadCatalog } from '../scripts/lib/catalog.mjs';
import { serializeCollectionMarkdown } from '../scripts/lib/markdown.mjs';

const fixtureDir = new URL('./fixtures/site/', import.meta.url);
async function fixture(name = 'de64301b-09cf-4968-9fc2-24ede5cd4dd6') {
  const data = JSON.parse(await readFile(new URL(`${name}.json`, fixtureDir), 'utf8'));
  data.review.status = 'pending';
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
  const target = path.join(dir, 'collections', data.slug);
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
  await put(dir,data,'cover.png'); await writeFile(path.join(dir,'collections/product-video/cover.png'),'fake image');
  await assert.rejects(loadCatalog({rootDir:dir}),/format|magic|image/);
  await rm(path.join(dir,'collections/product-video/cover.png'));
  await writeFile(path.join(outside,'outside.png'),Buffer.from('89504e470d0a1a0a','hex'));
  await symlink(path.join(outside,'outside.png'),path.join(dir,'collections/product-video/cover.png'));
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
  await writeFile(path.join(dir,'collections',data.slug,'README.en.md'),serializeTranslationMarkdown(presentation,{id:data.id,language:'en'}));
  const records=await loadCatalog({rootDir:dir});
  assert.equal(records[0].document.localizations.en.title,'Product video');
  assert.deepEqual(records[0].document.skills,data.skills);
});
test('new CLI creates a stable pending UUID, rejects overwrite and invalid parameters', async t => {
  const {execFile}=await import('node:child_process'); const {promisify}=await import('node:util'); const run=promisify(execFile);
  const dir=await root(t),cli=new URL('../scripts/catalog.mjs',import.meta.url).pathname;
  await run(process.execPath,[cli,'new','new-skill','--lang','en'],{cwd:dir});
  const before=await readFile(path.join(dir,'collections/new-skill/README.md'),'utf8');
  assert.match(before,/status: pending/);
  const data=(await loadCatalog({rootDir:dir}))[0].document;
  assert.match(data.id,/^[a-f0-9-]{36}$/); assert.equal(data.skills[0].entry.commit,undefined);
  await assert.rejects(run(process.execPath,[cli,'new','new-skill','--lang','en'],{cwd:dir}));
  assert.equal(await readFile(path.join(dir,'collections/new-skill/README.md'),'utf8'),before);
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
  const target=path.join(dir,'collections',data.slug); await mkdir(target,{recursive:true});
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
  await writeFile(path.join(dir,'collections',data.slug,'README.en.md'),serializeTranslationMarkdown(presentation,{id:data.id,language:'en'}));
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
  await writeFile(path.join(dir,'collections',data.slug,'封面.PNG'),bytes);
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
  const directory=path.join(dir,'collections',data.slug); await mkdir(directory,{recursive:true});
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
  await writeFile(path.join(dir,'collections',data.slug,'README.md'),serializeCollectionMarkdown(data,{language:'en'}));
  await buildCatalog({rootDir:dir,preview:true});
  const chinese=await readFile(path.join(dir,'README.zh.md'),'utf8');
  assert.match(chinese,/\[product-video\].*待翻译/); assert.doesNotMatch(chinese,/Product video|Coordinate a product video/);
});
test('English canonical with Chinese overlay generates both page languages without altering website JSON', async t => {
  const {serializeTranslationMarkdown}=await import('../scripts/lib/markdown.mjs');
  const dir=await root(t),data=await fixture(); delete data.localizations;
  data.title='Product video'; data.description='Create a launch video';
  const directory=path.join(dir,'collections',data.slug); await mkdir(directory,{recursive:true});
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
  const markdown=await readFile(path.join(dir,'collections/english-default/README.md'),'utf8');
  assert.match(markdown,/language: en/); assert.match(markdown,/# Draft collection/); assert.doesNotMatch(markdown,/[\u3400-\u9fff]/);
});

test('partial Chinese metadata never supplies untranslated English prose to the Chinese directory', async t => {
  for (const chinese of [{tags:['中文标签']},{title:'中文局部标题'}]) {
    const dir=await root(t),data=await fixture();
    data.title='English collection'; data.description='English description';
    data.localizations={zh:chinese};
    const directory=path.join(dir,'collections',data.slug); await mkdir(directory,{recursive:true});
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
