import {hospitalBrowserAssets} from './helpers/hospital-browser-assets.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {appointmentsFixture,appointmentActors} from '../tests/helpers/hospital-appointments-fixture.mjs';
import {env,request} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalPatientBookingAction} from '../functions/lib/hospital-patient-booking.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-patient-booking-ui');await mkdir(output,{recursive:true});
const f=await appointmentsFixture();f.reset();f.db.staffAccessFor=async()=>({edition:'hospital',allowedSections:['hospitalReception']});
let role='admin',delay=false,release;const calls=[];
const assets=hospitalBrowserAssets();for(const p of ['/hospital-booking.html','/js/hospital-patient-booking.js','/css/hospital-booking.css'])assets.add(p);
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname,user={...appointmentActors[role],assignedBranchIds:['main','north'],activeBranchId:req.headers['x-dynamax-branch']||'main'};
  res.setHeader('Content-Type','application/json');
  if(path==='/api/staff-session'){res.end(JSON.stringify({ok:true,authenticated:true,user,session:{id:'self-booking-fixture',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}));return;}
  if(path==='/api/staff-hospital'||path==='/api/hospital-patient-booking'){
   let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);calls.push({path,action:body.action});
   const data=path==='/api/staff-hospital'?await createHospitalService(env,user,f.db)[body.action](body):await hospitalPatientBookingAction(env,req.headers.authorization?.slice(7),body,f.db);
   if(delay&&path==='/api/hospital-patient-booking')await new Promise(r=>{release=r;});
   res.end(JSON.stringify(data));return;
  }
  if(!assets.has(path)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(resolve(root,'.'+path)));
 }catch(e){res.writeHead(e.status||500);res.end(JSON.stringify({ok:false,message:e.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 const staff=await browser.newPage({viewport:{width:1366,height:960}}),errors=[];staff.on('pageerror',e=>errors.push(e.message));
 const done=async text=>staff.waitForFunction(t=>document.querySelector('#status').textContent.includes(t)&&!document.querySelector('#refresh').disabled,text);
 await staff.goto(base+'/hospital.html?task=appointments');await done('Hospital reception ready');assert.equal(f.queries.length,0);
 await staff.locator('#apSchedulesSection').evaluate(e=>e.open=true);await staff.locator('#apSchedFrom').fill('2026-10-26');await staff.locator('#apSchedTo').fill('2026-10-26');await staff.locator('#apSchedulesForm button').first().click();await done('Selected clinic dates loaded');await staff.locator('[data-ap-edit]').click();
 await staff.locator('#apScheduleEditor [name=SelfBookingEnabled]').selectOption('true');await staff.locator('#apScheduleEditor [name=SlotMinutes]').fill('30');await staff.locator('#apScheduleEditor button').first().click();await done('Clinic availability saved');assert.equal(f.rows('AppointmentSchedules')[0].SelfBookingEnabled,true);
 await staff.locator('[data-tab=patients]').click();await staff.locator('#searchValue').fill('Patient');await staff.locator('#searchForm button').first().click();await done('Patient search complete');await staff.locator('[data-patient]').click();await done('Patient registration loaded');await staff.locator('#bookPatientAppointment').click();await done('Choose the doctor');
 await staff.locator('#pbOpen').click();await staff.locator('#pbPanel').waitFor({state:'visible'});assert.equal(f.rows('PatientBookingLinks').length,0);
 await staff.locator('#pbIssueForm [name=ConfirmPatient]').check();await staff.locator('#pbIssueForm button').first().click();await done('Personal booking link ready');const link=await staff.locator('#pbLink').inputValue();assert.match(link,/#access=[a-f0-9]{64}$/);
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-26T12:00:00Z')});
 const ready=async text=>{try{await page.waitForFunction(t=>document.querySelector('#message').textContent.includes(t)&&!document.querySelector('#accessForm button').disabled,text,{timeout:8000});}catch(e){console.error('Expected:',text,'Actual:',await page.locator('#message').textContent(),errors);throw e;}};
 const count=a=>calls.filter(c=>c.path==='/api/hospital-patient-booking'&&c.action===a).length;
 await page.goto(link);assert.equal(new URL(page.url()).hash,'');assert.equal(count('context'),0);await page.locator('#accessForm button').click();await ready('Choose a clinic date');assert.equal(count('clinics'),0);
 await page.locator('#clinicForm button').first().click();await ready('Selected clinic date loaded');await page.locator('#clinicForm button').first().click();await ready('Selected clinic date loaded');assert.equal(count('clinics'),1);
 await page.locator('[data-clinic]').click();await ready('Available times loaded');await page.locator('#clinicForm button').first().click();await ready('Selected clinic date loaded');await page.locator('[data-clinic]').click();await ready('Available times loaded');assert.equal(count('slots'),1);
 await page.locator('#slots input').first().check();await page.locator('#bookForm [name=ConfirmBooking]').check();await page.locator('#book').click();await ready('Your appointment is confirmed');assert.equal(f.rows('Appointments').length,1);
 const saved=f.rows('Appointments')[0].StartAt;await page.locator('#clinicForm button').first().click();await ready('Selected clinic date loaded');await page.locator('[data-clinic]').click();await ready('Available times loaded');
 await page.locator('#slots input').last().check();await page.locator('#bookForm [name=Reason]').fill('Patient needs a later time');await page.locator('#bookForm [name=ConfirmBooking]').check();await page.locator('#book').click();await ready('Your appointment is confirmed');assert.equal(f.rows('Appointments').length,1);assert.notEqual(f.rows('Appointments')[0].StartAt,saved);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'phone.png'),fullPage:true});
 const reads=f.reads.length,writes=f.commits.length;await page.evaluate(()=>window.print=()=>window.__printed=true);await page.locator('#print').click();assert.equal(await page.evaluate(()=>window.__printed),true);assert.equal(f.reads.length,reads);assert.equal(f.commits.length,writes);
 await page.setViewportSize({width:1366,height:960});await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});
 await page.locator('#cancelForm [name=Reason]').fill('Patient cannot attend on this day');await page.locator('#cancelForm [name=ConfirmBooking]').check();await page.locator('#cancelForm button').click();await ready('Appointment cancelled');assert.equal(f.rows('Appointments')[0].Status,'Cancelled');assert.equal(f.rows('AppointmentEvents').length,3);
 delay=true;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#message').textContent==='Please wait…');await page.locator('#exit').click();while(!release)await new Promise(r=>setTimeout(r,10));release();delay=false;await ready('Private session closed');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#patientName').textContent(),'');assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 await page.goto(link);await page.locator('#accessForm button').click();await ready('Contact Reception');await staff.locator('#pbRevoke').click();await done('Booking link disabled');await page.locator('#refresh').click();await ready('no longer available');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#bookingDetails').textContent(),'');
 role='nurse';await staff.goto(base+'/hospital.html?task=appointments');await done('Hospital reception ready');assert.equal(await staff.locator('#pbOpen').isVisible(),false);assert.deepEqual(errors,[]);
 console.log('PASS: explicit clinic setup and link issue, no entry scans, cached clinic/slot reads, booking/reschedule/cancel, print without reads, phone layout, in-flight session clearing, revoked links and role controls.');
}finally{release?.();await browser?.close();await new Promise(r=>server.close(r));}
