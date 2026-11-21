import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {hospitalBrowserAssets} from './helpers/hospital-browser-assets.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {specimenLabel} from '../functions/lib/hospital-orders-model.js';
import {actors,rx,medicine} from '../tests/helpers/hospital-orders-fixture.mjs';
import {fixture,actor,env,request} from '../tests/helpers/hospital-fixture.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge',headless:true});
try {
  for (const width of [1280,390]) {
    const f=fixture();
    const patient=await f.register();
    const doctor = {...actor,role:'Doctor',username:'demo-doctor',allowedSections:[...actor.allowedSections,'hospitalTriage','hospitalConsultations','hospitalOrders']};
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
    await rows.getByRole('button',{name:'Issue medication or investigation order'}).click();
    await page.locator('#issueKind').selectOption('Laboratory');
    const issue=page.locator('#issueOrderForm');
    await issue.locator('[name=Service]').fill('Synthetic investigation');
    await issue.locator('[name=Specimen]').fill('Synthetic sample');
    await issue.locator('[name=Indication]').fill('Synthetic indication');
    await page.locator('#confirmIssue').check();
    await issue.getByRole('button',{name:'Sign and issue order'}).click();
    await page.locator('#status').filter({hasText:'Order signed and issued'}).waitFor();
    await page.locator('#orderIdentity').filter({hasText:'ED-1001'}).waitFor();
    const original=f.rows('Orders')[0].OrderNumber;
    user=actors.laboratory;
    await page.reload();
    await page.locator('[data-tab=orders]').click();
    await page.locator('#ordersFrom').fill('2026-10-26');
    await page.locator('#ordersTo').fill('2026-10-26');
    await page.locator('#ordersKind').selectOption('Laboratory');
    await page.locator('#ordersFilter button').click();
    await page.locator('[data-open-order]').first().click();
    const specimenForm=page.locator('#specimenForm');
    for(const decision of ['Collected','Received']){
      const panel=page.locator('#specimenWork');
      if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();
      await page.locator('#confirmOrder').check();
      await specimenForm.locator('[name=SpecimenLabel]').fill(specimenLabel(f.rows('Orders')[0]));
      await specimenForm.locator('[name=Decision]').selectOption(decision);
      await specimenForm.locator('[name=Note]').fill('Synthetic '+decision);
      await specimenForm.locator('button').click();
      await page.locator('#orderIdentity').filter({hasText:'Specimen '+decision.toLowerCase()}).waitFor();
    }
    await page.locator('#reportWork summary').click();
    await page.locator('#reportForm [name=Text]').fill('Synthetic wristband finding');
    await page.locator('#confirmOrder').check();
    await page.locator('#reportForm button').click();
    await page.locator('#orderIdentity').filter({hasText:'Result draft'}).waitFor();
    const Reference='ED-1001',prescriber=createHospitalService(env,doctor,f.db);
    const pharmacy=createHospitalService(env,actors.pharmacist,f.db);
    const band=await prescriber.orderVisitContext(request({Reference}));
    const prescription=await prescriber.createOrder(request({Reference,Kind:'Prescription',Prescription:rx,
      VisitRevision:band.visit.Revision,CareRevision:band.care.Revision,ConfirmPatient:true}));
    const rxBody=async extra=>{
      const detail=await pharmacy.orderDetails(request(prescription));
      return request({...prescription,Revision:detail.order.Revision,CareRevision:detail.care.Revision,ConfirmPatient:true,...extra});
    };
    await pharmacy.reviewPrescription(await rxBody({Decision:'Approved',Reason:'Synthetic review'}));
    await pharmacy.receiveMedicine(request({Stock:{...medicine,Quantity:5,BatchNumber:'SYNTHETIC',ExpiryDate:'2027-12-31',
      Supplier:'Synthetic supplier',ReceiptReference:'TEST-RECEIPT',LineReference:'1',UnitPrice:'1.00'}}));
    const lot=(await pharmacy.stockBatches(request(prescription))).batches[0];
    await pharmacy.dispensePrescription(await rxBody({BatchId:lot.BatchId,BatchRevision:lot.Revision,Quantity:2}));
    await changeRole({...actor,role:'Nurse',username:'test-nurse',allowedSections:[...actor.allowedSections,'hospitalNursing','hospitalTriage']});
    await openCare();
    const queriesBefore=f.queries.length;
    await rows.getByRole('button',{name:'Record medication given'}).click();
    const form=rows.locator('form').filter({has:page.locator('[name=ConfirmedReference]')});
    await form.getByPlaceholder('Quantity given').fill('1');
    await form.locator('[name=ObservedAt]').fill('2026-10-26T13:00');
    await form.locator('[name=ConfirmedReference]').fill(Reference);
    assert.equal(f.queries.length-queriesBefore,1);
    await form.getByRole('button',{name:'Sign administration'}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Sign administration'}).click();
    await page.locator('#status').filter({hasText:'Medication administration signed'}).waitFor();
    await rows.getByRole('button',{name:'Refresh signed entries'}).click();
    const beforeEditor=f.queries.length;
    await rows.getByRole('button',{name:'Review or correct dose'}).click();
    const correction=rows.locator('form').filter({has:page.locator('[name=Reason]')});
    await correction.locator('input[type=number]').fill('0.5');
    await correction.locator('[name=Reason]').fill('Verified quantity');
    await correction.locator('[name=ConfirmedReference]').fill(Reference);
    await correction.getByRole('button',{name:'Review correction'}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Sign correction'}).click();
    await page.locator('#status').filter({hasText:'Medication correction signed'}).waitFor();
    assert.ok(f.queries.length-beforeEditor<=3);
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
    await linked.getByRole('button',{name:'View current signed dose'}).first().click();
    await linked.getByText(/0[.]5 tablet.*Given at/).waitFor();
    await linked.getByRole('button',{name:'Open '+original}).click();
    await page.locator('#orderIdentity').filter({hasText:patient.HospitalNumber}).waitFor();
    await page.locator('#orderIdentity').filter({hasText:original}).waitFor();
    assert.equal(f.rows('Orders').length,2);
    await linked.getByText('1 tablet',{exact:true}).first().waitFor({state:'attached'});
    assert.deepEqual(errors,[]);
    console.log('Emergency intake and verified patient link passed at '+width+'px.');
    await page.close();
  }
} finally {await browser.close();}
