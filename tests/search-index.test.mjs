import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { indexItem } from '../scripts/lib/site-contract.mjs';

test('index searches bilingual collection metadata without embedding skill content', async () => {
  const document = JSON.parse(await readFile(new URL('./fixtures/site/de64301b-09cf-4968-9fc2-24ede5cd4dd6.json', import.meta.url), 'utf8'));
  document.title = '测试合集';
  document.description = '合集用途';
  document.tags = ['专属标签'];
  document.localizations = { en: { title: 'Collection title', description: 'Collection purpose', tags: ['Collection tag'], skills: {} } };
  for (const skill of document.skills) {
    skill.name = 'UniqueSkillName';
    skill.summary = 'UniqueSkillSummary'.repeat(10000);
    skill.role = 'UniqueSkillRole';
    document.localizations.en.skills[skill.id] = { summary: 'UniqueEnglishSkillSummary', role: 'UniqueEnglishSkillRole' };
  }
  const item = indexItem(document);
  for (const value of ['测试合集', '合集用途', '专属标签', 'Collection title', 'Collection purpose', 'Collection tag', item.authorLabel, document.category]) assert.ok(item.searchText.includes(value));
  assert.doesNotMatch(JSON.stringify(item), /UniqueSkill|UniqueEnglishSkill/);
  assert.ok(Buffer.byteLength(JSON.stringify(item)) < 4096);
  assert.equal(item.itemCount, document.skills.length);
  assert.equal(document.skills[0].summary.length, 'UniqueSkillSummary'.length * 10000);
});
