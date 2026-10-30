import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {appointmentsFixture,appointmentActors} from '../tests/helpers/hospital-appointments-fixture.mjs';
import {env} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-appointments-ui');await mkdir(output,{recursive:true});
const f=await appointmentsFixture();let role='admin',expire=false;
const assets=new Set(['/hospital.html','/css/hospital.css','/css/app-dialogs.css','/js/hospital-stock-control.js','/js/hospital.js','/js/hospital-appointments.js','/js/hospital-referrals.js','/js/hospital-clinical.js','/js/hospital-medicines.js','/js/hospital-procurement.js','/js/hospital-orders.js','/js/hospital-billing.js','/js/hospital-funds.js','/js/hospital-corporate.js','/js/hospital-inpatients.js','/js/hospital-nursing.js','/js/hospital-theatre.js','/js/staff-idle-session.js','/js/app-dialogs.js']);
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
  await login('admin');await schedules();await page.locator('[data-ap-edit]').click();const commits=f.commits.length;await page.locator('#apScheduleEditor button').first().click();await done('Clinic availability saved');assert.equal(f.commits.length,commits);
  await page.locator('#apNewSchedule').click();await fill('apScheduleEditor',{Clinician:'doctor',Day:'2026-10-27',Department:'Outpatients',Windows:'09:00-12:00\n13:00-17:00'});await page.locator('#apScheduleEditor button').first().click();await done('Clinic availability saved');assert.equal(f.rows('AppointmentSchedules').length,2);
  await login('reception');assert.equal(await page.locator('#apNewSchedule').isVisible(),false);
  await page.locator('[data-tab=patients]').click();await page.locator('#searchValue').fill('Patient');await page.locator('#searchForm button').first().click();await done('Patient search complete');await page.locator('[data-patient]').click();await done('Patient registration loaded');await page.locator('#bookPatientAppointment').click();await done('Choose the doctor');
  await schedules();let q=f.queries.length;await schedules();assert.equal(f.queries.length,q);await page.locator('[data-ap-select]').click();
  await fill('apBookingForm',{Reference:'UI-APPT-001',StartAt:'2026-10-26T14:00',EndAt:'2026-10-26T14:30'});await page.locator('#apBookingForm [name=ConfirmPatient]').check();await page.locator('#apBookingForm button').last().click();await done('Appointment saved');assert.equal(f.rows('Appointments').length,1);
  await register();q=f.queries.length;await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=appointments]').click();await register();assert.equal(f.queries.length,q,'register reused without a query');await page.locator('#apRefreshRegister').click();await done('Selected appointment dates loaded');assert.equal(f.queries.length,q+1);
  await page.locator('[data-ap-open]').click();await done('Current appointment loaded');assert.equal(await page.locator('[data-ap-open]').count(),1,'opening detail retains register');
  await schedules();await page.locator('[data-ap-select]').click();await fill('apBookingForm',{StartAt:'2026-10-26T20:00',EndAt:'2026-10-26T20:30',Reason:'Patient asked to move appointment'});await page.locator('#apBookingForm [name=ConfirmPatient]').check();await page.locator('#apBookingForm button').last().click();await done('inside this doctor');
  await page.locator('#branch').selectOption('north');await page.locator('dialog[open] footer [data-app-dialog-cancel]').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('#branch').inputValue(),'main');assert.equal(await page.locator('#apBookingForm [name=StartAt]').inputValue(),'2026-10-26T20:00');
  await fill('apBookingForm',{StartAt:'2026-10-26T15:00',EndAt:'2026-10-26T15:30'});await page.locator('#apBookingForm button').last().click();await done('Appointment saved');assert.equal(f.rows('AppointmentEvents').length,2);
  await dates('apHist');await page.locator('#apHistoryForm button').first().click();await done('Selected appointment history loaded');assert.match(await page.locator('#apHistory').textContent(),/Rescheduled/);
  await page.locator('#apArrivalForm [name=ConfirmPatient]').check();await page.locator('#apArrivalForm button').click();await done('Arrival saved');assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('Appointments')[0].Status,'Arrived');
  await page.locator('#apReception').click();await dates('visit');await page.locator('#visitForm button').click();await done('Selected visit period loaded');await page.locator('[data-followup-visit]').click();await done('Choose the doctor');await schedules('2026-10-27');await page.locator('[data-ap-select]').click();
  await fill('apBookingForm',{Reference:'UI-FOLLOWUP-001',StartAt:'2026-10-27T10:00',EndAt:'2026-10-27T10:30'});await page.locator('#apBookingForm [name=ConfirmPatient]').check();await page.locator('#apBookingForm button').last().click();await done('Appointment saved');assert.equal(f.rows('Appointments')[1].FollowUpVisitId,f.rows('Visits')[0].VisitId);
  await page.locator('#apClosureForm [name=Reason]').fill('Patient requested cancellation');await page.locator('#apClosureForm [name=ConfirmPatient]').check();await page.locator('#apClosureForm button').click();await done('Appointment outcome recorded');assert.equal(f.rows('Appointments')[1].Status,'Cancelled');assert.equal(f.rows('Patients').length,1);
  await register();await page.locator('[data-ap-open]').click();await done('Current appointment loaded');await dates('apHist');await page.locator('#apHistoryForm button').first().click();await done('Selected appointment history loaded');
  await page.screenshot({path:resolve(output,'appointments-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'appointments-phone.png'),fullPage:true});await page.setViewportSize({width:1366,height:960});
  await page.locator('#branch').selectOption('north');await done('Branch changed');assert.equal(await page.locator('#apName').textContent(),'');assert.equal(await page.locator('#apRegister').textContent(),'');
  await login('nurse');await register();await page.locator('[data-ap-open]').click();await done('Current appointment loaded');assert.equal(await page.locator('#apBookingForm').isVisible(),false);assert.equal(await page.locator('#apArrivalForm').isVisible(),false);
  await login('cashier');assert.equal(await page.locator('[data-tab=appointments]').isVisible(),false);
  await login('reception');await register();await page.locator('[data-ap-open]').click();await done('Current appointment loaded');expire=true;await page.locator('#apRefresh').click();await done('Staff session expired');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#apName').textContent(),'');assert.deepEqual(errors,[]);
  console.log('PASS: clinic setup, patient booking, rescheduling, check-in, follow-up, cancellation, retained pages, explicit refresh, failed-save drafts, role/branch/session controls and desktop/phone layouts.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
