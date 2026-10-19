import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic correction review QA</title><link rel="stylesheet" href="/css/style.css"></head><body>
<main style="padding:24px"><h2>Synthetic billing test — no live data or financial writes</h2><button id="start">Review obsolete textbook / yearbook charges</button><p id="attempts">Posting attempts: 0</p></main>
<dialog id="studentBillingPreviewDialog" class="workflow-dialog student-profile-dialog"><div class="workflow-dialog-header"><div><small>Reviewed finance correction</small><h2>Textbook / yearbook charges</h2></div><button type="button" id="close" aria-label="Close billing preview">×</button></div><div class="config-group" id="content"></div></dialog>
<script src="/js/app-dialogs.js"></script><script type="module">
import {openObsoleteChargeReview} from '/js/obsolete-charge-review.js';
const dialog=document.getElementById('studentBillingPreviewDialog'), content=document.getElementById('content');
let attempts=0;
const plan={ok:true,readOnly:true,candidateOnly:false,ready:true,previewToken:'a'.repeat(64),amount:128030,releasedCredit:128030,outstandingRemoved:0,postedTotal:1616915,afterPostedTotal:1488885,expectedTotal:1488885,
profile:{AccountRef:'TEST/26/001',DisplayName:'Sample student',ClassName:'Grade 8',SchoolSection:'secondary',AcademicSession:'2026/2027',Term:'First Term'},
charges:[{code:'TXT_OLD',name:'Textbooks (All Subjects)',invoiceId:'TEST-INV-TEXTBOOK',amount:118030},{code:'LEG',name:'Legacy Magazine/Yearbook',invoiceId:'TEST-INV-YEARBOOK',amount:10000}]};
const blocked={profile:{AccountRef:'TEST/26/002',DisplayName:'Changed profile'},ready:false,reason:'Profile changed; recheck required.'};
async function request(body){
if(body.action==='obsoleteRoster')return{ok:true,total:2,rows:[blocked],pendingProfiles:[{AccountRef:'TEST/26/001',revision:'v1'}],configurationToken:'config'};
if(body.action==='obsoleteBatch')return{ok:true,checked:1,matched:0,rows:[{...plan,candidateOnly:true,previewToken:''}]};
if(body.action==='previewObsoleteReversal')return plan;
if(body.action==='applyObsoleteReversal'){document.getElementById('attempts').textContent='Posting attempts: '+ ++attempts;return{ok:true,message:'Synthetic correction confirmed. Original payments and receipts preserved.',summary:{TotalDebit:1488885,CreditBalance:14000,OutstandingBalance:0}};}
throw Error('Unexpected test request');}
document.getElementById('close').onclick=()=>dialog.close();
document.getElementById('start').onclick=()=>openObsoleteChargeReview({dialog,content,request,isCurrent:()=>dialog.open,confirm:options=>DynamaxDialogs.confirm(options),notify:(title,message,tone)=>DynamaxDialogs.alert({title,message,tone:tone==='error'?'danger':'success',confirmText:'Close'})});
</script></body></html>`;
http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 if(['/css/style.css','/js/app-dialogs.js','/js/obsolete-charge-review.js','/js/boarding-wear-bulk.js'].includes(path)){
   res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL(path.slice(1),root)));return;
 }
 res.writeHead(404);res.end();
}).listen(4181,'127.0.0.1',()=>console.log('Synthetic review preview: http://127.0.0.1:4181'));
