import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {appointmentsFixture,appointmentActors,clinic,appointmentPeriod} from './helpers/hospital-appointments-fixture.mjs';
import {request,env} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';
const template={Reference:'WEEKLY-001',Name:'Weekly outpatients',Clinician:'doctor',Department:'Outpatients',Active:true,Weekdays:[1,3,5],Windows:[{From:'13:00',To:'18:00'}]};
const period={fromDate:'2026-10-26',toDate:'2026-11-01'};
const writes=f=>f.commits.reduce((n,w)=>n+w.length,0);
async function fixture(){
  const f=await appointmentsFixture();
  f.saveBody=(extra={})=>request({Template:{...template,...extra}});
  f.save=extra=>f.admin.saveClinicTemplate(f.saveBody(extra));
  f.row=()=>f.rows('ClinicTemplates')[0];
  f.scope=()=>({TemplateId:f.row().TemplateId,Revision:f.row().__updateTime});
  f.previewBody=(DateRange=period)=>request({...f.scope(),DateRange});
  f.preview=async(DateRange=period)=>(await f.admin.previewClinicTemplate(f.previewBody(DateRange))).preview;
  f.generateBody=async(DateRange=period)=>request({...f.scope(),DateRange,PreviewToken:(await f.preview(DateRange)).Token,ConfirmGeneration:true});
  f.editBody=changes=>request({...f.scope(),Template:{...template,...changes},Reason:'Change next clinic generation'});
  return f;
}
test('recurring template creation is bounded, atomic and retains immutable snapshots',async()=>{
  const f=await fixture(),prior=structuredClone([...f.store]);f.reset();await f.save();
  assert.equal(f.reads.length,2);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,2);assert.equal(writes(f),4);assert.equal(f.commits.length,1);
  for(const [key,row] of prior)assert.deepEqual(f.store.get(key),row);
  assert.equal(f.rows('ClinicTemplateEvents').length,1);assert.deepEqual(f.row().Weekdays,[1,3,5]);
});
test('unchanged saves do not query clinicians or write; lost responses replay one receipt',async()=>{
  const f=await fixture(),body=f.saveBody(),commit=f.db.batchCommitLiteralDocuments;let once=true;
  f.db.batchCommitLiteralDocuments=async(...args)=>{await commit(...args);if(once){once=false;throw Error('Response lost');}};
  const service=createHospitalService(env,appointmentActors.admin,f.db);
  await assert.rejects(service.saveClinicTemplate(body),/Response lost/);f.reset();assert.equal((await service.saveClinicTemplate(body)).replayed,true);
  assert.equal(f.reads.length,1);assert.equal(writes(f),0);f.reset();assert.equal((await f.save()).Unchanged,true);assert.equal(writes(f),0);assert.equal(f.queries.length,0);
  await assert.rejects(service.saveClinicTemplate({...body,Template:{...template,Name:'Changed'}}),/different information/);
});
test('template validation rejects invalid days, overlaps, usernames, references and status',async()=>{
  const f=await fixture();
  for(const change of [{Weekdays:[]},{Weekdays:[1,1]},{Weekdays:[7]},{Weekdays:['1']},{Active:'true'},{Windows:[]},{Windows:[{From:'09:00',To:'08:00'}]},
    {Windows:[{From:'09:00',To:'12:00'},{From:'11:00',To:'13:00'}]},{Clinician:'unknown'},{Reference:'!'},{Name:''}])await assert.rejects(f.save(change));
  assert.equal(f.rows('ClinicTemplates').length,0);
});
test('reasoned template edits retain previous versions and all generated days',async()=>{
  const f=await fixture();await f.save();await f.admin.generateClinicTemplate(await f.generateBody());const days=structuredClone(f.rows('AppointmentSchedules')),first=structuredClone(f.rows('ClinicTemplateEvents')[0]);
  const body=f.editBody({Department:'Changed clinic'});await assert.rejects(f.admin.saveClinicTemplate({...body,Reason:''}),/reason/);
  await f.admin.saveClinicTemplate(body);assert.deepEqual(f.rows('AppointmentSchedules'),days);assert.deepEqual(f.rows('ClinicTemplateEvents')[0],first);
  await assert.rejects(f.admin.saveClinicTemplate({...body,RequestId:crypto.randomUUID(),Template:{...body.Template,Name:'Changed again'}}),/changed/);
  await assert.rejects(f.admin.saveClinicTemplate({...f.editBody({Reference:'NEW-REFERENCE'})}),/permanent/);
});
test('preview follows WAT weekdays, reads only matching dates and writes nothing',async()=>{
  const f=await fixture();await f.save();f.reset();const p=await f.preview();
  assert.deepEqual(p.entries.map(e=>e.Day),['2026-10-26','2026-10-28','2026-10-30']);assert.equal(p.Create,2);assert.equal(p.Existing,1);assert.equal(p.Conflicts,0);
  assert.equal(f.reads.length,4);assert.equal(f.queries.length,0);assert.equal(writes(f),0);assert.ok(!JSON.stringify(p).includes('Bookings'));
});
test('preview bounds dates to 31 days and next year, and handles a range without selected weekdays',async()=>{
  const f=await fixture();await f.save();
  for(const DateRange of [{fromDate:'2026-10-25',toDate:'2026-10-26'},{fromDate:'2026-11-01',toDate:'2026-10-26'},
    {fromDate:'2026-10-26',toDate:'2026-11-26'},{fromDate:'2028-01-01',toDate:'2028-01-02'},{fromDate:'invalid',toDate:'2026-10-26'}])await assert.rejects(f.preview(DateRange));
  assert.equal((await f.preview({fromDate:'2026-10-27',toDate:'2026-10-27'})).entries.length,0);
  f.setTime('2026-10-26T23:30:00.000Z');await assert.rejects(f.preview(appointmentPeriod),/today or future/);
});
test('generation creates missing days in one commit and preserves matching booked schedules',async()=>{
  const f=await fixture();await f.book();await f.save();const original=structuredClone(f.rows('AppointmentSchedules')[0]),patients=structuredClone(f.rows('Patients')),appointments=structuredClone(f.rows('Appointments'));
  const body=await f.generateBody();f.reset();const r=await f.admin.generateClinicTemplate(body);
  assert.equal(r.Created,2);assert.equal(r.Existing,1);assert.equal(f.commits.length,1);assert.equal(writes(f),8);assert.equal(f.reads.length,5);assert.equal(f.queries.length,1);
  assert.deepEqual(f.rows('AppointmentSchedules').find(s=>s.ScheduleId===original.ScheduleId),original);assert.deepEqual(f.rows('Patients'),patients);assert.deepEqual(f.rows('Appointments'),appointments);
  for(const name of ['Visits','Payments','Invoices','ChargeEvents','StockMovements'])assert.equal(f.rows(name).length,0);
  assert.ok(f.rows('AppointmentSchedules').filter(s=>s.ScheduleId!==original.ScheduleId).every(s=>s.TemplateId===f.row().TemplateId));
});
test('conflicting and disabled availability is skipped, while missing dates are still created',async()=>{
  const f=await fixture();await f.save();const day=f.rows('AppointmentSchedules')[0];await f.admin.saveAppointmentSchedule(request({ScheduleId:day.ScheduleId,Revision:day.__updateTime,Schedule:{...clinic,Active:false}}));
  const before=structuredClone(f.rows('AppointmentSchedules')[0]),p=await f.preview();assert.equal(p.Conflicts,1);assert.equal(p.entries[0].Status,'Needs review');
  const r=await f.admin.generateClinicTemplate(await f.generateBody());assert.equal(r.Created,2);assert.equal(r.Conflicts,1);assert.deepEqual(f.rows('AppointmentSchedules')[0],before);
});
test('repeated generation and overlapping templates cannot duplicate clinic days or history',async()=>{
  const f=await fixture();await f.save();const body=await f.generateBody();await f.admin.generateClinicTemplate(body);f.reset();
  assert.equal((await f.admin.generateClinicTemplate(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(writes(f),0);
  const fresh=await f.generateBody();f.reset();assert.equal((await f.admin.generateClinicTemplate(fresh)).Unchanged,true);assert.equal(writes(f),0);assert.equal(f.queries.length,0);
  await f.save({Reference:'ANOTHER-REFERENCE'});const other=f.rows('ClinicTemplates')[1],scope={TemplateId:other.TemplateId,Revision:other.__updateTime,DateRange:period};
  const p=await f.admin.previewClinicTemplate(request(scope));assert.equal(p.preview.Create,0);
  const n=f.rows('AppointmentScheduleEvents').length;await f.admin.generateClinicTemplate(request({...scope,PreviewToken:p.preview.Token,ConfirmGeneration:true}));assert.equal(f.rows('AppointmentScheduleEvents').length,n);assert.equal(f.rows('AppointmentSchedules').length,3);
});
test('lost generation response replays safely even after the clinic date passes',async()=>{
  const f=await fixture();await f.save();const body=await f.generateBody(),commit=f.db.batchCommitLiteralDocuments;let once=true;
  f.db.batchCommitLiteralDocuments=async(...a)=>{await commit(...a);if(once){once=false;throw Error('Response lost');}};
  const service=createHospitalService(env,appointmentActors.admin,f.db);await assert.rejects(service.generateClinicTemplate(body),/Response lost/);
  f.setTime('2026-12-01T12:00:00.000Z');f.reset();assert.equal((await service.generateClinicTemplate(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(writes(f),0);
});
test('generation requires confirmation, a current preview and an active clinician',async()=>{
  const f=await fixture();await f.save();const body=await f.generateBody();
  await assert.rejects(f.admin.generateClinicTemplate({...body,ConfirmGeneration:false}),/Confirm/);await assert.rejects(f.admin.generateClinicTemplate({...body,PreviewToken:'wrong'}),/preview/);
  await f.schedule({Day:'2026-10-28'});await assert.rejects(f.admin.generateClinicTemplate(body),/preview/);assert.equal(f.rows('AppointmentSchedules').length,2);
  const fresh=await f.generateBody();f.store.get('staffUsers/doctor').Active=false;await assert.rejects(f.admin.generateClinicTemplate(fresh),/active Doctor/);assert.equal(f.rows('AppointmentSchedules').length,2);
});
test('pausing a template stops generation and preserves bookings and clinic days',async()=>{
  const f=await fixture();await f.save();const body=await f.generateBody();await f.book();const schedules=structuredClone(f.rows('AppointmentSchedules'));
  await f.admin.saveClinicTemplate(f.editBody({Active:false}));await assert.rejects(f.admin.generateClinicTemplate(body),/changed/);await assert.rejects(f.preview(),/inactive/);
  assert.deepEqual(f.rows('AppointmentSchedules'),schedules);assert.equal(f.rows('Appointments').length,1);
});
test('concurrent generation of the same pattern creates one atomic set',async()=>{
  const f=await fixture();await f.save();const a=await f.generateBody(),b={...a,RequestId:crypto.randomUUID()};f.reset();const r=await Promise.allSettled([f.admin.generateClinicTemplate(a),f.admin.generateClinicTemplate(b)]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.rows('AppointmentSchedules').length,3);assert.equal(f.commits.length,1);
});
test('a competing manual clinic creation aborts the whole generation without partial days',async()=>{
  const f=await fixture();await f.save();const body=await f.generateBody(),commit=f.db.batchCommitLiteralDocuments;let once=true;
  f.db.batchCommitLiteralDocuments=async(e,w)=>{if(once&&w.some(x=>x.data.Type==='Clinic days generated')){once=false;await f.schedule({Day:'2026-10-28',Department:'Manual clinic'});}return commit(e,w);};
  const service=createHospitalService(env,appointmentActors.admin,f.db);await assert.rejects(service.generateClinicTemplate(body),/changed/);
  assert.equal(f.rows('AppointmentSchedules').length,2);assert.equal(f.rows('ClinicTemplateEvents').length,1);assert.equal(f.rows('AppointmentSchedules')[1].Department,'Manual clinic');
});
test('concurrent deactivation is not overwritten by generation',async()=>{
  const f=await fixture();await f.save();const body=await f.generateBody(),commit=f.db.batchCommitLiteralDocuments;let once=true;
  f.db.batchCommitLiteralDocuments=async(e,w)=>{if(once&&w.some(x=>x.data.Type==='Clinic days generated')){once=false;await f.admin.saveClinicTemplate(f.editBody({Active:false}));}return commit(e,w);};
  const service=createHospitalService(env,appointmentActors.admin,f.db);await assert.rejects(service.generateClinicTemplate(body),/changed/);
  assert.equal(f.row().Active,false);assert.equal(f.rows('AppointmentSchedules').length,1);
});
test('maximum generation reads at most 31 dates and writes at most 66 documents',async()=>{
  const f=await fixture();await f.save({Weekdays:[0,1,2,3,4,5,6]});const range={fromDate:'2026-11-01',toDate:'2026-12-01'},body=await f.generateBody(range);f.reset();
  assert.equal((await f.admin.generateClinicTemplate(body)).Created,31);assert.equal(f.reads.length,33);assert.equal(f.queries.length,1);assert.equal(writes(f),66);
});
test('read/write, branch, module, subscription and doctor ownership boundaries apply',async()=>{
  const f=await fixture();await f.save();
  assert.equal((await f.nurse.clinicTemplates(request({Active:true}))).templates.length,1);
  for(const user of [appointmentActors.nurse,appointmentActors.reception,appointmentActors.cashier,{...appointmentActors.admin,allowedSections:[]},{...appointmentActors.admin,subscriptionReadOnly:true}]){
    const s=createHospitalService(env,user,f.db);await assert.rejects(s.saveClinicTemplate(f.saveBody({Reference:'DENIED-REF'})),e=>e.status===403);
    await assert.rejects(s.generateClinicTemplate(await f.generateBody()),e=>e.status===403);
  }
  await f.doctor.saveClinicTemplate(f.saveBody({Reference:'DOCTOR-OWN'}));await assert.rejects(f.doctor.saveClinicTemplate(f.saveBody({Clinician:'other'})),e=>e.status===403);
  const other=await f.save({Reference:'OTHER-DOCTOR',Clinician:'other'}),row=f.rows('ClinicTemplates').find(t=>t.TemplateId===other.TemplateId);
  await assert.rejects(f.doctor.saveClinicTemplate(request({TemplateId:row.TemplateId,Revision:row.__updateTime,Template:{...template,Reference:'OTHER-DOCTOR'},Reason:'Try changing owner'})),e=>e.status===403);
  await assert.rejects(f.doctor.previewClinicTemplate(request({TemplateId:row.TemplateId,Revision:row.__updateTime,DateRange:period})),e=>e.status===403);
  const cross=createHospitalService(env,{...appointmentActors.admin,assignedBranchIds:['main','north']},f.db);
  await assert.rejects(cross.clinicTemplateDetails(request({TemplateId:f.row().TemplateId,BranchId:'north'})),e=>[403,404].includes(e.status));
});
test('template lists and history use bounded scope-bound pages without loading patients',async()=>{
  const f=await fixture();await f.save();const row=f.row(),path=[...f.store.keys()].find(k=>k.endsWith('/'+row.TemplateId)).slice(0,-row.TemplateId.length);
  for(let i=0;i<33;i++)f.store.set(path+'copy-'+String(i).padStart(4,'0'),{...row,TemplateId:'copy-'+String(i).padStart(4,'0'),__id:'copy-'+String(i).padStart(4,'0'),Name:'Template '+String(i).padStart(4,'0')});
  f.reset();const a=await f.admin.clinicTemplates(request({Active:true}));assert.equal(a.templates.length,30);assert.equal(f.queries[0].limit,31);assert.equal(f.reads.length,0);assert.equal(writes(f),0);
  const b=await f.admin.clinicTemplates(request({Active:true,Cursor:a.next}));assert.equal(b.templates.length,4);assert.equal(new Set([...a.templates,...b.templates].map(r=>r.TemplateId)).size,34);
  await assert.rejects(f.admin.clinicTemplates(request({Active:false,Cursor:a.next})),/different clinic filters/);
  await assert.rejects(f.admin.clinicTemplateHistory(request({TemplateId:row.TemplateId})),/date/i);
  const h=await f.admin.clinicTemplateHistory(request({TemplateId:row.TemplateId,DateRange:appointmentPeriod}));assert.equal(h.entries.length,1);assert.equal(f.queries.at(-1).limit,31);
});
test('new templates are backed up, routed and have scoped ascending indexes',async()=>{
  for(const name of ['ClinicTemplates','ClinicTemplateEvents'])assert.ok(HOSPITAL_COLLECTIONS.includes(name));
  const indexes=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8')).indexes;
  for(const [group,fields] of [['ClinicTemplates',['BranchId','Active','Name','__name__']],['ClinicTemplateEvents',['BranchId','TemplateId','CreatedAt','__name__']]])assert.ok(indexes.some(i=>i.collectionGroup==='hospital'+group&&JSON.stringify(i.fields.map(f=>f.fieldPath))===JSON.stringify(fields)&&i.fields.every(f=>f.order==='ASCENDING')));
  const route=await readFile(new URL('../functions/api/staff-hospital.js',import.meta.url),'utf8');for(const action of ['clinicTemplates','clinicTemplateDetails','saveClinicTemplate','previewClinicTemplate','generateClinicTemplate','clinicTemplateHistory'])assert.ok(route.includes("'"+action+"'"));
});
