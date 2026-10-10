import { isAlias, isMap, parseDocument, visit } from 'yaml';

const options = { uniqueKeys: true, merge: false, strict: true };
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const nameControl = /[\u0000-\u001f\u007f-\u009f]/;
const fail = message => { throw new Error(`upstream: ${message}`); };

function normalizeTextFields(frontmatter, parsed) {
  if (parsed.warnings.length || parsed.errors.some(error => error.code !== 'BLOCK_AS_IMPLICIT_KEY')) return;
  const lines = frontmatter.split('\n');
  const candidates = [];
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    const match = /^(description|compatibility):[ \t]+(.+)$/.exec(line);
    const text = match?.[2].trimEnd();
    if (text && /^[\p{L}\p{N}]/u.test(text) && /:[ \t]/.test(text) && !/[ \t]#/.test(text) && !/:[ \t]+(?:[&*!{\[|>]|[?-](?:[ \t]|$))/.test(text)) {
      const next = lines.slice(index + 1).find(value => value.trim() && !/^[ \t]*#/.test(value));
      if (!next || !/^[ \t]/.test(next)) candidates.push({ index, start: offset, end: offset + line.length, field: match[1], text });
    }
    offset += line.length + 1;
  }
  if (!candidates.length || new Set(candidates.map(item => item.field)).size !== candidates.length) return;
  if (parsed.errors.some(error => !candidates.some(item => error.pos[0] >= item.start && error.pos[0] < item.end))) return;
  for (const item of candidates) lines[item.index] = `${item.field}: ${JSON.stringify(item.text)}`;
  return { frontmatter: lines.join('\n'), normalizedFields: candidates.map(item => item.field) };
}

export function readSkillMetadata(source, entryPoint) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
  if (!match) fail(`${entryPoint} must start with YAML frontmatter`);
  if (control.test(match[1])) fail(`${entryPoint} frontmatter cannot contain control characters`);
  let parsed = parseDocument(match[1], options);
  let normalizedFields = [];
  if (parsed.errors.length) {
    const fallback = normalizeTextFields(match[1], parsed);
    if (fallback) {
      parsed = parseDocument(fallback.frontmatter, options);
      normalizedFields = fallback.normalizedFields;
    }
  }
  if (parsed.errors.length || parsed.warnings.length) fail(`${entryPoint} has invalid YAML frontmatter`);
  if (!isMap(parsed.contents)) fail(`${entryPoint} frontmatter must be an object`);
  visit(parsed, { Node(_key, node) {
    if (isAlias(node) || node.anchor) fail(`${entryPoint} frontmatter cannot contain YAML aliases or anchors`);
    if (typeof node.value === 'string' && control.test(node.value)) fail(`${entryPoint} frontmatter cannot contain control characters`);
    if (isMap(node)) for (const pair of node.items) if (typeof pair.key?.value !== 'string' || pair.key.value === '<<') fail(`${entryPoint} frontmatter must use simple string mapping keys`);
  } });
  const value = parsed.toJS({ maxAliasCount: 0 });
  if (typeof value.name !== 'string' || !value.name.trim() || nameControl.test(value.name)) fail(`${entryPoint} frontmatter name must be non-empty text without control characters`);
  if (typeof value.description !== 'string' || !value.description.trim()) fail(`${entryPoint} frontmatter description must be non-empty text`);
  return { name: value.name, description: value.description, ...(typeof value.compatibility === 'string' ? { compatibility: value.compatibility } : {}), normalizedFields };
}
