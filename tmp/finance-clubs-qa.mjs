import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const paths = ['tests/fixtures/club-members.html', 'tests/fixtures/fee-collection-summary.html', 'js/club-members.js', 'js/fee-collection-summary.js', 'css/style.css', 'css/fee-collection-summary.css'];
const assets = new Map(await Promise.all(paths.map(async path => ['/' + path, await readFile(new URL('../' + path, import.meta.url))])));
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname, asset = assets.get(path);
  response.writeHead(asset ? 200 : 404, { 'Content-Type': path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store' });
  response.end(asset || 'Not found');
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/tests/fixtures/fee-collection-summary.html`));
