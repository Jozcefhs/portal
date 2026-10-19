// Isolated browser fixture using production rendering/binding code and sample
// data only. It cannot call production APIs or submit a sale.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/css/style.css'||path==='/css/app-dialogs.css'||path==='/js/display-time.js') {
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');
    res.end(await readFile(new URL(path.slice(1),root)));return;
  }
  if(path==='/') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<title>Tuck shop mobile lookup test</title><iframe title="Phone preview" src="/phone" style="width:390px;height:820px;border:0"></iframe>');return;
  }
  if(path!=='/phone'){res.writeHead(404);res.end();return;}
  const admin=await readFile(new URL('js/admin.js',root),'utf8');
  const renderer=admin.slice(admin.indexOf('function tuckShopLookupIcon('),admin.indexOf('async function searchTuckShopCustomer('));
  const helpers=admin.slice(admin.indexOf('function showTuckShopStudentMatches('),admin.indexOf('function renderDepartmentOperations('));
  const submit=admin.slice(admin.indexOf("document.getElementById('walletLookupForm')?.addEventListener('submit'"),admin.indexOf("document.getElementById('tuckShopFaceLookup')?.addEventListener"));
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><style>body{margin:0;padding:6px}#status:empty{display:none}.commerce-catalog,.tuck-shop-mobile-history,.tuck-shop-desktop-history{display:none!important}.commerce-pos-layout{display:block}</style></head><body><h3>Mobile student lookup · sample data</h3><p id="status" role="status"></p><main id="root"></main><script src="/js/display-time.js"></script><script>
const clean=v=>String(v??'').trim(),escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=v=>'₦'+Number(v||0).toLocaleString();
let tuckShopCustomerType='Student',tuckShopCustomerSearch='',tuckShopWalletAccount=null,tuckShopStaffCustomer=null,tuckShopLastSale=null,tuckShopCatalogSearch='',tuckShopSaleRequestId='';
const cart=new Map(),commerceCart=()=>cart,commerceItemPrice=()=>0,commerceItemStock=()=>0,commerceItemReference=()=>'',commerceQuantityOptions=()=>'',commerceReceiptPreview=()=>'',table=()=>'';
const sample=[{CustomerRef:'DCA/25/2024',CustomerName:'Sample Ada',Detail:'Grade 7',card:'CARD-0001'},{CustomerRef:'DCA/25/2025',CustomerName:'Sample Bola',Detail:'Grade 8',card:'CARD-0002'}];
const key=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
async function searchTuckShopCustomer(type,query){return sample.filter(row=>[row.CustomerRef,row.CustomerName,row.card].some(value=>key(value).includes(key(query))));}
async function requestDepartmentAction(section,action,payload){if(action!=='lookupWallet')throw new Error('Sales disabled in this fixture');await new Promise(resolve=>setTimeout(resolve,150));const row=sample.find(row=>key(row.CustomerRef)===key(payload.AccountRef)||payload.WalletCardId&&key(row.card)===key(payload.WalletCardId));if(!row)throw Object.assign(new Error('No exact wallet found'),{status:404});return {ok:true,inventory:[],sales:[],walletAccount:{AccountRef:row.CustomerRef,DisplayName:row.CustomerName,ClassName:row.Detail,WalletBalance:2500,WalletSpentToday:0}};}
const setStatus=(el,text)=>{if(el)el.textContent=text;document.getElementById('status').textContent=text;};
async function runButtonAction(button,label,fn){if(button.disabled)return;button.disabled=true;try{return await fn();}finally{button.disabled=false;}}
${renderer}
${helpers}
function renderDepartmentOperations(section,data){document.getElementById('root').innerHTML=renderTuckShopPOS(data);bindTuckShopPOS(data);${submit}}
renderDepartmentOperations('tuckShop',{inventory:[],sales:[]});
</script></body></html>`);
}).listen(8770,'127.0.0.1',()=>console.log('Sample-only mobile lookup: http://127.0.0.1:8770/'));
