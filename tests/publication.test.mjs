import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { indexItem } from '../scripts/lib/site-contract.mjs';
import { buildStaticPublication, readCurrentSnapshot } from '../scripts/lib/publication.mjs';
import { verifySnapshotFiles } from '../scripts/lib/snapshot.mjs';
import { loadPublishedSnapshot } from '../scripts/lib/generation-context.mjs';
import { checkStaticData } from '../scripts/check-static-data.mjs';

const REVISION = 'a'.repeat(40);
const ID = 'de64301b-09cf-4968-9fc2-24ede5cd4dd6';
const SECOND_ID = 'a64301b1-09cf-4968-9fc2-24ede5cd4dd6';
const IMAGE = Buffer.from('89504e470d0a1a0a01020304', 'hex');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'catalog-publication-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  return root;
}
async function snapshot(t, { revision=REVISION, preview=false, image=IMAGE, duplicate=false, extension='png', title, externalCover, externalOnly=false, skillCount=0 }={}) {
  const root = await directory(t);
  const document = JSON.parse(await readFile(new URL(`./fixtures/site/${ID}.json`, import.meta.url), 'utf8'));
  document.category = 'media';
  document.review = { status:'approved', reviewer:'Fixture reviewer', reviewedAt:'2026-10-01', notes:[] };
  document.verification.source = document.verification.files = 'verified';
  document.verification.installation = document.verification.workflow = 'not-tested';
  document.skills.forEach(skill => { skill.resourceCheck = 'verified'; });
  if (skillCount) {
    const template = document.skills[0];
    document.skills = Array.from({ length:skillCount }, (_, index) => {
      const skill = structuredClone(template), name = `fixture-skill-${index}`;
      skill.id = skill.name = name;
      skill.summary = `${name} ${'a'.repeat(200000)}`;
      skill.entry.entryPoint = `skills/${name}/SKILL.md`;
      skill.installationItems[0].name = name;
      skill.installationItems[0].directory = `skills/${name}`;
      return skill;
    });
    document.localizations.en.skills = {};
    document.provenance.evidence.forEach(evidence => { evidence.supportsItemIds = document.skills.map(skill => skill.id); });
  }
  if (title) document.title = title;
  document.cover = { kind:'source-image', url:`/data/collections/assets/${ID}/cover.${extension}`, sourceUrl:'https://example.com/cover', alt:'Fixture cover', rightsStatus:'verified', rightsEvidenceUrl:'https://example.com/rights' };
  if (externalOnly) document.cover.url = externalCover;
  const records = [document];
  if (duplicate) {
    const second = structuredClone(document);
    second.id = SECOND_ID; second.slug = 'second-video'; second.sourceKeys = ['fixture:second'];
    second.cover.url = externalCover ?? `/data/collections/assets/${SECOND_ID}/cover.${extension}`;
    records.push(second);
  }
  const files = new Map();
  files.set('index.json', Buffer.from(JSON.stringify({ schemaVersion:1, collections:records.map(indexItem) }) + '\n'));
  for (const record of records) {
    files.set(`${record.id}.json`, Buffer.from(JSON.stringify(record) + '\n'));
    if (record.cover.url.startsWith('/')) files.set(`assets/${record.id}/cover.${extension}`, image);
  }
  const manifest = { schemaVersion:1, preview, sourceRevision:revision, files:[...files].map(([name, bytes]) => ({ path:name, sha256:digest(bytes), size:bytes.length })) };
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\n');
  files.set('manifest.json', manifestBytes);
  for (const [name, bytes] of files) {
    const filename = path.join(root, name);
    await mkdir(path.dirname(filename), { recursive:true });
    await writeFile(filename, bytes);
  }
  return { root, files, version:digest(manifestBytes), manifest };
}
async function current(root) { return JSON.parse(await readFile(path.join(root, 'current.json'), 'utf8')); }
function localRead(root) {
  return async key => {
    try { return await readFile(path.join(root, key)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
}
async function filesUnder(root, prefix='') {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes:true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, name));
    else files.push(name);
  }
  return files.sort();
}

test('builds original JSON and one content image for identical collection covers', async t => {
  const source = await snapshot(t, { duplicate:true }), outDir = path.join(await directory(t), 'assets');
  const result = await buildStaticPublication({ fromDir:source.root, outDir });
  const pointer = await current(outDir), imageKey = `images/${digest(IMAGE)}.png`;
  assert.deepEqual(pointer, { schemaVersion:1, version:source.version, sourceRevision:REVISION, preview:false, snapshotPath:`snapshots/${source.version}/`, assets:{ [`assets/${ID}/cover.png`]:imageKey, [`assets/${SECOND_ID}/cover.png`]:imageKey } });
  assert.equal(result.count, 2); assert.equal(result.version, source.version); assert.equal(result.retainedVersion, null);
  assert.deepEqual(await readdir(path.join(outDir, 'images')), [`${digest(IMAGE)}.png`]);
  for (const [name, bytes] of source.files) if (!name.startsWith('assets/')) assert.deepEqual(await readFile(path.join(outDir, pointer.snapshotPath, name)), bytes);
  assert.deepEqual(await readFile(path.join(outDir, imageKey)), IMAGE);
  assert.deepEqual(await readFile(path.join(outDir, pointer.snapshotPath, 'release.json')), await readFile(path.join(outDir, 'current.json')));
  assert.equal((await filesUnder(outDir)).some(name => name.includes('/assets/')), false);
});

test('headers permit website reads and distinguish current data from immutable version files', async t => {
  const source = await snapshot(t), outDir = await directory(t);
  await buildStaticPublication({ fromDir:source.root, outDir });
  const headers = await readFile(path.join(outDir, '_headers'), 'utf8');
  assert.match(headers, /^\/\*\n  Access-Control-Allow-Origin: \*/m);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /\/current\.json\n  Cache-Control: no-store/);
  assert.match(headers, /\/snapshots\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/images\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
  assert.equal((await filesUnder(outDir)).some(name => /\.(?:html|js)$/.test(name)), false);
});

test('the read-only publication reader verifies every snapshot file', async t => {
  const source = await snapshot(t), outDir = await directory(t);
  assert.equal(await readCurrentSnapshot({ read:localRead(outDir) }), null);
  await buildStaticPublication({ fromDir:source.root, outDir });
  const verified = await readCurrentSnapshot({ read:localRead(outDir) });
  assert.equal(verified.release.version, source.version);
  for (const [name, bytes] of source.files) assert.deepEqual(verified.files.get(name), bytes);
});

test('keeps a bilingual index small while publishing full skill details through hosted checks and generation baselines', async t => {
  const source = await snapshot(t, { skillCount:40 }), outDir = await directory(t);
  assert.ok(source.files.get('index.json').length < 4096);
  assert.ok(source.files.get(`${ID}.json`).length > 7 * 1024 * 1024);
  assert.ok(source.files.get(`${ID}.json`).length < 20 * 1024 * 1024);
  assert.ok([...source.files.values()].reduce((total, bytes) => total + bytes.length, 0) < 100 * 1024 * 1024);
  const detail = JSON.parse(source.files.get(`${ID}.json`));
  assert.ok(detail.skills.every(skill => Buffer.byteLength(skill.summary) < 1024 * 1024));
  await buildStaticPublication({ fromDir:source.root, outDir });
  const read = localRead(outDir), verified = await readCurrentSnapshot({ read });
  assert.equal(verified.release.version, source.version);
  assert.equal(verified.index.collections[0].itemCount, 40);
  for (const [name, bytes] of source.files) assert.deepEqual(verified.files.get(name), bytes);
  const baseUrl = 'https://data.example.com/';
  const request = async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual');
    const key = new URL(url).pathname.slice(1), bytes = await read(key);
    return new Response(bytes ?? 'Missing file', { status:bytes ? 200 : 404, headers:{ 'Content-Length':String(bytes?.length ?? 12), 'Content-Type':key.endsWith('.json') ? 'application/json' : 'image/png', 'Access-Control-Allow-Origin':'*', 'Cache-Control':key === 'current.json' ? 'no-store' : 'public, max-age=31536000, immutable' } });
  };
  const hosted = await checkStaticData({ url:baseUrl, assetsDir:outDir, request });
  assert.equal(hosted.version, source.version); assert.equal(hosted.count, 1);
  const baseline = await loadPublishedSnapshot({ rootDir:await directory(t), baseUrl, request });
  assert.equal(digest(baseline.files.get('manifest.json')), source.version);
  for (const [name, bytes] of source.files) assert.deepEqual(baseline.files.get(name), bytes);
});

test('rejects a detail file above 20 MiB before writing a publication', async t => {
  const source = await snapshot(t, { skillCount:110 }), outDir = await directory(t);
  assert.ok(source.files.get(`${ID}.json`).length > 20 * 1024 * 1024);
  await assert.rejects(verifySnapshotFiles(source.files), /Snapshot file body or size limit/i);
  await assert.rejects(buildStaticPublication({ fromDir:source.root, outDir }), /Snapshot file size or count limit/i);
  assert.deepEqual(await readdir(outDir), []);
});

test('retains the preceding version and shared images for an already open page', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40), title:'Updated video' }), outDir = await directory(t);
  await buildStaticPublication({ fromDir:first.root, outDir });
  const previousSnapshot = await readCurrentSnapshot({ read:localRead(outDir) });
  const result = await buildStaticPublication({ fromDir:next.root, outDir, previousSnapshot });
  assert.equal(result.retainedVersion, first.version);
  assert.deepEqual((await readdir(path.join(outDir, 'snapshots'))).sort(), [first.version, next.version].sort());
  assert.equal((await current(outDir)).version, next.version);
  assert.deepEqual(await readdir(path.join(outDir, 'images')), [`${digest(IMAGE)}.png`]);
  assert.deepEqual(await readFile(path.join(outDir, `snapshots/${first.version}/index.json`)), first.files.get('index.json'));
});

test('a third publication contains only current and preceding versions and their images', async t => {
  const first = await snapshot(t), second = await snapshot(t, { revision:'b'.repeat(40), image:Buffer.concat([IMAGE, Buffer.from([5])]) }), third = await snapshot(t, { revision:'c'.repeat(40), image:Buffer.concat([IMAGE, Buffer.from([6])]) }), outDir = await directory(t);
  await buildStaticPublication({ fromDir:first.root, outDir });
  await buildStaticPublication({ fromDir:second.root, outDir, previousSnapshot:await readCurrentSnapshot({ read:localRead(outDir) }) });
  await buildStaticPublication({ fromDir:third.root, outDir, previousSnapshot:await readCurrentSnapshot({ read:localRead(outDir) }) });
  assert.deepEqual((await readdir(path.join(outDir, 'snapshots'))).sort(), [second.version, third.version].sort());
  assert.equal((await readdir(path.join(outDir, 'images'))).length, 2);
  await assert.rejects(readFile(path.join(outDir, `images/${digest(IMAGE)}.png`)), { code:'ENOENT' });
});

test('rebuilding an identical version emits one version directory', async t => {
  const source = await snapshot(t), outDir = await directory(t);
  await buildStaticPublication({ fromDir:source.root, outDir });
  await buildStaticPublication({ fromDir:source.root, outDir, previousSnapshot:await readCurrentSnapshot({ read:localRead(outDir) }) });
  assert.deepEqual(await readdir(path.join(outDir, 'snapshots')), [source.version]);
});

test('retrying the current version is marked unchanged for CI to preserve the deployed preceding version', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40) }), outDir = await directory(t);
  assert.equal((await buildStaticPublication({ fromDir:first.root, outDir })).unchanged, false);
  assert.equal((await buildStaticPublication({ fromDir:next.root, outDir, previousSnapshot:await readCurrentSnapshot({ read:localRead(outDir) }) })).unchanged, false);
  assert.equal((await buildStaticPublication({ fromDir:next.root, outDir, previousSnapshot:await readCurrentSnapshot({ read:localRead(outDir) }) })).unchanged, true);
});

test('mixed external and local covers preserve direct URLs without fetching external images', async t => {
  const externalCover = 'https://images.example.com/author-cover.webp';
  const source = await snapshot(t, { duplicate:true, externalCover }), outDir = await directory(t);
  await buildStaticPublication({ fromDir:source.root, outDir });
  assert.deepEqual(Object.keys((await current(outDir)).assets), [`assets/${ID}/cover.png`]);
  const detail = JSON.parse(await readFile(path.join(outDir, `snapshots/${source.version}/${SECOND_ID}.json`), 'utf8'));
  assert.equal(detail.cover.url, externalCover);
  assert.deepEqual(await readdir(path.join(outDir, 'images')), [`${digest(IMAGE)}.png`]);
});

test('external-only snapshots have no shared image files', async t => {
  const source = await snapshot(t, { externalOnly:true, externalCover:'https://images.example.com/author-cover.webp' }), outDir = await directory(t);
  await buildStaticPublication({ fromDir:source.root, outDir });
  assert.deepEqual((await current(outDir)).assets, {});
  await assert.rejects(readdir(path.join(outDir, 'images')), { code:'ENOENT' });
});

test('jpeg extensions use the canonical jpg content image name', async t => {
  const source = await snapshot(t, { extension:'jpeg' }), outDir = await directory(t);
  await buildStaticPublication({ fromDir:source.root, outDir });
  assert.equal((await current(outDir)).assets[`assets/${ID}/cover.jpeg`], `images/${digest(IMAGE)}.jpg`);
});

test('corrupt source data leaves a previously generated directory untouched', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40) }), outDir = await directory(t);
  await buildStaticPublication({ fromDir:first.root, outDir });
  const before = await readFile(path.join(outDir, 'current.json'));
  await writeFile(path.join(next.root, 'index.json'), 'corrupt');
  await assert.rejects(buildStaticPublication({ fromDir:next.root, outDir }), /checksum|size/i);
  assert.deepEqual(await readFile(path.join(outDir, 'current.json')), before);
});

test('corrupt preceding snapshot data is rejected before replacing output', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40) }), outDir = await directory(t);
  await buildStaticPublication({ fromDir:first.root, outDir });
  const previousSnapshot = await readCurrentSnapshot({ read:localRead(outDir) }), before = await readFile(path.join(outDir, 'current.json'));
  previousSnapshot.files.set('index.json', Buffer.from('{}'));
  await assert.rejects(buildStaticPublication({ fromDir:next.root, outDir, previousSnapshot }), /checksum|size/i);
  assert.deepEqual(await readFile(path.join(outDir, 'current.json')), before);
});

test('preceding snapshot release fields must match its verified content', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40) }), outDir = await directory(t);
  await buildStaticPublication({ fromDir:first.root, outDir });
  const previousSnapshot = await readCurrentSnapshot({ read:localRead(outDir) });
  previousSnapshot.release.assets[`assets/${ID}/cover.png`] = `images/${'f'.repeat(64)}.png`;
  await assert.rejects(buildStaticPublication({ fromDir:next.root, outDir, previousSnapshot }), /release|disagree/i);
  assert.equal((await current(outDir)).version, first.version);
});

test('production rejects preview snapshots and explicit local previews remain usable', async t => {
  const source = await snapshot(t, { preview:true }), outDir = await directory(t);
  await assert.rejects(buildStaticPublication({ fromDir:source.root, outDir }), /preview/i);
  assert.deepEqual(await readdir(outDir), []);
  await buildStaticPublication({ fromDir:source.root, outDir, allowPreview:true });
  await assert.rejects(readCurrentSnapshot({ read:localRead(outDir) }), /preview/i);
  assert.equal((await readCurrentSnapshot({ read:localRead(outDir), allowPreview:true })).release.preview, true);
});

test('production refuses retaining a preceding preview snapshot', async t => {
  const preview = await snapshot(t, { preview:true }), source = await snapshot(t, { revision:'b'.repeat(40) }), outDir = await directory(t);
  await buildStaticPublication({ fromDir:preview.root, outDir, allowPreview:true });
  const previousSnapshot = await readCurrentSnapshot({ read:localRead(outDir), allowPreview:true });
  await assert.rejects(buildStaticPublication({ fromDir:source.root, outDir, previousSnapshot }), /preview/i);
});

test('publication rejects an output directory inside or above its source snapshot', async t => {
  const parent = await directory(t), source = await snapshot(t);
  for (const outDir of [source.root, path.join(source.root, 'output'), path.dirname(source.root)]) {
    await assert.rejects(buildStaticPublication({ fromDir:source.root, outDir }), /source|destination|overlap/i);
  }
  for (const [name, bytes] of source.files) assert.deepEqual(await readFile(path.join(source.root, name)), bytes);
  assert.deepEqual(await readdir(parent), []);
});

test('publication refuses output symbolic links and symbolic-link parent directories', async t => {
  const source = await snapshot(t), parent = await directory(t), outside = await directory(t);
  await symlink(outside, path.join(parent, 'linked'));
  for (const outDir of [path.join(parent, 'linked'), path.join(parent, 'linked', 'assets')]) {
    await assert.rejects(buildStaticPublication({ fromDir:source.root, outDir }), /symbolic|symlink/i);
  }
  assert.deepEqual(await readdir(outside), []);
});

test('reading current data refuses a pointer that disagrees with its version', async t => {
  const source = await snapshot(t), outDir = await directory(t);
  await buildStaticPublication({ fromDir:source.root, outDir });
  const pointer = await current(outDir); pointer.sourceRevision = 'b'.repeat(40);
  await writeFile(path.join(outDir, 'current.json'), JSON.stringify(pointer));
  await assert.rejects(readCurrentSnapshot({ read:localRead(outDir) }), /current|pointer|disagree/i);
});

test('manifest limits are checked before downloading any snapshot files', async t => {
  const source = await snapshot(t), outDir = await directory(t);
  await buildStaticPublication({ fromDir:source.root, outDir });
  const manifest = { ...source.manifest, files:[{ path:'index.json', size:20*1024*1024+1, sha256:'a'.repeat(64) }] };
  const bytes = Buffer.from(JSON.stringify(manifest)), version = digest(bytes);
  const pointer = { ...await current(outDir), version, snapshotPath:`snapshots/${version}/` };
  const pointerBytes = Buffer.from(JSON.stringify(pointer));
  const objects = new Map([['current.json', pointerBytes], [`snapshots/${version}/release.json`, pointerBytes], [`snapshots/${version}/manifest.json`, bytes]]), requested = [];
  await assert.rejects(readCurrentSnapshot({ read:async key => { requested.push(key); return objects.get(key) ?? null; } }), /limit|size/i);
  assert.equal(requested.some(key => key.endsWith('/index.json')), false);
});

test('publication reads reject malformed current JSON, unsafe paths and missing release files', async t => {
  await assert.rejects(readCurrentSnapshot({ read:async () => Buffer.from('<html>Not found</html>') }), /JSON/i);
  const source = await snapshot(t), outDir = await directory(t);
  await buildStaticPublication({ fromDir:source.root, outDir });
  const pointer = await current(outDir);
  for (const snapshotPath of ['versions/' + source.version + '/', '../escaped/', 'snapshots/%2e%2e/']) {
    await assert.rejects(readCurrentSnapshot({ read:async () => Buffer.from(JSON.stringify({ ...pointer, snapshotPath })) }), /fields|path/i);
  }
  await rm(path.join(outDir, pointer.snapshotPath, 'release.json'));
  await assert.rejects(readCurrentSnapshot({ read:localRead(outDir) }), /missing.*release/i);
});

test('changed shared images and missing details fail publication read verification', async t => {
  const source = await snapshot(t), outDir = await directory(t);
  await buildStaticPublication({ fromDir:source.root, outDir });
  const pointer = await current(outDir), imagePath = pointer.assets[`assets/${ID}/cover.png`];
  await writeFile(path.join(outDir, imagePath), Buffer.from('corrupt image'));
  await assert.rejects(readCurrentSnapshot({ read:localRead(outDir) }), /checksum|size/i);
  await writeFile(path.join(outDir, imagePath), IMAGE);
  await rm(path.join(outDir, pointer.snapshotPath, `${ID}.json`));
  await assert.rejects(readCurrentSnapshot({ read:localRead(outDir) }), /missing.*file/i);
});
