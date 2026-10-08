import { fileURLToPath } from 'node:url';
import { deployData } from './lib/deployment.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
try {
  const result=await deployData({rootDir:root,args:process.argv.slice(2)});
  if(result.url)console.log(`Collection data published: ${result.url}`);
}catch(error){console.error(`Deployment failed: ${error.message}`);process.exitCode=1;}
