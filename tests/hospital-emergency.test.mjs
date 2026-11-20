import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request, actor, env } from './helpers/hospital-fixture.mjs';
import { createHospitalService } from '../functions/lib/hospital-service.js';
const arrival = {Reference:'ED-1001', ArrivalNote:'Arrived with ambulance crew'};
async function intake(f) {
  await f.service.recordEmergencyArrival(request(arrival));
  return (await f.service.emergencyArrivals(request({Reference:arrival.Reference}))).arrivals[0];
}
async function identification(f,row) {
  const {PatientId} = await f.register();
  const person = await f.details(PatientId);
  return request({Reference:row.Reference, Revision:row.Revision, PatientId, HospitalNumber:person.HospitalNumber,
    PatientRevision:person.Revision, IdentityEvidence:'Wristband and registration details verified'});
}
test('arrival requires no patient chart; retries and repeated wristband entries do not create new records', async()=>{
  const f=fixture(), input=request(arrival);
  await Promise.all([f.service.recordEmergencyArrival(input), f.service.recordEmergencyArrival(input)]);
  const writes=f.commits.length;
  assert.equal((await f.service.recordEmergencyArrival(request({...arrival,Reference:'ed-1001'}))).Unchanged,true);
  await assert.rejects(f.service.recordEmergencyArrival(request({...arrival,ArrivalNote:'Another arrival'})),/already has an arrival/);
  assert.equal(f.commits.length,writes);
  assert.equal(f.rows('EmergencyArrivals').length,1);
  assert.equal(f.rows('Patients').length+f.rows('Visits').length,0);
});
test('identity confirmation preserves arrival time, verifies revision, and can open only one visit',async()=>{
  const f=fixture(), row=await intake(f), body=await identification(f,row);
  await assert.rejects(f.service.identifyEmergencyArrival({...body,PatientRevision:'stale'}),/Reload and verify/);
  await assert.rejects(f.service.identifyEmergencyArrival({...body,HospitalNumber:'other'}),/Reload and verify/);
  await assert.rejects(f.service.identifyEmergencyArrival({...body,IdentityEvidence:''}),/identity was verified/);
  const [one,two]=await Promise.all([f.service.identifyEmergencyArrival(body),f.service.identifyEmergencyArrival(body)]);
  assert.equal(one.VisitId,two.VisitId);
  const visit=f.rows('Visits')[0];
  assert.equal(visit.Department,'Emergency');assert.equal(visit.CreatedAt,row.CreatedAt);
  assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('OpenVisits').length,1);
  const writes=f.commits.length;
  assert.equal((await f.service.identifyEmergencyArrival({...body,RequestId:crypto.randomUUID()})).Unchanged,true);
  await assert.rejects(f.service.identifyEmergencyArrival({...body,RequestId:crypto.randomUUID(),PatientId:'different-patient'}),/another patient/);
  assert.deepEqual((await f.service.emergencyArrivals(request())).arrivals,[]);
  assert.equal((await f.service.emergencyArrivals(request({Reference:row.Reference}))).arrivals[0].Status,'Identified');
  assert.equal(f.rows('EmergencyArrivals')[0].IdentityEvidence,body.IdentityEvidence);
  assert.equal(f.commits.length,writes);
  assert.equal(f.rows('Invoices').length+f.rows('Payments').length,0);
});
test('an existing visit retains its department, timestamps and clinical record',async()=>{
  const f=fixture(),row=await intake(f),body=await identification(f,row);
  const check=await f.service.checkIn(request({PatientId:body.PatientId,Department:'Outpatients'}));
  const before=f.rows('Visits');
  const result=await f.service.identifyEmergencyArrival(body);
  assert.equal(result.VisitId,check.VisitId);assert.equal(result.ReusedVisit,true);
  assert.deepEqual(f.rows('Visits'),before);
});
test('branch, module and subscription permissions constrain reads and identification',async()=>{
  const f=fixture(),row=await intake(f),body=await identification(f,row);
  const north=createHospitalService(env,{...actor,assignedBranchIds:['north']},f.db);
  assert.equal((await north.emergencyArrivals(request({Reference:row.Reference,BranchId:'north'}))).arrivals.length,0);
  await assert.rejects(north.identifyEmergencyArrival({...body,BranchId:'north'}),/not found/);
  await assert.rejects(f.service.recordEmergencyArrival(request({...arrival,BranchId:'north'})),/assigned access/);
  const limited=createHospitalService(env,{...actor,allowedSections:['hospitalReception']},f.db);
  await assert.rejects(limited.identifyEmergencyArrival(body),/role/);
  const readonly=createHospitalService(env,{...actor,subscriptionReadOnly:true},f.db);
  await assert.rejects(readonly.recordEmergencyArrival(request(arrival)),/viewing only/);
});
test('pending list pages use one bounded branch query per page and no writes',async()=>{
  const f=fixture();
  for(let i=0;i<32;i++)await f.service.recordEmergencyArrival(request({...arrival,Reference:'ED-'+(1000+i)}));
  const writes=f.commits.length,reads=f.reads.length;
  const first=await f.service.emergencyArrivals(request());
  const second=await f.service.emergencyArrivals(request({Cursor:first.next}));
  assert.equal(first.arrivals.length,30);assert.equal(second.arrivals.length,2);
  assert.equal(new Set([...first.arrivals,...second.arrivals].map(row=>row.Reference)).size,32);
  assert.ok(f.queries.every(q=>q.limit===31));assert.equal(f.reads.length,reads);assert.equal(f.commits.length,writes);
});
