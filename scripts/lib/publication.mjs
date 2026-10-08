import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { verifySnapshot, verifySnapshotFiles } from './snapshot.mjs';

const HASH = /^[a-f0-9]{64}$/;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const ASSET = new RegExp(`^assets/${UUID}/[a-zA-Z0-9._-]+\\.(?:png|jpe?g|webp|gif)$`, 'i');
const SNAPSHOT_FILE = new RegExp(`^(?:index\\.json|${UUID}\\.json|assets/${UUID}/[a-zA-Z0-9._-]+\\.(?:png|jpe?g|webp|gif))$`, 'i');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_STATIC_FILES = 20000;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const HEADERS = `/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD, OPTIONS
  X-Content-Type-Options: nosniff

/current.json
  Cache-Control: no-store

/snapshots/*
  Cache-Control: public, max-age=31536000, immutable

/images/*
  Cache-Control: public, max-age=31536000, immutable
`;
function safeKey(key) {
  if (typeof key !== 'string' || !key || /[\u0000-\u0020\u007f\\%?#:]/.test(key) || path.posix.isAbsolute(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe publication file path');
  return key;
}
function imageKey(name, bytes) {
  const extension = path.posix.extname(name).slice(1).toLowerCase();
  return `images/${digest(bytes)}.${extension === 'jpeg' ? 'jpg' : extension}`;
}
function releaseFor(verified) {
  const version = digest(verified.files.get('manifest.json'));
  const assets = Object.fromEntries([...verified.files].filter(([name]) => name.startsWith('assets/')).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, imageKey(name, bytes)]));
  return { schemaVersion:1, version, sourceRevision:verified.manifest.sourceRevision, preview:verified.manifest.preview, snapshotPath:`snapshots/${version}/`, assets };
}
function parseJSON(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
  catch { throw new Error(`Invalid ${label} JSON`); }
}
function parseRelease(bytes, version, allowPreview) {
  const release = parseJSON(bytes, 'publication release');
  const fields = ['schemaVersion', 'version', 'sourceRevision', 'preview', 'snapshotPath', 'assets'];
  if (!release || typeof release !== 'object' || Array.isArray(release) || Object.keys(release).length !== fields.length || fields.some(field => !(field in release)) || release.schemaVersion !== 1 || release.version !== version || !/^[a-f0-9]{40}$/i.test(release.sourceRevision ?? '') || typeof release.preview !== 'boolean' || release.snapshotPath !== `snapshots/${version}/` || !release.assets || typeof release.assets !== 'object' || Array.isArray(release.assets)) throw new Error('Invalid publication release fields');
  if (release.preview && !allowPreview) throw new Error('Preview releases cannot be used for production');
  for (const [name, key] of Object.entries(release.assets)) {
    safeKey(name); safeKey(key);
    if (!ASSET.test(name) || !/^images\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/.test(key)) throw new Error('Invalid publication asset mapping');
  }
  return release;
}
async function readBytes(read, key) {
  safeKey(key);
  const input = await read(key);
  if (input === null) return null;
  if (!(input instanceof Uint8Array) || input.length > MAX_FILE_BYTES) throw new Error('Publication file body is invalid or exceeds size limit');
  return Buffer.from(input);
}
export async function readPublishedSnapshot({ read, version, allowPreview=false }) {
  if (!HASH.test(version ?? '')) throw new Error('Publication version must be a lowercase SHA256 hash');
  const releaseBytes = await readBytes(read, `snapshots/${version}/release.json`);
  if (!releaseBytes) throw new Error('Missing publication release');
  const release = parseRelease(releaseBytes, version, allowPreview);
  const manifestBytes = await readBytes(read, `${release.snapshotPath}manifest.json`);
  if (!manifestBytes || digest(manifestBytes) !== version) throw new Error('Publication manifest version mismatch');
  const manifest = parseJSON(manifestBytes, 'publication manifest');
  if (!Array.isArray(manifest.files) || manifest.files.length > 10000) throw new Error('Invalid publication manifest files');
  let total = 0;
  const paths = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid publication manifest file');
    safeKey(entry.path);
    if (!SNAPSHOT_FILE.test(entry.path) || paths.has(entry.path) || !HASH.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES || (total += entry.size) > MAX_TOTAL_BYTES) throw new Error('Invalid publication file path, size, checksum, or count limit');
    paths.add(entry.path);
  }
  const files = new Map([['manifest.json', manifestBytes]]);
  for (const entry of manifest.files) {
    const key = entry.path.startsWith('assets/') ? release.assets[entry.path] : `${release.snapshotPath}${entry.path}`;
    if (!key) throw new Error('Missing publication asset mapping');
    const bytes = await readBytes(read, key);
    if (!bytes) throw new Error(`Missing publication file: ${entry.path}`);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error(`Publication checksum or size mismatch: ${entry.path}`);
    files.set(entry.path, bytes);
  }
  const verified = await verifySnapshotFiles(files, { allowPreview, expectedRevision:release.sourceRevision });
  if (!isDeepStrictEqual(releaseFor(verified), release)) throw new Error('Publication release and snapshot disagree');
  return { ...verified, release, releaseBytes };
}
export async function readCurrentSnapshot({ read, allowPreview=false }) {
  const bytes = await readBytes(read, 'current.json');
  if (bytes === null) return null;
  const current = parseJSON(bytes, 'current publication');
  if (!HASH.test(current?.version ?? '')) throw new Error('Invalid current publication version');
  const pointer = parseRelease(bytes, current.version, allowPreview);
  const verified = await readPublishedSnapshot({ read, version:pointer.version, allowPreview });
  if (!isDeepStrictEqual(pointer, verified.release)) throw new Error('Current pointer and immutable publication disagree');
  return verified;
}
function contains(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
async function destinationPath(fromDir, outDir) {
  if (typeof outDir !== 'string' || !outDir) throw new Error('Publication output directory is required');
  let destination = path.resolve(outDir);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (contains(temporaryRoot, destination)) destination = path.join(await realpath(temporaryRoot), path.relative(temporaryRoot, destination));
  const source = await realpath(fromDir);
  if (contains(source, destination) || contains(destination, source)) throw new Error('Publication source and destination directories must not overlap');
  const parent = path.dirname(destination), base = path.parse(parent).root;
  let directory = base;
  for (const part of path.relative(base, parent).split(path.sep).filter(Boolean)) {
    directory = path.join(directory, part);
    await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(directory);
    if (info.isSymbolicLink()) throw new Error('Publication output symbolic link is forbidden');
    if (!info.isDirectory()) throw new Error('Publication output parent must be a directory');
  }
  try {
    const info = await lstat(destination);
    if (info.isSymbolicLink()) throw new Error('Publication output symbolic link is forbidden');
    if (!info.isDirectory()) throw new Error('Publication output must be a directory');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return destination;
}
export async function buildStaticPublication({ fromDir, outDir, previousSnapshot=null, allowPreview=false }) {
  const verified = await verifySnapshot({ fromDir, allowPreview }), release = releaseFor(verified);
  const snapshots = new Map();
  let unchanged = false;
  if (previousSnapshot) {
    const previous = await verifySnapshotFiles(previousSnapshot.files, { allowPreview });
    const previousRelease = releaseFor(previous);
    unchanged = previousRelease.version === release.version;
    if (previousSnapshot.release && !isDeepStrictEqual(previousSnapshot.release, previousRelease)) throw new Error('Preceding publication release and snapshot disagree');
    snapshots.set(previousRelease.version, { verified:previous, release:previousRelease });
  }
  const retainedVersion = snapshots.size && !snapshots.has(release.version) ? [...snapshots.keys()][0] : null;
  snapshots.set(release.version, { verified, release });
  const output = new Map();
  for (const snapshot of snapshots.values()) {
    for (const [name, bytes] of snapshot.verified.files) {
      const key = name.startsWith('assets/') ? snapshot.release.assets[name] : `${snapshot.release.snapshotPath}${name}`;
      const existing = output.get(key);
      if (existing && !existing.equals(bytes)) throw new Error('Publication content hash collision');
      output.set(key, bytes);
    }
    output.set(`${snapshot.release.snapshotPath}release.json`, jsonBytes(snapshot.release));
  }
  output.set('current.json', jsonBytes(release));
  output.set('_headers', Buffer.from(HEADERS));
  if (output.size > MAX_STATIC_FILES) throw new Error('Static publication exceeds the free-plan file count limit');
  const destination = await destinationPath(fromDir, outDir);
  const stage = await mkdtemp(path.join(path.dirname(destination), '.catalog-publication-'));
  const previousDirectory = path.join(path.dirname(destination), `.catalog-previous-${randomUUID()}`);
  let movedPrevious = false, installed = false;
  try {
    for (const [name, bytes] of output) {
      const filename = path.join(stage, name);
      await mkdir(path.dirname(filename), { recursive:true });
      await writeFile(filename, bytes);
    }
    try { await rename(destination, previousDirectory); movedPrevious = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(stage, destination); installed = true; }
    catch (error) {
      if (movedPrevious) await rename(previousDirectory, destination);
      throw error;
    }
    return { version:release.version, sourceRevision:release.sourceRevision, count:verified.index.collections.length, preview:release.preview, unchanged, retainedVersion, assetCount:output.size, imageCount:[...output.keys()].filter(key => key.startsWith('images/')).length };
  } finally {
    await rm(stage, { recursive:true, force:true });
    if (installed && movedPrevious) await rm(previousDirectory, { recursive:true, force:true });
  }
}
