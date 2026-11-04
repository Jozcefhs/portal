import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {stockFixture,stockOwner,actors,env,request,createHospitalService} from '../tests/helpers/hospital-stock-control-fixture.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-stock-disposal-ui');
await mkdir(output,{recursive:true});
const f=await stockFixture(),users={pharmacist:actors.pharmacist,owner:stockOwner,nurse:{...actors.doctor,role:'Nurse'}},calls=[];
await f.pharmacist.quarantineStock(request({BatchId:f.batch().BatchId,Revision:f.batch().__updateTime,Quantity:12,Reason:'Synthetic quarantine for browser verification'}));
let role='pharmacist',failBefore='',loseAfter='',expired=false;
const html=await readFile(resolve(root,'hospital.html'),'utf8');
const assets=new Set(['/hospital.html',...Array.from(html.matchAll(/(?:src|href)="(\/(?:js|css)\/[^"?]+)(?:[^" ]*)"/g),m=>m[1])]);
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;
  const user={...users[role],assignedBranchIds:['main','north'],activeBranchId:req.headers['x-dynamax-branch']||'main'};
  if(path==='/api/staff-session'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ok:true,authenticated:true,user,session:{id:'disposal-fixture',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}));return;
  }
  if(path==='/api/staff-hospital'){
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);calls.push(body);
    if(expired){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:'Synthetic session expired'}));return;}
    if(body.action===failBefore){failBefore='';throw Error('Synthetic connection failure before save');}
    const data=await createHospitalService(env,user,f.db)[body.action](body);
    if(body.action===loseAfter){loseAfter='';throw Error('Synthetic lost response after save');}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
  }
  if(!assets.has(path)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
  res.end(await readFile(resolve(root,'.'+path)));
}catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:error.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1366,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const done=async text=>{try{
    await page.locator('#status').filter({hasText:text}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  }catch(error){console.error(await page.locator('#status').textContent());await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error;}};
  const fill=async(form,data)=>{for(const [name,value]of Object.entries(data))await page.locator(`#${form} [name="${name}"]`).fill(String(value));};
  const submit=async form=>page.locator(`#${form} button:not([type=button])`).click();
  const count=action=>calls.filter(c=>c.action===action).length;
  const login=async(who,task='stock-disposal')=>{
    role=who;const before=calls.length;
    await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=${task}`);
    await done(task==='stock-disposal'&&who!=='nurse'?'Pending disposal queue loaded':'Hospital reception ready');
    assert.equal(calls.slice(before).filter(c=>['stockDisposalRegister','stockDisposalHistory','stockExpiryRegister'].includes(c.action)).length,0,'opening never loads completed history or expiry register');
  };
  const chooseBatch=async()=>{
    await fill('sdBatchesFilter',{fromDate:'2027-12-01',toDate:'2027-12-31'});await submit('sdBatchesFilter');await done('Selected batch expiry period loaded');
    await page.locator('[data-sd-batch]').click();await done('Quarantined batch selected');
  };
  const record=async(reference,quantity=1)=>{
    await chooseBatch();
    await fill('sdRecordForm',{Reference:reference,DisposedAt:'2026-10-26T13:00',Quantity:quantity,Method:'Synthetic witnessed disposal method',Reason:'Synthetic damaged stock evidence',Evidence:'Synthetic certificate '+reference});
    await page.locator('#sdRecordForm [name=Confirmed]').check();await submit('sdRecordForm');await done('Disposal evidence submitted');
  };
  const decision=async(value)=>{
    await page.locator('#sd'+value).click();
    await fill('sdReviewForm',{Reason:'Synthetic independent '+value+' evidence'});
    if(value==='Approve'){
      await fill('sdReviewForm',{Evidence:'Independent synthetic disposal certificate'});
      assert.equal(await page.locator('#sdReviewForm [name=Witnessed]').evaluate(e=>e.required),true);
      assert.equal(await page.locator('#sdReviewForm [name=Witnessed]').evaluate(e=>e.validity.valueMissing),true,'approval needs a physical witness confirmation');
      await page.locator('#sdReviewForm [name=Witnessed]').check();
    }else{
      assert.equal(await page.locator('#sdReviewEvidenceLabel').isVisible(),false);
      assert.equal(await page.locator('#sdReviewForm [name=Witnessed]').evaluate(e=>e.required),false);
    }
    await page.locator('#sdReviewForm [name=Confirmed]').check();
  };
  await login('pharmacist','stock-control');assert.equal(count('stockDisposalQueue'),0);
  await page.locator('[data-tab=stockDisposal]').click();await done('Pending disposal queue loaded');
  assert.match(await page.locator('#sdBatchesNote').textContent(),/Choose a batch/);
  assert.equal(f.queries.at(-1).limit,31);assert.equal(count('stockDisposalQueue'),1);
  await page.locator('[data-tab=stockControl]').click();await page.locator('[data-tab=stockDisposal]').click();await done('Pending disposal queue loaded');assert.equal(count('stockDisposalQueue'),1,'opening retained queue uses cache');
  await fill('sdBatchesFilter',{fromDate:'2027-12-01',toDate:'2027-12-31'});await submit('sdBatchesFilter');await done('Selected batch expiry period loaded');
  const batchReads=count('stockExpiryRegister');await submit('sdBatchesFilter');await done('Selected batch expiry period loaded');assert.equal(count('stockExpiryRegister'),batchReads);
  await page.locator('[data-sd-batch]').click();await done('Quarantined batch selected');
  await fill('sdRecordForm',{Reference:'DISP-UI-001',DisposedAt:'2026-10-26T13:00',Quantity:3,Method:'Synthetic witnessed method',Reason:'Synthetic physical damage',Evidence:'Synthetic certificate DISP-UI-001'});
  await page.locator('#sdRecordForm [name=Confirmed]').check();
  failBefore='submitStockDisposal';await submit('sdRecordForm');await done('Synthetic connection failure before save');
  assert.equal(await page.locator('#sdRecordForm [name=Quantity]').inputValue(),'3');assert.equal(f.rows('StockDisposals').length,0);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await page.locator('#sdRecordForm input').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().right<=innerWidth)));
  await page.screenshot({path:resolve(output,'evidence-mobile.png'),fullPage:true});
  loseAfter='submitStockDisposal';await submit('sdRecordForm');await done('Synthetic lost response after save');
  assert.equal(f.rows('StockDisposals').length,1);assert.equal(f.batch().Quarantined,12);assert.equal(await page.locator('#sdRecordForm [name=Evidence]').inputValue(),'Synthetic certificate DISP-UI-001');
  await submit('sdRecordForm');await done('Disposal evidence submitted');
  assert.equal(new Set(calls.filter(c=>c.action==='submitStockDisposal').map(c=>c.RequestId)).size,1,'unchanged retry retains request ID before and after lost response');
  assert.equal(f.rows('StockDisposals').length,1);assert.equal(await page.locator('#sdApprove').isVisible(),false);assert.equal(await page.locator('#sdReject').isVisible(),false);assert.equal(await page.locator('#sdCancel').isVisible(),true);
  await login('owner');await page.locator('#sdQueueRows [data-sd-disposal]').click();await done('Disposal evidence loaded');
  assert.equal(await page.locator('#sdApprove').isVisible(),true);assert.equal(await page.locator('#sdReject').isVisible(),true);assert.equal(await page.locator('#sdCancel').isVisible(),false);
  const reads=f.reads.length,queries=f.queries.length;
  await page.locator('#sdDetailPrint').click();assert.match(await page.locator('#sdPreviewBody').textContent(),/DISP-UI-001/);
  await page.evaluate(()=>window.print=()=>window.__printed=true);await page.locator('#sdPrint').click();assert.equal(await page.evaluate(()=>window.__printed),true);
  assert.equal(f.reads.length,reads);assert.equal(f.queries.length,queries,'preview and print use only loaded data');
  await decision('Approve');loseAfter='reviewStockDisposal';await submit('sdReviewForm');await done('Synthetic lost response after save');
  assert.equal(f.batch().Quarantined,9);assert.equal(f.batch().OnHand,8);assert.equal(await page.locator('#sdReviewForm [name=Evidence]').inputValue(),'Independent synthetic disposal certificate');
  await submit('sdReviewForm');await done('Disposal decision saved');
  assert.equal(new Set(calls.filter(c=>c.action==='reviewStockDisposal').map(c=>c.RequestId)).size,1);assert.equal(f.batch().Quarantined,9);assert.equal(f.rows('StockMovements').filter(r=>r.Type==='Witnessed quarantine disposal').length,1);
  assert.equal(await page.locator('#sdReviewForm').isVisible(),false);assert.match(await page.locator('#sdSummary').textContent(),/Approved/);
  assert.equal(await page.locator('#sdQueueRows').textContent(),'','write invalidates old queue snapshot');
  await fill('sdEventsFilter',{fromDate:'2026-10-26',toDate:'2026-10-26'});await submit('sdEventsFilter');await done('Selected disposal audit history loaded');assert.match(await page.locator('#sdEventsRows').textContent(),/Approve quarantined stock disposal/);
  await fill('sdRegisterFilter',{fromDate:'2026-10-26',toDate:'2026-10-26'});await submit('sdRegisterFilter');await done('Selected disposal period loaded');
  const registerReads=count('stockDisposalRegister');await submit('sdRegisterFilter');await done('Selected disposal period loaded');assert.equal(count('stockDisposalRegister'),registerReads);
  await page.setViewportSize({width:1366,height:960});await page.screenshot({path:resolve(output,'approved-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'approved-mobile.png'),fullPage:true});
  await login('pharmacist');await record('DISP-UI-CANCEL');await decision('Cancel');await submit('sdReviewForm');await done('Disposal decision saved');assert.equal(f.batch().Quarantined,9);assert.match(await page.locator('#sdSummary').textContent(),/Cancelled/);
  await record('DISP-UI-REJECT');await login('owner');await page.locator('#sdQueueRows [data-sd-disposal]').click();await done('Disposal evidence loaded');await decision('Reject');await submit('sdReviewForm');await done('Disposal decision saved');assert.equal(f.batch().Quarantined,9);assert.match(await page.locator('#sdSummary').textContent(),/Rejected/);
  await login('pharmacist');await record('DISP-UI-STALE');
  await f.pharmacist.quarantineStock(request({BatchId:f.batch().BatchId,Revision:f.batch().__updateTime,Quantity:1,Reason:'Synthetic concurrent stock change'}));
  await login('owner');await page.locator('#sdQueueRows [data-sd-disposal]').click();await done('Disposal evidence loaded');assert.equal(await page.locator('#sdStale').isVisible(),true);assert.equal(await page.locator('#sdApprove').isVisible(),false);assert.equal(await page.locator('#sdReject').isVisible(),true);
  await decision('Reject');await submit('sdReviewForm');await done('Disposal decision saved');
  const secondReviewer=createHospitalService(env,{...stockOwner,username:'second-independent-reviewer'},f.db);
  for(const refreshed of ['Register','Queue']){
    const reference='DISP-UI-EXTERNAL-'+refreshed;
    await login('pharmacist');await record(reference);await login('owner');
    await page.locator('#sdQueueRows [data-sd-disposal]').click();await done('Disposal evidence loaded');assert.equal(await page.locator('#sdApprove').isVisible(),true);
    await fill('sdRegisterFilter',{fromDate:'2026-10-26',toDate:'2026-10-26'});await submit('sdRegisterFilter');await done('Selected disposal period loaded');
    const row=f.rows('StockDisposals').find(r=>r.Reference===reference);
    await secondReviewer.reviewStockDisposal(request({DisposalId:row.DisposalId,Revision:row.__updateTime,Decision:'Approve',Reason:'Synthetic other officer decision',Evidence:'Synthetic second witness certificate',Confirmed:true,Witnessed:true}));
    await page.locator('#sd'+refreshed+'Refresh').click();await done(refreshed==='Register'?'Selected disposal period loaded':'Pending disposal queue loaded');
    await page.locator('#sdRegisterRows tr').filter({hasText:reference}).locator('[data-sd-disposal]').click();await done('Disposal evidence loaded');
    assert.match(await page.locator('#sdSummary').textContent(),/Approved/,'explicit '+refreshed+' refresh invalidates previously cached pending details');
    assert.equal(await page.locator('#sdApprove').isVisible(),false);
  }
  // Additional queue rows are synthetic read-only fixtures to exercise bounded paging.
  const sample=f.rows('StockDisposals')[0],collection=[...f.store.keys()].find(k=>k.endsWith('/'+sample.DisposalId)).replace(/\/[^/]+$/,'');
  const addRow=i=>{const id='paging-'+String(i).padStart(3,'0');f.store.set(collection+'/'+id,{...sample,DisposalId:id,__id:id,__updateTime:id,Reference:'Synthetic paging '+i,Status:'Pending'});};
  for(let i=0;i<31;i++)addRow(i);
  await page.locator('#sdQueueRefresh').click();await done('Pending disposal queue loaded');assert.equal(await page.locator('#sdQueueRows [data-sd-disposal]').count(),30);
  await page.locator('#sdQueueNext').click();await done('Pending disposal queue loaded');assert.equal(await page.locator('#sdQueueRows [data-sd-disposal]').count(),1);
  const queueReads=count('stockDisposalQueue');await page.locator('#sdQueuePrevious').click();await done('Pending disposal queue loaded');assert.equal(count('stockDisposalQueue'),queueReads);
  addRow(31);await page.locator('#sdQueueRefresh').click();await done('Pending disposal queue loaded');await page.locator('#sdQueueNext').click();await done('Pending disposal queue loaded');assert.equal(await page.locator('#sdQueueRows [data-sd-disposal]').count(),2,'refresh invalidates later cached pages');
  assert.ok(f.queries.filter(q=>q.path.endsWith('hospitalStockDisposals')).every(q=>q.limit===31));
  await page.locator('#branch').selectOption('north');await done('Branch changed');assert.equal(await page.locator('#sdSummary').textContent(),'');assert.equal(await page.locator('#sdDetail').isVisible(),false);assert.equal(await page.locator('#sdRegisterRows').textContent(),'');assert.match(await page.locator('#sdQueueRows').textContent(),/No disposals awaiting review/);
  await page.locator('#branch').selectOption('main');await done('Branch changed');assert.equal(await page.locator('#sdQueueRows [data-sd-disposal]').count(),30,'branch change reloads its own queue');
  expired=true;await page.locator('#sdQueueRefresh').click();await done('Synthetic session expired');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#sdQueueRows').textContent(),'');assert.equal(await page.locator('#sdSummary').textContent(),'');expired=false;
  await login('nurse');assert.equal(await page.locator('[data-tab=stockDisposal]').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,independentWitness:true,submitAndApprovalLostResponse:true,rejectAndCancel:true,staleApprovalBlocked:true,boundedQueue:true,refreshEvictsLaterPages:true,refreshEvictsStaleDetails:true,datedHistoryOnly:true,cacheReuse:true,previewWithoutReads:true,mobile:true,branchAndSessionCleared:true,liveRecordsChanged:false,calls:calls.length}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
