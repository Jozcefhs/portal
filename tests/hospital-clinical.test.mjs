import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,actor,env,request} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCapabilities} from '../functions/lib/hospital-model.js';
import {triageFields} from '../functions/lib/hospital-clinical-model.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
import {readFile} from 'node:fs/promises';

const doctor={...actor,username:'doctor',displayName:'Doctor Example',role:'Doctor',allowedSections:['hospitalPatients','hospitalReception','hospitalTriage','hospitalConsultations']};
const triage={Complaint:'Patient reported complaint',NursingNotes:'Staff-recorded observation',Urgency:'Urgent',AllergyStatus:'Known allergies',
  Allergies:'Recorded medicine allergy',Vitals:{TemperatureC:'37.2',PulseBpm:'84',SystolicMmHg:'120',DiastolicMmHg:'80',SpO2Percent:'98'}};
const notes={History:'Patient history',Assessment:'Staff assessment',Plan:'Staff treatment plan'};
async function setup(){
  const f=fixture(),{PatientId}=await f.register(),{VisitId}=await f.service.checkIn(request({PatientId,Department:'Outpatients'}));
  const service=createHospitalService(env,doctor,f.db),scope={PatientId,VisitId};
  const load=()=>service.clinicalContext(request(scope));
  const body=async extra=>{const c=await load();return request({...scope,VisitRevision:c.visit.Revision,EncounterRevision:c.encounter?.Revision||'',CareRevision:c.care.Revision||'',DraftRevision:c.draft?.Revision||'',...extra});};
  return {...f,service,reception:f.service,scope,load,body};
}
test('clinical access requires a clinical role and enabled module; finance and administrators cannot read notes',async()=>{
  const f=await setup();
  for(const role of ['Registration Officer','Hospital Administrator','Hospital Cashier','Accounts Officer','Super Admin']){
    const user={...doctor,role};assert.ok(!hospitalCapabilities(user).includes('clinical.read'));
    await assert.rejects(createHospitalService(env,user,f.db).clinicalContext(request(f.scope)),{status:403});
  }
  const nurse=createHospitalService(env,{...doctor,role:'Nurse',username:'nurse'},f.db);
  await nurse.recordTriage(await f.body({Triage:triage}));
  await assert.rejects(nurse.saveConsultation(await f.body({Notes:notes})),{status:403});
  await assert.rejects(createHospitalService(env,{...doctor,allowedSections:['hospitalPatients','hospitalReception']},f.db).clinicalContext(request(f.scope)),{status:403});
});
test('triage keeps identity, units, explicit allergy uncertainty, signed originals and one retry-safe audit',async()=>{
  const f=await setup(),body=await f.body({Triage:triage}),first=await f.service.recordTriage(body);
  const counts=[f.rows('ClinicalEntries').length,f.rows('Audit').length,f.commits.length];
  assert.equal((await f.service.recordTriage(body)).replayed,true);assert.deepEqual([f.rows('ClinicalEntries').length,f.rows('Audit').length,f.commits.length],counts);
  const entry=f.rows('ClinicalEntries')[0];assert.equal(entry.PatientId,f.scope.PatientId);assert.equal(entry.VisitId,f.scope.VisitId);
  assert.equal(entry.Content.Vitals.TemperatureC,37.2);assert.equal(entry.Content.Vitals.PulseBpm,84);assert.equal(entry.Status,'Signed');
  const original=structuredClone(entry);
  await f.service.recordTriage(await f.body({Triage:{...triage,AllergyStatus:'Unknown',Allergies:'',Vitals:{PulseBpm:90}}}));
  assert.deepEqual(f.rows('ClinicalEntries').find(row=>row.EntryId===first.EntryId),original);
  assert.equal((await f.load()).care.AllergyStatus,'Unknown');assert.equal(f.rows('Patients').length,1);
  const audit=JSON.stringify(f.rows('Audit'));assert.ok(!audit.includes(triage.Complaint));assert.ok(!audit.includes(triage.Allergies));
});
test('missing observations stay missing; malformed measurements and allergy contradictions are rejected',()=>{
  const now='2026-10-26T12:00:00Z';
  assert.deepEqual(triageFields({...triage,Vitals:{}},now).Vitals,{});
  assert.deepEqual(triageFields({...triage,Vitals:{PulseBpm:'  '}},now).Vitals,{});
  for(const change of [{AllergyStatus:'Known allergies',Allergies:''},{AllergyStatus:'No known allergies'},
    {Vitals:{SpO2Percent:101}},{Vitals:{PulseBpm:'NaN'}},{Vitals:{PulseBpm:false}},{Vitals:{SystolicMmHg:120}},
    {ObservedAt:'2026-10-27T12:00:00Z'},{ObservedAt:'2026-02-30T12:00:00Z'},{ObservedAt:'2026-10-26T12:00:00'},{Urgency:'Automatically diagnosed'}])assert.throws(()=>triageFields({...triage,...change},now));
});
test('consultation drafts belong to their author and signing preserves a snapshot with current allergies',async()=>{
  const f=await setup();await f.service.recordTriage(await f.body({Triage:triage}));
  await f.service.saveConsultation(await f.body({Notes:notes}));
  const colleague=createHospitalService(env,{...doctor,username:'other-doctor'},f.db),view=await colleague.clinicalContext(request(f.scope));
  assert.equal(view.draft,null);assert.equal(view.canEditDraft,false);assert.equal(view.draftOwner,'Doctor Example');
  await assert.rejects(colleague.saveConsultation(await f.body({Notes:{History:'Change'}})),{status:403});
  await assert.rejects(f.service.signConsultation(await f.body()),/Confirm the patient/);
  const body=await f.body({ConfirmPatient:true}),signed=await f.service.signConsultation(body);
  assert.equal((await f.service.signConsultation(body)).replayed,true);
  const entry=f.rows('ClinicalEntries').find(row=>row.EntryId===signed.EntryId);
  assert.deepEqual(entry.Content,{History:notes.History,Examination:'',Assessment:notes.Assessment,Plan:notes.Plan,FollowUp:'',Referral:''});
  assert.equal(entry.AllergySnapshot.Details,triage.Allergies);assert.equal(entry.AuthorUsername,'doctor');
  await assert.rejects(f.service.saveConsultation(await f.body({Notes:{History:'Overwrite'}})),/signed/);
  assert.equal((await f.load()).latestConsultation.EntryId,signed.EntryId);
});
test('stale allergy or visit versions cannot be signed and incomplete drafts remain drafts',async()=>{
  const f=await setup();await f.service.saveConsultation(await f.body({Notes:{History:'Partial'}}));
  await assert.rejects(f.service.signConsultation(await f.body({ConfirmPatient:true})),/history, assessment and treatment plan/);
  await f.service.saveConsultation(await f.body({Notes:notes}));const stale=await f.body({ConfirmPatient:true});
  await f.service.recordTriage(await f.body({Triage:triage}));
  await assert.rejects(f.service.signConsultation(stale),{status:409});assert.equal(f.rows('Consultations')[0].Status,'Draft');
});
test('amendments retain signed originals after the visit closes; foreign authors and foreign entries are refused',async()=>{
  const f=await setup();await f.service.saveConsultation(await f.body({Notes:notes}));const signed=await f.service.signConsultation(await f.body({ConfirmPatient:true}));
  const original=structuredClone(f.rows('ClinicalEntries')[0]),visit=f.rows('Visits')[0];
  await f.reception.updateVisit(request({VisitId:visit.VisitId,Revision:visit.__updateTime,Status:'Completed'}));
  await assert.rejects(f.service.recordTriage(await f.body({Triage:triage})),/closed/);
  const body=await f.body({EntryId:signed.EntryId,Amendment:{Reason:'Clarification of original note',Text:'Additional staff-recorded detail'}});
  await assert.rejects(createHospitalService(env,{...doctor,username:'other'},f.db).amendClinicalEntry(body),{status:403});
  const amended=await f.service.amendClinicalEntry(body);assert.equal((await f.service.amendClinicalEntry(body)).replayed,true);
  assert.deepEqual(f.rows('ClinicalEntries').find(row=>row.EntryId===signed.EntryId),original);
  const c=await f.load();assert.equal(c.visit.Status,'Completed');assert.equal(c.latestAmendment.EntryId,amended.EntryId);assert.equal(c.encounter.AmendmentCount,1);
  await assert.rejects(f.service.amendClinicalEntry(await f.body({EntryId:amended.EntryId,Amendment:body.Amendment})),{status:404});
});
test('branch and patient identity checks precede clinical reads; history is explicit, dated and bounded',async()=>{
  const f=await setup();f.queries.length=0;await f.load();assert.equal(f.queries.length,0);
  await assert.rejects(f.service.clinicalContext(request({...f.scope,PatientId:'other-patient'})),{status:409});
  await assert.rejects(f.service.clinicalContext(request({...f.scope,BranchId:'north'})),{status:403});
  await assert.rejects(f.service.clinicalHistory(request(f.scope)),/Choose valid/);assert.equal(f.queries.length,0);
  await f.service.recordTriage(await f.body({Triage:triage}));
  const result=await f.service.clinicalHistory(request({...f.scope,DateRange:{fromDate:'2026-10-26',toDate:'2026-10-26'}}));
  assert.equal(result.entries.length,1);const query=f.queries.at(-1);assert.equal(query.limit,31);
  assert.deepEqual(query.filters.map(row=>[row.field,row.value]),[['BranchId','main'],['VisitId',f.scope.VisitId],['CreatedAt','2026-10-25T23:00:00.000Z'],['CreatedAt','2026-10-26T23:00:00.000Z']]);
  await assert.rejects(createHospitalService({...env,DYNAMAX_WORKSPACE_ID:'another-hospital'},doctor,f.db).clinicalContext(request(f.scope)),{status:404});
});
test('simultaneous triage edits and lost responses preserve one committed entry',async()=>{
  const f=await setup(),one=await f.body({Triage:triage}),two={...one,RequestId:crypto.randomUUID()};
  const outcomes=await Promise.allSettled([f.service.recordTriage(one),f.service.recordTriage(two)]);
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.rows('ClinicalEntries').length,1);
  const body=await f.body({Notes:notes}),original=f.db.batchCommitLiteralDocuments;let lose=true;
  const service=createHospitalService(env,doctor,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await original(...args);if(lose){lose=false;throw new Error('Lost response');}}});
  await assert.rejects(service.saveConsultation(body),/Lost response/);const count=f.commits.length;
  assert.equal((await service.saveConsultation(body)).replayed,true);assert.equal(f.commits.length,count);
});
test('reception cannot close an active clinical draft; read-only subscriptions cannot write clinical data',async()=>{
  const f=await setup();await f.service.saveConsultation(await f.body({Notes:notes}));const visit=f.rows('Visits')[0];
  await assert.rejects(f.reception.updateVisit(request({VisitId:visit.VisitId,Revision:visit.__updateTime,Status:'Completed'})),/Clinical work is still open/);
  const readOnly=createHospitalService(env,{...doctor,subscriptionReadOnly:true},f.db);
  await assert.rejects(readOnly.recordTriage(await f.body({Triage:triage})),{status:403});
  assert.equal((await readOnly.clinicalContext(request(f.scope))).draft.Status,'Draft');
  assert.ok(f.store.has(`${hospitalCollectionPath(env,'Consultations')}/${f.scope.VisitId}`));
});

test('clinical history pagination preserves equal timestamps, boundaries and the deployed query index',async()=>{
  const f=await setup();
  for(let i=0;i<34;i++)await f.service.recordTriage(await f.body({Triage:{...triage,NursingNotes:`Observation ${i}`}}));
  const query={...f.scope,DateRange:{fromDate:'2026-10-26',toDate:'2026-10-26'}};
  const first=await f.service.clinicalHistory(request(query));
  const second=await f.service.clinicalHistory(request({...query,Cursor:first.next}));
  assert.equal(first.entries.length,30);assert.equal(second.entries.length,4);assert.equal(second.next,null);
  assert.equal(new Set([...first.entries,...second.entries].map(row=>row.EntryId)).size,34);
  const previous=await f.service.clinicalHistory(request({...query,DateRange:{fromDate:'2026-10-25',toDate:'2026-10-25'}}));
  assert.deepEqual(previous.entries,[]);
  const config=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8'));
  assert.ok(config.indexes.some(row=>row.collectionGroup==='hospitalClinicalEntries'&&row.queryScope==='COLLECTION'
    &&JSON.stringify(row.fields)===JSON.stringify([{fieldPath:'BranchId',order:'ASCENDING'},{fieldPath:'VisitId',order:'ASCENDING'},{fieldPath:'CreatedAt',order:'ASCENDING'}])));
});

test('clinical backup round-trip retains signed originals, amendments, author and allergy snapshots',async()=>{
  const f=await setup();await f.service.recordTriage(await f.body({Triage:triage}));
  await f.service.saveConsultation(await f.body({Notes:notes}));
  const signed=await f.service.signConsultation(await f.body({ConfirmPatient:true}));
  const director=createHospitalService(env,{...doctor,username:'medical-director',displayName:'Medical Director Example',role:'Medical Director'},f.db);
  const amended=await director.amendClinicalEntry(await f.body({EntryId:signed.EntryId,Amendment:{Reason:'Documented clarification',Text:'Additional staff note'}}));
  const restored=new Map(JSON.parse(JSON.stringify([...f.store]))),path=name=>hospitalCollectionPath(env,name);
  const encounter=restored.get(`${path('Encounters')}/${f.scope.VisitId}`);
  const original=restored.get(`${path('ClinicalEntries')}/${encounter.LatestConsultationId}`);
  const amendment=restored.get(`${path('ClinicalEntries')}/${encounter.LatestAmendmentId}`);
  assert.equal(original.EntryId,signed.EntryId);assert.deepEqual(original.Content, f.rows('Consultations')[0].Notes);
  assert.equal(original.AllergySnapshot.Details,triage.Allergies);assert.equal(original.AuthorUsername,'doctor');
  assert.equal(amendment.TargetEntryId,signed.EntryId);assert.equal(amendment.EntryId,amended.EntryId);assert.equal(amendment.AuthorUsername,'medical-director');
  assert.equal(restored.get(`${path('CareSummaries')}/${f.scope.PatientId}`).AllergyStatus,'Known allergies');
  assert.equal(restored.get(`${path('Patients')}/${f.scope.PatientId}`).PatientId,original.PatientId);
});
