import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const files=new Map([
  ['/preview',new URL('./procurement-picker-preview.html',import.meta.url)],
  ['/js/procurement.js',new URL('../js/procurement.js',import.meta.url)],
  ['/css/procurement.css',new URL('../css/procurement.css',import.meta.url)],
  ['/css/style.css',new URL('../css/style.css',import.meta.url)]
]);
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&path==='/mobile'){
    res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
    res.end('<!doctype html><title>Mobile checklist preview</title><body style="margin:0;background:#dde8eb"><iframe title="Mobile preview" src="/preview" style="width:390px;height:780px;border:0;display:block;margin:12px auto"></iframe></body>');return;
  }
  if(req.method!=='GET'||!files.has(path)){res.writeHead(404);res.end();return;}
  try{const data=await readFile(files.get(path));res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(500);res.end('Preview unavailable');}
}).listen(8767,'127.0.0.1',()=>console.log('Local synthetic preview: http://127.0.0.1:8767/preview'));
