import http from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([
  ['/tests/fixtures/payment-corrections.html', ['tests/fixtures/payment-corrections.html','text/html']],
  ['/js/payment-corrections.js', ['js/payment-corrections.js','text/javascript']],
  ['/css/payment-corrections.css', ['css/payment-corrections.css','text/css']],
  ['/css/style.css', ['css/style.css','text/css']]
]);
http.createServer(async(req,res)=>{
  const file=files.get(new URL(req.url,'http://127.0.0.1').pathname);
  if(!file){res.writeHead(404);res.end();return;}
  try { const data=await readFile(file[0]);res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store'});res.end(data); }
  catch {res.writeHead(500);res.end('Fixture unavailable');}
}).listen(8797,'127.0.0.1',()=>console.log('Isolated fixture: http://127.0.0.1:8797/tests/fixtures/payment-corrections.html'));
