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
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-reminders-ui');await mkdir(output,{recursive:true});
const f=await appointmentsFixture();let role='admin',expire=false;const sent=[];
f.rows('Patients')[0].Email='patient@example.test';await f.book();f.db.sendConfiguredEmail=async(e,m)=>{sent.push(m);return {ok:true,provider:'synthetic',providerMessageId:'test-message'};};
const assets = hospitalBrowserAssets();
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname,user={...appointmentActors[role],assignedBranchIds:['main','north'],activeBranchId:req.headers['x-dynamax-branch']||'main'};
    if(path==='/api/staff-session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,authenticated:true,user,session:{id:'appointments-fixture',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}));return;}
    if(path==='/api/staff-hospital'){
      if(expire)throw Object.assign(Error('Staff session expired'),{status:401});let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw),data=await createHospitalService({...env,BREVO_API_KEY:"synthetic-test"},user,f.db)[body.action](body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    if(!assets.has(path)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(resolve(root,'.'+path)));
  }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const done=async text=>{try{await page.waitForFunction(text=>document.querySelector('#status').textContent.includes(text)&&!document.querySelector('#refresh').disabled,text,{timeout:8000});}catch(e){console.error('Expected',text,'Status',await page.locator('#status').textContent(),'Errors',errors);throw e;}};
  const login=async name=>{role=name;const q=f.queries.length,r=f.reads.length;await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=appointments`);await done('Hospital reception ready');assert.equal(f.reads.length,r);assert.equal(f.queries.length,q);};
  const dates=async(p)=>{await page.locator(`#${p}From`).fill('2026-10-26');await page.locator(`#${p}To`).fill('2026-10-26');};
  await login('admin');await page.locator('#arSection summary').click();const initialReads=f.reads.length;assert.equal(f.reads.length,initialReads);
  await dates('apReg');await page.locator('#apRegisterForm button').first().click();await done('Selected appointment dates loaded');await page.locator('[data-ap-open]').click();await done('Current appointment loaded');
  const writes=f.commits.length;await page.locator('#arPreview').click();await done('Appointment reminder preview ready');assert.equal(f.commits.length,writes);assert.match(await page.locator('#arContact').textContent(),/patient@example.test/);assert.equal(sent.length,0);
  await page.locator('#arQueueForm [name=DueAt]').fill('2026-10-26T13:00');await page.locator('#arQueueForm [name=Consent]').check();await page.locator('#arQueue').click();await done('Appointment reminder scheduled');assert.equal(f.rows('AppointmentReminders').length,1);
  await page.locator('#arListForm button').first().click();await done('Selected reminders loaded');let q=f.queries.length;await page.locator('#arListForm button').first().click();await done('Selected reminders loaded');assert.equal(f.queries.length,q);
  await page.locator('#arSend').click();await done('Reminder processing: Accepted');assert.equal(sent.length,1);assert.equal(await page.locator('#arSend').isVisible(),false);
  await page.locator('#arListForm button').first().click();await done('Selected reminders loaded');assert.match(await page.locator('#arList').textContent(),/No reminders/);
  await page.locator('#arStatus').selectOption('Accepted');assert.equal(await page.locator('#arDates').isVisible(),true);await dates('arList');await page.locator('#arListForm button').first().click();await done('Selected reminders loaded');assert.match(await page.locator('#arList').textContent(),/Accepted/);
  await dates('arHist');await page.locator('#arHistoryForm button').click();await done('Selected reminder history loaded');assert.match(await page.locator('#arHistory').textContent(),/Queued/);assert.match(await page.locator('#arHistory').textContent(),/Accepted/);
  await page.screenshot({path:resolve(output,'reminders-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'reminders-phone.png'),fullPage:true});await page.setViewportSize({width:1366,height:960});
  await page.locator('#arPreview').click();await done('Appointment reminder preview ready');assert.equal(await page.locator('#arQueue').isVisible(),false);assert.equal(sent.length,1);
  await page.locator('#branch').selectOption('north');await done('Branch changed');assert.equal(await page.locator('#arDetail').isVisible(),false);assert.equal(await page.locator('#arList').textContent(),'');assert.equal(await page.locator('#arText').textContent(),'');
  await login('nurse');await page.locator('#arSection summary').click();await page.locator('#arStatus').selectOption('Accepted');await dates('arList');await page.locator('#arListForm button').first().click();await done('Selected reminders loaded');await page.locator('[data-ar-open]').click();await done('Current reminder loaded');assert.equal(await page.locator('#arChangeForm').isVisible(),false);assert.equal(await page.locator('#arSend').isVisible(),false);
  expire=true;await page.locator('#arReload').click();await done('Staff session expired');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#arText').textContent(),'');assert.deepEqual(errors,[]);
  console.log('PASS: reminder preview, consent, queue, provider acceptance, duplicate prevention, cached pages, date history, branch/session clearing, read-only roles and desktop/phone layouts.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
