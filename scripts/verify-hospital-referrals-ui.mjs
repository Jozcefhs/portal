import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {referralsFixture,referralActors} from '../tests/helpers/hospital-referrals-fixture.mjs';
import {env} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-referrals-ui');await mkdir(output,{recursive:true});
const f=await referralsFixture();let role='doctor',expire=false;
const assets=new Set(['/hospital.html','/css/hospital.css','/css/app-dialogs.css','/js/hospital.js','/js/hospital-appointments.js','/js/hospital-referrals.js','/js/hospital-clinical.js','/js/hospital-orders.js','/js/hospital-billing.js','/js/hospital-funds.js','/js/hospital-corporate.js','/js/hospital-inpatients.js','/js/hospital-nursing.js','/js/hospital-theatre.js','/js/staff-idle-session.js','/js/app-dialogs.js']);
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname,user={...referralActors[role],activeBranchId:req.headers['x-dynamax-branch']||(role==='receiving'?'north':'main')};
    if(path==='/api/staff-session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,authenticated:true,user,session:{id:'appointments-fixture',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}));return;}
    if(path==='/api/staff-hospital'){
      if(expire)throw Object.assign(Error('Staff session expired'),{status:401});let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw),data=await createHospitalService(env,user,f.db)[body.action](body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    if(!assets.has(path)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(resolve(root,'.'+path)));
  }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const done=async text=>{try{await page.waitForFunction(text=>document.querySelector('#status').textContent.includes(text)&&!document.querySelector('#refresh').disabled,text,{timeout:10000});}catch(e){console.error(await page.locator('#status').textContent(),errors);throw e;}};
  const login=async name=>{role=name;const r=f.reads.length,q=f.queries.length;await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=referrals`);await done('Hospital reception ready');assert.equal(f.reads.length,r);assert.equal(f.queries.length,q);};
  const fill=async(form,fields)=>{for(const [name,value]of Object.entries(fields))await page.locator(`#${form} [name="${name}"]`).fill(value);};
  await login('doctor');await page.locator('[data-tab="reception"]').click();
  await page.locator('#visitFrom').fill('2026-10-26');await page.locator('#visitTo').fill('2026-10-26');await page.locator('#visitForm button').first().click();await done('Selected visit period loaded');
  await page.locator('[data-referral-visit]').click();await done('Referral preparation ready');
  await page.locator('#rfForm [name="TargetBranchId"]').selectOption('north');await fill('rfForm',{Recipient:'receiving',Department:'Medicine',Reason:'Specialist opinion requested',Summary:'Synthetic approved clinical summary',Instructions:'Follow-up review required'});
  await page.locator('#rfForm [name="ConfirmPatient"]').check();await page.locator('#rfForm [name="ConfirmClinicalReview"]').check();await page.locator('#rfForm button').click();await done('Referral signed');assert.equal(f.rows('Referrals').length,1);
  await fill('rfRegister',{fromDate:'2026-10-26',toDate:'2026-10-26'});await page.locator('#rfRegister button').first().click();await done('Selected referral dates loaded');const queries=f.queries.length;
  await page.locator('#rfRegister button').first().click();await done('Selected referral dates loaded');assert.equal(f.queries.length,queries);
  await page.evaluate(()=>window.print=()=>{window.printedReferral=document.getElementById('cardPrint').textContent;});await page.locator('#rfPrint').click();await page.waitForFunction(()=>Boolean(window.printedReferral));assert.match(await page.evaluate(()=>window.printedReferral),/Synthetic approved clinical summary/);
  await login('receiving');await page.locator('#rfRegister [name="Direction"]').selectOption('Incoming');await fill('rfRegister',{fromDate:'2026-10-26',toDate:'2026-10-26'});await page.locator('#rfRegister button').first().click();await done('Selected referral dates loaded');await page.locator('[data-rf-open]').click();await done('Signed referral loaded');
  await fill('rfAction',{Reason:'Received for specialist review'});await page.locator('#rfAction [name="ConfirmPatient"]').check();await page.locator('#rfAction [name="ConfirmSharedCare"]').check();await page.locator('#rfAction button').click();await done('Referral action saved');assert.equal(f.rows('Visits').length,2);assert.equal(f.rows('Referrals')[0].Status,'Acknowledged');
  await page.locator('#rfFollowUp').click();await done('Choose the doctor');assert.match(await page.locator('#apIdentity').textContent(),/Follow-up/);
  await page.locator('[data-tab="referrals"]').click();await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(output,'mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await login('admin');assert.equal(await page.locator('[data-tab="referrals"]').isVisible(),false);assert.deepEqual(errors,[]);console.log('Hospital referral browser workflow passed: sign, cache, print, receiving branch, accept, follow-up, roles and responsive layout.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
