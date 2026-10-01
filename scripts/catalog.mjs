#!/usr/bin/env node
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildCatalog, validateCatalog } from './lib/catalog.mjs';
import { serializeCollectionMarkdown } from './lib/markdown.mjs';

const help = `Usage: node scripts/catalog.mjs COMMAND [OPTIONS]

  validate [--publish] [--base-dir PATH]
    Check every submission; --publish also checks approved release readiness.
  build [--preview] [--output PATH] [--source-revision SHA] [--base-dir PATH]
    Export approved collections atomically; preview includes complete pending records.
  new SLUG [--lang en|zh]
    Create one pending draft with a permanent UUID. Replace source placeholders.

  --help  Show this help.

Markdown is the source of truth. A successful format check is not approval.
Preview snapshots cannot be synchronized to production.`;
function argumentsFor(argv) {
  const command=argv.shift();
  if (!command || command === '--help' || command === '-h') return {help:true};
  const allowed={validate:{'--publish':false,'--base-dir':true},build:{'--preview':false,'--output':true,'--source-revision':true,'--base-dir':true},new:{'--lang':true}}[command];
  if (!allowed) throw new Error(`Unknown command: ${command}\n${help}`);
  const options={},positionals=[];
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (arg === '--help' || arg === '-h') return {help:true};
    if (!arg.startsWith('-')) {positionals.push(arg);continue;}
    if (!(arg in allowed)) throw new Error(`Unknown option: ${arg}\n${help}`);
    if (arg in options) throw new Error(`Repeated option: ${arg}`);
    if (!allowed[arg]) options[arg]=true;
    else {
      const value=argv[++i];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
      options[arg]=value;
    }
  }
  if (command === 'new' && positionals.length !== 1 || command !== 'new' && positionals.length) throw new Error(`Unexpected arguments\n${help}`);
  return {command,options,slug:positionals[0]};
}
async function newCollection(rootDir,slug,language='zh') {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '')) throw new Error('SLUG must contain lowercase letters, digits and single hyphens');
  if (!['zh','en'].includes(language)) throw new Error('--lang must be en or zh');
  const directory=path.join(rootDir,'collections',slug);
  const now=new Date().toISOString();
  const zh=language==='zh';
  const document={
    schemaVersion:1,id:randomUUID(),slug,revision:1,createdAt:now,updatedAt:now,
    sourceKeys:[`editorial:${slug}`],status:'active',sourceKind:'editorial-selection',
    title:zh?'待完善的合集':'Draft collection',description:zh?'请说明这个合集解决的具体任务。':'Describe the specific task this collection addresses.',
    category:'other',tags:[],overview:zh?'请说明各个 Skill 的协作方式及选择依据。':'Explain how the Skills work together and why they were selected.',
    scenarios:[zh?'请填写具体场景':'Describe a specific scenario'],usage:zh?'请说明使用顺序、必要素材和人工判断。':'Describe usage order, prerequisites and decisions requiring human judgment.',
    provenance:{selectionReason:zh?'待完善：请说明搭配理由。':'Draft: explain the selection rationale.',evidence:[{id:'source-to-replace',kind:'repository',url:'https://example.com/replace-with-source',title:zh?'待替换的真实出处':'Replace with an actual source',publisher:zh?'待确认的来源发布者':'Publisher to verify',location:'README.md',finding:zh?'待完善：请核对出处后说明其支持的推荐依据。':'Draft: verify this source and describe what it supports.',supportsItemIds:['skill-to-replace']}]},
    review:{status:'pending',notes:[zh?'草稿：尚未核对来源、路径和安装信息。':'Draft: source, paths and installation information are not yet verified.']},
    cover:{kind:'concept',preset:'neutral',alt:zh?'合集概念封面':'Collection concept cover'},
    verification:{source:'needs-review',files:'needs-review',installation:'not-tested',workflow:'not-tested',notes:[]},
    skills:[{id:'skill-to-replace',name:'skill-to-replace',summary:zh?'待完善：请说明此 Skill 的作用及搭配理由。':'Draft: describe this Skill’s role and why it belongs in the collection.',entry:{repo:'owner/repository',entryPoint:'skills/skill-to-replace/SKILL.md'},installationMode:'skill',installationItems:[{name:'skill-to-replace',repo:'owner/repository',directory:'skills/skill-to-replace',entryPoint:'SKILL.md',license:{identifier:'NOASSERTION'}}],resourceCheck:'needs-review',resourceNotes:zh?'尚待核对目录资源与安装环境。':'Directory resources and installation environment have not been verified.'}],
  };
  const markdown=serializeCollectionMarkdown(document,{language});
  await mkdir(path.join(rootDir,'collections'),{recursive:true});
  if (await realpath(path.join(rootDir,'collections')) !== path.join(await realpath(rootDir),'collections')) throw new Error('collections directory must not be a symbolic link');
  await mkdir(directory);
  try { await writeFile(path.join(directory,'README.md'),markdown,{flag:'wx'}); }
  catch (error) { throw new Error(`Could not write draft: ${error.message}`); }
  console.log(`Created collections/${slug}/README.md (pending, permanent id ${document.id}). Replace placeholders and run validate.`);
}
async function main() {
  const args=argumentsFor(process.argv.slice(2));
  if (args.help) {console.log(help);return;}
  const rootDir=process.cwd(),o=args.options;
  if (args.command==='new') {await newCollection(rootDir,args.slug,o['--lang']);return;}
  if (args.command==='validate') {
    const result=await validateCatalog({rootDir,baseDir:o['--base-dir'],mode:o['--publish']?'production':'submission'});
    console.log(`Validated ${result.count} collections. ${result.incomplete.length} drafts need maintainer fields before export.`);
    return;
  }
  let sourceRevision=o['--source-revision'];
  if (sourceRevision === undefined) {
    try {sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:rootDir,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();} catch { /* API permits local snapshots without a Git revision. */ }
  }
  const result=await buildCatalog({rootDir,outputDir:o['--output'] ? path.resolve(rootDir,o['--output']) : undefined,preview:!!o['--preview'],baseDir:o['--base-dir'],sourceRevision});
  console.log(`Exported ${result.records.length} ${o['--preview']?'preview':'production'} collections to ${result.outputDir}. ${result.incomplete.length} incomplete drafts skipped.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
