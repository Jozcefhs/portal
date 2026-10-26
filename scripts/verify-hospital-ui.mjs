import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fixture, actor, env } from '../tests/helpers/hospital-fixture.mjs';
import { createHospitalService } from '../functions/lib/hospital-service.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f = fixture(), root = resolve(import.meta.dirname, '..'), output = resolve(root, 'tmp/hospital-ui');
await mkdir(output, { recursive: true });
const assets = new Set(['/hospital.html','/css/hospital.css','/js/hospital.js','/js/staff-idle-session.js']);
assets.add('/css/app-dialogs.css'); assets.add('/js/app-dialogs.js');
assets.add('/js/hospital-clinical.js');
let expire = false;
const server = createServer(async (req,res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/staff-session') {
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({ ok:true, authenticated:true, user:actor, session:{id:'hospital-fixture',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()} }));return;
    }
    if (path === '/api/staff-hospital') {
      if (expire) throw Object.assign(new Error('Staff session expired'),{status:401});
      let raw=''; for await (const chunk of req) raw+=chunk;
      const body=JSON.parse(raw);
      const user={...actor, assignedBranchIds:['main','north'], activeBranchId:req.headers['x-dynamax-branch'] || 'main'};
      const data=await createHospitalService(env,user,f.db)[body.action](body);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    if (!assets.has(path)) {res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(resolve(root,'.'+path)));
  } catch(error) {res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1366,height:900}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/hospital.html`);
  const done = async text => { await page.locator('#status').filter({hasText:text}).waitFor(); await page.waitForFunction(()=>!document.querySelector('#refresh').disabled); };
  await done('Hospital reception ready');
  assert.equal(f.queries.length,0,'opening reception must not scan patients or visits');
  await page.locator('#newPatient').click();
  await page.locator('[name=FirstName]').fill('Ada');await page.locator('[name=LastName]').fill('Fixture');
  await page.locator('[name=DateOfBirth]').fill('2000-01-02');await page.locator('[name=Phone]').fill('08000000000');
  await page.locator('#patientForm button[type=submit]').click();await done('Patient registration saved');
  assert.equal(f.rows('Patients').length,1);assert.equal(f.rows('Patients')[0].FirstName,'Ada');
  const patientId=f.rows('Patients')[0].PatientId;
  await page.locator('#scanAssign').click();await done('USB keyboard-mode');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'cardUid');
  await page.locator('#cardUid').fill('01:02:03:04');await page.locator('#cardForm button[type=submit]').click();await done('NFC card assignment saved');
  assert.equal(f.rows('Cards')[0].Status,'Active');
  await page.locator('[name=Department]').fill('Outpatients');await page.locator('#checkInForm button[type=submit]').click();await done('Patient checked in');
  await page.screenshot({path:resolve(output,'patient-nfc-desktop.png'),fullPage:true});
  await page.locator('#cardUid').fill('05:06:07:08');await page.locator('#cardReason').fill('Lost original card');
  await page.locator('#cardForm button[type=submit]').click();await done('NFC card assignment saved');
  assert.equal(f.rows('Patients')[0].PatientId,patientId);assert.deepEqual(f.rows('Cards').map(row=>row.Status),['Replaced','Active']);
  await page.locator('#closePatient').click();await page.locator('#searchMode').selectOption('CardUid');await page.locator('#searchValue').fill('05060708');
  await page.locator('#searchForm button[type=submit]').click();await done('Patient search complete');
  await page.locator('[data-patient]').click();await done('Patient registration loaded');
  await page.evaluate(()=>{window.NDEFReader=class {constructor(){window.fixtureNfcReader=this;}async scan(){}};});
  await page.locator('#scanLookup').click();await done('Hold the NFC card');
  await page.evaluate(()=>window.fixtureNfcReader.onreading({serialNumber:'05:06:07:08'}));await done('Patient search complete');
  assert.equal(await page.locator('[data-patient]').count(),1,'browser serial event finds the same patient');
  await page.locator('#scanAssign').click();await done('Hold the NFC card');
  await page.locator('#closePatient').click();
  await page.evaluate(()=>window.fixtureNfcReader.onreading({serialNumber:'09:0A:0B:0C'}));
  assert.equal(await page.locator('#cardUid').inputValue(),'','late scan cannot populate a closed record');
  await page.locator('[data-patient]').click();await done('Patient registration loaded');
  await page.locator('#cardReason').fill('Reported missing');await page.locator('#revokeCard').click();await done('NFC card revoked');
  await page.locator('[data-tab=reception]').click();assert.equal(f.queries.length,0,'exact NFC lookup avoids collection scans');
  await page.locator('#visitFrom').fill('2026-10-26');await page.locator('#visitTo').fill('2026-10-26');
  await page.locator('#visitForm button[type=submit]').click();await done('Selected visit period loaded');
  assert.equal(await page.locator('#visitRows tbody tr').count(),1);
  const reads=f.queries.length;
  await page.locator('[data-tab=patients]').click();await page.locator('[data-tab=reception]').click();assert.equal(f.queries.length,reads);
  await page.locator('[data-status=Completed]').click();await done('Reception visit updated');assert.equal(f.rows('Visits')[0].Status,'Completed');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(output,'reception-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow on phone');
  await page.locator('[data-tab=patients]').click();await page.screenshot({path:resolve(output,'patient-nfc-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#branch').selectOption('north');await done('Branch changed');
  assert.equal(await page.locator('#patientTitle').textContent(),'');assert.equal(await page.locator('#matches').textContent(),'');
  assert.equal(await page.locator('#searchValue').inputValue(),'');assert.equal(await page.locator('[name=Phone]').inputValue(),'');
  await page.locator('#searchValue').fill('Fixture');await page.locator('#searchForm button[type=submit]').click();await done('Patient search complete');
  assert.equal(await page.locator('[data-patient]').count(),0,'other branch cannot see this patient');
  expire=true;await page.locator('#searchForm button[type=submit]').click();await done('Staff session expired');
  assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal(await page.locator('#searchValue').inputValue(),'');
  assert.deepEqual(errors,[]);
  console.log('PASS: registration, NFC assignment/replacement/revocation, USB input focus, check-in, dated visits, cache reuse, branch isolation, expiry clearing, desktop and phone layouts.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
