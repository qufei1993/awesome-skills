#!/usr/bin/env node
import { categories } from './lib/categories.mjs';
import { mkdir, realpath, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCatalog, validateCatalog } from './lib/catalog.mjs';
import { serializeContributionMarkdown } from './lib/contribution.mjs';

const help = `Usage: node scripts/catalog.mjs COMMAND [OPTIONS]

  validate [--publish] [--base-dir PATH]
    Check every submission; --publish also checks approved release readiness.
  build [--preview] [--output PATH] [--source-revision SHA] [--base-dir PATH]
    Export approved collections atomically; preview includes complete pending records.
  new SLUG [--lang en|zh] [--category CATEGORY]
    Create a short English submission by default. Replace the example Skill link before submitting a PR.

  --help  Show this help.

Markdown is the source of truth. A successful format check is not approval.
Preview snapshots cannot be synchronized to production.`;
function argumentsFor(argv) {
  const command=argv.shift();
  if (!command || command === '--help' || command === '-h') return {help:true};
  const allowed={validate:{'--publish':false,'--base-dir':true},build:{'--preview':false,'--output':true,'--source-revision':true,'--base-dir':true},new:{'--lang':true,'--category':true}}[command];
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
async function newCollection(rootDir,slug,language='en',category='other') {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '')) throw new Error('SLUG must contain lowercase letters, digits and single hyphens');
  if (!['zh','en'].includes(language)) throw new Error('--lang must be en or zh');
  if (!categories.includes(category)) throw new Error('--category must be a fixed category');
  const actualRoot=await realpath(rootDir);
  const collectionRoot=path.join(actualRoot,'collections');
  await mkdir(collectionRoot,{recursive:true});
  if (await realpath(collectionRoot) !== path.join(actualRoot,'collections')) throw new Error('collections directory must not be a symbolic link');
  for (const entry of await readdir(collectionRoot)) {
    const categoryPath=path.join(collectionRoot,entry);
    if (entry === slug) for (const filename of ['README.md','README.zh.md']) {
      try {await lstat(path.join(categoryPath,filename)); throw new Error('SLUG already exists');}
      catch(error) {if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error;}
    }
    if (!categories.includes(entry)) continue;
    if (await realpath(categoryPath) !== categoryPath) throw new Error('category directory must not be a symbolic link');
    try {await lstat(path.join(categoryPath,slug)); throw new Error('SLUG already exists in another category');} catch(error) {if (error.code !== 'ENOENT') throw error;}
  }
  const categoryDir=path.join(collectionRoot,category);
  await mkdir(categoryDir,{recursive:true});
  if (await realpath(categoryDir) !== categoryDir) throw new Error('category directory must not be a symbolic link');
  const directory=path.join(categoryDir,slug);
  const zh=language==='zh';
  const document={
    title:slug,description:zh?'请用一句话说明这个合集解决的任务。':'Describe the task this collection helps with in one sentence.',
    overview:zh?'请说明这些技能各自的作用，以及它们如何配合完成任务。':'Explain what the Skills do and how they work together to help with the task.',
    scenarios:[zh?'请填写一个适合使用这个合集的场景。':'Describe a situation where this collection is useful.'],
    usage:zh?'请说明如何选择和使用这些技能，以及建议的使用顺序。':'Explain how to choose and use the Skills, including a suggested sequence.',
    links:['https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md'],
  };
  const markdown=serializeContributionMarkdown(document,{language});
  await mkdir(path.join(rootDir,'collections'),{recursive:true});
  if (await realpath(path.join(rootDir,'collections')) !== path.join(actualRoot,'collections')) throw new Error('collections directory must not be a symbolic link');
  await mkdir(directory);
  const filename=zh ? 'README.zh.md' : 'README.md';
  try { await writeFile(path.join(directory,filename),markdown,{flag:'wx'}); }
  catch (error) { throw new Error(`Could not write draft: ${error.message}`); }
  console.log(zh ? `已创建 collections/${category}/${slug}/${filename}。替换示例链接后提交PR。` : `Created collections/${category}/${slug}/${filename}. Replace the example Skill link before submitting a PR.`);
}
async function main() {
  const args=argumentsFor(process.argv.slice(2));
  if (args.help) {console.log(help);return;}
  const rootDir=process.cwd(),o=args.options;
  if (args.command==='new') {await newCollection(rootDir,args.slug,o['--lang'],o['--category']);return;}
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
