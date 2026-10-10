import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveSubmission } from '../scripts/lib/upstream.mjs';
import { validateCollection } from '../scripts/lib/site-contract.mjs';

const sha = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
const commit = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const dates = { createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' };
const inputDigest = 'c'.repeat(64);
const mit = 'MIT License\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\nTHE SOFTWARE IS PROVIDED "AS IS".';
const skill = (name, description = `Use ${name} for useful work.`) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# Instructions\n\nDo work.\n`;
function record(links, extra = {}) {
  const contribution = { title: 'Useful Skills', description: 'Everyday work.', overview: 'Useful work with Skills.', scenarios: ['Build useful things'], usage: 'Choose a Skill for the task.', links, ...extra };
  return { language: 'en', document: { slug: 'useful-skills', category: 'development', ...contribution }, publicReadmes: { en: contribution } };
}
function upstream(files, { refs = { main: commit }, truncated = false, corrupt = false } = {}) {
  const blobs = new Map();
  const tree = Object.entries(files).map(([path, content]) => {
    const id = sha(content);
    blobs.set(id, content);
    return { path, type: 'blob', mode: '100644', sha: id, size: Buffer.byteLength(content) };
  });
  const calls = [];
  const request = async endpoint => {
    calls.push(endpoint);
    const relative = endpoint.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    if (!relative) return { default_branch: 'main' };
    if (relative.startsWith('/commits/')) {
      const ref = decodeURIComponent(relative.slice('/commits/'.length));
      if (!refs[ref]) throw Object.assign(new Error('Not Found'), { status: 404 });
      return { sha: refs[ref], commit: { tree: { sha: treeSha } } };
    }
    if (relative === `/git/trees/${treeSha}?recursive=1`) return { sha: treeSha, truncated, tree };
    if (relative.startsWith('/git/blobs/')) {
      const id = relative.slice('/git/blobs/'.length), content = blobs.get(id);
      if (content === undefined) throw new Error(`Missing fixture blob ${id}`);
      return { sha: id, encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(corrupt ? `${content.slice(0, -1)}X` : content).toString('base64') };
    }
    throw new Error(`Unexpected API request ${endpoint}`);
  };
  return { request, calls };
}
const resolve = (submission, options) => resolveSubmission(submission, { inputDigest, dates, ...options });

test('repository and tree links discover standalone Skills, while blob links select one and overlaps deduplicate', async () => {
  const mock = upstream({ 'skills/first/SKILL.md': skill('first'), 'skills/deep/second/SKILL.md': skill('second'), 'elsewhere/SKILL.md': skill('elsewhere'), LICENSE: mit });
  const result = await resolve(record([
    'https://github.com/example/tools/tree/main/skills',
    'https://github.com/example/tools/blob/main/skills/first/SKILL.md',
    'https://github.com/another/tools/blob/main/elsewhere/SKILL.md',
  ]), mock);
  assert.equal(result.document.skills.length, 3);
  assert.deepEqual(result.document.skills.map(item => item.entry.entryPoint), ['skills/deep/second/SKILL.md', 'skills/first/SKILL.md', 'elsewhere/SKILL.md']);
  assert.ok(result.document.skills.every(item => item.entry.commit === commit && item.originalDescription === item.summary));
  assert.equal(result.document.skills[0].installationItems[0].license.identifier, 'MIT');
  assert.equal(result.document.skills[0].installationItems[0].license.evidenceUrl, `https://github.com/example/tools/blob/${commit}/LICENSE`);
  assert.equal(result.document.review.status, 'pending');
  assert.deepEqual(result.document.verification, { source: 'verified', files: 'needs-review', installation: 'not-tested', workflow: 'not-tested', checkedAt: dates.updatedAt, notes: ['GitHub commit, recursive tree, and read blob hashes were verified. Supporting resources, dependencies, installation, workflow, and image rights have not been verified.'] });
  assert.ok(result.document.sourceKeys.includes(`readme:${inputDigest}`));
  assert.equal(new Set(result.document.skills.map(item => item.id)).size, 3);
  await validateCollection(result.document, `${result.document.id}.json`, '.');
  const all = await resolve(record(['https://github.com/example/tools']), mock);
  assert.equal(all.document.skills.length, 3);
});

test('Azure onboard phases remain resources of their parent Skill for directory links', async () => {
  // Microsoft azure-skills at cb1af2f0930ce2bd69fd4a627612eb76e171c17d:
  // .github/plugins/azure-skills/skills/azure-app-onboard/{SKILL.md,deploy/SKILL.md}.
  const directory = '.github/plugins/azure-skills/skills/azure-app-onboard';
  const parent = '---\nname: azure-app-onboard\ndescription: "End-to-end orchestrator: from a business idea, app idea, or existing app to running Azure deployment with cost estimates and pre-deploy approval."\n---\n\n# Azure App Onboard\n\nRead [Deploy](deploy/SKILL.md).\n';
  const phase = '# Deploy — IaC Execution & Health Verification\n\n| Parent | [azure-app-onboard](../SKILL.md) |\n\nInvoked by the `azure-app-onboard` orchestrator at Phase 4. Not directly user-routable.\n';
  const mock = upstream({ [`${directory}/SKILL.md`]: parent, [`${directory}/deploy/SKILL.md`]: phase, [`${directory}/references/pipeline-rules.md`]: 'Parent workflow resources.' });
  const result = await resolve(record([`https://github.com/microsoft/azure-skills/tree/main/${directory}`]), mock);
  assert.deepEqual(result.document.skills.map(item => item.entry.entryPoint), [`${directory}/SKILL.md`]);
  assert.equal(result.document.skills[0].installationItems[0].directory, directory);
  assert.ok(!mock.calls.some(endpoint => endpoint.endsWith(`/git/blobs/${sha(phase)}`)), 'Nested resource metadata must not become an independent entry');
  await validateCollection(result.document, `${result.document.id}.json`, '.');
});

test('explicit blob and directory links can select an independent nested Skill under a parent entry', async () => {
  const files = { 'SKILL.md': skill('router'), 'skills/child/SKILL.md': skill('child'), 'skills/child/nested/SKILL.md': skill('nested') };
  const repository = 'https://github.com/example/tools';
  const root = await resolve(record([repository]), upstream(files));
  assert.deepEqual(root.document.skills.map(item => item.name), ['router']);
  const explicit = await resolve(record([repository, `${repository}/tree/main/skills/child`, `${repository}/blob/main/skills/child/nested/SKILL.md`]), upstream(files));
  assert.deepEqual(explicit.document.skills.map(item => item.name), ['router', 'child', 'nested']);
  assert.deepEqual(explicit.document.skills.map(item => item.installationItems[0].directory), ['.', 'skills/child', 'skills/child/nested']);
});

test('same author names across directories and repositories retain every Skill with stable installation names', async () => {
  const files = { 'skills/first/SKILL.md': skill('same-name'), 'skills/second/SKILL.md': skill('same-name') };
  const links = ['https://github.com/example/tools/tree/main/skills', 'https://github.com/another/tools/blob/main/skills/first/SKILL.md'];
  const first = await resolve(record(links), upstream(files));
  const reordered = await resolve(record([...links].reverse()), upstream(files));
  assert.equal(first.document.skills.length, 3);
  assert.deepEqual(first.document.skills.map(item => item.name), ['same-name', 'same-name', 'same-name']);
  const installed = document => Object.fromEntries(document.skills.map(item => [item.id, item.installationItems[0].name]));
  assert.deepEqual(installed(first.document), installed(reordered.document));
  assert.equal(new Set(Object.values(installed(first.document))).size, 3);
  assert.ok(Object.values(installed(first.document)).every(name => name !== 'same-name'));
  await validateCollection(first.document, `${first.document.id}.json`, '.');
});

test('namespace names and Windows directory conflicts get safe installation aliases while display names remain original', async () => {
  const names = ['stitch::react-components', 'Plan', 'plan', 'CON', 'NUL.txt', 'trailing.', 'question?', 'design|system', 'unchanged-name'];
  const files = Object.fromEntries(names.map((name, index) => [`skills/item-${index}/SKILL.md`, skill(name)]));
  const result = await resolve(record(['https://github.com/google-labs-code/stitch-skills']), upstream(files));
  assert.deepEqual(result.document.skills.map(item => item.name), names);
  const installationNames = result.document.skills.map(item => item.installationItems[0].name);
  assert.equal(new Set(installationNames.map(name => name.toLowerCase())).size, names.length);
  for (const name of installationNames) {
    assert.ok(!/[<>:"/\\|?*%#\u0000-\u001f\u007f]/.test(name), `Unsafe installation directory ${name}`);
    assert.ok(!/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name), `Windows-reserved installation directory ${name}`);
  }
  assert.equal(installationNames.at(-1), 'unchanged-name');
  assert.equal(result.document.verification.installation, 'not-tested');
  for (const item of result.document.skills.slice(0, -1)) {
    assert.match(item.resourceNotes, /desktop collection installation requires name mapping/);
    assert.match(item.resourceNotes, /upstream setup instructions/);
  }
  assert.doesNotMatch(result.document.skills.at(-1).resourceNotes, /requires name mapping/);
  await validateCollection(result.document, `${result.document.id}.json`, '.');
});

test('reading unquoted metadata prose records normalization while preserving the original description', async () => {
  const description = 'Build the workflow: preserve original author prose.';
  const source = `---\nname: useful\ndescription: ${description}\ncompatibility: Tools required: Node.js and a shell.\n---\n\n# Useful\n`;
  const result = await resolve(record(['https://github.com/example/tools']), upstream({ 'skills/useful/SKILL.md': source }));
  assert.equal(result.document.skills[0].originalDescription, description);
  assert.equal(result.document.skills[0].summary, description);
  assert.match(result.document.skills[0].resourceNotes, /Metadata scalar syntax normalized during read:/);
  assert.match(result.document.skills[0].resourceNotes, /description/);
  assert.match(result.document.skills[0].resourceNotes, /compatibility/);
  assert.match(result.document.skills[0].resourceNotes, /upstream content unchanged/);
});

test('author display names with path separators use separate safe installation names', async () => {
  const result = await resolve(record(['https://github.com/example/tools']), upstream({ 'skills/useful/SKILL.md': skill('design/system') }));
  assert.equal(result.document.skills[0].name, 'design/system');
  assert.match(result.document.skills[0].installationItems[0].name, /^[a-z0-9-]+$/);
  await validateCollection(result.document, `${result.document.id}.json`, '.');
});

test('a branch containing slashes is resolved as the longest valid ref before directory expansion', async () => {
  const mock = upstream({ 'skills/first/SKILL.md': skill('first') }, { refs: { 'feature/new-tools': commit, feature: 'd'.repeat(40) } });
  const result = await resolve(record(['https://github.com/example/tools/tree/feature/new-tools/skills']), mock);
  assert.equal(result.document.skills.length, 1);
  assert.ok(mock.calls.includes('/repos/example/tools/commits/feature%2Fnew-tools'));
  assert.ok(!mock.calls.includes('/repos/example/tools/commits/feature'));
});

test('fixed commits resolve without probing the nested directory as a branch', async () => {
  const mock = upstream({ 'skills/first/SKILL.md': skill('first') }, { refs: { [commit]: commit } });
  const result = await resolve(record([`https://github.com/example/tools/tree/${commit}/skills/first`]), mock);
  assert.equal(result.document.skills.length, 1);
  assert.deepEqual(mock.calls.filter(endpoint => endpoint.includes('/commits/')), [`/repos/example/tools/commits/${commit}`]);
});

test('the collection source link reaches website provenance for fresh and cached generation', async () => {
  const sourceUrl = 'https://publisher.example.com/collections/useful-skills';
  const submission = record(['https://github.com/example/tools'], { sourceUrl });
  const mock = upstream({ 'skills/first/SKILL.md': skill('first') });
  const first = await resolve(submission, mock);
  const evidence = first.document.provenance.evidence.find(item => item.url === sourceUrl);
  assert.ok(evidence, 'Website details must retain the README selection source');
  assert.equal(evidence.publisher, 'publisher.example.com');
  assert.equal(evidence.kind, 'article');
  assert.deepEqual(evidence.supportsItemIds, [first.document.skills[0].id]);
  const cached = await resolve(submission, { previous: first.document, request: () => { throw new Error('Unchanged input must reuse fixed sources'); } });
  assert.deepEqual(cached.document.provenance.evidence, first.document.provenance.evidence);
});

test('collection and Skill identities remain stable when README content changes', async () => {
  const mock = upstream({ 'skills/first/SKILL.md': skill('first') });
  const first = await resolve(record(['https://github.com/example/tools']), mock);
  const again = await resolve(record(['https://github.com/example/tools']), mock);
  assert.equal(first.document.id, again.document.id);
  assert.equal(first.document.skills[0].id, again.document.skills[0].id);
  const previous = structuredClone(first.document);
  previous.sourceKeys.push('source-history');
  const changed = await resolve(record(['https://github.com/example/tools']), { ...mock, previous, inputDigest: 'd'.repeat(64) });
  assert.equal(changed.document.id, previous.id);
  assert.equal(changed.document.skills[0].id, first.document.skills[0].id);
  assert.ok(changed.document.sourceKeys.includes('source-history'));
});

test('cached collection and Skill identities must correspond to their generated source paths', async () => {
  const mock = upstream({ 'skills/first/SKILL.md': skill('first') });
  const first = await resolve(record(['https://github.com/example/tools']), mock);
  const changedCollection = structuredClone(first.document);
  changedCollection.id = '110b7da3-cbb7-48ea-854b-0c476c7b2520';
  await assert.rejects(resolve(record(['https://github.com/example/tools']), { ...mock, previous: changedCollection }), /identity/);
  const changedSkill = structuredClone(first.document);
  changedSkill.skills[0].id = 'different-source';
  await assert.rejects(resolve(record(['https://github.com/example/tools']), { ...mock, previous: changedSkill }), /identity/);
});

test('unchanged input reuses previous fixed commits and data without network requests or a new timestamp', async () => {
  const mock = upstream({ 'skills/first/SKILL.md': skill('first') });
  const original = await resolve(record(['https://github.com/example/tools']), mock);
  const previous = original.document;
  previous.review = { status: 'approved', reviewer: 'user', reviewedAt: dates.updatedAt, notes: [] };
  const result = await resolve(record(['https://github.com/example/tools']), { previous, dates: { ...dates, updatedAt: '2026-10-09T00:00:00Z' }, request: () => { throw new Error('Unchanged input must not fetch'); } });
  assert.deepEqual(result.document, previous);
  assert.notEqual(result.document, previous);
});

test('unchanged README input regenerates a cached collection created before the current entry rules', async () => {
  const files = { 'skills/parent/SKILL.md': skill('parent'), 'skills/parent/phase/SKILL.md': skill('phase') };
  const submission = record(['https://github.com/example/tools/tree/main/skills']);
  const previous = (await resolve(submission, upstream(files))).document;
  const nested = await resolve(record(['https://github.com/example/tools/blob/main/skills/parent/phase/SKILL.md']), upstream(files));
  previous.skills.push(nested.document.skills[0]);
  previous.sourceKeys = previous.sourceKeys.filter(key => !key.startsWith('generator:'));
  previous.sourceKeys.push('historical-source');
  previous.revision = 7;
  const mock = upstream(files);
  const result = await resolve(submission, { ...mock, previous });
  assert.deepEqual(result.document.skills.map(item => item.name), ['parent']);
  assert.ok(mock.calls.some(endpoint => endpoint.includes('/git/blobs/')));
  assert.ok(result.document.sourceKeys.includes('generator:skill-entry-v1:useful-skills'));
  assert.ok(result.document.sourceKeys.includes('historical-source'));
  assert.equal(result.document.id, previous.id);
  assert.equal(result.document.revision, 7);
  assert.equal(result.document.createdAt, previous.createdAt);
  assert.equal(result.document.sourceKeys.at(-1), `readme:${inputDigest}`);
});

test('returning to a historical README digest resolves the current input instead of reusing unrelated latest data', async () => {
  const mock = upstream({ 'skills/first/SKILL.md': skill('first') });
  const first = await resolve(record(['https://github.com/example/tools']), mock);
  const previous = structuredClone(first.document);
  previous.sourceKeys.push(`readme:${'d'.repeat(64)}`);
  previous.skills[0].summary = 'Later unrelated content';
  const result = await resolve(record(['https://github.com/example/tools']), { ...mock, previous });
  assert.equal(result.document.skills[0].summary, 'Use first for useful work.');
  assert.equal(result.document.sourceKeys.at(-1), `readme:${inputDigest}`);
  assert.ok(mock.calls.some(endpoint => endpoint.includes('/git/blobs/')));
});

test('changing the upstream frontmatter name preserves deterministic Skill identity for the same repository path', async () => {
  const first = await resolve(record(['https://github.com/example/tools']), upstream({ 'skills/first/SKILL.md': skill('old-name') }));
  const second = await resolve(record(['https://github.com/example/tools']), upstream({ 'skills/first/SKILL.md': skill('new-name') }));
  assert.equal(first.document.skills[0].id, second.document.skills[0].id);
  assert.equal(second.document.skills[0].installationItems[0].name, 'new-name');
});

test('unknown license is NOASSERTION and a nearer unknown license does not inherit root MIT', async () => {
  const mock = upstream({ 'skills/first/SKILL.md': skill('first'), 'skills/first/LICENSE': 'Custom non-commercial terms.', LICENSE: mit });
  const result = await resolve(record(['https://github.com/example/tools']), mock);
  assert.equal(result.document.skills[0].installationItems[0].license.identifier, 'NOASSERTION');
  assert.equal(result.document.skills[0].installationItems[0].license.evidenceUrl, `https://github.com/example/tools/blob/${commit}/skills/first/LICENSE`);
  const missing = await resolve(record(['https://github.com/example/tools']), upstream({ 'skills/first/SKILL.md': skill('first') }));
  assert.deepEqual(missing.document.skills[0].installationItems[0].license, { identifier: 'NOASSERTION' });
});

test('local and external README covers map to contract data and remain unverified', async () => {
  const mock = upstream({ 'skills/first/SKILL.md': skill('first') });
  const local = await resolve(record(['https://github.com/example/tools'], { cover: { url: 'images/cover.png', alt: 'A concept cover' } }), mock);
  assert.equal(local.coverFile, 'images/cover.png');
  assert.equal(local.document.cover.url, '/assets/collections/useful-skills.png');
  assert.equal(local.document.cover.rightsStatus, 'needs-review');
  assert.equal(local.document.cover.sourceUrl, 'https://github.com/qufei1993/awesome-skills');
  const external = await resolve(record(['https://github.com/example/tools'], { cover: { url: 'https://images.example.com/cover.png', alt: 'Upstream cover' } }), mock);
  assert.equal(external.coverFile, undefined);
  assert.equal(external.document.cover.url, 'https://images.example.com/cover.png');
  assert.equal(external.document.cover.sourceUrl, 'https://images.example.com/cover.png');
});

for (const [name, files, options, expected] of [
  ['a mismatched blob hash', { 'skills/first/SKILL.md': skill('first') }, { corrupt: true }, /blob hash.*mismatch/i],
  ['invalid YAML frontmatter', { 'skills/first/SKILL.md': '---\nname: first\nname: second\ndescription: useful\n---\n' }, {}, /frontmatter/],
  ['missing description', { 'skills/first/SKILL.md': '---\nname: first\n---\n' }, {}, /description/],
  ['a truncated recursive tree', { 'skills/first/SKILL.md': skill('first') }, { truncated: true }, /truncated/],
  ['a symlink SKILL entry', { 'skills/first/SKILL.md': skill('first') }, {}, /regular file/],
]) {
  test(`rejects ${name} instead of silently publishing an incomplete or unsafe collection`, async () => {
    const mock = upstream(files, options);
    if (name === 'a symlink SKILL entry') {
      const original = mock.request;
      mock.request = async endpoint => { const value = await original(endpoint); if (value.tree) value.tree[0].mode = '120000'; return value; };
    }
    await assert.rejects(resolve(record(['https://github.com/example/tools']), mock), expected);
  });
}

test('non-GitHub sources and unsafe paths fail before any HTTP request', async () => {
  for (const link of ['https://example.com/repo', 'https://github.com/example/tools/blob/main/%2E%2E/SKILL.md', 'https://github.com@example.com/example/tools', 'https://github.com/example/tools?token=secret']) {
    await assert.rejects(resolve(record([link]), { request: () => { throw new Error('Unexpected network'); } }), /GitHub|URL|path/);
  }
});
