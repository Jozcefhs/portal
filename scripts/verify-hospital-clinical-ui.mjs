import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fixture,actor,env,request} from '../tests/helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/hospital-clinical-ui');
await mkdir(output,{recursive:true});
const f=fixture(),{PatientId}=await f.register();
await f.service.checkIn(request({PatientId,Department:'Outpatients'}));
const doctor={...actor,username:'doctor',displayName:'Doctor Example',role:'Doctor',assignedBranchIds:['main','north'],
  allowedSections:['hospitalPatients','hospitalReception','hospitalTriage','hospitalConsultations']};
const assets=new Set(['/hospital.html','/css/hospital.css','/css/app-dialogs.css','/js/hospital.js','/js/hospital-appointments.js','/js/hospital-referrals.js','/js/hospital-clinical.js','/js/staff-idle-session.js','/js/app-dialogs.js']);
assets.add('/js/hospital-orders.js'); assets.add('/js/hospital-billing.js'); assets.add('/js/hospital-funds.js'); assets.add('/js/hospital-corporate.js');assets.add('/js/hospital-inpatients.js');assets.add('/js/hospital-nursing.js');assets.add('/js/hospital-theatre.js');
const actions=[];let expire=false;
f.queries.length=0;
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/api/staff-session'){
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({ok:true,authenticated:true,user:doctor,session:{id:'clinical-fixture',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}));return;
    }
    if(path==='/api/staff-hospital'){
      if(expire)throw Object.assign(new Error('Staff session expired'),{status:401});
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);actions.push(body.action);
      const user={...doctor,activeBranchId:req.headers['x-dynamax-branch']||'main'};
      const data=await createHospitalService(env,user,f.db)[body.action](body);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    if(!assets.has(path)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(resolve(root,'.'+path)));
  }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1366,height:960}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html?task=consultations`);
  const done=async text=>{await page.locator('#status').filter({hasText:text}).waitFor();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);};
  const expand=async id=>{if(!await page.locator('#'+id).evaluate(el=>el.open))await page.locator('#'+id+' summary').click();};
  await done('Hospital reception ready');assert.equal(f.queries.length,0);
  await page.locator('[data-tab=reception]').click();
  await page.locator('#visitFrom').fill('2026-10-26');await page.locator('#visitTo').fill('2026-10-26');
  await page.locator('#visitForm button').click();await done('Selected visit period loaded');
  await page.locator('[data-care]').click();await done('Clinical encounter loaded');
  assert.equal(f.queries.length,1,'opening care uses point reads, not a history scan');
  assert.match(await page.locator('#careAllergies').textContent(),/Unknown/);
  await expand('triageEditor');
  await page.locator('#triageForm [name=Complaint]').fill('Synthetic patient complaint');
  await page.locator('#triageForm [name=AllergyStatus]').selectOption('Known allergies');
  await page.locator('#triageForm [name=Allergies]').fill('Synthetic allergy and reaction');
  await page.locator('#triageForm [name=TemperatureC]').fill('37.2');
  await page.locator('#triageForm button').click();await done('Triage recorded');
  assert.equal(f.rows('ClinicalEntries').length,1);assert.equal(f.rows('ClinicalEntries')[0].Content.Vitals.PulseBpm,undefined);
  assert.match(await page.locator('#careAllergies').textContent(),/Synthetic allergy/);
  await expand('consultationEditor');
  await page.locator('#consultationForm [name=History]').fill('Synthetic patient history');
  await page.locator('#consultationForm [name=Assessment]').fill('Clinician recorded assessment');
  await page.locator('#consultationForm [name=Plan]').fill('Clinician recorded plan');
  await page.locator('#refreshCare').click();await page.locator('dialog[open]').waitFor();
  await page.locator('dialog footer [data-app-dialog-cancel]').click();
  await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#consultationForm [name=History]').inputValue(),'Synthetic patient history');
  await page.locator('#branch').selectOption('north');await page.locator('dialog[open]').waitFor();
  await page.locator('dialog footer [data-app-dialog-cancel]').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#branch').inputValue(),'main');
  assert.equal(await page.locator('#consultationForm [name=History]').inputValue(),'Synthetic patient history');
  await page.locator('#consultationForm button').click();await done('Consultation draft saved');
  await page.locator('#confirmCareIdentity').check();assert.equal(await page.locator('#signConsultation').isEnabled(),true);
  await page.locator('#consultationForm [name=Plan]').fill('Updated clinician plan');assert.equal(await page.locator('#signConsultation').isEnabled(),false);
  await page.locator('#consultationForm button').click();await done('Consultation draft saved');
  await page.locator('#confirmCareIdentity').check();await page.locator('#signConsultation').click();await done('Consultation signed');
  assert.equal(f.rows('Consultations')[0].Status,'Signed');assert.equal(await page.locator('#consultationForm [name=History]').isEditable(),false);
  const signed=f.rows('ClinicalEntries').find(row=>row.Type==='Consultation'),original=structuredClone(signed);
  await expand('amendmentEditor');await page.locator('#amendEntry').selectOption(signed.EntryId);
  await page.locator('#amendmentForm [name=Reason]').fill('Clarification of the recorded plan');
  await page.locator('#amendmentForm [name=Text]').fill('Additional detail for this synthetic consultation.');
  await page.locator('#amendmentForm button').click();await done('Amendment saved');
  assert.deepEqual(f.rows('ClinicalEntries').find(row=>row.EntryId===signed.EntryId),original);
  assert.equal(actions.filter(action=>action==='clinicalHistory').length,0);
  await page.locator('#clinicalFrom').fill('2026-10-26');await page.locator('#clinicalTo').fill('2026-10-26');
  await page.locator('#clinicalHistoryForm button').click();await done('3 clinical entries loaded');
  assert.equal(await page.locator('#clinicalEntries article').count(),3);
  const reads=f.reads.length,queries=f.queries.length;
  await page.locator('[data-tab=reception]').click();await page.locator('[data-tab=care]').click();
  assert.equal(f.reads.length,reads);assert.equal(f.queries.length,queries);assert.equal(await page.locator('#clinicalEntries article').count(),3);
  await page.screenshot({path:resolve(output,'clinical-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone layout does not overflow');
  await page.screenshot({path:resolve(output,'clinical-phone.png'),fullPage:true});
  await page.locator('#branch').selectOption('north');await done('Branch changed');
  assert.equal(await page.locator('#careName').textContent(),'');assert.equal(await page.locator('#consultationForm [name=History]').inputValue(),'');
  assert.equal(await page.locator('#clinicalEntries article').count(),0);
  await page.locator('#branch').selectOption('main');await done('Branch changed');
  await page.locator('[data-tab=reception]').click();await page.locator('#visitFrom').fill('2026-10-26');await page.locator('#visitTo').fill('2026-10-26');
  await page.locator('#visitForm button').click();await done('Selected visit period loaded');await page.locator('[data-care]').click();await done('Clinical encounter loaded');
  expire=true;await page.locator('#refreshCare').click();await done('Staff session expired');
  assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#consultationForm [name=History]').inputValue(),'');
  assert.equal(await page.locator('#latestClinical').textContent(),'');assert.deepEqual(errors,[]);
  console.log('PASS: triage, author draft, signing, immutable amendment, unsaved-entry and branch cancellation, dated history, navigation cache, session clearing and desktop/phone layouts.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
