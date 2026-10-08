import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const codec = () => import('../scripts/lib/contribution.mjs');
const presentation = {
  overview: 'Combine planning, implementation, and review Skills for everyday development.',
  scenarios: ['New features', 'Bug fixes'],
  usage: 'Clarify the task, then choose the Skills needed for implementation and review.',
};

const draft = `# Useful Skills

A collection for **daily development**.

## Overview

Combine planning, implementation, and review Skills for everyday development.

## Scenarios

- New features
- Bug fixes

## Usage

Clarify the task, then choose the Skills needed for implementation and review.

## Skills

- https://github.com/example/tools
- [One useful Skill](https://github.com/example/skills/blob/main/skills/useful/SKILL.md)
`;

for (const [field, heading, nextHeading] of [
  ['overview', 'Overview', 'Scenarios'],
  ['scenarios', 'Scenarios', 'Usage'],
  ['usage', 'Usage', 'Skills'],
]) {
  test(`requires ${field} instead of silently losing a website detail section`, async () => {
    const { parseContributionMarkdown } = await codec();
    const source = draft.replace(new RegExp(`## ${heading}\\n[\\s\\S]*?(?=## ${nextHeading})`), '');
    assert.throws(() => parseContributionMarkdown(source, {filename:'README.md'}), new RegExp(`README\\.md: ${field}:`));
  });
}

for (const [name, transform, field] of [
  ['empty overview', s => s.replace(presentation.overview, ''), 'overview'],
  ['multiple overview paragraphs', s => s.replace(presentation.overview, 'First scope.\n\nSecond scope.'), 'overview'],
  ['HTML in overview', s => s.replace(presentation.overview, '<img src="cover.png">'), 'overview'],
  ['duplicate localized overview', s => `${s}\n## 合集介绍\n\nAnother scope.\n`, 'overview'],
  ['empty usage', s => s.replace(presentation.usage, ''), 'usage'],
  ['fenced usage metadata', s => s.replace(presentation.usage, '```yaml\nreview: approved\n```'), 'usage'],
  ['image in usage', s => s.replace(presentation.usage, 'Use this ![picture](cover.png).'), 'usage'],
  ['empty scenarios', s => s.replace('- New features\n- Bug fixes', ''), 'scenarios'],
  ['ordered scenarios', s => s.replace('- New features\n- Bug fixes', '1. New features\n2. Bug fixes'), 'scenarios'],
  ['too many scenarios', s => s.replace('- New features\n- Bug fixes', '- One\n- Two\n- Three\n- Four\n- Five\n- Six'), 'scenarios'],
  ['nested scenarios', s => s.replace('- New features', '- New features\n  - Hidden task'), 'scenarios[0]'],
  ['image as a scenario', s => s.replace('- New features', '- ![Task](task.png)'), 'scenarios[0]'],
]) {
  test(`rejects ${name} with an actionable field error`, async () => {
    const { parseContributionMarkdown } = await codec();
    assert.throws(() => parseContributionMarkdown(transform(draft), {filename:'README.zh.md'}), error => {
      assert.ok(error.message.includes(`README.zh.md: ${field}:`), error.message);
      return true;
    });
  });
}

test('serializes the website presentation sections in the chosen language', async () => {
  const { parseContributionMarkdown, serializeContributionMarkdown } = await codec();
  for (const language of ['en', 'zh']) {
    const data = { title: 'Useful Skills', description: 'Everyday development.', ...presentation, links: ['https://github.com/example/tools'] };
    assert.deepEqual(parseContributionMarkdown(serializeContributionMarkdown(data, {language})), data);
  }
});

test('a wrapped Markdown task remains one scenario when a contribution is reserialized', async () => {
  const { parseContributionMarkdown, serializeContributionMarkdown } = await codec();
  const parsed = parseContributionMarkdown(draft.replace('- New features', '- New\n  features'));
  assert.deepEqual(parsed.scenarios, ['New features', 'Bug fixes']);
  assert.deepEqual(parseContributionMarkdown(serializeContributionMarkdown(parsed)), parsed);
});

for (const url of ['cover.png', 'images/cover.webp', 'https://example.com/cover.jpg?size=large']) {
  for (const position of ['before', 'after']) {
    test(`parses and round-trips an optional standalone cover ${position} the introduction: ${url}`, async () => {
      const { parseContributionMarkdown, serializeContributionMarkdown } = await codec();
      const description = 'A collection for **daily development**.';
      const image = `![Collection cover](${url})`;
      const source = draft.replace(description, position === 'before' ? `${image}\n\n${description}` : `${description}\n\n${image}`);
      const parsed = parseContributionMarkdown(source);
      assert.equal(parsed.description, description);
      assert.deepEqual(parsed.cover, { url, alt: 'Collection cover' });
      assert.deepEqual(parseContributionMarkdown(serializeContributionMarkdown(parsed)), parsed);
    });
  }
}

for (const url of ['../cover.png', '/cover.png', 'file:///tmp/cover.png', 'http://example.com/cover.png', 'https://user:secret@example.com/cover.png', 'images/%252e%252e/cover.png', 'images/%2fcover.png', 'https://example.com/../cover.png', 'cover.png?key=secret', 'cover.svg']) {
  test(`rejects unsafe or unsupported cover path ${url}`, async () => {
    const { parseContributionMarkdown } = await codec();
    assert.throws(() => parseContributionMarkdown(draft.replace('## Overview', `![Cover](${url})\n\n## Overview`)), /cover:/);
  });
}

test('rejects multiple cover images while retaining a single optional cover', async () => {
  const { parseContributionMarkdown } = await codec();
  assert.throws(() => parseContributionMarkdown(draft.replace('## Overview', '![One](cover.png)\n\n![Two](other.png)\n\n## Overview')), /cover:/);
});

test('normalizes Unicode and safely encoded local cover paths for bilingual comparison', async () => {
  const { parseContributionMarkdown, serializeContributionMarkdown } = await codec();
  for (const [url, expected] of [['images/封面.png', 'images/%E5%B0%81%E9%9D%A2.png'], ['images/my%20cover.png', 'images/my%20cover.png']]) {
    const parsed = parseContributionMarkdown(draft.replace('## Overview', `![Cover](${url})\n\n## Overview`));
    assert.equal(parsed.cover.url, expected);
    assert.deepEqual(parseContributionMarkdown(serializeContributionMarkdown(parsed)), parsed);
  }
});

test('real bilingual collection READMEs remain valid inputs for the contribution parser', async () => {
  const { parseContributionMarkdown } = await codec();
  const collections=fileURLToPath(new URL('../collections/',import.meta.url));
  const directories=[...new Set((await readdir(collections,{recursive:true})).filter(file=>/^README(?:\.zh)?\.md$/.test(path.basename(file))).map(file=>path.dirname(file)))].sort();
  assert.ok(directories.length);
  for (const directory of directories) {
    const presentations={};
    for (const file of ['README.md', 'README.zh.md']) {
      let source;
      try {source=await readFile(path.join(collections,directory,file),'utf8');}
      catch(error) {if (error.code === 'ENOENT') continue; throw error;}
      const parsed = parseContributionMarkdown(source, {filename:`${directory}/${file}`});
      assert.ok(parsed.title.trim());
      assert.ok(parsed.description.trim());
      assert.ok(parsed.overview.trim());
      assert.ok(parsed.usage.trim());
      assert.ok(parsed.scenarios.length >= 1 && parsed.scenarios.length <= 5);
      assert.ok(parsed.links.length >= 1);
      presentations[file]=parsed;
    }
    if (presentations['README.md'] && presentations['README.zh.md']) {
      const english=presentations['README.md'],chinese=presentations['README.zh.md'];
      assert.deepEqual([...english.links].sort(),[...chinese.links].sort());
      assert.equal(english.sourceUrl,chinese.sourceUrl);
      assert.equal(english.cover?.url,chinese.cover?.url);
    }
  }
});
test('real README checks permit a legal two-scenario edit in a temporary checkout', async t => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'contribution-evolution-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await cp(new URL('../collections/',import.meta.url),path.join(directory,'collections'),{recursive:true});
  await cp(new URL('../scripts/lib/',import.meta.url),path.join(directory,'scripts/lib'),{recursive:true});
  await cp(new URL('./contribution.test.mjs',import.meta.url),path.join(directory,'tests/contribution.test.mjs'),{recursive:true});
  await symlink(fileURLToPath(new URL('../node_modules/',import.meta.url)),path.join(directory,'node_modules'));
  const {parseContributionMarkdown,serializeContributionMarkdown}=await codec();
  for (const name of ['README.md','README.zh.md']) {
    const file=path.join(directory,'collections/media/product-video',name);
    const document=parseContributionMarkdown(await readFile(file,'utf8'));
    document.scenarios=name === 'README.md' ? ['Product demos','Feature introductions'] : ['产品演示','功能介绍'];
    await writeFile(file,serializeContributionMarkdown(document,{language:name === 'README.md' ? 'en' : 'zh'}));
  }
  const env={...process.env}; delete env.NODE_TEST_CONTEXT;
  const {stdout}=await promisify(execFile)(process.execPath,['--test','--test-name-pattern','^real bilingual collection READMEs remain valid inputs for the contribution parser$','tests/contribution.test.mjs'],{cwd:directory,env});
  assert.match(stdout,/# fail 0/);
});

test('parses a short contribution without inventing maintenance or per-Skill fields', async () => {
  const { parseContributionMarkdown } = await codec();
  assert.deepEqual(parseContributionMarkdown(draft), {
    title: 'Useful Skills',
    description: 'A collection for **daily development**.',
    ...presentation,
    links: [
      'https://github.com/example/tools',
      'https://github.com/example/skills/blob/main/skills/useful/SKILL.md',
    ],
  });
});

test('supports Chinese headings and introductions with inline heading-looking text', async () => {
  const { parseContributionMarkdown } = await codec();
  const source = draft.replace('# Useful Skills', '# 日常开发技能')
    .replace('A collection for **daily development**.', '日常开发用的一组技能，`## Source` 只是示例。')
    .replace('## Overview', '## 合集介绍')
    .replace('## Scenarios', '## 适用场景')
    .replace('## Usage', '## 使用建议')
    .replace('## Skills', '## 技能');
  assert.deepEqual(parseContributionMarkdown(`\uFEFF${source.replaceAll('\n', '\r\n')}`, { filename: 'README.zh.md' }), {
    title: '日常开发技能',
    description: '日常开发用的一组技能，`## Source` 只是示例。',
    ...presentation,
    links: ['https://github.com/example/tools', 'https://github.com/example/skills/blob/main/skills/useful/SKILL.md'],
  });
});

for (const [name, link, expected] of [
  ['repository', 'https://GitHub.com/Example/Tools.git/?tab=readme-ov-file#skills', 'https://github.com/example/tools'],
  ['directory', 'https://github.com/Example/Tools/tree/Main/skills/nested/', 'https://github.com/example/tools/tree/Main/skills/nested'],
  ['repository branch', 'https://github.com/example/tools/tree/main', 'https://github.com/example/tools/tree/main'],
  ['root Skill file', 'https://github.com/example/tools/blob/main/SKILL.md?plain=1#L1', 'https://github.com/example/tools/blob/main/SKILL.md'],
  ['nested Skill file', 'https://github.com/example/tools/blob/v1.0.0/plugins/useful/SKILL.md', 'https://github.com/example/tools/blob/v1.0.0/plugins/useful/SKILL.md'],
  ['escaped path', 'https://github.com/example/tools/tree/main/%73kills/%E4%B8%AD%E6%96%87', 'https://github.com/example/tools/tree/main/skills/%E4%B8%AD%E6%96%87'],
  ['branch containing an escaped slash', 'https://github.com/example/tools/tree/feature%2Fskills/useful', 'https://github.com/example/tools/tree/feature%2Fskills/useful'],
]) {
  test(`accepts and canonicalizes a GitHub ${name} URL without checking the remote`, async () => {
    const { parseContributionMarkdown } = await codec();
    const source = draft.slice(0, draft.indexOf('- https')) + `- ${link}\n`;
    assert.deepEqual(parseContributionMarkdown(source).links, [expected]);
  });
}

for (const [heading, body] of [
  ['Source', 'https://example.com/article?topic=skills#recommendations'],
  ['来源', '[原始文章](https://example.com/article?topic=skills#recommendations)'],
]) {
  test(`retains optional ${heading} attribution with its query and fragment`, async () => {
    const { parseContributionMarkdown } = await codec();
    assert.equal(parseContributionMarkdown(`${draft}\n## ${heading}\n\n${body}\n`).sourceUrl, 'https://example.com/article?topic=skills#recommendations');
  });
}

test('accepts an HTTP attribution URL independently of HTTPS-only Skill links', async () => {
  const { parseContributionMarkdown } = await codec();
  assert.equal(parseContributionMarkdown(`${draft}\n## Source\n\n<http://example.com/collection>\n`).sourceUrl, 'http://example.com/collection');
});

for (const [name, transform, field] of [
  ['YAML frontmatter', source => `---\ntitle: Hidden fields\n---\n${source}`, 'title'],
  ['missing title', source => source.replace('# Useful Skills', 'Useful Skills'), 'title'],
  ['empty title', source => source.replace('# Useful Skills', '#'), 'title'],
  ['second title', source => `${source}\n# Another title\n`, 'title'],
  ['missing introduction', source => source.replace('A collection for **daily development**.\n\n', ''), 'description'],
  ['multiple introduction paragraphs', source => source.replace('A collection for **daily development**.', 'First paragraph.\n\nSecond paragraph.'), 'description'],
  ['inline cover', source => source.replace('A collection for **daily development**.', 'A description with ![Cover](cover.webp).'), 'description'],
  ['linked inline cover', source => source.replace('A collection for **daily development**.', 'A description with [![Cover](cover.webp)](https://example.com/source).'), 'description'],
  ['formatted inline cover', source => source.replace('A collection for **daily development**.', 'A description with **![Cover](cover.webp)**.'), 'description'],
  ['inline HTML cover', source => source.replace('A collection for **daily development**.', 'A description with <img src="cover.webp" alt="Cover">.'), 'description'],
  ['fenced fake introduction', source => source.replace('A collection for **daily development**.', '```text\n## Skills\n```'), 'description'],
  ['missing Skills section', source => source.replace('## Skills', '## Source'), 'skills'],
  ['unknown section', source => `${source}\n## Notes\n\nA description.\n`, 'sections'],
  ['duplicate Skills with another language', source => `${source}\n## 技能\n\n- https://github.com/example/more\n`, 'skills'],
  ['empty Skills list', source => source.slice(0, source.indexOf('- https')), 'skills'],
  ['Skill prose instead of a list', source => source.slice(0, source.indexOf('- https')) + 'https://github.com/example/tools\n', 'skills'],
  ['ordered Skill list', source => source.replace('- https', '1. https').replace('- [One', '2. [One'), 'skills'],
  ['per-Skill heading', source => source.replace('- https', '### Tool\n\n- https'), 'skills'],
  ['Skill metadata fence', source => `${source}\n\`\`\`yaml\ninstallationMode: skill\n\`\`\`\n`, 'skills'],
  ['nested Skill list', source => source.replace('- https://github.com/example/tools', '- https://github.com/example/tools\n  - https://github.com/example/nested'), 'links[0]'],
  ['Skill text without a URL', source => source.replace('- https://github.com/example/tools', '- No link supplied'), 'links[0]'],
  ['two Skill URLs in one bullet', source => source.replace('- https://github.com/example/tools', '- [One](https://github.com/example/tools) [Two](https://github.com/example/other)'), 'links[0]'],
  ['extra Skill prose', source => source.replace('- https://github.com/example/tools', '- https://github.com/example/tools — a description'), 'links[0]'],
  ['duplicate Source', source => `${source}\n## Source\n\nhttps://example.com/one\n\n## 来源\n\nhttps://example.com/two\n`, 'sourceUrl'],
  ['empty Source', source => `${source}\n## Source\n`, 'sourceUrl'],
  ['multiple Source URLs', source => `${source}\n## Source\n\n[One](https://example.com/one) [Two](https://example.com/two)\n`, 'sourceUrl'],
]) {
  test(`reports the filename and field for ${name}`, async () => {
    const { parseContributionMarkdown } = await codec();
    assert.throws(() => parseContributionMarkdown(transform(draft), { filename: 'collections/development/example/README.md' }), error => {
      assert.ok(error.message.includes('collections/development/example/README.md'));
      assert.ok(error.message.includes(`${field}:`), error.message);
      return true;
    });
  });
}

for (const link of [
  'http://github.com/example/tools',
  'javascript:alert(1)',
  'file:///tmp/SKILL.md',
  '../skills/useful/SKILL.md',
  'https://example.com/example/tools',
  'https://github.com.evil.example/example/tools',
  'https://user:secret@github.com/example/tools',
  'https://github.com:444/example/tools',
  'https://github.com/example',
  'https://github.com/example/tools/issues/1',
  'https://github.com/example/tools/blob/main/README.md',
  'https://github.com/example/tools/blob/main/skill.md',
  'https://github.com/example/tools/blob/main',
  'https://github.com/example/tools/tree',
  'https://github.com/example/tools/tree/main/../secrets',
  'https://github.com/example/tools/tree/main/%2e%2e/secrets',
  'https://github.com/example/tools/tree/main/%252e%252e/secrets',
  'https://github.com/example/tools/tree/main/%25252e%25252e/secrets',
  'https://github.com/example/tools/tree/main/skills%2F..%2Fsecrets',
  'https://github.com/example/tools/tree/main/%2Fetc/passwd',
  'https://github.com/example/tools/tree/main/skills%5Csecret',
  'https://github.com/example/tools/tree/main/skills%00secret',
  'https://github.com/example/tools/tree/main/skills%0Asecret',
  'https://github.com/example/tools/tree/main/%invalid',
  'https://github.com/example/tools//tree/main/skills',
  'https://github.com/example/...git',
]) {
  test(`rejects unsupported or unsafe Skill URL ${JSON.stringify(link)}`, async () => {
    const { parseContributionMarkdown } = await codec();
    assert.throws(() => parseContributionMarkdown(draft.replace('https://github.com/example/tools', link), { filename: 'README.md' }), /README\.md: links\[0\]:/);
  });
}

test('rejects raw URL control characters before the URL parser can silently remove them', async () => {
  const { parseContributionMarkdown } = await codec();
  assert.throws(() => parseContributionMarkdown(draft.replace('https://github.com/example/tools', 'https://github.com/example/to\u0000ols')), /links\[0\]/);
  assert.throws(() => parseContributionMarkdown(draft.replace('https://github.com/example/tools', '[Tool](https://github.com/example/to\tols)')), /links\[0\]/);
});

for (const [first, second] of [
  ['https://github.com/example/tools', 'https://github.com/Example/Tools.git/#readme'],
  ['https://github.com/example/tools/tree/main/skills', 'https://github.com/example/tools/tree/main/%73kills?tab=readme'],
]) {
  test('rejects duplicate canonical Skill URLs instead of silently dropping entries', async () => {
    const { parseContributionMarkdown } = await codec();
    const source = draft.slice(0, draft.indexOf('- https')) + `- ${first}\n- ${second}\n`;
    assert.throws(() => parseContributionMarkdown(source), /links\[1\].*duplicate/i);
  });
}

for (const sourceUrl of ['javascript:alert(1)', 'file:///tmp/article', '/relative/article', 'https:example.com/article', 'https:///example.com/article', 'https://@example.com/article', 'https://user:secret@example.com/article', 'https://example.com/article%00secret']) {
  test(`rejects unsafe source attribution ${JSON.stringify(sourceUrl)}`, async () => {
    const { parseContributionMarkdown } = await codec();
    assert.throws(() => parseContributionMarkdown(`${draft}\n## Source\n\n${sourceUrl}\n`), /sourceUrl/);
  });
}

for (const language of ['en', 'zh']) {
  test(`serializes ${language} as a short Markdown document and round-trips its public data`, async () => {
    const { parseContributionMarkdown, serializeContributionMarkdown } = await codec();
    const data = {
      title: 'Daily [Skills] # *',
      description: 'Use **useful tools** and [documentation](https://example.com/docs).',
      ...presentation,
      links: ['https://github.com/example/tools', 'https://github.com/example/tools/tree/Main/skills'],
      sourceUrl: 'https://example.com/article?topic=skills#recommendations',
    };
    const markdown = serializeContributionMarkdown(data, { language });
    assert.deepEqual(parseContributionMarkdown(markdown), data);
    assert.doesNotMatch(markdown, /^---|```yaml|installationMode|sourceKeys|verification/m);
    assert.match(markdown, language === 'zh' ? /## 技能/ : /## Skills/);
    assert.match(markdown, language === 'zh' ? /## 来源/ : /## Source/);
  });
}

test('serializer defaults to English and canonicalizes submitted Skill links', async () => {
  const { parseContributionMarkdown, serializeContributionMarkdown } = await codec();
  const markdown = serializeContributionMarkdown({ title: 'Example', description: 'One collection.', ...presentation, links: ['https://GitHub.com/Example/Tools/?tab=readme#skills'] });
  assert.match(markdown, /## Skills/);
  assert.deepEqual(parseContributionMarkdown(markdown).links, ['https://github.com/example/tools']);
});

test('serialization preserves literal HTML entity text from a Markdown title', async () => {
  const { parseContributionMarkdown, serializeContributionMarkdown } = await codec();
  const data = parseContributionMarkdown(draft.replace('# Useful Skills', '# `&copy; &#35;` Skills'));
  assert.equal(data.title, '&copy; &#35; Skills');
  assert.deepEqual(parseContributionMarkdown(serializeContributionMarkdown(data)), data);
});

for (const [data, field] of [
  [{ title: 'Example', description: 'One collection.', links: [] }, 'links'],
  [{ title: 'Example', description: 'One collection.', links: 'https://github.com/example/tools' }, 'links'],
  [{ title: 'Example', description: 'One collection.', links: [42] }, 'links[0]'],
  [{ title: '', description: 'One collection.', links: ['https://github.com/example/tools'] }, 'title'],
  [{ title: 'Example\nInjected heading', description: 'One collection.', links: ['https://github.com/example/tools'] }, 'title'],
  [{ title: 'Example', description: 'One paragraph.\n\nA second paragraph.', links: ['https://github.com/example/tools'] }, 'description'],
  [{ title: 'Example', description: 'One collection.', links: ['https://github.com/example/tools'], verification: 'passed' }, 'verification'],
]) {
  test(`serializer reports invalid ${field} instead of emitting an ambiguous or machine-filled file`, async () => {
    const { serializeContributionMarkdown } = await codec();
    assert.throws(() => serializeContributionMarkdown({ ...presentation, ...data }), error => {
      assert.ok(error.message.includes(field), error.message);
      return true;
    });
  });
}

test('rejects unsupported serializer languages and non-text parser input', async () => {
  const { parseContributionMarkdown, serializeContributionMarkdown } = await codec();
  assert.throws(() => parseContributionMarkdown(null, { filename: 'README.zh.md' }), /README\.zh\.md: Markdown:/);
  assert.throws(() => serializeContributionMarkdown({ title: 'Example', description: 'One collection.', links: ['https://github.com/example/tools'] }, { language: 'ko' }), /language/);
});
