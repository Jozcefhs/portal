import {hospitalBrowserAssets} from './helpers/hospital-browser-assets.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {portalFixture,portalEnv,password} from '../tests/helpers/hospital-portal-fixture.mjs';
import {actor} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalPatientPortalAction} from '../functions/lib/hospital-patient-portal.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-patient-portal-ui');await mkdir(output,{recursive:true});
const f=await portalFixture(),calls=[],errors=[];let delay=false,release;
const assets=hospitalBrowserAssets();for(const p of ['/hospital-portal.html','/js/hospital-patient-portal.js','/js/hospital-messages-ui.js','/css/hospital-portal.css'])assets.add(p);
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type','application/json');
  if(path==='/api/staff-session'){res.end(JSON.stringify({ok:true,authenticated:true,user:actor,session:{id:'portal-fixture-session',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}));return;}
  if(path==='/api/staff-hospital'||path==='/api/hospital-patient-portal'){
    let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);calls.push({path,action:body.action});
    const token=(req.headers.cookie||'').split('; ').find(c=>c.startsWith('fixturePortal='))?.slice(14)||'';
    const data=path==='/api/staff-hospital'?await createHospitalService(portalEnv,actor,f.db)[body.action](body):await hospitalPatientPortalAction(portalEnv,token,body,f.db);
    if(delay&&path==='/api/hospital-patient-portal'&&body.action==='invoices')await new Promise(r=>release=r);
    const {cookieToken,clearCookie,...payload}=data;if(cookieToken)res.setHeader('Set-Cookie',`fixturePortal=${cookieToken}; Path=/; HttpOnly; SameSite=Strict`);if(clearCookie)res.setHeader('Set-Cookie','fixturePortal=; Path=/; Max-Age=0');res.end(JSON.stringify(payload));return;
  }
  if(!assets.has(path)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(resolve(root,'.'+path)));
}catch(e){res.writeHead(e.status||500);res.end(JSON.stringify({ok:false,message:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
 const staff=await browser.newPage({viewport:{width:1366,height:900}});staff.on('pageerror',e=>errors.push(e.message));
 const staffDone=async text=>staff.waitForFunction(t=>document.querySelector('#status').textContent.includes(t)&&!document.querySelector('#refresh').disabled,text);
 await staff.goto(base+'/hospital.html');await staffDone('Hospital reception ready');assert.equal(f.queries.length,0);
 await staff.locator('#searchValue').fill('Patient');await staff.locator('#searchForm button').first().click();await staffDone('Patient search complete');await staff.locator('[data-patient]').click();await staffDone('Patient registration loaded');
 await staff.locator('#hpAccessOpen').click();await staffDone('Patient portal access loaded');assert.match(await staff.locator('#hpAccessRows').textContent(),/Fixture Guardian/);
 await staff.locator('#hpAccessForm [name=Kind]').selectOption('Patient');await staff.locator('#hpAccessForm [name=RecipientName]').fill('Test Patient');await staff.locator('#hpAccessForm [name=Contact]').fill('patient@example.invalid');await staff.locator('#hpAccessForm [name=Reason]').fill('Patient verified and consents');await staff.locator('#hpAccessForm [name=AccessUntil]').fill('2027-10-26');
 await staff.locator('#hpAccessForm [name=ConfirmIdentity]').check();await staff.locator('#hpAccessForm [name=ConfirmAuthority]').check();await staff.locator('#hpAccessForm button').first().click();await staffDone('Private portal invitation ready');
 const link=await staff.locator('#hpAccessLink').inputValue();assert.match(link,/#code=HP-/);
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-26T12:00:00Z')});
 const done=async text=>{try{await page.waitForFunction(t=>document.querySelector('#message').textContent.includes(t)&&!document.querySelector('#login').disabled,text,{timeout:10000});}catch(e){throw Error(`Expected ${text}; got ${await page.locator('#message').textContent()}; errors ${errors.join(',')}`);}};
 await page.goto(link);assert.equal(new URL(page.url()).hash,'');assert.equal(calls.filter(c=>c.path==='/api/hospital-patient-portal').length,0);
 const accessCode=await page.locator('#accessCode').inputValue();await page.locator('#password').fill(password);await page.locator('#confirmPassword').fill(password);await page.locator('#login').click();await done('Signed in. Choose document dates');
 assert.equal(calls.filter(c=>c.action==='invoices').length,0);await page.locator('#recordsForm button').first().click();await done('Selected documents loaded');assert.match(await page.locator('#records').textContent(),/HI-TEST001/);
 const requests=calls.length;await page.locator('#recordsForm button').first().click();await done('Selected documents loaded');assert.equal(calls.length,requests);
 await page.locator('[data-document]').click();await done('Document ready');assert.match(await page.locator('#document').textContent(),/510/);assert.match(await page.locator('#document').textContent(),/HMO/);
 const reads=f.reads.length,writes=f.commits.length;await page.evaluate(()=>window.print=()=>window.__printed=true);await page.locator('#print').click();assert.equal(await page.evaluate(()=>window.__printed),true);assert.equal(f.reads.length,reads);assert.equal(f.commits.length,writes);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'phone.png'),fullPage:true});
 await page.setViewportSize({width:1366,height:900});await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});await page.emulateMedia({media:'print'});assert.equal(await page.locator('#recordsForm').isVisible(),false);assert.equal(await page.locator('#document').isVisible(),true);await page.emulateMedia({media:'screen'});
 await page.locator('#documentType').selectOption('receipts');await page.locator('#recordsForm button').first().click();await done('Selected documents loaded');assert.match(await page.locator('#records').textContent(),/not a new payment/);
 await page.locator('#documentType').selectOption('deposits');await page.locator('#recordsForm button').first().click();await done('Selected documents loaded');await page.locator('[data-document]').click();await done('Document ready');assert.match(await page.locator('#document').textContent(),/Unused advance/);
 await page.locator('#documentType').selectOption('invoices');delay=true;await page.locator('#refresh').click();while(!release)await new Promise(r=>setTimeout(r,10));await page.locator('#logout').click();release();delay=false;await done('Signed out');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#patientName').textContent(),'');
 await page.locator('#accessCode').fill(accessCode);await page.locator('#password').fill(password);await page.locator('#login').click();await done('Signed in. Choose document dates');
 await page.getByText('Change password', {exact:true}).click();await page.locator('[name=CurrentPassword]').fill(password);await page.locator('[name=Password]').fill('New fixture portal password!');await page.locator('[name=ConfirmPassword]').fill('New fixture portal password!');await page.locator('#passwordForm button').click();await done('Password changed.');
 await page.locator('#accessCode').fill(accessCode);await page.locator('#password').fill('New fixture portal password!');await page.locator('#login').click();await done('Signed in. Choose document dates');
 await staff.locator('#hpAccessRefresh').click();await staffDone('Portal access refreshed');const patientRow=staff.locator('#hpAccessRows tr').filter({hasText:'Test Patient'});staff.once('dialog',d=>d.accept('Synthetic verification revoke'));await patientRow.locator('[data-revoke]').click();await staffDone('Portal access revoked');
 await page.locator('#refresh').click();await done('Access is unavailable');assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.deepEqual(errors,[]);
 console.log('PASS: staff authorisation, one-use activation, password login/change, scoped invoices/receipts/deposits, cached repeat loads, print without reads/writes, mobile layout, in-flight sign-out, revocation and no browser storage.');
}finally{release?.();await browser?.close();await new Promise(r=>server.close(r));}
