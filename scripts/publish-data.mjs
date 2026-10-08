import path from 'node:path';
import { createLocalStore, createR2Store, publishSnapshot, rollbackPublication } from './lib/publication.mjs';

function options(args) {
  const command = args.shift(), result = {};
  if (!['publish', 'rollback'].includes(command)) throw new Error('Choose publish or rollback');
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (!['--from', '--to', '--version', '--preview', '--r2', '--test-destination'].includes(name) || name in result) throw new Error(`Unknown or duplicate option: ${name}`);
    if (['--preview', '--r2', '--test-destination'].includes(name)) result[name] = true;
    else { const value = args[++index]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`); result[name] = value; }
  }
  if (!!result['--to'] === !!result['--r2']) throw new Error('Choose one --to directory or --r2 destination');
  if (result['--test-destination'] && !result['--r2']) throw new Error('--test-destination requires --r2');
  if (result['--r2'] && result['--preview'] && !result['--test-destination']) throw new Error('R2 preview requires an explicit --test-destination');
  if (command === 'publish' ? (!result['--from'] || result['--version']) : (!result['--version'] || result['--from'])) throw new Error(command === 'publish' ? 'Provide --from for publication' : 'Provide --version for rollback');
  return { command, ...result };
}
try {
  const args = options(process.argv.slice(2));
  const store = args['--r2'] ? await createR2Store({ accountId:process.env.CATALOG_R2_ACCOUNT_ID, bucket:process.env.CATALOG_R2_BUCKET, accessKeyId:process.env.CATALOG_R2_ACCESS_KEY_ID, secretAccessKey:process.env.CATALOG_R2_SECRET_ACCESS_KEY }) : await createLocalStore(path.resolve(args['--to']));
  const result = args.command === 'publish'
    ? await publishSnapshot({ fromDir:path.resolve(args['--from']), store, allowPreview:!!args['--preview'] })
    : await rollbackPublication({ store, version:args['--version'], allowPreview:!!args['--preview'] });
  console.log(JSON.stringify(result));
} catch (error) { console.error(`Publication failed: ${error.message}`); process.exitCode = 1; }
