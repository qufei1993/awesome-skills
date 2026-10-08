import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { readCurrentSnapshot } from './publication.mjs';

const PRODUCTION = 'skills-hub-collections';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function parseDeploymentOptions(args) {
  let dryRun = false, workerName = PRODUCTION, named = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run' && !dryRun) dryRun = true;
    else if (args[i] === '--name' && !named) {
      workerName = args[++i];
      if (!/^skills-hub-collections-pr-[1-9]\d*$/.test(workerName ?? '') || workerName.length > 63) {
        throw new Error('Preview name must be skills-hub-collections-pr-<PR number>');
      }
      named = true;
    } else throw new Error('Unknown or duplicate deployment option');
  }
  return { dryRun, workerName };
}

export function deploymentMetadata(output, { workerName, snapshot }) {
  let entries;
  try {
    if (typeof output !== 'string' || Buffer.byteLength(output) > 1024 * 1024) throw new Error();
    entries = output.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  } catch { throw new Error('Invalid structured Wrangler deployment output'); }
  const deployments = entries.filter(entry => entry && entry.type === 'deploy' && entry.version === 1 && entry.worker_name === workerName);
  if (deployments.length !== 1 || !UUID.test(deployments[0].version_id ?? '') || !Array.isArray(deployments[0].targets)) {
    throw new Error('Wrangler output must contain one completed deployment for the selected Worker');
  }
  const urls = new Set();
  for (const target of deployments[0].targets) {
    if (typeof target !== 'string') continue;
    try {
      const url = new URL(target.includes('://') ? target : `https://${target}`);
      const suffix = url.hostname.slice(workerName.length);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/' && url.hostname.startsWith(workerName) && /^\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(suffix)) urls.add(url.origin);
    } catch {}
  }
  if (urls.size !== 1) throw new Error('Wrangler deployment returned no unique public workers.dev URL for the selected Worker');
  return { url: [...urls][0], sourceRevision: snapshot.release.sourceRevision, version: snapshot.release.version, preview: snapshot.release.preview };
}

async function runWrangler({ rootDir, command, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, command, { cwd: rootDir, stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => signal ? reject(new Error('Wrangler deployment was interrupted')) : resolve(code));
  });
}

export async function deployData({ rootDir, args = [], environment = process.env, runWrangler: run = runWrangler }) {
  rootDir = path.resolve(rootDir);
  const resultFile = path.join(rootDir, 'dist/deployment.json');
  await rm(resultFile, { force: true });
  const { dryRun, workerName } = parseDeploymentOptions(args);
  const assets = path.join(rootDir, 'dist/assets');
  const snapshot = await readCurrentSnapshot({ allowPreview: dryRun || workerName !== PRODUCTION, read: async key => {
    try { return await readFile(path.join(assets, key)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  } });
  if (!snapshot) throw new Error('Build and package collection data before deploying');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'collections-deployment-'));
  const outputFile = path.join(temporary, 'wrangler-output.jsonl');
  try {
    const command = [path.join(rootDir, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', path.join(rootDir, 'wrangler.jsonc')];
    if (dryRun) command.push('--dry-run');
    command.push('--name', workerName);
    const code = await run({ rootDir, command, env: { ...environment, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_CI_OVERRIDE_NAME: workerName, WRANGLER_OUTPUT_FILE_PATH: outputFile } });
    if (code !== 0) throw new Error('Wrangler deployment failed');
    if (dryRun) return { dryRun: true, sourceRevision: snapshot.release.sourceRevision, version: snapshot.release.version, preview: snapshot.release.preview };
    let output;
    try { output = await readFile(outputFile, 'utf8'); }
    catch { throw new Error('Wrangler deployment output is missing'); }
    const metadata = deploymentMetadata(output, { workerName, snapshot });
    await mkdir(path.dirname(resultFile), { recursive: true });
    await writeFile(resultFile, JSON.stringify(metadata, null, 2) + '\n');
    return metadata;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
