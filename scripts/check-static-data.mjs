import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readCurrentSnapshot, readPublishedSnapshot } from './lib/publication.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const MAX_BYTES = 10 * 1024 * 1024;
function dataBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Data check requires a valid public data URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (typeof value !== 'string' || !(url.protocol === 'https:' || url.protocol === 'http:' && local) || url.username || url.password || /[?#]/.test(value) || /[%\\]/.test(url.pathname)) throw new Error('Data check requires HTTPS or localhost HTTP without URL credentials or parameters');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
async function bodyBytes(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Hosted data response size limit exceeded');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    if (response.status === 404) return Buffer.alloc(0);
    throw new Error('Hosted data response body is missing');
  }
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((size += value.length) > MAX_BYTES) throw new Error('Hosted data response size limit exceeded');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
function verifyHeaders(response, key) {
  if (response.headers.get('access-control-allow-origin') !== '*') throw new Error(`Hosted data CORS header is missing or invalid: ${key}`);
  const cache = response.headers.get('cache-control') ?? '';
  if (key === 'current.json') {
    if (!/(?:^|,)\s*no-store\s*(?:,|$)/i.test(cache)) throw new Error('Hosted current data cache must use no-store');
  } else if (!/(?:^|,)\s*immutable\s*(?:,|$)/i.test(cache) || !/(?:^|,)\s*max-age=31536000\s*(?:,|$)/i.test(cache)) {
    throw new Error(`Hosted version and image cache must be immutable: ${key}`);
  }
}
export async function checkStaticData({ url, assetsDir=path.join(root, 'dist/assets'), allowPreview=false, request=fetch }) {
  const baseUrl = dataBaseUrl(url);
  const localRead = async key => {
    try { return await readFile(path.join(assetsDir, key)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const generated = await readCurrentSnapshot({ read:localRead, allowPreview });
  if (!generated) throw new Error('Build and package collection data before checking its hosted publication');
  const expectedCurrent = await localRead('current.json');
  const loaded = new Map();
  async function fetchFile(key, verifyResponseHeaders=true) {
    const response = await request(`${baseUrl}${key}`, { credentials:'omit', redirect:'manual', signal:AbortSignal.timeout(30000), cache:'no-store' });
    if (response?.redirected || response?.status >= 300 && response.status < 400) throw new Error('Hosted data redirect refused');
    if (!response || !response.ok && response.status !== 404) throw new Error(`Hosted data request failed (HTTP ${response?.status ?? 'unknown'})`);
    const bytes = await bodyBytes(response);
    if (verifyResponseHeaders && response.status !== 404) verifyHeaders(response, key);
    return { response, bytes };
  }
  const read = async key => {
    if (!loaded.has(key)) loaded.set(key, await fetchFile(key));
    const { response, bytes } = loaded.get(key);
    return response.status === 404 ? null : bytes;
  };
  const hostedCurrent = await read('current.json');
  if (!hostedCurrent?.equals(expectedCurrent)) throw new Error('Hosted current data does not match the generated publication');
  const hosted = await readCurrentSnapshot({ read, allowPreview });
  const versions = [];
  for (const entry of await readdir(path.join(assetsDir, 'snapshots'), { withFileTypes:true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) throw new Error('Generated publication contains an invalid version directory');
    versions.push(entry.name);
    if (entry.name !== hosted.release.version) await readPublishedSnapshot({ read, version:entry.name, allowPreview });
  }
  const missing = await fetchFile(`__missing-${randomUUID()}.json`, false);
  if (missing.response.status !== 404) throw new Error('Missing data files must return HTTP 404 instead of a fallback page');
  if ((missing.response.headers.get('content-type') ?? '').toLowerCase().includes('text/html') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(missing.bytes.toString('utf8'))) throw new Error('Missing data files must not fall back to HTML');
  return { version:hosted.release.version, sourceRevision:hosted.release.sourceRevision, count:hosted.index.collections.length, preview:hosted.release.preview, retainedVersions:versions.filter(version => version !== hosted.release.version), checkedFiles:loaded.size, cors:true, cache:true, notFound:true };
}
async function main() {
  try {
    let url, deployment, allowPreview = false;
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--preview' && !allowPreview) allowPreview = true;
      else if (args[index] === '--url' && !url) {
        url = args[++index];
        if (!url || url.startsWith('--')) throw new Error('The --url option requires a public data URL');
      } else if (args[index] === '--deployment' && !deployment) {
        deployment = args[++index];
        if (!deployment || deployment.startsWith('--')) throw new Error('The --deployment option requires a deployment JSON path');
      } else throw new Error('Unknown or duplicate data check option');
    }
    if (Boolean(url) === Boolean(deployment)) throw new Error('Use --url <public data URL> or --deployment <deployment JSON path>');
    if (deployment) {
      const bytes = await readFile(path.resolve(deployment));
      if (bytes.length > MAX_BYTES) throw new Error('Deployment JSON exceeds size limit');
      let document;
      try { document = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
      catch { throw new Error('Deployment JSON is invalid'); }
      if (!document || typeof document !== 'object' || Array.isArray(document) || typeof document.url !== 'string') throw new Error('Deployment JSON requires a public data URL');
      url = document.url;
    }
    const result = await checkStaticData({ url, allowPreview });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    console.error(`Hosted data check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
