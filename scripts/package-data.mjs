import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { buildStaticPublication } from './lib/publication.mjs';
import { loadPublishedSnapshot } from './lib/generation-context.mjs';

try {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++) {
    const name=args[i];
    if(!['--from','--output','--preview'].includes(name) || name in options)throw new Error(`Unknown or duplicate option: ${name}`);
    if(name==='--preview')options[name]=true;
    else {const value=args[++i];if(!value || value.startsWith('--'))throw new Error(`Missing value for ${name}`);options[name]=value;}
  }
  if(!options['--from'] || !options['--output'])throw new Error('Provide --from snapshot and --output assets directory');
  const previousSnapshot=process.env.CATALOG_DATA_BASE_URL
    ? await loadPublishedSnapshot({rootDir:process.cwd(),baseUrl:process.env.CATALOG_DATA_BASE_URL}) : null;
  const result=await buildStaticPublication({fromDir:path.resolve(options['--from']),outDir:path.resolve(options['--output']),previousSnapshot,allowPreview:!!options['--preview']});
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`changed=${!result.unchanged}\n`);
  console.log(JSON.stringify(result));
} catch(error) {console.error(`Packaging failed: ${error.message}`);process.exitCode=1;}
