// In-memory test data only. This server has no live database credentials or writes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cardRefundFixture } from './card-refund-fixture.mjs';
const fixture = await cardRefundFixture();
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local card refund test — no live data</title><link rel="stylesheet" href="/css/vendor-settlements.css">
<style>body{font:15px Arial;background:#eef3f7;color:#143652;margin:24px}button{background:#1766db;color:white;border:0;border-radius:6px;padding:10px;cursor:pointer}button:disabled{opacity:.5}dialog{border:1px solid #ccd;border-radius:12px;color:#143652;max-height:92vh}dialog::backdrop{background:#1239}input,textarea{font:inherit}[hidden]{display:none!important}</style>
<h1>Local sample verification — no live data</h1><p>Test Accounts Officer password: test-only. No actual wallets or receipts are connected.</p><button id="open">Open card refund review</button><p id="outcome" role="status"></p>
<script type="module">import {openCardRefundBatch} from '/js/card-refund-batch.js';
window.DynamaxStaffActionFeedback={report:(message)=>document.querySelector('#outcome').textContent=message};
document.querySelector('#open').onclick=()=>openCardRefundBatch({vendorId:'${fixture.c.VendorId}',canPost:!location.search.includes('readonly'),isCurrent:()=>true,onClose:()=>{},
request:async(action,body,signal)=>{const r=await fetch('/api-fixture',{method:'POST',body:JSON.stringify({action,...body}),signal});const data=await r.json();if(!r.ok)throw new Error(data.message);return data;},
print:(title,html)=>{const w=window.open('','_blank');w.document.write('<h1>'+title+'</h1>'+html);w.document.close();}});</script></html>`;
createServer(async(req,res)=>{
  try {
    const path = new URL(req.url,'http://127.0.0.1').pathname;
    if(path==='/api-fixture' && req.method==='POST') {
      let raw=''; for await(const chunk of req) {raw+=chunk;if(raw.length>65536)throw new Error('Too large');}
      const {action,...body}=JSON.parse(raw); const result=await fixture.run(action,body);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    if(path==='/') {res.setHeader('Content-Type','text/html');res.end(page);return;}
    if(!['/js/card-refund-batch.js','/css/vendor-settlements.css'].includes(path)){res.statusCode=404;res.end();return;}
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(resolve('.'+path)));
  }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,message:error.message}));}
}).listen(8797,'127.0.0.1',()=>console.log('Local-only card refund fixture: http://127.0.0.1:8797'));
