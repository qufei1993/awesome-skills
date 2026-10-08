import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadSnapshot, installSnapshot, rollbackSnapshot } from './lib/snapshot.mjs';

function options(args) {
  const result={};
  for(let i=0;i<args.length;i++) {
    const name=args[i];
    if(!['--from','--target','--repo','--ref','--preview','--rollback'].includes(name) || name in result)throw new Error(`Unknown or duplicate option: ${name}`);
    if(['--preview','--rollback'].includes(name))result[name]=true;
    else {const value=args[++i];if(!value || value.startsWith('--'))throw new Error(`Missing value for ${name}`);result[name]=value;}
  }
  if(!result['--target'])throw new Error('Provide --target <website directory>');
  if(result['--rollback']) {if(result['--from'] || result['--repo'] || result['--ref'])throw new Error('--rollback cannot be combined with a source');}
  else if(result['--from']) {if(result['--repo'] || result['--ref'])throw new Error('Choose one local or remote snapshot source');}
  else if(!result['--repo'] || !result['--ref'] || result['--preview'])throw new Error('Provide --from, or --repo owner/repo --ref full SHA; remote preview is forbidden');
  return result;
}
let temporary;
try {
  const args=options(process.argv.slice(2)),targetDir=path.resolve(args['--target']);let result;
  if(args['--rollback'])result=await rollbackSnapshot({targetDir,allowPreview:!!args['--preview']});
  else {
    let fromDir=args['--from'];
    if(!fromDir) {
      const snapshot=await downloadSnapshot({repo:args['--repo'],ref:args['--ref']});
      temporary=await mkdtemp(path.join(os.tmpdir(),'awesome-skills-sync-'));
      for(const [filename,bytes] of snapshot.files){const target=path.join(temporary,filename);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
      fromDir=temporary;
    }
    result=await installSnapshot({fromDir:path.resolve(fromDir),targetDir,allowPreview:!!args['--preview'],expectedRevision:args['--ref']});
  }
  console.log(JSON.stringify({target:targetDir,...result}));
}catch(error){console.error(`Sync failed: ${error.message}`);process.exitCode=1;}
finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
