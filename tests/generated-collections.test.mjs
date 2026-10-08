import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCatalog } from '../scripts/lib/catalog.mjs';
import { verifySnapshot } from '../scripts/lib/snapshot.mjs';
import { fixtureUpstream, PNG, skillText, UPSTREAM_SHA, writeSubmission } from './helpers/submission.mjs';

async function fixture(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'generated-collections-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const request = fixtureUpstream({ repositories: {
    'example/tools': { 'skills/plan/SKILL.md': skillText('plan', 'Plan before implementing.'), 'skills/nested/review/SKILL.md': skillText('review', 'Review completed work.'), 'outside/SKILL.md': skillText('outside') },
    'another/design': { 'SKILL.md': skillText('design', 'Create a clear interface.') },
  } });
  await writeSubmission(rootDir, { slug: 'engineering', title: 'Engineering', cover: { url: 'https://images.example.com/engineering.png', alt: 'Engineering cover' } });
  await writeSubmission(rootDir, { slug: 'design', category: 'design', title: 'Design', links: [`https://github.com/another/design/blob/${UPSTREAM_SHA}/SKILL.md`] });
  const { directory } = await writeSubmission(rootDir, { slug: 'video', category: 'media', title: 'Product Video', cover: { url: 'images/cover.png', alt: 'Video cover' }, links: [`https://github.com/example/tools/blob/${UPSTREAM_SHA}/skills/plan/SKILL.md`, `https://github.com/another/design/blob/${UPSTREAM_SHA}/SKILL.md`] });
  await mkdir(path.join(directory, 'images'));
  await writeFile(path.join(directory, 'images/cover.png'), PNG);
  return { rootDir, request };
}

test('README collections generate website details for directory and mixed repository selections', async t => {
  const { rootDir, request } = await fixture(t);
  const result = await buildCatalog({ rootDir, preview: true, resolveSources: true, request, sourceRevision: UPSTREAM_SHA });
  assert.equal(result.records.length, 3);
  assert.equal(result.incomplete.length, 0);
  assert.deepEqual(Object.fromEntries(result.index.collections.map(item => [item.slug, [item.itemCount, item.installationCount]])), { engineering: [2, 2], design: [1, 1], video: [2, 2] });
  const engineering = result.records.find(record => record.slug === 'engineering');
  assert.deepEqual(engineering.skills.map(item => item.originalDescription), ['Review completed work.', 'Plan before implementing.']);
  assert.ok(engineering.skills.every(item => item.entry.commit === UPSTREAM_SHA));
  assert.equal(engineering.cover.url, 'https://images.example.com/engineering.png');
  const video = result.records.find(record => record.slug === 'video');
  assert.equal(video.category, 'media');
  assert.deepEqual(video.skills.map(item => item.entry.repo), ['example/tools', 'another/design']);
  assert.deepEqual(await readFile(path.join(result.outputDir, `assets/${video.id}/cover.png`)), PNG);
  const verified = await verifySnapshot({ fromDir: result.outputDir, allowPreview: true, expectedRevision: UPSTREAM_SHA });
  assert.equal(verified.index.collections.length, 3);
});

test('newly generated collections wait for approval before production publication', async t => {
  const { rootDir, request } = await fixture(t);
  const pending = await buildCatalog({ rootDir, resolveSources: true, request, sourceRevision: UPSTREAM_SHA });
  assert.deepEqual(pending.index.collections, []);
  const approved = await buildCatalog({ rootDir, resolveSources: true, request, sourceRevision: UPSTREAM_SHA, reviewApproval: { status: 'approved', reviewer: 'Fixture reviewer', reviewedAt: '2026-10-08T00:00:00Z', notes: [] } });
  assert.equal(approved.records.length, 3);
  await verifySnapshot({ fromDir: approved.outputDir, expectedRevision: UPSTREAM_SHA });
  assert.ok(approved.records.every(record => record.verification.installation === 'not-tested' && record.verification.workflow === 'not-tested'));
});

test('adding a collection and editing another updates the generated website directory', async t => {
  const { rootDir, request } = await fixture(t);
  const first = await buildCatalog({ rootDir, preview: true, resolveSources: true, request });
  const old = first.records.find(record => record.slug === 'engineering');
  await writeSubmission(rootDir, { slug: 'engineering', title: 'Engineering updated' });
  await writeSubmission(rootDir, { slug: 'community', category: 'other', title: 'Community selection' });
  const next = await buildCatalog({ rootDir, preview: true, resolveSources: true, request });
  assert.equal(next.index.collections.length, 4);
  const updated = next.records.find(record => record.slug === 'engineering');
  assert.equal(updated.id, old.id);
  assert.equal(updated.revision, old.revision + 1);
  assert.equal(updated.title, 'Engineering updated');
  assert.equal(next.records.find(record => record.slug === 'community').skills.length, 2);
});
