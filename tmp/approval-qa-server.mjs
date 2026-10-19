import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const paths = ['tests/fixtures/approval-settings.html','js/requisition-approval-settings.js','js/vendor-settlements.js','js/display-time.js','functions/lib/vendor-request-print.js','css/style.css','css/vendor-settlements.css'];
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!paths.includes(path)){res.writeHead(404);res.end();return;}
  const asset=await readFile(new URL('../'+path,import.meta.url));
  res.writeHead(200,{'Content-Type':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});res.end(asset);
});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/tests/fixtures/approval-settings.html`));
