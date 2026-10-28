import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {appointmentsFixture,appointmentActors,clinic,appointment,appointmentPeriod} from './helpers/hospital-appointments-fixture.mjs';
import {env,actor,request,profile} from './helpers/hospital-fixture.mjs';
import {theatreFixture} from './helpers/hospital-theatre-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath,HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';
const writes=f=>f.commits.reduce((n,rows)=>n+rows.length,0);

test('appointment entry loads no records; all registers require bounded dates',async()=>{
  const f=await appointmentsFixture();f.reset();await f.reception.state();assert.equal(f.reads.length+f.queries.length+writes(f),0);
  for(const action of ['appointmentRegister','appointmentSchedules','appointmentHistory'])await assert.rejects(f.reception[action](request({PatientId:f.PatientId,AppointmentId:'missing-appointment'})));
  await assert.rejects(f.reception.appointmentRegister(request({DateRange:{fromDate:'2026-01-01',toDate:'2026-10-26'}})),/93 days/);
  assert.equal(f.queries.length,0);assert.equal(writes(f),0);
});

test('clinic schedules validate windows, clinician identity and own-doctor permission',async()=>{
  const f=await appointmentsFixture();
  for(const Windows of [[],[{From:'13:00',To:'12:00'}],[{From:'13:00',To:'15:00'},{From:'14:00',To:'16:00'}],[{From:'25:00',To:'26:00'}]])await assert.rejects(f.schedule({Day:'2026-10-27',Windows}));
  await assert.rejects(f.schedule({Clinician:'missing'}),/active Doctor/);
  await assert.rejects(f.doctor.saveAppointmentSchedule(request({Schedule:{...clinic,Clinician:'other'}})),/own clinic/);
  await assert.rejects(f.nurse.saveAppointmentSchedule(request({Schedule:clinic})),/role/);
  await f.doctor.saveAppointmentSchedule(request({Schedule:{...clinic,Day:'2026-10-27'}}));
});

test('unchanged schedule saves have zero writes and no repeated events',async()=>{
  const f=await appointmentsFixture(),row=f.rows('AppointmentSchedules')[0];f.reset();
  assert.equal((await f.admin.saveAppointmentSchedule(request({Schedule:clinic,ScheduleId:row.ScheduleId,Revision:row.__updateTime}))).Unchanged,true);
  assert.equal(writes(f),0);assert.equal(f.queries.length,0);assert.equal(f.reads.length,2);
});

test('booking uses fixed reads, one bounded clinician lookup and one atomic commit',async()=>{
  const f=await appointmentsFixture();f.reset();const r=await f.book();
  assert.equal(f.reads.length,6);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,2);assert.equal(f.commits.length,1);assert.equal(writes(f),7);
  assert.equal(f.rows('Appointments')[0].AppointmentId,r.AppointmentId);assert.equal(f.rows('AppointmentEvents').length,1);
  assert.equal(f.rows('Visits').length,0);assert.equal(f.rows('ChargeEvents').length,0);
});

test('same request replay after its date creates no writes, including after a lost response',async()=>{
  const f=await appointmentsFixture(),body=f.bookBody(),commit=f.db.batchCommitLiteralDocuments;let once=true;
  f.db.batchCommitLiteralDocuments=async(...args)=>{await commit(...args);if(once){once=false;throw Error('Response lost');}};
  const service=createHospitalService(env,appointmentActors.reception,f.db);
  await assert.rejects(service.saveAppointment(body),/Response lost/);f.setTime('2026-10-28T12:00:00.000Z');f.reset();
  assert.equal((await service.saveAppointment(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(writes(f),0);
  await assert.rejects(service.saveAppointment({...body,Booking:{...body.Booking,Reference:'OTHER-REF'}}),/different information/);
});

test('fresh repeat clicks cannot duplicate a booking or consume extra appointment capacity',async()=>{
  const f=await appointmentsFixture();await f.book();f.reset();assert.equal((await f.book()).Unchanged,true);assert.equal(writes(f),0);
  await assert.rejects(f.book({Reference:'APT-002'}),/overlapping/);assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('AppointmentSchedules')[0].Bookings.length,1);
});

test('concurrent competing bookings leave one complete booking and no partial state',async()=>{
  const f=await appointmentsFixture(),r=await Promise.allSettled([f.book(),f.book({Reference:'APT-002'})]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('AppointmentEvents').length,1);
  assert.equal(f.rows('AppointmentSchedules')[0].Bookings.length,1);for(const lock of f.rows('TheatreReservations'))assert.equal(lock.Entries.length,1);
});

test('same request concurrent retries return the same booking',async()=>{
  const f=await appointmentsFixture(),body=f.bookBody(),r=await Promise.all([f.reception.saveAppointment(body),f.reception.saveAppointment(body)]);
  assert.equal(r[0].AppointmentId,r[1].AppointmentId);assert.equal(f.rows('AppointmentEvents').length,1);
});

test('booking validates future times, branch schedule and available windows',async()=>{
  const f=await appointmentsFixture();
  for(const changes of [{StartAt:'2026-10-26T11:00:00.000Z'},{EndAt:'2026-10-26T12:30:00.000Z'},{StartAt:'2026-10-26T18:00:00.000Z',EndAt:'2026-10-26T18:30:00.000Z'},{EndAt:'2026-10-27T13:30:00.000Z'}])await assert.rejects(f.book(changes));
  await assert.rejects(f.reception.saveAppointment({...f.bookBody(),ConfirmPatient:false}),/Confirm/);
  await assert.rejects(f.reception.saveAppointment({...f.bookBody(),BranchId:'north'}),/assigned access/);
  const row=f.rows('AppointmentSchedules')[0];row.BranchId='north';await assert.rejects(f.book(),/this branch/);assert.equal(f.rows('Appointments').length,0);
});

test('rescheduling retains original booking history and releases the previous reservations',async()=>{
  const f=await appointmentsFixture(),r=await f.book(),original=structuredClone(f.rows('AppointmentEvents')[0]);
  const next=await f.schedule({Day:'2026-10-27'});
  await f.reception.saveAppointment({...f.bookBody({StartAt:'2026-10-27T13:00:00.000Z',EndAt:'2026-10-27T13:30:00.000Z'}),...f.body(r),ScheduleId:next.ScheduleId,Reason:'Patient requested another day'});
  assert.deepEqual(f.rows('AppointmentEvents')[0],original);assert.equal(f.rows('AppointmentEvents').length,2);
  assert.equal(f.rows('AppointmentSchedules').find(s=>s.ScheduleId===f.ScheduleId).Bookings.length,0);
  assert.equal(f.rows('TheatreReservations').filter(x=>x.Day==='2026-10-26').flatMap(x=>x.Entries).length,0);
  assert.equal(f.rows('Appointments').length,1);
});

test('schedule reduction races with booking cannot strand an appointment outside availability',async()=>{
  const f=await appointmentsFixture(),schedule=f.rows('AppointmentSchedules')[0];
  const r=await Promise.allSettled([f.book(),f.admin.saveAppointmentSchedule(request({Schedule:{...clinic,Active:false},ScheduleId:schedule.ScheduleId,Revision:schedule.__updateTime}))]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
  if(f.rows('Appointments').length)assert.equal(f.rows('AppointmentSchedules')[0].Active,true);else assert.equal(f.rows('AppointmentSchedules')[0].Active,false);
});

test('booked times cannot be removed or disabled; cancelled bookings release availability',async()=>{
  const f=await appointmentsFixture(),r=await f.book();let row=f.rows('AppointmentSchedules')[0];
  await assert.rejects(f.admin.saveAppointmentSchedule(request({Schedule:{...clinic,Active:false},ScheduleId:row.ScheduleId,Revision:row.__updateTime})),/Reschedule or cancel/);
  const b=f.body(r,{Status:'Cancelled',Reason:'Patient requested cancellation'});await f.reception.closeAppointment(b);f.reset();
  assert.equal((await f.reception.closeAppointment({...b,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(writes(f),0);
  row=f.rows('AppointmentSchedules')[0];await f.admin.saveAppointmentSchedule(request({Schedule:{...clinic,Active:false},ScheduleId:row.ScheduleId,Revision:row.__updateTime}));
  assert.equal(f.rows('Appointments')[0].Status,'Cancelled');assert.equal(f.rows('TheatreReservations').flatMap(r=>r.Entries).length,0);
});

test('non-attendance requires elapsed appointment time and an attributable reason',async()=>{
  const f=await appointmentsFixture(),r=await f.book(),b=f.body(r,{Status:'Not attended',Reason:'Patient did not arrive'});
  await assert.rejects(f.reception.closeAppointment(b),/ended/);f.setTime('2026-10-26T14:00:00.000Z');await f.reception.closeAppointment(b);
  assert.equal(f.rows('Appointments')[0].Status,'Not attended');assert.equal(f.rows('Visits').length,0);
});

test('appointment arrival is same-day, atomic and retry safe, without charges',async()=>{
  const f=await appointmentsFixture(),r=await f.book(),body=f.body(r);f.reset();
  const arrived=await f.reception.checkInAppointment(body);assert.equal(f.reads.length,4);assert.equal(writes(f),6);
  f.reset();assert.equal((await f.reception.checkInAppointment(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(writes(f),0);
  assert.equal((await f.reception.checkInAppointment(f.body(r))).Unchanged,true);
  assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('Visits')[0].AppointmentId,r.AppointmentId);assert.equal(f.rows('OpenVisits')[0].VisitId,arrived.VisitId);
  assert.equal(f.rows('Patients').length,1);assert.equal(f.rows('ChargeEvents').length,0);
});

test('check-in on another day and check-in after cancellation are rejected',async()=>{
  const f=await appointmentsFixture(),r=await f.book();f.setTime('2026-10-27T09:00:00.000Z');await assert.rejects(f.reception.checkInAppointment(f.body(r)),/scheduled WAT date/);
  await f.reception.closeAppointment(f.body(r,{Status:'Cancelled',Reason:'Patient cancelled booking'}));await assert.rejects(f.reception.checkInAppointment(f.body(r)),/scheduled appointment/);
  assert.equal(f.rows('Visits').length,0);
});

test('existing visit is linked only by explicit confirmation; clinical and financial fields survive',async()=>{
  const f=await appointmentsFixture(),r=await f.book(),v=await f.reception.checkIn(request({PatientId:f.PatientId,Department:'Existing department'}));
  const visit=f.rows('Visits')[0];visit.ClinicalState='Consultation signed';visit.PrivateExistingField='Preserved';visit.AdmissionId='admission-123';
  await assert.rejects(f.reception.checkInAppointment(f.body(r)),/explicitly link/);
  const arrived=await f.reception.checkInAppointment(f.body(r,{UseExistingVisit:true,VisitId:v.VisitId,VisitRevision:visit.__updateTime}));
  assert.equal(arrived.VisitId,v.VisitId);assert.equal(f.rows('Visits').length,1);const linked=f.rows('Visits')[0];
  for(const field of ['Department','ClinicalState','PrivateExistingField','AdmissionId'])assert.equal(linked[field],visit[field]);
  const detail=await f.reception.appointmentDetails(f.body(r));assert.equal(detail.visit.PrivateExistingField,undefined);assert.equal(detail.visit.ClinicalState,undefined);
});

test('walk-in and appointment check-in races cannot create two open visits',async()=>{
  const f=await appointmentsFixture(),r=await f.book();const outcomes=await Promise.allSettled([f.reception.checkInAppointment(f.body(r)),f.reception.checkIn(request({PatientId:f.PatientId,Department:'Outpatients'}))]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(f.rows('Visits').length,1);assert.equal(f.rows('OpenVisits').length,1);
});

test('booking retains a verified follow-up visit link and rejects another patient’s visit',async()=>{
  const f=await appointmentsFixture(),v=await f.reception.checkIn(request({PatientId:f.PatientId,Department:'Outpatients'}));
  const r=await f.reception.saveAppointment({...f.bookBody(),FollowUpVisitId:v.VisitId});assert.equal(f.rows('Appointments')[0].FollowUpVisitId,v.VisitId);
  const other=await f.register({Patient:{...profile,FirstName:'Other'}});
  await assert.rejects(f.reception.saveAppointment({...f.bookBody({Reference:'APT-OTHER'}),PatientId:other.PatientId,FollowUpVisitId:v.VisitId}),/previous visit/);
  await assert.rejects(f.reception.saveAppointment({...f.bookBody({StartAt:'2026-10-26T14:00:00.000Z',EndAt:'2026-10-26T14:30:00.000Z'}),...f.body(r),Reason:'Changed slot'}),/original follow-up/);
});

test('roles, removed modules, read-only subscriptions and branch isolation apply server-side',async()=>{
  const f=await appointmentsFixture(),r=await f.book();
  await assert.rejects(f.nurse.saveAppointment(f.bookBody({Reference:'APT-NEW'})),/role/);
  await assert.rejects(f.cashier.appointmentRegister(request({DateRange:appointmentPeriod})),/role/);
  for(const extra of [{allowedSections:[]},{subscriptionReadOnly:true}])await assert.rejects(createHospitalService(env,{...appointmentActors.reception,...extra},f.db).saveAppointment(f.bookBody()),/role|viewing only/);
  const north=createHospitalService(env,{...actor,assignedBranchIds:['north']},f.db);
  await assert.rejects(north.appointmentDetails({...f.body(r),BranchId:'north'}),/selected branch/);
  await assert.rejects(f.reception.appointmentDetails({...f.body(r),PatientId:'another-patient'}),/selected branch/);
});

test('dated appointment pages are bounded, stable at equal times, and avoid per-patient reads',async()=>{
  const f=await appointmentsFixture();
  for(let n=0;n<35;n++){const AppointmentId=`appointment-${String(n).padStart(3,'0')}`;f.store.set(`${hospitalCollectionPath(env,'Appointments')}/${AppointmentId}`,{AppointmentId,__id:AppointmentId,__updateTime:`v-${n}`,BranchId:'main',StartAt:appointment.StartAt,PatientName:'Saved label'});}
  f.reset();const first=await f.reception.appointmentRegister(request({DateRange:appointmentPeriod}));assert.equal(first.appointments.length,30);assert.equal(f.reads.length,0);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.equal(writes(f),1);
  const second=await f.reception.appointmentRegister(request({DateRange:appointmentPeriod,Cursor:first.next}));assert.equal(second.appointments.length,5);assert.equal(new Set([...first.appointments,...second.appointments].map(r=>r.AppointmentId)).size,35);
});

test('booking conflicts span branches without disclosing the other patient or branch',async()=>{
  const f=await appointmentsFixture();await f.book();const northActor={...appointmentActors.admin,assignedBranchIds:['north']},north=createHospitalService(env,northActor,f.db);
  const schedule=await north.saveAppointmentSchedule(request({BranchId:'north',Schedule:clinic}));
  const other=await north.savePatient(request({BranchId:'north',Patient:{...profile,FirstName:'North'}}));
  await assert.rejects(north.saveAppointment({...f.bookBody({Reference:'NORTH-001'}),BranchId:'north',PatientId:other.PatientId,ScheduleId:schedule.ScheduleId}),e=>{assert.match(e.message,/overlapping/);assert.doesNotMatch(e.message,/main|Test Patient|H-/);return true;});
});

test('clinic and theatre use the same conflict guards in both directions',async()=>{
  for(const theatreFirst of [true,false]){
    const f=await theatreFixture(),admin=createHospitalService(env,appointmentActors.admin,f.db),reception=createHospitalService(env,appointmentActors.reception,f.db);
    const s=await admin.saveAppointmentSchedule(request({Schedule:clinic}));
    const book=()=>reception.saveAppointment(request({PatientId:f.scope.PatientId,ScheduleId:s.ScheduleId,ConfirmPatient:true,Booking:appointment}));
    if(theatreFirst){await f.book();await assert.rejects(book(),/overlapping/);}else{await book();await assert.rejects(f.book(),/overlapping/);}
  }
});

test('appointment records, history and resource guards are included in backups and indexes',async()=>{
  const f=await appointmentsFixture(),r=await f.book();await f.reception.checkInAppointment(f.body(r));
  for(const name of ['AppointmentSchedules','AppointmentScheduleEvents','Appointments','AppointmentEvents'])assert.ok(HOSPITAL_COLLECTIONS.includes(name));
  const copy=new Map(JSON.parse(JSON.stringify([...f.store]))),row=copy.get(`${hospitalCollectionPath(env,'Appointments')}/${r.AppointmentId}`);
  assert.equal(copy.get(`${hospitalCollectionPath(env,'Visits')}/${row.VisitId}`).PatientId,row.PatientId);
  const indexes=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8'));
  for(const name of ['AppointmentSchedules','Appointments','AppointmentEvents'])assert.ok(indexes.indexes.some(i=>i.collectionGroup===`hospital${name}`));
});

test('request filters cannot overwrite the appointment access audit identity or outcome',async()=>{
  const f=await appointmentsFixture(),r=await f.book(),DateRange={...appointmentPeriod,Username:'forged',ActorName:'Forged officer',BranchId:'north',Outcome:'Failure',ResultCount:999};
  await f.reception.appointmentRegister(request({DateRange}));await f.reception.appointmentHistory({...f.body(r),DateRange});
  for(const audit of f.rows('Audit').slice(-2)){
    assert.equal(audit.Username,'reception');assert.equal(audit.BranchId,'main');assert.equal(audit.Outcome,'Success');assert.equal(audit.ResultCount,1);
    assert.equal(audit.FromDate,appointmentPeriod.fromDate);
  }
});

test('arrived appointment details follow the saved visit without an unnecessary open-visit lookup',async()=>{
  const f=await appointmentsFixture(),r=await f.book();await f.reception.checkInAppointment(f.body(r));f.reset();
  const details=await f.reception.appointmentDetails(f.body(r));assert.equal(details.visit.VisitId,f.rows('Visits')[0].VisitId);
  assert.equal(f.reads.length,3);assert.equal(f.queries.length,0);assert.ok(!f.reads.some(([path])=>path.endsWith('hospitalOpenVisits')));
});
