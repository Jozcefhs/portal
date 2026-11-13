import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {appointmentsFixture,appointmentActors,appointmentPeriod} from './helpers/hospital-appointments-fixture.mjs';
import {request,env,profile} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';
const fields={Reference:'WAIT-001',Department:'Outpatients',PreferredFrom:'2026-10-26',PreferredTo:'2026-10-28',Clinician:'',Note:'Morning preferred'};
const writes=f=>f.commits.reduce((n,rows)=>n+rows.length,0);
async function fixture(){const f=await appointmentsFixture();
 f.addBody=(change={})=>request({PatientId:f.PatientId,ConfirmPatient:true,Waitlist:{...fields,...change}});
 f.add=change=>f.reception.saveAppointmentWaitlist(f.addBody(change));
 f.row=()=>f.rows('AppointmentWaitlist')[0];
 f.link=()=>({...f.bookBody({Reference:f.row().Reference}),WaitlistId:f.row().WaitlistId,WaitlistRevision:f.row().__updateTime});
 f.cancelBody=()=>request({PatientId:f.PatientId,WaitlistId:f.row().WaitlistId,Revision:f.row().__updateTime,ConfirmPatient:true,Reason:'Patient no longer needs this appointment'});
 return f;
}
test('waitlist creation is one atomic commit with fixed reads and no patient or billing changes',async()=>{
 const f=await fixture(),patient=structuredClone(f.rows('Patients'));f.reset();await f.add();
 assert.equal(f.reads.length,4);assert.equal(f.queries.length,0);assert.equal(writes(f),5);assert.equal(f.commits.length,1);
 assert.deepEqual(f.rows('Patients'),patient);for(const name of ['Visits','Appointments','Invoices','ChargeEvents','Payments'])assert.equal(f.rows(name).length,0);
 assert.equal(f.rows('AppointmentWaitlistEvents').length,1);assert.equal(f.row().Status,'Waiting');
});
test('lost responses and repeated fresh saves cannot duplicate waiting requests or audit events',async()=>{
 const f=await fixture(),body=f.addBody(),commit=f.db.batchCommitLiteralDocuments;let once=true;
 f.db.batchCommitLiteralDocuments=async(...a)=>{await commit(...a);if(once){once=false;throw Error('Response lost');}};
 const service=createHospitalService(env,appointmentActors.reception,f.db);
 await assert.rejects(service.saveAppointmentWaitlist(body),/Response lost/);f.reset();assert.equal((await service.saveAppointmentWaitlist(body)).replayed,true);
 assert.equal(f.reads.length,1);assert.equal(writes(f),0);f.reset();assert.equal((await f.add()).Unchanged,true);assert.equal(writes(f),0);assert.equal(f.queries.length,0);
 assert.equal(f.rows('AppointmentWaitlistEvents').length,1);await assert.rejects(service.saveAppointmentWaitlist({...body,Waitlist:{...fields,Note:'different'}}),/different information/);
});
test('patient and department guard prevents concurrent and separately referenced duplicates',async()=>{
 const f=await fixture(),r=await Promise.allSettled([f.add(),f.add({Reference:'WAIT-002',Department:' OUTPATIENTS '})]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.rows('AppointmentWaitlist').length,1);assert.equal(f.rows('AppointmentWaitlistEvents').length,1);
 await f.add({Reference:'WAIT-003',Department:'Dental'});assert.equal(f.rows('AppointmentWaitlist').length,2);
});
test('waitlist validates patient confirmation, dates, active clinician and permanent identity',async()=>{
 const f=await fixture();
 for(const changes of [{Reference:'!'},{Department:''},{PreferredTo:'2026-10-25'},{PreferredFrom:'2026-10-29'},{PreferredTo:'2028-01-01'},{Clinician:'cashier'}])await assert.rejects(f.add(changes));
 await assert.rejects(f.reception.saveAppointmentWaitlist({...f.addBody(),ConfirmPatient:false}),/Confirm/);
 await f.add();const row=f.row();
 await assert.rejects(f.reception.saveAppointmentWaitlist({...f.addBody({Reference:'NEW-REF'}),WaitlistId:row.WaitlistId,Revision:row.__updateTime}),/permanent/);
 await assert.rejects(f.add({Department:'Dental'}),/already belongs/);
});
test('preference edits preserve snapshots, require reason and reject stale changes',async()=>{
 const f=await fixture();await f.add();const row=structuredClone(f.row()),first=structuredClone(f.rows('AppointmentWaitlistEvents')[0]);
 const body={...f.addBody({Note:'Afternoon preferred'}),WaitlistId:row.WaitlistId,Revision:row.__updateTime};
 await assert.rejects(f.reception.saveAppointmentWaitlist(body),/reason/);await f.reception.saveAppointmentWaitlist({...body,Reason:'Patient changed their preference'});
 assert.deepEqual(f.rows('AppointmentWaitlistEvents')[0],first);assert.equal(f.row().Note,'Afternoon preferred');
 await assert.rejects(f.reception.saveAppointmentWaitlist({...body,RequestId:crypto.randomUUID(),Reason:'Patient changed their preference again',Waitlist:{...body.Waitlist,Note:'Other'}}),/changed/);
});
test('waitlist booking is atomic with capacity, cross-workflow guards and permanent links',async()=>{
 const f=await fixture();await f.add();const first=structuredClone(f.rows('AppointmentWaitlistEvents')[0]);f.reset();const result=await f.reception.saveAppointment(f.link());
 assert.equal(f.reads.length,8);assert.equal(f.queries.length,1);assert.equal(writes(f),10);assert.equal(f.commits.length,1);
 assert.equal(f.row().Status,'Booked');assert.equal(f.row().AppointmentId,result.AppointmentId);assert.equal(f.rows('Appointments')[0].WaitlistId,f.row().WaitlistId);
 assert.equal(f.rows('AppointmentWaitlistGuards')[0].WaitlistId,'');assert.deepEqual(f.rows('AppointmentWaitlistEvents')[0],first);
 assert.equal(f.rows('Visits').length,0);assert.equal(f.rows('ChargeEvents').length,0);
});
test('same and fresh booking retries preserve one appointment and one waitlist booking event',async()=>{
 const f=await fixture();await f.add();const body=f.link();await f.reception.saveAppointment(body);f.reset();
 assert.equal((await f.reception.saveAppointment(body)).replayed,true);assert.equal(writes(f),0);assert.equal(f.reads.length,1);
 assert.equal((await f.reception.saveAppointment({...body,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(writes(f),0);
 await assert.rejects(f.reception.saveAppointment({...f.link(),Booking:{...body.Booking,Reference:'OTHER-BOOKING'}}),/already has an appointment/);
 assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('AppointmentWaitlistEvents').filter(e=>e.Type==='Booked').length,1);
});
test('conversion failure leaves waitlist, clinic capacity and all snapshots untouched',async()=>{
 const f=await fixture();await f.add({Clinician:'other'});const snapshot=structuredClone(f.rows('AppointmentWaitlist'));f.reset();
 await assert.rejects(f.reception.saveAppointment(f.link()),/matching/);assert.equal(writes(f),0);assert.deepEqual(f.rows('AppointmentWaitlist'),snapshot);
 const g=await fixture();await g.add({PreferredFrom:'2026-10-27'});await assert.rejects(g.reception.saveAppointment(g.link()),/preferred dates/);
 assert.equal(g.rows('AppointmentSchedules')[0].Bookings.length,0);
});
test('two conversions cannot create separate appointments even at different times',async()=>{
 const f=await fixture();await f.add();const a=f.link(),b={...f.link(),Booking:{...a.Booking,Reference:'SECOND-BOOK',StartAt:'2026-10-26T14:00:00.000Z',EndAt:'2026-10-26T14:30:00.000Z'}};
 const r=await Promise.allSettled([f.reception.saveAppointment(a),f.reception.saveAppointment(b)]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.rows('Appointments').length,1);assert.equal(f.rows('AppointmentSchedules')[0].Bookings.length,1);
});
test('cancel versus conversion race yields one consistent outcome without partial records',async()=>{
 const f=await fixture();await f.add();const r=await Promise.allSettled([f.reception.cancelAppointmentWaitlist(f.cancelBody()),f.reception.saveAppointment(f.link())]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.rows('Appointments').length,f.row().Status==='Booked'?1:0);
 assert.equal(f.rows('AppointmentWaitlistEvents').length,2);assert.equal(f.rows('AppointmentWaitlistGuards')[0].WaitlistId,'');
});
test('edit versus conversion race never books stale preferences',async()=>{
 const f=await fixture();await f.add();const edit={...f.addBody({PreferredFrom:'2026-10-27'}),WaitlistId:f.row().WaitlistId,Revision:f.row().__updateTime,Reason:'Patient requested next day'};
 const r=await Promise.allSettled([f.reception.saveAppointmentWaitlist(edit),f.reception.saveAppointment(f.link())]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.rows('Appointments').length,f.row().Status==='Booked'?1:0);
});
test('cancel preserves history, allows a new request and fresh repeated cancellations write nothing',async()=>{
 const f=await fixture();await f.add();const body=f.cancelBody();await f.reception.cancelAppointmentWaitlist(body);f.reset();
 assert.equal((await f.reception.cancelAppointmentWaitlist({...body,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(writes(f),0);
 await f.add({Reference:'WAIT-NEW'});assert.equal(f.rows('AppointmentWaitlist').length,2);assert.equal(f.rows('AppointmentWaitlistEvents').length,3);
});
test('booked request cannot be cancelled or revived by changing its saved preference',async()=>{
 const f=await fixture();await f.add();await f.reception.saveAppointment(f.link());
 await assert.rejects(f.reception.cancelAppointmentWaitlist(f.cancelBody()),/Only a waiting/);await assert.rejects(f.add(),/already booked/);
 const a=f.rows('Appointments')[0];await f.reception.closeAppointment(f.body(a,{Status:'Cancelled',Reason:'Patient cancels the booked visit'}));
 assert.equal(f.row().Status,'Booked');assert.equal(f.rows('AppointmentWaitlistEvents').length,2);
});
test('queue is branch-scoped, bounded and uses snapshots without per-patient lookups',async()=>{
 const f=await fixture();await f.add();const path=f.reads.find(([p])=>p.endsWith('/hospitalAppointmentWaitlist'))[0],row=f.row();
 for(let i=0;i<34;i++)f.store.set(`${path}/wait-row-${i.toString().padStart(3,'0')}`,{...row,__id:`wait-row-${i.toString().padStart(3,'0')}`,WaitlistId:`row-${i}`});
 f.reset();const a=await f.reception.appointmentWaitlist(request({Status:'Waiting'}));assert.equal(a.entries.length,30);assert.ok(a.next);
 assert.equal(f.reads.length,0);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.equal(writes(f),1);
 const b=await f.reception.appointmentWaitlist(request({Status:'Waiting',Cursor:a.next}));assert.equal(b.entries.length,5);
 assert.equal(new Set([...a.entries,...b.entries].map(e=>e.WaitlistId)).size,35);
 await assert.rejects(f.reception.appointmentWaitlist(request({Status:'Cancelled',Cursor:a.next,DateRange:appointmentPeriod})),/cursor/i);
});
test('completed queue and history require dates and do not scan on missing filters',async()=>{
 const f=await fixture();await f.add();f.reset();
 for(const Status of ['Booked','Cancelled'])await assert.rejects(f.reception.appointmentWaitlist(request({Status})));
 await assert.rejects(f.reception.appointmentWaitlistHistory(request({WaitlistId:f.row().WaitlistId,PatientId:f.PatientId})));assert.equal(f.queries.length,0);assert.equal(writes(f),0);
 await f.reception.cancelAppointmentWaitlist(f.cancelBody());const list=await f.reception.appointmentWaitlist(request({Status:'Cancelled',DateRange:appointmentPeriod}));assert.equal(list.entries.length,1);
 const history=await f.reception.appointmentWaitlistHistory(request({WaitlistId:f.row().WaitlistId,PatientId:f.PatientId,DateRange:appointmentPeriod}));assert.deepEqual(history.entries.map(e=>e.Type).sort(),['Added','Cancelled']);
});
test('roles, module access, subscription and branch scope apply to every waitlist operation',async()=>{
 const f=await fixture();await f.add();
 await assert.rejects(f.nurse.saveAppointmentWaitlist(f.addBody()),/role/);await assert.rejects(f.cashier.appointmentWaitlist(request()),/role/);
 await assert.rejects(f.reception.appointmentWaitlistDetails(request({PatientId:f.PatientId,WaitlistId:f.row().WaitlistId,BranchId:'north'})),/assigned access/);
 assert.throws(()=>createHospitalService(env,{...appointmentActors.reception,subscriptionActive:false},f.db),/subscription/);
 const removed=createHospitalService(env,{...appointmentActors.reception,allowedSections:[]},f.db);await assert.rejects(removed.appointmentWaitlist(request()));
 await f.nurse.appointmentWaitlist(request());
});
test('cross-patient links and occupied clinic slots leave waiting requests unchanged',async()=>{
 const f=await fixture();await f.add();await f.book({Reference:'OTHER-APPOINTMENT'});f.reset();await assert.rejects(f.reception.saveAppointment(f.link()),/overlapping/);assert.equal(writes(f),0);assert.equal(f.row().Status,'Waiting');
 const second=await f.register({Patient:{...profile,FirstName:'Other'}});
 await assert.rejects(f.reception.saveAppointment({...f.link(),PatientId:second.PatientId}),/patient’s waitlist/);
});
test('all waitlist records are registered for backups and match ascending scoped query indexes',async()=>{
 for(const name of ['AppointmentWaitlist','AppointmentWaitlistGuards','AppointmentWaitlistEvents'])assert.ok(HOSPITAL_COLLECTIONS.includes(name));
 const indexes=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8')).indexes;
 for(const [group,fields] of [['hospitalAppointmentWaitlist',['BranchId','Status','CreatedAt','__name__']],['hospitalAppointmentWaitlist',['BranchId','Status','UpdatedAt','__name__']],['hospitalAppointmentWaitlistEvents',['BranchId','WaitlistId','CreatedAt','__name__']]])assert.ok(indexes.some(i=>i.collectionGroup===group&&JSON.stringify(i.fields)===JSON.stringify(fields.map(fieldPath=>({fieldPath,order:'ASCENDING'})))));
});
