import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {billingActors,plan} from '../tests/helpers/hospital-billing-fixture.mjs';
import {fundsFixture} from '../tests/helpers/hospital-funds-fixture.mjs';
import {env} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-funds-ui');await mkdir(output,{recursive:true});
const f=await fundsFixture(),one=await f.issue(),two=await f.issue(),coveredOne=await f.coveredInvoice(),coveredTwo=await f.coveredInvoice(await f.otherPatient());let role='cashier',expire=false;
const assets=new Set(['/hospital.html','/css/hospital.css','/css/app-dialogs.css','/js/hospital.js','/js/hospital-appointments.js','/js/hospital-referrals.js','/js/hospital-clinical.js','/js/hospital-orders.js','/js/hospital-billing.js','/js/hospital-funds.js','/js/hospital-corporate.js','/js/hospital-inpatients.js','/js/hospital-nursing.js','/js/hospital-theatre.js','/js/staff-idle-session.js','/js/app-dialogs.js']);
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname,user={...billingActors[role],assignedBranchIds:['main','north'],activeBranchId:req.headers['x-dynamax-branch']||'main'};
    if(path==='/api/staff-session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,authenticated:true,user,session:{id:'billing-fixture',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}));return;}
    if(path==='/api/staff-hospital'){
      if(expire)throw Object.assign(Error('Staff session expired'),{status:401});let raw='';for await(const c of req)raw+=c;
      const body=JSON.parse(raw),result=await createHospitalService(env,user,f.db)[body.action](body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    if(!assets.has(path)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(resolve(root,'.'+path)));
  }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const done=async text=>{await page.locator('#status').filter({hasText:text}).waitFor().catch(async error=>{throw new Error(`${text}: ${await page.locator('#status').textContent()}; page errors: ${errors.join('; ')}`,{cause:error});});await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);};
  const fill=async(form,fields)=>{for(const [name,value]of Object.entries(fields))await page.locator(`#${form} [name="${name}"]`).fill(String(value));};
  const dates=async prefix=>{await page.locator(`#${prefix}From`).fill('2026-10-26');await page.locator(`#${prefix}To`).fill('2026-10-26');};
  const expand=async id=>{if(!await page.locator('#'+id).evaluate(e=>e.open))await page.locator(`#${id}>summary`).click();};
  const login=async user=>{role=user;const reads=f.queries.length;await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=billing`);await done('Hospital reception ready');assert.equal(f.queries.length,reads);};
  const openReceipt=async(Kind='Patient')=>{await expand('fundWorkspace');await dates('fundList');await page.locator('#fundListKind').selectOption(Kind);await page.locator('#fundRegister button:not([type=button])').click();await done('Selected advance period loaded');await page.locator('[data-fund-open]').first().click();await done('Advance receipt loaded');};
  const add=async inv=>{await fill('fundInvoiceFind',{InvoiceNumber:f.invoice(inv.InvoiceId).InvoiceNumber});await page.locator('#fundInvoiceFind button').click();await done('Invoice found for allocation');await page.locator('#fundAddInvoice').click();};
  const allocate=async ref=>{await fill('fundAllocateForm',{Reference:ref});await page.locator('#fundAllocateConfirm').check();await page.locator('#fundAllocateForm button:not([type=button])').click();await done('Advance allocated to selected invoices');};
  const receive=async(Kind,Reference)=>{await expand('fundWorkspace');await expand('fundReceive');await page.locator('#fundReceiveKind').selectOption(Kind);
    if(Kind==='Patient'){await fill('fundPatientFind',{HospitalNumber:f.rows('Patients').find(p=>p.PatientId===f.scope.PatientId).HospitalNumber});await page.locator('#fundPatientFind button').click();await done('Patient verified for prepayment');}
    else await fill('fundReceiveForm',{Insurer:plan.Insurer});
    await fill('fundReceiveForm',{Amount:'250',Reference});await page.locator('#fundReceiveForm [name=Method]').selectOption('Bank transfer');await page.locator('#fundReceiveConfirm').check();await page.locator('#fundReceiveForm button').click();await done('receipt');};

  await login('cashier');await receive('Patient','UI-ADVANCE');assert.equal(f.rows('Funds').length,1);assert.equal(f.rows('Funds')[0].AmountCents,25000);
  const originalPostingCount=f.commits.length;await receive('Patient','UI-ADVANCE');await done('This advance receipt is already recorded');assert.equal(f.rows('Funds').length,1);assert.equal(f.commits.slice(originalPostingCount).filter(writes=>writes.some(w=>w.collectionPath==='accountingJournals')).length,0);
  await expand('fundAllocate');await add(one);await add(two);await page.locator('[data-fund-amount="1"]').fill('50');
  const reads=f.reads.length;await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=billing]').click();assert.equal(f.reads.length,reads);assert.equal(await page.locator('[data-fund-amount]').count(),2);
  await page.locator('#branch').selectOption('north');await page.locator('dialog[open]').waitFor();await page.locator('dialog footer [data-app-dialog-cancel]').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('#branch').inputValue(),'main');assert.equal(await page.locator('[data-fund-amount]').count(),2);
  await allocate('UI-USE-1');assert.equal(f.rows('Payments').filter(r=>r.SourceFundId).length,2);assert.match(await page.locator('#fundBalance').textContent(),/available.*100\.00/);
  await page.evaluate(()=>{window.print=()=>window.printed=document.querySelector('#cardPrint').textContent;});await page.locator('#fundPrint').click();assert.match(await page.evaluate(()=>window.printed),/Hospital advance receipt.*UI-ADVANCE/s);
  await expand('fundHistory');await dates('fundHistory');await page.locator('#fundLoadAllocations').click();await done('Dated advance allocations loaded');assert.match(await page.locator('#fundAllocationRows').textContent(),/UI-USE-1/);
  const queries=f.queries.length;await page.locator('#fundLoadAllocations').click();await done('Dated advance allocations loaded');assert.equal(f.queries.length,queries);assert.equal(await page.locator('[data-fund-return]').count(),0);assert.equal(await page.locator('#fundRefund').isVisible(),false);
  const beforeRefresh=f.queries.length;await page.locator('#fundHistoryRefresh').click();await done('Dated advance allocations loaded');assert.equal(f.queries.length,beforeRefresh+1);
  await page.screenshot({path:resolve(output,'deposit-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'deposit-phone.png'),fullPage:true});await page.setViewportSize({width:1366,height:960});
  await dates('billList');await page.locator('#billRegister button:not([type=button])').click();await done('Selected billing period loaded');await page.locator('#billRows tr').filter({hasText:f.invoice(one.InvoiceId).InvoiceNumber}).locator('[data-invoice]').click();await done('Invoice loaded');
  await expand('billHistory');await dates('billHistory');await page.locator('#billLoadPayments').click();await done('Dated receipts loaded');assert.equal(await page.locator('#billRefundReceipt option').count(),0);await page.locator('[data-print-receipt]').first().click();assert.match(await page.evaluate(()=>window.printed),/Hospital allocation.*not another cash receipt/s);await page.locator('[data-source-fund]').first().click();await done('Advance receipt loaded');assert.match(await page.locator('#fundTitle').textContent(),/HA-/);
  await receive('Hmo','UI-HMO-REMIT');await expand('fundAllocate');await add(coveredOne);await add(coveredTwo);await allocate('UI-HMO-SCHEDULE');assert.equal(f.rows('Claims').filter(r=>r.Status==='Settled').length,2);
  await login('hmo');await openReceipt('Hmo');assert.equal(await page.locator('#fundReceive').isVisible(),false);assert.equal(await page.locator('#fundAllocate').isVisible(),false);assert.equal(await page.locator('#fundListKind [value=Patient]').evaluate(e=>e.disabled),true);assert.match(await page.locator('#fundBalance').textContent(),/applied.*120\.00/);
  await login('admin');await openReceipt();assert.equal(await page.locator('#fundReceive').isVisible(),false);await expand('fundHistory');await dates('fundHistory');await page.locator('#fundLoadAllocations').click();await done('Dated advance allocations loaded');await page.locator('[data-fund-return]').first().click();await done('Allocation reviewed for return');
  await fill('fundReturnForm',{Amount:'10',Reference:'UI-ALLOCATION-RETURN',Reason:'Incorrect allocation amount'});await page.locator('#fundReturnConfirm').check();await page.locator('#fundReturnForm button').click();await done('Allocation returned to the receipt balance');assert.equal(f.rows('FundAllocationReturns').length,1);assert.match(await page.locator('#fundBalance').textContent(),/available.*110\.00/);
  await expand('fundRefund');await fill('fundRefundForm',{Amount:'110',Reference:'UI-UNUSED-REFUND',Reason:'Unused money refunded'});await page.locator('#fundRefundConfirm').check();await page.locator('#fundRefundForm button').click();await done('Unused advance refunded');assert.equal(f.rows('FundRefunds').length,1);assert.match(await page.locator('#fundBalance').textContent(),/available.*0\.00/);
  await expand('billSettings');await page.locator('#billLoadSettings').click();await done('Billing account mappings loaded');assert.equal(await page.locator('#billSettingsForm [name=PatientDeposit]').inputValue(),'2320');assert.equal(await page.locator('#billSettingsForm [name=HmoPrepayment]').inputValue(),'2330');
  const writes=f.commits.length;await page.locator('#billSettingsForm button').click();await done('No account changes to save');assert.equal(f.commits.length,writes);
  await page.locator('#branch').selectOption('north');await done('Branch changed');assert.equal(await page.locator('#fundTitle').textContent(),'');assert.equal(await page.locator('#fundAllocationRows').textContent(),'');assert.equal(await page.locator('#fundRows').textContent(),'');
  expire=true;await page.locator('#refresh').click();await done('Staff session expired');assert.equal(await page.locator('#workspace').isVisible(),false);assert.deepEqual(errors,[]);
  console.log('PASS: patient prepayment, invoice allocation cart, retained views, HMO multi-patient remittance, roles, allocation return, unused refund, mapping no-op, date-first history, printing, branch/session clearing and responsive layout.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
