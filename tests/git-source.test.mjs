import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createGitHubRequest } from '../scripts/lib/git-source.mjs';
import { resolveSubmission } from '../scripts/lib/upstream.mjs';

async function fixture(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'skills-git-source-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const repository = path.join(rootDir, 'dist/upstream-repositories/example/tools');
  await mkdir(path.join(repository, 'skills/plan'), { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/example/tools.git');
  const skill = '---\nname: plan\ndescription: Plan a task.\n---\n\nPlan the task.\n';
  await writeFile(path.join(repository, 'skills/plan/SKILL.md'), skill);
  await writeFile(path.join(repository, 'alias'), 'Not a Skill.');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  return { rootDir, git, skill, commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), blob: git('rev-parse', 'HEAD:skills/plan/SKILL.md') };
}

test('a fixed source reads its complete tree and original blob from a cached clone', async t => {
  const data = await fixture(t);
  const request = createGitHubRequest({ rootDir: data.rootDir });
  const source = await request(`/repos/example/tools/commits/${data.commit}`);
  assert.equal(source.sha, data.commit);
  assert.equal(source.commit.tree.sha, data.tree);
  const tree = await request(`/repos/example/tools/git/trees/${data.tree}?recursive=1`);
  assert.equal(tree.truncated, false);
  assert.deepEqual(tree.tree.filter(item => item.type === 'blob').map(item => item.path), ['alias', 'skills/plan/SKILL.md']);
  const entry = tree.tree.find(item => item.path === 'skills/plan/SKILL.md');
  assert.equal(entry.sha, data.blob);
  assert.equal(entry.mode, '100644');
  const blob = await request(`/repos/example/tools/git/blobs/${data.blob}`);
  assert.equal(Buffer.from(blob.content, 'base64').toString(), data.skill);
  assert.equal(blob.size, Buffer.byteLength(data.skill));
});

test('Git environment cannot redirect the source cache to an external directory', async t => {
  const data = await fixture(t);
  const external = path.join(data.rootDir, 'external-repository');
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = external;
  t.after(() => { if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous; });
  const blob = await createGitHubRequest({ rootDir: data.rootDir })(`/repos/example/tools/git/blobs/${data.blob}`);
  assert.equal(Buffer.from(blob.content, 'base64').toString(), data.skill);
  await assert.rejects(access(external), { code: 'ENOENT' });
});

test('replace refs cannot change the contents of a fixed source commit', async t => {
  const data = await fixture(t);
  await writeFile(path.join(data.rootDir, 'dist/upstream-repositories/example/tools/skills/plan/SKILL.md'), data.skill.replace('Plan a task.', 'Replaced description.'));
  data.git('add', '.'); data.git('commit', '-qm', 'replacement');
  data.git('replace', data.commit, data.git('rev-parse', 'HEAD'));
  const source = await createGitHubRequest({ rootDir: data.rootDir })(`/repos/example/tools/commits/${data.commit}`);
  assert.equal(source.commit.tree.sha, data.tree);
});

test('a symlinked cache parent is refused before creating directories outside the cache', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'skills-git-parent-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const external = path.join(rootDir, 'external');
  await mkdir(external);
  await mkdir(path.join(rootDir, 'dist'));
  await symlink(external, path.join(rootDir, 'dist/upstream-repositories'));
  await assert.rejects(createGitHubRequest({ rootDir })(`/repos/example/tools/git/blobs/${'a'.repeat(40)}`), /directory/);
  await assert.rejects(access(path.join(external, 'example')), { code: 'ENOENT' });
});

test('cached transport configuration cannot start a custom remote helper', async t => {
  const data = await fixture(t);
  const marker = path.join(data.rootDir, 'helper-started');
  await writeFile(path.join(data.rootDir, 'git-remote-review'), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\nprocess.stdout.write(${JSON.stringify(`ref: refs/heads/main\tHEAD\n${data.commit}\tHEAD\n`)});\n`, { mode: 0o755 });
  data.git('config', 'remote.origin.vcs', 'review');
  const previous = process.env.PATH;
  process.env.PATH = `${data.rootDir}${path.delimiter}${previous}`;
  t.after(() => { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; });
  await assert.rejects(createGitHubRequest({ rootDir: data.rootDir })('/repos/example/tools'), /could not be read/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
});

test('Git tree paths must be valid UTF-8 so installation paths remain exact', async t => {
  const data = await fixture(t);
  const repository = path.join(data.rootDir, 'dist/upstream-repositories/example/tools');
  const tree = bytes => execFileSync('git', ['mktree', '-z'], { cwd: repository, input: bytes, encoding: 'utf8' }).trim();
  const child = tree(Buffer.from(`100644 blob ${data.blob}\tSKILL.md\0`));
  const invalid = tree(Buffer.concat([Buffer.from(`040000 tree ${child}\tbad-`), Buffer.from([0xff, 0])]));
  await assert.rejects(createGitHubRequest({ rootDir: data.rootDir })(`/repos/example/tools/git/trees/${invalid}?recursive=1`), /UTF-8/);
});

test('Git source rejects foreign endpoints and object types instead of reading arbitrary data', async t => {
  const data = await fixture(t);
  const request = createGitHubRequest({ rootDir: data.rootDir });
  await assert.rejects(request('/repos/../tools/commits/' + data.commit), /endpoint/);
  await assert.rejects(request('https://outside.invalid/repos/example/tools'), /endpoint/);
  await assert.rejects(request(`/repos/example/tools/git/blobs/${data.commit}`), /blob/);
  await assert.rejects(request(`/repos/example/tools/git/trees/${data.blob}?recursive=1`), /tree/);
});

test('commit refs are literal names rather than writable fetch refspecs', async t => {
  const data = await fixture(t);
  await assert.rejects(createGitHubRequest({ rootDir: data.rootDir })('/repos/example/tools/commits/HEAD%3Arefs%2Fheads%2Funsafe'), error => {
    assert.equal(error.status, 404);
    assert.match(error.message, /Invalid GitHub source ref/);
    return true;
  });
  assert.throws(() => data.git('rev-parse', '--verify', 'refs/heads/unsafe'));
});

test('a clone whose remote points elsewhere is refused before reading cached objects', async t => {
  const data = await fixture(t);
  data.git('remote', 'set-url', 'origin', 'https://outside.invalid/example/tools.git');
  const request = createGitHubRequest({ rootDir: data.rootDir });
  await assert.rejects(request(`/repos/example/tools/commits/${data.commit}`), /remote/);
});

test('a credential-bearing cached remote is refused without exposing its credential', async t => {
  const data = await fixture(t);
  data.git('remote', 'set-url', 'origin', 'https://fixture-secret@github.com/example/tools.git');
  await assert.rejects(createGitHubRequest({ rootDir: data.rootDir })(`/repos/example/tools/commits/${data.commit}`), error => {
    assert.match(error.message, /remote/);
    assert.ok(!error.message.includes('fixture-secret'));
    return true;
  });
});

test('Git source refuses oversized blobs while allowing ordinary Skill metadata', async t => {
  const data = await fixture(t);
  await writeFile(path.join(data.rootDir, 'dist/upstream-repositories/example/tools/oversized'), Buffer.alloc(1024 * 1024 + 1));
  data.git('add', 'oversized'); data.git('commit', '-qm', 'oversized blob');
  const id = data.git('rev-parse', 'HEAD:oversized');
  await assert.rejects(createGitHubRequest({ rootDir: data.rootDir })(`/repos/example/tools/git/blobs/${id}`), /size limit/);
});

test('catalog generation uses a pinned clone without a per-file HTTP API request', async t => {
  const data = await fixture(t);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Per-file HTTP requests must not be needed'); });
  const contribution = { title: 'Planning', description: 'Plan a task.', overview: 'Planning tools.', scenarios: ['Plan a task'], usage: 'Choose planning.', links: [`https://github.com/example/tools/tree/${data.commit}/skills`] };
  const result = await resolveSubmission({ language: 'en', document: { slug: 'planning', category: 'development', ...contribution }, publicReadmes: { en: contribution } }, {
    rootDir: data.rootDir, inputDigest: 'c'.repeat(64), dates: { createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z' },
  });
  assert.equal(result.document.skills.length, 1);
  assert.equal(result.document.skills[0].entry.commit, data.commit);
  assert.equal(result.document.skills[0].originalDescription, 'Plan a task.');
  assert.equal(result.document.skills[0].installationItems[0].directory, 'skills/plan');
  assert.equal(result.document.review.status, 'pending');
});
