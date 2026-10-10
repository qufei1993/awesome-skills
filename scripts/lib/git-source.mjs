import { execFile } from 'node:child_process';
import { mkdir, lstat, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/i;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_BLOB_BYTES = 1024 * 1024;

export function createGitHubRequest({ rootDir = process.cwd() } = {}) {
  const canonicalRoot = realpath(rootDir);
  const repositories = new Map(), commits = new Map();
  async function git(directory, args, fetchSource = false) {
    try {
      const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
      const { stdout } = await execute('git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'fetch.recurseSubmodules=false', '-c', 'transfer.fsckObjects=true', '-C', directory, ...args], {
        encoding: 'buffer', timeout: fetchSource ? 120_000 : 30_000, maxBuffer: MAX_BYTES,
        env: { ...environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
      });
      return stdout;
    } catch (error) {
      const missing = /couldn't find remote ref|not our ref|unadvertised object/i.test(error.stderr?.toString() || '');
      throw Object.assign(new Error(missing ? 'GitHub source ref was not found' : 'GitHub repository data could not be read'), { status: missing ? 404 : undefined });
    }
  }
  async function repository(repo) {
    if (!repositories.has(repo)) repositories.set(repo, (async () => {
      let directory = await canonicalRoot;
      for (const part of ['dist', 'upstream-repositories', ...repo.split('/')]) {
        directory = path.join(directory, part);
        try { await mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        const entry = await lstat(directory);
        if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('Git source cache must remain inside its directory');
      }
      let initialized = true;
      try {
        const gitDir = (await git(directory, ['rev-parse', '--absolute-git-dir'])).toString().trim();
        initialized = gitDir === directory || gitDir === path.join(directory, '.git');
      } catch { initialized = false; }
      const remote = `https://github.com/${repo}.git`;
      if (!initialized) {
        await git(directory, ['init', '--bare', '--quiet']);
        await git(directory, ['remote', 'add', 'origin', remote]);
      }
      if ((await git(directory, ['remote', 'get-url', 'origin'])).toString().trim().toLowerCase() !== remote) throw new Error('Git source cache remote does not match its GitHub repository');
      return directory;
    })());
    return repositories.get(repo);
  }
  async function objectType(directory, sha, expected) {
    if ((await git(directory, ['cat-file', '-t', sha])).toString().trim() !== expected) throw new Error(`Git source object must be a ${expected}`);
  }
  return async endpoint => {
    const match = /^\/repos\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9_.-]+)(\/.*)?$/i.exec(endpoint);
    if (!match || ['.', '..'].includes(match[2])) throw new Error('Invalid GitHub source endpoint');
    const repo = `${match[1]}/${match[2]}`.toLowerCase(), suffix = match[3] || '';
    if (!suffix) {
      const directory = await repository(repo);
      const head = (await git(directory, ['ls-remote', '--symref', 'origin', 'HEAD'], true)).toString();
      const branch = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(head)?.[1];
      if (!branch) throw new Error('GitHub repository has no default branch');
      return { default_branch: branch };
    }
    if (suffix.startsWith('/commits/')) {
      let ref;
      try { ref = decodeURIComponent(suffix.slice('/commits/'.length)); } catch { throw new Error('Invalid GitHub source ref'); }
      if (!ref || /[\u0000-\u0020\u007f\\]/.test(ref) || ref.startsWith('-') || ref.split('/').some(part => !part || part === '.' || part === '..')) throw Object.assign(new Error('Invalid GitHub source ref'), { status: 404 });
      const key = `${repo}\0${ref}`;
      if (!commits.has(key)) commits.set(key, (async () => {
        const directory = await repository(repo);
        if (!SHA.test(ref)) {
          try { await git(directory, ['check-ref-format', '--allow-onelevel', ref]); }
          catch { throw Object.assign(new Error('Invalid GitHub source ref'), { status: 404 }); }
        }
        let sha;
        if (SHA.test(ref)) {
          try { await objectType(directory, ref, 'commit'); sha = ref.toLowerCase(); } catch { /* Fetch a fixed commit missing from the cache. */ }
        }
        if (!sha) {
          await git(directory, ['fetch', '--quiet', '--depth=1', '--no-tags', '--', 'origin', ref], true);
          sha = (await git(directory, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).toString().trim();
        }
        if (!SHA.test(sha) || SHA.test(ref) && sha !== ref.toLowerCase()) throw new Error('GitHub source returned a different commit');
        const tree = (await git(directory, ['rev-parse', `${sha}^{tree}`])).toString().trim();
        return { sha, commit: { tree: { sha: tree } } };
      })());
      return commits.get(key);
    }
    const tree = /^\/git\/trees\/([a-f0-9]{40})\?recursive=1$/i.exec(suffix);
    const blob = /^\/git\/blobs\/([a-f0-9]{40})$/i.exec(suffix);
    if (!tree && !blob) throw new Error('Invalid GitHub source endpoint');
    const directory = await repository(repo), sha = (tree || blob)[1].toLowerCase();
    await objectType(directory, sha, tree ? 'tree' : 'blob');
    if (tree) {
      const bytes = await git(directory, ['ls-tree', '-r', '-t', '-l', '-z', sha]);
      let listing;
      try { listing = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new Error('Git repository tree paths must use valid UTF-8'); }
      const entries = listing.split('\0').filter(Boolean).map(line => {
        const item = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40})\s+(\d+|-)\t([\s\S]+)$/.exec(line);
        if (!item) throw new Error('Invalid Git repository tree');
        return { mode: item[1], type: item[2], sha: item[3], path: item[5], ...(item[4] !== '-' ? { size: Number(item[4]) } : {}) };
      });
      return { sha, truncated: false, tree: entries };
    }
    const size = Number((await git(directory, ['cat-file', '-s', sha])).toString().trim());
    if (!Number.isSafeInteger(size) || size > MAX_BLOB_BYTES) throw new Error('Git blob exceeds the size limit');
    const bytes = await git(directory, ['cat-file', 'blob', sha]);
    return { sha, size, encoding: 'base64', content: bytes.toString('base64') };
  };
}
