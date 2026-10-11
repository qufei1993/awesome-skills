import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { indexItem } from '../../scripts/lib/site-contract.mjs';
import { verifySnapshotFiles } from '../../scripts/lib/snapshot.mjs';
import { buildStaticPublication } from '../../scripts/lib/publication.mjs';

const { readCurrentSnapshot } = await import(pathToFileURL(path.resolve(process.env.BASELINE_DIR, 'scripts/lib/publication.mjs')));
const base = process.env.CATALOG_DATA_BASE_URL.replace(/\/$/, '');
const cached = new Map();
async function read(key) {
  if (cached.has(key)) return cached.get(key);
  const response = await fetch(`${base}/${key}`, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Cannot read ${key}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error('File exceeds publication limit');
  cached.set(key, bytes);
  return bytes;
}
const pointer = JSON.parse(await read('current.json'));
const release = JSON.parse(await read(`snapshots/${pointer.version}/release.json`));
const manifest = JSON.parse(await read(`${release.snapshotPath}manifest.json`));
const queue = manifest.files.map(file => file.path.startsWith('assets/') ? release.assets[file.path] : `${release.snapshotPath}${file.path}`);
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) await read(queue.shift());
}));
const previous = await readCurrentSnapshot({ read });
const files = new Map(previous.files);
const compact = Buffer.from(JSON.stringify({ schemaVersion: 1, collections: previous.index.collections.map(item => indexItem(JSON.parse(files.get(`${item.id}.json`)))) }, null, 2) + '\n');
const before = files.get('index.json').length;
files.set('index.json', compact);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const updated = { ...previous.manifest, files: previous.manifest.files.map(file => file.path === 'index.json' ? { ...file, size: compact.length, sha256: hash(compact) } : file) };
files.set('manifest.json', Buffer.from(JSON.stringify(updated, null, 2) + '\n'));
await verifySnapshotFiles(files);
for (const [name, bytes] of previous.files) if (!['index.json', 'manifest.json'].includes(name) && !bytes.equals(files.get(name))) throw new Error(`Unexpected change to ${name}`);
const source = path.resolve('dist/reindex-source');
await fs.mkdir(source, { recursive: true });
for (const [name, bytes] of files) {
  const filename = path.join(source, name);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, bytes);
}
const result = await buildStaticPublication({ fromDir: source, outDir: path.resolve('dist/assets') });
// Keep immutable files available to pages that are already open.
for (const [key, bytes] of cached) if (key !== 'current.json') {
  const filename = path.resolve('dist/assets', key);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, bytes);
}
const latest = await fetch(`${base}/current.json`, { cache: 'no-store', signal: AbortSignal.timeout(30000) }).then(response => response.json());
if (latest.version !== pointer.version) throw new Error('Live catalog changed during repackaging');
console.log(JSON.stringify({ ...result, beforeBytes: before, afterBytes: compact.length, detailsUnchanged: true }));
