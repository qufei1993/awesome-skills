import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseDocument } from 'yaml';

const codec = () => import('../scripts/lib/markdown.mjs');
const draft = `---
language: zh
slug: example
status: draft
sourceKind: editorial-selection
category: development
tags: []
---
# 示例合集

用于完成日常开发任务。

## 概览

一组可组合的 Skills。

## 适用场景

- 开发功能
- 修复错误

## 使用建议

先确定问题，再选择工具。

## Skills

### example

帮助完成当前任务。

\`\`\`yaml
id: example
entry:
  repo: owner/repo
  entryPoint: skills/example/SKILL.md
installationMode: skill
installationItems:
  - name: example
    repo: owner/repo
    directory: skills/example
    entryPoint: SKILL.md
    license:
      identifier: NOASSERTION
resourceCheck: needs-review
resourceNotes: 尚未实测。
\`\`\`
`;

test('all three website fixtures round-trip without changing identity, review, translations or installation data', async () => {
  const { parseCollectionMarkdown, serializeCollectionMarkdown } = await codec();
  const files = (await readdir(new URL('./fixtures/site/', import.meta.url))).filter(file => file.endsWith('.json'));
  assert.equal(files.length, 3);
  for (const file of files) {
    const original = JSON.parse(await readFile(new URL(`./fixtures/site/${file}`, import.meta.url), 'utf8'));
    const text = serializeCollectionMarkdown(original, { coverFile: 'cover.webp' });
    const result = parseCollectionMarkdown(text, { filename: file.replace('.json', '/README.md') });
    assert.deepEqual(result.document, original, file);
    assert.equal(result.language, 'zh');
    assert.equal(result.coverFile, 'cover.webp');
    assert.equal(result.curator, undefined);
    const metadata = parseDocument(text.split('---')[1]).toJS();
    for (const field of ['title', 'name', 'description', 'overview', 'scenarios', 'usage', 'skills']) {
      assert.equal(Object.hasOwn(metadata, field), false, field);
    }
  }
});

test('drafts retain missing maintenance metadata and commits rather than inventing them', async () => {
  const { parseCollectionMarkdown } = await codec();
  const { document, language, curator, coverFile } = parseCollectionMarkdown(draft);
  assert.equal(document.title, '示例合集');
  assert.equal(language, 'zh');
  assert.deepEqual(document.scenarios, ['开发功能', '修复错误']);
  for (const field of ['id', 'revision', 'createdAt', 'updatedAt', 'review', 'verification']) assert.equal(document[field], undefined);
  assert.equal(document.skills[0].entry.commit, undefined);
  assert.equal(curator, undefined);
  assert.equal(coverFile, undefined);
});

test('English canonical sections and language are accepted', async () => {
  const { parseCollectionMarkdown } = await codec();
  const source = draft.replace('language: zh', 'language: en').replace('## 概览', '## Overview').replace('## 适用场景', '## Scenarios').replace('## 使用建议', '## Usage');
  assert.equal(parseCollectionMarkdown(source).language, 'en');
});

test('images on either side of introduction do not become description', async () => {
  const { parseCollectionMarkdown } = await codec();
  const source = draft.replace('用于完成日常开发任务。', '![前图](cover.webp)\n\n用于完成日常开发任务。\n\n![后图](cover.webp)');
  assert.equal(parseCollectionMarkdown(source).document.description, '用于完成日常开发任务。');
});

test('heading-looking code is prose, not a real section boundary', async () => {
  const { parseCollectionMarkdown } = await codec();
  const source = draft.replace('一组可组合的 Skills。', '一组可组合的 Skills。\n\n```text\n## Skills\n### fake\n```');
  const result = parseCollectionMarkdown(source);
  assert.equal(result.document.skills.length, 1);
  assert.match(result.document.overview, /## Skills\n### fake/);
});

for (const [name, transform, pattern] of [
  ['unknown frontmatter field', s => s.replace('slug: example', 'slug: example\nslgu: typo'), /slgu.*unknown|unknown.*slgu/i],
  ['body projection duplicated in frontmatter', s => s.replace('slug: example', 'slug: example\ntitle: duplicate'), /title.*body|body.*title/i],
  ['unknown Skill field', s => s.replace('id: example\nentry:', 'id: example\nunknownSkill: true\nentry:'), /unknownSkill/],
  ['unknown nested installation field', s => s.replace('directory: skills/example', 'directory: skills/example\n    hidden: true'), /installationItems.*hidden/],
  ['duplicate YAML keys', s => s.replace('slug: example', 'slug: example\nslug: duplicate'), /unique|duplicate/i],
  ['YAML aliases', s => s.replace('tags: []', 'tags: &shared []\nsourceKeys: *shared'), /alias|anchor/i],
  ['YAML merge keys', s => s.replace('tags: []', 'tags: []\nreview:\n  <<: {status: pending}'), /merge|<</i],
  ['missing required section', s => s.replace('## 概览', '概览'), /overview|概览/i],
  ['duplicate section with alternate language', s => s.replace('## 适用场景', '## Overview\n\n额外概览。\n\n## 适用场景'), /duplicate.*overview|overview.*duplicate/i],
  ['duplicate Skills section', s => `${s}\n## Skills\n`, /duplicate.*skills|skills.*duplicate/i],
  ['missing Skill YAML fence', s => s.replace(/```yaml[\s\S]*?```/, ''), /skills.*exactly one|exactly one.*yaml/i],
  ['duplicate Skill YAML fence', s => `${s}\n\`\`\`yaml\nid: extra\n\`\`\`\n`, /exactly one|duplicate.*yaml/i],
  ['Skill name duplicated inside YAML', s => s.replace('id: example\nentry:', 'id: example\nname: duplicate\nentry:'), /name.*body|body.*name/i],
  ['duplicate stable Skill ID', s => `${s}\n### second\n\nAnother summary.\n\n${s.match(/```yaml[\s\S]*?```/)[0]}\n`, /duplicate.*id|id.*duplicate/i],
  ['multiple introductions', s => s.replace('用于完成日常开发任务。', '第一段。\n\n第二段。'), /description|intro/i],
  ['non-list scenarios', s => s.replace('- 开发功能\n- 修复错误', '开发功能，修复错误。'), /scenarios|适用场景/i],
]) {
  test(`reports filename and useful field for ${name}`, async () => {
    const { parseCollectionMarkdown } = await codec();
    assert.throws(() => parseCollectionMarkdown(transform(draft), { filename: 'collections/example/README.md' }), error => {
      assert.match(error.message, /collections\/example\/README\.md/);
      assert.match(error.message, pattern);
      return true;
    });
  });
}

test('translation files round-trip presentation with stable IDs and never carry installation data', async () => {
  const { parseTranslationMarkdown, serializeTranslationMarkdown } = await codec();
  const presentation = {
    title: 'Example collection', description: 'A brief introduction.', tags: ['Development'],
    overview: 'Composable tools.', scenarios: ['Build a feature'], usage: 'Choose by task.',
    coverAlt: 'Example cover', provenance: { selectionReason: 'This is useful.' },
    skills: { example: { summary: 'Complete the task.', role: 'Implement' } },
  };
  const source = serializeTranslationMarkdown(presentation, { id: 'stable-collection', language: 'en' });
  assert.deepEqual(parseTranslationMarkdown(source), { id: 'stable-collection', language: 'en', presentation });
  assert.throws(() => parseTranslationMarkdown(source.replace('id: example', 'id: example\ninstallationMode: skill')), /installationMode/);
});

test('preserves real website test and cover rights evidence while rejecting unknown evidence fields', async () => {
  const { parseCollectionMarkdown, serializeCollectionMarkdown } = await codec();
  const fixture = JSON.parse(await readFile(new URL('./fixtures/site/e3a003dc-3ea5-4cc5-b5a4-088d1b74985c.json', import.meta.url), 'utf8'));
  fixture.cover.rightsEvidenceUrl = 'https://example.com/rights';
  const evidence = {
    testedAt: '2026-10-01', versions: [{ repo: 'owner/repo', commit: 'a'.repeat(40) }],
    itemIds: ['design-taste-frontend'], resultRef: 'https://example.com/result', environment: 'Temporary test directory',
  };
  fixture.verification.installationEvidence = evidence;
  fixture.verification.workflowEvidence = structuredClone(evidence);
  assert.deepEqual(parseCollectionMarkdown(serializeCollectionMarkdown(fixture)).document, fixture);
  fixture.verification.workflowEvidence.versions[0].hidden = true;
  assert.throws(() => serializeCollectionMarkdown(fixture), /workflowEvidence\.versions\[0\]\.hidden/);
});

test('fenced heading-like summary and inline formatting survive serialize and parse', async () => {
  const { parseCollectionMarkdown, serializeCollectionMarkdown } = await codec();
  const document = parseCollectionMarkdown(draft).document;
  document.title = 'Example [literal] # title * text';
  document.skills[0].name = 'example [literal] # *';
  document.skills[0].summary = 'Use **bold** and [docs](https://example.com).\n\n```text\n### fake Skill\n## Skills\n```';
  assert.deepEqual(parseCollectionMarkdown(serializeCollectionMarkdown(document)).document, document);
});

test('summary on both sides of its metadata fence never includes machine YAML', async () => {
  const { parseCollectionMarkdown } = await codec();
  const document = parseCollectionMarkdown(`${draft}\n额外使用说明。\n`).document;
  assert.equal(document.skills[0].summary, '帮助完成当前任务。\n\n额外使用说明。');
  assert.doesNotMatch(document.skills[0].summary, /installationMode|```yaml/);
});

test('curator attribution enters JSON, normalizes a name string, and survives serialization', async () => {
  const { parseCollectionMarkdown, serializeCollectionMarkdown } = await codec();
  const source = draft.replace('language: zh', 'language: zh\ncurator: Community Curator');
  const result = parseCollectionMarkdown(source);
  assert.equal(result.curator, 'Community Curator');
  assert.deepEqual(result.document.curator, { name: 'Community Curator' });
  const text = serializeCollectionMarkdown(result.document);
  assert.deepEqual(parseCollectionMarkdown(text).document, result.document);
  const overridden = serializeCollectionMarkdown(result.document, { curator: { name: 'Updated Curator', url: 'https://example.com/curator' } });
  assert.deepEqual(parseCollectionMarkdown(overridden).document.curator, { name: 'Updated Curator', url: 'https://example.com/curator' });
});
