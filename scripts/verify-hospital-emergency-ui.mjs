import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {hospitalBrowserAssets} from './helpers/hospital-browser-assets.mjs';
import {fixture,actor} from '../tests/helpers/hospital-fixture.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge',headless:true});
try {
  for (const width of [1280,390]) {
    const f=fixture();
    const patient=await f.register();
    const page=await browser.newPage({viewport:{width,height:850}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const assets=hospitalBrowserAssets();
    await page.route('https://hospital.test/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/staff-session') return route.fulfill({json:{ok:true,authenticated:true,user:actor,
        session:{id:'demo',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}});
      if(path==='/api/staff-hospital'){
        const body=route.request().postDataJSON();
        try{return await route.fulfill({json:await f.service[body.action](body)});}
        catch(error){return route.fulfill({status:error.status || 500,json:{ok:false,message:error.message}});}
      }
      if(!assets.has(path))return route.fulfill({status:404});
      await route.fulfill({body:await readFile(new URL('..'+path,import.meta.url)),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
    });
    await page.goto('https://hospital.test/hospital.html');
    await page.locator('[data-tab=reception]').click();
    await page.locator('#emergencyPanel summary').click();
    assert.equal(f.queries.length,0);
    await page.locator('#emergencyIntake [name=Reference]').fill('ED-1001');
    await page.locator('#emergencyIntake [name=ArrivalNote]').fill('Synthetic arrival');
    await page.locator('#emergencyIntake button').click();
    await page.locator('#status').filter({hasText:'ED-1001'}).waitFor();
    await page.locator('#emergencyPending').click();
    await page.locator('#emergencyRows').getByText(/ED-1001/).waitFor();
    await page.locator('[data-tab=patients]').click();
    await page.locator('#searchMode').selectOption('HospitalNumber');
    await page.locator('#searchValue').fill(patient.HospitalNumber);
    await page.locator('#searchValue').press('Enter');
    await page.locator('[data-patient]').click();
    await page.locator('#status').filter({hasText:'registration loaded'}).waitFor();
    await page.locator('[data-tab=reception]').click();
    await page.locator('[name=IdentityEvidence]').fill('Registration and wristband confirmed');
    await page.getByRole('button',{name:'Review patient link'}).click();
    await page.getByRole('button',{name:'Confirm identity and link'}).click();
    await page.locator('#status').filter({hasText:'Arrival linked'}).waitFor();
    await page.locator('#emergencyPending').click();
    await page.locator('#status').filter({hasText:'No matching emergency arrivals'}).waitFor();
    assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('EmergencyArrivals')[0].PatientId,patient.PatientId);
    assert.deepEqual(errors,[]);
    console.log('Emergency intake and verified patient link passed at '+width+'px.');
    await page.close();
  }
} finally {await browser.close();}
