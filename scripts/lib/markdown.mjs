import { fromMarkdown } from 'mdast-util-from-markdown';
import { isAlias, isMap, parseDocument, stringify, visit } from 'yaml';

const metadataKeys = ['schemaVersion', 'id', 'slug', 'revision', 'createdAt', 'updatedAt', 'status', 'sourceKind', 'category', 'tags', 'sourceKeys', 'provenance', 'cover', 'verification', 'review', 'localizations', 'sortOrder', 'curator'];
const displayKeys = ['title', 'description', 'overview', 'scenarios', 'usage'];
const skillKeys = ['id', 'entry', 'installationMode', 'installationItems', 'resourceCheck', 'resourceNotes', 'role', 'authors', 'originalDescription'];
const sectionNames = new Map([
  ['概览', 'overview'], ['Overview', 'overview'],
  ['适用场景', 'scenarios'], ['Scenarios', 'scenarios'],
  ['使用建议', 'usage'], ['Usage', 'usage'], ['Skills', 'skills'],
]);

function invalid(filename, field, message) {
  throw new Error(`${filename}: ${field}: ${message}`);
}

function object(value, filename, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(filename, field, 'must be an object');
}

function fields(value, allowed, filename, field, bodyFields = []) {
  object(value, filename, field);
  for (const key of Object.keys(value)) {
    if (bodyFields.includes(key)) invalid(filename, `${field}.${key}`, 'belongs in the Markdown body, not YAML');
    if (!allowed.includes(key)) invalid(filename, `${field}.${key}`, 'unknown field');
  }
}

function optionalFields(value, allowed, filename, field) {
  if (value !== undefined) fields(value, allowed, filename, field);
}

function arrayFields(value, allowed, filename, field) {
  if (value === undefined) return;
  if (!Array.isArray(value)) invalid(filename, field, 'must be an array');
  value.forEach((item, index) => fields(item, allowed, filename, `${field}[${index}]`));
}

function presentationFields(value, filename, field) {
  fields(value, [...displayKeys, 'tags', 'coverAlt', 'provenance', 'skills'], filename, field);
  optionalFields(value.provenance, ['selectionReason', 'evidence'], filename, `${field}.provenance`);
  if (value.provenance?.evidence !== undefined) {
    object(value.provenance.evidence, filename, `${field}.provenance.evidence`);
    for (const [id, evidence] of Object.entries(value.provenance.evidence)) fields(evidence, ['title', 'location', 'finding'], filename, `${field}.provenance.evidence.${id}`);
  }
  if (value.skills !== undefined) {
    object(value.skills, filename, `${field}.skills`);
    for (const [id, skill] of Object.entries(value.skills)) fields(skill, ['summary', 'role'], filename, `${field}.skills.${id}`);
  }
}

function checkMetadata(metadata, filename) {
  fields(metadata, [...metadataKeys, 'language', 'curator'], filename, 'frontmatter', [...displayKeys, 'name', 'skills']);
  if (!['zh', 'en'].includes(metadata.language)) invalid(filename, 'language', 'must be zh or en');
  if (metadata.curator !== undefined && typeof metadata.curator !== 'string') fields(metadata.curator, ['name', 'url'], filename, 'curator');
  optionalFields(metadata.cover, ['kind', 'preset', 'url', 'file', 'sourceUrl', 'alt', 'rightsStatus', 'rightsEvidenceUrl', 'width', 'height', 'background', 'position'], filename, 'cover');
  optionalFields(metadata.review, ['status', 'reviewer', 'reviewedAt', 'notes'], filename, 'review');
  optionalFields(metadata.verification, ['source', 'files', 'installation', 'workflow', 'checkedAt', 'notes', 'installationEvidence', 'workflowEvidence'], filename, 'verification');
  for (const key of ['installationEvidence', 'workflowEvidence']) {
    const evidence = metadata.verification?.[key];
    optionalFields(evidence, ['testedAt', 'versions', 'itemIds', 'resultRef', 'environment'], filename, `verification.${key}`);
    arrayFields(evidence?.versions, ['repo', 'commit'], filename, `verification.${key}.versions`);
  }
  optionalFields(metadata.provenance, ['author', 'recommender', 'repositoryScope', 'evidence', 'selectionReason'], filename, 'provenance');
  for (const key of ['author', 'recommender']) optionalFields(metadata.provenance?.[key], ['name', 'url'], filename, `provenance.${key}`);
  optionalFields(metadata.provenance?.repositoryScope, ['repo', 'commit', 'directories', 'coverage'], filename, 'provenance.repositoryScope');
  arrayFields(metadata.provenance?.evidence, ['id', 'kind', 'url', 'title', 'publisher', 'publishedAt', 'checkedAt', 'location', 'finding', 'supportsItemIds'], filename, 'provenance.evidence');
  if (metadata.localizations !== undefined) {
    fields(metadata.localizations, ['en', 'zh'], filename, 'localizations');
    for (const [language, presentation] of Object.entries(metadata.localizations)) presentationFields(presentation, filename, `localizations.${language}`);
  }
}

function checkSkill(skill, filename, field) {
  fields(skill, skillKeys, filename, field, ['name', 'summary']);
  optionalFields(skill.entry, ['repo', 'commit', 'entryPoint'], filename, `${field}.entry`);
  arrayFields(skill.authors, ['name', 'evidenceUrl'], filename, `${field}.authors`);
  arrayFields(skill.installationItems, ['name', 'repo', 'commit', 'directory', 'entryPoint', 'license'], filename, `${field}.installationItems`);
  skill.installationItems?.forEach((item, index) => optionalFields(item.license, ['identifier', 'evidenceUrl'], filename, `${field}.installationItems[${index}].license`));
}

function yamlObject(source, filename, field) {
  const parsed = parseDocument(source, { uniqueKeys: true, merge: false, strict: true });
  if (parsed.errors.length || parsed.warnings.length) invalid(filename, field, [...parsed.errors, ...parsed.warnings].map(error => error.message).join('; '));
  visit(parsed, {
    Node(_key, node) {
      if (isAlias(node) || node.anchor) invalid(filename, field, 'YAML aliases and anchors are not allowed');
      if (isMap(node)) {
        for (const pair of node.items) {
          if (pair.key?.value === '<<') invalid(filename, field, 'YAML merge key << is not allowed');
          if (typeof pair.key?.value !== 'string') invalid(filename, field, 'YAML mapping keys must be strings');
        }
      }
    },
  });
  const value = parsed.toJS({ maxAliasCount: 0 });
  object(value, filename, field);
  return value;
}

function readSource(source, filename) {
  if (typeof source !== 'string') invalid(filename, 'Markdown', 'must be a string');
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const frontmatter = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!frontmatter) invalid(filename, 'frontmatter', 'must start with a YAML --- block');
  const metadata = yamlObject(frontmatter[1], filename, 'frontmatter');
  const body = normalized.slice(frontmatter[0].length);
  return { metadata, body, nodes: fromMarkdown(body).children };
}

function visibleText(node) {
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || '';
  if (node.value !== undefined) return node.value;
  return (node.children || []).map(visibleText).join('');
}

function rawNodes(nodes, body) {
  if (!nodes.length) return '';
  return body.slice(nodes[0].position.start.offset, nodes.at(-1).position.end.offset).trim();
}

function imageOnly(node) {
  return node.type === 'paragraph' && node.children.some(child => ['image', 'imageReference'].includes(child.type)) && node.children.every(child => ['image', 'imageReference'].includes(child.type) || (child.type === 'text' && !child.value.trim()));
}

function parseBody(nodes, body, filename, translation = false) {
  const headings = nodes.filter(node => node.type === 'heading' && node.depth === 1);
  if (headings.length !== 1 || nodes[0] !== headings[0]) invalid(filename, 'title', 'requires exactly one H1 at the start of the body');
  const title = visibleText(headings[0]).trim();
  if (!title) invalid(filename, 'title', 'must not be empty');
  const firstSection = nodes.findIndex(node => node.type === 'heading' && node.depth === 2);
  if (firstSection < 0) invalid(filename, 'overview', 'missing required section');
  const sections = new Map();
  let current;
  for (const node of nodes.slice(firstSection)) {
    if (node.type === 'heading' && node.depth === 2) {
      current = sectionNames.get(visibleText(node).trim());
      if (!current) invalid(filename, 'sections', `unknown H2 section ${visibleText(node)}`);
      if (sections.has(current)) invalid(filename, current, 'duplicate section');
      sections.set(current, []);
    } else {
      if (node.type === 'heading' && (node.depth === 1 || (node.depth === 3 && current !== 'skills'))) invalid(filename, current, 'unexpected heading depth');
      sections.get(current).push(node);
    }
  }
  for (const section of ['overview', 'scenarios', 'usage', 'skills']) if (!sections.has(section)) invalid(filename, section, 'missing required section');
  const intro = nodes.slice(1, firstSection).filter(node => !imageOnly(node) && node.type !== 'definition');
  if (intro.length !== 1 || intro[0].type !== 'paragraph') invalid(filename, 'description', 'requires exactly one introduction paragraph; images may be placed before or after it');
  if (intro[0].children.some(node => ['image', 'imageReference'].includes(node.type))) invalid(filename, 'description', 'place images before or after the introduction paragraph');
  const result = { title, description: rawNodes(intro, body) };
  for (const section of ['overview', 'usage']) {
    result[section] = rawNodes(sections.get(section), body);
    if (!result[section]) invalid(filename, section, 'must contain prose');
  }
  const scenarios = sections.get('scenarios');
  if (scenarios.length !== 1 || scenarios[0].type !== 'list' || !scenarios[0].children.length) invalid(filename, 'scenarios', 'requires a non-empty Markdown list');
  result.scenarios = scenarios[0].children.map((item, index) => {
    const content = rawNodes(item.children, body);
    if (!content) invalid(filename, `scenarios[${index}]`, 'must not be empty');
    return content;
  });
  const groups = [];
  for (const node of sections.get('skills')) {
    if (node.type === 'heading' && node.depth === 3) groups.push({ heading: node, nodes: [] });
    else {
      if (!groups.length) invalid(filename, 'skills', 'requires H3 Skill headings before content');
      groups.at(-1).nodes.push(node);
    }
  }
  if (!groups.length) invalid(filename, 'skills', 'requires at least one Skill');
  const ids = new Set();
  result.skills = groups.map((group, index) => {
    const field = `skills[${index}]`;
    const name = visibleText(group.heading).trim();
    if (!name) invalid(filename, `${field}.name`, 'must not be empty');
    const fences = group.nodes.filter(node => node.type === 'code' && ['yaml', 'yml'].includes(node.lang?.toLowerCase()));
    if (fences.length !== 1) invalid(filename, field, 'requires exactly one yaml metadata fence');
    const metadata = yamlObject(fences[0].value, filename, field);
    if (translation) fields(metadata, ['id', 'role'], filename, field, ['summary', 'name']);
    else checkSkill(metadata, filename, field);
    if (typeof metadata.id !== 'string' || !metadata.id.trim()) invalid(filename, `${field}.id`, 'must be a stable non-empty Skill ID');
    if (ids.has(metadata.id)) invalid(filename, `${field}.id`, 'duplicate Skill ID');
    ids.add(metadata.id);
    const fenceIndex = group.nodes.indexOf(fences[0]);
    const summary = [rawNodes(group.nodes.slice(0, fenceIndex), body), rawNodes(group.nodes.slice(fenceIndex + 1), body)].filter(Boolean).join('\n\n');
    if (!summary) invalid(filename, `${field}.summary`, 'must contain prose');
    return { ...metadata, name, summary };
  });
  return result;
}

export function parseCollectionMarkdown(source, { filename = 'README.md' } = {}) {
  const { metadata, body, nodes } = readSource(source, filename);
  checkMetadata(metadata, filename);
  const { language, curator, ...document } = metadata;
  if (curator !== undefined) document.curator = typeof curator === 'string' ? { name: curator } : curator;
  const coverFile = document.cover?.file;
  if (coverFile !== undefined && (typeof coverFile !== 'string' || !coverFile.trim())) invalid(filename, 'cover.file', 'must be a non-empty relative path');
  if (document.cover) {
    const { file: _file, ...cover } = document.cover;
    if (Object.keys(cover).length) document.cover = cover;
    else delete document.cover;
  }
  Object.assign(document, parseBody(nodes, body, filename));
  return { document, language, coverFile, curator };
}

function headingText(value) {
  return value.replace(/([\\`*_[\]<>#])/g, '\\$1');
}

function fence(metadata) {
  const yaml = stringify(metadata, { lineWidth: 0, aliasDuplicateObjects: false });
  const runs = yaml.match(/`+/g) || [];
  const delimiter = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${delimiter}yaml\n${yaml}${delimiter}`;
}

function renderBody(display, skills, language) {
  const labels = language === 'zh' ? ['概览', '适用场景', '使用建议'] : ['Overview', 'Scenarios', 'Usage'];
  const scenarios = display.scenarios.map(item => `- ${item.replace(/\n/g, '\n  ')}`).join('\n');
  return [
    `# ${headingText(display.title)}`, display.description,
    `## ${labels[0]}`, display.overview, `## ${labels[1]}`, scenarios,
    `## ${labels[2]}`, display.usage, '## Skills',
    ...skills.flatMap(({ name, summary, ...metadata }) => [`### ${headingText(name)}`, summary, fence(metadata)]),
  ].join('\n\n') + '\n';
}

export function serializeCollectionMarkdown(document, { language = 'zh', coverFile, curator } = {}) {
  const filename = 'serializeCollectionMarkdown';
  fields(document, [...metadataKeys, ...displayKeys, 'skills'], filename, 'document');
  const metadata = Object.fromEntries(Object.entries(document).filter(([key]) => metadataKeys.includes(key)));
  metadata.language = language;
  if (curator !== undefined) metadata.curator = curator;
  if (coverFile !== undefined) metadata.cover = { ...metadata.cover, file: coverFile };
  checkMetadata(metadata, filename);
  document.skills.forEach((skill, index) => {
    const { name: _name, summary: _summary, ...machine } = skill;
    checkSkill(machine, filename, `skills[${index}]`);
  });
  const source = `---\n${stringify(metadata, { lineWidth: 0, aliasDuplicateObjects: false })}---\n\n${renderBody(document, document.skills, language)}`;
  parseCollectionMarkdown(source, { filename });
  return source;
}

export function parseTranslationMarkdown(source, { filename = 'README.translation.md' } = {}) {
  const { metadata, body, nodes } = readSource(source, filename);
  fields(metadata, ['id', 'language', 'tags', 'coverAlt', 'provenance'], filename, 'frontmatter', [...displayKeys, 'skills']);
  if (!['zh', 'en'].includes(metadata.language)) invalid(filename, 'language', 'must be zh or en');
  if (typeof metadata.id !== 'string' || !metadata.id.trim()) invalid(filename, 'id', 'must identify the canonical collection');
  const { id, language, ...presentation } = metadata;
  const display = parseBody(nodes, body, filename, true);
  display.skills = Object.fromEntries(display.skills.map(({ id: skillId, summary, role }) => [skillId, { summary, ...(role !== undefined ? { role } : {}) }]));
  Object.assign(presentation, display);
  presentationFields(presentation, filename, 'presentation');
  return { id, language, presentation };
}

export function serializeTranslationMarkdown(presentation, { id, language = 'en' } = {}) {
  presentationFields(presentation, 'serializeTranslationMarkdown', 'presentation');
  const metadata = { id, language };
  for (const key of ['tags', 'coverAlt', 'provenance']) if (presentation[key] !== undefined) metadata[key] = presentation[key];
  const skills = Object.entries(presentation.skills || {}).map(([skillId, skill]) => ({ id: skillId, name: skillId, ...skill }));
  const source = `---\n${stringify(metadata, { lineWidth: 0, aliasDuplicateObjects: false })}---\n\n${renderBody(presentation, skills, language)}`;
  parseTranslationMarkdown(source);
  return source;
}
