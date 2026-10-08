import { categories, categoryLabels } from './categories.mjs';
import { mkdir, mkdtemp, readFile, readdir, lstat, rename, rm, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseCollectionMarkdown, parseTranslationMarkdown } from './markdown.mjs';
import { parseContributionMarkdown } from './contribution.mjs';
import { validateCollection, indexItem, externalCoverUrl } from './site-contract.mjs';

const SHA = /^[a-f0-9]{40}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';
const PLACEHOLDER_DATE = '1970-01-01T00:00:00Z';
const START = '<!-- catalog:start -->';
const END = '<!-- catalog:end -->';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (file, field, message) => { throw new Error(`${file}: ${field} ${message}`); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, file, field) {
  if (!plain(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(file, `${field}.${key}`, 'is not a supported field');
}
function safePath(value, file, field, allowRoot = false) {
  if (allowRoot && value === '.') return;
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f\\%?#:]/.test(value) || path.posix.isAbsolute(value) || value.split('/').some(p => !p || p === '.' || p === '..')) {
    fail(file, field, 'must be a safe relative path without URL encoding, traversal or control characters');
  }
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function contained(root, target, file, field) {
  const [realRoot, actual] = await Promise.all([realpath(root), realpath(target)]);
  if (!inside(realRoot, actual)) fail(file, field, 'symbolic link escapes the repository');
  return actual;
}
function ownedFields(data, file) {
  keys(data, ['schemaVersion','id','slug','revision','sortOrder','createdAt','updatedAt','sourceKeys','status','sourceKind','title','description','category','tags','overview','scenarios','usage','provenance','review','cover','skills','verification','localizations','curator'], file, 'collection');
  keys(data.review, ['status','reviewer','reviewedAt','notes'], file, 'review');
  keys(data.cover, ['kind','url','sourceUrl','rightsStatus','rightsEvidenceUrl','alt','preset','width','height','background','position'], file, 'cover');
  for (const field of ['width','height']) if (data.cover?.[field] !== undefined && (!Number.isSafeInteger(data.cover[field]) || data.cover[field] < 1)) fail(file, `cover.${field}`, 'must be a positive integer');
  if (data.cover?.background !== undefined && (typeof data.cover.background !== 'string' || !/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(data.cover.background))) fail(file,'cover.background','must be a hex color');
  keys(data.provenance, ['author','recommender','repositoryScope','selectionReason','evidence'], file, 'provenance');
  for (const field of ['author','recommender']) keys(data.provenance?.[field], ['name','url'], file, `provenance.${field}`);
  keys(data.provenance?.repositoryScope, ['repo','commit','directories','coverage'], file, 'provenance.repositoryScope');
  for (const evidence of data.provenance?.evidence ?? []) keys(evidence, ['id','kind','url','title','publisher','checkedAt','publishedAt','location','finding','supportsItemIds'], file, 'provenance.evidence');
  keys(data.verification, ['source','files','checkedAt','notes','installation','workflow','installationEvidence','workflowEvidence'], file, 'verification');
  for (const field of ['installation','workflow']) {
    const evidence = data.verification?.[`${field}Evidence`];
    keys(evidence, ['testedAt','versions','itemIds','resultRef','environment'], file, `verification.${field}Evidence`);
    for (const version of evidence?.versions ?? []) keys(version, ['repo','commit'], file, `verification.${field}Evidence.versions`);
  }
  for (const skill of data.skills ?? []) {
    keys(skill, ['id','name','summary','role','originalDescription','authors','entry','installationMode','installationItems','resourceCheck','resourceNotes'], file, 'skills');
    keys(skill.entry,['repo','commit','entryPoint'],file,'skills.entry');
    for (const author of skill.authors ?? []) keys(author,['name','evidenceUrl'],file,'skills.authors');
    for (const item of skill.installationItems ?? []) {
      keys(item,['name','repo','commit','directory','entryPoint','license'],file,'skills.installationItems');
      keys(item.license,['identifier','evidenceUrl'],file,'skills.installationItems.license');
    }
  }
}
function validationDocument(document, pending) {
  const data = structuredClone(document);
  if (!pending) return data;
  if (data.schemaVersion === undefined) data.schemaVersion = 1;
  if (data.id === undefined) data.id = PLACEHOLDER_ID;
  if (data.revision === undefined) data.revision = 1;
  if (data.createdAt === undefined) data.createdAt = PLACEHOLDER_DATE;
  if (data.updatedAt === undefined) data.updatedAt = data.createdAt;
  if (data.sourceKeys === undefined) data.sourceKeys = [`draft:${data.slug}`];
  if (data.status === undefined) data.status = 'active';
  if (data.status === 'draft') data.status = 'active';
  if (data.review === undefined) data.review = {status:'pending',notes:[]};
  if (plain(data.review)) if (data.review.notes === undefined) data.review.notes = [];
  if (data.cover === undefined) data.cover = {kind:'concept',preset:'neutral',alt:data.title};
  if (data.verification === undefined) data.verification = {};
  if (plain(data.verification)) {
    if (data.verification.source === undefined) data.verification.source = 'needs-review'; if (data.verification.files === undefined) data.verification.files = 'needs-review';
    if (data.verification.installation === undefined) data.verification.installation = 'not-tested'; if (data.verification.workflow === undefined) data.verification.workflow = 'not-tested';
    if (data.verification.checkedAt === undefined) data.verification.checkedAt = PLACEHOLDER_DATE; if (data.verification.notes === undefined) data.verification.notes = [];
  }
  const sources=[data.provenance?.repositoryScope,...(data.skills ?? []).flatMap(skill=>[skill.entry,...(skill.installationItems ?? [])])].filter(plain);
  const commits=new Map();
  for (const source of sources) if (typeof source.repo === 'string' && typeof source.commit === 'string') {
    const key=source.repo.toLowerCase(),known=commits.get(key) ?? new Set();
    known.add(source.commit); commits.set(key,known);
  }
  const fillCommit = (source,preferred) => {
    if (!plain(source) || source.commit !== undefined) return;
    const known=commits.get(source.repo?.toLowerCase());
    source.commit=preferred ?? (known?.size === 1 ? [...known][0] : '0'.repeat(40));
  };
  fillCommit(data.provenance?.repositoryScope);
  for (const evidence of data.provenance?.evidence ?? []) if (plain(evidence)) if (evidence.checkedAt === undefined) evidence.checkedAt = PLACEHOLDER_DATE;
  for (const skill of data.skills ?? []) {
    const entryItem=(skill.installationItems ?? []).find(item=>item.repo?.toLowerCase() === skill.entry?.repo?.toLowerCase() && (item.directory === '.' ? 'SKILL.md' : `${item.directory}/SKILL.md`) === skill.entry?.entryPoint);
    fillCommit(skill.entry,entryItem?.commit);
    if (skill.resourceCheck === undefined) skill.resourceCheck = 'needs-review';
    if (skill.resourceNotes === undefined) skill.resourceNotes = 'Resource verification is pending.';
    for (const item of skill.installationItems ?? []) fillCommit(item,item === entryItem ? skill.entry?.commit : undefined);
  }
  return data;
}
function sourcePaths(data, file) {
  for (const directory of data.provenance?.repositoryScope?.directories ?? []) safePath(directory,file,'provenance.repositoryScope.directories',true);
  const names = new Map(), versions = new Map();
  for (const skill of data.skills ?? []) {
    safePath(skill.entry?.entryPoint,file,'skills.entry.entryPoint');
    for (const item of skill.installationItems ?? []) {
      safePath(item.directory,file,'skills.installationItems.directory',true);
      safePath(item.name,file,'skills.installationItems.name');
      if (item.name.includes('/')) fail(file,'installation.name','must be a single directory name');
      if (/[. ]$/.test(item.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(item.name)) fail(file,'installation.name','must be safe on Windows');
      const source = `${item.repo?.toLowerCase()}\0${item.directory}`;
      const name = item.name.toLowerCase(),previous=names.get(name);
      if (previous && (previous.source !== source || previous.commit !== undefined && item.commit !== undefined && previous.commit !== item.commit)) fail(file,'installation.name','conflicts with another installation source');
      names.set(name,{source,commit:item.commit ?? previous?.commit});
      if (versions.has(source) && item.commit !== undefined && versions.get(source) !== item.commit) fail(file,'installation.version','conflicts for the same repository directory');
      if (item.commit !== undefined) versions.set(source,item.commit);
    }
  }
}
function testEvidence(data, file) {
  for (const kind of ['installation','workflow']) {
    const evidence = data.verification?.[`${kind}Evidence`];
    if (evidence === undefined) continue;
    if (!plain(evidence) || !Array.isArray(evidence.versions) || !evidence.versions.length || !Array.isArray(evidence.itemIds) || !evidence.itemIds.length) fail(file,`verification.${kind}Evidence`,'must describe tested versions and item IDs');
    if (typeof evidence.testedAt !== 'string' || !Number.isFinite(Date.parse(evidence.testedAt)) || typeof evidence.resultRef !== 'string' || !evidence.resultRef.trim() || typeof evidence.environment !== 'string' || !evidence.environment.trim()) fail(file,`verification.${kind}Evidence`,'must include valid testedAt, resultRef and environment');
    const listed = new Set(evidence.versions.map(v => `${v.repo?.toLowerCase()}\0${v.commit?.toLowerCase()}`));
    const expected = new Set();
    for (const id of evidence.itemIds) {
      const skill = data.skills.find(s => s.id === id);
      if (!skill) fail(file,`verification.${kind}Evidence.itemIds`,'contains an unknown Skill');
      for (const item of skill.installationItems) expected.add(`${item.repo.toLowerCase()}\0${item.commit?.toLowerCase()}`);
    }
    if (listed.size !== expected.size || [...expected].some(v => !listed.has(v))) fail(file,`verification.${kind}Evidence.versions`,'must correspond exactly to current tested Skill versions');
    for (const version of evidence.versions) if (typeof version.repo !== 'string' || !SHA.test(version.commit ?? '')) fail(file,`verification.${kind}Evidence.versions`,'must contain repository and full commit SHA');
  }
}
function releaseGate(data, file) {
  for (const field of ['installation','workflow']) if (data.verification[field] === 'failed') fail(file,`verification.${field}`,'failed tests prevent publication');
}
async function coverAsset(rootDir, directory, parsed, file, publicReadmes) {
  const {document,coverFile} = parsed;
  if (coverFile === undefined) {
    if (Object.values(publicReadmes ?? {}).some(contribution=>contribution.cover && !contribution.cover.url.startsWith('https://'))) fail(file,'cover.file','must archive the local cover shown in each public README');
    if (Object.values(publicReadmes ?? {}).some(contribution=>contribution.cover) && document.cover?.kind !== 'source-image') fail(file,'cover.kind','must use source-image for the cover shown in public READMEs');
    if (document.cover?.kind === 'source-image') {
      const url=externalCoverUrl(document.cover.url,file);
      const contributions=Object.values(publicReadmes ?? {});
      if (!contributions.length || contributions.some(contribution=>contribution.cover?.url !== url)) fail(file,'cover.url','must match the HTTPS cover shown in each public README');
      document.cover.url=url;
    }
    return undefined;
  }
  if (document.cover?.kind !== 'source-image') fail(file,'cover.file','requires a source-image cover');
  if (/^https?:/i.test(document.cover.url ?? '') || Object.values(publicReadmes ?? {}).some(contribution=>contribution.cover?.url.startsWith('https://'))) fail(file,'cover.file','cannot coexist with an external cover URL');
  safePath(coverFile,file,'cover.file');
  if (Object.values(publicReadmes ?? {}).some(contribution=>contribution.cover && decodeURIComponent(contribution.cover.url) !== coverFile)) fail(file,'cover.file','must match the local cover shown in each public README');
  const target = path.join(directory,coverFile);
  const actual = await contained(rootDir,target,file,'cover.file');
  if (!inside(await realpath(directory),actual)) fail(file,'cover.file','symbolic link escapes the collection directory');
  const info = await stat(actual);
  if (!info.isFile() || info.size > 5 * 1024 * 1024 || !info.size) fail(file,'cover.file','must be a nonempty image file at most 5 MiB');
  const bytes = await readFile(actual);
  const extension = path.extname(coverFile).toLowerCase();
  const png = bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) && bytes.subarray(12,16).toString() === 'IHDR';
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 16 && bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' && ['VP8 ','VP8L','VP8X'].includes(bytes.subarray(12,16).toString());
  const gif = bytes.length >= 13 && ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString());
  if (!(({'.png':png,'.jpg':jpeg,'.jpeg':jpeg,'.webp':webp,'.gif':gif})[extension])) fail(file,'cover.file','image format and magic bytes must match PNG, JPEG, WebP or GIF');
  const assetPath = `assets/${document.id ?? document.slug}/cover${extension}`;
  document.cover.url = `/data/collections/${assetPath}`;
  return {path:assetPath,bytes,info};
}
function mergePresentation(left, right) {
  const mergeEntries = (previous, updates) => {
    const merged={...previous};
    for (const [id, fields] of Object.entries(updates ?? {})) merged[id]={...previous?.[id],...fields};
    return merged;
  };
  const result={...left,...right};
  if (left?.skills || right?.skills) result.skills=mergeEntries(left?.skills,right?.skills);
  if (left?.provenance || right?.provenance) result.provenance={...left?.provenance,...right?.provenance};
  if (left?.provenance?.evidence || right?.provenance?.evidence) result.provenance.evidence=mergeEntries(left?.provenance?.evidence,right?.provenance?.evidence);
  return result;
}
function presentationOf(data) {
  return {
    title:data.title,description:data.description,overview:data.overview,scenarios:data.scenarios,usage:data.usage,tags:data.tags,coverAlt:data.cover?.alt,
    skills:Object.fromEntries(data.skills.map(s=>[s.id,{summary:s.summary,...(s.role !== undefined ? {role:s.role}:{})}])),
    provenance:{...(data.provenance.selectionReason !== undefined ? {selectionReason:data.provenance.selectionReason}:{}),evidence:Object.fromEntries(data.provenance.evidence.map(e=>[e.id,{title:e.title,location:e.location,finding:e.finding}]))},
  };
}
function checkPresentation(presentation,data,file) {
  if (!plain(presentation)) fail(file,'translation','must be an object');
  keys(presentation,['title','description','overview','scenarios','usage','tags','coverAlt','provenance','skills'],file,'translation');
  if (presentation.skills !== undefined) {
    if (!plain(presentation.skills)) fail(file,'translation.skills','must be an object');
    for (const [id,skill] of Object.entries(presentation.skills)) {
      if (!plain(skill)) fail(file,`translation.skills.${id}`,'must be an object');
      keys(skill,['summary','role'],file,`translation.skills.${id}`);
      if (!data.skills.some(s=>s.id === id)) fail(file,`translation.skills.${id}`,'refers to an unknown Skill ID');
    }
  }
  if (presentation.provenance !== undefined) {
    if (!plain(presentation.provenance)) fail(file,'translation.provenance','must be an object');
    keys(presentation.provenance,['selectionReason','evidence'],file,'translation.provenance');
    if (presentation.provenance.evidence !== undefined) {
      if (!plain(presentation.provenance.evidence)) fail(file,'translation.provenance.evidence','must be an object');
      for (const [id,evidence] of Object.entries(presentation.provenance.evidence)) {
        if (!plain(evidence)) fail(file,`translation.provenance.evidence.${id}`,'must be an object');
        keys(evidence,['title','location','finding'],file,`translation.provenance.evidence.${id}`);
        if (!data.provenance.evidence.some(e=>e.id === id)) fail(file,`translation.provenance.evidence.${id}`,'refers to an unknown evidence ID');
      }
    }
  }
}
function applyPresentation(data,presentation) {
  for (const field of ['title','description','overview','scenarios','usage','tags']) if (presentation[field] !== undefined) data[field]=presentation[field];
  if (presentation.coverAlt !== undefined) data.cover.alt=presentation.coverAlt;
  for (const skill of data.skills) Object.assign(skill,presentation.skills?.[skill.id] ?? {});
  if (presentation.provenance?.selectionReason !== undefined) data.provenance.selectionReason=presentation.provenance.selectionReason;
  for (const evidence of data.provenance.evidence) Object.assign(evidence,presentation.provenance?.evidence?.[evidence.id] ?? {});
}
async function translations(rootDir,directory,parsed,canonicalFile,{publicReadmes=false}={}) {
  const data=parsed.document,localized={...data.localizations};
  const directoryPresentations={ [parsed.language]:{title:data.title,description:data.description} };
  for (const language of ['en','zh']) {
    const file=path.join(directory,`README.${language}.md`);
    if (file === canonicalFile) continue;
    let source;
    try { await contained(rootDir,file,file,'translation'); source=await readFile(file,'utf8'); } catch(error) {if (error.code === 'ENOENT') continue; throw error;}
    if (publicReadmes && !/^---[ \t]*(?:\r?\n|$)/.test(source.replace(/^\uFEFF/,''))) continue;
    const translated=parseTranslationMarkdown(source,{filename:file});
    if (translated.id !== data.id) fail(file,'id','must match the canonical collection identity');
    if (translated.language !== language) fail(file,'language','must match the translation filename');
    if (language === parsed.language) fail(file,'language','must differ from the canonical document language');
    checkPresentation(translated.presentation,data,file);
    localized[language]=mergePresentation(localized[language],translated.presentation);
  }
  for (const presentation of Object.values(localized)) checkPresentation(presentation,data,directory);
  for (const language of ['en','zh']) if (language !== parsed.language && localized[language]) {
    const presentation=localized[language];
    directoryPresentations[language]={title:presentation.title,description:presentation.description};
  }
  const baseLanguage=parsed.language === 'en' && localized.zh ? 'zh' : parsed.language;
  if (parsed.language === 'en' && localized.zh) {
    const original=presentationOf(data);
    applyPresentation(data,localized.zh);
    localized.en=mergePresentation(original,localized.en);
  } else if (parsed.language === 'zh' && localized.zh) {
    fail(directory,'localizations.zh','must not override the canonical Chinese body');
  }
  delete localized.zh;
  if (Object.keys(localized).length) data.localizations=localized;
  else delete data.localizations;
  return {baseLanguage,directoryPresentations};
}
function curatorFields(curator,file) {
  if (curator === undefined) return;
  if (typeof curator !== 'string' && !plain(curator)) fail(file,'curator','must be a name or object');
  keys(curator,['name','url'],file,'curator');
  const name=typeof curator === 'string' ? curator : curator.name;
  if (typeof name !== 'string' || !name.trim() || /[\u0000-\u001f\u007f]/.test(name)) fail(file,'curator.name','must be nonempty text without control characters');
  if (plain(curator) && curator.url !== undefined) {
    if (typeof curator.url !== 'string' || !curator.url.trim() || /[\u0000-\u001f\u007f]/.test(curator.url)) fail(file,'curator.url','must be a URL without control characters');
    let url;
    try {url=new URL(curator.url);} catch {fail(file,'curator.url','must be an HTTP(S) URL');}
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) fail(file,'curator.url','must be an HTTP(S) URL without credentials');
  }
  return {name,...(plain(curator) && curator.url !== undefined ? {url:curator.url}:{})};
}
function comparable(data) {
  const value=structuredClone(data);
  delete value.revision; delete value.updatedAt; delete value.review;
  return canonical(value);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function checkBase(records, base) {
  const current = new Map(records.map(record => [record.document.id,record]));
  for (const previous of base) {
    const old=previous.document, next=old.id ? current.get(old.id) : records.find(r=>r.document.slug === old.slug);
    if (!next) fail(previous.file,'id','stable identity was removed; archive existing collections instead');
    const data=next.document;
    for (const field of ['slug','createdAt']) if (old[field] !== undefined && old[field] !== data[field]) fail(next.file,field,'must preserve the existing stable identity');
    if (previous.kind === 'submission') continue;
    if ((old.sourceKeys ?? []).some(key => !data.sourceKeys?.includes(key))) fail(next.file,'sourceKeys','must preserve historical source keys');
    for (const skill of old.skills) {
      if (data.skills.some(s => s.id === skill.id)) continue;
      const same=data.skills.find(s => s.entry.repo.toLowerCase() === skill.entry.repo.toLowerCase() && s.entry.entryPoint === skill.entry.entryPoint);
      if (same && same.id !== skill.id) fail(next.file,'skills.id','must preserve an existing item identity');
    }
    const changed=comparable(data) !== comparable(old) || canonical(next.curator) !== canonical(previous.curator) || next.language !== previous.language || previous.publicReadmes && canonical(next.publicReadmes) !== canonical(previous.publicReadmes) || next.asset?.bytes && previous.asset?.bytes && !next.asset.bytes.equals(previous.asset.bytes);
    if (changed) {
      if (old.revision !== undefined && data.revision !== old.revision + 1) fail(next.file,'revision','content changes require exactly the next revision');
      if (old.updatedAt !== undefined && !(Date.parse(data.updatedAt) > Date.parse(old.updatedAt))) fail(next.file,'updatedAt','content changes require a later timestamp');
      if (data.review?.status === 'approved' && (canonical(data.review) === canonical(old.review) || Date.parse(data.review.reviewedAt) < Date.parse(data.updatedAt))) fail(next.file,'review','a changed revision requires fresh approval after updatedAt');
    } else {
      if (old.revision !== undefined && data.revision !== old.revision) fail(next.file,'revision','must not increase without content changes');
      if (old.updatedAt !== undefined && data.updatedAt !== old.updatedAt) fail(next.file,'updatedAt','must not change without content changes');
    }
  }
}
async function canonicalFile(directory) {
  const english=path.join(directory,'README.md');
  try {await lstat(english); return english;} catch(error) {if (error.code !== 'ENOENT') throw error;}
  return path.join(directory,'README.zh.md');
}
async function maintainerFile(directory) {
  const files=[];
  for (const name of ['record.md','record.zh.md']) {
    const file=path.join(directory,name);
    try {await lstat(file); files.push(file);} catch(error) {if (error.code !== 'ENOENT') throw error;}
  }
  if (files.length > 1) fail(directory,'record','requires exactly one maintainer record');
  return files[0];
}
function submissionPresentation({title,description,overview,scenarios,usage}) {
  return {title,description,overview,scenarios,usage};
}
async function internalMetadata(rootDir) {
  const directory=path.join(rootDir,'.catalog'),records=new Map();
  try {await lstat(directory);} catch(error) {if (error.code === 'ENOENT') return records; throw error;}
  await contained(rootDir,directory,directory,'metadata');
  if (!(await stat(directory)).isDirectory()) fail(directory,'metadata','must be a directory');
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const slug=name.slice(0,-5),file=path.join(directory,name);
    if (!SLUG.test(slug)) fail(file,'metadata.slug','must be a lowercase slug filename');
    await contained(rootDir,file,file,'metadata');
    if (!(await stat(file)).isFile()) fail(file,'metadata','must be a JSON file');
    let parsed;
    try {parsed=JSON.parse(await readFile(file,'utf8'));} catch(error) {fail(file,'metadata.JSON',`must be valid JSON: ${error.message}`);}
    if (!plain(parsed)) fail(file,'metadata','must be an object');
    keys(parsed,['language','document','coverFile'],file,'metadata');
    if (!['en','zh'].includes(parsed.language)) fail(file,'metadata.language','must be en or zh');
    if (!plain(parsed.document)) fail(file,'metadata.document','must be an object');
    if (parsed.document.slug !== slug) fail(file,'metadata.slug','must match its filename');
    for (const [location,presentation] of [['document',parsed.document],...Object.entries(parsed.document.localizations ?? {}).map(([language,value])=>[`localizations.${language}`,value])]) {
      for (const field of ['title','description','overview','scenarios','usage']) if (Object.hasOwn(presentation ?? {},field)) fail(file,`metadata.${location}.${field}`,'display fields must come only from public README files');
    }
    if (parsed.coverFile !== undefined) safePath(parsed.coverFile,file,'metadata.coverFile');
    ownedFields(parsed.document,file);
    if (parsed.document.localizations !== undefined) {
      if (!plain(parsed.document.localizations)) fail(file,'metadata.localizations','must be an object');
      keys(parsed.document.localizations,['en','zh'],file,'metadata.localizations');
      for (const presentation of Object.values(parsed.document.localizations)) checkPresentation(presentation,parsed.document,file);
    }
    records.set(slug,{file,parsed});
  }
  return records;
}
async function contributionCover(directory,contribution,file) {
  if (!contribution.cover || contribution.cover.url.startsWith('https://')) return;
  const local=decodeURIComponent(contribution.cover.url).replace(/^\.\//,'');
  safePath(local,file,'cover.url');
  const actual=await contained(directory,path.join(directory,local),file,'cover.url');
  if (!(await stat(actual)).isFile()) fail(file,'cover.url','must name a file inside the collection directory');
}
function matchingContributions(contribution,canonicalContribution,file) {
  if (canonical([...contribution.links].sort()) !== canonical([...canonicalContribution.links].sort())) fail(file,'links','must match the canonical submission links');
  if (contribution.sourceUrl !== canonicalContribution.sourceUrl) fail(file,'sourceUrl','must match the canonical submission attribution');
  if (contribution.cover?.url !== canonicalContribution.cover?.url) fail(file,'cover.url','must match the canonical submission cover URL');
}
function commonDirectory(items) {
  let prefix=items[0].directory === '.' ? [] : items[0].directory.split('/');
  for (const item of items.slice(1)) {
    const parts=item.directory === '.' ? [] : item.directory.split('/');
    const differing=prefix.findIndex((part,index)=>part !== parts[index]);
    if (differing >= 0) prefix=prefix.slice(0,differing);
  }
  return prefix.join('/') || '.';
}
const directoryWithin=(directory,boundary)=>boundary === '.' || directory === boundary || directory.startsWith(`${boundary}/`);
function publicInstallationScope(data,contribution,file) {
  const unique=new Map();
  for (const skill of data.skills) for (const item of skill.installationItems ?? []) unique.set(`${item.repo.toLowerCase()}\0${item.commit}\0${item.directory}`,item);
  const items=[...unique.values()],covered=new Set();
  for (const link of contribution.links) {
    const parts=new URL(link).pathname.slice(1).split('/').map(decodeURIComponent),repo=`${parts[0]}/${parts[1]}`,kind=parts[2];
    const directory=kind === 'blob' ? parts.slice(4,-1).join('/') || '.' : kind === 'tree' ? parts.slice(4).join('/') || '.' : '.';
    const matches=items.filter(item=>item.repo.toLowerCase() === repo && (kind === 'blob' ? item.directory === directory : directoryWithin(item.directory,directory)));
    if (!matches.length) fail(file,'links','scope does not match any recorded installation directory');
    if (SHA.test(parts[3] ?? '') && matches.some(item=>item.commit?.toLowerCase() !== parts[3].toLowerCase())) fail(file,'links','commit must match the recorded installation version');
    if (kind !== 'blob') {
      const declared=data.provenance?.repositoryScope;
      const boundaries=declared?.repo?.toLowerCase() === repo ? declared.directories : data.skills.flatMap(skill=>{
        const group=(skill.installationItems ?? []).filter(item=>item.repo.toLowerCase() === repo);
        return !group.length ? [] : skill.installationMode === 'bundle' ? [commonDirectory(group)] : group.map(item=>item.directory);
      });
      if (!boundaries?.some(boundary=>directoryWithin(directory,boundary))) fail(file,'links','scope must stay within the recorded repository or bundle directories');
    }
    for (const item of matches) covered.add(item);
  }
  if (covered.size !== items.length) fail(file,'links','must cover every recorded installation directory');
}
async function publicPresentations(rootDir,directory,data,baseLanguage,{metadataFile,requiredLanguage}={}) {
  const publicReadmes={},browseFiles={},directoryPresentations={};
  let canonicalContribution;
  for (const [name,language] of [['README.md','en'],['README.zh.md','zh']]) {
    const file=path.join(directory,name);
    let source;
    try {await contained(rootDir,file,file,'README'); source=await readFile(file,'utf8');} catch(error) {if (error.code === 'ENOENT') continue; throw error;}
    if (/^---[ \t]*(?:\r?\n|$)/.test(source.replace(/^\uFEFF/,''))) {
      if (metadataFile) fail(metadataFile,'metadata','cannot coexist with a full public README');
      fail(file,'README','must be a simple public contribution beside the maintainer record');
    }
    const contribution=parseContributionMarkdown(source,{filename:file});
    if (canonicalContribution) matchingContributions(contribution,canonicalContribution,file);
    else {canonicalContribution=contribution; publicInstallationScope(data,contribution,file);}
    await contributionCover(directory,contribution,file);
    const presentation=submissionPresentation(contribution);
    if (baseLanguage === 'en' && language === 'zh') {
      const english=mergePresentation(mergePresentation(presentationOf(data),data.localizations?.en),directoryPresentations.en);
      const chinese=data.localizations?.zh;
      if (chinese) checkPresentation(chinese,data,file);
      applyPresentation(data,{...chinese,...presentation});
      data.localizations={...data.localizations,en:english}; delete data.localizations.zh;
      baseLanguage='zh';
    } else if (language === baseLanguage) Object.assign(data,presentation);
    else data.localizations={...data.localizations,[language]:mergePresentation(data.localizations?.[language],presentation)};
    publicReadmes[language]=contribution; browseFiles[language]=file; directoryPresentations[language]=presentation;
  }
  if (requiredLanguage && !publicReadmes[requiredLanguage]) fail(metadataFile,'metadata',`${requiredLanguage === 'en' ? 'README.md' : 'README.zh.md'} is required for its base language`);
  if (!canonicalContribution) fail(directory,'README','requires at least one simple public README beside the maintainer record');
  return {publicReadmes,browseFiles,directoryPresentations,baseLanguage};
}
async function submissionRecord(rootDir,entry,file,source) {
  if (entry.historical) fail(file,'category','lightweight submissions require a fixed category and nested slug directory');
  const contribution=parseContributionMarkdown(source,{filename:file});
  await contributionCover(entry.directory,contribution,file);
  const language=path.basename(file) === 'README.md' ? 'en' : 'zh';
  const directoryPresentations={[language]:submissionPresentation(contribution)};
  const browseFiles={[language]:file};
  for (const [name,translationLanguage] of [['README.md','en'],['README.zh.md','zh']]) {
    const translationFile=path.join(entry.directory,name);
    if (translationFile === file) continue;
    let translationSource;
    try {await contained(rootDir,translationFile,translationFile,'translation'); translationSource=await readFile(translationFile,'utf8');}
    catch(error) {if (error.code === 'ENOENT') continue; throw error;}
    const translated=parseContributionMarkdown(translationSource,{filename:translationFile});
    matchingContributions(translated,contribution,translationFile);
    await contributionCover(entry.directory,translated,translationFile);
    directoryPresentations[translationLanguage]=submissionPresentation(translated);
    browseFiles[translationLanguage]=translationFile;
  }
  const document={slug:entry.name,category:entry.category,...directoryPresentations[language],status:'draft',skills:[],links:contribution.links};
  if (contribution.sourceUrl !== undefined) document.sourceUrl=contribution.sourceUrl;
  if (contribution.cover !== undefined) document.cover=contribution.cover;
  return {kind:'submission',document,file,language,baseLanguage:language,directoryPresentations,browseFiles,complete:false};
}
async function readCatalog(rootDir, mode, {allowMissingCollections=false,allowHistoricalFlat=false}={}) {
  const metadata=await internalMetadata(rootDir);
  const collectionDir=path.join(rootDir,'collections');
  let entries;
  try {entries=await readdir(collectionDir,{withFileTypes:true});}
  catch (error) {
    if (!allowMissingCollections || error.code !== 'ENOENT') throw error;
    await stat(rootDir);
    try {await lstat(collectionDir);} catch (missing) {if (missing.code === 'ENOENT') {if (metadata.size) fail(rootDir,'metadata','orphan data has no matching collection directory'); return [];} throw missing;}
    throw error;
  }
  await contained(rootDir,collectionDir,collectionDir,'collections');
  const records=[];
  const registries = {id:new Map(),slug:new Map(),sourceKeys:new Map()};
  const candidates=[];
  for (const category of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if (category.name.startsWith('.')) continue;
    const categoryDir=path.join(collectionDir,category.name);
    if (!(await stat(categoryDir)).isDirectory()) continue;
    await contained(rootDir,categoryDir,category.name,'category');
    let flat=false;
    for (const name of ['README.md','README.zh.md','record.md','record.zh.md']) {
      try {await lstat(path.join(categoryDir,name));flat=true;} catch(error) {if (error.code !== 'ENOENT') throw error;}
    }
    if (flat && !allowHistoricalFlat) fail(categoryDir,'category','requires a nested slug directory for each collection');
    if (flat || !categories.includes(category.name)) {
      if (!allowHistoricalFlat) fail(categoryDir,'category','is unknown; use a fixed category directory');
      candidates.push({name:category.name,directory:categoryDir,historical:true});
      continue;
    }
    for (const entry of await readdir(categoryDir,{withFileTypes:true})) {
      if (entry.name.startsWith('.')) continue;
      const directory=path.join(categoryDir,entry.name);
      if (!(await stat(directory)).isDirectory()) continue;
      candidates.push({name:entry.name,directory,category:category.name});
    }
  }
  for (const [slug,{file}] of metadata) if (!candidates.some(entry=>entry.name === slug)) fail(file,'metadata','is orphan data without a matching collection directory');
  for (const entry of candidates) {
    const directory=entry.directory;
    if (!SLUG.test(entry.name)) fail(entry.name,'directory','must be a lowercase slug');
    await contained(rootDir,directory,entry.name,'directory');
    const recordFile=await maintainerFile(directory),internal=metadata.get(entry.name),filename=internal?.file ?? recordFile ?? await canonicalFile(directory);
    if (internal && recordFile) fail(filename,'metadata','cannot coexist with a legacy record file');
    await contained(rootDir,filename,entry.name,path.basename(filename));
    const source=internal ? undefined : await readFile(filename,'utf8');
    if (!internal && !/^---[ \t]*(?:\r?\n|$)/.test(source.replace(/^\uFEFF/,''))) {
      if (recordFile) fail(filename,'record','must contain a complete frontmatter maintainer record');
      const record=await submissionRecord(rootDir,entry,filename,source);
      if (registries.slug.has(entry.name)) fail(filename,'slug',`conflicts with ${registries.slug.get(entry.name)}`);
      registries.slug.set(entry.name,filename);
      records.push(record);
      continue;
    }
    const parsed=internal?.parsed ?? parseCollectionMarkdown(source,{filename});
    if (['README.zh.md','record.zh.md'].includes(path.basename(filename)) && parsed.language !== 'zh') fail(filename,'language','must match the canonical filename');
    if (path.basename(filename) === 'record.md' && parsed.language !== 'en') fail(filename,'language','must match the canonical filename');
    const data=parsed.document;
    if (entry.historical) {
      if (data.category === 'video') data.category='media';
    } else {
      if (data.category !== undefined && data.category !== entry.category) fail(filename,'category','must match its category directory');
      data.category=entry.category;
    }
    const curator=curatorFields(parsed.curator ?? data.curator,filename);
    if (curator !== undefined) data.curator=curator;
    let {baseLanguage,directoryPresentations}=internal ? {baseLanguage:parsed.language,directoryPresentations:{}} : await translations(rootDir,directory,parsed,filename,{publicReadmes:!!recordFile});
    const publicData=internal || recordFile ? await publicPresentations(rootDir,directory,data,baseLanguage,internal ? {metadataFile:filename,requiredLanguage:parsed.language}:{}) : undefined;
    if (publicData) {directoryPresentations=publicData.directoryPresentations; baseLanguage=publicData.baseLanguage;}
    if (data.slug !== entry.name) fail(filename,'slug','must match its collection directory');
    ownedFields(data,filename);
    sourcePaths(data,filename);
    const asset=await coverAsset(rootDir,directory,parsed,filename,publicData?.publicReadmes);
    const pending = (data.review?.status ?? 'pending') === 'pending' || data.status === 'draft';
    const validated=validationDocument(data,pending);
    await validateCollection(validated,`${validated.id}.json`,rootDir,{validateLocalCover:async url => {
      if (!asset || data.cover.url !== url) fail(filename,'cover.url','does not match validated archived cover');
      return asset.info;
    }});
    testEvidence(data,filename);
    if (mode === 'production' && data.review?.status === 'approved' && data.status === 'active') releaseGate(data,filename);
    for (const [field,values] of [['id',data.id ? [data.id.toLowerCase()] : []],['slug',[data.slug]],['sourceKeys',data.sourceKeys ?? []]]) for (const raw of values) {
      const key=field === 'sourceKeys' && raw.startsWith('github:') ? raw.toLowerCase() : raw;
      if (registries[field].has(key)) fail(filename,field,`conflicts with ${registries[field].get(key)}`);
      registries[field].set(key,filename);
    }
    let complete=true;
    try { await validateCollection(data,`${data.id}.json`,rootDir,{validateLocalCover:async()=>asset.info}); } catch { complete=false; }
    records.push({document:data,file:filename,language:parsed.language,baseLanguage,directoryPresentations,curator,asset,complete,...publicData});
  }
  return records;
}
export async function loadCatalog({rootDir,mode='submission',baseDir} = {}) {
  if (typeof rootDir !== 'string') throw new Error('rootDir is required');
  if (!['submission','production','publish'].includes(mode)) throw new Error('mode must be submission or production');
  const records=await readCatalog(path.resolve(rootDir),mode === 'publish' ? 'production' : mode);
  if (baseDir) checkBase(records,await readCatalog(path.resolve(baseDir),'submission',{allowMissingCollections:true,allowHistoricalFlat:true}));
  return records;
}
export async function validateCatalog(options) {
  const records=await loadCatalog(options);
  return {records, count:records.length, incomplete:records.filter(r=>!r.complete).map(r=>r.file)};
}
function markdownText(value) { return value.replace(/[\[\]<>\r\n]/g,' ').replace(/\|/g,'\\|'); }
function directoryLine(record,language,rootDir) {
  const data=record.document;
  const display=record.directoryPresentations[language];
  const translated=typeof display?.title === 'string' && typeof display?.description === 'string';
  const label=translated ? display.title : data.slug;
  const description=translated ? ` — ${markdownText(display.description)}` : ` — ${language === 'en' ? 'Translation pending' : '待翻译'}`;
  const review=data.review?.status === 'approved' ? '' : language === 'en' ? ' (pending review)' : '（待审核）';
  const file=record.browseFiles?.[language] ?? Object.values(record.browseFiles ?? {})[0] ?? record.file;
  return `- [${markdownText(label)}](${path.relative(rootDir,file).split(path.sep).join("/")})${description}${review}`;
}
async function readmeUpdates(rootDir,records) {
  const updates=[];
  for (const [name,language] of [['README.md','en'],['README.zh.md','zh']]) {
    const filename=path.join(rootDir,name);
    let original;
    try {original=await readFile(filename,'utf8'); await contained(rootDir,filename,name,'README');}
    catch (error) {if (error.code !== 'ENOENT') throw error; if (language === 'zh') continue;}
    const source=original ?? '# Awesome Skills\n';
    const start=source.indexOf(START),end=source.indexOf(END);
    if ((start < 0) !== (end < 0) || (start >=0 && end < start) || source.indexOf(START,start+START.length) >= 0 || source.indexOf(END,end+END.length) >=0) throw new Error(`${name}: malformed catalog markers`);
    const lines=categories.flatMap((category,i)=>{
      const group=records.filter(r=>r.document.status !== 'archived' && r.document.category === category);
      return group.length ? [`### ${categoryLabels[language][i]}`,'',...group.map(record=>directoryLine(record,language,rootDir)),''] : [];
    });
    const block=`${START}\n${lines.join('\n')}\n${END}`;
    const updated=start <0 ? `${source.trimEnd()}\n\n${block}\n` : `${source.slice(0,start)}${block}${source.slice(end+END.length)}`;
    updates.push({filename,source:updated,existed:original !== undefined});
  }
  return updates;
}
async function replaceReadmes(updates) {
  try {
    for (const update of updates) {
      if (update.existed) {await rename(update.filename,update.backup); update.backedUp=true;}
      await rename(update.temporary,update.filename); update.installed=true;
    }
  } catch (error) {
    const failures=[];
    for (const update of [...updates].reverse()) {
      try {
        if (update.installed) await rm(update.filename,{force:true});
        if (update.backedUp) {await rename(update.backup,update.filename); update.backedUp=false;}
      } catch (rollback) {failures.push(`${update.filename}: ${rollback.message}; original retained at ${update.backup}`);}
    }
    if (failures.length) throw new Error(`${error.message}; README rollback failed: ${failures.join('; ')}`);
    throw error;
  }
}
async function replaceDirectory(staged,outputDir,commitAdditional) {
  const backup=`${staged}-previous`;
  let backedUp=false,installed=false,committed=false;
  try {
    try { await rename(outputDir,backup); backedUp=true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staged,outputDir); installed=true;
    await commitAdditional();
    committed=true;
  } catch (error) {
    if (installed) await rm(outputDir,{recursive:true,force:true});
    if (backedUp) {
      try { await rename(backup,outputDir); backedUp=false; }
      catch (rollback) { throw new Error(`Snapshot replacement failed: ${error.message}; original snapshot remains at ${backup}; rollback failed: ${rollback.message}`); }
    }
    throw error;
  } finally {
    if (committed && backedUp) await rm(backup,{recursive:true,force:true});
  }
}
async function safeOutputParent(parent,root) {
  const withinRepository=inside(root,parent);
  let existing=parent;
  for (;;) {
    try {
      const actual=await realpath(existing);
      if (withinRepository && !inside(root,actual)) throw new Error('outputDir symbolic link escapes the repository');
      return path.join(actual,path.relative(existing,parent));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const ancestor=path.dirname(existing);
      if (ancestor === existing) throw error;
      existing=ancestor;
    }
  }
}
export async function buildCatalog({rootDir,outputDir=path.join(rootDir,'dist/collections'),preview=false,baseDir,sourceRevision}={}) {
  if (sourceRevision !== undefined && !SHA.test(sourceRevision)) throw new Error('sourceRevision must be a full 40-character commit SHA');
  const all=await loadCatalog({rootDir,baseDir,mode:preview?'submission':'production'});
  const selected=all.filter(r=>r.complete && r.document.status === 'active' && (preview || r.document.review.status === 'approved')).sort((a,b)=>(a.document.sortOrder ?? 0)-(b.document.sortOrder ?? 0)||a.document.slug.localeCompare(b.document.slug));
  const records=selected.map(r=>r.document);
  const index={schemaVersion:1,collections:records.map(indexItem)};
  const readmes=await readmeUpdates(rootDir,all);
  outputDir=path.resolve(outputDir);
  const root=await realpath(rootDir),lexicalRoot=path.resolve(rootDir);
  if (inside(lexicalRoot,outputDir)) outputDir=path.join(root,path.relative(lexicalRoot,outputDir));
  const sources=[path.join(root,'collections'),path.join(root,'.catalog')];
  for (const source of [...sources]) {
    try {sources.push(await realpath(source));} catch(error) {if (error.code !== 'ENOENT') throw error;}
  }
  const protectSources=target=>{
    if (target === root || sources.some(source=>inside(target,source)||inside(source,target))) throw new Error('outputDir must not contain, overwrite or enter source collections or .catalog metadata');
  };
  protectSources(outputDir);
  try {protectSources(await realpath(outputDir));} catch(error) {if (error.code !== 'ENOENT') throw error;}
  const resolvedParent=await safeOutputParent(path.dirname(outputDir),root);
  protectSources(path.join(resolvedParent,path.basename(outputDir)));
  await mkdir(path.dirname(outputDir),{recursive:true});
  const parentReal=await realpath(path.dirname(outputDir));
  if (inside(root,path.dirname(outputDir)) && !inside(root,parentReal)) throw new Error('outputDir symbolic link escapes the repository');
  const staged=await mkdtemp(path.join(path.dirname(outputDir),'.catalog-'));
  for (const [index,readme] of readmes.entries()) {
    readme.temporary=path.join(root,`.catalog-readme-${path.basename(staged)}-${index}.tmp`);
    readme.backup=path.join(root,`.catalog-readme-${path.basename(staged)}-${index}.previous`);
  }
  let readmesCommitted=false;
  const files=[];
  async function add(filename,bytes) {
    safePath(filename,'manifest','path');
    await mkdir(path.dirname(path.join(staged,filename)),{recursive:true});
    await writeFile(path.join(staged,filename),bytes);
    files.push({path:filename,sha256:digest(bytes),size:Buffer.byteLength(bytes)});
  }
  try {
    for (const record of selected) {
      await add(`${record.document.id}.json`,JSON.stringify(record.document,null,2)+'\n');
      if (record.asset) await add(record.asset.path,record.asset.bytes);
    }
    await add('index.json',JSON.stringify(index,null,2)+'\n');
    const manifest={schemaVersion:1,preview,sourceRevision:sourceRevision ?? null,files:files.sort((a,b)=>a.path.localeCompare(b.path))};
    await writeFile(path.join(staged,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    for (const readme of readmes) await writeFile(readme.temporary,readme.source,{flag:'wx'});
    await replaceDirectory(staged,outputDir,async()=>{await replaceReadmes(readmes); readmesCommitted=true;});
    return {index,records,manifest,incomplete:all.filter(r=>!r.complete).map(r=>r.file),outputDir};
  } finally {
    await rm(staged,{recursive:true,force:true});
    for (const readme of readmes) {
      await rm(readme.temporary,{force:true});
      if (readmesCommitted && readme.backedUp) await rm(readme.backup,{force:true});
    }
  }
}
