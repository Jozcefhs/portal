import {hospitalBrowserAssets} from './helpers/hospital-browser-assets.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {appointmentsFixture,appointmentActors} from '../tests/helpers/hospital-appointments-fixture.mjs';
import {env} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-waitlist-ui');await mkdir(output,{recursive:true});
const f=await appointmentsFixture();let role='admin',expire=false;
const assets = hospitalBrowserAssets();
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname,user={...appointmentActors[role],assignedBranchIds:['main','north'],activeBranchId:req.headers['x-dynamax-branch']||'main'};
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
  const done=async text=>{try{await page.waitForFunction(text=>document.querySelector('#status').textContent.includes(text)&&!document.querySelector('#refresh').disabled,text,{timeout:8000});}catch(e){console.error('Expected',text,'Status',await page.locator('#status').textContent(),'Errors',errors);throw e;}};
  const login=async name=>{role=name;const q=f.queries.length,r=f.reads.length;await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=appointments`);await done('Hospital reception ready');assert.equal(f.reads.length,r);assert.equal(f.queries.length,q);};
  const fill=async(form,fields)=>{for(const [name,value] of Object.entries(fields))await page.locator(`#${form} [name="${name}"]`).fill(String(value));};
  const dates=async(p,day='2026-10-26')=>{await page.locator(`#${p}From`).fill(day);await page.locator(`#${p}To`).fill(day);};
  const schedules=async(day='2026-10-26')=>{await page.locator('#apSchedulesSection').evaluate(e=>{e.open=true;});await dates('apSched',day);await page.locator('#apSchedulesForm button').first().click();await done('Selected clinic dates loaded');};
  const register=async(day='2026-10-26')=>{await dates('apReg',day);await page.locator('#apRegisterForm button').first().click();await done('Selected appointment dates loaded');};
  await login('reception');assert.equal(await page.locator('#awList').textContent(),'');
  await page.locator('[data-tab=patients]').click();await page.locator('#searchValue').fill('Patient');await page.locator('#searchForm button').first().click();await done('Patient search complete');await page.locator('[data-patient]').click();await done('Patient registration loaded');await page.locator('#bookPatientAppointment').click();await done('Choose the doctor');
  await page.locator('#apJoinWaitlist').click();await done('Enter this patient');
  await fill('awEditor',{Reference:'UI-WAIT-001',Department:'Outpatients',PreferredFrom:'2026-10-26',PreferredTo:'2026-10-27',Note:'Please offer an afternoon appointment'});
  await page.locator('#awEditor [name=ConfirmPatient]').check();await page.locator('#awEditor button').click();await done('Waiting request saved');assert.equal(f.rows('AppointmentWaitlist').length,1);
  await page.locator('#awListForm button').first().click();await done('Selected waitlist page loaded');let q=f.queries.length;await page.locator('#awListForm button').first().click();await done('Selected waitlist page loaded');assert.equal(f.queries.length,q);
  await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=appointments]').click();await page.locator('#awListForm button').first().click();await done('Selected waitlist page loaded');assert.equal(f.queries.length,q);
  await page.locator('#awRefresh').click();await done('Selected waitlist page loaded');assert.equal(f.queries.length,q+1);
  await page.locator('[data-aw-open]').click();await done('Current waiting request loaded');
  await fill('awEditor',{Note:'Patient prefers the next afternoon',Reason:'Patient requested a later start'});await page.locator('#awEditor [name=ConfirmPatient]').check();await page.locator('#awEditor button').click();await done('Waiting request saved');assert.equal(f.rows('AppointmentWaitlistEvents').length,2);
  await dates('awHist');await page.locator('#awHistoryForm button').first().click();await done('Selected waiting request history loaded');assert.match(await page.locator('#awHistory').textContent(),/Preferences changed/);
  await page.evaluate(()=>{window.print=()=>{window.__prints=(window.__prints||0)+1;};});let reads=f.reads.length;const commits=f.commits.length;q=f.queries.length;
  await page.locator('#awPrint').click();await page.locator('#awPrintHistory').click();assert.equal(await page.evaluate(()=>window.__prints),2);assert.equal(f.queries.length,q);assert.equal(f.reads.length,reads);assert.equal(f.commits.length,commits);
  await page.screenshot({path:resolve(output,'waitlist-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'waitlist-phone.png'),fullPage:true});await page.setViewportSize({width:1366,height:960});
  await page.locator('#awBook').click();await done('Choose a matching clinic');await schedules();await page.locator('[data-ap-select]').click();assert.equal(await page.locator('#apBookingForm [name=Reference]').inputValue(),'UI-WAIT-001');
  await fill('apBookingForm',{StartAt:'2026-10-26T14:00',EndAt:'2026-10-26T14:30'});await page.locator('#apBookingForm [name=ConfirmPatient]').check();await page.locator('#apBookingForm button').last().click();await done('Appointment saved');
  assert.equal(f.rows('AppointmentWaitlist')[0].Status,'Booked');assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('Visits').length,0);assert.equal(await page.locator('#awDetail').isVisible(),false);
  await page.locator('#awStatus').selectOption('Booked');assert.equal(await page.locator('#awDates').isVisible(),true);q=f.queries.length;
  await page.locator('#awListForm button').first().click();assert.equal(f.queries.length,q,'completed history needs dates');await page.locator('dialog[open] footer button').last().click();
  await dates('awList');await page.locator('#awListForm button').first().click();await done('Selected waitlist page loaded');await page.locator('[data-aw-open]').click();await done('Current waiting request loaded');assert.equal(await page.locator('#awEditor').isVisible(),false);assert.equal(await page.locator('#awOpenBooking').isVisible(),true);
  await page.locator('#awPrintList').click();assert.equal(await page.evaluate(()=>window.__prints),3);
  // A second request is permitted after booking; cancellation retains both records.
  await page.locator('#apJoinWaitlist').click();await done('Enter this patient');await fill('awEditor',{Reference:'UI-WAIT-002',Department:'Outpatients',PreferredFrom:'2026-10-26',PreferredTo:'2026-10-27'});await page.locator('#awEditor [name=ConfirmPatient]').check();await page.locator('#awEditor button').click();await done('Waiting request saved');
  await fill('awCancel',{Reason:'Patient no longer wants this appointment'});await page.locator('#awCancel [name=ConfirmPatient]').check();await page.locator('#awCancel button').click();await done('Waiting request cancelled');assert.equal(f.rows('AppointmentWaitlist').length,2);assert.equal(f.rows('AppointmentWaitlist')[1].Status,'Cancelled');
  await page.locator('#awStatus').selectOption('Waiting');await page.locator('#branch').selectOption('north');await done('Branch changed');assert.equal(await page.locator('#awIdentity').textContent(),'');assert.equal(await page.locator('#awList').textContent(),'');
  await login('nurse');await page.locator('#awStatus').selectOption('Booked');await dates('awList');await page.locator('#awListForm button').first().click();await done('Selected waitlist page loaded');await page.locator('[data-aw-open]').click();await done('Current waiting request loaded');assert.equal(await page.locator('#awEditor').isVisible(),false);assert.equal(await page.locator('#awBook').isVisible(),false);
  expire=true;await page.locator('#awRefresh').click();await done('Staff session expired');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#awIdentity').textContent(),'');assert.deepEqual(errors,[]);
  console.log('PASS: waitlist creation, edit history, cached navigation, explicit refresh, no-read print, booking conversion, dated completed lists, cancellation, branch/session clearing, role restrictions and desktop/phone layouts.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
