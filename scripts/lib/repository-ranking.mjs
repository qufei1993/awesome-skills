import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const TTL = 24 * 60 * 60 * 1000;
const CONCURRENCY = 6;
const MAX_CACHE_BYTES = 1024 * 1024;
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const order = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function repository(value) {
  if (typeof value !== 'string') return null;
  const match = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9_.-]+)$/i.exec(value);
  if (!match || ['.', '..'].includes(match[2])) return null;
  return value.toLowerCase();
}

function sourceRepository(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.split('/').filter(Boolean).slice(0, 2).map(decodeURIComponent);
    if (parts.length !== 2 || parts.some(part => part.includes('/'))) return null;
    return repository(`${parts[0]}/${parts[1].replace(/\.git$/i, '')}`);
  } catch { return null; }
}

function collectionRepository(record) {
  const repos = new Set((record.document.skills ?? []).map(skill => repository(skill.entry?.repo)));
  if (repos.size !== 1 || repos.has(null)) return null;
  const repo = [...repos][0];
  const readme = Object.values(record.publicReadmes ?? {}).find(item => item.sourceUrl !== undefined);
  const source = readme?.sourceUrl ?? record.document.provenance?.evidence?.find(item => item.id === 'collection-source')?.url;
  return source === undefined || sourceRepository(source) === repo ? repo : null;
}

async function requestStars(repo, rootDir) {
  const { stdout } = await execute('gh', ['api', '--hostname', 'github.com', `repos/${repo}`, '--jq', '.stargazers_count'], {
    cwd: rootDir, encoding: 'utf8', timeout: 20_000, maxBuffer: 4096,
  });
  return JSON.parse(stdout.trim());
}

async function cacheFile(rootDir) {
  if (!rootDir) return null;
  const root = await realpath(rootDir), directory = path.join(root, 'dist');
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) return null;
  const file = path.join(directory, 'repository-stars.json');
  try {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_CACHE_BYTES) return null;
  } catch (error) { if (error.code !== 'ENOENT') return null; }
  return file;
}

async function loadCache(file) {
  const cache = new Map();
  if (!file) return cache;
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.schemaVersion !== 1 || !data.repositories || typeof data.repositories !== 'object' || Array.isArray(data.repositories)) return cache;
    for (const [repo, entry] of Object.entries(data.repositories)) {
      if (repository(repo) === repo && entry && validCount(entry.count) && validCount(entry.checkedAt)) cache.set(repo, { count: entry.count, checkedAt: entry.checkedAt });
    }
  } catch {}
  return cache;
}

async function saveCache(file, cache) {
  if (!file) return;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const repositories = Object.fromEntries([...cache].sort(([left], [right]) => order(left, right)));
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, repositories }, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, file);
  } catch {} finally { await rm(temporary, { force: true }).catch(() => {}); }
}

export async function rankCollections(records, { rootDir, request, now = Date.now() } = {}) {
  const byRecord = new Map(records.map(record => [record, collectionRepository(record)]));
  const repos = [...new Set([...byRecord.values()].filter(Boolean))];
  let file;
  try { file = await cacheFile(rootDir); } catch { file = null; }
  const cache = await loadCache(file);
  const refresh = repos.filter(repo => {
    const cached = cache.get(repo);
    return !cached || cached.checkedAt > now || now - cached.checkedAt >= TTL;
  });
  const fetchStars = request ?? (repo => requestStars(repo, rootDir));
  let cursor = 0, failures = 0, changed = false;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, refresh.length) }, async () => {
    while (cursor < refresh.length) {
      const repo = refresh[cursor++];
      try {
        const count = await fetchStars(repo);
        if (!validCount(count)) throw new Error('Invalid repository stars');
        cache.set(repo, { count, checkedAt: now });
        changed = true;
      } catch { failures++; }
    }
  }));
  if (changed) await saveCache(file, cache);
  if (failures) console.warn(`Repository star refresh failed for ${failures} repositories.`);
  return [...records].sort((left, right) => {
    const leftCount = cache.get(byRecord.get(left))?.count;
    const rightCount = cache.get(byRecord.get(right))?.count;
    if (leftCount !== undefined || rightCount !== undefined) {
      if (leftCount === undefined) return 1;
      if (rightCount === undefined) return -1;
      if (leftCount !== rightCount) return rightCount - leftCount;
    }
    return (left.document.sortOrder ?? 0) - (right.document.sortOrder ?? 0) || order(left.document.slug, right.document.slug);
  });
}
