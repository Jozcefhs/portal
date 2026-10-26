import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {ordersFixture,actors,medicine,rx} from '../tests/helpers/hospital-orders-fixture.mjs';
import {env} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-orders-ui');await mkdir(output,{recursive:true});
const f=await ordersFixture();let role='doctor',expire=false;
const assets=new Set(['/hospital.html','/css/hospital.css','/css/app-dialogs.css','/js/hospital.js','/js/hospital-clinical.js','/js/hospital-orders.js','/js/hospital-billing.js','/js/hospital-funds.js','/js/hospital-corporate.js','/js/staff-idle-session.js','/js/app-dialogs.js']);
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname,user={...actors[role],assignedBranchIds:['main','north'],activeBranchId:req.headers['x-dynamax-branch']||'main'};
    if(path==='/api/staff-session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,authenticated:true,user,session:{id:'orders-fixture',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}));return;}
    if(path==='/api/staff-hospital'){
      if(expire)throw Object.assign(Error('Staff session expired'),{status:401});
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
      const data=await createHospitalService(env,user,f.db)[body.action](body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    if(!assets.has(path)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(resolve(root,'.'+path)));
  }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:960}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const done=async text=>{await page.locator('#status').filter({hasText:text}).waitFor();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);};
  const login=async(user,task)=>{role=user;const count=f.queries.length;await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=${task}`);await done('Hospital reception ready');assert.equal(f.queries.length,count,'opening a workspace must not load history');};
  const expand=async id=>{if(!await page.locator('#'+id).evaluate(el=>el.open))await page.locator('#'+id+' summary').click();};
  const fill=async(form,data)=>{for(const [key,value] of Object.entries(data))await page.locator(`#${form} [name="${key}"]`).fill(String(value));};
  const period=async prefix=>{await page.locator(`#${prefix}From`).fill('2026-10-26');await page.locator(`#${prefix}To`).fill('2026-10-26');};
  const openList=async()=>{await period('orders');await page.locator('#ordersFilter button').click();await done('Selected order period loaded');await page.locator('[data-open-order]').first().click();await done('Order loaded');};
  const issueContext=async()=>{await page.locator('[data-tab=reception]').click();await page.locator('#visitFrom').fill('2026-10-26');await page.locator('#visitTo').fill('2026-10-26');await page.locator('#visitForm button').click();await done('Selected visit period loaded');await page.locator('[data-issue-order]').click();await done('Prescribing context loaded');};
  await login('doctor','reception');await issueContext();await fill('issueOrderForm',{...rx,Instructions:'Synthetic staff instructions'});
  await page.locator('#branch').selectOption('north');await page.locator('dialog[open]').waitFor();await page.locator('dialog footer [data-app-dialog-cancel]').click();
  await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('#branch').inputValue(),'main');assert.equal(await page.locator('#issueOrderForm [name=Medicine]').inputValue(),medicine.Medicine);
  await page.locator('#confirmIssue').check();await page.locator('#issueOrderForm button:not([type=button])').click();await done('Order signed and issued');
  const rxOrder=f.rows('Orders')[0];assert.equal(rxOrder.Kind,'Prescription');assert.equal(await page.locator('#reviewRx').isVisible(),false);
  await login('pharmacist','pharmacy');await openList();assert.equal(await page.locator('[data-tab=care]').isVisible(),false);
  await expand('reviewRx');await page.locator('#reviewRxForm [name=Reason]').fill('Prescription and allergies reviewed');await page.locator('#confirmOrder').check();await page.locator('#reviewRxForm button').click();await done('Pharmacy review recorded');
  const reviewWrites=f.commits.length;await page.locator('#reviewRxForm [name=Reason]').fill('Prescription and allergies reviewed');await page.locator('#confirmOrder').check();await page.locator('#reviewRxForm button').click();await done('No changes to save');assert.equal(f.commits.length,reviewWrites,'unchanged review must not write or trigger another details-read audit');
  await page.locator('#stockWorkspace summary').filter({hasText:'Receive a medicine batch'}).click();
  await fill('receiveStockForm',{...medicine,BatchNumber:'UI-BATCH',ExpiryDate:'2027-12-31',Quantity:20,UnitPrice:'12.50',Supplier:'Synthetic supplier',ReceiptReference:'UI-INVOICE',LineReference:'1'});
  await page.locator('#receiveStockForm button').click();await done('Medicine batch received');
  await expand('dispenseRx');await page.locator('#matchingStock').click();await done('Matching batches loaded');await page.locator('#dispenseRxForm [name=Quantity]').fill('4');
  await page.locator('#confirmOrder').check();await page.locator('#dispenseRxForm button').click();await done('Dispensing recorded');
  assert.equal(f.rows('MedicineBatches')[0].OnHand,16);assert.equal(f.rows('Dispenses').length,1);assert.equal(f.rows('ChargeEvents').length,1);
  assert.match(await page.locator('#ordersRows tbody tr td').nth(3).textContent(),/Partially dispensed/,'loaded order row reflects the saved action');
  await expand('returnRx');await period('dispensing');await page.locator('#dispensingFilter button').click();await done('Dated dispensing entries loaded');
  await fill('returnRxForm',{Quantity:1,Reason:'Synthetic returned quantity'});await page.locator('#confirmOrder').check();await page.locator('#returnRxForm button').click();await done('Return recorded in quarantine');
  assert.equal(f.rows('MedicineBatches')[0].OnHand,16);assert.equal(f.rows('MedicineBatches')[0].Quarantined,1);assert.equal(f.rows('Orders')[0].Fields.Quantity,10);
  await page.locator('#stockWorkspace summary').filter({hasText:'Find medicine batches'}).click();await fill('stockSearchForm',medicine);await page.locator('#stockSearchForm button').click();await done('Matching batches loaded');
  await fill('quarantineStockForm',{Quantity:1,Reason:'Synthetic damaged stock'});await page.locator('#quarantineStockForm button').click();await done('Stock moved to quarantine');
  assert.equal(f.rows('MedicineBatches')[0].OnHand,15);assert.equal(f.rows('MedicineBatches')[0].Quarantined,2);
  await page.locator('#stockSearchForm button').click();await done('Matching batches loaded');await period('stockHistory');await page.locator('#stockHistoryFilter button').click();await done('Dated stock movements loaded');assert.equal(await page.locator('#stockHistoryRows article').count(),4);
  const readCount=f.reads.length;await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=orders]').click();assert.equal(f.reads.length,readCount,'task switching uses already loaded data');
  await page.screenshot({path:resolve(output,'pharmacy-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone layout fits viewport');await page.screenshot({path:resolve(output,'pharmacy-phone.png'),fullPage:true});
  await page.setViewportSize({width:1366,height:960});await login('doctor','reception');await issueContext();await page.locator('#issueKind').selectOption('Laboratory');
  await fill('issueOrderForm',{Service:'Synthetic laboratory investigation',Specimen:'Labelled specimen',Indication:'Clinician recorded indication'});
  await page.locator('#confirmIssue').check();await page.locator('#issueOrderForm button:not([type=button])').click();await done('Order signed and issued');
  const labOrder=f.rows('Orders').find(o=>o.Kind==='Laboratory');
  await login('laboratory','laboratory');await openList();assert.equal(await page.locator('#stockWorkspace').isVisible(),false);
  await page.evaluate(()=>{window.print=()=>{window.printedLabel=document.querySelector('#cardPrint').textContent;};});await page.locator('#printSpecimen').click();assert.match(await page.evaluate(()=>window.printedLabel),new RegExp(labOrder.OrderNumber));
  await expand('specimenWork');await fill('specimenForm',{SpecimenLabel:labOrder.OrderNumber,Note:'Patient identity and specimen label checked'});await page.locator('#confirmOrder').check();await page.locator('#specimenForm button').click();await done('Specimen handling recorded');
  await expand('reportWork');await fill('reportForm',{Text:'Synthetic critical laboratory result'});await page.locator('#reportForm [name=Critical]').check();await page.locator('#confirmOrder').check();await page.locator('#reportForm button').click();await done('Report saved for independent verification');
  assert.equal(await page.locator('#verifyReport').isEnabled(),false);
  const reportWrites=f.commits.length;await page.locator('#confirmOrder').check();await page.locator('#reportForm button').click();await done('No changes to save');assert.equal(f.commits.length,reportWrites,'unchanged report must not create another version or read audit');
  await login('doctor','orders');await page.locator('#ordersKind').selectOption('Laboratory');await openList();assert.equal(await page.locator('#draftReport').textContent(),'');assert.equal(await page.locator('#releasedReport').textContent(),'');
  await login('verifier','laboratory');await openList();await page.locator('#confirmOrder').check();await page.locator('#verifyReport').click();await done('Report independently verified');
  await expand('releaseWork');await fill('releaseForm',{Communication:'Attending clinician contacted by telephone at 13:00 WAT'});await page.locator('#confirmOrder').check();await page.locator('#releaseForm button').click();await done('Verified report released');
  await login('doctor','orders');await page.locator('#ordersKind').selectOption('Laboratory');await openList();assert.match(await page.locator('#releasedReport').textContent(),/Synthetic critical laboratory result/);
  await expand('ackWork');await page.locator('#loadCriticalAlerts').click();await done('Pending critical results loaded');await fill('ackForm',{Note:'Result reviewed; clinical follow-up recorded'});await page.locator('#confirmOrder').check();await page.locator('#ackForm button').click();await done('Critical result acknowledged');
  assert.equal(f.rows('Orders').find(o=>o.OrderId===labOrder.OrderId).CriticalNeedsAcknowledgement,false);
  assert.ok(!(await page.locator('#ordersRows').textContent()).includes('Critical acknowledgement due'),'loaded list clears the acknowledged flag');
  await page.locator('#orderHistoryFilter').locator('..').locator('summary').click();
  const historyReads=f.queries.length;await page.locator('#loadReleasedHistory').click();await done('Choose valid From and To dates');assert.equal(f.queries.length,historyReads);
  await period('orderHistory');await page.locator('#loadReleasedHistory').click();await done('Released report history loaded');assert.equal(await page.locator('#releasedHistoryRows article').count(),1);
  await page.screenshot({path:resolve(output,'released-result-desktop.png'),fullPage:true});
  await page.locator('#branch').selectOption('north');await done('Branch changed');assert.equal(await page.locator('#orderIdentity').textContent(),'');assert.equal(await page.locator('#releasedReport').textContent(),'');
  expire=true;await page.locator('#refresh').click();await done('Staff session expired');assert.equal(await page.locator('#workspace').isVisible(),false);
  assert.equal(f.rows('Patients').length,1);assert.equal(f.rows('Orders').length,2);assert.deepEqual(errors,[]);
  console.log('PASS: prescription issue, review, batch receiving, partial dispensing, quarantine return, dated lists, retained navigation, specimen label/collection, report verification/release/acknowledgement, branch/session clearing and responsive layouts.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
