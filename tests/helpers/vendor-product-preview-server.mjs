/* Local-only browser fixture. No database, credentials, payments or live requests. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as rules from '../../functions/lib/vendor-settlement-rules.js';
import { handleProductImport } from '../../functions/lib/vendor-product-import.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scope = {ScopeKey:'school--main',BranchId:'main',OrganisationEdition:'school',SchoolSection:'Secondary'};
const user = {username:'fixture',role:'Accounts Officer',branchId:'main',edition:'school',schoolSectionAccess:'All',allowedSections:['vendorSettlements']};
const store = new Map(); let version = 0;
const put = (c,id,row) => store.set(`${c}/${id}`,{...structuredClone(row),__id:id,__updateTime:`r${++version}`});
const get = (c,id) => structuredClone(store.get(`${c}/${id}`) || null);
const list = c => [...store.entries()].filter(([key])=>key.startsWith(`${c}/`)).map(([,row])=>structuredClone(row));
put('commerceVendors','fixture-vendor',{...scope,VendorId:'fixture-vendor',Name:'Sample vendor',Active:'YES',RuleHistory:[]});
for (let i=1;i<=21;i++) put('tuckShopInventory',`fixture-stock-${i}`,{...scope,ItemCode:`ITEM-${i}`,ItemName:i === 1 ? 'Bottled water' : `Sample product ${i}`,
  Quantity:40+i,Price:150,SalePrice:150,Category:'Drinks',Unit:'bottle',Active:'YES',VendorId:''});
const source = (await readFile(new URL('../../functions/lib/vendor-settlements.js',import.meta.url),'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm,'').replace(/export /g,'');
const {handleVendorSettlementAction} = vm.runInNewContext(`${source}\n({handleVendorSettlementAction})`,{...rules,handleProductImport,
  crypto:webcrypto,Intl,Date,TextEncoder,console,
  getDocument:async (_env,c,id)=>get(c,id),listCollection:async (_env,c)=>list(c),getAccountingChartRows:async()=>[],
  queryCollectionPages:async (_env,c,o)=>list(c).filter(row=>o.filters.every(f=>f.op==='in' ? f.value.includes(row[f.field]) : row[f.field]===f.value)),
  accountingChartChoicesForEdition:()=>[],batchCommitDocuments:async (_env,writes)=>{
    for (const w of writes) { const previous=get(w.collectionPath,w.documentId);
      if(w.exists === false && previous || w.updateTime && previous?.__updateTime !== w.updateTime) throw Object.assign(new Error('Conflict'),{status:409}); }
    for(const w of writes) put(w.collectionPath,w.documentId,w.data);
  }});
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vendor ownership — local sample verification</title><link rel="stylesheet" href="/css/vendor-settlements.css">
<style>body{margin:0;background:#f0f5fa;font:15px Arial;color:#143652}main{max-width:1150px;margin:20px auto;padding:16px}button{background:#1668e8;color:#fff;border:0;border-radius:7px;padding:10px 15px;cursor:pointer}button:disabled{opacity:.5;cursor:default}h1{font-size:21px}dialog{color:#143652}#fixture-status{font-size:12px;color:#537089}</style></head>
<body><main><h1>Local sample verification · no live data</h1><p id="fixture-status">No import requests yet.</p><div id="vendors"></div></main>
<script src="/js/vendor-settlements.js"></script><script>
const log=document.querySelector('#fixture-status');
DynamaxVendors.mount(document.querySelector('#vendors'),async(action,body,signal)=>{
const response=await fetch('/fixture-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body}),signal});
const result=await response.json();if(!response.ok)throw new Error(result.message);
if(action==='importProducts')log.textContent='Sample import recorded: '+result.assigned+' owner assignments; stock unchanged.';
return result;});</script></body></html>`;
let interrupt = true;
createServer(async(req,res)=>{
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if(path === '/fixture-api' && req.method==='POST') {
      let bytes='';for await (const part of req) {bytes+=part;if(bytes.length>65536)throw new Error('Payload too large');}
      const body=JSON.parse(bytes);
      const result=await handleVendorSettlementAction({},user,body);
      // Simulate a lost response after the first successful second batch. Retry must replay.
      if(body.action==='importProducts' && body.Rows[0]?.InventoryId==='fixture-stock-21' && interrupt) {
        interrupt=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Sample lost response; safe retry required.'}));return;
      }
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
    }
    if(path==='/') {res.writeHead(200,{'Content-Type':'text/html'});res.end(page);return;}
    if(!/^\/(?:js|css)\/[a-z0-9-]+\.(?:js|css)$/.test(path)) {res.writeHead(404);res.end();return;}
    const file=resolve(root,`.${path}`);
    res.writeHead(200,{'Content-Type':extname(file)==='.js'?'text/javascript':'text/css'});res.end(await readFile(file));
  } catch(error) {res.writeHead(Number(error.status)||400,{'Content-Type':'application/json'});res.end(JSON.stringify({message:error.message}));}
}).listen(8793,'127.0.0.1',()=>console.log('Local vendor fixture: http://127.0.0.1:8793'));
