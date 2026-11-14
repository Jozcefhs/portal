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
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-queues-ui');await mkdir(output,{recursive:true});
const f=await appointmentsFixture();const {VisitId}=await f.reception.checkIn({BranchId:'main',RequestId:crypto.randomUUID(),PatientId:f.PatientId,Department:'Outpatients'});f.setTime('2026-10-26T12:05:00Z');let role='admin',expire=false;
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
  const done=async text=>{try{await page.waitForFunction(text=>document.querySelector('#status').textContent.includes(text)&&!document.querySelector('#refresh').disabled,text,{timeout:10000});}catch(e){console.error('Expected',text,'Status',await page.locator('#status').textContent(),'Errors',errors);throw e;}};
  const login=async(name,task='patients')=>{role=name;await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=${task}`);await done(task==='queues'?'Clinic queue loaded':'Hospital reception ready');};
  await page.clock.install();await login('reception');f.reset();await page.locator('[data-tab=queues]').click();await done('Clinic queue loaded');assert.equal(f.queries.length,1);assert.equal(f.reads.length,0);assert.equal(f.commits.length,0);assert.equal(await page.locator('[data-cq-wait="0"]').textContent(),'5 min');
  let queries=f.queries.length;await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=queues]').click();await done('Clinic queue loaded');assert.equal(f.queries.length,queries);
  await page.clock.fastForward(61000);assert.equal(f.queries.length,queries);assert.equal(f.commits.length,0);assert.equal(await page.locator('[data-cq-wait="0"]').textContent(),'6 min');
  await page.locator('[data-cq-action=Call]').click();await page.locator('#cqConfirm').check();await page.locator('#cqSave').click();await done('Queue action saved');assert.equal(f.rows('ClinicQueueEvents').length,1);assert.match(await page.locator('#cqCounts').textContent(),/Called: 1/);
  await page.locator('[data-cq-action=Return]').click();await page.locator('#cqReason').fill('Patient went back to waiting area');await page.locator('#cqConfirm').check();await page.locator('#cqSave').click();await done('Queue action saved');assert.match(await page.locator('#cqCounts').textContent(),/Waiting: 1/);
  await page.locator('[data-cq-history]').click();await done('Queue history loaded');assert.match(await page.locator('#cqHistory').textContent(),/Call/);assert.match(await page.locator('#cqHistory').textContent(),/Return/);
  await page.locator('#cqHistoryClose').click();queries=f.queries.length;const reads=f.reads.length,commits=f.commits.length;
  await page.evaluate(()=>{window.print=()=>{window.__prints=(window.__prints||0)+1;};});await page.locator('#cqPrint').click();assert.equal(await page.locator('#cqPreview').isVisible(),true);await page.locator('#cqPrintNow').click();assert.equal(await page.evaluate(()=>window.__prints),1);await page.locator('#cqPreviewClose').click();assert.equal(f.queries.length,queries);assert.equal(f.reads.length,reads);assert.equal(f.commits.length,commits);
  await page.screenshot({path:resolve(output,'queues-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'queues-phone.png'),fullPage:true});await page.setViewportSize({width:1366,height:960});
  await page.locator('[data-cq-action=Start]').click();await page.locator('#cqConfirm').check();await page.locator('#cqSave').click();await done('Queue action saved');assert.equal(f.rows('Visits')[0].Status,'In progress');
  await page.locator('[data-cq-action=Complete]').click();await page.locator('#cqConfirm').check();await page.locator('#cqSave').click();await done('Queue action saved');assert.match(await page.locator('#cqRows').textContent(),/No matching visits/);assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('Visits')[0].Status,'Completed');
  queries=f.queries.length;await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=queues]').click();await done('Queue action saved');assert.equal(f.queries.length,queries,'empty snapshots are cached too');
  await page.locator('#cqView').selectOption('Completed');await page.locator('#cqFilters button').first().click();await done('Choose arrival dates');assert.equal(f.queries.length,queries);await page.locator('#cqFrom').fill('2026-10-26');await page.locator('#cqTo').fill('2026-10-26');await page.locator('#cqFilters button').first().click();await done('Clinic queue loaded');assert.match(await page.locator('#cqRows').textContent(),/Patient Test/);
  await page.locator('#branch').selectOption('north');await done('Branch changed');assert.equal(await page.locator('#cqRows').textContent(),'');assert.equal(await page.locator('#cqPatient').textContent(),'');
  await login('cashier','queues');assert.equal(await page.locator('[data-cq-action]').count(),0);await page.locator('#cqView').selectOption('Completed');await page.locator('#cqFrom').fill('2026-10-26');await page.locator('#cqTo').fill('2026-10-26');await page.locator('#cqFilters button').first().click();await done('Clinic queue loaded');assert.equal(await page.locator('[data-cq-care]').count(),0);
  expire=true;await page.locator('#cqRefresh').click();await done('Staff session expired');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#cqRows').textContent(),'');assert.deepEqual(errors,[]);
  console.log('PASS: current queue auto-load, no-read cached/empty navigation, local timers, call/return/start/complete, retained events, explicit history dates, no-read preview/print, branch/session clearing and desktop/phone layout.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
