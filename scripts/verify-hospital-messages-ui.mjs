import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {portalFixture,password,portalEnv} from '../tests/helpers/hospital-portal-fixture.mjs';
import {actor} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-messages-ui');await mkdir(output,{recursive:true});
const f=await portalFixture(),calls=[],errors=[],doctor={...actor,role:'Doctor',username:'doctor',displayName:'Sample Doctor',allowedSections:['hospitalPatients','hospitalReception','hospitalConsultations']},service=createHospitalService(portalEnv,doctor,f.db);
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/api/staff-session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({authenticated:true,user:doctor,session:{id:'fixture',expiresAt:Date.now()+7200000,lastActivityAt:Date.now(),serverNow:Date.now()}}));return;}
 if(path==='/api/staff-hospital'||path==='/api/hospital-patient-portal'){
  let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);calls.push(b.action);
  const token=(req.headers.cookie||'').split('; ').find(v=>v.startsWith('fixture='))?.slice(8)||'';
  const data=path==='/api/staff-hospital'?await service[b.action](b):await f.call(b,token);const {cookieToken,clearCookie,...safe}=data;
  if(cookieToken)res.setHeader('Set-Cookie',`fixture=${cookieToken}; Path=/; HttpOnly; SameSite=Strict`);if(clearCookie)res.setHeader('Set-Cookie','fixture=; Path=/; Max-Age=0');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(safe));return;
 }
 if(!['/hospital.html','/hospital-portal.html'].includes(path)&&!/^\/(js|css)\/[a-z0-9-]+\.(js|css)$/.test(path)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(resolve(root,'.'+path)));
}catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const staff=await browser.newPage({viewport:{width:1366,height:900}});staff.on('pageerror',e=>errors.push(e.message));
 const done=async(page,id,text)=>page.waitForFunction(([id,t])=>document.querySelector(id).textContent.includes(t)&&!document.querySelector(id).closest('main').querySelector('button:not([hidden])')?.disabled,[id,text]);
 await staff.goto(base+'/hospital.html');await done(staff,'#status','ready');assert.equal(calls.includes('messageInbox'),false);
 await staff.locator('#searchMode').selectOption('HospitalNumber');await staff.locator('#searchValue').fill((await f.details(f.PatientId)).HospitalNumber);await staff.locator('#searchForm button[type=submit]').click();await done(staff,'#status','search complete');await staff.locator('[data-patient]').click();await done(staff,'#status','registration loaded');
 await staff.locator('#startPatientMessage').click();await staff.locator('[data-compose]').waitFor({state:'visible'});await staff.locator('[data-new] [name=GrantId]').selectOption(f.access.GrantId);
 await staff.locator('[data-new] [name=Subject]').fill('Demo follow-up');await staff.locator('[data-new] [name=Text]').fill('Synthetic message <script>never execute</script>');await staff.locator('[data-new] [name=Reason]').fill('Verified synthetic guardian authority');await staff.locator('[data-new] [name=ConfirmConsent]').check();await staff.locator('[data-new] button[type="submit"], [data-new] button:not([type])').click();await done(staff,'#status','Private conversation opened');
 assert.equal(await staff.locator('[data-entries] script').count(),0);await staff.screenshot({path:resolve(output,'staff-conversation.png'),fullPage:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-26T12:00:00Z')});
 await page.goto(base+'/hospital-portal.html#code='+f.access.AccessCode+'&invite='+f.issue.InvitationToken);await page.locator('#password').fill(password);await page.locator('#confirmPassword').fill(password);await page.locator('#login').click();await done(page,'#message','Signed in.');
 const n=calls.length;await page.locator('#messagesPanel summary').click();await done(page,'#message','Conversations loaded');assert.equal(calls.length,n+1);await page.locator('[data-open]').click();await done(page,'#message','Conversation loaded');
 await page.locator('[data-reply] textarea').fill('Synthetic guardian reply');await page.locator('[data-reply] button').click();await done(page,'#message','Reply sent');assert.equal(f.rows('PortalMessages').length,2);assert.match(await page.locator('[data-entries]').textContent(),/Synthetic guardian reply/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,'guardian-mobile.png'),fullPage:true});
 await staff.locator('[data-reload-thread]').click();await done(staff,'#status','Conversation loaded');await staff.locator('[data-state] input').fill('Synthetic case resolved');await staff.locator('[data-toggle]').click();await done(staff,'#status','Conversation status saved');assert.equal(await staff.locator('[data-open]').count(),0);
 await page.locator('[data-reload-thread]').click();await done(page,'#message','Conversation loaded');assert.equal(await page.locator('[data-reply]').isVisible(),false);
 await page.locator('[data-inbox] select').selectOption('Closed');await page.locator('[data-inbox] [name=From]').fill('2026-10-26');await page.locator('[data-inbox] [name=To]').fill('2026-10-26');await page.locator('[data-inbox] button').first().click();await done(page,'#message','Conversations loaded');assert.equal(await page.locator('[data-open]').count(),1);
 const count=calls.length,writes=f.commits.length;await page.locator('[data-inbox] button').first().click();await done(page,'#message','Conversations loaded');assert.equal(calls.length,count);assert.equal(f.commits.length,writes);
 await page.locator('#logout').click();assert.equal(await page.locator('[data-entries]').textContent(),'');assert.equal(await page.locator('[data-list]').textContent(),'');
 const draftSafety=await staff.evaluate(async()=>{const host=document.createElement('section');document.body.append(host);let patient={PatientId:'patient-A',DisplayName:'Synthetic A',HospitalNumber:'DEMO-A'};
 const ui=DynamaxHospitalMessages.create({host,api:async()=>({rows:[],next:null}),run:fn=>fn(),status:()=>{},staff:true,getPatient:()=>patient});await ui.compose();host.querySelector('[data-new] [name=Text]').value='Private draft for A';host.querySelector('[data-new] [name=Subject]').value='A topic';patient={PatientId:'patient-B',DisplayName:'Synthetic B',HospitalNumber:'DEMO-B'};await ui.compose();const clean=!host.querySelector('[data-new] [name=Text]').value&&!host.querySelector('[data-new] [name=Subject]').value;host.remove();return clean;});assert.equal(draftSafety,true);
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'verification.json'),JSON.stringify({passed:true,checks:['actual hospital patient screen integration','clinician consent and guardian reply','escaped content','390px layout','close and dated history','cached list no extra reads/writes','logout clears messages','no browser errors']},null,2));console.log('PASS: hospital staff and guardian messaging UI, mobile, lifecycle, retained pages and privacy clearing.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
