/* Isolated local preview: only fixture and public POS assets; no API or credentials. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const files = new Map([
  ['/tests/fixtures/vendor-pos.html',new URL('../fixtures/vendor-pos.html',import.meta.url)],
  ['/css/style.css',new URL('../../css/style.css',import.meta.url)],
  ['/css/vendor-settlements.css',new URL('../../css/vendor-settlements.css',import.meta.url)],
  ['/js/vendor-pos.js',new URL('../../js/vendor-pos.js',import.meta.url)]
]);
createServer(async(req,res) => {
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (req.method !== 'GET' || !files.has(path)) {res.writeHead(404);res.end();return;}
    const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store'});
    res.end(await readFile(files.get(path)));
  } catch {res.writeHead(500);res.end('Fixture unavailable.');}
}).listen(8768,'127.0.0.1',() => console.log('Local POS fixture: http://127.0.0.1:8768/tests/fixtures/vendor-pos.html'));
