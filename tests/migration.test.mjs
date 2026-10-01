import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCollectionMarkdown, serializeCollectionMarkdown } from '../scripts/lib/markdown.mjs';
import { buildCatalog, loadCatalog } from '../scripts/lib/catalog.mjs';
import { indexItem, validateCollection } from '../scripts/lib/site-contract.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const historicalCollections = path.join(project, 'tests/fixtures/migrated/collections');
const ids = [
  ['e3a003dc-3ea5-4cc5-b5a4-088d1b74985c', 'taste', 'cover.webp'],
  ['d2ca0659-07ee-44a5-8d99-d3295f5e2f0c', 'engineering', 'cover.png'],
  ['de64301b-09cf-4968-9fc2-24ede5cd4dd6', 'product-video', undefined],
];
const reviewNote = '新仓库接入等待来源、资源与封面审核';
const curator = { name: 'Skills Hub', url: 'https://github.com/qufei1993/awesome-skills' };

async function original(id) {
  return JSON.parse(await readFile(path.join(project, 'tests/fixtures/site', `${id}.json`), 'utf8'));
}

test('three migrated fixtures preserve original content with pending review and explicit curator', async () => {
  assert.deepEqual((await readdir(historicalCollections)).sort(), ['engineering', 'product-video', 'taste']);
  for (const [id, slug, coverFile] of ids) {
    const expected = await original(id);
    expected.review = { status: 'pending', notes: [...expected.review.notes, reviewNote] };
    expected.curator = curator;
    const filename = path.join(historicalCollections, slug, 'README.md');
    const parsed = parseCollectionMarkdown(await readFile(filename, 'utf8'), { filename });
    assert.deepEqual(parsed.document, expected, slug);
    assert.equal(parsed.language, 'zh');
    assert.equal(parsed.coverFile, coverFile);
    assert.deepEqual(parsed.curator, { name: 'Skills Hub', url: 'https://github.com/qufei1993/awesome-skills' });
    if (coverFile) {
      const bytes = await readFile(path.join(historicalCollections, slug, coverFile));
      assert.ok(bytes.length > 1000);
      assert.equal(parsed.document.cover.url, (await original(id)).cover.url);
      if (coverFile.endsWith('.webp')) {
        assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
        assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
      } else assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
  }
});

test('real migrated preview matches website details and index while production exports zero unapproved collections', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await cp(historicalCollections, path.join(rootDir, 'collections'), { recursive: true });
  await writeFile(path.join(rootDir, 'README.md'), '# Migration integration test\n');
  const preview = await buildCatalog({ rootDir, preview: true, outputDir: path.join(rootDir, 'preview') });
  assert.equal(preview.records.length, 3);
  assert.equal(preview.manifest.preview, true);
  assert.deepEqual(Object.fromEntries(preview.index.collections.map(item => [item.slug, [item.itemCount, item.installationCount]])), {
    taste: [13, 13], engineering: [31, 31], 'product-video': [3, 14],
  });
  assert.deepEqual(preview.records.map(item => item.slug), ['taste', 'engineering', 'product-video']);
  for (const [id, slug, coverFile] of ids) {
    const detail = JSON.parse(await readFile(path.join(preview.outputDir, `${id}.json`), 'utf8'));
    const expected = await original(id);
    expected.review = { status: 'pending', notes: [...expected.review.notes, reviewNote] };
    expected.curator = curator;
    if (coverFile) expected.cover.url = `/data/collections/assets/${id}/${coverFile}`;
    assert.deepEqual(detail, expected, slug);
    await validateCollection(detail, `${id}.json`, rootDir, {
      validateLocalCover: url => stat(path.join(preview.outputDir, url.slice('/data/collections/'.length))),
    });
    assert.deepEqual(preview.index.collections.find(item => item.id === id), indexItem(detail));
    if (coverFile) assert.deepEqual(await readFile(path.join(preview.outputDir, 'assets', id, coverFile)), await readFile(path.join(rootDir, 'collections', slug, coverFile)));
    assert.equal(detail.verification.installation, 'not-tested');
    assert.equal(detail.verification.workflow, 'not-tested');
  }
  const production = await buildCatalog({ rootDir, outputDir: path.join(rootDir, 'production') });
  assert.deepEqual(production.records, []);
  assert.deepEqual(production.index, { schemaVersion: 1, collections: [] });
  assert.equal(production.manifest.preview, false);
  assert.deepEqual(production.manifest.files.map(file => file.path), ['index.json']);
});

test('historical migration assertions permit a fourth community draft and a revised live collection', async t => {
  const copy = await mkdtemp(path.join(os.tmpdir(), 'migration-evolution-test-'));
  t.after(() => rm(copy, { recursive: true, force: true }));
  await cp(path.join(project, 'scripts/lib'), path.join(copy, 'scripts/lib'), { recursive: true });
  await cp(path.join(project, 'tests/fixtures'), path.join(copy, 'tests/fixtures'), { recursive: true });
  await cp(path.join(project, 'tests/migration.test.mjs'), path.join(copy, 'tests/migration.test.mjs'));
  await symlink(path.join(project, 'node_modules'), path.join(copy, 'node_modules'));
  await cp(historicalCollections, path.join(copy, 'collections'), { recursive: true });
  const tasteFile = path.join(copy, 'collections/taste/README.md');
  const taste = parseCollectionMarkdown(await readFile(tasteFile, 'utf8'));
  taste.document.description += '（社区更新）';
  taste.document.revision += 1;
  taste.document.updatedAt = '2026-10-02T00:00:00Z';
  await writeFile(tasteFile, serializeCollectionMarkdown(taste.document, taste));
  const fourth = await original(ids[2][0]);
  fourth.id = randomUUID();
  fourth.slug = 'community-fourth';
  fourth.sourceKeys = ['editorial:community-fourth'];
  fourth.status = 'draft';
  fourth.review = { status: 'pending', notes: [] };
  await mkdir(path.join(copy, 'collections', fourth.slug));
  await writeFile(path.join(copy, 'collections', fourth.slug, 'README.md'), serializeCollectionMarkdown(fourth));
  assert.equal((await loadCatalog({ rootDir: copy })).length, 4);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await promisify(execFile)(process.execPath, ['--test', '--test-name-pattern', 'three migrated|real migrated preview', 'tests/migration.test.mjs'], { cwd: copy, env });
  assert.match(stdout, /# fail 0/);
});
