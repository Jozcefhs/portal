import test from 'node:test';
import assert from 'node:assert/strict';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {actor,env,request} from './helpers/hospital-fixture.mjs';
import {ordersFixture,rx} from './helpers/hospital-orders-fixture.mjs';
import {billingFixture} from './helpers/hospital-billing-fixture.mjs';
const Reference='ED-ORDER-01';
const dateRange={fromDate:'2026-10-26',toDate:'2026-10-26'};
async function setup(make=ordersFixture){
  const f=await make();
  await f.service.recordEmergencyArrival(request({Reference,ArrivalNote:'Test arrival'}));
  return f;
}
async function prepare(f,Kind){
  const c=await f.doctor.orderVisitContext(request({Reference}));
  return request({Reference,PatientId:c.patient.PatientId,VisitId:c.visit.VisitId,VisitRevision:c.visit.Revision,
    CareRevision:c.care.Revision,Kind,ConfirmPatient:true,Prescription:rx,
    Investigation:{Service:'Synthetic investigation',Indication:'Recorded indication',Specimen:'Test specimen',Priority:'Urgent'}});
}
async function identify(f){
  const row=(await f.service.emergencyArrivals(request({Reference}))).arrivals[0];
  const p=await f.details(f.scope.PatientId);
  return f.service.identifyEmergencyArrival(request({Reference,Revision:row.Revision,PatientId:p.PatientId,
    HospitalNumber:p.HospitalNumber,PatientRevision:p.Revision,IdentityEvidence:'Verified registration and wristband'}));
}
test('all three emergency orders enter their department queues once, remain linked in the reused visit and retain history',async()=>{
  const f=await setup(),orders=[];
  for(const [kind,worker] of [['Prescription',f.pharmacist],['Laboratory',f.laboratory],['Imaging',f.imaging]]){
    const input=await prepare(f,kind);
    const saved=await f.doctor.createOrder(input);orders.push(saved);
    const writes=f.commits.length,reads=f.reads.length;
    assert.equal((await f.doctor.createOrder(input)).OrderId,saved.OrderId);
    assert.equal(f.commits.length,writes);assert.equal(f.reads.length-reads,1);
    assert.equal((await worker.listOrders(request({Kind:kind,DateRange:dateRange}))).orders[0].OrderId,saved.OrderId);
    assert.equal((await worker.orderDetails(request(saved))).unidentified,true);
  }
  const original=f.rows('Orders'),events=f.rows('OrderEvents');
  assert.equal((await identify(f)).VisitId,f.scope.VisitId);
  assert.deepEqual(f.rows('Orders'),original);assert.deepEqual(f.rows('OrderEvents'),events);
  const entries=(await f.doctor.emergencyCareHistory(request({...f.scope,Reference}))).entries;
  assert.deepEqual(entries.map(e=>e.OrderId),orders.map(o=>o.OrderId));
  for(const order of orders){
    const resolved=await f.doctor.orderDetails(request(order));
    assert.equal(resolved.patient.PatientId,f.scope.PatientId);
    assert.equal(resolved.order.VisitId,f.scope.VisitId);assert.equal(resolved.unidentified,false);
  }
  assert.equal(f.rows('Patients').length,1);assert.equal(f.rows('Visits').length,1);
  assert.equal(f.rows('ChargeEvents').length,0);
});
test('pharmacy reviews wristband allergies, then rechecks the registered identity before one stock and charge posting',async()=>{
  const f=await setup();
  await f.doctor.signEmergencyCare(request({Reference,ConfirmedReference:Reference,Type:'Triage',Sequence:0,
    Content:{Complaint:'Synthetic',Urgency:'Urgent',AllergyStatus:'Known allergies',Allergies:'Synthetic reaction'}}));
  const order=await f.doctor.createOrder(await prepare(f,'Prescription'));
  const review={Reason:'Reviewed wristband and allergies',Decision:'Approved'};
  assert.equal((await f.pharmacist.orderDetails(request(order))).care.Allergies,'Synthetic reaction');
  await f.pharmacist.reviewPrescription(await f.body(order,review));
  await assert.rejects(f.pharmacist.dispensePrescription(await f.body(order,{Quantity:1,ConfirmPatient:false})),/Confirm/);
  await identify(f);
  const identified={...order,PatientId:f.scope.PatientId};
  await assert.rejects(f.pharmacist.reviewPrescription(await f.body(order,review)),/Refresh/);
  await assert.rejects(f.pharmacist.dispensePrescription(await f.body(identified,{Quantity:1})),/identified patient/);
  await f.pharmacist.reviewPrescription(await f.body(identified,review));
  await f.receive();
  const batch=(await f.pharmacist.stockBatches(request(identified))).batches[0];
  const dispense=await f.body(identified,{Quantity:1,BatchId:batch.BatchId,BatchRevision:batch.Revision});
  await f.pharmacist.dispensePrescription(dispense);await f.pharmacist.dispensePrescription(dispense);
  assert.equal(f.rows('ChargeEvents').length,1);assert.equal(f.rows('ChargeEvents')[0].PatientId,f.scope.PatientId);
  assert.equal(f.rows('Dispenses')[0].OrderId,order.OrderId);
});
test('laboratory collects on the wristband; after identification the same label and order continue',async()=>{
  const f=await setup(),o=await f.doctor.createOrder(await prepare(f,'Laboratory'));
  const before=await f.laboratory.orderDetails(request(o));
  const collect=await f.body(o,{Decision:'Collected',Note:'Synthetic collection',SpecimenLabel:before.order.LabelToPrint},f.laboratory);
  await f.laboratory.recordSpecimen(collect);
  await identify(f);
  const id={...o,PatientId:f.scope.PatientId};
  await f.laboratory.recordSpecimen(await f.body(id,{Decision:'Received',Note:'Synthetic receipt',SpecimenLabel:before.order.LabelToPrint},f.laboratory));
  const after=await f.laboratory.orderDetails(request(o));
  assert.equal(after.order.CurrentSpecimen.Label,before.order.LabelToPrint);
  assert.equal(after.order.Status,'Specimen received');assert.equal(after.order.PatientId,id.PatientId);
  const found=await f.laboratory.searchLabSpecimen(request({Reference:before.order.LabelToPrint}));
  assert.equal(found.patient.PatientId,id.PatientId);assert.equal(found.order.EmergencyReference,after.order.EmergencyReference);
});
test('role, branch, identity and stale confirmations cannot issue duplicate emergency orders',async()=>{
  const f=await setup(),input=await prepare(f,'Imaging');
  await assert.rejects(f.service.createOrder(input),{status:403});
  await assert.rejects(f.doctor.createOrder({...input,BranchId:'north'}),{status:403});
  await assert.rejects(f.doctor.createOrder({...input,ConfirmPatient:false}),/Confirm/);
  await assert.rejects(f.doctor.createOrder({...input,PatientId:f.scope.PatientId}),/wristband/);
  const saves=await Promise.allSettled([f.doctor.createOrder(input),f.doctor.createOrder({...input,RequestId:crypto.randomUUID()})]);
  assert.equal(saves.filter(r=>r.status==='fulfilled').length,1);
  await identify(f);await assert.rejects(f.doctor.createOrder({...input,RequestId:crypto.randomUUID()}),/identified patient/);
  assert.equal(f.rows('Orders').length,1);
});

test('emergency pharmacy debits once, retains wristband supply and bills the identified visit including return credits',async()=>{
  const f=await setup(billingFixture),order=await f.doctor.createOrder(await prepare(f,'Prescription'));
  await f.receive();
  await f.pharmacist.reviewPrescription(await f.body(order,{Decision:'Approved',Reason:'Reviewed the wristband'}));
  const batch=(await f.pharmacist.stockBatches(request(order))).batches[0];
  const input=await f.body(order,{Quantity:3,BatchId:batch.BatchId,BatchRevision:batch.Revision});
  const {DispenseId}=await f.pharmacist.dispensePrescription(input);
  const writes=f.commits.length;await f.pharmacist.dispensePrescription(input);assert.equal(f.commits.length,writes);
  const original=f.rows('Dispenses')[0];
  await f.pharmacist.returnDispensedMedicine(await f.body(order,{DispenseId,DispenseRevision:original.__updateTime,Quantity:1,Reason:'Unused'}));
  const charges=f.rows('ChargeEvents'),credit=charges.find(row=>row.Source==='Return');
  assert.equal(charges.length,2);assert.equal(original.EmergencyReference,Reference);
  assert.equal(f.rows('MedicineBatches')[0].OnHand,17);
  assert.equal(f.rows('StockMovements').filter(row=>row.Type==='Dispense').length,1);
  const invoiceInput=request({...f.scope,ChargeIds:[DispenseId],ConfirmPatient:true});
  await assert.rejects(f.cashier.issueHospitalInvoice(invoiceInput),/another visit/);
  assert.equal(f.rows('CareSummaries').filter(r=>r.PatientId===order.PatientId).length,0);
  await identify(f);
  assert.deepEqual(f.rows('ChargeEvents'),charges);assert.equal(f.rows('Visits').length,1);
  const list=await f.cashier.billingCharges(request({...f.scope,DateRange:dateRange}));
  assert.equal(list.rows.length,2);assert.equal(list.next,null);
  assert.ok(list.rows.every(r=>r.PatientId===f.scope.PatientId&&r.EmergencyReference===Reference));
  const invoice=await f.cashier.issueHospitalInvoice(invoiceInput);
  await f.cashier.issueHospitalInvoice(invoiceInput);
  await f.cashier.creditHospitalCharge(await f.billBody(invoice,{ChargeId:credit.ChargeId}));
  assert.equal(f.rows('Invoices').length,1);assert.equal(f.rows('Invoices')[0].PatientCents,3750);
  assert.equal(f.rows('Invoices')[0].PatientCreditCents,1250);
  const linked={...order,PatientId:f.scope.PatientId};
  const history=await f.pharmacist.dispensingHistory(request({...linked,DateRange:dateRange}));
  assert.equal(history.dispenses[0].DispenseId,DispenseId);
  await f.pharmacist.returnDispensedMedicine(await f.body(linked,{DispenseId,DispenseRevision:history.dispenses[0].Revision,Quantity:1,Reason:'Second unused unit'}));
  assert.equal(f.rows('MedicineBatches')[0].Quarantined,2);
});
for(const kind of ['Laboratory','Imaging'])test(kind+' wristband report survives identification, independent verification, release and amendments',async()=>{
  const f=await setup(),order=await f.doctor.createOrder(await prepare(f,kind));
  const [author,verifier]=kind==='Laboratory'?[f.laboratory,f.verifier]:[f.imaging,f.imagingVerifier];
  if(kind==='Laboratory'){
    const label=(await author.orderDetails(request(order))).order.LabelToPrint;
    await assert.rejects(author.recordInvestigationReport(await f.body(order,{Text:'Test'},author)),/specimen/);
    for(const Decision of ['Collected','Received'])await author.recordSpecimen(await f.body(order,{Decision,Note:Decision,SpecimenLabel:label},author));
  }
  const input=await f.body(order,{Text:'Synthetic finding',Critical:true},author);
  const {ReportId}=await author.recordInvestigationReport(input);await author.recordInvestigationReport(input);
  await assert.rejects(author.verifyInvestigationReport(await f.body(order,{ReportId},author)),/second authorised/);
  await verifier.verifyInvestigationReport(await f.body(order,{ReportId},verifier));
  if(kind==='Imaging')await identify(f);
  const releaseScope=kind==='Imaging'?{...order,PatientId:f.scope.PatientId}:order;
  await author.releaseInvestigationReport(await f.body(releaseScope,{ReportId,Communication:'Clinician informed'},author));
  const signed=f.rows('ReleasedReports');
  if(kind==='Laboratory')await identify(f);
  const linked={...order,PatientId:f.scope.PatientId};
  assert.equal((await author.orderDetails(request(linked))).releasedReport.ReportId,ReportId);
  assert.equal((await f.doctor.pendingCriticalAlerts(request(linked))).alerts[0].report.ReportId,ReportId);
  await f.doctor.acknowledgeCriticalResult(await f.body(linked,{ReportId,Note:'Acknowledged finding'},f.doctor));
  const share=await f.doctor.clinicalPortalContext(request({PatientId:f.scope.PatientId,ParentId:order.OrderId,DocumentType:'investigations'}));
  assert.equal(share.ready,true);assert.equal(f.rows('PortalClinicalDocuments').length,0);
  await author.recordInvestigationReport(await f.body(linked,{Text:'Corrected synthetic finding',Reason:'Correction'},author));
  assert.deepEqual(f.rows('ReleasedReports'),signed);assert.equal(f.rows('InvestigationReports').length,2);
  assert.equal((await author.releasedReportHistory(request({...linked,DateRange:dateRange}))).reports[0].EmergencyReference,Reference);
});

async function bedside(){
  const f=await setup(),order=await f.doctor.createOrder(await prepare(f,'Prescription'));
  const nurse=createHospitalService(env,{...actor,role:'Nurse',username:'ward-nurse',allowedSections:[...actor.allowedSections,'hospitalNursing','hospitalTriage']},f.db);
  const scope={Reference,OrderId:order.OrderId};
  await f.pharmacist.reviewPrescription(await f.body(order,{Decision:'Approved',Reason:'Verified'}));
  for(const BatchNumber of ['FIRST','SECOND']){
    await f.receive({BatchNumber});
    const batch=(await f.pharmacist.stockBatches(request(order))).batches.find(r=>r.BatchNumber===BatchNumber);
    await f.pharmacist.dispensePrescription(await f.body(order,{Quantity:2,BatchId:batch.BatchId,BatchRevision:batch.Revision}));
  }
  const data=await nurse.emergencyMedicationSupplies(request(scope));
  const input=request({...scope,ConfirmedReference:Reference,ObservedAt:'2026-10-26T13:00+01:00',Revision:data.Revision,
    Lots:data.lots.map(l=>({DispenseId:l.DispenseId,Revision:l.Revision,Quantity:0.5}))});
  return {f,order,nurse,scope,input};
}
test('sign a split-lot wristband dose once and retain the signed dose after identification',async()=>{
  const {f,order,nurse,scope,input}=await bedside(),before=['StockMovements','MedicineBatches','ChargeEvents'].map(k=>f.rows(k));
  const result=await nurse.signEmergencyMedication(input),writes=f.commits.length,reads=f.reads.length;
  assert.equal((await nurse.signEmergencyMedication(input)).EntryId,result.EntryId);
  assert.equal(f.reads.length-reads,1);assert.equal(f.commits.length,writes);
  const fresh=await nurse.emergencyMedicationSupplies(request(scope));
  assert.deepEqual(fresh.lots.map(l=>l.Available),[1.5,1.5]);
  await assert.rejects(nurse.signEmergencyMedication(request({...input,RequestId:crypto.randomUUID(),Revision:fresh.Revision})),/already has a signed/);
  const lot=fresh.lots[0];
  await assert.rejects(f.pharmacist.returnDispensedMedicine(await f.body(order,{Quantity:2,Reason:'Unused',DispenseId:lot.DispenseId,DispenseRevision:lot.Revision})),/unused/);
  assert.deepEqual(['StockMovements','MedicineBatches','ChargeEvents'].map(k=>f.rows(k)),before);
  await identify(f);
  const entry=(await f.doctor.emergencyCareHistory(request({...f.scope,Reference}))).entries.find(r=>r.EntryId===result.EntryId);
  assert.equal(entry.Type,'Medication administration');assert.equal(entry.Content.Given,'1 tablet');
  assert.equal(entry.OrderId,order.OrderId);assert.equal(entry.Content.ObservedAt,'2026-10-26T12:00:00.000Z');
  await assert.rejects(nurse.signEmergencyMedication({...input,RequestId:crypto.randomUUID()}),/identified/);
});
test('wristband administration rejects mismatched, stale, unauthorised and conflicting records',async()=>{
  const {f,nurse,scope,input}=await bedside();
  await assert.rejects(f.service.signEmergencyMedication(input),{status:403});
  await assert.rejects(nurse.emergencyMedicationSupplies(request({...scope,BranchId:'north'})),{status:403});
  await assert.rejects(nurse.signEmergencyMedication({...input,ConfirmedReference:'OTHER'}),/wristband/);
  await assert.rejects(nurse.signEmergencyMedication({...input,Revision:'stale'}),/changed/);
  await assert.rejects(nurse.signEmergencyMedication({...input,Lots:[input.Lots[0],input.Lots[0]]}),/only once/);
  await assert.rejects(nurse.signEmergencyMedication({...input,Lots:[{...input.Lots[0],Quantity:3}]}),/remaining supply/);
  await assert.rejects(nurse.signEmergencyMedication({...input,ObservedAt:'2026-10-25T12:00Z'}),/dispensing time/);
  const outcomes=await Promise.allSettled([nurse.signEmergencyMedication(input),nurse.signEmergencyMedication({...input,RequestId:crypto.randomUUID()})]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  const arrival=f.rows('EmergencyArrivals')[0];
  await f.doctor.signEmergencyCare(request({Reference,ConfirmedReference:Reference,Type:'Triage',Sequence:arrival.CareSequence,
    Content:{Complaint:'Synthetic',Urgency:'Urgent',AllergyStatus:'Known allergies',Allergies:'Synthetic change'}}));
  await assert.rejects(nurse.emergencyMedicationSupplies(request(scope)),/pharmacy review/);
  assert.equal(f.rows('EmergencyCareEntries').filter(r=>r.Type==='Medication administration').length,1);
});

test('competing bedside administration and return cannot both use the same units',async()=>{
  const {f,order,nurse,input}=await bedside(),lot=input.Lots[0];
  const give={...input,Lots:[{...lot,Quantity:2}]};
  const receiveBack=await f.body(order,{DispenseId:lot.DispenseId,DispenseRevision:lot.Revision,Quantity:2,Reason:'Unused'});
  const attempts=await Promise.allSettled([nurse.signEmergencyMedication(give),f.pharmacist.returnDispensedMedicine(receiveBack)]);
  assert.equal(attempts.filter(attempt=>attempt.status==='fulfilled').length,1);
  const updated=f.rows('Dispenses').find(row=>row.DispenseId===lot.DispenseId);
  assert.equal((updated.AdministeredQuantity||0)+updated.ReturnedQuantity,2);
  assert.equal(f.rows('EmergencyCareEntries').filter(row=>row.Type==='Medication administration').length,f.rows('MedicineReturns').length?0:1);
});

async function signedDose(){
  const ctx=await bedside(),{f,nurse,input}=ctx;
  const original=await nurse.signEmergencyMedication(input);
  const scope={Reference,EntryId:original.EntryId};
  const open=(extra={})=>nurse.emergencyMedicationCorrection(request({...scope,...extra}));
  const {Version,lots,Content}=await open();
  const draft={...scope,Version,ConfirmedReference:Reference,Reason:'Verified against the medication record',
    ObservedAt:Content.ObservedAt,Note:Content.Note||'',Lots:lots.map(l=>({DispenseId:l.DispenseId,Quantity:l.Quantity}))};
  return {...ctx,original,open,draft};
}
test('signed corrections use the last effective dose, update only changed lots and preserve every signature after identification',async()=>{
  const {f,nurse,draft,open,original}=await signedDose();
  const row=()=>f.rows('EmergencyCareEntries').find(r=>r.EntryId===original.EntryId);
  const signed=structuredClone(row()),finance=['MedicineBatches','StockMovements','ChargeEvents'].map(k=>f.rows(k));
  const [first,second]=draft.Lots;
  const untouched=f.rows('Dispenses').find(r=>r.DispenseId===second.DispenseId).__updateTime;
  const change=request({...draft,Lots:[{...first,Quantity:1},second]});
  const correction=await nurse.correctEmergencyMedication(change);
  const commits=f.commits.length,reads=f.reads.length;
  assert.equal((await nurse.correctEmergencyMedication(change)).EntryId,correction.EntryId);
  assert.equal(f.reads.length-reads,1);assert.equal(f.commits.length,commits);
  await assert.rejects(nurse.correctEmergencyMedication(request({...change,RequestId:crypto.randomUUID()})),/newer version/);
  assert.equal(f.rows('Dispenses').find(r=>r.DispenseId===second.DispenseId).__updateTime,untouched);
  const current=await open();assert.equal(current.Content.Given,'1.5 tablet');
  const readsBefore=f.reads.length,writesBefore=f.commits.length;
  assert.ok((await nurse.correctEmergencyMedication(request({...draft,Version:current.Version,Lots:change.Lots}))).Unchanged);
  assert.equal(f.commits.length,writesBefore);
  assert.ok(!f.reads.slice(readsBefore).some(r=>r[0].endsWith('hospitalDispenses')));
  await identify(f);
  await assert.rejects(open(),/identified patient visit/);
  await assert.rejects(open({...f.scope,PatientId:'another-patient'}),/identified patient visit/);
  const linked=await open(f.scope);
  const amendNote=request({...draft,...f.scope,Version:linked.Version,Lots:change.Lots,Note:'Corrected bedside note'});
  const start=f.reads.length;
  const note=await nurse.correctEmergencyMedication(amendNote);
  assert.ok(!f.reads.slice(start).some(r=>r[0].endsWith('hospitalDispenses')));
  const zero=await nurse.correctEmergencyMedication(request({...draft,...f.scope,Version:note.EntryId,Lots:[],ConfirmZero:true}));
  const last=await open(f.scope);assert.equal(last.Version,zero.EntryId);assert.equal(last.Content.Given,'0 tablet');
  assert.ok(f.rows('Dispenses').every(r=>r.AdministeredQuantity===0));
  assert.deepEqual(row(),signed);assert.deepEqual(['MedicineBatches','StockMovements','ChargeEvents'].map(k=>f.rows(k)),finance);
  const history=await f.doctor.emergencyCareHistory(request({...f.scope,Reference}));
  assert.deepEqual(history.entries.filter(r=>r.OriginalEntryId===original.EntryId).map(r=>r.Content.Given),['1.5 tablet','1.5 tablet','0 tablet']);
});
test('correction scope, lot limits, explicit zero and concurrent saves are enforced',async()=>{
  const {f,nurse,draft}=await signedDose(),[lot]=draft.Lots;
  for(const [extra,pattern] of [[{Reason:''},/Reason/],[{ConfirmedReference:'OTHER'},/Confirm/],[{Lots:[]},/confirm/],
    [{Lots:[lot,lot]},/once/],[{Lots:[{...lot,Quantity:3}]},/exceeds/],[{Lots:[{...lot,DispenseId:'foreign-dispense'}]},/does not belong/],
    [{EntryId:'another-entry'},/original medication/],[{VisitId:f.scope.VisitId},/wristband/]]){
    await assert.rejects(nurse.correctEmergencyMedication(request({...draft,...extra})),pattern);
  }
  await assert.rejects(f.service.correctEmergencyMedication(request(draft)),{status:403});
  await assert.rejects(nurse.correctEmergencyMedication(request({...draft,BranchId:'north'})),{status:403});
  const both=await Promise.allSettled([1,1.5].map(Quantity=>nurse.correctEmergencyMedication(request({...draft,Lots:[{...lot,Quantity}]}))));
  assert.equal(both.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.rows('EmergencyCareEntries').filter(r=>r.OriginalEntryId===draft.EntryId).length,1);
});
test('corrected administration time reserves the minute without changing supply a second time',async()=>{
  const {f,nurse,draft,input,open}=await signedDose();
  f.db.now=()=>new Date('2026-10-26T12:10:00Z');
  // The fixture service captures its clock at construction; create a service with this later time.
  const later=createHospitalService(env,{...actor,role:'Nurse',allowedSections:[...actor.allowedSections,'hospitalNursing','hospitalTriage']},f.db);
  const observed='2026-10-26T12:05:00.000Z',prior=f.rows('Dispenses');
  const changed=await later.correctEmergencyMedication(request({...draft,ObservedAt:observed}));
  assert.deepEqual(f.rows('Dispenses'),prior);
  const fresh=await later.emergencyMedicationSupplies(request({Reference,OrderId:input.OrderId}));
  await assert.rejects(later.signEmergencyMedication(request({...input,RequestId:crypto.randomUUID(),Revision:fresh.Revision,ObservedAt:observed})),/already has/);
  assert.equal((await open()).Version,changed.EntryId);
});

test('increasing a corrected dose competes atomically with a pharmacy return for the same remaining units',async()=>{
  const {f,order,nurse,draft}=await signedDose(),[lot,other]=draft.Lots;
  const stored=f.rows('Dispenses').find(r=>r.DispenseId===lot.DispenseId);
  const refund=await f.body(order,{DispenseId:lot.DispenseId,DispenseRevision:stored.__updateTime,Quantity:1.5,Reason:'Unused supply'});
  const operations=await Promise.allSettled([nurse.correctEmergencyMedication(request({...draft,Lots:[{...lot,Quantity:2},other]})),
    f.pharmacist.returnDispensedMedicine(refund)]);
  assert.equal(operations.filter(r=>r.status==='fulfilled').length,1);
  const after=f.rows('Dispenses').find(r=>r.DispenseId===lot.DispenseId);
  assert.equal(after.AdministeredQuantity+after.ReturnedQuantity,2);
  assert.equal(f.rows('EmergencyCareEntries').filter(r=>r.Type==='Medication administration correction').length,after.ReturnedQuantity?0:1);
});
