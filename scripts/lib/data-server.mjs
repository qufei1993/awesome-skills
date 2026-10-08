import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const hash = '[a-f0-9]{64}';
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const publishedPath = new RegExp(`^(?:current\\.json|images/${hash}\\.(?:png|jpg|webp|gif)|snapshots/${hash}/(?:index|manifest|release|${uuid})\\.json)$`);
const types = { '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export async function startDataServer({ directory, port = 8776, host = '127.0.0.1' }) {
  const root = await realpath(directory);
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = status => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: status }));
    };
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD, OPTIONS'); fail(405); return; }
    let relative;
    try { relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1); }
    catch { fail(400); return; }
    if (!publishedPath.test(relative)) { fail(404); return; }
    try {
      const file = await realpath(path.join(root, relative));
      if (!file.startsWith(`${root}${path.sep}`)) { fail(404); return; }
      const info = await stat(file);
      if (!info.isFile()) { fail(404); return; }
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)],
        'Content-Length': info.size,
        'Cache-Control': relative === 'current.json' ? 'no-store' : 'public, max-age=31536000, immutable',
      });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) { fail(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
