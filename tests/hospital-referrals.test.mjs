import test from 'node:test';
import assert from 'node:assert/strict';
import {referralsFixture,referralActors,referralPeriod} from './helpers/hospital-referrals-fixture.mjs';
import {request,env} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';

test('signed referral preserves source records, shares a reviewed snapshot and has bounded operations',async()=>{
 const f=await referralsFixture(),body=await f.signBody(),before=f.rows('Visits')[0];f.reset();const r=await f.doctor.signReferral(body);
 assert.equal(f.reads.length,5);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,2);assert.equal(f.commits[0].length,7);
 assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('Visits')[0].Status,before.Status);assert.equal(f.rows('Patients')[0].AccessBranchIds.length,1);
 const row=f.rows('Referrals')[0];assert.equal(row.Summary,body.Referral.Summary);assert.equal(row.SignedBy,'doctor');assert.equal(row.Status,'Awaiting acknowledgement');
 f.reset();assert.equal((await f.doctor.signReferral(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
 await assert.rejects(()=>f.sign(),/open referral already exists/);assert.equal(f.rows('Referrals').length,1);assert.equal(r.PatientId,f.PatientId);
});
test('cross-branch acceptance reuses patient and creates exactly one receiving visit with no charges',async()=>{
 const f=await referralsFixture(),r=await f.sign(),body=f.actionBody(r),source=structuredClone(f.rows('Visits')[0]);
 f.reset();const result=await f.receiving.updateReferral(body);assert.equal(f.reads.length,4);assert.equal(f.commits[0].length,7);
 assert.equal(f.rows('Patients').length,1);assert.deepEqual(f.rows('Patients')[0].AccessBranchIds,['main','north']);assert.equal(f.rows('Visits').length,2);
 assert.deepEqual(f.rows('Visits').find(v=>v.VisitId===source.VisitId),source);assert.equal(f.rows('ChargeEvents').length,0);assert.equal(f.rows('Invoices').length,0);
 f.reset();assert.equal((await f.receiving.updateReferral(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
 await assert.rejects(()=>f.receiving.updateReferral(f.actionBody(r)),/no longer applies/);assert.equal(f.rows('Visits').length,2);assert.ok(result.VisitId);
});
test('only designated receiving doctor accepts; administrative and nursing roles cannot read letters',async()=>{
 const f=await referralsFixture(),r=await f.sign(),b=f.actionBody(r);
 for(const role of ['admin','nurse','reception'])await assert.rejects(()=>f[role].referralDetails({...b,BranchId:'main'}),e=>e.status===403);
 const other=createHospitalService(env,{...referralActors.receiving,username:'other'},f.db);
 await assert.rejects(()=>other.referralDetails(b),e=>e.status===404);
 await assert.rejects(()=>f.doctor.updateReferral({...b,BranchId:'main'}),e=>e.status===403);
 const incoming=await f.receiving.referralRegister(request({BranchId:'north',Direction:'Incoming',DateRange:referralPeriod}));assert.equal(incoming.referrals.length,1);assert.equal(incoming.referrals[0].Summary,undefined);
});
test('acceptance requires explicit patient and shared-care confirmation',async()=>{
 const f=await referralsFixture(),r=await f.sign();
 await assert.rejects(()=>f.receiving.updateReferral(f.actionBody(r,{ConfirmPatient:false})),/Confirm the patient/);
 await assert.rejects(()=>f.receiving.updateReferral(f.actionBody(r,{ConfirmSharedCare:false})),/Confirm receiving care/);
 assert.equal(f.rows('Visits').length,1);assert.deepEqual(f.rows('Patients')[0].AccessBranchIds,['main']);
});
test('existing receiving visit is linked explicitly without overwriting clinical or financial fields',async()=>{
 const f=await referralsFixture(),r=await f.sign();
 const p=f.rows('Patients')[0];p.AccessBranchIds.push('north');f.store.set(`hospitalWorkspaces/test-hospital/hospitalPatients/${p.PatientId}`,p);
 const reception=createHospitalService(env,{...referralActors.reception,assignedBranchIds:['north']},f.db);
 const v=await reception.checkIn(request({BranchId:'north',PatientId:f.PatientId,Department:'Emergency'}));
 const saved=f.rows('Visits').find(x=>x.VisitId===v.VisitId);saved.AdmissionId='admission-original';saved.Balance=33;f.store.set(`hospitalWorkspaces/test-hospital/hospitalVisits/${v.VisitId}`,saved);
 await assert.rejects(()=>f.receiving.updateReferral(f.actionBody(r)),/already has an open/);
 const d=await f.receiving.referralDetails(f.actionBody(r));assert.equal(d.receivingVisit.VisitId,v.VisitId);
 await f.receiving.updateReferral(f.actionBody(r,{ReceivingVisitId:v.VisitId}));const after=f.rows('Visits').find(x=>x.VisitId===v.VisitId);
 assert.equal(after.AdmissionId,'admission-original');assert.equal(after.Balance,33);assert.equal(after.Department,'Emergency');assert.equal(f.rows('Visits').length,2);
});
test('external acknowledgement and completion record evidence without opening a visit or sending messages',async()=>{
 const f=await referralsFixture(),r=await f.sign({Referral:{Kind:'External',Facility:'Outside Hospital',RecipientName:'Specialist',Department:'Surgery',Urgency:'Urgent',Reason:'Specialist review',Summary:'Approved summary'}});
 await assert.rejects(()=>f.doctor.updateReferral(f.actionBody(r,{BranchId:'main'})),/actually received/);
 await f.doctor.updateReferral(f.actionBody(r,{BranchId:'main',ConfirmExternalAcknowledgement:true}));
 await f.doctor.updateReferral(f.actionBody(r,{BranchId:'main',Action:'Complete',Reason:'External report received and follow-up planned'}));
 assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('Referrals')[0].Status,'Completed');assert.equal(f.rows('ReferralEvents').length,3);assert.equal(f.rows('ReferralGuards')[0].Open,false);
});
test('cancellation and decline retain signed content and release the open referral guard',async()=>{
 for(const Action of ['Cancel','Decline']){const f=await referralsFixture(),r=await f.sign(),old=f.rows('Referrals')[0];
 await (Action==='Cancel'?f.doctor:f.receiving).updateReferral(f.actionBody(r,{Action,BranchId:Action==='Cancel'?'main':'north',Reason:'Documented decision'}));
 assert.equal(f.rows('Referrals')[0].Summary,old.Summary);assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('ReferralEvents').length,2);await f.sign();assert.equal(f.rows('Referrals').length,2);}
});
test('stale visit and allergy review cannot sign; private draft is never copied',async()=>{
 const f=await referralsFixture(),body=await f.signBody();
 f.store.set(`hospitalWorkspaces/test-hospital/hospitalCareSummaries/${f.PatientId}`,{PatientId:f.PatientId,AllergyStatus:'Known allergies',Allergies:'Test allergy',__id:f.PatientId,__updateTime:'new-care'});
 await assert.rejects(()=>f.doctor.signReferral(body),/Allergy information changed/);
 const b=await f.signBody();b.VisitRevision='stale';await assert.rejects(()=>f.doctor.signReferral(b),/visit changed/);
 f.store.set(`hospitalWorkspaces/test-hospital/hospitalConsultations/${f.VisitId}`,{PrivateText:'DO NOT SHARE'});await f.sign();assert.ok(!JSON.stringify(f.rows('Referrals')).includes('DO NOT SHARE'));
});
test('concurrent duplicate signing has one winner and retains atomic receipts',async()=>{
 const f=await referralsFixture(),body=await f.signBody();const outcomes=await Promise.allSettled([f.doctor.signReferral(body),f.doctor.signReferral({...body,RequestId:crypto.randomUUID()})]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.rows('Referrals').length,1);assert.equal(f.rows('ReferralEvents').length,1);
});
test('lost acknowledgement response replays without another visit',async()=>{
 const f=await referralsFixture(),r=await f.sign(),body=f.actionBody(r),commit=f.db.batchCommitLiteralDocuments;let lose=true;
 f.db.batchCommitLiteralDocuments=async(...args)=>{await commit(...args);if(lose){lose=false;throw Error('lost response');}};
 const service=createHospitalService(env,referralActors.receiving,f.db);await assert.rejects(()=>service.updateReferral(body),/lost response/);assert.equal((await service.updateReferral(body)).replayed,true);assert.equal(f.rows('Visits').length,2);
});
test('register and history require dates, fetch bounded pages, and do no per-patient reads',async()=>{
 const f=await referralsFixture(),r=await f.sign();await assert.rejects(()=>f.doctor.referralRegister(request()),/date|period/i);
 f.reset();const data=await f.doctor.referralRegister(request({DateRange:referralPeriod}));assert.equal(data.referrals.length,1);assert.equal(f.reads.length,0);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);
 f.reset();await f.receiving.referralHistory(f.actionBody(r,{DateRange:referralPeriod}));assert.equal(f.queries[0].limit,31);assert.equal(f.reads.length,1);
 for(const name of ['Referrals','ReferralEvents','ReferralGuards'])assert.ok(HOSPITAL_COLLECTIONS.includes(name));
});
test('read-only subscriptions cannot sign or acknowledge and invalid receiving branches fail',async()=>{
 const f=await referralsFixture(),body=await f.signBody();const ro=createHospitalService(env,{...referralActors.doctor,subscriptionReadOnly:true},f.db);
 await assert.rejects(()=>ro.signReferral(body),e=>e.status===403);
 await assert.rejects(()=>f.doctor.signReferral({...body,Referral:{...body.Referral,TargetBranchId:'missing'}}),/configured receiving branch/);
 await assert.rejects(()=>f.doctor.signReferral({...body,Referral:{...body.Referral,Recipient:'missing'}}),/active Doctor/);
 assert.equal(f.rows('Referrals').length,0);
});
test('concurrent cancellation and acceptance cannot both take effect',async()=>{
 const f=await referralsFixture(),r=await f.sign();const outcomes=await Promise.allSettled([
   f.receiving.updateReferral(f.actionBody(r)),f.doctor.updateReferral(f.actionBody(r,{BranchId:'main',Action:'Cancel',Reason:'Source cancellation'}))]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.rows('ReferralEvents').length,2);
 assert.equal(f.rows('Visits').length,f.rows('Referrals')[0].Status==='Acknowledged'?2:1);
});
test('owner demo marker is explicit and does not change role capabilities',async()=>{
 const f=await referralsFixture(),demo=createHospitalService({...env,HOSPITAL_OWNER_DEMO:'true'},referralActors.admin,f.db);
 const state=await demo.state();assert.equal(state.ownerDemo,true);assert.ok(!state.capabilities.includes('consultations.write'));assert.equal((await f.admin.state()).ownerDemo,false);
});
