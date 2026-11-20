import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,request,actor,env} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';

const ref='RED-237';
const triage={Complaint:'Synthetic observation',Urgency:'Urgent',AllergyStatus:'Known allergies',Allergies:'Reported reaction',Vitals:{PulseBpm:84}};
const treatment={Treatment:'Synthetic intervention',Response:'Reviewed',ObservedAt:'2026-10-26T11:45:00Z'};
function setup(){
  const f=fixture();
  const clinician=(role,overrides={})=>createHospitalService(env,{...actor,role,username:role+'-one',displayName:role,
    allowedSections:['hospitalReception','hospitalTriage','hospitalConsultations','hospitalNursing','hospitalPatients'],...overrides},f.db);
  return {...f,doctor:clinician('Doctor'),nurse:clinician('Nurse'),clinician};
}
function entry(type='Triage',seq=0,Reference=ref){
  return request({Reference,ConfirmedReference:Reference,Type:type,Content:type==='Triage'?triage:treatment,Sequence:seq});
}
const intake=(f,Reference=ref)=>f.service.recordEmergencyArrival(request({Reference,ArrivalNote:'Synthetic case'}));
async function identifyBody(f,p,Reference=ref){
  const row=(await f.service.emergencyArrivals(request({Reference}))).arrivals[0];
  const details=await f.details(p.PatientId);
  return request({Reference,Revision:row.Revision,PatientRevision:details.Revision,PatientId:p.PatientId,
    HospitalNumber:p.HospitalNumber,IdentityEvidence:'Confirmed against wristband and registration'});
}
test('signed wristband notes survive identification intact and are accessible only on the verified visit',async()=>{
  const f=setup();await intake(f);
  const q=f.queries.length,w=f.commits.length;
  const empty=await f.doctor.emergencyCareHistory(request({Reference:ref}));
  assert.equal(empty.sequence,0);assert.equal(f.queries.length,q);assert.equal(f.commits.length,w);
  const first=entry();const signed=await f.nurse.signEmergencyCare(first);
  const writes=f.commits.length,reads=f.reads.length;
  assert.equal((await f.nurse.signEmergencyCare(first)).EntryId,signed.EntryId);
  assert.equal(f.commits.length,writes);assert.equal(f.reads.length,reads+1);
  await f.doctor.signEmergencyCare(entry('Treatment',1));
  const notes=f.rows('EmergencyCareEntries');
  assert.equal(notes.length,2);assert.equal(notes[0].Content.Vitals.PulseBpm,84);
  assert.equal(notes[1].Content.ObservedAt,treatment.ObservedAt.replace('Z','.000Z'));
  assert.equal(notes[0].AuthorUsername,'Nurse-one');assert.equal(notes[1].AuthorUsername,'Doctor-one');
  const p=await f.register();const identify=await identifyBody(f,p);
  const queryCount=f.queries.length;
  const {VisitId}=await f.service.identifyEmergencyArrival(identify);
  assert.equal(f.queries.length,queryCount,'identification never scans notes');
  assert.deepEqual(f.rows('EmergencyCareEntries'),notes);
  assert.equal(f.rows('Visits')[0].HasPreIdentificationCare,true);
  const scope={VisitId,PatientId:p.PatientId};
  assert.deepEqual((await f.doctor.visitEmergencyWristbands(request(scope))).references,[ref]);
  const result=await f.nurse.emergencyCareHistory(request({...scope,Reference:ref}));
  assert.deepEqual(result.entries.map(e=>e.EntryId),notes.map(n=>n.EntryId));
  await assert.rejects(f.nurse.emergencyCareHistory(request({Reference:ref})),/identified visit/);
  await assert.rejects(f.nurse.emergencyCareHistory(request({...scope,VisitId:'another-visit',Reference:ref})),/identified visit/);
  await assert.rejects(f.doctor.visitEmergencyWristbands(request({...scope,PatientId:'another-patient'})),/unavailable/);
  await assert.rejects(f.doctor.signEmergencyCare(entry('Triage',2)),/identified/);
  assert.equal(f.rows('ClinicalEntries').length+f.rows('Invoices').length+f.rows('Orders').length,0);
  assert.ok(HOSPITAL_COLLECTIONS.includes('EmergencyCareEntries'));
});
test('two wristbands linked to an existing visit retain separate histories and existing care',async()=>{
  const f=setup(),p=await f.register(),{VisitId}=await f.service.checkIn(request({PatientId:p.PatientId,Department:'Surgery'}));
  for(const r of [ref,'RED-999']){
    await intake(f,r);await f.doctor.signEmergencyCare(entry('Treatment',0,r));
    await f.service.identifyEmergencyArrival(await identifyBody(f,p,r));
  }
  const scope={PatientId:p.PatientId,VisitId};
  assert.deepEqual(new Set((await f.doctor.visitEmergencyWristbands(request(scope))).references),new Set([ref,'RED-999']));
  assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('Visits')[0].Department,'Surgery');
  for(const Reference of [ref,'RED-999']){
    const {entries}=await f.doctor.emergencyCareHistory(request({...scope,Reference}));
    assert.deepEqual(entries.map(e=>e.EntryId),f.rows('EmergencyCareEntries').filter(e=>e.Reference===Reference).map(e=>e.EntryId));
  }
});
test('care and identification racing cannot orphan or attach an entry to the wrong encounter',async()=>{
  const f=setup();await intake(f);
  const p=await f.register(),body=await identifyBody(f,p);
  const results=await Promise.allSettled([f.service.identifyEmergencyArrival(body),f.nurse.signEmergencyCare(entry())]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  if(results[0].status==='rejected'){
    const {VisitId}=await f.service.identifyEmergencyArrival(await identifyBody(f,p));
    assert.equal((await f.doctor.emergencyCareHistory(request({VisitId,PatientId:p.PatientId,Reference:ref}))).entries.length,1);
  }else assert.equal(f.rows('EmergencyCareEntries').length,0);
});
test('managed permissions, branch isolation, clinician validation and stale edits',async()=>{
  const f=setup();await intake(f);
  await assert.rejects(f.service.signEmergencyCare(entry()),/role/);
  await assert.rejects(f.service.emergencyCareHistory(request({Reference:ref})),/role/);
  await assert.rejects(f.clinician('Doctor',{subscriptionReadOnly:true}).signEmergencyCare(entry()),/viewing only/);
  const north=f.clinician('Doctor',{assignedBranchIds:['north']});
  await assert.rejects(north.signEmergencyCare({...entry(),BranchId:'north'}),/unavailable/);
  await assert.rejects(north.emergencyCareHistory(request({BranchId:'north',Reference:ref})),/unavailable/);
  await assert.rejects(f.nurse.signEmergencyCare({...entry(),ConfirmedReference:'OTHER'}),/Confirm the wristband/);
  await assert.rejects(f.nurse.signEmergencyCare({...entry(),Content:{...triage,Vitals:{SpO2Percent:101}}}),/numeric/);
  await assert.rejects(f.doctor.signEmergencyCare({...entry('Treatment'),Content:{Treatment:'   '}}),/treatment given/);
  await assert.rejects(f.clinician('Nurse',{allowedSections:['hospitalTriage']}).signEmergencyCare(entry('Treatment')),/role/);
  const saves=await Promise.allSettled([f.nurse.signEmergencyCare(entry()),f.doctor.signEmergencyCare(entry('Treatment'))]);
  assert.equal(saves.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('EmergencyCareEntries').length,1);
  await assert.rejects(f.nurse.signEmergencyCare(entry()),/changed/);
});
test('care history pages are bounded and only explicit clinical reads write a read audit',async()=>{
  const f=setup();await intake(f);
  for(let i=0;i<32;i++)await f.doctor.signEmergencyCare(entry('Treatment',i));
  const writes=f.commits.length,queries=f.queries.length;
  const one=await f.doctor.emergencyCareHistory(request({Reference:ref}));
  const two=await f.doctor.emergencyCareHistory(request({Reference:ref,Cursor:one.next}));
  assert.equal(one.entries.length,30);assert.equal(two.entries.length,2);
  assert.equal(new Set([...one.entries,...two.entries].map(e=>e.EntryId)).size,32);
  assert.ok(f.queries.slice(queries).every(q=>q.limit===31));
  assert.equal(f.queries.length-queries,2);assert.ok(f.commits.slice(writes).every(w=>w.length===1&&w[0].collectionPath.endsWith('Audit')));
});
