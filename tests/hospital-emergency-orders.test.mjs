import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from './helpers/hospital-fixture.mjs';
import {ordersFixture,rx} from './helpers/hospital-orders-fixture.mjs';
const Reference='ED-ORDER-01';
const dateRange={fromDate:'2026-10-26',toDate:'2026-10-26'};
async function setup(){
  const f=await ordersFixture();
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
  await assert.rejects(f.pharmacist.dispensePrescription(await f.body(order,{Quantity:1})),/Identify the wristband/);
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
