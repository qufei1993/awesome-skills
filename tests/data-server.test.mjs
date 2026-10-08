import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const version = 'a'.repeat(64);
const image = 'b'.repeat(64);

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'catalog-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'snapshots', version), { recursive: true });
  await mkdir(path.join(directory, 'images'));
  await writeFile(path.join(directory, 'current.json'), '{"version":"first"}');
  await writeFile(path.join(directory, 'snapshots', version, 'index.json'), '{"collections":[]}');
  await writeFile(path.join(directory, 'images', `${image}.png`), Buffer.from([137, 80, 78, 71]));
  await writeFile(path.join(directory, 'private.txt'), 'not-public');
  let module;
  try { module = await import('../scripts/lib/data-server.mjs'); } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  assert.equal(typeof module?.startDataServer, 'function', 'local published-data server must exist');
  const server = await module.startDataServer({ directory, port: 0 });
  t.after(() => server.close());
  return { directory, server };
}

test('current data is readable by the website and bypasses stale browser caches', async t => {
  const { server } = await fixture(t);
  const response = await fetch(`${server.url}/current.json`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { version: 'first' });
});

test('data publication changes become visible without restarting the data server', async t => {
  const { directory, server } = await fixture(t);
  assert.deepEqual(await (await fetch(`${server.url}/current.json`)).json(), { version: 'first' });
  await writeFile(path.join(directory, 'current.json'), '{"version":"second"}');
  assert.deepEqual(await (await fetch(`${server.url}/current.json`)).json(), { version: 'second' });
});

test('versioned index and content-addressed images retain immutable caching and MIME types', async t => {
  const { server } = await fixture(t);
  const index = await fetch(`${server.url}/snapshots/${version}/index.json`);
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const cover = await fetch(`${server.url}/images/${image}.png`);
  assert.equal(cover.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await cover.arrayBuffer()), Buffer.from([137, 80, 78, 71]));
  const head = await fetch(`${server.url}/images/${image}.png`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '4');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('local website data access rejects writes and never serves nonpublication files', async t => {
  const { server } = await fixture(t);
  assert.equal((await fetch(`${server.url}/current.json`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${server.url}/private.txt`)).status, 404);
  assert.equal((await fetch(`${server.url}/snapshots/${version}/../../private.txt`)).status, 404);
  assert.equal((await fetch(`${server.url}/images/%2e%2e%2fprivate.txt`)).status, 404);
  const options = await fetch(`${server.url}/current.json`, { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
});
