import path from 'node:path';
import { installSnapshot, rollbackSnapshot } from './lib/snapshot.mjs';

function options(args) {
  const result={};
  for(let i=0;i<args.length;i++) {
    const name=args[i];
    if(!['--from','--target','--preview','--rollback'].includes(name) || name in result)throw new Error(`Unknown or duplicate option: ${name}`);
    if(['--preview','--rollback'].includes(name))result[name]=true;
    else {const value=args[++i];if(!value || value.startsWith('--'))throw new Error(`Missing value for ${name}`);result[name]=value;}
  }
  if(!result['--target'])throw new Error('Provide --target <website directory>');
  if(result['--rollback']) {if(result['--from'])throw new Error('--rollback cannot be combined with a source');}
  else if(!result['--from'])throw new Error('Provide --from <local snapshot directory>');
  return result;
}
try {
  const args=options(process.argv.slice(2)),targetDir=path.resolve(args['--target']);
  const result=args['--rollback']
    ? await rollbackSnapshot({targetDir,allowPreview:!!args['--preview']})
    : await installSnapshot({fromDir:path.resolve(args['--from']),targetDir,allowPreview:!!args['--preview']});
  console.log(JSON.stringify({target:targetDir,...result}));
}catch(error){console.error(`Sync failed: ${error.message}`);process.exitCode=1;}
