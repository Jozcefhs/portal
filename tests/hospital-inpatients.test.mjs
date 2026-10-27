import test from 'node:test';
import assert from 'node:assert/strict';
import {inpatientFixture,inpatientActors,discharge,period} from './helpers/hospital-inpatient-fixture.mjs';
import {request,env} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath,HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';
import {subscriptionPlanEntitlements} from '../functions/lib/subscription-plans.js';
const reset=f=>{f.reads.length=0;f.queries.length=0;f.commits.length=0;};
const admit=f=>f.clerk.admitHospitalPatient(f.admitBody(f.scope,f.initialBed));

test('wards are Hospital-only, module controlled, and opened without unrequested records',async()=>{
  const f=await inpatientFixture();reset(f);await f.clerk.state();
  assert.equal(f.reads.length+f.queries.length+f.commits.length,0);
  assert.ok(subscriptionPlanEntitlements('Standard','hospital').includes('hospitalInpatients'));
  assert.ok(!subscriptionPlanEntitlements('Standard','school').includes('hospitalInpatients'));
  const denied=createHospitalService(env,{...inpatientActors.clerk,allowedSections:['hospitalPatients','hospitalReception']},f.db);
  await assert.rejects(denied.inpatientWards(request()),{status:403});
  await assert.rejects(f.cashier.inpatientWards(request()),{status:403});
});

test('ward and bed codes are unique, immutable and unchanged saves perform no writes',async()=>{
  const f=await inpatientFixture(),w=f.initialWard,b=f.initialBed;
  await assert.rejects(f.admin.saveHospitalWard(request({Ward:{Code:w.Code,Name:'Duplicate'}})),{status:409});
  await assert.rejects(f.admin.saveHospitalBed(request({WardId:w.WardId,Bed:{Code:b.Code,Name:'Duplicate'}})),{status:409});
  await assert.rejects(f.admin.saveHospitalWard(request({WardId:w.WardId,Revision:w.__updateTime,Ward:{Code:'CHANGED',Name:w.Name}})),/cannot be changed/);
  reset(f);assert.equal((await f.admin.saveHospitalWard(request({WardId:w.WardId,Revision:w.__updateTime,Ward:{Code:w.Code,Name:w.Name,Active:true}}))).Unchanged,true);
  assert.equal((await f.admin.saveHospitalBed(request({WardId:w.WardId,BedId:b.BedId,Revision:b.__updateTime,Bed:{Code:b.Code,Name:b.Name,Active:true}}))).Unchanged,true);
  assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);
});

test('admission replay and independent repeated clicks create one admission, movement and occupied bed',async()=>{
  const f=await inpatientFixture(),body=f.admitBody(f.scope,f.initialBed);
  const results=await Promise.all([f.clerk.admitHospitalPatient(body),f.clerk.admitHospitalPatient(body)]);
  assert.equal(results[0].AdmissionId,results[1].AdmissionId);assert.equal(f.rows('Admissions').length,1);assert.equal(f.rows('AdmissionEvents').length,1);
  assert.equal(f.rows('Beds')[0].AdmissionId,results[0].AdmissionId);assert.equal(f.rows('Wards')[0].OccupiedBeds,1);
  reset(f);assert.equal((await f.clerk.admitHospitalPatient(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);
  await assert.rejects(f.clerk.admitHospitalPatient({...body,RequestId:crypto.randomUUID()}),{status:409});
});

test('two patients competing for a bed cannot double-book it',async()=>{
  const f=await inpatientFixture(),other=await f.newVisit('Other patient');
  const results=await Promise.allSettled([f.clerk.admitHospitalPatient(f.admitBody(f.scope,f.initialBed)),f.clerk.admitHospitalPatient(f.admitBody(other,f.initialBed))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('Admissions').length,1);assert.equal(f.rows('Wards')[0].OccupiedBeds,1);
  assert.equal(f.rows('OpenAdmissions').filter(r=>r.AdmissionId).length,1);
});

test('one patient cannot obtain concurrent admissions even in different branches',async()=>{
  const f=await inpatientFixture(),path=hospitalCollectionPath(env,'Patients'),p=f.rows('Patients')[0];
  f.store.set(`${path}/${p.PatientId}`,{...p,AccessBranchIds:['main','north']});
  const north=createHospitalService(env,{...inpatientActors.admin,assignedBranchIds:['main','north'],activeBranchId:'north'},f.db);
  const w=await north.saveHospitalWard(request({BranchId:'north',Ward:{Code:'NORTH',Name:'North ward'}}));
  const b=await north.saveHospitalBed(request({BranchId:'north',WardId:w.WardId,Bed:{Code:'B1',Name:'North bed'}}));
  const v=await north.checkIn(request({BranchId:'north',PatientId:p.PatientId,Department:'Reception'}));
  const bed=f.rows('Beds').find(r=>r.BedId===b.BedId),visit=f.rows('Visits').find(r=>r.VisitId===v.VisitId);
  const results=await Promise.allSettled([admit(f),north.admitHospitalPatient(request({BranchId:'north',PatientId:p.PatientId,VisitId:v.VisitId,VisitRevision:visit.__updateTime,BedId:bed.BedId,BedRevision:bed.__updateTime,ResponsibleClinician:'Doctor north',ConfirmPatient:true}))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('Admissions').length,1);
});

test('occupied wards and beds cannot be deactivated and admission cannot bypass reception discharge',async()=>{
  const f=await inpatientFixture(),a=await admit(f),w=f.rows('Wards')[0],b=f.rows('Beds')[0],v=f.rows('Visits')[0];
  await assert.rejects(f.admin.saveHospitalWard(request({WardId:w.WardId,Revision:w.__updateTime,Ward:{Code:w.Code,Name:w.Name,Active:false}})),/deactivating/);
  await assert.rejects(f.admin.saveHospitalBed(request({WardId:w.WardId,BedId:b.BedId,Revision:b.__updateTime,Bed:{Code:b.Code,Name:b.Name,Active:false}})),/occupied bed/);
  await assert.rejects(f.clerk.updateVisit(request({VisitId:v.VisitId,Revision:v.__updateTime,Status:'Completed'})),/inpatient discharge/);
  await assert.rejects(f.clerk.dischargeHospitalPatient(f.body(a)),/clinician must sign/);
  assert.equal(f.rows('Beds')[0].AdmissionId,a.AdmissionId);
});

test('bed transfers retain the patient, visit, old assignment history and ward counts',async()=>{
  const f=await inpatientFixture(),a=await admit(f),w2=await f.ward('WARD-2','Second ward'),b2=await f.bed(w2,'BED-2');
  const original=structuredClone(f.rows('AdmissionEvents')[0]);
  const body=f.body(a,{BedId:b2.BedId,BedRevision:b2.__updateTime,Reason:'Ward allocation reviewed'});
  await f.nurse.transferHospitalBed(body);const snapshot=structuredClone(f.rows('Admissions')[0]);
  reset(f);assert.equal((await f.nurse.transferHospitalBed(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
  assert.equal(snapshot.PatientId,f.scope.PatientId);assert.equal(snapshot.VisitId,f.scope.VisitId);assert.equal(snapshot.WardId,w2.WardId);
  assert.deepEqual(f.rows('AdmissionEvents')[0],original);assert.equal(f.rows('AdmissionEvents').length,2);
  assert.equal(f.rows('Beds').find(b=>b.BedId===f.initialBed.BedId).AdmissionId,'');
  assert.deepEqual(f.rows('Wards').map(w=>w.OccupiedBeds),[0,1]);
});

test('same-ward transfer preserves occupancy totals and no-op saves leave history alone',async()=>{
  const f=await inpatientFixture(),a=await admit(f),b2=await f.bed(f.initialWard,'BED-2');
  await f.clerk.transferHospitalBed(f.body(a,{BedId:b2.BedId,BedRevision:b2.__updateTime,Reason:'Move bed'}));
  assert.equal(f.rows('Wards')[0].OccupiedBeds,1);reset(f);
  assert.equal((await f.clerk.transferHospitalBed(f.body(a,{BedId:b2.BedId,Reason:'Same bed'}))).Unchanged,true);
  assert.equal(f.commits.length,0);
});

test('signed summary versions are retained, hidden from administration and clinical approval is enforced',async()=>{
  const f=await inpatientFixture(),a=await admit(f);
  await assert.rejects(f.admin.signHospitalDischarge(f.body(a,{Summary:discharge,ConfirmClinicalReview:true})),{status:403});
  await assert.rejects(f.nurse.signHospitalDischarge(f.body(a,{Summary:discharge,ConfirmClinicalReview:true})),{status:403});
  await f.sign(a);const original=structuredClone(f.rows('DischargeSummaries')[0]);
  assert.equal((await f.admin.inpatientAdmission(f.body(a))).summary,null);
  assert.equal((await f.nurse.inpatientAdmission(f.body(a))).summary.Diagnosis,discharge.Diagnosis);
  await assert.rejects(f.clerk.inpatientHistory(f.body(a,{DateRange:period,Kind:'Summaries'})),{status:403});
  reset(f);assert.equal((await f.sign(a)).Unchanged,true);assert.equal(f.commits.length,0);
  await f.doctor.signHospitalDischarge(f.body(a,{Summary:{...discharge,FollowUp:'Revised follow-up'},Reason:'Updated follow-up arrangements',ConfirmClinicalReview:true}));
  assert.equal(f.rows('DischargeSummaries').length,2);assert.deepEqual(f.rows('DischargeSummaries')[0],original);
  assert.equal(f.rows('DischargeSummaries')[1].PreviousSummaryId,original.SummaryId);
});

test('discharge atomically frees the bed and open visit without altering clinical or financial records',async()=>{
  const f=await inpatientFixture(),a=await admit(f);await f.sign(a);
  for(const name of ['ClinicalEntries','Invoices','Payments','Orders','ChargeEvents'])f.store.set(`${hospitalCollectionPath(env,name)}/history-record`,{__id:'history-record',__updateTime:'history-v1',PatientId:f.scope.PatientId,VisitId:f.scope.VisitId,Original:true});
  const originals=[...f.store].filter(([path])=>path.endsWith('/history-record'));
  const body=f.body(a);await f.nurse.dischargeHospitalPatient(body);
  assert.equal(f.rows('Admissions')[0].Status,'Discharged');assert.equal(f.rows('Beds')[0].AdmissionId,'');assert.equal(f.rows('Wards')[0].OccupiedBeds,0);
  assert.equal(f.rows('OpenAdmissions')[0].AdmissionId,'');assert.equal(f.rows('OpenVisits')[0].VisitId,'');assert.equal(f.rows('Visits')[0].Status,'Completed');
  for(const [path,row] of originals)assert.deepEqual(f.store.get(path),row);
  reset(f);assert.equal((await f.nurse.dischargeHospitalPatient(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
  await assert.rejects(f.clerk.admitHospitalPatient(f.admitBody(f.scope,f.rows('Beds')[0])),/open visit/);
  const next=await f.clerk.checkIn(request({PatientId:f.scope.PatientId,Department:'Follow-up'}));assert.notEqual(next.VisitId,f.scope.VisitId);
});

test('new clinical work invalidates discharge approval without discarding the signed original',async()=>{
  const f=await inpatientFixture(),a=await admit(f);await f.sign(a);
  const c=await f.doctor.clinicalContext(request(f.scope));
  await f.doctor.saveConsultation(request({...f.scope,VisitRevision:c.visit.Revision,EncounterRevision:c.encounter?.Revision||'',CareRevision:c.care.Revision,DraftRevision:'',Notes:{History:'New clinical work'}}));
  await assert.rejects(f.clerk.dischargeHospitalPatient(f.body(a)),/Clinical work changed/);
  assert.equal(f.rows('DischargeSummaries').length,1);assert.equal(f.rows('Beds')[0].AdmissionId,a.AdmissionId);
});

test('concurrent transfer versus discharge preserves exactly one consistent bed outcome',async()=>{
  const f=await inpatientFixture(),a=await admit(f),b2=await f.bed(f.initialWard,'BED-2');await f.sign(a);
  const transfer=f.body(a,{BedId:b2.BedId,BedRevision:b2.__updateTime,Reason:'Transfer'}),release=f.body(a);
  const result=await Promise.allSettled([f.clerk.transferHospitalBed(transfer),f.nurse.dischargeHospitalPatient(release)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const active=f.rows('Admissions')[0].Status==='Admitted';assert.equal(f.rows('Beds').filter(b=>b.AdmissionId).length,active?1:0);assert.equal(f.rows('Wards')[0].OccupiedBeds,active?1:0);
});

test('bed and patient references, inactive beds, read-only subscriptions and branch access are checked server-side',async()=>{
  const f=await inpatientFixture(),body=f.admitBody(f.scope,f.initialBed);
  await assert.rejects(f.clerk.admitHospitalPatient({...body,PatientId:'another-patient'}),/does not match/);
  await assert.rejects(f.clerk.admitHospitalPatient({...body,BranchId:'north'}),{status:403});
  await assert.rejects(f.clerk.admitHospitalPatient({...body,ConfirmPatient:false}),/Confirm the patient/);
  const readonly=createHospitalService(env,{...inpatientActors.clerk,subscriptionReadOnly:true},f.db);
  await assert.rejects(readonly.admitHospitalPatient(body),{status:403});
  const b=f.initialBed;await f.admin.saveHospitalBed(request({WardId:b.WardId,BedId:b.BedId,Revision:b.__updateTime,Bed:{Code:b.Code,Name:b.Name,Active:false}}));
  await assert.rejects(f.clerk.admitHospitalPatient(f.admitBody(f.scope,f.rows('Beds')[0])),/unavailable/);
  assert.equal(f.rows('Admissions').length,0);
});

test('history is date-first, 30 rows per page, branch scoped, and does not load clinical or billing collections',async()=>{
  const f=await inpatientFixture();await admit(f);reset(f);
  await assert.rejects(f.clerk.inpatientAdmissions(request()));await assert.rejects(f.clerk.inpatientHistory(request({AdmissionId:'missing-admission'})));
  assert.equal(f.reads.length+f.queries.length+f.commits.length,0);
  const results=await f.clerk.inpatientAdmissions(request({DateRange:period}));assert.equal(results.admissions.length,1);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.equal(f.reads.length,0);
  assert.deepEqual(f.queries[0].filters.map(r=>r.field),['BranchId','CreatedAt','CreatedAt']);
  assert.ok(!f.queries.some(q=>/Clinical|Invoice|Payment/.test(q.path)));
});

test('equal-timestamp admissions paginate without skipping or duplicating records',async()=>{
  const f=await inpatientFixture();await admit(f);const sample=f.rows('Admissions')[0],path=hospitalCollectionPath(env,'Admissions');
  for(let i=0;i<65;i++){const id=`admission-${String(i).padStart(3,'0')}`;f.store.set(`${path}/${id}`,{...sample,AdmissionId:id,__id:id});}
  const found=[];let Cursor;do{const r=await f.clerk.inpatientAdmissions(request({DateRange:period,...(Cursor?{Cursor}:{})}));assert.ok(r.admissions.length<=30);found.push(...r.admissions.map(a=>a.AdmissionId));Cursor=r.next;}while(Cursor);
  assert.equal(found.length,66);assert.equal(new Set(found).size,66);
});

test('inpatient backup serialisation retains ward, bed, visit, summary and movement references',async()=>{
  const f=await inpatientFixture(),a=await admit(f);await f.sign(a);await f.nurse.dischargeHospitalPatient(f.body(a));
  for(const n of ['Wards','WardVersions','Beds','BedVersions','Admissions','OpenAdmissions','AdmissionEvents','DischargeSummaries'])assert.ok(HOSPITAL_COLLECTIONS.includes(n));
  const restored=new Map(JSON.parse(JSON.stringify([...f.store]))),admission=restored.get(`${hospitalCollectionPath(env,'Admissions')}/${a.AdmissionId}`);
  for(const [n,k] of [['Wards','WardId'],['Beds','BedId'],['Visits','VisitId'],['DischargeSummaries','DischargeSummaryId']])assert.ok(restored.has(`${hospitalCollectionPath(env,n)}/${admission[k]}`));
  assert.equal(f.rows('AdmissionEvents').length,3);
});

test('released beds need preparation confirmation and cannot be allocated prematurely',async()=>{
  const f=await inpatientFixture(),a=await admit(f);await f.sign(a);await f.clerk.dischargeHospitalPatient(f.body(a));
  const next=await f.newVisit('Next patient'),bed=f.rows('Beds')[0];assert.equal(bed.Ready,false);
  await assert.rejects(f.clerk.admitHospitalPatient(f.admitBody(next,bed)),/marked ready/);
  await assert.rejects(f.nurse.prepareHospitalBed(request({BedId:bed.BedId,Revision:bed.__updateTime})),/Confirm/);
  const body=request({BedId:bed.BedId,Revision:bed.__updateTime,ConfirmReady:true});await f.nurse.prepareHospitalBed(body);
  reset(f);assert.equal((await f.nurse.prepareHospitalBed(body)).replayed,true);assert.equal(f.commits.length,0);
  await f.clerk.admitHospitalPatient(f.admitBody(next,f.rows('Beds')[0]));assert.equal(f.rows('Admissions').length,2);
});

test('a lost committed transfer response can be retried without another movement or audit',async()=>{
  const f=await inpatientFixture(),a=await admit(f),target=await f.bed(f.initialWard,'BED-2');let once=true;
  const service=createHospitalService(env,inpatientActors.nurse,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await f.db.batchCommitLiteralDocuments(...args);if(once){once=false;throw Object.assign(Error('Simulated lost response'),{status:503});}}});
  const body=f.body(a,{BedId:target.BedId,BedRevision:target.__updateTime,Reason:'Transfer reviewed'});
  await assert.rejects(service.transferHospitalBed(body),/lost response/);const count=f.rows('Audit').length;reset(f);
  assert.equal((await service.transferHospitalBed(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal(f.rows('Audit').length,count);assert.equal(f.rows('AdmissionEvents').length,2);
});

test('new investigation orders invalidate signed discharge and race safely with final release',async()=>{
  const f=await inpatientFixture(),a=await admit(f);await f.sign(a);const c=await f.doctor.orderVisitContext(request(f.scope));
  const order=request({...f.scope,VisitRevision:c.visit.Revision,CareRevision:c.care.Revision,Kind:'Imaging',Investigation:{Service:'Chest study',Indication:'Requested by clinician',Priority:'Routine'},ConfirmPatient:true});
  const issued=await f.doctor.createOrder(order);assert.equal(f.rows('Visits')[0].DischargeApprovalId,'');
  await assert.rejects(f.clerk.dischargeHospitalPatient(f.body(a)),/Clinical work changed/);
  await f.doctor.signHospitalDischarge(f.body(a,{Summary:discharge,Reason:'Reviewed investigation follow-up',ConfirmClinicalReview:true}));
  const r=await f.doctor.orderVisitContext(request(f.scope));order.RequestId=crypto.randomUUID();order.VisitRevision=r.visit.Revision;order.CareRevision=r.care.Revision;
  const results=await Promise.allSettled([f.doctor.createOrder(order),f.clerk.dischargeHospitalPatient(f.body(a))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  if(results[0].status==='fulfilled'){assert.equal(f.rows('Visits')[0].DischargeApprovalId,'');await assert.rejects(f.clerk.dischargeHospitalPatient(f.body(a)),/Clinical work changed/);}
  assert.equal(f.rows('DischargeSummaries').length,2);assert.ok(f.rows('Orders').some(r=>r.OrderId===issued.OrderId));
});

test('admission and discharge use fixed exact reads and atomic writes; bed pages avoid per-patient reads',async()=>{
  const f=await inpatientFixture(),body=f.admitBody(f.scope,f.initialBed);reset(f);
  const a=await f.clerk.admitHospitalPatient(body);assert.equal(f.queries.length,0);assert.equal(f.reads.length,7);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,8);
  reset(f);const beds=await f.nurse.inpatientBeds(request({WardId:f.initialWard.WardId}));assert.equal(beds.beds.length,1);assert.equal(f.reads.length,1);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.equal(f.commits[0].length,1);
  await f.sign(a);const release=f.body(a);reset(f);await f.clerk.dischargeHospitalPatient(release);
  assert.equal(f.reads.length,8);assert.equal(f.queries.length,0);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,9);
});
