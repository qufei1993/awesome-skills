import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { indexItem } from '../scripts/lib/site-contract.mjs';
import { buildStaticPublication, readCurrentSnapshot } from '../scripts/lib/publication.mjs';
import { checkStaticData } from '../scripts/check-static-data.mjs';

const ID = 'de64301b-09cf-4968-9fc2-24ede5cd4dd6';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function publication(t, preview=false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'static-data-check-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  const fromDir = path.join(root, 'source'), assetsDir = path.join(root, 'assets');
  const document = JSON.parse(await readFile(new URL(`./fixtures/site/${ID}.json`, import.meta.url), 'utf8'));
  document.category = 'media';
  document.cover = { kind:'source-image', url:`/data/collections/assets/${ID}/cover.png`, sourceUrl:'https://example.com/cover', alt:'Fixture cover', rightsStatus:'verified', rightsEvidenceUrl:'https://example.com/rights' };
  const files = new Map([
    ['index.json', Buffer.from(JSON.stringify({ schemaVersion:1, collections:[indexItem(document)] }))],
    [`${ID}.json`, Buffer.from(JSON.stringify(document))],
    [`assets/${ID}/cover.png`, Buffer.from('89504e470d0a1a0a01020304', 'hex')],
  ]);
  files.set('manifest.json', Buffer.from(JSON.stringify({ schemaVersion:1, sourceRevision:'a'.repeat(40), preview, files:[...files].map(([name, bytes]) => ({ path:name, size:bytes.length, sha256:digest(bytes) })) })));
  for (const [name, bytes] of files) {
    await mkdir(path.dirname(path.join(fromDir, name)), { recursive:true });
    await writeFile(path.join(fromDir, name), bytes);
  }
  await buildStaticPublication({ fromDir, outDir:assetsDir, allowPreview:preview });
  return assetsDir;
}
function staticRequest(assetsDir, overrides={}) {
  return async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    const pathname = new URL(url).pathname.replace(/^\/data\//, '');
    if (overrides[pathname]) return overrides[pathname](url, options);
    let bytes;
    try { bytes = await readFile(path.join(assetsDir, pathname)); }
    catch (error) { if (error.code === 'ENOENT') return new Response('', { status:404 }); throw error; }
    return new Response(bytes, { headers:{ 'Access-Control-Allow-Origin':'*', 'Cache-Control':pathname === 'current.json' ? 'no-store' : 'public, max-age=31536000, immutable', 'Content-Type':pathname.endsWith('.json') ? 'application/json' : 'image/png' } });
  };
}

async function hostedPublication(t, assetsDir, currentResponses, fileResponses={}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const key = new URL(request.url, 'http://localhost').pathname.slice(1);
    requests.push({ key, authorization:request.headers.authorization, cookie:request.headers.cookie });
    const responses = key === 'current.json' ? currentResponses : fileResponses[key];
    const current = responses?.[Math.min(requests.filter(entry => entry.key === key).length - 1, responses.length - 1)];
    if (current?.delayMs) await new Promise(resolve => setTimeout(resolve, current.delayMs));
    let bytes = current?.bytes;
    let status = current?.status ?? 200;
    if (!bytes) {
      try { bytes = await readFile(path.join(assetsDir, key)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; bytes = Buffer.from('Not Found'); status = 404; }
    }
    response.writeHead(status, { 'Access-Control-Allow-Origin':'*', 'Cache-Control':key === 'current.json' ? 'no-store' : 'public, max-age=31536000, immutable', 'Content-Type':key.endsWith('.json') ? 'application/json' : 'image/png' });
    response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { url:`http://127.0.0.1:${server.address().port}`, requests };
}

test('waits for an initially missing and stale hosted pointer before fetching the published snapshot', async t => {
  const assetsDir = await publication(t), pointer = JSON.parse(await readFile(path.join(assetsDir, 'current.json')));
  const stale = Buffer.from(JSON.stringify({ ...pointer, version:'b'.repeat(64), sourceRevision:'b'.repeat(40), snapshotPath:`snapshots/${'b'.repeat(64)}/` }));
  const host = await hostedPublication(t, assetsDir, [{ status:404, bytes:Buffer.from('Not Found') }, { bytes:stale }, {}]);
  const result = await checkStaticData({ url:host.url, assetsDir, waitTimeoutMs:1000, pollIntervalMs:10 });
  assert.equal(result.version, pointer.version);
  assert.deepEqual(host.requests.slice(0, 3).map(request => request.key), ['current.json', 'current.json', 'current.json']);
  assert.equal(host.requests.filter(request => request.key === 'current.json').length, 3);
  assert.ok(host.requests.some(request => request.key.startsWith('snapshots/')));
  assert.ok(host.requests.every(request => !request.authorization && !request.cookie));
});

test('stops waiting for a persistently mismatched hosted pointer at the deadline without fetching snapshot files', { timeout:5000 }, async t => {
  const assetsDir = await publication(t), host = await hostedPublication(t, assetsDir, [{ bytes:Buffer.from('{}') }]);
  await assert.rejects(checkStaticData({ url:host.url, assetsDir, waitTimeoutMs:100, pollIntervalMs:20 }), error => error.name === 'TimeoutError' || /generated|match/i.test(error.message));
  assert.ok(host.requests.length > 0);
  assert.ok(host.requests.every(request => request.key === 'current.json'));
});

test('fails a forbidden hosted pointer immediately instead of waiting for publication propagation', async t => {
  const assetsDir = await publication(t), host = await hostedPublication(t, assetsDir, [{ status:403, bytes:Buffer.from('Forbidden') }, {}]);
  await assert.rejects(checkStaticData({ url:host.url, assetsDir, waitTimeoutMs:1000, pollIntervalMs:10 }), /HTTP 403/);
  assert.equal(host.requests.length, 1);
});

test('bounds a slow hosted pointer request by the publication wait deadline', async t => {
  const assetsDir = await publication(t), host = await hostedPublication(t, assetsDir, [{ delayMs:300 }]);
  const started = performance.now();
  await assert.rejects(checkStaticData({ url:host.url, assetsDir, waitTimeoutMs:100, pollIntervalMs:10 }), /timeout|timed out/i);
  assert.ok(performance.now() - started < 250);
  assert.equal(host.requests.length, 1);
});

test('waits for snapshot and image files that return 404 after the hosted pointer already matches', async t => {
  const assetsDir = await publication(t), pointer = JSON.parse(await readFile(path.join(assetsDir, 'current.json')));
  const index = `${pointer.snapshotPath}index.json`, image = Object.values(pointer.assets)[0];
  const unavailable = { status:404, bytes:Buffer.from('Not Found') };
  const host = await hostedPublication(t, assetsDir, [{}], { [index]:[unavailable, {}], [image]:[unavailable, {}] });
  const result = await checkStaticData({ url:host.url, assetsDir, waitTimeoutMs:1000, pollIntervalMs:10 });
  assert.equal(result.version, pointer.version);
  assert.equal(host.requests.filter(request => request.key === index).length, 2);
  assert.equal(host.requests.filter(request => request.key === image).length, 2);
  assert.equal(host.requests.filter(request => request.key === 'current.json').length, 1);
  assert.equal(result.checkedFiles, 6);
});

test('stops retrying a persistently missing image at the propagation deadline', { timeout:5000 }, async t => {
  const assetsDir = await publication(t), pointer = JSON.parse(await readFile(path.join(assetsDir, 'current.json')));
  const image = Object.values(pointer.assets)[0];
  const host = await hostedPublication(t, assetsDir, [{}], { [image]:[{ status:404, bytes:Buffer.from('Not Found') }] });
  await assert.rejects(checkStaticData({ url:host.url, assetsDir, waitTimeoutMs:300, pollIntervalMs:20 }), error => error.name === 'TimeoutError' || /missing.*file/i.test(error.message));
  assert.ok(host.requests.some(request => request.key === image));
  assert.equal(host.requests.filter(request => request.key === 'current.json').length, 1);
});

test('continues checking existing files when full verification takes longer than the propagation deadline', async t => {
  const assetsDir = await publication(t), pointer = JSON.parse(await readFile(path.join(assetsDir, 'current.json')));
  const host = await hostedPublication(t, assetsDir, [{}], { [`${pointer.snapshotPath}index.json`]:[{ delayMs:400 }] });
  const result = await checkStaticData({ url:host.url, assetsDir, waitTimeoutMs:250, pollIntervalMs:10 });
  assert.equal(result.version, pointer.version);
  assert.equal(result.checkedFiles, 6);
  assert.ok(host.requests.some(request => request.key.startsWith('images/')));
});

test('fails a forbidden image immediately after a temporary 404 instead of hiding the HTTP error', async t => {
  const assetsDir = await publication(t), pointer = JSON.parse(await readFile(path.join(assetsDir, 'current.json')));
  const image = Object.values(pointer.assets)[0];
  const host = await hostedPublication(t, assetsDir, [{}], { [image]:[{ status:404, bytes:Buffer.from('Not Found') }, { status:403, bytes:Buffer.from('Forbidden') }, {}] });
  await assert.rejects(checkStaticData({ url:host.url, assetsDir, waitTimeoutMs:1000, pollIntervalMs:10 }), /HTTP 403/);
  assert.equal(host.requests.filter(request => request.key === image).length, 2);
});

test('verifies generated data, all published files, CORS, cache and 404 behavior without sending credentials', async t => {
  const assetsDir = await publication(t);
  const result = await checkStaticData({ url:'https://data.example.com/data', assetsDir, request:staticRequest(assetsDir) });
  const pointer = JSON.parse(await readFile(path.join(assetsDir, 'current.json'), 'utf8'));
  assert.equal(result.version, pointer.version); assert.equal(result.count, 1); assert.equal(result.preview, false);
  assert.equal(result.cors, true); assert.equal(result.cache, true); assert.equal(result.notFound, true);
});

test('allows local HTTP for actual Wrangler checks and explicitly permitted preview data', async t => {
  const assetsDir = await publication(t, true), request = staticRequest(assetsDir);
  await assert.rejects(checkStaticData({ url:'http://127.0.0.1:8778/data', assetsDir, request }), /preview/i);
  assert.equal((await checkStaticData({ url:'http://localhost:8778/data', assetsDir, allowPreview:true, request })).preview, true);
});

test('refuses insecure remote URLs, URL credentials and URL parameters before any network request', async t => {
  const assetsDir = await publication(t);
  for (const url of ['http://data.example.com/data', 'https://user:secret@data.example.com/data', 'https://data.example.com/data?token=secret', 'https://data.example.com/data#secret']) {
    await assert.rejects(checkStaticData({ url, assetsDir, request:async () => assert.fail('unsafe URL reached network') }), /URL|HTTPS|credentials|parameters/i);
  }
});

test('fails when hosted current data does not match the local generated publication', async t => {
  const assetsDir = await publication(t);
  const request = staticRequest(assetsDir, { 'current.json':async () => new Response('{}', { headers:{ 'Access-Control-Allow-Origin':'*', 'Cache-Control':'no-store' } }) });
  await assert.rejects(checkStaticData({ url:'https://data.example.com/data', assetsDir, request, waitTimeoutMs:0 }), /generated|match/i);
});

test('fails missing CORS and incorrect current cache before reporting publication success', async t => {
  const assetsDir = await publication(t), bytes = await readFile(path.join(assetsDir, 'current.json'));
  for (const headers of [{ 'Cache-Control':'no-store' }, { 'Access-Control-Allow-Origin':'*', 'Cache-Control':'public, max-age=60' }]) {
    const request = staticRequest(assetsDir, { 'current.json':async () => new Response(bytes, { headers }) });
    await assert.rejects(checkStaticData({ url:'https://data.example.com/data', assetsDir, request }), /CORS|cache/i);
  }
});

test('fails incorrect immutable cache headers on a published image', async t => {
  const assetsDir = await publication(t), pointer = JSON.parse(await readFile(path.join(assetsDir, 'current.json')));
  const image = Object.values(pointer.assets)[0];
  const request = staticRequest(assetsDir, { [image]:async () => new Response(await readFile(path.join(assetsDir, image)), { headers:{ 'Access-Control-Allow-Origin':'*', 'Cache-Control':'no-store' } }) });
  await assert.rejects(checkStaticData({ url:'https://data.example.com/data', assetsDir, request }), /immutable|cache/i);
});

test('fails if a missing resource becomes an HTML page or an HTTP 200 fallback', async t => {
  const assetsDir = await publication(t), good = staticRequest(assetsDir);
  for (const status of [200, 404]) {
    const request = async (url, options) => new URL(url).pathname.includes('/__missing-') ? new Response('<!doctype html><html>Site page</html>', { status, headers:{ 'Content-Type':'text/html' } }) : good(url, options);
    await assert.rejects(checkStaticData({ url:'https://data.example.com/data', assetsDir, request }), /404|HTML|fallback/i);
  }
});

test('refuses redirects and overlarge network responses', async t => {
  const assetsDir = await publication(t);
  for (const response of [new Response('', { status:302, headers:{ Location:'https://other.example.com/' } }), new Response('', { headers:{ 'Content-Length':String(11 * 1024 * 1024) } })]) {
    await assert.rejects(checkStaticData({ url:'https://data.example.com/data', assetsDir, request:async () => response }), /redirect|size/i);
  }
});

test('fails an image checksum mismatch even if hosting headers are correct', async t => {
  const assetsDir = await publication(t), pointer = JSON.parse(await readFile(path.join(assetsDir, 'current.json')));
  const image = Object.values(pointer.assets)[0];
  const request = staticRequest(assetsDir, { [image]:async () => new Response('changed image', { headers:{ 'Access-Control-Allow-Origin':'*', 'Cache-Control':'public, max-age=31536000, immutable' } }) });
  await assert.rejects(checkStaticData({ url:'https://data.example.com/data', assetsDir, request }), /checksum|size/i);
});

test('checks the retained preceding version as well as the current version', async t => {
  const assetsDir = await publication(t);
  const previousSnapshot = await readCurrentSnapshot({ read:async key => {
    try { return await readFile(path.join(assetsDir, key)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  } });
  const fromDir = path.join(path.dirname(assetsDir), 'source');
  const manifestPath = path.join(fromDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  manifest.sourceRevision = 'b'.repeat(40);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await buildStaticPublication({ fromDir, outDir:assetsDir, previousSnapshot });
  const result = await checkStaticData({ url:'https://data.example.com/data', assetsDir, request:staticRequest(assetsDir) });
  assert.deepEqual(result.retainedVersions, [previousSnapshot.release.version]);
  const missingIndex = `${previousSnapshot.release.snapshotPath}index.json`;
  await assert.rejects(checkStaticData({ url:'https://data.example.com/data', assetsDir, waitTimeoutMs:0, request:staticRequest(assetsDir, { [missingIndex]:async () => new Response('', { status:404 }) }) }), /missing.*file/i);
});

test('limits streamed response bytes even when Content-Length is absent', async t => {
  const assetsDir = await publication(t);
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(6 * 1024 * 1024));
    controller.enqueue(new Uint8Array(6 * 1024 * 1024));
    controller.close();
  } });
  await assert.rejects(checkStaticData({ url:'https://data.example.com/data', assetsDir, request:async () => new Response(stream) }), /size/i);
});
