// Synthetic UI only: deliberately expose no workspace files or real API routes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const routes = {
  '/': '../tests/fixtures/admission-cycle.html',
  '/js/admission-cycles.js': '../js/admission-cycles.js',
  '/css/admission-cycles.css': '../css/admission-cycles.css'
};
const server = createServer(async (request, response) => {
  const file = Object.hasOwn(routes, request.url) ? routes[request.url] : '';
  if (!file) { response.writeHead(404); response.end(); return; }
  try {
    const bytes = await readFile(new URL(file, import.meta.url));
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.setHeader('Cache-Control', 'no-store');
    response.end(bytes);
  } catch { response.writeHead(500); response.end('Preview unavailable'); }
});
server.listen(8878, '127.0.0.1', () => console.log('Synthetic admission preview: http://127.0.0.1:8878/'));
