import test from 'node:test';
import assert from 'node:assert/strict';
import {theatreFixture,theatreActors,recovery,period} from './helpers/hospital-theatre-fixture.mjs';
import {request,env} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
import {readFileSync} from 'node:fs';
const reset=f=>{f.reads.length=0;f.queries.length=0;f.commits.length=0;};
const row=(f,c)=>f.rows('ProcedureCases').find(r=>r.CaseId===c.CaseId);
const put=(f,kind,key,data)=>f.store.set(`${hospitalCollectionPath(env,kind)}/${key}`,data);
async function completed(){const f=await theatreFixture(),c=await f.book();await f.finish(c);return {f,c};}
function response(f,c,extra={}){return request({PatientId:c.PatientId,CaseId:c.CaseId,Revision:row(f,c).__updateTime,HandoverId:row(f,c).RecoveryHandover?.HandoverId,Decision:'Acknowledged',Note:'Patient and tasks received',ConfirmPatient:true,ConfirmReview:true,...extra});}
function send(f,c,extra={}){return request({PatientId:c.PatientId,CaseId:c.CaseId,Revision:row(f,c).__updateTime,Recipient:'other',Reason:'Receiving duty changed',ConfirmPatient:true,...extra});}
const changes=(before,after)=>[...after].filter(([k,v])=>JSON.stringify(before.get(k))!==JSON.stringify(v)).map(([k])=>k);

test('new recovery requires a distinct active clinical recipient in the branch; no partial completion',async()=>{
 const f=await theatreFixture(),c=await f.book();await f.preop(c);await f.start(c);await f.signOp(c);
 const staff=f.store.get('staffUsers/doctor');
 for(const altered of [{Role:'Hospital Cashier'},{Active:false},{OrganisationEdition:'school'},{BranchIds:['north']}]){
  f.store.set('staffUsers/doctor',{...staff,...altered});const before=new Map(f.store);await assert.rejects(f.complete(c),/active Nurse/);assert.deepEqual(f.store,before);
 }
 f.store.set('staffUsers/doctor',staff);
 for(const Recipient of ['', 'unknown', 'nurse'])await assert.rejects(f.nurse.completeProcedureRecovery(f.caseBody(c,{Note:recovery,Recipient,ConfirmHandover:true})));
 assert.equal(row(f,c).Status,'Recovery');await f.complete(c);
 const r=row(f,c);assert.equal(r.RecoveryHandover.Recipient,'doctor');assert.equal(r.RecoveryHandover.Status,'Awaiting acknowledgement');assert.equal(r.RecoveryPending,true);assert.equal(r.Recovery.Content.ReceivingOfficer,'Dr doctor');
 assert.equal(f.rows('ProcedureEvents').at(-1).Snapshot.Handover.RecoveryVersionId,r.RecoveryId);
});

test('only the named recipient responds; role, module, branch, patient and read-only checks hold',async()=>{
 const {f,c}=await completed();const body=response(f,c);
 for(const name of ['admin','clerk','cashier','nurse','other','director'])await assert.rejects(f[name].respondProcedureHandover(body),{status:403});
 for(const extra of [{allowedSections:['hospitalPatients']},{subscriptionReadOnly:true}])await assert.rejects(createHospitalService(env,{...theatreActors.doctor,...extra},f.db).respondProcedureHandover(body),{status:403});
 await assert.rejects(f.doctor.respondProcedureHandover({...body,BranchId:'north'}),{status:403});
 await assert.rejects(f.doctor.respondProcedureHandover({...body,PatientId:'other-patient'}),{status:404});
 await assert.rejects(f.doctor.respondProcedureHandover({...body,ConfirmReview:false}),/reviewed/);
 await assert.rejects(f.doctor.respondProcedureHandover({...body,ConfirmPatient:false}),/Confirm/);
 await assert.rejects(f.doctor.respondProcedureHandover({...body,Note:''}),/Note/);
 await assert.rejects(f.doctor.respondProcedureHandover({...body,Decision:'Approved'}),/Acknowledge/);
 assert.equal(row(f,c).RecoveryHandover.Status,'Awaiting acknowledgement');
});

test('acknowledgement preserves completed visits, bed, clinical originals and all financial records',async()=>{
 const {f,c}=await completed();await f.clerk.updateVisit(request({VisitId:c.VisitId,Revision:f.rows('Visits')[0].__updateTime,Status:'Completed'}));
 const before=new Map(structuredClone([...f.store])),body=response(f,c);reset(f);
 await f.doctor.respondProcedureHandover(body);
 assert.equal(f.reads.length,3);assert.equal(f.queries.length,0);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,4);
 assert.equal(row(f,c).RecoveryPending,false);assert.equal(row(f,c).RecoveryHandover.Response.RecordedBy,'doctor');
 for(const k of changes(before,f.store))assert.match(k,/hospital(ProcedureCases|ProcedureEvents|Audit|Operations)\//);
 for(const [k,v] of before)if(!k.includes('/hospitalProcedureCases/'))assert.deepEqual(f.store.get(k),v);
 assert.equal(f.rows('Visits')[0].Status,'Completed');
 reset(f);assert.equal((await f.doctor.respondProcedureHandover(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.queries.length+f.commits.length,0);
 reset(f);assert.equal((await f.doctor.respondProcedureHandover(response(f,c))).Unchanged,true);assert.equal(f.commits.length,0);
 await assert.rejects(f.doctor.respondProcedureHandover({...body,Note:'Different text'}),/already used/);
});

test('concurrent responses and lost responses produce one immutable response and audit',async()=>{
 const {f,c}=await completed(),a=response(f,c),b=response(f,c,{Decision:'Clarification requested',Note:'Confirm destination'});
 const attempts=await Promise.allSettled([f.doctor.respondProcedureHandover(a),f.doctor.respondProcedureHandover(b)]);
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.rows('ProcedureEvents').filter(e=>e.Type==='Respond to recovery handover').length,1);
 assert.equal(f.rows('Audit').filter(e=>e.Action==='Respond to recovery handover').length,1);
 const next=await completed(),commit=next.f.db.batchCommitLiteralDocuments;let lose=true;next.f.db.batchCommitLiteralDocuments=async(...args)=>{await commit(...args);if(lose){lose=false;throw Object.assign(Error('lost response'),{status:503});}};
 const actor=createHospitalService(env,theatreActors.doctor,next.f.db),body=response(next.f,next.c);await assert.rejects(actor.respondProcedureHandover(body),/lost response/);reset(next.f);
 assert.equal((await actor.respondProcedureHandover(body)).replayed,true);assert.equal(next.f.commits.length,0);
});

test('clarification remains pending until a corrected version is separately acknowledged',async()=>{
 const {f,c}=await completed(),original=structuredClone(row(f,c).Recovery),body=response(f,c,{Decision:'Clarification requested',Note:'Please confirm observations'});
 await f.doctor.respondProcedureHandover(body);assert.equal(row(f,c).RecoveryPending,true);
 await assert.rejects(f.nurse.sendProcedureHandover(send(f,c,{Recipient:'doctor'})),/Amend the recovery/);
 await assert.rejects(f.doctor.respondProcedureHandover(response(f,c)),/already has a response/);
 const stale=response(f,c);await f.nurse.amendProcedureRecord(f.caseBody(c,{Kind:'Recovery',Note:{...recovery,Observations:'Corrected observations'},Reason:'Respond to clarification'}));
 assert.equal(row(f,c).RecoveryHandover.Status,'Awaiting acknowledgement');assert.equal(row(f,c).RecoveryHandover.Response,undefined);
 await assert.rejects(f.doctor.respondProcedureHandover(stale),{status:409});
 assert.deepEqual(f.rows('ProcedureEvents').find(e=>e.Type==='Complete recovery and handover').Snapshot.Content,original.Content);
 await f.doctor.respondProcedureHandover(response(f,c));
 assert.equal(f.rows('ProcedureEvents').filter(e=>e.Type==='Respond to recovery handover').length,2);
 assert.equal(f.rows('ProcedureEvents').filter(e=>e.Snapshot?.Handover?.Status==='Clarification requested').length,1);
});

test('reassigning a recipient retains earlier acknowledgements and requires a new receipt',async()=>{
 const {f,c}=await completed();await f.doctor.respondProcedureHandover(response(f,c));const original=structuredClone(row(f,c).Recovery);
 await assert.rejects(f.doctor.sendProcedureHandover(send(f,c)),{status:403});
 const body=send(f,c);reset(f);await f.nurse.sendProcedureHandover(body);assert.equal(f.reads.length,3);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,2);assert.equal(f.commits[0].length,4);
 assert.deepEqual(row(f,c).Recovery,original);assert.equal(row(f,c).RecoveryHandover.Recipient,'other');assert.equal(row(f,c).RecoveryPending,true);
 await assert.rejects(f.doctor.respondProcedureHandover(response(f,c)),{status:403});await f.other.respondProcedureHandover(response(f,c));
 reset(f);assert.equal((await f.nurse.sendProcedureHandover(body)).replayed,true);assert.equal(f.commits.length,0);
});

test('legacy completed records can be sent without rewriting their historical recovery note',async()=>{
 const {f,c}=await completed(),legacy={...row(f,c)};for(const k of ['RecoveryHandover','RecoveryRecipient','RecoveryPending','RecoverySentAt'])delete legacy[k];put(f,'ProcedureCases',c.CaseId,legacy);
 const before=structuredClone(legacy.Recovery);await f.director.sendProcedureHandover(send(f,c,{Recipient:'doctor'}));
 assert.deepEqual(row(f,c).Recovery,before);assert.equal(row(f,c).RecoveryHandover.Status,'Awaiting acknowledgement');
 reset(f);assert.equal((await f.director.sendProcedureHandover(send(f,c,{Recipient:'doctor'}))).Unchanged,true);assert.equal(f.commits.length,0);
 await f.doctor.respondProcedureHandover(response(f,c));
});

test('stale versions and concurrent amendments cannot acknowledge unseen recovery content',async()=>{
 const {f,c}=await completed();await assert.rejects(f.doctor.respondProcedureHandover(response(f,c,{HandoverId:'unseen'})),{status:409});
 const respond=response(f,c),amend=f.caseBody(c,{Kind:'Recovery',Note:{...recovery,Handover:'Changed tasks'},Reason:'New information'});
 const r=await Promise.allSettled([f.doctor.respondProcedureHandover(respond),f.nurse.amendProcedureRecord(amend)]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 if(row(f,c).Recovery.Content.Handover==='Changed tasks')assert.equal(row(f,c).RecoveryHandover.Status,'Awaiting acknowledgement');
 const scheduled=await theatreFixture(),sc=await scheduled.book();await assert.rejects(scheduled.nurse.sendProcedureHandover(send(scheduled,sc)),/Complete recovery/);
});

test('inbox is branch/recipient scoped, bounded, paginated and has no per-patient reads',async()=>{
 const {f,c}=await completed(),base=row(f,c);
 for(let n=0;n<65;n++){const CaseId=`case-${String(n).padStart(3,'0')}`;put(f,'ProcedureCases',CaseId,{...base,CaseId,__id:CaseId});}
 for(const [CaseId,extra] of [['wrong-branch',{BranchId:'north'}],['other-recipient',{RecoveryRecipient:'other'}],['acknowledged',{RecoveryPending:false}]])put(f,'ProcedureCases',CaseId,{...base,CaseId,__id:CaseId,...extra});
 reset(f);const one=await f.doctor.procedureHandoverQueue(request());assert.equal(one.cases.length,30);assert.ok(one.next);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.equal(f.reads.length,0);assert.equal(f.commits[0].length,1);
 assert.equal(one.cases[0].Recovery,undefined);
 const two=await f.doctor.procedureHandoverQueue(request({Cursor:one.next}));assert.equal(two.cases.length,30);assert.ok(two.cases.every(x=>!one.cases.some(y=>y.CaseId===x.CaseId)));
 const three=await f.doctor.procedureHandoverQueue(request({Cursor:two.next}));assert.equal(three.cases.length,6);assert.equal(three.next,null);
 await assert.rejects(f.admin.procedureHandoverQueue(request()),{status:403});await assert.rejects(f.doctor.procedureHandoverQueue(request({BranchId:'north'})),{status:403});
 await assert.rejects(f.doctor.theatreHistory(request({PatientId:c.PatientId,CaseId:c.CaseId})),/date/i);
 const history=await f.doctor.theatreHistory(request({PatientId:c.PatientId,CaseId:c.CaseId,DateRange:period}));assert.ok(history.entries.length);
});

test('the response routes and additive queue index are wired to existing preserved collections',()=>{
 const source=readFileSync(new URL('../functions/api/staff-hospital.js',import.meta.url),'utf8');
 for(const action of ['procedureHandoverQueue','sendProcedureHandover','respondProcedureHandover'])assert.ok(source.includes(`'${action}'`));
 const indexes=JSON.parse(readFileSync(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8'));
 assert.ok(indexes.indexes.some(i=>i.collectionGroup==='hospitalProcedureCases'&&i.fields.map(f=>f.fieldPath).join(',')==='BranchId,RecoveryRecipient,RecoveryPending,RecoverySentAt,__name__'));
});
