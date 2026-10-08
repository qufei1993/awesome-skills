import { fromMarkdown } from 'mdast-util-from-markdown';

const headings = {
  en: { overview: 'Overview', scenarios: 'Scenarios', usage: 'Usage', skills: 'Skills', sourceUrl: 'Source' },
  zh: { overview: '合集介绍', scenarios: '适用场景', usage: '使用建议', skills: '技能', sourceUrl: '来源' },
};
const sectionNames = new Map(Object.values(headings).flatMap(language => Object.entries(language).map(([field, heading]) => [heading, field])));

function invalid(filename, field, message) {
  throw new Error(`${filename}: ${field}: ${message}`);
}

function visibleText(node) {
  if (node.value !== undefined) return node.value;
  return (node.children || []).map(visibleText).join('');
}

function hasImageOrHtml(node) {
  return ['image', 'imageReference', 'html'].includes(node.type) || (node.children || []).some(hasImageOrHtml);
}

function rawNode(node, source) {
  return source.slice(node.position.start.offset, node.position.end.offset).trim();
}

function proseSection(sections, field, source, filename) {
  if (!sections.has(field)) invalid(filename, field, `missing required ${headings.en[field]} section`);
  const nodes = sections.get(field);
  if (nodes.length !== 1 || nodes[0].type !== 'paragraph' || !visibleText(nodes[0]).trim() || hasImageOrHtml(nodes[0])) {
    invalid(filename, field, 'requires exactly one non-empty paragraph without images or raw HTML');
  }
  return rawNode(nodes[0], source);
}

function scenarioSection(sections, source, filename) {
  const nodes = sections.get('scenarios');
  if (!nodes) invalid(filename, 'scenarios', 'missing required Scenarios section');
  if (nodes.length !== 1 || nodes[0].type !== 'list' || nodes[0].ordered || nodes[0].children.length < 1 || nodes[0].children.length > 5) {
    invalid(filename, 'scenarios', 'requires one bullet list of 1–5 tasks');
  }
  return nodes[0].children.map((item, index) => {
    if (item.children.length !== 1 || item.children[0].type !== 'paragraph' || !visibleText(item.children[0]).trim() || hasImageOrHtml(item.children[0])) {
      invalid(filename, `scenarios[${index}]`, 'requires one non-empty task without nested content, images or raw HTML');
    }
    return rawNode(item.children[0], source).replace(/\s*\n\s*/g, ' ');
  });
}

function paragraphUrl(node, source, filename, field) {
  if (node?.type !== 'paragraph') invalid(filename, field, 'requires one URL or Markdown link');
  if (/[\u0000-\u001f\u007f]/.test(rawNode(node, source))) invalid(filename, field, 'URL must not contain control characters or line breaks');
  const children = node.children.filter(child => child.type !== 'text' || child.value.trim());
  if (children.length !== 1) invalid(filename, field, 'requires exactly one URL or Markdown link');
  if (children[0].type === 'link') return children[0].url;
  if (children[0].type === 'text') return children[0].value.trim();
  invalid(filename, field, 'requires one URL or Markdown link');
}

function decoded(value, filename, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    invalid(filename, field, 'URL contains invalid percent encoding');
  }
}

function safeEncoding(value, filename, field, pathSegment = false) {
  let current = value;
  while (true) {
    if (/[\u0000-\u001f\u007f\\]/.test(current)) invalid(filename, field, 'URL contains control characters or backslashes');
    if (pathSegment && current.split('/').some(part => !part || part === '.' || part === '..')) {
      invalid(filename, field, 'URL path must not contain empty segments or traversal');
    }
    if (!/%[\da-f]{2}/i.test(current)) break;
    current = decoded(current, filename, field);
  }
}

function httpUrl(value, filename, field, httpsOnly = false) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f\\]/.test(value)) {
    invalid(filename, field, 'must be an absolute URL without spaces, control characters or backslashes');
  }
  const authority = value.match(/^https?:\/\/([^/?#]+)/i);
  if (!authority) invalid(filename, field, 'must be an absolute HTTP(S) URL');
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid(filename, field, 'must be an absolute HTTP(S) URL');
  }
  if (!(httpsOnly ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol))) {
    invalid(filename, field, httpsOnly ? 'Skill links must use HTTPS' : 'must use HTTP or HTTPS');
  }
  if (url.username || url.password || authority[1].includes('@')) invalid(filename, field, 'URL credentials are not allowed');
  const path = value.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i)?.[1] || '/';
  safeEncoding(value, filename, field);
  const segments = path.split('/').slice(1);
  if (segments.at(-1) === '') segments.pop();
  for (const segment of segments) {
    decoded(segment, filename, field);
    safeEncoding(segment, filename, field, true);
  }
  return { url, segments: segments.map(segment => decoded(segment, filename, field)) };
}

function skillUrl(value, filename, field) {
  const { url, segments } = httpUrl(value, filename, field, true);
  if (url.hostname !== 'github.com' || url.port) invalid(filename, field, 'Skill links must use https://github.com');
  if (segments.length === 2) segments[1] = segments[1].replace(/\.git$/i, '');
  if (segments.length < 2 || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(segments[0]) || !/^[a-z\d._-]+$/i.test(segments[1]) || ['.', '..'].includes(segments[1])) {
    invalid(filename, field, 'requires a GitHub owner/repository URL');
  }
  if (segments.length !== 2 && !(segments[2] === 'tree' && segments.length >= 4) && !(segments[2] === 'blob' && segments.length >= 5 && segments.at(-1) === 'SKILL.md')) {
    invalid(filename, field, 'use a repository, tree/ref/directory, or blob/ref/path/SKILL.md URL');
  }
  segments[0] = segments[0].toLowerCase();
  segments[1] = segments[1].toLowerCase();
  const path = segments.map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
  return `https://github.com/${path}`;
}

function coverData(cover, filename) {
  if (!cover || typeof cover !== 'object' || Array.isArray(cover) || Object.keys(cover).some(key => !['url', 'alt'].includes(key))) {
    invalid(filename, 'cover', 'requires an image URL and alt text');
  }
  const { url, alt } = cover;
  if (typeof alt !== 'string' || /[\u0000-\u001f\u007f]/.test(alt)) invalid(filename, 'cover', 'alt text must be one line');
  if (typeof url !== 'string' || !url || /[\u0000-\u0020\u007f\\]/.test(url)) invalid(filename, 'cover', 'requires a relative image path or HTTPS URL');
  if (/^https:/i.test(url)) return { url: httpUrl(url, filename, 'cover', true).url.href, alt };
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('/') || /[?#]/.test(url)) invalid(filename, 'cover', 'use an HTTPS URL or a path inside this collection');
  for (const segment of url.split('/')) {
    decoded(segment, filename, 'cover');
    safeEncoding(segment, filename, 'cover', true);
    if (decoded(segment, filename, 'cover').includes('/')) invalid(filename, 'cover', 'path separators must not be encoded');
  }
  if (!/\.(png|jpe?g|webp|gif)$/i.test(decoded(url, filename, 'cover'))) invalid(filename, 'cover', 'local images must use PNG, JPEG, WebP or GIF');
  return { url: url.split('/').map(segment => encodeURIComponent(decoded(segment, filename, 'cover'))).join('/'), alt };
}

export function parseContributionMarkdown(source, { filename = 'README.md' } = {}) {
  if (typeof source !== 'string') invalid(filename, 'Markdown', 'must be a string');
  const body = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const nodes = fromMarkdown(body).children;
  const titles = nodes.filter(node => node.type === 'heading' && node.depth === 1);
  if (titles.length !== 1 || nodes[0] !== titles[0]) invalid(filename, 'title', 'requires exactly one H1 at the start');
  const title = visibleText(titles[0]).trim();
  if (!title) invalid(filename, 'title', 'must not be empty');
  const firstSection = nodes.findIndex(node => node.type === 'heading' && node.depth === 2);
  if (firstSection === -1) invalid(filename, 'skills', 'missing required Skills section');
  const introduction = nodes.slice(1, firstSection);
  const images = introduction.filter(node => node.type === 'paragraph' && node.children.length === 1 && node.children[0].type === 'image');
  if (images.length > 1) invalid(filename, 'cover', 'requires at most one standalone image');
  const prose = introduction.filter(node => !images.includes(node));
  if (prose.length !== 1 || prose[0].type !== 'paragraph' || !visibleText(prose[0]).trim() || hasImageOrHtml(prose[0])) {
    invalid(filename, 'description', 'requires exactly one introduction paragraph and an optional standalone cover image');
  }
  const sections = new Map();
  let current;
  for (const node of nodes.slice(firstSection)) {
    if (node.type === 'heading' && node.depth === 2) {
      current = sectionNames.get(visibleText(node).trim());
      if (!current) invalid(filename, 'sections', `unknown H2 section ${visibleText(node)}`);
      if (sections.has(current)) invalid(filename, current, 'duplicate section');
      sections.set(current, []);
    } else {
      sections.get(current).push(node);
    }
  }
  if (!sections.has('skills')) invalid(filename, 'skills', 'missing required Skills section');
  const skills = sections.get('skills');
  if (skills.length !== 1 || skills[0].type !== 'list' || skills[0].ordered || !skills[0].children.length) {
    invalid(filename, 'skills', 'requires one non-empty bullet list of GitHub URLs');
  }
  const seen = new Set();
  const links = skills[0].children.map((item, index) => {
    const field = `links[${index}]`;
    if (item.children.length !== 1) invalid(filename, field, 'requires one URL per bullet without nested content');
    const link = skillUrl(paragraphUrl(item.children[0], body, filename, field), filename, field);
    if (seen.has(link)) invalid(filename, field, 'duplicate GitHub URL');
    seen.add(link);
    return link;
  });
  const result = {
    title,
    description: rawNode(prose[0], body),
    overview: proseSection(sections, 'overview', body, filename),
    scenarios: scenarioSection(sections, body, filename),
    usage: proseSection(sections, 'usage', body, filename),
    links,
  };
  if (images.length) result.cover = coverData({ url: images[0].children[0].url, alt: images[0].children[0].alt || '' }, filename);
  if (sections.has('sourceUrl')) {
    const attribution = sections.get('sourceUrl');
    if (attribution.length !== 1) invalid(filename, 'sourceUrl', 'requires exactly one source URL paragraph');
    result.sourceUrl = httpUrl(paragraphUrl(attribution[0], body, filename, 'sourceUrl'), filename, 'sourceUrl').url.href;
  }
  return result;
}

export function serializeContributionMarkdown(data, { language = 'en' } = {}) {
  const filename = 'serializeContributionMarkdown';
  if (!['en', 'zh'].includes(language)) invalid(filename, 'language', 'must be en or zh');
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalid(filename, 'contribution', 'must be an object');
  for (const field of Object.keys(data)) {
    if (!['title', 'description', 'overview', 'scenarios', 'usage', 'links', 'sourceUrl', 'cover'].includes(field)) invalid(filename, field, 'unknown contribution field');
  }
  if (typeof data.title !== 'string' || !data.title.trim() || /[\r\n]/.test(data.title)) invalid(filename, 'title', 'must be one non-empty line');
  if (typeof data.description !== 'string' || !data.description.trim()) invalid(filename, 'description', 'must be a non-empty paragraph');
  if (!Array.isArray(data.links) || !data.links.length) invalid(filename, 'links', 'requires a non-empty array of GitHub URLs');
  for (const field of ['overview', 'usage']) {
    if (typeof data[field] !== 'string' || !data[field].trim()) invalid(filename, field, 'must be a non-empty paragraph');
  }
  if (!Array.isArray(data.scenarios) || data.scenarios.length < 1 || data.scenarios.length > 5) invalid(filename, 'scenarios', 'requires 1–5 tasks');
  const scenarios = data.scenarios.map((task, index) => {
    if (typeof task !== 'string' || !task.trim() || /[\r\n]/.test(task)) invalid(filename, `scenarios[${index}]`, 'must be one non-empty line');
    return `- ${task}`;
  }).join('\n');
  const title = data.title.replace(/([\\`*_[\]<>#&])/g, '\\$1');
  const links = data.links.map((link, index) => `- ${skillUrl(link, filename, `links[${index}]`)}`).join('\n');
  const labels = headings[language];
  const parts = [`# ${title}`, data.description];
  if (data.cover !== undefined) {
    const cover = coverData(data.cover, filename);
    const alt = cover.alt.replace(/([\\[\]<>&])/g, '\\$1');
    parts.push(`![${alt}](<${cover.url}>)`);
  }
  parts.push(`## ${labels.overview}`, data.overview, `## ${labels.scenarios}`, scenarios, `## ${labels.usage}`, data.usage, `## ${labels.skills}`, links);
  if (data.sourceUrl !== undefined) parts.push(`## ${labels.sourceUrl}`, `<${httpUrl(data.sourceUrl, filename, 'sourceUrl').url.href}>`);
  const source = `${parts.join('\n\n')}\n`;
  parseContributionMarkdown(source, { filename });
  return source;
}
