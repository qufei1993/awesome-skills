import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { indexItem } from '../scripts/lib/site-contract.mjs';
import { createLocalStore, createR2Store, publishSnapshot, rollbackPublication } from '../scripts/lib/publication.mjs';
import * as publication from '../scripts/lib/publication.mjs';

const REVISION = 'a'.repeat(40);
const ID = 'de64301b-09cf-4968-9fc2-24ede5cd4dd6';
const SECOND_ID = 'a64301b1-09cf-4968-9fc2-24ede5cd4dd6';
const IMAGE = Buffer.from('89504e470d0a1a0a01020304', 'hex');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const run = promisify(execFile);
const cli = new URL('../scripts/publish-data.mjs', import.meta.url).pathname;
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'catalog-publication-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  return root;
}
async function snapshot(t, { revision=REVISION, preview=false, image=IMAGE, duplicate=false, extension='png', title, externalCover, externalOnly=false }={}) {
  const root = await directory(t);
  const document = JSON.parse(await readFile(new URL(`./fixtures/site/${ID}.json`, import.meta.url), 'utf8'));
  document.category = 'media';
  document.review = { status:'approved', reviewer:'Fixture reviewer', reviewedAt:'2026-10-01', notes:[] };
  document.verification.source = document.verification.files = 'verified';
  document.verification.installation = document.verification.workflow = 'not-tested';
  document.skills.forEach(skill => { skill.resourceCheck = 'verified'; });
  if (title) document.title = title;
  document.cover = { kind:'source-image', url:`/data/collections/assets/${ID}/cover.${extension}`, sourceUrl:'https://example.com/cover', alt:'Fixture cover', rightsStatus:'verified', rightsEvidenceUrl:'https://example.com/rights' };
  if (externalOnly) document.cover.url=externalCover;
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

test('reading the current publication verifies every snapshot file and preserves shared cover bytes', async t => {
  const source = await snapshot(t), root = await directory(t), store = await createLocalStore(root);
  assert.equal(await publication.readCurrentSnapshot({ store }), null);
  await publishSnapshot({ fromDir:source.root, store });
  const verified = await publication.readCurrentSnapshot({ store });
  assert.equal(verified.release.version, source.version);
  for (const [name, bytes] of source.files) assert.deepEqual(verified.files.get(name), bytes);
  assert.equal(await current(root).then(pointer => pointer.version), source.version);
});

test('reading current data refuses a pointer that disagrees with its immutable version', async t => {
  const source = await snapshot(t), root = await directory(t), store = await createLocalStore(root);
  await publishSnapshot({ fromDir:source.root, store });
  const pointer = await current(root); pointer.sourceRevision = 'b'.repeat(40);
  await writeFile(path.join(root, 'current.json'), JSON.stringify(pointer));
  await assert.rejects(publication.readCurrentSnapshot({ store }), /current|pointer|disagree/i);
});

test('published manifest limits are checked before downloading its files', async t => {
  const source = await snapshot(t), root = await directory(t), store = await createLocalStore(root);
  await publishSnapshot({ fromDir:source.root, store });
  const manifest = { ...source.manifest, files:[{ path:'index.json', size:11*1024*1024, sha256:'a'.repeat(64) }] };
  const bytes = Buffer.from(JSON.stringify(manifest)), version = digest(bytes);
  const pointer = { ...await current(root), version, snapshotPath:`snapshots/${version}/` };
  const objects = new Map([['current.json', Buffer.from(JSON.stringify(pointer))], [`snapshots/${version}/release.json`, Buffer.from(JSON.stringify(pointer))], [`snapshots/${version}/manifest.json`, bytes]]);
  const requested = [];
  await assert.rejects(publication.readCurrentSnapshot({ store:{ get:async key => { requested.push(key); return objects.get(key) ?? null; } } }), /limit|size/i);
  assert.equal(requested.some(key => key.endsWith('/index.json')), false);
});

test('publishes original JSON bytes and maps identical covers to one shared image', async t => {
  const source = await snapshot(t, { duplicate:true }), root = await directory(t), store = await createLocalStore(root);
  const result = await publishSnapshot({ fromDir:source.root, store });
  const pointer = await current(root), imageKey = `images/${digest(IMAGE)}.png`;
  assert.deepEqual(pointer, { schemaVersion:1, version:source.version, sourceRevision:REVISION, preview:false, snapshotPath:`snapshots/${source.version}/`, assets:{ [`assets/${ID}/cover.png`]:imageKey, [`assets/${SECOND_ID}/cover.png`]:imageKey } });
  assert.equal(result.count, 2); assert.equal(result.uploadedImages, 1); assert.equal(result.reusedImages, 0);
  assert.equal(result.uploadedFiles, 5);
  assert.deepEqual(await readdir(path.join(root, 'images')), [`${digest(IMAGE)}.png`]);
  for (const [name, bytes] of source.files) if (!name.startsWith('assets/')) assert.deepEqual(await readFile(path.join(root, pointer.snapshotPath, name)), bytes);
  assert.deepEqual(await readFile(path.join(root, imageKey)), IMAGE);
  assert.deepEqual(await readFile(path.join(root, pointer.snapshotPath, 'release.json')), await readFile(path.join(root, 'current.json')));
  await assert.rejects(readFile(path.join(root, pointer.snapshotPath, 'assets', ID, 'cover.png')), { code:'ENOENT' });
});

test('metadata-only versions reuse the stored image without uploading it again', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40), title:'Updated video' });
  const root = await directory(t), store = await createLocalStore(root);
  await publishSnapshot({ fromDir:first.root, store });
  const result = await publishSnapshot({ fromDir:next.root, store });
  assert.equal(result.uploadedImages, 0); assert.equal(result.reusedImages, 1);
  assert.equal((await current(root)).version, next.version);
  assert.deepEqual(await readdir(path.join(root, 'images')), [`${digest(IMAGE)}.png`]);
});
test('mixed external and archived covers publish, reuse and roll back without downloading external images', async t => {
  const externalCover='https://images.example.com/author-cover.png';
  const first=await snapshot(t,{duplicate:true,externalCover}),next=await snapshot(t,{duplicate:true,externalCover,revision:'b'.repeat(40),title:'Updated video'});
  const root=await directory(t),store=await createLocalStore(root);
  const initial=await publishSnapshot({fromDir:first.root,store});
  assert.equal(initial.count,2); assert.equal(initial.uploadedImages,1); assert.equal(initial.reusedImages,0);
  const updated=await publishSnapshot({fromDir:next.root,store});
  assert.equal(updated.uploadedImages,0); assert.equal(updated.reusedImages,1);
  assert.deepEqual(Object.keys((await current(root)).assets),[`assets/${ID}/cover.png`]);
  const detail=JSON.parse(await readFile(path.join(root,`snapshots/${next.version}/${SECOND_ID}.json`),'utf8'));
  assert.equal(detail.cover.url,externalCover);
  await rollbackPublication({store,version:first.version});
  assert.equal((await current(root)).version,first.version);
  assert.deepEqual(await readdir(path.join(root,'images')),[`${digest(IMAGE)}.png`]);
});
test('publication rejects insecure external covers before storing files', async t => {
  for (const externalCover of ['http://images.example.com/cover.png','https://user:password@images.example.com/cover.png']) {
    const source=await snapshot(t,{duplicate:true,externalCover}),root=await directory(t),store=await createLocalStore(root);
    await assert.rejects(publishSnapshot({fromDir:source.root,store}),/cover|HTTPS|credentials/i);
    assert.deepEqual(await readdir(root),[]);
  }
});
test('external-only releases preserve direct URLs with no uploaded images or asset mapping', async t => {
  const options={externalOnly:true,externalCover:'https://images.example.com/author-cover.webp'};
  const first=await snapshot(t,options),next=await snapshot(t,{...options,revision:'b'.repeat(40),title:'Updated external cover collection'});
  const root=await directory(t),store=await createLocalStore(root);
  for (const source of [first,next]) {
    const result=await publishSnapshot({fromDir:source.root,store});
    assert.equal(result.uploadedImages,0); assert.equal(result.reusedImages,0);
    assert.deepEqual((await current(root)).assets,{});
  }
  await rollbackPublication({store,version:first.version});
  assert.equal((await current(root)).version,first.version);
  await assert.rejects(readFile(path.join(root,'images')),{code:'ENOENT'});
});

test('one changed image uploads exactly one additional content object', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40), image:Buffer.concat([IMAGE, Buffer.from([5])]) });
  const root = await directory(t), store = await createLocalStore(root);
  await publishSnapshot({ fromDir:first.root, store });
  const result = await publishSnapshot({ fromDir:next.root, store });
  assert.equal(result.uploadedImages, 1); assert.equal(result.reusedImages, 0);
  assert.equal((await readdir(path.join(root, 'images'))).length, 2);
});

test('a failed immutable write leaves the previous current pointer untouched', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40) });
  const root = await directory(t), store = await createLocalStore(root);
  await publishSnapshot({ fromDir:first.root, store });
  const before = await readFile(path.join(root, 'current.json'));
  await mkdir(path.join(root, 'snapshots', next.version), { recursive:true });
  await mkdir(path.join(root, 'snapshots', next.version, 'manifest.json'));
  await assert.rejects(publishSnapshot({ fromDir:next.root, store }), /file|directory|immutable/i);
  assert.deepEqual(await readFile(path.join(root, 'current.json')), before);
});

test('corrupt sources are verified before any object is published', async t => {
  const source = await snapshot(t), root = await directory(t), store = await createLocalStore(root);
  await writeFile(path.join(source.root, 'index.json'), 'corrupt');
  await assert.rejects(publishSnapshot({ fromDir:source.root, store }), /checksum|size/i);
  assert.deepEqual(await readdir(root), []);
});

test('publication refuses a destination inside the original snapshot', async t => {
  const source = await snapshot(t), store = await createLocalStore(source.root);
  await assert.rejects(publishSnapshot({ fromDir:source.root, store }), /source|snapshot|destination/i);
  assert.deepEqual((await readdir(source.root)).sort(), ['assets', `${ID}.json`, 'index.json', 'manifest.json'].sort());
  for (const [name, bytes] of source.files) assert.deepEqual(await readFile(path.join(source.root, name)), bytes);
});

test('production rejects previews while explicitly permitted local previews publish', async t => {
  const source = await snapshot(t, { preview:true }), root = await directory(t), store = await createLocalStore(root);
  await assert.rejects(publishSnapshot({ fromDir:source.root, store }), /preview/i);
  assert.deepEqual(await readdir(root), []);
  await publishSnapshot({ fromDir:source.root, store, allowPreview:true });
  assert.equal((await current(root)).preview, true);
});

test('immutable keys refuse replacement by different bytes and preserve their contents', async t => {
  const root = await directory(t), store = await createLocalStore(root);
  assert.equal(await store.putImmutable('images/example.png', IMAGE), true);
  assert.equal(await store.putImmutable('images/example.png', IMAGE), false);
  await assert.rejects(store.putImmutable('images/example.png', Buffer.from('different')), /immutable|different|conflict/i);
  assert.deepEqual(await store.get('images/example.png'), IMAGE);
});

test('local storage refuses traversal and symbolic-link paths', async t => {
  const root = await directory(t), outside = await directory(t), store = await createLocalStore(root);
  for (const key of ['../escaped.json', '/absolute.json', 'images/../escaped.json', 'images/%2e%2e/escaped.json', 'images\\escaped.json']) {
    await assert.rejects(store.putImmutable(key, IMAGE), /path|key/i);
    await assert.rejects(store.get(key), /path|key/i);
  }
  await symlink(outside, path.join(root, 'images'));
  await assert.rejects(store.putImmutable('images/escaped.png', IMAGE), /symbolic|symlink/i);
  assert.deepEqual(await readdir(outside), []);
});

test('rollback verifies a prior immutable release before switching current', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40) });
  const root = await directory(t), store = await createLocalStore(root);
  await publishSnapshot({ fromDir:first.root, store }); await publishSnapshot({ fromDir:next.root, store });
  const result = await rollbackPublication({ store, version:first.version });
  assert.equal(result.version, first.version); assert.equal((await current(root)).version, first.version);
  await assert.rejects(rollbackPublication({ store, version:'../current' }), /version/i);
  await assert.rejects(rollbackPublication({ store, version:'f'.repeat(64) }), /missing|release/i);
});

test('rollback refuses corrupted prior files and preview releases in production', async t => {
  const first = await snapshot(t), preview = await snapshot(t, { preview:true, revision:'b'.repeat(40) });
  const root = await directory(t), store = await createLocalStore(root);
  await publishSnapshot({ fromDir:first.root, store }); await publishSnapshot({ fromDir:preview.root, store, allowPreview:true });
  const before = await readFile(path.join(root, 'current.json'));
  await assert.rejects(rollbackPublication({ store, version:preview.version }), /preview/i);
  await writeFile(path.join(root, 'snapshots', first.version, 'index.json'), '{}');
  await assert.rejects(rollbackPublication({ store, version:first.version }), /checksum|size/i);
  assert.deepEqual(await readFile(path.join(root, 'current.json')), before);
});

test('jpeg extensions share a canonical jpg content key', async t => {
  const source = await snapshot(t, { extension:'jpeg' }), root = await directory(t), store = await createLocalStore(root);
  await publishSnapshot({ fromDir:source.root, store });
  assert.equal((await current(root)).assets[`assets/${ID}/cover.jpeg`], `images/${digest(IMAGE)}.jpg`);
});

test('the CLI publishes locally and rolls back using the same verified release format', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40) }), root = await directory(t);
  const initial = await run(process.execPath, [cli, 'publish', '--from', first.root, '--to', root]);
  assert.equal(JSON.parse(initial.stdout).version, first.version);
  await run(process.execPath, [cli, 'publish', '--from', next.root, '--to', root]);
  await run(process.execPath, [cli, 'rollback', '--to', root, '--version', first.version]);
  assert.equal((await current(root)).version, first.version);
  await assert.rejects(run(process.execPath, [cli, 'publish', '--from', first.root, '--to', root, '--r2']));
  await assert.rejects(run(process.execPath, [cli, 'publish', '--from', first.root, '--r2', '--preview']));
});

async function r2Server(t) {
  const objects = new Map(), puts = [], races = new Map(), pauses = new Map(), releases = new Set();
  const server = createServer(async (request, response) => {
    const key = new URL(request.url, 'http://localhost').pathname.replace(/^\/test-bucket\//, '');
    const pauseKey = `${request.method}:${key}`, pause = pauses.get(pauseKey);
    if (pause) { pauses.delete(pauseKey); pause.enter(); await pause.wait; releases.delete(pause.resume); }
    if (request.method === 'HEAD' || request.method === 'GET') {
      const bytes = objects.get(key);
      if (!bytes) {
        if (races.has(key)) { objects.set(key, races.get(key)); races.delete(key); }
        response.writeHead(404); response.end(); return;
      }
      response.writeHead(200, { 'Content-Length':bytes.length, ETag:`"${digest(bytes)}"` });
      response.end(request.method === 'HEAD' ? undefined : bytes); return;
    }
    if (request.method === 'PUT') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      if (objects.has(key) && request.headers['if-none-match'] === '*') { response.writeHead(412); response.end(); return; }
      if (request.headers['if-match'] && request.headers['if-match'] !== (objects.has(key) ? `"${digest(objects.get(key))}"` : undefined)) { response.writeHead(412); response.end(); return; }
      objects.set(key, Buffer.concat(chunks)); puts.push({ key, headers:request.headers });
      response.writeHead(200, { ETag:`"${digest(objects.get(key))}"` }); response.end(); return;
    }
    response.writeHead(405); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const resume of releases) resume(); return new Promise(resolve => server.close(resolve)); });
  const { S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ endpoint:`http://127.0.0.1:${server.address().port}`, region:'auto', forcePathStyle:true, credentials:{ accessKeyId:'test-key', secretAccessKey:'test-secret' }, requestChecksumCalculation:'WHEN_REQUIRED' });
  t.after(() => client.destroy());
  function pauseNext(method, key) {
    let enter, resume;
    const reached = new Promise(resolve => { enter = resolve; }), wait = new Promise(resolve => { resume = resolve; });
    pauses.set(`${method}:${key}`, { enter, wait, resume }); releases.add(resume);
    return { reached, resume };
  }
  return { objects, puts, races, pauseNext, store:await createR2Store({ bucket:'test-bucket', client }) };
}

test('the R2 adapter uploads immutable objects conditionally and skips unchanged images', async t => {
  const first = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40), title:'Updated R2 video' });
  const remote = await r2Server(t);
  await publishSnapshot({ fromDir:first.root, store:remote.store });
  const result = await publishSnapshot({ fromDir:next.root, store:remote.store });
  assert.equal(result.uploadedImages, 0); assert.equal(result.reusedImages, 1);
  assert.equal(remote.puts.filter(put => put.key.startsWith('images/')).length, 1);
  assert.equal(remote.puts.at(-1).key, 'current.json');
  assert.equal(JSON.parse(remote.objects.get('current.json')).version, next.version);
  for (const put of remote.puts.filter(put => put.key !== 'current.json')) {
    assert.equal(put.headers['if-none-match'], '*');
    assert.equal(put.headers['cache-control'], 'public, max-age=31536000, immutable');
  }
  assert.equal(remote.puts.at(-1).headers['cache-control'], 'no-store');
});

test('a revision that becomes stale during R2 uploads leaves current unchanged after its final check', { timeout:5000 }, async t => {
  const original = await snapshot(t), queued = await snapshot(t, { revision:'b'.repeat(40) }), remote = await r2Server(t);
  await publishSnapshot({ fromDir:original.root, store:remote.store });
  const previous = Buffer.from(remote.objects.get('current.json'));
  let latestMain = queued.manifest.sourceRevision;
  const pause = remote.pauseNext('PUT', `snapshots/${queued.version}/index.json`);
  const delayed = publishSnapshot({
    fromDir:queued.root,
    store:remote.store,
    beforeCurrent:async ({ sourceRevision }) => sourceRevision === latestMain,
  });
  await pause.reached;
  latestMain = 'c'.repeat(40);
  pause.resume();
  const result = await delayed;
  assert.deepEqual(remote.objects.get('current.json'), previous);
  assert.equal(result.currentUpdated, false);
  assert.equal(remote.puts.filter(put => put.key === 'current.json').length, 1);
  for (const [name, bytes] of queued.files) if (!name.startsWith('assets/')) {
    assert.deepEqual(remote.objects.get(`snapshots/${queued.version}/${name}`), bytes);
  }
  assert.equal(JSON.parse(remote.objects.get(`snapshots/${queued.version}/release.json`)).version, queued.version);
  assert.deepEqual(remote.objects.get(`images/${digest(IMAGE)}.png`), IMAGE);
});

test('a latest-main final check runs after all immutable files and permits the conditional pointer update', async t => {
  const source = await snapshot(t), remote = await r2Server(t);
  let checked = false;
  const result = await publishSnapshot({
    fromDir:source.root,
    store:remote.store,
    beforeCurrent:async ({ sourceRevision }) => {
      for (const [name, bytes] of source.files) if (!name.startsWith('assets/')) {
        assert.deepEqual(remote.objects.get(`snapshots/${source.version}/${name}`), bytes);
      }
      assert.equal(JSON.parse(remote.objects.get(`snapshots/${source.version}/release.json`)).version, source.version);
      assert.equal(remote.objects.has('current.json'), false);
      checked = true;
      return sourceRevision === REVISION;
    },
  });
  assert.equal(checked, true);
  assert.equal(result.currentUpdated, true);
  assert.equal(JSON.parse(remote.objects.get('current.json')).version, source.version);
  assert.equal(remote.puts.at(-1).headers['if-none-match'], '*');
});

test('a failed final main check leaves the previous R2 pointer unchanged', async t => {
  const original = await snapshot(t), next = await snapshot(t, { revision:'b'.repeat(40) }), remote = await r2Server(t);
  await publishSnapshot({ fromDir:original.root, store:remote.store });
  const previous = Buffer.from(remote.objects.get('current.json'));
  await assert.rejects(publishSnapshot({
    fromDir:next.root,
    store:remote.store,
    beforeCurrent:async () => { throw new Error('Latest main could not be verified'); },
  }), /main.*verified/i);
  assert.deepEqual(remote.objects.get('current.json'), previous);
  assert.equal(JSON.parse(remote.objects.get(`snapshots/${next.version}/release.json`)).version, next.version);
});

test('the R2 adapter refuses an immutable collision even when another writer wins the initial read', async t => {
  const remote = await r2Server(t), key = 'images/collision.png';
  remote.races.set(key, Buffer.from('existing'));
  await assert.rejects(remote.store.putImmutable(key, IMAGE), /immutable|different|conflict/i);
  assert.equal(remote.objects.get(key).toString(), 'existing');
  assert.equal(await remote.store.get('missing.json'), null);
  assert.equal(await remote.store.head('missing.json'), null);
  await assert.rejects(remote.store.get('../outside'), /path|key/i);
});

test('an initial R2 publication cannot replace a concurrent publisher that creates current first', { timeout:5000 }, async t => {
  const slow = await snapshot(t), winner = await snapshot(t, { revision:'b'.repeat(40) }), remote = await r2Server(t);
  const pause = remote.pauseNext('PUT', 'current.json');
  const delayed = publishSnapshot({ fromDir:slow.root, store:remote.store });
  await pause.reached;
  try { await publishSnapshot({ fromDir:winner.root, store:remote.store }); }
  finally { pause.resume(); }
  await assert.rejects(delayed, /current.*changed|concurrent/i);
  assert.equal(JSON.parse(remote.objects.get('current.json')).version, winner.version);
});

test('R2 publication captures the current ETag before uploading immutable files', { timeout:5000 }, async t => {
  const original = await snapshot(t), slow = await snapshot(t, { revision:'b'.repeat(40) }), winner = await snapshot(t, { revision:'c'.repeat(40) }), remote = await r2Server(t);
  await publishSnapshot({ fromDir:original.root, store:remote.store });
  const pause = remote.pauseNext('PUT', `snapshots/${slow.version}/index.json`);
  const delayed = publishSnapshot({ fromDir:slow.root, store:remote.store });
  await pause.reached;
  try { await publishSnapshot({ fromDir:winner.root, store:remote.store }); }
  finally { pause.resume(); }
  await assert.rejects(delayed, /current.*changed|concurrent/i);
  assert.equal(JSON.parse(remote.objects.get('current.json')).version, winner.version);
});

test('R2 rollback captures the current ETag before reading and verifying its old release', { timeout:5000 }, async t => {
  const old = await snapshot(t), original = await snapshot(t, { revision:'b'.repeat(40) }), winner = await snapshot(t, { revision:'c'.repeat(40) }), remote = await r2Server(t);
  await publishSnapshot({ fromDir:old.root, store:remote.store });
  await publishSnapshot({ fromDir:original.root, store:remote.store });
  const pause = remote.pauseNext('GET', `snapshots/${old.version}/release.json`);
  const delayed = rollbackPublication({ store:remote.store, version:old.version });
  await pause.reached;
  try { await publishSnapshot({ fromDir:winner.root, store:remote.store }); }
  finally { pause.resume(); }
  await assert.rejects(delayed, /current.*changed|concurrent/i);
  assert.equal(JSON.parse(remote.objects.get('current.json')).version, winner.version);
});

test('R2 publication errors never print runtime credential values', async t => {
  const source = await snapshot(t);
  await assert.rejects(run(process.execPath, [cli, 'publish', '--from', source.root, '--r2'], { env:{ ...process.env, CATALOG_R2_ACCOUNT_ID:'invalid-account', CATALOG_R2_BUCKET:'test-bucket', CATALOG_R2_ACCESS_KEY_ID:'credential-must-stay-private', CATALOG_R2_SECRET_ACCESS_KEY:'secret-must-stay-private' } }), error => {
    assert.doesNotMatch(error.stderr, /credential-must-stay-private|secret-must-stay-private/);
    assert.match(error.stderr, /R2 configuration/i);
    return true;
  });
});
