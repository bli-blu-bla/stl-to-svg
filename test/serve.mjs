// Serves dist/ under a sub-path, mimicking a GitHub Pages project site.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const port = Number(process.argv[2] || 4178);
const basePath = (process.argv[3] || '').replace(/\/$/, '');
const root = new URL('../dist/', import.meta.url).pathname;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
  if (path === '' || path === '/') path = '/index.html';

  // Contain the path so `..` cannot escape dist/.
  const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving dist/ at http://127.0.0.1:${port}${basePath}/`);
});
