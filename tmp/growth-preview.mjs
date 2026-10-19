import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const admin = (await readFile(new URL('js/admin.js', root), 'utf8')).replaceAll('\r\n', '\n');
const table = admin.slice(admin.indexOf('const {\n  modes: ADMIN_LIST_SORT_MODES'), admin.indexOf('function workspaceTableNodes('));
const history = admin.slice(admin.indexOf('function bindGrowingHistory('), admin.indexOf('async function loadDepartmentOperations('));
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/style.css"></head>
<body><main id="preview" style="padding:24px"><div class="workflow-intro"><h2>Synthetic Tuck Shop history test</h2></div><label>Unsaved form value<input id="draft" value="Keep this draft"></label></main>
<script src="/js/list-sorting.js"></script><script>
const panelEl=document.getElementById('preview'), activeSection='tuckShop', selectedBranchId='main', currentUser={branchId:'main'};
const clean=v=>String(v??'').trim(), escapeHtml=v=>clean(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pick=(r,keys)=>keys.map(k=>r[k]).find(v=>v!=null&&v!=='')??'';
const money=v=>'NGN '+Number(v).toFixed(2), DynamaxTime={formatCell:v=>String(v??'')};
const staffFetch=async (url,options)=>{const request=JSON.parse(options.body), page=request.cursor?.page||0;return {ok:true,json:async()=>({ok:true,rows:Array.from({length:page===2?4:6},(_,i)=>({__id:'REF-'+page+'-'+i,Date:'2026-10-16',ItemName:'Test Item '+(page*6+i),Quantity:i+1,Amount:(i+1)*100,Reason:'Synthetic record — '+request.historyKind})),nextCursor:page<2?{page:page+1}:null})}};
${table}
${history}
bindGrowingHistory('tuckShop','/api/mock',[['movements','Stock movements'],['purchases','Wallet purchases'],['sales','Sales']]);
</script></body></html>`;
http.createServer(async (req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(['/css/style.css','/js/list-sorting.js'].includes(req.url)){
    res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL(req.url.slice(1),root)));return;
  }
  res.writeHead(404);res.end();
}).listen(4179,'127.0.0.1',()=>console.log('Synthetic history preview: http://127.0.0.1:4179'));
