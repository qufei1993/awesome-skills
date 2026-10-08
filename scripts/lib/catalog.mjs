import { categories, categoryLabels } from './categories.mjs';
import { mkdir, mkdtemp, readFile, readdir, lstat, rename, rm, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseContributionMarkdown } from './contribution.mjs';
import { validateCollection, indexItem, externalCoverUrl } from './site-contract.mjs';
import { resolveSubmission, collectionId } from './upstream.mjs';
import { collectionInputs } from './generation-context.mjs';

const SHA = /^[a-f0-9]{40}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
    if (!previous.complete) continue;
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
function submissionPresentation({title,description,overview,scenarios,usage}) {
  return {title,description,overview,scenarios,usage};
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
async function submissionRecord(entry,file,source) {
  const contribution=parseContributionMarkdown(source,{filename:file});
  await contributionCover(entry.directory,contribution,file);
  const language=path.basename(file) === 'README.md' ? 'en' : 'zh';
  const directoryPresentations={[language]:submissionPresentation(contribution)};
  const browseFiles={[language]:file};
  const publicReadmes={[language]:contribution};
  for (const [name,translationLanguage] of [['README.md','en'],['README.zh.md','zh']]) {
    const translationFile=path.join(entry.directory,name);
    if (translationFile === file) continue;
    let translationSource;
    try {await contained(entry.directory,translationFile,translationFile,'translation'); translationSource=await readFile(translationFile,'utf8');}
    catch(error) {if (error.code === 'ENOENT') continue; throw error;}
    const translated=parseContributionMarkdown(translationSource,{filename:translationFile});
    matchingContributions(translated,contribution,translationFile);
    await contributionCover(entry.directory,translated,translationFile);
    directoryPresentations[translationLanguage]=submissionPresentation(translated);
    browseFiles[translationLanguage]=translationFile;
    publicReadmes[translationLanguage]=translated;
  }
  const document={slug:entry.name,category:entry.category,...directoryPresentations[language],status:'draft',skills:[],links:contribution.links};
  if (contribution.sourceUrl !== undefined) document.sourceUrl=contribution.sourceUrl;
  if (contribution.cover !== undefined) document.cover=contribution.cover;
  return {kind:'submission',document,file,directory:entry.directory,language,baseLanguage:language,directoryPresentations,browseFiles,publicReadmes,complete:false};
}
function applySubmissionPresentation(record, data) {
  const english=record.publicReadmes.en, chinese=record.publicReadmes.zh;
  if (english && chinese) {
    data.localizations={en:{...submissionPresentation(english),coverAlt:english.cover?.alt || english.title}};
    Object.assign(data,submissionPresentation(chinese));
    data.cover.alt=chinese.cover?.alt || chinese.title;
    return 'zh';
  }
  Object.assign(data,submissionPresentation(english ?? chinese));
  delete data.localizations;
  return record.language;
}
async function readCatalog(rootDir, mode, {allowMissingCollections=false,resolveSources=false,previousRecords=new Map(),previousAssetHashes=new Map(),reviewApproval,request,previousTrusted=false}={}) {
  const collectionDir=path.join(rootDir,'collections');
  let entries;
  try {entries=await readdir(collectionDir,{withFileTypes:true});}
  catch (error) {
    if (!allowMissingCollections || error.code !== 'ENOENT') throw error;
    await stat(rootDir);
    try {await lstat(collectionDir);} catch (missing) {if (missing.code === 'ENOENT') return []; throw missing;}
    throw error;
  }
  await contained(rootDir,collectionDir,collectionDir,'collections');
  const records=[],candidates=[];
  const registries={id:new Map(),slug:new Map(),sourceKeys:new Map()};
  for (const category of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if (category.name.startsWith('.')) continue;
    const categoryDir=path.join(collectionDir,category.name);
    if (!(await stat(categoryDir)).isDirectory()) continue;
    await contained(rootDir,categoryDir,category.name,'category');
    if (!categories.includes(category.name)) fail(categoryDir,'category','is unknown; use a fixed category directory');
    for (const name of ['README.md','README.zh.md']) {
      try {await lstat(path.join(categoryDir,name));fail(categoryDir,'category','requires a nested slug directory for each collection');}
      catch(error) {if (error.code !== 'ENOENT') throw error;}
    }
    for (const entry of await readdir(categoryDir,{withFileTypes:true})) {
      if (entry.name.startsWith('.')) continue;
      const directory=path.join(categoryDir,entry.name);
      if (!(await stat(directory)).isDirectory()) continue;
      candidates.push({name:entry.name,directory,category:category.name});
    }
  }
  for (const entry of candidates) {
    const directory=entry.directory;
    if (!SLUG.test(entry.name)) fail(entry.name,'directory','must be a lowercase slug');
    await contained(rootDir,directory,entry.name,'directory');
    const filename=await canonicalFile(directory);
    await contained(directory,filename,filename,'README');
    const record=await submissionRecord(entry,filename,await readFile(filename,'utf8'));
    if (registries.slug.has(entry.name)) fail(filename,'slug',`conflicts with ${registries.slug.get(entry.name)}`);
    registries.slug.set(entry.name,filename);
    if (!resolveSources) {records.push(record); continue;}
    const inputs=await collectionInputs({rootDir,directory,record});
    const previous=previousRecords.get(entry.name);
    const parsed=await resolveSubmission(record,{rootDir,...inputs,previous,request});
    const data=parsed.document;
    const baseLanguage=applySubmissionPresentation(record,data);
    if (data.slug !== entry.name || data.category !== entry.category) fail(filename,'identity','must match its collection directory');
    ownedFields(data,filename);
    sourcePaths(data,filename);
    const asset=await coverAsset(rootDir,directory,parsed,filename,record.publicReadmes);
    if (previous) {
      if (data.id !== previous.id || data.createdAt !== previous.createdAt) fail(filename,'identity','must preserve the existing identity and creation date');
      const changed=comparable(data) !== comparable(previous) || asset && previousAssetHashes.has(data.slug) && digest(asset.bytes) !== previousAssetHashes.get(data.slug);
      data.revision=previous.revision+(changed ? 1 : 0);
      data.updatedAt=changed
        ? new Date(Math.max(Date.parse(inputs.dates.updatedAt),Date.parse(previous.updatedAt)+1)).toISOString()
        : previous.updatedAt;
      data.review=changed || !previousTrusted ? {status:'pending',notes:[]} : structuredClone(previous.review);
      if (previous.review.status === 'rejected') data.review=structuredClone(previous.review);
    }
    if (reviewApproval && data.review.status !== 'rejected') data.review=structuredClone(reviewApproval);
    await validateCollection(data,`${data.id}.json`,rootDir,{validateLocalCover:async url=>{
      if (!asset || data.cover.url !== url) fail(filename,'cover.url','does not match validated archived cover');
      return asset.info;
    }});
    testEvidence(data,filename);
    if (mode === 'production' && data.review.status === 'approved' && data.status === 'active') releaseGate(data,filename);
    for (const [field,values] of [['id',[data.id.toLowerCase()]],['sourceKeys',data.sourceKeys]]) for (const raw of values) {
      const key=field === 'sourceKeys' && raw.startsWith('github:') ? raw.toLowerCase() : raw;
      if (registries[field].has(key)) fail(filename,field,`conflicts with ${registries[field].get(key)}`);
      registries[field].set(key,filename);
    }
    records.push({...record,kind:'resolved',document:data,baseLanguage,asset,curator:data.curator,complete:true,generated:true});
  }
  return records;
}
export async function loadCatalog({rootDir,mode='submission',baseDir,resolveSources=false,previousRecords,reviewApproval,request} = {}) {
  if (typeof rootDir !== 'string') throw new Error('rootDir is required');
  if (!['submission','production','publish'].includes(mode)) throw new Error('mode must be submission or production');
  const previousTrusted=previousRecords !== undefined;
  if (!previousRecords) {
    previousRecords=new Map();
    if (resolveSources && !baseDir) {
      try {
        const cached=JSON.parse(await readFile(path.join(rootDir,'dist/generated-catalog.json'),'utf8'));
        for (const document of cached) previousRecords.set(document.slug,document);
      } catch(error) {if (error.code !== 'ENOENT') throw error;}
    }
  }
  const generatedPrevious=new Map();
  for (const [slug,document] of previousRecords) if (SLUG.test(slug) && document?.slug === slug && document.id === collectionId(slug) && Array.isArray(document.sourceKeys) && document.sourceKeys.includes(`collection:${slug}`) && document.sourceKeys.some(key=>/^readme:[a-f0-9]{64}$/.test(key))) generatedPrevious.set(slug,document);
  generatedPrevious.assetHashes=new Map([...(previousRecords.assetHashes ?? [])].filter(([slug])=>generatedPrevious.has(slug)));
  previousRecords=generatedPrevious;
  const options={resolveSources,previousRecords,previousAssetHashes:previousRecords.assetHashes ?? new Map(),reviewApproval,request,previousTrusted};
  let base;
  if (baseDir) {
    base=await readCatalog(path.resolve(baseDir),'submission',{...options,reviewApproval:undefined,allowMissingCollections:true});
    if (resolveSources) for (const record of base) if (record.complete) {
      previousRecords.set(record.document.slug,record.document);
      if (record.asset) options.previousAssetHashes.set(record.document.slug,digest(record.asset.bytes));
    }
  }
  const records=await readCatalog(path.resolve(rootDir),mode === 'publish' ? 'production' : mode,options);
  if (base) checkBase(records,base);
  if (resolveSources) {
    await mkdir(path.join(rootDir,'dist'),{recursive:true});
    const state=path.join(rootDir,'dist/generated-catalog.json');
    await writeFile(`${state}.tmp`,JSON.stringify(records.filter(r=>r.generated).map(r=>r.document),null,2)+'\n');
    await rename(`${state}.tmp`,state);
  }
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
export async function buildCatalog({rootDir,outputDir=path.join(rootDir,'dist/collections'),preview=false,baseDir,sourceRevision,resolveSources=false,previousRecords,reviewApproval,request}={}) {
  if (sourceRevision !== undefined && !SHA.test(sourceRevision)) throw new Error('sourceRevision must be a full 40-character commit SHA');
  const all=await loadCatalog({rootDir,baseDir,mode:preview?'submission':'production',resolveSources,previousRecords,reviewApproval,request});
  const selected=all.filter(r=>r.complete && r.document.status === 'active' && (preview || r.document.review.status === 'approved')).sort((a,b)=>(a.document.sortOrder ?? 0)-(b.document.sortOrder ?? 0)||a.document.slug.localeCompare(b.document.slug));
  const records=selected.map(r=>r.document);
  const index={schemaVersion:1,collections:records.map(indexItem)};
  const readmes=await readmeUpdates(rootDir,all);
  outputDir=path.resolve(outputDir);
  const root=await realpath(rootDir),lexicalRoot=path.resolve(rootDir);
  if (inside(lexicalRoot,outputDir)) outputDir=path.join(root,path.relative(lexicalRoot,outputDir));
  const sources=[path.join(root,'collections')];
  for (const source of [...sources]) {
    try {sources.push(await realpath(source));} catch(error) {if (error.code !== 'ENOENT') throw error;}
  }
  const protectSources=target=>{
    if (target === root || sources.some(source=>inside(target,source)||inside(source,target))) throw new Error('outputDir must not contain, overwrite or enter source collections');
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
