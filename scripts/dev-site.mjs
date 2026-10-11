import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalPreview } from './lib/local-preview.mjs';
import { rankCollections } from './lib/repository-ranking.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const options = { rootDir, siteDir: path.resolve(rootDir, '../skills-hub-web'), resolveSources: true, rankRecords: records => rankCollections(records, { rootDir }) };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (flag === '--no-watch') { options.watch = false; continue; }
  if (!['--site', '--port', '--data-port'].includes(flag) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: npm run dev:site -- [--site PATH] [--port 8775] [--data-port 8776] [--no-watch]');
  const value = args[++index];
  if (flag === '--site') options.siteDir = path.resolve(value);
  else {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535');
    options[flag === '--port' ? 'sitePort' : 'dataPort'] = port;
  }
}
const preview = await startLocalPreview(options);
process.stdout.write(`官网预览：${preview.siteUrl}/collections\n数据地址：${preview.dataUrl}/current.json\n${options.watch === false ? '自动监听已关闭。' : '修改 collections 后会自动发布本地数据并更新预览。'}\n`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await preview.close();
  process.exitCode = 0;
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
