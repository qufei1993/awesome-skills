import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { serializeContributionMarkdown } from '../../scripts/lib/contribution.mjs';

export const UPSTREAM_SHA = 'a'.repeat(40);
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=', 'base64');
export const skillText = (name, description = `Use ${name} for useful work.`) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# Instructions\n\nRead this fixture as data.\n`;

export function fixtureUpstream({ files, repo = 'example/tools', ref = UPSTREAM_SHA, repositories, refs = { main: ref, [ref]: ref } } = {}) {
  const entries = new Map(Object.entries(repositories ?? { [repo]: files ?? { 'skills/plan-work/SKILL.md': skillText('plan-work') } }).map(([repository, contents]) => {
    const blobs = new Map();
    const tree = Object.entries(contents).map(([filename, content]) => {
      const bytes = Buffer.from(content);
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      blobs.set(sha, bytes);
      return { path: filename, type: 'blob', mode: '100644', sha, size: bytes.length };
    });
    return [repository, { blobs, tree }];
  }));
  const treeSha = 'b'.repeat(40);
  return async endpoint => {
    const match = /^\/repos\/([^/]+\/[^/]+)(.*)$/.exec(endpoint);
    const repository = entries.get(match?.[1]);
    if (!repository) throw Object.assign(new Error(`Unknown fixture repository: ${endpoint}`), { status: 404 });
    const suffix = match[2];
    if (!suffix) return { default_branch: 'main', owner: { login: match[1].split('/')[0] } };
    if (suffix.startsWith('/commits/')) {
      const revision = refs[decodeURIComponent(suffix.slice('/commits/'.length))];
      if (!revision) throw Object.assign(new Error(`Unknown fixture ref: ${endpoint}`), { status: 404 });
      return { sha: revision, commit: { tree: { sha: treeSha }, committer: { date: '2026-10-01T00:00:00Z' } } };
    }
    if (suffix === `/git/trees/${treeSha}?recursive=1`) return { sha: treeSha, truncated: false, tree: repository.tree };
    if (suffix.startsWith('/git/blobs/')) {
      const sha = suffix.slice('/git/blobs/'.length), bytes = repository.blobs.get(sha);
      if (!bytes) throw Object.assign(new Error(`Unknown fixture blob: ${endpoint}`), { status: 404 });
      return { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
    }
    throw new Error(`Unexpected fixture request: ${endpoint}`);
  };
}

export async function writeSubmission(rootDir, { slug = 'planning', category = 'development', language = 'en', ...fields } = {}) {
  const directory = path.join(rootDir, 'collections', category, slug);
  const data = {
    title: 'Planning', description: 'Plan work with selected Skills.', overview: 'Use these Skills to plan useful work.',
    scenarios: ['Plan a feature'], usage: 'Choose a Skill for the task.', links: [`https://github.com/example/tools/tree/${UPSTREAM_SHA}/skills`],
    ...fields,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, language === 'zh' ? 'README.zh.md' : 'README.md'), serializeContributionMarkdown(data, { language }));
  return { directory, data };
}
