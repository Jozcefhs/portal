import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {inpatientFixture,inpatientActors} from '../tests/helpers/hospital-inpatient-fixture.mjs';
import {env} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-inpatients-ui');await mkdir(output,{recursive:true});
const f=await inpatientFixture();let role='admin',expire=false;
const assets=new Set(['/hospital.html','/css/hospital.css','/css/app-dialogs.css','/js/hospital.js','/js/hospital-clinical.js','/js/hospital-orders.js','/js/hospital-billing.js','/js/hospital-funds.js','/js/hospital-corporate.js','/js/hospital-inpatients.js','/js/staff-idle-session.js','/js/app-dialogs.js']);
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname,user={...inpatientActors[role],assignedBranchIds:['main','north'],activeBranchId:req.headers['x-dynamax-branch']||'main'};
    if(path==='/api/staff-session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,authenticated:true,user,session:{id:'inpatient-fixture',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}));return;}
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
  const done=async text=>{try{await page.waitForFunction(text=>document.querySelector('#status').textContent.includes(text)&&!document.querySelector('#refresh').disabled,text);}catch(error){console.error('Expected:',text,'Status:',await page.locator('#status').textContent(),'Errors:',errors);throw error;}};
  const login=async name=>{role=name;await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=inpatients`);await done('Hospital reception ready');};
  const fill=async(form,fields)=>{for(const [name,value] of Object.entries(fields))await page.locator(`#${form} [name="${name}"]`).fill(value);};
  const dates=async(prefix)=>{await page.locator(`#${prefix}From`).fill('2026-10-26');await page.locator(`#${prefix}To`).fill('2026-10-26');};
  const register=async()=>{await dates('ip');await page.locator('#ipRegisterForm button').first().click();await done('Selected admission period loaded');};
  const open=async()=>{await register();await page.locator('[data-admission]').first().click();await done('Admission loaded');};
  const wards=async()=>{await page.locator('#ipLoadWards').click();await done('Ward page loaded');};
  f.queries.length=0;f.reads.length=0;f.commits.length=0;await login('admin');assert.equal(f.queries.length+f.reads.length+f.commits.length,0);
  await page.locator('#ipNewWard').click();await fill('ipWardForm',{Code:'WARD-UI',Name:'Surgical ward'});await page.locator('#ipWardForm button').click();await done('Ward saved');
  const writes=f.commits.length;await page.locator('#ipWardForm button').click();await done('No ward changes');assert.equal(f.commits.length,writes);
  await page.locator('#ipNewBed').click();await fill('ipBedForm',{Code:'UI-01',Name:'Surgical bed 1'});await page.locator('#ipBedForm button').click();await done('Bed saved');await page.locator('#ipLoadBeds').click();await done('Bed availability loaded');assert.match(await page.locator('#ipBeds').textContent(),/Available/);
  await login('clerk');assert.equal(await page.locator('#ipNewWard').isVisible(),false);await page.locator('[data-tab=reception]').click();await dates('visit');await page.locator('#visitForm button').click();await done('Selected visit period loaded');await page.locator('[data-inpatient-visit]').first().click();await done('Admission visit loaded');
  await wards();await page.locator('[data-ward]').first().click();await done('Bed availability loaded');await page.locator('[data-choose-bed]').first().click();await fill('ipAdmitForm',{ResponsibleClinician:'Dr Synthetic'});await page.locator('#ipAdmitForm [name=ConfirmPatient]').check();await page.locator('#ipAdmitForm button').click();await done('Patient admitted');
  assert.equal(f.rows('Admissions').length,1);assert.match(await page.locator('#ipAdmissionIdentity').textContent(),/Admitted/);assert.equal(await page.locator('#ipDischargeEditor').isVisible(),false);
  await register();const q=f.queries.length;await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=inpatients]').click();await page.locator('#ipRegisterForm button').first().click();await done('Selected admission period loaded');assert.equal(f.queries.length,q);
  await wards();await page.locator('[data-ward]').nth(1).click();await done('Bed availability loaded');await page.locator('[data-choose-bed]').first().click();await fill('ipTransferForm',{Reason:'Move to surgical ward'});await page.locator('#ipTransferForm [name=ConfirmPatient]').check();await page.locator('#ipTransferForm button').click();await done('Bed transfer saved');assert.equal(f.rows('Admissions')[0].WardName,'Surgical ward');
  await page.locator('#ipReleaseForm [name=ConfirmPatient]').check();await page.locator('#ipReleaseForm button').click();await done('clinician must sign');assert.equal(f.rows('Admissions')[0].Status,'Admitted');
  await login('doctor');await open();await page.locator('#ipDischargeEditor summary').click();await fill('ipDischargeForm',{Diagnosis:'Synthetic recorded diagnosis',Course:'Synthetic recorded clinical course',Treatment:'Synthetic treatment instructions',FollowUp:'Synthetic follow-up instructions'});await page.locator('#ipDischargeForm [name=ConfirmPatient]').check();await page.locator('#ipDischargeForm [name=ConfirmClinicalReview]').check();await page.locator('#ipDischargeForm button').click();await done('Discharge summary signed');assert.equal(f.rows('DischargeSummaries').length,1);assert.equal(f.rows('Admissions')[0].Status,'Admitted');
  await page.evaluate(()=>{window.print=()=>{window.printed=document.querySelector('#cardPrint').textContent;};});await page.locator('#ipPrint').click();assert.match(await page.evaluate(()=>window.printed),/Synthetic recorded diagnosis/);
  await page.screenshot({path:resolve(output,'discharge-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'discharge-phone.png'),fullPage:true});await page.setViewportSize({width:1366,height:960});
  await login('nurse');await open();assert.equal(await page.locator('#ipDischargeEditor').isVisible(),false);assert.match(await page.locator('#ipSummary').textContent(),/Synthetic recorded diagnosis/);await page.locator('#ipReleaseForm [name=ConfirmPatient]').check();await page.locator('#ipReleaseForm button').click();await done('Discharge completed');assert.equal(f.rows('Beds').filter(b=>b.AdmissionId).length,0);assert.equal(f.rows('Visits')[0].Status,'Completed');
  await dates('ipHistory');await page.locator('#ipHistoryForm button').first().click();await done('Selected admission history loaded');assert.equal(await page.locator('#ipHistory tbody tr').count(),4);assert.match(await page.locator('#ipHistory').textContent(),/Bed transfer/);
  await wards();await page.locator('[data-ward]').nth(1).click();await done('Bed availability loaded');assert.match(await page.locator('#ipBeds').textContent(),/Needs preparation/);await page.locator('[data-ready-bed]').click();await page.locator('dialog[open]').waitFor();await page.locator('dialog footer .app-decision-confirm').click();await done('Bed marked ready');assert.match(await page.locator('#ipBeds').textContent(),/Available/);await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'wards-phone.png'),fullPage:true});await page.setViewportSize({width:1366,height:960});
  await login('admin');await open();assert.equal(await page.locator('#ipSummarySection').isVisible(),false);assert.equal(await page.locator('#ipSummary').textContent(),'No signed summary.');
  await wards();await page.locator('[data-ward]').first().click();await done('Bed availability loaded');await fill('ipWardForm',{Name:'Unsaved ward name'});await page.locator('#branch').selectOption('north');await page.locator('dialog[open]').waitFor();await page.locator('dialog footer [data-app-dialog-cancel]').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('#branch').inputValue(),'main');
  await page.locator('#branch').selectOption('north');await page.locator('dialog[open]').waitFor();await page.locator('dialog footer .app-decision-confirm').click();await done('Branch changed');assert.equal(await page.locator('#ipRegister').textContent(),'');assert.equal(await page.locator('#ipPatient').textContent(),'');
  expire=true;await page.locator('#refresh').click();await done('Staff session expired');assert.equal(await page.locator('#workspace').isVisible(),false);assert.deepEqual(errors,[]);
  console.log('PASS: ward/bed setup, no-op saves, role controls, admission, cached register, transfer, signed discharge, bed release, retained history, printing, branch/session clearing, unsaved changes and responsive layout.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
