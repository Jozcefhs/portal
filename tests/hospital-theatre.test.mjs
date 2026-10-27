import test from 'node:test';
import assert from 'node:assert/strict';
import {theatreFixture,theatreActors,booking,preoperative,operative,recovery,period} from './helpers/hospital-theatre-fixture.mjs';
import {env,request,profile} from './helpers/hospital-fixture.mjs';
import {discharge} from './helpers/hospital-inpatient-fixture.mjs';
import {medicine} from './helpers/hospital-orders-fixture.mjs';
import {mapping} from './helpers/hospital-billing-fixture.mjs';
import {hospitalRoleModules} from '../functions/lib/hospital-catalog.js';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath,HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';
import {bookingFields,bookingDays} from '../functions/lib/hospital-theatre-model.js';
const reset=f=>{f.reads.length=0;f.queries.length=0;f.commits.length=0;};

test('theatre access is clinical, branch/module restricted and idle entry loads no records',async()=>{
  const f=await theatreFixture();reset(f);await f.doctor.state();assert.equal(f.reads.length+f.queries.length+f.commits.length,0);
  for(const s of [f.admin,f.clerk,f.cashier])await assert.rejects(s.theatreVisit(request(f.scope)),{status:403});
  await assert.rejects(f.nurse.saveProcedureBooking(f.bookBody()),{status:403});await assert.rejects(f.doctor.saveTheatreRoom(request({Room:{Code:'A',Name:'A',Active:true}})),{status:403});
  await assert.rejects(f.doctor.theatreVisit(request({...f.scope,BranchId:'north'})),{status:403});
  const denied=createHospitalService(env,{...theatreActors.doctor,allowedSections:['hospitalPatients']},f.db);await assert.rejects(denied.theatreRegister(request({DateRange:period})),{status:403});
});
test('theatre setup preserves versions, suppresses unchanged writes and separates occupied labels from clinical records',async()=>{
  const f=await theatreFixture(),r=f.rows('Theatres')[0];reset(f);
  assert.equal((await f.admin.saveTheatreRoom(request({TheatreId:r.TheatreId,Revision:r.__updateTime,Room:{Code:r.Code,Name:r.Name,Active:true}}))).Unchanged,true);assert.equal(f.commits.length,0);
  await assert.rejects(f.admin.saveTheatreRoom(request({TheatreId:r.TheatreId,Revision:r.__updateTime,Room:{Code:'NEW-CODE',Name:r.Name,Active:true}})),/cannot be changed/);
  const c=await f.book();await f.preop(c);await f.start(c);const rooms=await f.admin.theatreRooms(request());assert.equal(rooms.rooms[0].Occupied,true);assert.equal(rooms.rooms[0].ActiveCaseId,undefined);
  await assert.rejects(f.nurse.prepareTheatre(request({TheatreId:r.TheatreId,Revision:f.rows('Theatres')[0].__updateTime,ConfirmReady:true})),/occupied/);
});
test('booking validates calendar, minute precision, horizon and midnight boundaries',()=>{
  const now='2026-10-26T12:00:00Z';for(const change of [{StartAt:'2026-02-30T12:00:00Z'},{EndAt:'2026-10-26T12:00:00Z'},{StartAt:'2026-10-26T12:00:01Z'},{EndAt:'2026-10-28T12:00:00Z'},{StartAt:'2028-01-01T12:00:00Z',EndAt:'2028-01-01T13:00:00Z'}])assert.throws(()=>bookingFields({...booking,...change},now));
  assert.deepEqual(bookingDays({StartAt:'2026-10-26T22:00:00Z',EndAt:'2026-10-26T23:00:00Z'}),['2026-10-26']);assert.deepEqual(bookingDays({StartAt:'2026-10-26T22:00:00Z',EndAt:'2026-10-27T00:00:00Z'}),['2026-10-26','2026-10-27']);
});
test('one stable procedure reference prevents replay and fresh duplicate bookings',async()=>{
  const f=await theatreFixture(),b=f.bookBody(),r=await f.doctor.saveProcedureBooking(b);reset(f);assert.equal((await f.doctor.saveProcedureBooking(b)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
  await assert.rejects(f.book(),/already exists/);assert.equal(f.rows('ProcedureCases').length,1);assert.equal(f.rows('Visits')[0].PendingProcedureCount,1);
  const current=f.rows('ProcedureCases')[0];reset(f);const no=await f.doctor.saveProcedureBooking({...f.bookBody(),CaseId:r.CaseId,Revision:current.__updateTime});assert.equal(no.Unchanged,true);assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);
});
test('concurrent room, patient and clinician overlaps reject without partial bookings',async()=>{
  const f=await theatreFixture(),scope=await f.newVisit('Second'),one=f.bookBody(),two=f.bookBody({Reference:'OP-2',LeadClinician:'other'},scope);
  const attempts=await Promise.allSettled([f.doctor.saveProcedureBooking(one),f.doctor.saveProcedureBooking(two)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('ProcedureCases').length,1);
  const winner=f.rows('ProcedureCases')[0],otherRoom=await f.room('TH-2');
  await assert.rejects(f.doctor.saveProcedureBooking({...f.bookBody({Reference:'CLASH',LeadClinician:winner.LeadClinician},winner.PatientId===scope.PatientId?f.scope:scope),TheatreId:otherRoom.TheatreId}),/overlapping/);
  await assert.rejects(f.doctor.saveProcedureBooking({...f.bookBody({Reference:'PATIENT',LeadClinician:'other'},{PatientId:winner.PatientId,VisitId:winner.VisitId}),TheatreId:otherRoom.TheatreId}),/overlapping/);
});
test('rescheduling retains events, releases former slots and invalidates old preoperative checks',async()=>{
  const f=await theatreFixture(),c=await f.book();await f.preop(c);const old=structuredClone(f.rows('ProcedureEvents'));
  await f.doctor.saveProcedureBooking({...f.bookBody({StartAt:'2026-10-26T14:00:00Z',EndAt:'2026-10-26T16:00:00Z'}),CaseId:c.CaseId,Revision:f.rows('ProcedureCases')[0].__updateTime,Reason:'Rescheduled by clinical team'});
  assert.equal(f.rows('ProcedureCases')[0].PreoperativeId,'');for(const e of old)assert.deepEqual(f.rows('ProcedureEvents').find(r=>r.EventId===e.EventId),e);
  await f.book({Reference:'NEW'});assert.equal(f.rows('ProcedureCases').length,2);assert.equal(f.rows('Visits')[0].PendingProcedureCount,2);
});
test('cancellation retains original records and releases all reservations exactly once',async()=>{
  const f=await theatreFixture(),c=await f.book(),body=f.caseBody(c,{Reason:'Deferred by clinician'});await f.doctor.cancelProcedure(body);reset(f);assert.equal((await f.doctor.cancelProcedure(body)).replayed,true);assert.equal(f.commits.length,0);
  assert.equal(f.rows('ProcedureCases')[0].Status,'Cancelled');assert.equal(f.rows('Visits')[0].PendingProcedureCount,0);assert.ok(f.rows('TheatreReservations').every(r=>!r.Entries.length));assert.equal(f.rows('ProcedureEvents').length,2);
  await assert.rejects(f.book(),/already exists/);await f.book({Reference:'REBOOK'});
});
test('preoperative checks require confirmation and fresh allergies with unchanged-save suppression',async()=>{
  const f=await theatreFixture(),c=await f.book();await assert.rejects(f.nurse.recordProcedurePreoperative(f.caseBody(c,{Note:preoperative})),/Confirm/);await f.preop(c);reset(f);assert.equal((await f.preop(c)).Unchanged,true);assert.equal(f.commits.length,0);
  const care=f.rows('CareSummaries')[0];f.store.set(`${hospitalCollectionPath(env,'CareSummaries')}/${care.PatientId}`,{...care,AllergyStatus:'Known',Allergies:'Recorded allergy',__updateTime:'new-care'});
  await assert.rejects(f.start(c),/Allergy information changed/);await f.nurse.recordProcedurePreoperative(f.caseBody(c,{Note:preoperative,ConfirmChecks:true,Reason:'Updated allergies reviewed'}));await f.start(c);
});
test('start enforces readiness, time-out, named clinician, visit identity and reserved operating window',async()=>{
  const f=await theatreFixture(),c=await f.book();await assert.rejects(f.start(c),/preoperative/);await f.preop(c);
  await assert.rejects(f.other.startProcedure(f.caseBody(c,{ConfirmTimeOut:true})),{status:403});await assert.rejects(f.doctor.startProcedure(f.caseBody(c)),/time-out/);
  await assert.rejects(f.doctor.startProcedure(f.caseBody(c,{ConfirmTimeOut:true,PatientId:'wrong'})),{status:404});
  const room=f.rows('Theatres')[0];f.store.set(`${hospitalCollectionPath(env,'Theatres')}/${room.TheatreId}`,{...room,Ready:false,__updateTime:'notready'});await assert.rejects(f.start(c),/not available/);
  await f.nurse.prepareTheatre(request({TheatreId:room.TheatreId,Revision:'notready',ConfirmReady:true}));await f.start(c);assert.equal(f.rows('ProcedureCases')[0].Status,'In procedure');await assert.rejects(f.start(c),/preoperative/);
});
test('full surgical pathway retains clinical, financial and stock records and requires room preparation afterwards',async()=>{
  const f=await theatreFixture(),c=await f.book();
  const pharmacist=createHospitalService(env,{...theatreActors.nurse,role:'Pharmacist',allowedSections:hospitalRoleModules('Pharmacist')},f.db);
  await pharmacist.receiveMedicine(request({Stock:{...medicine,Quantity:12,BatchNumber:'THEATRE-BASE',ExpiryDate:'2027-12-31',Supplier:'Synthetic supplier',ReceiptReference:'STOCK-BASE',LineReference:'1',UnitPrice:'20.00'}}));
  await f.cashier.createServiceCharge(request({...f.scope,Category:'Consultation',ServiceCode:'EXISTING',Description:'Previous visit charge',Reference:'PREVIOUS',Quantity:1,UnitPrice:'100.00',ConfirmPatient:true}));
  const stock=structuredClone(f.rows('MedicineBatches')),charges=structuredClone(f.rows('ChargeEvents')),stockHistory=structuredClone(f.rows('StockMovements'));const admission=await f.clerk.admitHospitalPatient(f.admitBody(f.scope,f.initialBed));await f.finish(c);
  const row=f.rows('ProcedureCases')[0];assert.equal(row.AdmissionId,admission.AdmissionId);assert.equal(row.Status,'Completed');assert.equal(f.rows('Visits')[0].PendingProcedureCount,0);assert.equal(f.rows('Visits')[0].ActiveProcedureCaseId,'');assert.equal(f.rows('Theatres')[0].Ready,false);
  assert.equal(f.rows('ProcedureEvents').length,5);assert.ok(f.rows('TheatreReservations').every(r=>r.Entries.length===0));assert.ok(f.rows('TheatreActiveResources').every(r=>!r.CaseId));assert.deepEqual(f.rows('MedicineBatches'),stock);assert.deepEqual(f.rows('ChargeEvents'),charges);assert.deepEqual(f.rows('StockMovements'),stockHistory);
});
test('operative and recovery notes cannot skip states or be signed by another clinician',async()=>{
  const f=await theatreFixture(),c=await f.book();await assert.rejects(f.signOp(c),/active procedure/);await assert.rejects(f.complete(c),/operative record/);await f.preop(c);await f.start(c);
  await assert.rejects(f.doctor.cancelProcedure(f.caseBody(c,{Reason:'Cancel started'})),/Only an unstarted/);await assert.rejects(f.nurse.signProcedureOperative(f.caseBody(c,{Note:operative,ConfirmClinicalReview:true})),{status:403});await assert.rejects(f.other.signProcedureOperative(f.caseBody(c,{Note:operative,ConfirmClinicalReview:true})),{status:403});
  await f.signOp(c);await assert.rejects(f.nurse.completeProcedureRecovery(f.caseBody(c,{Note:recovery})),/Confirm/);await f.complete(c);
});
test('completed notes allow attributed amendments without rewriting signed originals or recharging',async()=>{
  const f=await theatreFixture(),c=await f.book();await f.finish(c);const original=structuredClone(f.rows('ProcedureEvents').find(r=>r.Type==='Sign operative record'));
  const b=()=>f.caseBody(c,{Kind:'Operative',Note:{...operative,Findings:'Corrected transcription'},Reason:'Correction'});
  await assert.rejects(f.other.amendProcedureRecord(b()),{status:403});await f.doctor.amendProcedureRecord(b());assert.deepEqual(f.rows('ProcedureEvents').find(r=>r.EventId===original.EventId),original);
  reset(f);assert.equal((await f.doctor.amendProcedureRecord(b())).Unchanged,true);assert.equal(f.commits.length,0);assert.equal(f.rows('ProcedureCases')[0].Status,'Completed');assert.equal(f.rows('ChargeEvents').length,0);
});
test('unfinished cases prevent outpatient closure and inpatient discharge; clinical changes invalidate discharge review',async()=>{
  const f=await theatreFixture(),c=await f.book();await assert.rejects(f.clerk.updateVisit(request({VisitId:f.scope.VisitId,Revision:f.rows('Visits')[0].__updateTime,Status:'Completed'})),/procedure/);
  const a=await f.clerk.admitHospitalPatient(f.admitBody(f.scope,f.initialBed));await f.sign(a);await assert.rejects(f.clerk.dischargeHospitalPatient(f.body(a)),/procedures/);
  await f.doctor.cancelProcedure(f.caseBody(c,{Reason:'Deferred'}));assert.equal(f.rows('Visits')[0].DischargeApprovalId,'');await f.doctor.signHospitalDischarge(f.body(a,{Summary:discharge,ConfirmClinicalReview:true,Reason:'Reviewed after procedure cancellation'}));await f.clerk.dischargeHospitalPatient(f.body(a));assert.equal(f.rows('Admissions')[0].Status,'Discharged');
});
test('procedure billing uses case and service identity; retries do not create duplicate charges',async()=>{
  const f=await theatreFixture(),c=await f.book(),body=()=>request({...f.scope,Category:'Procedure',ServiceCode:'SURGERY',Description:'Procedure service',Reference:'CHARGE-1',ProcedureReference:'OP-001',Quantity:1,UnitPrice:'1000.00',ConfirmPatient:true});
  await assert.rejects(f.cashier.createServiceCharge(body()),/completed procedure/);await f.finish(c);const original=structuredClone(f.rows('ProcedureCases')[0]);const r=await f.cashier.createServiceCharge(body());
  reset(f);assert.equal((await f.cashier.createServiceCharge(body())).Unchanged,true);assert.equal(f.commits.length,0);assert.equal(f.rows('ChargeEvents').length,1);assert.equal(f.rows('ChargeEvents')[0].Service.ProcedureCaseId,c.CaseId);assert.deepEqual(f.rows('ProcedureCases')[0],original);
  await assert.rejects(f.cashier.createServiceCharge({...body(),Reference:'FRESH-REF'}),/already charged/);assert.equal(f.rows('ChargeEvents')[0].ChargeId,r.ChargeId);
  for(const [key,Code] of Object.entries(mapping))f.store.set(`chartOfAccounts/${Code}`,{Code,Name:key,Type:key==='Revenue'?'Revenue':'Asset',Active:'YES',__id:Code,__updateTime:`account-${Code}`});
  await f.admin.saveBillingSettings(request({Settings:mapping}));const bill=request({...f.scope,ChargeIds:[r.ChargeId],ConfirmPatient:true});await f.cashier.issueHospitalInvoice(bill);assert.equal(f.rows('Invoices').length,1);
  const originalInvoice=structuredClone(f.rows('Invoices')[0]);assert.equal((await f.cashier.createServiceCharge(body())).Unchanged,true);await assert.rejects(f.cashier.issueHospitalInvoice({...bill,RequestId:crypto.randomUUID()}));assert.deepEqual(f.rows('Invoices')[0],originalInvoice);assert.equal(f.rows('Invoices').length,1);
});
test('dated theatre registers are bounded, preserve equal-time pages and do not read patient rows',async()=>{
  const f=await theatreFixture(),c=await f.book();reset(f);await assert.rejects(f.doctor.theatreRegister(request()),/date|range/i);assert.equal(f.queries.length,0);
  const base=f.rows('ProcedureCases')[0],path=hospitalCollectionPath(env,'ProcedureCases');for(let i=0;i<65;i++)f.store.set(`${path}/procedure-case-${i}`,{...base,CaseId:`procedure-case-${i}`,__id:`procedure-case-${i}`});
  reset(f);const all=[];let Cursor;do{const r=await f.doctor.theatreRegister(request({DateRange:period,...(Cursor?{Cursor}:{})}));all.push(...r.cases.map(c=>c.CaseId));Cursor=r.next;}while(Cursor);
  assert.equal(all.length,66);assert.equal(new Set(all).size,66);assert.equal(f.reads.length,0);assert.ok(f.queries.every(q=>q.limit===31&&q.filters.some(p=>p.field==='BranchId')));
  for(const name of ['Theatres','TheatreVersions','TheatreReservations','TheatreActiveResources','ProcedureCases','ProcedureEvents'])assert.ok(HOSPITAL_COLLECTIONS.includes(name));
  assert.equal(JSON.parse(JSON.stringify(f.rows('ProcedureEvents')))[0].Snapshot.VisitId,f.scope.VisitId);
});
test('completed write replay after lost response does one read and no extra writes',async()=>{
  const f=await theatreFixture();let failOnce=true;const svc=createHospitalService(env,theatreActors.doctor,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await f.db.batchCommitLiteralDocuments(...args);if(failOnce){failOnce=false;throw Object.assign(Error('lost response'),{status:503});}}});
  const b=f.bookBody();await assert.rejects(svc.saveProcedureBooking(b));reset(f);assert.equal((await svc.saveProcedureBooking(b)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal(f.rows('ProcedureCases').length,1);
});
test('read-only subscriptions cannot mutate theatre bookings or clinical records',async()=>{
  const f=await theatreFixture(),svc=createHospitalService(env,{...theatreActors.doctor,subscriptionReadOnly:true},f.db);await assert.rejects(svc.saveProcedureBooking(f.bookBody()),{status:403});assert.equal(f.rows('ProcedureCases').length,0);
});

test('active clinician lock prevents a second case during an overrun even in another theatre',async()=>{
  const f=await theatreFixture(),c=await f.book();await f.preop(c);await f.start(c);
  const otherScope=await f.newVisit('Next patient'),room=await f.room('TH-2');
  const next=await f.doctor.saveProcedureBooking({...f.bookBody({Reference:'LATER',StartAt:'2026-10-26T14:00:00Z',EndAt:'2026-10-26T16:00:00Z'},otherScope),TheatreId:room.TheatreId});await f.preop(next);
  const later=createHospitalService(env,theatreActors.doctor,{...f.db,now:()=>new Date('2026-10-26T14:30:00Z')});
  await assert.rejects(later.startProcedure(f.caseBody(next,{ConfirmTimeOut:true})),/another active procedure/);assert.equal(f.rows('ProcedureCases').find(r=>r.CaseId===next.CaseId).Status,'Scheduled');
});
test('start versus cancellation and recovery retries commit only one transition',async()=>{
  const f=await theatreFixture(),c=await f.book();await f.preop(c);
  const result=await Promise.allSettled([f.start(c),f.doctor.cancelProcedure(f.caseBody(c,{Reason:'Competing cancellation'}))]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const row=f.rows('ProcedureCases')[0];assert.ok(['In procedure','Cancelled'].includes(row.Status));assert.equal(f.rows('ProcedureEvents').length,3);
  if(row.Status==='In procedure'){
    await f.signOp(c);const b=f.caseBody(c,{Note:recovery,ConfirmHandover:true});await f.nurse.completeProcedureRecovery(b);reset(f);assert.equal((await f.nurse.completeProcedureRecovery(b)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
  }
});
test('closed visits retain amendments without reopening the visit or adding charges',async()=>{
  const f=await theatreFixture(),c=await f.book();await f.finish(c);await f.clerk.updateVisit(request({VisitId:f.scope.VisitId,Revision:f.rows('Visits')[0].__updateTime,Status:'Completed'}));
  await f.doctor.amendProcedureRecord(f.caseBody(c,{Kind:'Operative',Note:{...operative,Findings:'Late documented correction'},Reason:'Transcription correction'}));assert.equal(f.rows('Visits')[0].Status,'Completed');assert.equal(f.rows('ChargeEvents').length,0);assert.equal(f.rows('ProcedureEvents').filter(e=>e.Type==='Sign operative record').length,1);
});
test('theatre mutation budgets use exact resource locks without scanning history',async()=>{
  const f=await theatreFixture();reset(f);const c=await f.book();assert.equal(f.reads.length,9);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,2);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,9);
  reset(f);await f.preop(c);assert.equal(f.reads.length,5);assert.equal(f.queries.length,0);assert.equal(f.commits[0].length,6);
  reset(f);await f.start(c);assert.equal(f.reads.length,8);assert.equal(f.queries.length,0);assert.equal(f.commits[0].length,9);
  await f.signOp(c);reset(f);await f.complete(c);assert.equal(f.reads.length,11);assert.equal(f.queries.length,0);assert.equal(f.commits[0].length,11);
});

test('clinician scheduling conflicts are prevented across branches without exposing the other branch patient',async()=>{
  const f=await theatreFixture();await f.book();
  const multi=name=>createHospitalService(env,{...theatreActors[name],assignedBranchIds:['main','north']},f.db),admin=multi('admin'),clerk=multi('clerk'),doctor=multi('doctor');
  const r=await admin.saveTheatreRoom(request({BranchId:'north',Room:{Code:'NORTH',Name:'North theatre',Active:true}}));
  const p=await clerk.savePatient(request({BranchId:'north',Patient:{...profile,LastName:'North patient'}})),v=await clerk.checkIn(request({BranchId:'north',PatientId:p.PatientId,Department:'Procedures'}));
  const b=request({BranchId:'north',TheatreId:r.TheatreId,PatientId:p.PatientId,VisitId:v.VisitId,VisitRevision:f.rows('Visits').find(row=>row.VisitId===v.VisitId).__updateTime,Booking:booking,ConfirmPatient:true});
  await assert.rejects(doctor.saveProcedureBooking(b),/overlapping booking/);assert.equal(f.rows('ProcedureCases').length,1);
  const north=await doctor.theatreRegister(request({BranchId:'north',DateRange:period}));assert.equal(north.cases.length,0);
});
test('concurrent visit closure and booking never leave a scheduled case on a closed visit',async()=>{
  const f=await theatreFixture(),book=f.bookBody(),close=request({VisitId:f.scope.VisitId,Revision:book.VisitRevision,Status:'Completed'});
  const r=await Promise.allSettled([f.doctor.saveProcedureBooking(book),f.clerk.updateVisit(close)]);assert.equal(r.filter(e=>e.status==='fulfilled').length,1);
  if(f.rows('ProcedureCases').length)assert.equal(f.rows('Visits')[0].Status,'Waiting');else assert.equal(f.rows('Visits')[0].Status,'Completed');
});
