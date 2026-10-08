import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { verifySnapshot } from './snapshot.mjs';

const HASH = /^[a-f0-9]{64}$/;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const ASSET = new RegExp(`^assets/${UUID}/[a-zA-Z0-9._-]+\\.(?:png|jpe?g|webp|gif)$`, 'i');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function safeKey(key) {
  if (typeof key !== 'string' || !key || /[\u0000-\u0020\u007f\\%?#:]/.test(key) || path.posix.isAbsolute(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe storage object key or path');
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

export async function createLocalStore(rootDir) {
  await mkdir(path.resolve(rootDir), { recursive:true });
  const root = await realpath(rootDir);
  async function target(key, createParents=false) {
    safeKey(key);
    const parts = key.split('/');
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      directory = path.join(directory, part);
      if (createParents) await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
      try {
        const info = await lstat(directory);
        if (info.isSymbolicLink()) throw new Error('Storage symbolic link is forbidden');
        if (!info.isDirectory()) throw new Error('Storage parent must be a directory');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const filename = path.join(root, ...parts);
    try {
      const info = await lstat(filename);
      if (info.isSymbolicLink()) throw new Error('Storage symbolic link is forbidden');
      if (!info.isFile()) throw new Error('Storage object must be a regular file');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return filename;
  }
  async function get(key) {
    try { return await readFile(await target(key)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return {
    rootDir:root,
    get,
    async head(key) {
      try { return { size:(await lstat(await target(key))).size }; }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async putImmutable(key, input) {
      const bytes = Buffer.from(input), filename = await target(key, true), existing = await get(key);
      if (existing) {
        if (!existing.equals(bytes)) throw new Error(`Immutable object has different bytes: ${key}`);
        return false;
      }
      const temporary = path.join(path.dirname(filename), `.publish-${randomUUID()}`);
      try {
        await writeFile(temporary, bytes, { flag:'wx' });
        try { await link(temporary, filename); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const competing = await get(key);
          if (!competing?.equals(bytes)) throw new Error(`Immutable object has different bytes: ${key}`);
          return false;
        }
        return true;
      } finally { await rm(temporary, { force:true }); }
    },
    async setCurrent(input) {
      const filename = await target('current.json'), temporary = path.join(root, `.current-${randomUUID()}`);
      try { await writeFile(temporary, input, { flag:'wx' }); await rename(temporary, filename); }
      finally { await rm(temporary, { force:true }); }
    },
    async withPublicationLock(operation) {
      const lock = path.join(root, '.publication-lock');
      try { await mkdir(lock); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('A data publication is already running (lock exists)'); throw error; }
      try { return await operation(); }
      finally { await rm(lock, { recursive:true, force:true }); }
    },
  };
}

function withLock(store, operation) { return store.withPublicationLock ? store.withPublicationLock(operation) : operation(); }
export async function createR2Store({ accountId, bucket, accessKeyId, secretAccessKey, client }={}) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '') || (!client && (!/^[a-f0-9]{32}$/i.test(accountId ?? '') || !accessKeyId || !secretAccessKey))) throw new Error('R2 configuration is missing or invalid');
  const { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const transport = client ?? new S3Client({ region:'auto', endpoint:`https://${accountId}.r2.cloudflarestorage.com`, credentials:{ accessKeyId, secretAccessKey }, requestChecksumCalculation:'WHEN_REQUIRED' });
  async function request(command) {
    try { return await transport.send(command); }
    catch (error) {
      const status = error.$metadata?.httpStatusCode;
      const failure = new Error(`R2 object request failed (HTTP ${Number.isInteger(status) ? status : 'unknown'})`);
      failure.status = status;
      throw failure;
    }
  }
  async function get(key) {
    safeKey(key);
    let response;
    try { response = await request(new GetObjectCommand({ Bucket:bucket, Key:key })); }
    catch (error) { if (error.status === 404) return null; throw error; }
    if (!response.Body || response.ContentLength > 10 * 1024 * 1024) {
      response.Body?.destroy(); throw new Error('R2 object body is missing or exceeds size limit');
    }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of response.Body) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) throw new Error('R2 object exceeds size limit');
        chunks.push(Buffer.from(chunk));
      }
    } catch { throw new Error('R2 object body could not be read safely'); }
    finally { response.Body.destroy(); }
    return Buffer.concat(chunks);
  }
  async function head(key) {
    safeKey(key);
    try {
      const response = await request(new HeadObjectCommand({ Bucket:bucket, Key:key }));
      return { size:response.ContentLength, etag:response.ETag };
    }
    catch (error) { if (error.status === 404) return null; throw error; }
  }
  function contentType(key) {
    return key.endsWith('.json') ? 'application/json; charset=utf-8' : ({ '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' }[path.posix.extname(key)] ?? 'application/octet-stream');
  }
  async function put(key, bytes, immutable, condition={}) {
    return request(new PutObjectCommand({ Bucket:bucket, Key:safeKey(key), Body:bytes, ContentType:contentType(key), CacheControl:immutable ? 'public, max-age=31536000, immutable' : 'no-store', ...(immutable ? { IfNoneMatch:'*' } : condition) }));
  }
  return {
    get, head,
    async putImmutable(key, input) {
      const bytes = Buffer.from(input), existing = await head(key);
      if (existing) {
        if (existing.size !== bytes.length || !(await get(key))?.equals(bytes)) throw new Error(`Immutable object has different bytes: ${key}`);
        return false;
      }
      try { await put(key, bytes, true); return true; }
      catch (error) {
        if (error.status !== 412) throw error;
        if (!(await get(key))?.equals(bytes)) throw new Error(`Immutable object has different bytes: ${key}`);
        return false;
      }
    },
    async setCurrent(bytes, expectedCurrent) {
      if (expectedCurrent !== null && (typeof expectedCurrent?.etag !== 'string' || !expectedCurrent.etag)) throw new Error('R2 current pointer requires its starting ETag');
      try { await put('current.json', bytes, false, expectedCurrent === null ? { IfNoneMatch:'*' } : { IfMatch:expectedCurrent.etag }); }
      catch (error) {
        if (error.status === 412) throw new Error('Current pointer changed during concurrent publication; no update was made');
        throw error;
      }
    },
  };
}

export async function publishSnapshot({ fromDir, store, allowPreview=false, beforeCurrent }) {
  if (store.rootDir) {
    const source = await realpath(fromDir), relative = path.relative(source, store.rootDir);
    if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) throw new Error('Publication destination cannot be inside the source snapshot');
  }
  const expectedCurrent = await store.head('current.json');
  const verified = await verifySnapshot({ fromDir, allowPreview }), release = releaseFor(verified);
  return withLock(store, async () => {
    let uploadedImages = 0, reusedImages = 0, uploadedFiles = 0;
    const images = new Map();
    for (const [name, bytes] of verified.files) if (name.startsWith('assets/')) images.set(release.assets[name], bytes);
    for (const [key, bytes] of images) {
      if (await store.putImmutable(key, bytes)) uploadedImages++;
      else reusedImages++;
    }
    for (const [name, bytes] of verified.files) if (!name.startsWith('assets/')) {
      if (await store.putImmutable(`${release.snapshotPath}${name}`, bytes)) uploadedFiles++;
    }
    const bytes = jsonBytes(release);
    if (await store.putImmutable(`${release.snapshotPath}release.json`, bytes)) uploadedFiles++;
    const result = { version:release.version, sourceRevision:release.sourceRevision, count:verified.index.collections.length, preview:release.preview, uploadedImages, reusedImages, uploadedFiles, currentUpdated:false };
    if (beforeCurrent && await beforeCurrent({ sourceRevision:release.sourceRevision }) !== true) return result;
    await store.setCurrent(bytes, expectedCurrent);
    return { ...result, currentUpdated:true };
  });
}

function parseRelease(bytes, version, allowPreview) {
  let release;
  try { release = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
  catch { throw new Error('Invalid publication release JSON'); }
  const fields = ['schemaVersion', 'version', 'sourceRevision', 'preview', 'snapshotPath', 'assets'];
  if (!release || typeof release !== 'object' || Array.isArray(release) || Object.keys(release).length !== fields.length || fields.some(field => !(field in release)) || release.schemaVersion !== 1 || release.version !== version || !/^[a-f0-9]{40}$/i.test(release.sourceRevision ?? '') || typeof release.preview !== 'boolean' || release.snapshotPath !== `snapshots/${version}/` || !release.assets || typeof release.assets !== 'object' || Array.isArray(release.assets)) throw new Error('Invalid publication release fields');
  if (release.preview && !allowPreview) throw new Error('Preview releases cannot be used for production');
  for (const [name, key] of Object.entries(release.assets)) {
    safeKey(name); safeKey(key);
    if (!ASSET.test(name) || !/^images\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/.test(key)) throw new Error('Invalid publication asset mapping');
  }
  return release;
}
export async function readPublishedSnapshot({ store, version, allowPreview=false }) {
  if (!HASH.test(version ?? '')) throw new Error('Publication version must be a lowercase SHA256 hash');
  const releaseBytes = await store.get(`snapshots/${version}/release.json`);
  if (!releaseBytes) throw new Error('Missing publication release');
  const release = parseRelease(releaseBytes, version, allowPreview), stage = await mkdtemp(path.join(os.tmpdir(), 'catalog-rollback-'));
  try {
    const manifestBytes = await store.get(`${release.snapshotPath}manifest.json`);
    if (!manifestBytes || digest(manifestBytes) !== version) throw new Error('Publication manifest version mismatch');
    let manifest;
    try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(manifestBytes)); }
    catch { throw new Error('Invalid publication manifest'); }
    if (!Array.isArray(manifest.files) || manifest.files.length > 10000) throw new Error('Invalid publication manifest files');
    let total = 0;
    const paths = new Set();
    for (const entry of manifest.files) {
      safeKey(entry.path);
      if (paths.has(entry.path) || !HASH.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 10*1024*1024 || (total += entry.size) > 100*1024*1024) throw new Error('Invalid publication file size, checksum, or count limit');
      paths.add(entry.path);
    }
    await writeFile(path.join(stage, 'manifest.json'), manifestBytes);
    for (const entry of manifest.files) {
      safeKey(entry.path);
      const key = entry.path.startsWith('assets/') ? release.assets[entry.path] : `${release.snapshotPath}${entry.path}`;
      if (!key) throw new Error('Missing publication asset mapping');
      const bytes = await store.get(key);
      if (!bytes) throw new Error(`Missing publication file: ${entry.path}`);
      if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error(`Publication checksum or size mismatch: ${entry.path}`);
      const filename = path.join(stage, entry.path);
      await mkdir(path.dirname(filename), { recursive:true }); await writeFile(filename, bytes);
    }
    const verified = await verifySnapshot({ fromDir:stage, allowPreview, expectedRevision:release.sourceRevision });
    if (!isDeepStrictEqual(releaseFor(verified), release)) throw new Error('Publication release and snapshot disagree');
    return { ...verified, release, releaseBytes };
  } finally { await rm(stage, { recursive:true, force:true }); }
}

export async function readCurrentSnapshot({ store, allowPreview=false }) {
  const bytes = await store.get('current.json');
  if (bytes === null) return null;
  let current;
  try { current = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
  catch { throw new Error('Invalid current publication JSON'); }
  if (!HASH.test(current?.version ?? '')) throw new Error('Invalid current publication version');
  const pointer = parseRelease(bytes, current.version, allowPreview);
  const verified = await readPublishedSnapshot({ store, version:pointer.version, allowPreview });
  if (!isDeepStrictEqual(pointer, verified.release)) throw new Error('Current pointer and immutable publication disagree');
  return verified;
}

export async function rollbackPublication({ store, version, allowPreview=false }) {
  return withLock(store, async () => {
    const expectedCurrent = await store.head('current.json');
    const { release, releaseBytes, index } = await readPublishedSnapshot({ store, version, allowPreview });
    await store.setCurrent(releaseBytes, expectedCurrent);
    return { version, sourceRevision:release.sourceRevision, count:index.collections.length, preview:release.preview };
  });
}
