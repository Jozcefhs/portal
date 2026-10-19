import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const files = new Map([
  ['/tests/fixtures/club-members.html', 'text/html'],
  ['/css/style.css', 'text/css'],
  ['/css/fee-collection-summary.css', 'text/css'],
  ['/js/club-members.js', 'text/javascript']
]);
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (!files.has(path)) { res.writeHead(404); res.end(); return; }
  try {
    const bytes = await readFile(new URL(path.slice(1), root));
    res.writeHead(200, { 'Content-Type': files.get(path), 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(500); res.end('Fixture unavailable'); }
}).listen(9037, '127.0.0.1', () => console.log('Synthetic club register preview at http://127.0.0.1:9037/tests/fixtures/club-members.html'));
