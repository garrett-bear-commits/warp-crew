// Serves the iframe host harness on a DIFFERENT origin (port 4174) so the game runs cross-site.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'index.html'));
const port = Number(process.env.E2E_HOST_PORT ?? 4174);
createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}).listen(port, '127.0.0.1', () => console.log(`E2E_HOST_READY port=${port}`));
