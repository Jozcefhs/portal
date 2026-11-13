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
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-recurring-ui');await mkdir(output,{recursive:true});
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
  const login=async name=>{role=name;const q=f.queries.length,r=f.reads.length;await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=appointments`);await done('Hospital reception ready');assert.equal(f.reads.length,r);assert.equal(f.queries.length,q);await page.locator('#rcSection').evaluate(e=>{e.open=true;});};
  const fill=async(form,fields)=>{for(const [name,value] of Object.entries(fields))await page.locator(`#${form} [name="${name}"]`).fill(String(value));};
  const dates=async(p,from='2026-10-26',to=from)=>{await page.locator(`#${p}From`).fill(from);await page.locator(`#${p}To`).fill(to);};
  const confirm=async()=>{await page.locator('dialog[open] footer button').last().click();};
  await login('admin');assert.equal(await page.locator('#rcList').textContent(),'');await page.locator('#rcNew').click();await done('Enter a recurring clinic pattern');
  await fill('rcEditor',{Reference:'UI-WEEKLY-001',Name:'Weekly outpatients',Clinician:'doctor',Department:'Outpatients',Windows:'13:00-18:00'});
  for(const d of [1,3,5])await page.locator(`#rcEditor [name=Weekdays][value="${d}"]`).check();
  await page.locator('#rcSave').click();await done('Recurring clinic template saved');assert.equal(f.rows('ClinicTemplates').length,1);
  await page.locator('#rcListForm button').first().click();await done('Selected clinic templates loaded');let q=f.queries.length;
  await page.locator('#rcListForm button').first().click();await done('Selected clinic templates loaded');assert.equal(f.queries.length,q);
  await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=appointments]').click();await page.locator('#rcListForm button').first().click();await done('Selected clinic templates loaded');assert.equal(f.queries.length,q);
  await page.locator('#rcRefresh').click();await done('Selected clinic templates loaded');assert.equal(f.queries.length,q+1);
  await dates('rcGen','2026-10-26','2026-11-01');const commits=f.commits.length;await page.locator('#rcPreviewForm button').click();await done('Clinic date preview ready');assert.equal(f.commits.length,commits);assert.match(await page.locator('#rcSummary').textContent(),/2 to create · 1 already available/);
  await page.evaluate(()=>{window.print=()=>{window.__prints=(window.__prints||0)+1;};});let reads=f.reads.length;q=f.queries.length;
  await page.locator('#rcPrint').click();assert.equal(await page.evaluate(()=>window.__prints),1);assert.equal(f.reads.length,reads);assert.equal(f.queries.length,q);
  await page.screenshot({path:resolve(output,'recurring-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'recurring-phone.png'),fullPage:true});await page.setViewportSize({width:1366,height:960});
  await page.locator('#rcGenerate').click();await confirm();await done('2 clinic days created');assert.equal(f.rows('AppointmentSchedules').length,3);
  await page.locator('#rcPreviewForm button').click();await done('Clinic date preview ready');assert.match(await page.locator('#rcSummary').textContent(),/0 to create · 3 already available/);assert.equal(await page.locator('#rcGenerate').isVisible(),false);
  await fill('rcEditor',{Windows:'14:00-17:00',Reason:'Clinic doctor revised their availability'});assert.equal(await page.locator('#rcPrint').isVisible(),false);await page.locator('#rcSave').click();await done('Recurring clinic template saved');
  await page.locator('#rcPreviewForm button').click();await done('Clinic date preview ready');assert.match(await page.locator('#rcSummary').textContent(),/3 need review/);assert.equal(f.rows('AppointmentSchedules')[0].Windows[0].From,'13:00');
  await dates('rcHist');await page.locator('#rcHistoryForm button').first().click();await done('Selected clinic template history loaded');assert.match(await page.locator('#rcHistory').textContent(),/Clinic days generated/);
  reads=f.reads.length;q=f.queries.length;await page.locator('#rcPrintHistory').click();assert.equal(f.reads.length,reads);assert.equal(f.queries.length,q);
  // A manual day created after preview is detected; no partial generation occurs.
  await dates('rcGen','2026-11-02','2026-11-08');await page.locator('#rcPreviewForm button').click();await done('Clinic date preview ready');
  await f.schedule({Day:'2026-11-04',Department:'Other clinic'});await page.locator('#rcGenerate').click();await confirm();await done('changed since this preview');assert.equal(f.rows('AppointmentSchedules').length,4);
  await page.locator('#rcPreviewForm button').click();await done('Clinic date preview ready');await page.locator('#rcGenerate').click();await confirm();await done('2 clinic days created');assert.equal(f.rows('AppointmentSchedules').length,6);
  await page.locator('#rcEditor [name=Active]').selectOption('false');await fill('rcEditor',{Reason:'Pause future clinic generation'});await page.locator('#rcSave').click();await done('Recurring clinic template saved');assert.equal(await page.locator('#rcGeneration').isVisible(),false);assert.equal(f.rows('AppointmentSchedules').length,6);
  await page.locator('#rcActive').selectOption('false');await page.locator('#rcListForm button').first().click();await done('Selected clinic templates loaded');assert.match(await page.locator('#rcList').textContent(),/Weekly outpatients/);
  // Failed validation preserves edits; a branch switch offers a discard decision.
  await page.locator('#rcNew').click();await done('Enter a recurring clinic pattern');await fill('rcEditor',{Reference:'BAD-WEEKLY',Name:'Unsaved clinic',Clinician:'doctor',Department:'Outpatients',Windows:'invalid'});await page.locator('#rcEditor [name=Weekdays][value="1"]').check();await page.locator('#rcSave').click();await done('Use one HH:MM');assert.equal(await page.locator('#rcEditor [name=Name]').inputValue(),'Unsaved clinic');
  await page.locator('#branch').selectOption('north');await page.locator('dialog[open] footer button').first().click();assert.equal(await page.locator('#branch').inputValue(),'main');
  await page.locator('#branch').selectOption('north');await confirm();await done('Branch changed');assert.equal(await page.locator('#rcDetail').isVisible(),false);assert.equal(await page.locator('#rcList').textContent(),'');
  await login('nurse');assert.equal(await page.locator('#rcNew').isVisible(),false);await page.locator('#rcActive').selectOption('false');await page.locator('#rcListForm button').first().click();await done('Selected clinic templates loaded');await page.locator('[data-rc-open]').click();await done('Current clinic template loaded');assert.equal(await page.locator('#rcEditor [name=Name]').isDisabled(),true);assert.equal(await page.locator('#rcSave').isVisible(),false);
  expire=true;await page.locator('#rcReload').click();await done('Staff session expired');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#rcTitle').textContent(),'');assert.deepEqual(errors,[]);
  console.log('PASS: recurring templates, cached pages, preview/print without writes, generation, conflicts, history, pause, discard, permission/session clearing and desktop/phone layouts.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
