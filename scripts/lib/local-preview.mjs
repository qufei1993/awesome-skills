import { watch as watchDirectory } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { buildCatalog } from './catalog.mjs';
import { buildStaticPublication, readCurrentSnapshot } from './publication.mjs';
import { startDataServer } from './data-server.mjs';

const print = line => process.stdout.write(`${line}\n`);

export async function startLocalPreview({ rootDir, siteDir, sitePort = 8775, dataPort = 8776, watch = true, sourceRevision, resolveSources = false, request, rankRecords, log = print }) {
  rootDir = path.resolve(rootDir);
  siteDir = path.resolve(siteDir);
  await access(path.join(siteDir, 'vite.config.ts'));
  const requireFromSite = createRequire(path.join(siteDir, 'package.json'));
  const vitePath = requireFromSite.resolve('vite');
  const { createServer } = await import(pathToFileURL(vitePath).href);
  if (!sourceRevision) sourceRevision = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: rootDir })).stdout.trim();
  const snapshotDir = path.join(rootDir, 'dist/local-snapshot');
  const dataDir = path.join(rootDir, 'dist/local-data');
  let dataServer, siteServer, lastPublication, closed = false, timer;
  let queue = Promise.resolve();
  const watchers = [];
  const notify = () => siteServer?.ws.send({ type: 'custom', event: 'collections:updated', data: { version: lastPublication.version } });
  function serialize(operation) {
    if (closed) return Promise.reject(new Error('Local preview is closed'));
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  function publish() {
    return serialize(async () => {
      const previousSnapshot = await readCurrentSnapshot({
        read: async key => {
          try { return await readFile(path.join(dataDir, key)); }
          catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        },
        allowPreview: true,
      });
      await buildCatalog({ rootDir, outputDir: snapshotDir, preview: true, sourceRevision, resolveSources, request, rankRecords });
      lastPublication = await buildStaticPublication({ fromDir: snapshotDir, outDir: dataDir, previousSnapshot, allowPreview: true });
      notify();
      log(`已更新 ${lastPublication.count} 个合集；发布数据包含 ${lastPublication.imageCount} 张本地图片。`);
      return lastPublication;
    });
  }
  async function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    await queue;
    await Promise.all([siteServer?.close(), dataServer?.close()]);
  }
  try {
    await publish();
    dataServer = await startDataServer({ directory: dataDir, port: dataPort });
    const variables = { VITE_COLLECTIONS_BASE_URL: dataServer.url, VITE_COLLECTIONS_ALLOW_PREVIEW: 'true' };
    const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, variables);
      siteServer = await createServer({ root: siteDir, cacheDir: path.join(rootDir,'dist/local-vite-cache'), configFile: path.join(siteDir, 'vite.config.ts'), mode: 'development', server: { host: '127.0.0.1', port: sitePort, strictPort: true }, logLevel: 'warn' });
      await siteServer.listen();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    if (watch) {
      const changed = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void publish().catch(error => log(`更新失败，保留上一次数据：${error.message}`));
        }, 350);
      };
      const watcher = watchDirectory(path.join(rootDir, 'collections'), { recursive: true }, changed);
      watcher.on('error', error => log(`文件监听失败：${error.message}`));
      watchers.push(watcher);
    }
    return {
      siteUrl: `http://127.0.0.1:${siteServer.httpServer.address().port}`,
      dataUrl: dataServer.url,
      publish, close,
      get lastPublication() { return lastPublication; },
    };
  } catch (error) { await close(); throw error; }
}
