import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isAlias, isMap, parseDocument, visit } from 'yaml';

const SHA = /^[a-f0-9]{40}$/i;
const DIGEST = /^[a-f0-9]{64}$/i;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_BLOB_BYTES = 1024 * 1024;
const MAX_SKILLS = 2000;
const REQUEST_TIMEOUT_MS = 20_000;
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const githubPath = value => value.split('/').map(encode).join('/');
const order = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const fail = message => { throw new Error(`upstream: ${message}`); };

function repositoryPath(value, label = 'path') {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail(`${label} is not a safe repository-relative path`);
  return value;
}

function parseLink(value) {
  let url;
  try { url = new URL(value); } catch { fail('Skill source must be a valid GitHub URL'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || /[\s\\]/.test(value)) fail('Skill source must use a GitHub HTTPS URL without credentials, query, or fragment');
  const raw = /^https:\/\/github\.com\/([^?#]*)$/i.exec(value)?.[1];
  if (!raw) fail('Skill source must use a GitHub repository URL');
  let parts;
  try { parts = raw.replace(/\/$/, '').split('/').map(decodeURIComponent); } catch { fail('GitHub URL has invalid path encoding'); }
  for (const part of parts) {
    repositoryPath(part, 'GitHub URL path');
    if (part.includes('/') || /%[a-f0-9]{2}/i.test(part)) fail('GitHub URL path must not encode separators or nested escaping');
  }
  if (parts.length === 2) parts[1] = parts[1].replace(/\.git$/i, '');
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(parts[0] || '') || !/^[a-z0-9_.-]+$/i.test(parts[1] || '') || ['.', '..'].includes(parts[1])) fail('GitHub URL requires a valid owner/repository');
  const repo = `${parts[0]}/${parts[1]}`.toLowerCase();
  if (parts.length === 2) return { repo, kind: 'repository', suffix: [] };
  if (parts[2] === 'tree' && parts.length >= 4) return { repo, kind: 'tree', suffix: parts.slice(3) };
  if (parts[2] === 'blob' && parts.length >= 5 && parts.at(-1) === 'SKILL.md') return { repo, kind: 'blob', suffix: parts.slice(3) };
  fail('GitHub URL must reference a repository, tree directory, or SKILL.md blob');
}

export function collectionId(slug) {
  const bytes = Buffer.from(hash('sha256', `skills-hub:collection:v1:${slug}`).slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function skillId(repo, entryPoint) {
  const directory = path.posix.dirname(entryPoint);
  const name = (directory === '.' ? 'skill' : path.posix.basename(directory)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill';
  return `${name}-${hash('sha256', `${repo.toLowerCase()}\0${entryPoint}`).slice(0, 12)}`;
}

async function defaultRequest(endpoint) {
  if (!endpoint.startsWith('/repos/') || endpoint.includes('://') || /[\u0000-\u0020\u007f\\]/.test(endpoint)) fail('HTTP requests must target a GitHub API repository endpoint');
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.github.com${endpoint}`, { headers, redirect: 'error', signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error(`GitHub API request failed (${response.status})`), { status: response.status });
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) fail('GitHub API response exceeds the size limit');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        controller.abort();
        fail('GitHub API response exceeds the size limit');
      }
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('GitHub API returned invalid JSON'); }
  } catch (error) {
    if (error.status) throw error;
    if (error.message?.startsWith('upstream:')) throw error;
    throw new Error('upstream: GitHub API request failed or timed out');
  } finally { clearTimeout(timer); }
}

function apiClient(request, { rootDir, inputDigest }) {
  const pending = new Map();
  const cacheDir = rootDir && DIGEST.test(inputDigest) ? path.join(rootDir, 'dist', 'upstream-cache', inputDigest) : undefined;
  return endpoint => {
    if (!pending.has(endpoint)) pending.set(endpoint, (async () => {
      const cacheFile = cacheDir && path.join(cacheDir, `${hash('sha256', endpoint)}.json`);
      if (cacheFile) {
        try {
          const bytes = await readFile(cacheFile);
          if (bytes.length <= MAX_RESPONSE_BYTES) {
            const cached = JSON.parse(bytes.toString('utf8'));
            if (cached.endpoint === endpoint && cached.digest === hash('sha256', JSON.stringify(cached.payload))) return cached.payload;
          }
        } catch (error) { if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error; }
      }
      let timer;
      try {
        const payload = await Promise.race([
          request(endpoint),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('upstream: GitHub API request timed out')), REQUEST_TIMEOUT_MS); }),
        ]);
        const json = JSON.stringify(payload);
        if (!json || Buffer.byteLength(json) > MAX_RESPONSE_BYTES) fail('GitHub API response exceeds the size limit');
        if (payload?.status === 404 || payload?.message === 'Not Found') throw Object.assign(new Error('GitHub API request failed (404)'), { status: 404 });
        if (cacheFile) {
          await mkdir(cacheDir, { recursive: true });
          await writeFile(cacheFile, JSON.stringify({ endpoint, digest: hash('sha256', json), payload }));
        }
        return payload;
      } finally { clearTimeout(timer); }
    })());
    return pending.get(endpoint);
  };
}

async function resolveLink(link, api) {
  const parsed = parseLink(link);
  const repositoryEndpoint = `/repos/${parsed.repo}`;
  let suffix = parsed.suffix;
  if (parsed.kind === 'repository') {
    const repository = await api(repositoryEndpoint);
    if (typeof repository.default_branch !== 'string' || !repository.default_branch) fail(`repository ${parsed.repo} has no default branch`);
    suffix = repository.default_branch.split('/');
    suffix.forEach(part => repositoryPath(part, 'default branch'));
  }
  const maxRefParts = suffix.length - (parsed.kind === 'blob' ? 1 : 0);
  for (let length = maxRefParts; length >= 1; length--) {
    const ref = suffix.slice(0, length).join('/');
    let resolved;
    try { resolved = await api(`${repositoryEndpoint}/commits/${encode(ref)}`); }
    catch (error) { if (error.status === 404 || error.status === 422) continue; throw error; }
    if (!SHA.test(resolved.sha) || !SHA.test(resolved.commit?.tree?.sha)) fail(`repository ${parsed.repo} returned an invalid commit or tree SHA`);
    if (SHA.test(ref) && ref.toLowerCase() !== resolved.sha.toLowerCase()) fail(`repository ${parsed.repo} did not return the requested fixed commit`);
    const scope = parsed.kind === 'repository' ? '' : suffix.slice(length).join('/');
    if (scope) repositoryPath(scope, 'source scope');
    return { repo: parsed.repo, kind: parsed.kind, commit: resolved.sha.toLowerCase(), treeSha: resolved.commit.tree.sha.toLowerCase(), scope };
  }
  fail(`GitHub source ${parsed.repo} has no resolvable ref`);
}

async function readTree(source, api) {
  const result = await api(`/repos/${source.repo}/git/trees/${source.treeSha}?recursive=1`);
  if (result.truncated !== false) fail(`recursive tree for ${source.repo} is truncated or lacks completeness evidence`);
  if (result.sha?.toLowerCase() !== source.treeSha || !Array.isArray(result.tree) || result.tree.length > 100_000) fail(`repository ${source.repo} returned an invalid recursive tree`);
  const tree = new Map();
  for (const entry of result.tree) {
    repositoryPath(entry.path, 'tree entry path');
    if (tree.has(entry.path) || !['blob', 'tree', 'commit'].includes(entry.type) || !SHA.test(entry.sha)) fail(`repository ${source.repo} returned an invalid or duplicate tree entry`);
    tree.set(entry.path, entry);
  }
  return tree;
}

async function readBlob(source, entry, api) {
  if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) fail(`${entry.path} must be a regular file`);
  if (entry.size > MAX_BLOB_BYTES) fail(`blob ${entry.path} exceeds the size limit`);
  const blob = await api(`/repos/${source.repo}/git/blobs/${entry.sha}`);
  if (blob.sha?.toLowerCase() !== entry.sha.toLowerCase() || blob.encoding !== 'base64' || typeof blob.content !== 'string' || !Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > MAX_BLOB_BYTES) fail(`blob ${entry.path} has invalid GitHub data`);
  const encoded = blob.content.replace(/[\r\n]/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail(`blob ${entry.path} has invalid base64 encoding`);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== blob.size || (entry.size !== undefined && bytes.length !== entry.size)) fail(`blob size mismatch for ${entry.path}`);
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (actual !== entry.sha.toLowerCase()) fail(`blob hash mismatch for ${entry.path}`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(`blob ${entry.path} is not UTF-8 text`); }
}

function skillFrontmatter(source, entryPoint) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
  if (!match) fail(`${entryPoint} must start with YAML frontmatter`);
  const parsed = parseDocument(match[1], { uniqueKeys: true, merge: false, strict: true });
  if (parsed.errors.length || parsed.warnings.length) fail(`${entryPoint} has invalid YAML frontmatter`);
  visit(parsed, { Node(_key, node) {
    if (isAlias(node) || node.anchor) fail(`${entryPoint} frontmatter cannot contain YAML aliases or anchors`);
    if (isMap(node)) for (const pair of node.items) if (typeof pair.key?.value !== 'string' || pair.key.value === '<<') fail(`${entryPoint} frontmatter must use simple string mapping keys`);
  } });
  const value = parsed.toJS({ maxAliasCount: 0 });
  if (!plain(value)) fail(`${entryPoint} frontmatter must be an object`);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name !== value.name.trim() || /[\u0000-\u001f\u007f\\/]/.test(value.name) || ['.', '..'].includes(value.name)) fail(`${entryPoint} frontmatter name must be a safe installation name`);
  if (typeof value.description !== 'string' || !value.description.trim() || value.description.includes('\0')) fail(`${entryPoint} frontmatter description must be non-empty text`);
  return { name: value.name, description: value.description };
}

async function licenseFor(source, directory, tree, api) {
  let current = directory === '.' ? '' : directory;
  while (true) {
    const files = [...tree.values()].filter(entry => entry.type === 'blob' && path.posix.dirname(entry.path) === (current || '.') && /^(?:licen[sc]e|copying)(?:\.(?:md|txt))?$/i.test(path.posix.basename(entry.path))).sort((a, b) => order(a.path, b.path));
    if (files.length) {
      const entry = files[0];
      const content = await readBlob(source, entry, api);
      let identifier = 'NOASSERTION';
      if (/\bMIT License\b/i.test(content) && /Permission is hereby granted, free of charge/i.test(content) && /THE SOFTWARE IS PROVIDED ["“]AS IS["”]/i.test(content)) identifier = 'MIT';
      else if (/Apache License/i.test(content) && /Version 2\.0,?\s+January 2004/i.test(content) && /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/i.test(content)) identifier = 'Apache-2.0';
      return { identifier, evidenceUrl: `https://github.com/${source.repo}/blob/${source.commit}/${githubPath(entry.path)}` };
    }
    if (!current) return { identifier: 'NOASSERTION' };
    current = path.posix.dirname(current);
    if (current === '.') current = '';
  }
}

function coverFor(contribution, slug, category) {
  if (!contribution.cover) return { cover: { kind: 'concept', preset: ({ development: 'engineering', design: 'design', marketing: 'marketing', media: 'video' })[category] || 'neutral', alt: contribution.title } };
  const { url, alt } = contribution.cover;
  const cover = { kind: 'source-image', url, alt: alt || contribution.title, sourceUrl: url.startsWith('https://') ? url : 'https://github.com/qufei1993/awesome-skills', rightsStatus: 'needs-review' };
  if (url.startsWith('https://')) return { cover };
  let coverFile;
  try { coverFile = decodeURIComponent(url); } catch { fail('cover path has invalid URL encoding'); }
  repositoryPath(coverFile, 'cover path');
  const extension = path.posix.extname(coverFile).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) fail('cover path must name a supported image');
  cover.url = `/assets/collections/${slug}${extension}`;
  return { cover, coverFile };
}

function retainCollectionSource(document, contribution) {
  if (!contribution.sourceUrl) return;
  if (document.provenance.evidence.some(item => item.id === 'collection-source' && item.url === contribution.sourceUrl)) return;
  const hostname = new URL(contribution.sourceUrl).hostname;
  const evidence = {
    id: 'collection-source', kind: hostname === 'github.com' ? 'repository' : 'article',
    url: contribution.sourceUrl, title: 'Collection selection source', publisher: hostname,
    checkedAt: document.updatedAt, location: 'Collection README source link',
    finding: 'The collection README cites this URL as the source of its selection.',
    supportsItemIds: document.skills.map(skill => skill.id),
  };
  document.provenance.evidence = [...document.provenance.evidence.filter(item => item.id !== evidence.id), evidence];
}

export async function resolveSubmission(record, { rootDir, inputDigest, dates, previous, request = defaultRequest } = {}) {
  const previousDocument = previous?.document || previous;
  if (!DIGEST.test(inputDigest || '')) fail('README inputDigest must be a SHA-256 digest');
  const contribution = record.publicReadmes?.[record.language] || record.document;
  const slug = record.document?.slug, category = record.document?.category;
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('submission requires a valid collection slug');
  if (previousDocument && previousDocument.slug !== slug) fail('previous collection identity does not match the submission slug');
  if (previousDocument && previousDocument.id !== collectionId(slug)) fail('previous collection identity must match its generated slug');
  for (const skill of previousDocument?.skills ?? []) {
    if (typeof skill.entry?.repo !== 'string' || typeof skill.entry?.entryPoint !== 'string' || skill.id !== skillId(skill.entry.repo, skill.entry.entryPoint)) fail('previous Skill identity must match its repository path');
  }
  if (!Array.isArray(contribution.links) || !contribution.links.length) fail('submission requires GitHub Skill links');
  contribution.links.forEach(parseLink);
  const { cover, coverFile } = coverFor(contribution, slug, category);
  const currentInput = previousDocument?.sourceKeys?.filter(key => key.startsWith('readme:')).at(-1);
  if (currentInput === `readme:${inputDigest}`) {
    const document=structuredClone(previousDocument);
    if (cover.kind === 'source-image') document.cover.sourceUrl=cover.sourceUrl;
    retainCollectionSource(document, contribution);
    return { language: record.language, document, ...(coverFile ? { coverFile } : {}) };
  }
  for (const field of ['createdAt', 'updatedAt']) if (typeof dates?.[field] !== 'string' || !dates[field].endsWith('Z') || !Number.isFinite(Date.parse(dates[field]))) fail(`submission ${field} must be a valid UTC timestamp`);
  if (Date.parse(dates.updatedAt) < Date.parse(dates.createdAt)) fail('submission updatedAt must not precede createdAt');
  const api = apiClient(request, { rootDir, inputDigest });
  const sources = [], skills = [], byEntry = new Map(), installationNames = new Map();
  for (const link of contribution.links) {
    const source = await resolveLink(link, api);
    const tree = await readTree(source, api);
    const candidates = [...tree.values()].filter(entry => /(?:^|\/)SKILL\.md$/.test(entry.path) && (source.kind === 'blob' ? entry.path === source.scope : !source.scope || entry.path.startsWith(`${source.scope}/`))).sort((a, b) => order(a.path, b.path));
    if (!candidates.length) fail(`source ${source.repo} has no SKILL.md files in the requested scope`);
    const supportedIds = [];
    for (const entry of candidates) {
      const key = `${source.repo}\0${source.commit}\0${entry.path}`;
      const existing = byEntry.get(key);
      if (existing) { supportedIds.push(existing.id); continue; }
      if (skills.length >= MAX_SKILLS) fail(`collection exceeds the ${MAX_SKILLS} Skill limit`);
      const metadata = skillFrontmatter(await readBlob(source, entry, api), entry.path);
      if (installationNames.has(metadata.name) && installationNames.get(metadata.name) !== key) fail(`installation name ${metadata.name} conflicts between different sources or directories`);
      installationNames.set(metadata.name, key);
      const directory = path.posix.dirname(entry.path);
      const id = skillId(source.repo, entry.path);
      const skill = {
        id, name: metadata.name, summary: metadata.description, originalDescription: metadata.description,
        entry: { repo: source.repo, commit: source.commit, entryPoint: entry.path },
        installationMode: 'skill',
        installationItems: [{ name: metadata.name, repo: source.repo, commit: source.commit, directory, entryPoint: 'SKILL.md', license: await licenseFor(source, directory, tree, api) }],
        resourceCheck: 'needs-review', resourceNotes: 'The fixed SKILL.md blob was verified. Supporting files, references outside its directory, dependencies, and installation requirements need review.',
      };
      skills.push(skill); byEntry.set(key, skill); supportedIds.push(id);
    }
    sources.push({ source, supportedIds });
  }
  const document = {
    schemaVersion: 1, id: collectionId(slug), slug,
    revision: previousDocument?.revision || 1,
    createdAt: previousDocument?.createdAt || dates.createdAt, updatedAt: dates.updatedAt,
    sourceKeys: [...new Set([...(previousDocument?.sourceKeys || []).filter(key => key !== `readme:${inputDigest}`), `collection:${slug}`]), `readme:${inputDigest}`],
    status: 'active', sourceKind: 'editorial-selection', category, tags: [],
    ...Object.fromEntries(['title', 'description', 'overview', 'scenarios', 'usage'].map(field => [field, contribution[field]])),
    review: { status: 'pending', notes: [] },
    provenance: { selectionReason: contribution.overview, evidence: sources.map(({ source, supportedIds }, index) => ({
      id: `upstream-${index + 1}`, kind: 'repository',
      url: `https://github.com/${source.repo}/${source.kind === 'blob' ? 'blob' : 'tree'}/${source.commit}${source.scope ? `/${githubPath(source.scope)}` : ''}`,
      title: source.repo, publisher: source.repo.split('/')[0], checkedAt: dates.updatedAt,
      location: source.kind === 'blob' ? source.scope : source.scope || 'Repository tree',
      finding: 'The fixed commit and complete recursive tree identify these SKILL.md entries. Every read Skill and license blob was checked against its Git SHA. This does not establish resource completeness or installation compatibility.',
      supportsItemIds: [...new Set(supportedIds)],
    })) },
    cover, skills,
    verification: { source: 'verified', files: 'needs-review', installation: 'not-tested', workflow: 'not-tested', checkedAt: dates.updatedAt, notes: ['GitHub commit, recursive tree, and read blob hashes were verified. Supporting resources, dependencies, installation, workflow, and image rights have not been verified.'] },
  };
  if (previousDocument?.sortOrder !== undefined) document.sortOrder = previousDocument.sortOrder;
  if (previousDocument?.curator !== undefined) document.curator = structuredClone(previousDocument.curator);
  retainCollectionSource(document, contribution);
  return { language: record.language, document, ...(coverFile ? { coverFile } : {}) };
}
