import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {appointmentsFixture,appointmentActors,clinic} from './helpers/hospital-appointments-fixture.mjs';
import {env,request} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalPatientBookingAction} from '../functions/lib/hospital-patient-booking.js';
import {onRequestPost} from '../functions/api/hospital-patient-booking.js';
import {HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';
import {digest} from '../functions/lib/hospital-model.js';
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const clean=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!k.startsWith('__')));
async function fixture(){
 const f=await appointmentsFixture();f.db.staffAccessFor=async()=>({edition:'hospital',subscriptionActive:true,allowedSections:['hospitalReception']});
 const s=f.rows('AppointmentSchedules')[0];await f.admin.saveAppointmentSchedule(request({ScheduleId:s.ScheduleId,Revision:s.__updateTime,Schedule:{...clinic,SelfBookingEnabled:true,SlotMinutes:30}}));
 f.token=token();f.issue=(extra={})=>f.reception.issuePatientBookingLink(request({PatientId:f.PatientId,AccessToken:f.token,ConfirmPatient:true,...extra}));await f.issue();
 f.call=(action,extra={},overrides={})=>hospitalPatientBookingAction(env,f.token,{action,...extra},{...f.db,...overrides});
 f.bookInput=()=>({ScheduleId:f.ScheduleId,StartAt:'2026-10-26T13:00:00.000Z',ConfirmBooking:true,RequestId:crypto.randomUUID()});
 f.selfBook=(extra={})=>f.call('book',{...f.bookInput(),...extra});f.reset();return f;
}
test('personal link context has only patient identity and its branch, with no writes or scans',async()=>{
 const f=await fixture(),r=await f.call('context');assert.equal(r.branch.Name,'Main Hospital');assert.deepEqual(Object.keys(r.patient).sort(),['DisplayName','HospitalNumber']);assert.equal(r.appointment,null);assert.equal(f.queries.length,0);assert.equal(f.reads.length,3);assert.equal(f.commits.length,0);
});
test('link requires verified identity and appointment write permission; branch and read-only restrictions apply',async()=>{
 const f=await fixture();await assert.rejects(f.issue({ConfirmPatient:false}),/verified/);await assert.rejects(f.issue({BranchId:'north'}),/branch/);
 for(const role of ['nurse','cashier'])await assert.rejects(f[role].issuePatientBookingLink(request({PatientId:f.PatientId,AccessToken:token(),ConfirmPatient:true})),/role/);
 const s=createHospitalService(env,{...appointmentActors.reception,subscriptionReadOnly:true},f.db);await assert.rejects(s.issuePatientBookingLink(request({PatientId:f.PatientId,AccessToken:token(),ConfirmPatient:true})),/viewing/);assert.equal(f.commits.length,0);
});
test('tokens are hashed, issue retries write nothing, and no patient fields change',async()=>{
 const f=await fixture(),before=clean(f.rows('Patients')[0]);const b=request({PatientId:f.PatientId,AccessToken:token(),ConfirmPatient:true});await f.reception.issuePatientBookingLink(b);f.reset();await f.reception.issuePatientBookingLink(b);assert.equal(f.commits.length,0);assert.deepEqual(clean(f.rows('Patients')[0]),before);assert.ok(!JSON.stringify([...f.store.values()]).includes(b.AccessToken));
});
test('replacement and revocation stop old links without deleting bookings',async()=>{
 const f=await fixture();await f.selfBook();const old=f.token;f.token=token();await f.issue();await assert.rejects(hospitalPatientBookingAction(env,old,{action:'context'},f.db),/no longer/);
 assert.equal((await f.call('context')).appointment.Status,'Scheduled');await f.reception.revokePatientBookingLink(request({PatientId:f.PatientId}));await assert.rejects(f.call('context'),/no longer/);assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('PatientBookingLinks').length,2);f.reset();assert.equal((await f.reception.revokePatientBookingLink(request({PatientId:f.PatientId}))).Unchanged,true);assert.equal(f.commits.length,0);
});
test('invalid, expired and disabled patient links disclose no records',async()=>{
 const f=await fixture();await assert.rejects(hospitalPatientBookingAction(env,'bad',{action:'context'},f.db),/invalid/);f.rows('Patients')[0].Status='Inactive';await assert.rejects(f.call('context'),/no longer/);f.rows('Patients')[0].Status='Active';f.setTime('2026-11-03T12:00:00Z');await assert.rejects(f.call('context'),/no longer/);assert.equal(f.commits.length,0);
});
test('patient and branch scope cannot be overridden, including read actions',async()=>{
 const f=await fixture();for(const key of ['PatientId','BranchId','AppointmentId','Reference','EndAt','FollowUpVisitId','WaitlistId'])await assert.rejects(f.call('context',{[key]:'unrelated-record'}),/belonging/);f.rows('Patients')[0].AccessBranchIds=['north'];await assert.rejects(f.call('context'),/no longer/);assert.equal(f.commits.length,0);
});
test('subscription and module restrictions apply without exposing staff capabilities',async()=>{
 const f=await fixture();for(const access of [{edition:'school'},{edition:'hospital',subscriptionActive:false},{edition:'hospital',allowedSections:[]}])await assert.rejects(f.call('context',{}, {staffAccessFor:async()=>access}),/temporarily unavailable/);
 await assert.rejects(f.call('book',f.bookInput(),{staffAccessFor:async()=>({edition:'hospital',allowedSections:['hospitalReception'],subscriptionReadOnly:true})}),/temporarily unavailable/);await assert.rejects(f.call('savePatient'),/valid patient/);assert.equal(f.commits.length,0);
});
test('clinic lookup is one bounded dated branch query and returns no booking map or usernames',async()=>{
 const f=await fixture();const r=await f.call('clinics',{Day:'2026-10-26'});assert.equal(r.clinics.length,1);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.deepEqual(f.queries[0].filters.map(v=>v.field),['BranchId','Day','Active','SelfBookingEnabled']);assert.ok(!JSON.stringify(r).includes('Bookings'));assert.ok(!JSON.stringify(r).includes('PatientId'));assert.ok(!('Clinician' in r.clinics[0]));assert.equal(f.commits.length,0);
 for(const Day of ['2026-10-25','2028-10-26','bad'])await assert.rejects(f.call('clinics',{Day}),/date|YYYY/);
 await assert.rejects(f.call('clinics',{Day:'2026-10-26',Cursor:{id:f.ScheduleId,scope:'wrong'}}),/first page/);
});
test('slots exclude staff clinic bookings and theatre/patient reservations without revealing details',async()=>{
 const f=await fixture();await f.book();const r=await f.call('slots',{ScheduleId:f.ScheduleId});assert.ok(!r.slots.some(s=>s.StartAt==='2026-10-26T13:00:00.000Z'));
 const lock=f.rows('TheatreReservations')[0];lock.Entries.push({CaseId:'private-theatre-case',StartAt:'2026-10-26T14:00:00.000Z',EndAt:'2026-10-26T14:30:00.000Z'});
 const next=await f.call('slots',{ScheduleId:f.ScheduleId});assert.ok(!next.slots.some(s=>s.StartAt==='2026-10-26T14:00:00.000Z'));assert.doesNotMatch(JSON.stringify(next),/private-theatre-case|PatientId|CaseId/);
});
test('booking is atomic, preserves registration and creates no visits, charges, payments or emails',async()=>{
 const f=await fixture(),before=clean(f.rows('Patients')[0]);await f.selfBook();assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('AppointmentEvents').length,1);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,9);assert.ok(f.reads.length<=10);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,2);assert.deepEqual(clean(f.rows('Patients')[0]),before);
 for(const name of ['Visits','Invoices','Payments','AppointmentReminders','ClinicalEntries','StockMovements'])assert.equal(f.rows(name).length,0);
 const r=await f.call('context');assert.equal(r.appointment.Status,'Scheduled');assert.ok(!('PatientId' in r.appointment));assert.match(f.rows('Appointments')[0].UpdatedBy,/patient:/);
});
test('repeat clicks and concurrent requests create one booking even with different request IDs',async()=>{
 const f=await fixture();const results=await Promise.allSettled([f.selfBook(),f.selfBook()]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('AppointmentEvents').length,1);await assert.rejects(f.selfBook(),/changed/);assert.equal(f.rows('Appointments').length,1);
});
test('same-request concurrent retries and lost-response replays do not add writes',async()=>{
 const f=await fixture(),b=f.bookInput();const results=await Promise.all([f.call('book',b),f.call('book',b)]);assert.ok(results.every(r=>r.ok));f.reset();f.setTime('2026-10-27T12:00:00Z');assert.equal((await f.call('book',b)).replayed,true);assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);assert.equal(f.reads.length,4,JSON.stringify(f.reads));await assert.rejects(f.call('book',{...b,Reason:'changed payload'}),/different details/);
});
test('a committed response lost in transit retries the same receipt once',async()=>{
 const f=await fixture(),b=f.bookInput(),commit=f.db.batchCommitLiteralDocuments;await assert.rejects(f.call('book',b,{batchCommitLiteralDocuments:async(e,w)=>{await commit(e,w);throw Error('response lost');}}),/response lost/);const r=await f.call('book',b);assert.equal(r.replayed,true);assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('AppointmentEvents').length,1);
});
test('patients compete with Reception for the same doctor and times',async()=>{
 const f=await fixture();const result=await Promise.allSettled([f.selfBook(),f.book()]);assert.ok(result.some(r=>r.status==='fulfilled'));assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('AppointmentSchedules')[0].Bookings.length,1);
});
test('new patient links cannot take an already reserved slot',async()=>{
 const f=await fixture();await f.selfBook();const p=await f.register({Patient:{FirstName:'Other',LastName:'Patient',DateOfBirth:'2001-01-01',Sex:'Male'}}),t=token();await f.reception.issuePatientBookingLink(request({PatientId:p.PatientId,AccessToken:t,ConfirmPatient:true}));await assert.rejects(hospitalPatientBookingAction(env,t,{action:'book',...f.bookInput()},f.db),/slot.*available/);assert.equal(f.rows('Appointments').length,1);
});
test('stale slot, arbitrary duration, disabled clinics and inactive doctors are rejected',async()=>{
 const f=await fixture();await assert.rejects(f.selfBook({StartAt:'2026-10-26T13:11:00.000Z'}),/slot/);await assert.rejects(f.selfBook({ConfirmBooking:false}),/Confirm/);f.rows('AppointmentSchedules')[0].SelfBookingEnabled=false;await assert.rejects(f.selfBook(),/not available/);f.rows('AppointmentSchedules')[0].SelfBookingEnabled=true;f.store.get('staffUsers/doctor').Active=false;await assert.rejects(f.selfBook(),/active Doctor/);assert.equal(f.commits.length,0);
});
test('patient cannot use another branch clinic even with its schedule ID',async()=>{
 const f=await fixture();f.rows('AppointmentSchedules')[0].BranchId='north';await assert.rejects(f.call('slots',{ScheduleId:f.ScheduleId}),/not available/);await assert.rejects(f.selfBook(),/not available/);assert.equal(f.commits.length,0);
});
test('revocation and registration edits racing a booking abort the whole commit',async()=>{
 for(const target of ['PatientBookingLinks','Patients','AppointmentSchedules']){const f=await fixture(),commit=f.db.batchCommitLiteralDocuments;await assert.rejects(f.call('book',f.bookInput(),{batchCommitLiteralDocuments:async(e,w)=>{f.rows(target)[0].__updateTime='competing-change';return commit(e,w);}}),/changed/);assert.equal(f.rows('Appointments').length,0);assert.equal(f.rows('TheatreReservations').length,0);assert.equal(f.rows('AppointmentEvents').length,0);}
});
test('reschedule and cancellation preserve snapshots, release slots and keep one appointment',async()=>{
 const f=await fixture();await f.selfBook();let current=(await f.call('context')).appointment;
 await f.selfBook({StartAt:'2026-10-26T14:00:00.000Z',Revision:current.Revision,Reason:'Patient needs later time'});assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('AppointmentEvents').length,2);
 current=(await f.call('context')).appointment;const b={Revision:current.Revision,Reason:'Patient cannot attend',ConfirmBooking:true,RequestId:crypto.randomUUID()};await f.call('cancel',b);assert.equal((await f.call('context')).appointment.Status,'Cancelled');assert.equal(f.rows('AppointmentEvents').length,3);assert.equal(f.rows('AppointmentSchedules')[0].Bookings.length,0);assert.ok(f.rows('TheatreReservations').every(r=>!r.Entries.length));f.reset();await f.call('cancel',b);assert.equal(f.commits.length,0);await assert.rejects(f.selfBook(),/no longer/);
});
test('staff edits and arrived appointments cannot be overwritten by a stale patient view',async()=>{
 const f=await fixture();await f.selfBook();const r=(await f.call('context')).appointment;await assert.rejects(f.selfBook({Revision:r.Revision,StartAt:'2026-10-26T14:00:00.000Z',Reason:''}),/reason/);
 f.rows('Appointments')[0].__updateTime='staff-edited';await assert.rejects(f.selfBook({Revision:r.Revision}),/changed/);f.rows('Appointments')[0].Status='Arrived';await assert.rejects(f.selfBook({Revision:'staff-edited'}),/no longer/);
});
test('cancelled links can be renewed for a new booking while earlier history survives',async()=>{
 const f=await fixture();await f.selfBook();await f.call('cancel',{Revision:(await f.call('context')).appointment.Revision,Reason:'Patient cannot attend',ConfirmBooking:true,RequestId:crypto.randomUUID()});f.token=token();await f.issue();assert.equal((await f.call('context')).appointment,null);await f.selfBook();assert.equal(f.rows('Appointments').length,2);assert.equal(f.rows('Appointments').filter(r=>r.Status==='Scheduled').length,1);
});
test('self-booking setup is explicit, inherited by generated clinics, with valid slot lengths',async()=>{
 const f=await fixture();for(const SlotMinutes of [0,3,121,'bad'])await assert.rejects(f.admin.saveAppointmentSchedule(request({Schedule:{...clinic,SlotMinutes}})),/length/);
 const made=await f.admin.saveClinicTemplate(request({Template:{...clinic,Reference:'PUBLIC-CLINIC',Name:'Patient clinic',Weekdays:[2],SelfBookingEnabled:true,SlotMinutes:15}}));const t=f.rows('ClinicTemplates')[0],body=request({TemplateId:made.TemplateId,Revision:t.__updateTime,DateRange:{fromDate:'2026-10-27',toDate:'2026-10-27'}}),p=await f.admin.previewClinicTemplate(body);await f.admin.generateClinicTemplate({...body,RequestId:crypto.randomUUID(),ConfirmGeneration:true,PreviewToken:p.preview.Token});assert.equal(f.rows('AppointmentSchedules').at(-1).SelfBookingEnabled,true);assert.equal(f.rows('AppointmentSchedules').at(-1).SlotMinutes,15);
});
test('link data and events participate in backups and self-booking has an additive index',async()=>{
 for(const name of ['PatientBookingLinks','PatientBookingAccess','PatientBookingLinkEvents'])assert.ok(HOSPITAL_COLLECTIONS.includes(name));const data=JSON.parse(await readFile('firestore.hospital.indexes.json'));assert.ok(data.indexes.some(i=>i.collectionGroup==='hospitalAppointmentSchedules'&&i.fields.some(f=>f.fieldPath==='SelfBookingEnabled')));
});
test('public endpoint rejects cross-origin and malformed credentials without database calls',async()=>{
 for(const Origin of ['https://elsewhere.test',null]){const r=await onRequestPost({env,request:new Request('https://hospital.test/api/hospital-patient-booking',{method:'POST',headers:Origin?{Origin}:{},body:'{}'})});assert.equal(r.status,403);}
 const r=await onRequestPost({env,request:new Request('https://hospital.test/api/hospital-patient-booking',{method:'POST',headers:{Origin:'https://hospital.test','Content-Type':'application/json'},body:JSON.stringify({action:'context'})})});assert.equal(r.status,401);assert.equal(r.headers.get('Cache-Control'),'private, no-store');
});
