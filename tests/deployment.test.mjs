import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { indexItem } from '../scripts/lib/site-contract.mjs';
import { buildStaticPublication } from '../scripts/lib/publication.mjs';
import { deployData, parseDeploymentOptions, deploymentMetadata } from '../scripts/lib/deployment.mjs';

const PRODUCTION = 'skills-hub-collections';
const PREVIEW = `${PRODUCTION}-pr-4`;
const REVISION = 'a'.repeat(40);
const ID = 'de64301b-09cf-4968-9fc2-24ede5cd4dd6';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, { preview = false } = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'catalog-deployment-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const fromDir = path.join(rootDir, 'snapshot');
  await mkdir(fromDir);
  const document = JSON.parse(await readFile(new URL(`./fixtures/site/${ID}.json`, import.meta.url), 'utf8'));
  document.category = 'media';
  document.verification.source = document.verification.files = 'verified';
  document.skills.forEach(skill => { skill.resourceCheck = 'verified'; });
  const files = new Map([
    ['index.json', Buffer.from(JSON.stringify({ schemaVersion: 1, collections: [indexItem(document)] }) + '\n')],
    [`${ID}.json`, Buffer.from(JSON.stringify(document) + '\n')],
  ]);
  const manifest = { schemaVersion: 1, preview, sourceRevision: REVISION, files: [...files].map(([name, bytes]) => ({ path: name, sha256: digest(bytes), size: bytes.length })) };
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest) + '\n'));
  for (const [name, bytes] of files) await writeFile(path.join(fromDir, name), bytes);
  const publication = await buildStaticPublication({ fromDir, outDir: path.join(rootDir, 'dist/assets'), allowPreview: preview });
  return { rootDir, publication, resultFile: path.join(rootDir, 'dist/deployment.json') };
}

function event(workerName, target = `${workerName}.fixture.workers.dev`, extra = {}) {
  return JSON.stringify({ type: 'deploy', version: 1, worker_name: workerName, version_id: 'f597e68d-96b0-441f-827b-55c07926ea6d', targets: [target], ...extra }) + '\n';
}

test('deployment options accept dry runs and only isolated PR Worker names', () => {
  assert.deepEqual(parseDeploymentOptions([]), { dryRun: false, workerName: PRODUCTION });
  assert.deepEqual(parseDeploymentOptions(['--name', PREVIEW, '--dry-run']), { dryRun: true, workerName: PREVIEW });
  for (const args of [
    ['--name'], ['--name', PRODUCTION], ['--name', 'other-worker'], ['--name', `${PRODUCTION}-pr-0`],
    ['--name', `${PRODUCTION}-pr-04`], ['--name', `${PRODUCTION}-pr-${'1'.repeat(64)}`],
    ['--env', 'production'], ['--dry-run', '--dry-run'], ['--name', PREVIEW, '--name', PREVIEW],
  ]) assert.throws(() => parseDeploymentOptions(args), /name|option/i);
});

test('preview assets cannot reach the production Worker and stale success records are removed', async t => {
  const { rootDir, resultFile } = await fixture(t, { preview: true });
  await writeFile(resultFile, '{"url":"https://stale.fixture.workers.dev"}');
  let invoked = false;
  await assert.rejects(deployData({ rootDir, runWrangler: async () => { invoked = true; return 0; } }), /preview/i);
  assert.equal(invoked, false);
  await assert.rejects(readFile(resultFile), { code: 'ENOENT' });
});

test('isolated PR deployment records only verified public metadata from structured Wrangler output', async t => {
  const { rootDir, publication, resultFile } = await fixture(t, { preview: true });
  let outputPath;
  const result = await deployData({ rootDir, args: ['--name', PREVIEW], environment: { WRANGLER_CI_OVERRIDE_NAME: PRODUCTION }, runWrangler: async ({ command, env }) => {
    assert.deepEqual(command.slice(-2), ['--name', PREVIEW]);
    assert.equal(env.WRANGLER_CI_OVERRIDE_NAME, PREVIEW);
    assert.equal(env.WRANGLER_SEND_METRICS, 'false');
    outputPath = env.WRANGLER_OUTPUT_FILE_PATH;
    await writeFile(outputPath, JSON.stringify({ type: 'log', secret: 'unrelated private data' }) + '\n' + event(PREVIEW, undefined, { secret: 'unrelated private data' }));
    return 0;
  } });
  assert.deepEqual(result, { url: `https://${PREVIEW}.fixture.workers.dev`, sourceRevision: REVISION, version: publication.version, preview: true });
  assert.deepEqual(JSON.parse(await readFile(resultFile, 'utf8')), result);
  assert.equal((await readFile(resultFile, 'utf8')).includes('private data'), false);
  await assert.rejects(readFile(outputPath), { code: 'ENOENT' });
});

test('production uses its fixed Worker name and accepts a structured HTTPS target', async t => {
  const { rootDir, resultFile } = await fixture(t);
  const result = await deployData({ rootDir, runWrangler: async ({ command, env }) => {
    assert.deepEqual(command.slice(-2), ['--name', PRODUCTION]);
    await writeFile(env.WRANGLER_OUTPUT_FILE_PATH, event(PRODUCTION, `https://${PRODUCTION}.fixture.workers.dev/`));
    return 0;
  } });
  assert.equal(result.url, `https://${PRODUCTION}.fixture.workers.dev`);
  assert.equal(result.preview, false);
  assert.deepEqual(JSON.parse(await readFile(resultFile, 'utf8')), result);
});

test('a dry run can package preview assets without a deployment success record', async t => {
  const { rootDir, publication, resultFile } = await fixture(t, { preview: true });
  await writeFile(resultFile, '{"url":"https://stale.fixture.workers.dev"}');
  const result = await deployData({ rootDir, args: ['--dry-run'], runWrangler: async ({ command }) => {
    assert.ok(command.includes('--dry-run'));
    return 0;
  } });
  assert.deepEqual(result, { dryRun: true, sourceRevision: REVISION, version: publication.version, preview: true });
  await assert.rejects(readFile(resultFile), { code: 'ENOENT' });
});

test('Wrangler failure and missing deployment output leave no success record', async t => {
  const { rootDir, resultFile } = await fixture(t);
  for (const runWrangler of [async () => 1, async () => 0]) {
    await writeFile(resultFile, '{"url":"https://stale.fixture.workers.dev"}');
    await assert.rejects(deployData({ rootDir, runWrangler }), /Wrangler|output|deployment/i);
    await assert.rejects(readFile(resultFile), { code: 'ENOENT' });
  }
});

test('deployment URL extraction rejects aborted, ambiguous and unsafe destinations', () => {
  const snapshot = { release: { sourceRevision: REVISION, version: 'b'.repeat(64), preview: true } };
  const unsafe = [
    'https://other-worker.fixture.workers.dev', `https://${PREVIEW}.fixture.workers.dev.evil.example`,
    `http://${PREVIEW}.fixture.workers.dev`, `https://user:password@${PREVIEW}.fixture.workers.dev`,
    `https://${PREVIEW}.fixture.workers.dev:8443`, `https://${PREVIEW}.fixture.workers.dev/path`,
    `https://${PREVIEW}.fixture.workers.dev?token=hidden`, `https://${PREVIEW}.fixture.workers.dev#fragment`,
  ];
  for (const output of [
    '', 'not JSON\n', event(PRODUCTION), event(PREVIEW, undefined, { version_id: null }),
    event(PREVIEW, undefined, { version: 2 }), event(PREVIEW) + event(PREVIEW),
    ...unsafe.map(target => event(PREVIEW, target)),
  ]) assert.throws(() => deploymentMetadata(output, { workerName: PREVIEW, snapshot }), /Wrangler|deployment|URL|output/i);
});
