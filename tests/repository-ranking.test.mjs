import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rankCollections } from '../scripts/lib/repository-ranking.mjs';

const NOW = Date.parse('2026-10-11T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const slugs = records => records.map(record => record.document.slug);
function record(slug, { repo = `example/${slug}`, sourceUrl = `https://github.com/${repo}`, repos = [repo], sortOrder = 0, evidence = false } = {}) {
  return {
    language: 'en',
    publicReadmes: sourceUrl === undefined || evidence ? {} : { en: { sourceUrl } },
    document: {
      slug, sortOrder, revision: 3, review: { status: 'approved' },
      skills: repos.map(repository => ({ entry: { repo: repository } })),
      provenance: { evidence: evidence ? [{ id: 'collection-source', url: sourceUrl }] : [] },
    },
  };
}
async function temporary(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'repository-ranking-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return rootDir;
}
function warnings(t) {
  const messages = [];
  t.mock.method(console, 'warn', message => messages.push(message));
  return messages;
}

test('higher repository stars rank first without changing collection content', async t => {
  const rootDir = await temporary(t);
  const records = [record('alpha'), record('zeta')];
  const before = structuredClone(records);
  const ranked = await rankCollections(records, { rootDir, now: NOW, request: async repo => repo === 'example/zeta' ? 900 : 2 });
  assert.deepEqual(slugs(ranked), ['zeta', 'alpha']);
  assert.deepEqual(records, before);
  assert.equal(ranked[0], records[1]);
});

test('known zero stars rank before unavailable or unranked collections', async t => {
  const rootDir = await temporary(t);
  warnings(t);
  const records = [record('article', { sourceUrl: 'https://publisher.example/article', sortOrder: -10 }), record('missing'), record('zero')];
  const ranked = await rankCollections(records, { rootDir, now: NOW, request: async repo => {
    if (repo === 'example/zero') return 0;
    throw new Error('Unavailable repository');
  } });
  assert.deepEqual(slugs(ranked), ['zero', 'article', 'missing']);
});

test('ties and fully unavailable stars retain sortOrder then slug ordering', async t => {
  const rootDir = await temporary(t);
  warnings(t);
  const records = [record('zeta'), record('early', { sortOrder: -1 }), record('alpha')];
  assert.deepEqual(slugs(await rankCollections(records, { rootDir, now: NOW, request: async () => 5 })), ['early', 'alpha', 'zeta']);
  assert.deepEqual(slugs(await rankCollections(records, { now: NOW, request: async () => { throw new Error('Unavailable'); } })), ['early', 'alpha', 'zeta']);
});

test('articles, mismatched sources and multiple repositories never borrow repository stars', async t => {
  const rootDir = await temporary(t);
  const requests = [];
  const records = [
    record('article', { sourceUrl: 'https://publisher.example/article' }),
    record('mismatch', { sourceUrl: 'https://github.com/another/popular' }),
    record('mixed', { repos: ['example/mixed', 'another/popular'] }),
    record('single'),
  ];
  const ranked = await rankCollections(records, { rootDir, now: NOW, request: async repo => { requests.push(repo); return 20; } });
  assert.deepEqual(slugs(ranked), ['single', 'article', 'mismatch', 'mixed']);
  assert.deepEqual(requests, ['example/single']);
});

test('source evidence and missing attribution identify a unique repository and deduplicate requests', async t => {
  const rootDir = await temporary(t);
  const first = record('one', { repo: 'Example/Shared', sourceUrl: 'https://github.com/example/shared/tree/main/skills', evidence: true });
  const second = record('two', { repo: 'example/shared' });
  second.publicReadmes = {};
  let requests = 0;
  const ranked = await rankCollections([second, first], { rootDir, now: NOW, request: async repo => {
    requests++;
    assert.equal(repo, 'example/shared');
    return 10;
  } });
  assert.deepEqual(slugs(ranked), ['one', 'two']);
  assert.equal(requests, 1);
});

test('fresh repository cache avoids requests independently of collection input', async t => {
  const rootDir = await temporary(t);
  await rankCollections([record('alpha'), record('zeta')], { rootDir, now: NOW, request: async repo => repo === 'example/zeta' ? 900 : 2 });
  const changed = [record('alpha'), record('zeta')];
  changed[0].document.revision = 9;
  const ranked = await rankCollections(changed, { rootDir, now: NOW + DAY - 1, request: async () => { assert.fail('Fresh cache must avoid repository requests'); } });
  assert.deepEqual(slugs(ranked), ['zeta', 'alpha']);
  assert.equal(changed[0].document.revision, 9);
});

test('expired stars refresh and can change the generated order', async t => {
  const rootDir = await temporary(t);
  const records = [record('alpha'), record('zeta')];
  await rankCollections(records, { rootDir, now: NOW, request: async repo => repo === 'example/zeta' ? 900 : 2 });
  const ranked = await rankCollections(records, { rootDir, now: NOW + DAY, request: async repo => repo === 'example/alpha' ? 1000 : 100 });
  assert.deepEqual(slugs(ranked), ['alpha', 'zeta']);
});

test('failed refresh keeps last known counts and does not extend their freshness', async t => {
  const rootDir = await temporary(t);
  const messages = warnings(t);
  const records = [record('alpha'), record('zeta')];
  await rankCollections(records, { rootDir, now: NOW, request: async repo => repo === 'example/zeta' ? 900 : 2 });
  const cachePath = path.join(rootDir, 'dist/repository-stars.json');
  const before = JSON.parse(await readFile(cachePath, 'utf8'));
  const ranked = await rankCollections(records, { rootDir, now: NOW + DAY, request: async () => { throw new Error('secret-value-in-stderr'); } });
  assert.deepEqual(slugs(ranked), ['zeta', 'alpha']);
  assert.deepEqual(JSON.parse(await readFile(cachePath, 'utf8')), before);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /2/);
  assert.doesNotMatch(messages[0], /secret|example|alpha|zeta/);
});

test('invalid star responses remain unknown and never replace a cached value with zero', async t => {
  const rootDir = await temporary(t);
  warnings(t);
  const records = [record('old'), record('zero'), record('invalid')];
  await rankCollections(records.slice(0, 1), { rootDir, now: NOW, request: async () => 30 });
  const ranked = await rankCollections(records, { rootDir, now: NOW + DAY, request: async repo => repo === 'example/zero' ? 0 : null });
  assert.deepEqual(slugs(ranked), ['old', 'zero', 'invalid']);
  const cached = JSON.parse(await readFile(path.join(rootDir, 'dist/repository-stars.json'), 'utf8'));
  assert.equal(cached.repositories['example/old'].count, 30);
  assert.equal(cached.repositories['example/old'].checkedAt, NOW);
  assert.equal(cached.repositories['example/invalid'], undefined);
});

test('negative, fractional, non-numeric and unsafe star counts stay unknown', async t => {
  const rootDir = await temporary(t);
  warnings(t);
  const invalid = new Map([
    ['negative', -1], ['fractional', 1.5], ['string', '0'], ['missing', undefined],
    ['not-a-number', NaN], ['infinity', Infinity], ['overflow', Number.MAX_SAFE_INTEGER + 1],
  ]);
  const records = [...invalid.keys()].map(slug => record(slug));
  records.push(record('zero'));
  const ranked = await rankCollections(records, { rootDir, now: NOW, request: async repo => {
    const slug = repo.split('/')[1];
    return slug === 'zero' ? 0 : invalid.get(slug);
  } });
  assert.equal(ranked[0].document.slug, 'zero');
  const cached = JSON.parse(await readFile(path.join(rootDir, 'dist/repository-stars.json'), 'utf8'));
  assert.deepEqual(Object.keys(cached.repositories), ['example/zero']);
});

test('repository refresh concurrency remains at most six', async t => {
  const rootDir = await temporary(t);
  let active = 0, maximum = 0;
  const records = Array.from({ length: 15 }, (_, index) => record(`repo-${index}`));
  const ranked = await rankCollections(records, { rootDir, now: NOW, request: async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return 1;
  } });
  assert.equal(ranked.length, 15);
  assert.ok(maximum > 1);
  assert.ok(maximum <= 6);
});

test('unsafe repository names and source URLs never enter outbound requests', async t => {
  const rootDir = await temporary(t);
  const records = [
    record('unsafe', { repo: 'example/../secret' }),
    record('credentials', { sourceUrl: 'https://user:secret@github.com/example/credentials' }),
    record('encoded', { sourceUrl: 'https://github.com/example%2fother/encoded' }),
  ];
  const ranked = await rankCollections(records, { rootDir, now: NOW, request: async () => assert.fail('Unsafe source must not issue a request') });
  assert.deepEqual(slugs(ranked), ['credentials', 'encoded', 'unsafe']);
});
