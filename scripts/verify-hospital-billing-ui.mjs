import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {billingFixture,billingActors} from '../tests/helpers/hospital-billing-fixture.mjs';
import {env} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-billing-ui');await mkdir(output,{recursive:true});
const f=await billingFixture();let role='cashier',expire=false;
const assets=new Set(['/hospital.html','/css/hospital.css','/css/app-dialogs.css','/js/hospital.js','/js/hospital-clinical.js','/js/hospital-orders.js','/js/hospital-billing.js','/js/staff-idle-session.js','/js/app-dialogs.js']);
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
  const visit=async()=>{await page.locator('[data-tab=reception]').click();await page.locator('#visitFrom').fill('2026-10-26');await page.locator('#visitTo').fill('2026-10-26');await page.locator('#visitForm button').click();await done('Selected visit period loaded');await page.locator('[data-billing-visit]').click();await done('Patient billing context loaded');};
  const invoice=async()=>{await dates('billList');await page.locator('#billRegister button:not([type=button])').click();await done('Selected billing period loaded');await page.locator('[data-invoice]').first().click();await done('Invoice loaded');};
  await login('hmo');await expand('billPlanEditor');await page.locator('#billNewPlan').click();
  await fill('billPlanForm',{Code:'UI-HMO',Insurer:'Synthetic UI insurer'});
  // Plan and covered-service names are separate fields.
  await page.locator('#billPlanForm> .form-grid [name=Name]').fill('UI agreed plan');await page.locator('#billTariffs [name=Name]').fill('Consultation');await page.locator('#billTariffs [name=ServiceCode]').fill('CONSULT');await page.locator('#billTariffs [name=Tariff]').fill('80');await page.locator('#billTariffs [name=CopayPercent]').fill('25');
  await page.locator('#billPlanForm>button:not([type=button])').click();await done('HMO plan saved');assert.equal(f.rows('HmoPlans').length,1);
  const writes=f.commits.length;await page.locator('#billPlanForm>button:not([type=button])').click();await done('No plan changes to save');assert.equal(f.commits.length,writes);
  await visit();await expand('billEligibility');await fill('billPlanFind',{Code:'UI-HMO'});await page.locator('#billPlanFind button').click();await page.locator('#billPlanFound').filter({hasText:'Synthetic UI insurer'}).waitFor();
  await fill('billEligibilityForm',{MemberNumber:'UI-MEMBER',Authorization:'UI-AUTH',From:'2026-10-01',To:'2026-12-31',VerificationNote:'Eligibility checked by staff with insurer'});await page.locator('#billEligibilityForm button').click();await done('Verified HMO eligibility saved');
  await login('cashier');assert.equal(await page.locator('#billPlanEditor').isVisible(),false);await visit();await expand('billService');await fill('billServiceForm',{ServiceCode:'CONSULT',Description:'Consultation',Quantity:1,UnitPrice:'100',Reference:'UI-CONSULT'});
  await page.locator('#branch').selectOption('north');await page.locator('dialog[open]').waitFor();await page.locator('dialog footer [data-app-dialog-cancel]').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('#branch').inputValue(),'main');
  await page.locator('#billServiceForm button').click();await done('Service charge recorded');await dates('billCharge');await page.locator('#billVisitCharges button:not([type=button])').click();await done('Visit charges loaded');
  await page.locator('[data-charge]').check();await page.locator('#billUseHmo').check();assert.match(await page.locator('#billEstimate').textContent(),/20\.00.*60\.00/);
  await page.locator('#billIssue').click();await page.locator('dialog[open]').waitFor();await page.locator('dialog footer .app-decision-confirm').click();await done('Invoice issued');assert.equal(f.rows('Invoices').length,1);
  assert.equal(f.rows('Invoices')[0].PatientCents,2000);assert.equal(f.rows('Invoices')[0].HmoCents,6000);await expand('billPayment');await fill('billPaymentForm',{Amount:'20',Reference:'UI-RECEIPT'});await page.locator('#billConfirm').check();await page.locator('#billPaymentForm button').click();await done('Payment recorded');
  const count=f.reads.length;await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=billing]').click();assert.equal(f.reads.length,count);
  await page.evaluate(()=>{window.print=()=>window.printed=document.querySelector('#cardPrint').textContent;});await page.locator('#billPrint').click();assert.match(await page.evaluate(()=>window.printed),/Hospital invoice/);
  await page.screenshot({path:resolve(output,'invoice-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'invoice-phone.png'),fullPage:true});await page.setViewportSize({width:1366,height:960});
  await login('hmo');await invoice();await expand('billClaim');
  for(const Status of ['Submitted','Rejected','Submitted','Approved']){await page.locator('#billClaimForm [name=Status]').selectOption(Status);await fill('billClaimForm',{Reference:'UI-CLAIM',Note:'Staff recorded insurer response'});await page.locator('#billConfirm').check();await page.locator('#billClaimForm button').click();await done('HMO claim status recorded');}
  assert.equal(f.rows('ClaimVersions').length,4);await login('cashier');await invoice();await expand('billPayment');await page.locator('#billPaymentForm [name=Payer]').selectOption('Hmo');await page.locator('#billPaymentForm [name=Method]').selectOption('Bank transfer');await fill('billPaymentForm',{Amount:'60',Reference:'UI-SETTLEMENT'});await page.locator('#billConfirm').check();await page.locator('#billPaymentForm button').click();await done('Payment recorded');assert.equal(f.rows('Claims')[0].Status,'Settled');
  await expand('billHistory');await dates('billHistory');await page.locator('#billLoadPayments').click();await done('Dated receipts loaded');assert.equal(await page.locator('[data-print-receipt]').count(),2);
  const q=f.queries.length;await page.locator('#billLoadPayments').click();await done('Dated receipts loaded');assert.equal(f.queries.length,q,'loaded receipts are reused');
  await login('admin');await invoice();await expand('billAdjustment');await fill('billAdjustmentForm',{Amount:'50',Reference:'UI-SERVICE-CREDIT',Reason:'Part of service cancelled'});await page.locator('#billConfirm').check();await page.locator('#billAdjustmentForm button').click();await done('Service credit note issued');
  assert.equal(f.rows('Invoices')[0].PatientCreditCents,1000);assert.equal(f.rows('Claims')[0].Status,'Adjustment required');
  await expand('billHistory');await dates('billHistory');await page.locator('#billLoadPayments').click();await done('Dated receipts loaded');
  const original=f.rows('Payments').find(p=>p.Payer==='Patient');await page.locator('#billRefundReceipt').selectOption(await page.locator('#billRefundReceipt option').filter({hasText:original.ReceiptNumber}).getAttribute('value'));
  await fill('billRefundForm',{Amount:'10',Reference:'UI-REFUND',Reason:'Refund credited overpayment'});await page.locator('#billConfirm').check();await page.locator('#billRefundForm button').click();await done('Refund recorded');assert.equal(f.rows('Refunds').length,1);
  await expand('billSettings');await page.locator('#billLoadSettings').click();await done('Billing account mappings loaded');const settingWrites=f.commits.length;await page.locator('#billSettingsForm button').click();await done('No account changes to save');assert.equal(f.commits.length,settingWrites);
  await page.locator('#branch').selectOption('north');await done('Branch changed');assert.equal(await page.locator('#billInvoiceTitle').textContent(),'');assert.equal(await page.locator('#billPayments').textContent(),'');assert.equal(await page.locator('#billRows').textContent(),'');
  expire=true;await page.locator('#refresh').click();await done('Staff session expired');assert.equal(await page.locator('#workspace').isVisible(),false);assert.deepEqual(errors,[]);
  console.log('PASS: plan/tariff setup, verified eligibility, source charge, invoice split, patient receipt, HMO rejection/resubmission/approval/settlement, service credits, refunds, no-op settings, retained views, print, branch/session clearing and responsive layout.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
