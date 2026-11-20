import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {hospitalBrowserAssets} from './helpers/hospital-browser-assets.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {fixture,actor,env} from '../tests/helpers/hospital-fixture.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge',headless:true});
try {
  for (const width of [1280,390]) {
    const f=fixture();
    const patient=await f.register();
    const doctor = {...actor,role:'Doctor',username:'demo-doctor',allowedSections:[...actor.allowedSections,'hospitalTriage','hospitalConsultations']};
    let user = actor;
    const page=await browser.newPage({viewport:{width,height:850}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const assets=hospitalBrowserAssets();
    await page.route('https://hospital.test/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/staff-session') return route.fulfill({json:{ok:true,authenticated:true,user,
        session:{id:'demo',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}});
      if(path==='/api/staff-hospital'){
        const body=route.request().postDataJSON();
        try{return await route.fulfill({json:await createHospitalService(env,user,f.db)[body.action](body)});}
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
    const changeRole = async next => {
      user = next;
      await page.reload();
      await page.locator('[data-tab=reception]').click();
      await page.locator('#emergencyPanel summary').first().click();
      await page.locator('#emergencyPending').click();
    };
    const openCare = () => page.getByRole('button',{name:'Open care for ED-1001'}).click();
    await changeRole(doctor);
    await openCare();
    const rows = page.locator('#emergencyRows');
    await rows.getByText('Record triage',{exact:true}).first().click();
    await rows.locator('[name=Complaint]').fill('Synthetic triage note');
    await rows.getByRole('button',{name:'Review and sign triage'}).click();
    await page.getByRole('button',{name:'Sign for ED-1001'}).click();
    await page.locator('#status').filter({hasText:'Triage signed'}).waitFor();
    await rows.getByText('Record treatment',{exact:true}).click();
    await rows.locator('[name=Treatment]').fill('Synthetic treatment note');
    await rows.getByRole('button',{name:'Review and sign treatment'}).click();
    await page.getByRole('button',{name:'Sign for ED-1001'}).click();
    await page.locator('#status').filter({hasText:'Treatment signed'}).waitFor();
    await changeRole(actor);
    await rows.getByText(/ED-1001/).waitFor();
    assert.equal(await rows.getByRole('button',{name:'Open care for ED-1001'}).count(),0);
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
    await changeRole(doctor);
    await page.locator('#visitFrom').fill('2026-10-26');
    await page.locator('#visitTo').fill('2026-10-26');
    await page.getByRole('button',{name:'Load visits',exact:true}).click();
    await page.getByRole('button',{name:'Open care record'}).click();
    await page.locator('#linkedEmergencyPanel summary').click();
    await page.locator('#loadLinkedEmergency').click();
    await openCare();
    const linked=page.locator('#linkedEmergencyRows');
    await linked.getByText('Synthetic triage note',{exact:true}).waitFor();
    await linked.getByText('Synthetic treatment note',{exact:true}).waitFor();
    assert.equal(await linked.getByRole('button',{name:/Review and sign/}).count(),0);
    assert.deepEqual(errors,[]);
    console.log('Emergency intake and verified patient link passed at '+width+'px.');
    await page.close();
  }
} finally {await browser.close();}
