import test from 'node:test';
import assert from 'node:assert/strict';
import {inpatientFixture,inpatientActors,discharge,period} from './helpers/hospital-inpatient-fixture.mjs';
import {env,request} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';

const reset=f=>{f.reads.length=0;f.queries.length=0;f.commits.length=0;};
async function closed(){
  const f=await inpatientFixture(),a=await f.clerk.admitHospitalPatient(f.admitBody(f.scope,f.initialBed));
  await f.sign(a);await f.clerk.dischargeHospitalPatient(f.body(a));
  f.amend=(extra={})=>f.body(a,{Summary:{...discharge,FollowUp:'Corrected clinician follow-up'},Reason:'Corrected follow-up transcription',ConfirmClinicalReview:true,...extra});
  return {...f,a};
}

test('post-discharge amendments retain signed originals and every non-admission business record',async()=>{
  const f=await closed(),original=structuredClone(f.rows('DischargeSummaries')[0]),admission=structuredClone(f.rows('Admissions')[0]);
  // Existing payment/order references must not be touched by a clinical correction.
  for(const name of ['Invoices','Payments','Orders','ClinicalEntries'])f.store.set(`branches/main/hospital${name}/existing`,{Reference:'existing',Amount:12345,__updateTime:'original'});
  const before=new Map(structuredClone([...f.store]));reset(f);const saved=await f.doctor.amendHospitalDischarge(f.amend());
  assert.equal(f.reads.length,5);assert.equal(f.queries.length,0);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,5);
  assert.deepEqual(f.rows('DischargeSummaries').find(r=>r.SummaryId===original.SummaryId),original);
  for(const [key,row] of before)if(!key.includes('/hospitalAdmissions/'))assert.deepEqual(f.store.get(key),row,key);
  const current=f.rows('Admissions')[0],summary=f.rows('DischargeSummaries').find(r=>r.SummaryId===saved.SummaryId);
  assert.equal(current.DischargeSummaryId,original.SummaryId);assert.equal(current.LatestDischargeSummaryId,saved.SummaryId);
  for(const key of ['Status','DischargedAt','DischargedBy','DischargeSignedAt','DischargeAuthor','VisitId','BedId','WardId'])assert.equal(current[key],admission[key],key);
  assert.equal(summary.PreviousSummaryId,original.SummaryId);assert.equal(summary.OriginalDischargeSummaryId,original.SummaryId);
  assert.equal(summary.Type,'Post-discharge amendment');assert.equal(summary.SignedBy,'doctor');assert.equal(summary.Reason,'Corrected follow-up transcription');
  assert.equal((await f.nurse.inpatientAdmission(f.body(f.a))).summary.SummaryId,saved.SummaryId);
});

test('amendments form a retained version chain and cannot silently replace the departure approval',async()=>{
  const f=await closed(),original=f.rows('DischargeSummaries')[0],first=await f.doctor.amendHospitalDischarge(f.amend());
  const second=await f.doctor.amendHospitalDischarge(f.amend({Summary:{...discharge,FollowUp:'Further reviewed follow-up'},Reason:'Additional clinician correction'}));
  const row=f.rows('DischargeSummaries').find(r=>r.SummaryId===second.SummaryId);
  assert.equal(row.PreviousSummaryId,first.SummaryId);assert.equal(row.OriginalDischargeSummaryId,original.SummaryId);
  assert.equal(f.rows('DischargeSummaries').length,3);assert.equal(f.rows('Visits')[0].DischargeApprovalId,original.SummaryId);
  const restored=new Map(JSON.parse(JSON.stringify([...f.store])));
  for(const [key,value] of f.store)assert.deepEqual(restored.get(key),value,'backup serialization retains all amendment references');
});

test('amending a former admission leaves a subsequent admission and its occupied bed untouched',async()=>{
  const f=await closed(),bed=f.rows('Beds')[0];
  await f.nurse.prepareHospitalBed(request({BedId:bed.BedId,Revision:bed.__updateTime,ConfirmReady:true}));
  const next=await f.clerk.checkIn(request({PatientId:f.scope.PatientId,Department:'Outpatients'}));
  await f.clerk.admitHospitalPatient(f.admitBody({PatientId:f.scope.PatientId,VisitId:next.VisitId},f.rows('Beds')[0]));
  const oldId=f.a.AdmissionId,before=new Map(structuredClone([...f.store]));await f.doctor.amendHospitalDischarge(f.amend());
  for(const [key,row] of before)if(!key.endsWith(`/hospitalAdmissions/${oldId}`))assert.deepEqual(f.store.get(key),row,key);
  assert.equal(f.rows('Admissions').filter(r=>r.Status==='Admitted').length,1);assert.equal(f.rows('Beds').filter(r=>r.AdmissionId).length,1);
});

test('successful and lost-response retries use one read and no duplicate summary, event or audit',async()=>{
  const f=await closed(),body=f.amend();let lose=true;
  const service=createHospitalService(env,inpatientActors.doctor,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await f.db.batchCommitLiteralDocuments(...args);if(lose){lose=false;throw Object.assign(Error('Lost response'),{status:503});}}});
  await assert.rejects(service.amendHospitalDischarge(body),/Lost response/);const snapshot=structuredClone([...f.store]);reset(f);
  assert.equal((await service.amendHospitalDischarge(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);assert.deepEqual([...f.store],snapshot);
  await assert.rejects(service.amendHospitalDischarge({...body,Reason:'Different request'}),/already used/);
});

test('fresh unchanged submissions create no versions, operation receipts or audits',async()=>{
  const f=await closed();await f.doctor.amendHospitalDischarge(f.amend());const before=structuredClone([...f.store]);reset(f);
  assert.equal((await f.doctor.amendHospitalDischarge(f.amend())).Unchanged,true);
  assert.equal(f.reads.length,5);assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);assert.deepEqual([...f.store],before);
});

test('competing amendments commit one complete version, and stale edits cannot overwrite it',async()=>{
  const f=await closed(),body=f.amend();reset(f);
  const result=await Promise.allSettled([f.doctor.amendHospitalDischarge(body),f.doctor.amendHospitalDischarge({...body,RequestId:crypto.randomUUID(),Reason:'Another clinician correction'})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.status,409);
  assert.equal(f.commits.length,1);assert.equal(f.rows('DischargeSummaries').length,2);
  await assert.rejects(f.doctor.amendHospitalDischarge({...body,RequestId:crypto.randomUUID()}),/changed/);
});

test('clinical role, module, branch and read-only checks protect amendments before any writes',async()=>{
  const f=await closed();reset(f);
  for(const name of ['admin','clerk','nurse','cashier'])await assert.rejects(f[name].amendHospitalDischarge(f.amend()),e=>e.status===403);
  for(const user of [{...inpatientActors.doctor,subscriptionReadOnly:true},{...inpatientActors.doctor,allowedSections:['hospitalPatients']},{...inpatientActors.doctor,subscriptionActive:false}]){
    if(user.subscriptionActive===false)assert.throws(()=>createHospitalService(env,user,f.db),e=>e.status===403);
    else await assert.rejects(createHospitalService(env,user,f.db).amendHospitalDischarge(f.amend()),e=>e.status===403);
  }
  await assert.rejects(f.doctor.amendHospitalDischarge(f.amend({BranchId:'north'})),e=>e.status===403);
  assert.equal(f.commits.length,0);assert.equal(f.reads.length,0);
  const director=createHospitalService(env,{...inpatientActors.doctor,role:'Medical Director'},f.db);
  assert.equal((await director.amendHospitalDischarge(f.amend())).ok,true);
});

test('amendments require a reason, complete summary, verified patient and clinical review',async()=>{
  const f=await closed();reset(f);
  for(const extra of [{Reason:''},{Reason:'x'.repeat(1001)},{ConfirmPatient:false},{ConfirmClinicalReview:false},{Summary:{...discharge,Diagnosis:''}}])await assert.rejects(f.doctor.amendHospitalDischarge(f.amend(extra)),e=>e.status===400);
  assert.equal(f.reads.length,0);assert.equal(f.commits.length,0);
  await assert.rejects(f.doctor.amendHospitalDischarge(f.amend({PatientId:'different-patient'})),/does not match/);assert.equal(f.commits.length,0);
});

test('open admissions use normal signing, while broken completed-admission references are rejected',async()=>{
  const f=await inpatientFixture(),a=await f.clerk.admitHospitalPatient(f.admitBody(f.scope,f.initialBed));await f.sign(a);reset(f);
  await assert.rejects(f.doctor.amendHospitalDischarge(f.body(a,{Summary:discharge,Reason:'Correction',ConfirmClinicalReview:true})),/Only a completed discharge/);assert.equal(f.commits.length,0);
  await f.clerk.dischargeHospitalPatient(f.body(a));const key=[...f.store.keys()].find(k=>k.includes('/hospitalVisits/')),visit=f.store.get(key);f.store.set(key,{...visit,DischargeApprovalId:'wrong-summary'});reset(f);
  await assert.rejects(f.doctor.amendHospitalDischarge(f.body(a,{Summary:discharge,Reason:'Correction',ConfirmClinicalReview:true})),/original signed summary/);assert.equal(f.commits.length,0);
});

test('missing and cross-patient, visit, admission or branch summary pointers fail closed',async()=>{
  const f=await closed(),key=[...f.store.keys()].find(k=>k.includes('/hospitalDischargeSummaries/')),original=structuredClone(f.store.get(key));
  for(const field of ['SummaryId','PatientId','VisitId','AdmissionId','BranchId','OriginalDischargeSummaryId']){
    f.store.set(key,{...original,[field]:'different'});reset(f);
    await assert.rejects(f.doctor.amendHospitalDischarge(f.amend()),/summary reference/);assert.equal(f.commits.length,0);
  }
  f.store.delete(key);await assert.rejects(f.doctor.amendHospitalDischarge(f.amend()),/summary reference/);
});

test('amendment history stays date-scoped, bounded and private, with no clinical content in general events',async()=>{
  const f=await closed();await f.doctor.amendHospitalDischarge(f.amend());reset(f);
  await assert.rejects(f.nurse.inpatientHistory(f.body(f.a,{Kind:'Summaries'})));assert.equal(f.queries.length,0);
  const history=await f.nurse.inpatientHistory(f.body(f.a,{Kind:'Summaries',DateRange:period}));assert.equal(history.entries.length,2);
  assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);
  assert.ok(f.queries[0].filters.some(r=>r.field==='AdmissionId'&&r.value===f.a.AdmissionId));assert.ok(f.queries[0].filters.some(r=>r.field==='BranchId'&&r.value==='main'));
  await assert.rejects(f.admin.inpatientHistory(f.body(f.a,{Kind:'Summaries',DateRange:period})),e=>e.status===403);
  assert.equal((await f.admin.inpatientAdmission(f.body(f.a))).summary,null);
  const events=await f.admin.inpatientHistory(f.body(f.a,{DateRange:period}));
  assert.match(JSON.stringify(events),/Discharge summary amended/);assert.doesNotMatch(JSON.stringify(events),/Corrected follow-up transcription|Corrected clinician follow-up|Diagnosis/);
});
