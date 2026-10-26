import test from 'node:test';
import assert from 'node:assert/strict';
import {ordersFixture,medicine,rx} from './helpers/hospital-orders-fixture.mjs';
import {request,profile} from './helpers/hospital-fixture.mjs';

const reset=f=>{f.reads.length=0;f.queries.length=0;f.commits.length=0;};
const writes=f=>f.commits.reduce((sum,rows)=>sum+rows.length,0);
const review={Decision:'Approved',Reason:'Patient and prescription reviewed'};
const range={fromDate:'2026-10-26',toDate:'2026-10-26'};

test('Hospital entry and invalid history requests do not scan patient, order or stock collections',async()=>{
  const f=await ordersFixture();reset(f);
  await f.doctor.state();await f.pharmacist.state();await f.laboratory.state();
  assert.equal(f.queries.length,0);assert.equal(f.reads.length,0);assert.equal(writes(f),0);
  await assert.rejects(f.doctor.listOrders(request({Kind:'Prescription'})));
  await assert.rejects(f.pharmacist.stockHistory(request({BatchId:'missing-batch'})));
  assert.equal(f.queries.length,0);assert.equal(writes(f),0);
});

test('unchanged patient and consultation form saves write no documents and do not repeat audit events',async()=>{
  const f=await ordersFixture(),patient=await f.details(f.scope.PatientId);reset(f);
  const saved=await f.service.savePatient(request({PatientId:patient.PatientId,Revision:patient.Revision,Patient:profile}));
  assert.equal(saved.Unchanged,true);assert.equal(writes(f),0);assert.equal(f.queries.length,0);
  let c=await f.doctor.clinicalContext(request(f.scope));
  const body=()=>request({...f.scope,VisitRevision:c.visit.Revision,EncounterRevision:c.encounter?.Revision||'',CareRevision:c.care.Revision,DraftRevision:c.draft?.Revision||'',Notes:{History:'Recorded history'}});
  await f.doctor.saveConsultation(body());
  // Firestore may return map fields in a different order than the submitted JSON.
  const stored=f.rows('Consultations')[0];stored.Notes=Object.fromEntries(Object.entries(stored.Notes).reverse());
  c=await f.doctor.clinicalContext(request(f.scope));reset(f);
  assert.equal((await f.doctor.saveConsultation(body())).Unchanged,true);assert.equal(writes(f),0);assert.equal(f.queries.length,0);
});

test('unchanged pharmacy review and report saves preserve their existing revisions without writes',async()=>{
  const f=await ordersFixture(),order=await f.create();await f.pharmacist.reviewPrescription(await f.body(order,review));
  const unchanged=await f.body(order,review);const oldOrder=structuredClone(f.rows('Orders')[0]);reset(f);
  assert.equal((await f.pharmacist.reviewPrescription(unchanged)).Unchanged,true);assert.equal(writes(f),0);assert.deepEqual(f.rows('Orders')[0],oldOrder);
  const investigation=await f.create('Imaging'),report={Text:'Staff report',Critical:false};
  await f.imaging.recordInvestigationReport(await f.body(investigation,report,f.imaging));const again=await f.body(investigation,report,f.imaging),oldReport=structuredClone(f.rows('InvestigationReports')[0]);reset(f);
  assert.equal((await f.imaging.recordInvestigationReport(again)).Unchanged,true);assert.equal(writes(f),0);assert.deepEqual(f.rows('InvestigationReports')[0],oldReport);
});

test('matching stock uses one bounded query without reloading a patient or clinical record',async()=>{
  const f=await ordersFixture();await f.receive();reset(f);
  const result=await f.pharmacist.stockBatches(request({Medicine:medicine}));
  assert.equal(result.batches.length,1);assert.equal(f.reads.length,0);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);
  assert.deepEqual(f.queries[0].filters.map(row=>row.field),['BranchId','MedicineKey']);assert.equal(writes(f),1,'one access audit, no stock mutations');
});

test('released investigation detail reads the shared report once; pending critical results avoid per-row lookups',async()=>{
  const f=await ordersFixture(),order=await f.create('Imaging');
  const report=await f.imaging.recordInvestigationReport(await f.body(order,{Text:'Critical staff report',Critical:true},f.imaging));
  await f.imagingVerifier.verifyInvestigationReport(await f.body(order,{ReportId:report.ReportId},f.imagingVerifier));
  await f.imagingVerifier.releaseInvestigationReport(await f.body(order,{ReportId:report.ReportId,Communication:'Contacted doctor'},f.imagingVerifier));
  reset(f);const details=await f.imaging.orderDetails(request(order));
  assert.equal(details.latestReport.ReportId,details.releasedReport.ReportId);
  assert.equal(f.reads.filter(([path])=>path.endsWith('hospitalInvestigationReports')).length,1);assert.ok(f.reads.length<=5);assert.equal(f.queries.length,0);
  reset(f);const alerts=await f.doctor.pendingCriticalAlerts(request(order));assert.equal(alerts.alerts[0].report.Text,'Critical staff report');
  assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.ok(f.reads.length<=4);
  assert.equal(f.reads.filter(([path])=>path.endsWith('hospitalInvestigationReports')).length,0);assert.equal(writes(f),1);
});

test('order issue and dated lists have fixed operation budgets and retries perform no extra writes',async()=>{
  const f=await ordersFixture(),c=await f.doctor.orderVisitContext(request(f.scope));
  const body=request({...f.scope,VisitRevision:c.visit.Revision,CareRevision:c.care.Revision,Kind:'Prescription',Prescription:rx,ConfirmPatient:true});reset(f);
  await f.doctor.createOrder(body);assert.ok(f.reads.length<=4);assert.equal(f.queries.length,0);assert.equal(f.commits.length,1);assert.equal(writes(f),6);
  reset(f);assert.equal((await f.doctor.createOrder(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(writes(f),0);
  reset(f);await f.doctor.listOrders(request({Kind:'Prescription',DateRange:range}));assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.equal(f.reads.length,0);assert.equal(writes(f),1);
});
