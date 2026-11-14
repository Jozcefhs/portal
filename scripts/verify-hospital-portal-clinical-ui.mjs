import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {clinicalPortalFixture} from '../tests/helpers/hospital-portal-clinical-fixture.mjs';
import {password} from '../tests/helpers/hospital-portal-fixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-portal-clinical-ui');await mkdir(output,{recursive:true});
const f=await clinicalPortalFixture(),calls=[],errors=[];
const staffHtml=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/hospital.css"><script src="/js/hospital-portal-clinical.js" defer></script></head><body><main><h1>Clinical release fixture</h1><p id="status"></p><div id="host"></div></main><script>window.addEventListener('DOMContentLoaded',()=>{window.currentType='investigations';window.share=DynamaxHospitalClinicalSharing.create({host:document.querySelector('#host'),getScope:()=>({DocumentType:currentType,ParentId:currentType==='investigations'?'order001':'admit001',PatientId:${JSON.stringify(f.PatientId)}}),allowed:()=>true,status:text=>document.querySelector('#status').textContent=text,run:async fn=>{try{await fn()}catch(e){document.querySelector('#status').textContent=e.message}},api:async(action,body,write)=>{const r=await fetch('/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action,BranchId:'main',...(write?{RequestId:crypto.randomUUID()}:{})})}),d=await r.json();if(!r.ok)throw Error(d.message);return d;}})});</script></body></html>`;
const assets=new Set(['/hospital-portal.html','/js/hospital-patient-portal.js','/js/hospital-messages-ui.js','/js/hospital-portal-clinical.js','/js/app-dialogs.js','/css/hospital-portal.css','/css/app-dialogs.css','/css/hospital.css']);
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/staff-fixture'){res.setHeader('Content-Type','text/html');res.end(staffHtml);return;}
 if(path==='/staff'||path==='/api/hospital-patient-portal'){
  let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);calls.push(b.action);
  const token=(req.headers.cookie||'').split('; ').find(v=>v.startsWith('fixture='))?.slice(8)||'';
  const data=path==='/staff'?await f.doctor[b.action](b):await f.call(b,token);const {cookieToken,clearCookie,...safe}=data;
  if(cookieToken)res.setHeader('Set-Cookie',`fixture=${cookieToken}; Path=/; HttpOnly; SameSite=Strict`);if(clearCookie)res.setHeader('Set-Cookie','fixture=; Path=/; Max-Age=0');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(safe));return;
 }
 if(!assets.has(path)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(resolve(root,'.'+path)));
}catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const staff=await browser.newPage({viewport:{width:1366,height:900}});staff.on('pageerror',e=>errors.push(e.message));
 await staff.goto(base+'/staff-fixture');assert.equal(calls.length,0);await staff.locator('summary').click();await staff.locator('[data-load]').click();await staff.waitForFunction(()=>document.querySelector('[data-sharing]').textContent.includes('Not shared'));
 await staff.locator('[name=Reason]').fill('Synthetic guardian consent verified');await staff.locator('[name=ConfirmConsent]').check();await staff.locator('[name=ConfirmClinicalReview]').check();await staff.locator('[data-publish]').click();await staff.waitForFunction(()=>document.querySelector('#status').textContent.includes('shared with'));
 await staff.screenshot({path:resolve(output,'staff-sharing.png'),fullPage:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-26T12:00:00Z')});
 const done=async text=>page.waitForFunction(t=>document.querySelector('#message').textContent.includes(t)&&!document.querySelector('#login').disabled,text);
 await page.goto(base+'/hospital-portal.html#code='+f.access.AccessCode+'&invite='+f.issue.InvitationToken);await page.locator('#password').fill(password);await page.locator('#confirmPassword').fill(password);await page.locator('#login').click();await done('Signed in. Choose');
 await page.locator('#documentType').selectOption('investigations');await page.locator('#recordsForm button').first().click();await done('Selected documents loaded');assert.match(await page.locator('#records').textContent(),/Demo investigation/);
 let n=calls.length;await page.locator('#recordsForm button').first().click();await done('Selected documents loaded');assert.equal(calls.length,n);
 await page.locator('[data-document]').click();await done('Document ready');assert.match(await page.locator('#document').textContent(),/Synthetic result.*<script>/);assert.equal(await page.locator('#document script').count(),0);assert.ok(!await page.locator('#document').textContent().then(t=>t.includes('Internal correction')));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'investigation-mobile.png'),fullPage:true});
 const reads=f.reads.length,writes=f.commits.length;await page.evaluate(()=>window.print=()=>window.__printed=true);await page.locator('#print').click();assert.equal(await page.evaluate(()=>window.__printed),true);assert.equal(f.reads.length,reads);assert.equal(f.commits.length,writes);
 await page.emulateMedia({media:'print'});await page.pdf({path:resolve(output,'investigation.pdf'),format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
 await staff.locator('[name=Reason]').fill('Synthetic withdrawal check');await staff.locator('[data-withdraw]').click();await staff.waitForFunction(()=>document.querySelector('#status').textContent.includes('withdrawn'));
 await page.locator('#closeDocument').click();await page.locator('[data-document]').click();await done('not shared');assert.equal(await page.locator('#document').textContent(),'');assert.equal(await page.locator('#documentPanel').isVisible(),false);
 await staff.evaluate(()=>{currentType='discharges';share.clear();});await staff.locator('summary').click();await staff.locator('[data-load]').click();await staff.waitForFunction(()=>document.querySelector('[data-sharing]').textContent.includes('Not shared'));
 await staff.locator('[name=Reason]').fill('Synthetic discharge consent');await staff.locator('[name=ConfirmConsent]').check();await staff.locator('[name=ConfirmClinicalReview]').check();await staff.locator('[data-publish]').click();await staff.waitForFunction(()=>document.querySelector('[data-sharing]').textContent==='Published');
 await page.locator('#documentType').selectOption('discharges');await page.locator('#recordsForm button').first().click();await done('Selected documents loaded');await page.locator('[data-document]').click();await done('Document ready');assert.match(await page.locator('#document').textContent(),/Synthetic diagnosis/);assert.match(await page.locator('#document').textContent(),/Demo follow-up/);
 await page.setViewportSize({width:1366,height:900});await page.screenshot({path:resolve(output,'discharge-desktop.png'),fullPage:true});await page.emulateMedia({media:'print'});await page.pdf({path:resolve(output,'discharge.pdf'),format:'A4',printBackground:true});
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'verification.json'),JSON.stringify({passed:true,checks:['clinician shares per named guardian','no entry reads','cached list','escaped clinical text','390px layout','print no reads/writes','withdrawal checked on reopen','signed discharge fields','no browser errors'],clinicalDocuments:f.rows('PortalClinicalDocuments').length},null,2));console.log('PASS: clinical staff sharing, named guardian access, withdrawal, private investigation/discharge rendering, cached lists and print without extra reads or writes.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
