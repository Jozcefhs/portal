import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appointmentsFixture,appointmentActors,appointmentPeriod} from './helpers/hospital-appointments-fixture.mjs';
import {env,request} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {processHospitalReminderSchedule} from '../functions/lib/hospital-reminder-runner.js';
import {onRequestPost} from '../functions/api/hospital-appointment-reminders.js';
import {run as runWorker} from '../workers/hospital-appointment-reminders/index.js';
import {HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';

async function fixture(){
 const f=await appointmentsFixture(),e={...env,BREVO_API_KEY:'synthetic-test-credential'};f.environment=e;f.sent=[];
 f.db.sendConfiguredEmail=async(_e,message)=>{f.sent.push(message);return {ok:true,provider:'test',providerMessageId:'synthetic-message'};};
 const p=f.rows('Patients')[0];p.Email='patient@example.test';
 f.make=(role='reception',overrides={})=>createHospitalService(e,appointmentActors[role],{...f.db,...overrides});f.s=f.make();
 f.appt=await f.book();f.input=()=>request({PatientId:f.PatientId,AppointmentId:f.appt.AppointmentId});
 f.preview=()=>f.s.appointmentReminderPreview(f.input());
 f.queue=async(extra={})=>{const p=await f.preview();return f.s.queueAppointmentReminder({...f.input(),PreviewToken:p.Token,ConfirmConsent:true,DueAt:'2026-10-26T12:00:00Z',...extra});};
 f.row=()=>f.rows('AppointmentReminders')[0];f.send=()=>f.s.sendAppointmentReminder(request({ReminderId:f.row().ReminderId,ConfirmSend:true}));
 f.change=(Action,extra={})=>f.s.changeAppointmentReminder(request({ReminderId:f.row().ReminderId,Revision:f.row().__updateTime,Action,Reason:'Reviewed the provider delivery evidence',...extra}));
 f.reset();return f;
}
const clean=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!k.startsWith('__')));
test('preview uses saved branch contact, minimal content, no writes or collection scans',async()=>{
 const f=await fixture(),p=await f.preview();assert.equal(p.preview.ToEmail,'patient@example.test');assert.match(p.preview.Text,/Main Hospital/);assert.doesNotMatch(p.preview.Text,/2000|Female|080000|diagnosis/);assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);assert.ok(f.reads.length<=4);
});
test('queue requires explicit consent, current preview and connected provider',async()=>{
 const f=await fixture();await assert.rejects(f.queue({ConfirmConsent:false}),/permission/);await assert.rejects(f.queue({PreviewToken:'old'}),/changed/);
 const s=createHospitalService(env,appointmentActors.reception,f.db),p=await s.appointmentReminderPreview(f.input());assert.equal(p.connection.configured,false);await assert.rejects(s.queueAppointmentReminder({...f.input(),PreviewToken:p.Token,ConfirmConsent:true}),/Connect/);assert.equal(f.commits.length,0);
});
test('one reminder per booking slot across different request references',async()=>{
 const f=await fixture();await f.queue();const writes=f.commits.length;const replay=await f.queue();assert.equal(replay.Unchanged,true);assert.equal(f.commits.length,writes);assert.equal(f.rows('AppointmentReminders').length,1);assert.equal(f.sent.length,0);
});
test('concurrent queue requests create one reminder and retain audit',async()=>{
 const f=await fixture();const result=await Promise.allSettled([f.queue(),f.queue()]);assert.ok(result.some(r=>r.status==='fulfilled'));assert.equal(f.rows('AppointmentReminders').length,1);assert.equal(f.rows('AppointmentReminderEvents').length,1);
});
test('reject invalid, past, or post-appointment reminder times',async()=>{
 const f=await fixture();for(const DueAt of ['bad','2026-10-25T12:00:00Z','2026-10-26T13:00:00Z'])await assert.rejects(f.queue({DueAt}),/Choose a reminder time/);assert.equal(f.commits.length,0);
});
test('sending preserves every source field, uses one provider call and repeat is write free',async()=>{
 const f=await fixture();await f.queue();const ap=clean(f.rows('Appointments')[0]),p=clean(f.rows('Patients')[0]);const result=await f.send();assert.equal(result.Status,'Accepted');assert.equal(f.sent.length,1);assert.deepEqual(clean(f.rows('Appointments')[0]),ap);assert.deepEqual(clean(f.rows('Patients')[0]),p);
 assert.equal(f.row().ProviderMessageId,'synthetic-message');assert.deepEqual(f.rows('AppointmentReminderEvents').map(r=>r.Type),['Queued','Sending','Accepted']);f.reset();assert.equal((await f.send()).Unchanged,true);assert.equal(f.commits.length,0);assert.equal(f.sent.length,1);assert.equal(f.rows('Invoices').length,0);
});
test('two simultaneous senders make only one external send',async()=>{
 const f=await fixture();await f.queue();await Promise.all([f.send(),f.send()]);assert.equal(f.sent.length,1);assert.equal(f.row().Status,'Accepted');
});
test('future reminder does not send or write',async()=>{
 const f=await fixture();await f.queue({DueAt:'2026-10-26T12:45:00Z'});f.reset();assert.equal((await f.send()).Unchanged,true);assert.equal(f.sent.length,0);assert.equal(f.commits.length,0);
});
test('cancelled appointment is skipped; original booking and history retained',async()=>{
 const f=await fixture();await f.queue();await f.reception.closeAppointment(f.body(f.appt,{Status:'Cancelled',Reason:'Patient requested cancellation'}));assert.equal((await f.send()).Status,'Skipped');assert.equal(f.sent.length,0);assert.equal(f.rows('Appointments')[0].Status,'Cancelled');
});
test('rescheduled slot gets independent reminder; previous one is skipped',async()=>{
 const f=await fixture();await f.queue();await f.reception.saveAppointment({...f.bookBody({StartAt:'2026-10-26T14:00:00.000Z',EndAt:'2026-10-26T14:30:00.000Z'}),...f.body(f.appt,{Reason:'Patient requested later booking'})});assert.equal((await f.send()).Status,'Skipped');await f.queue();assert.equal(f.rows('AppointmentReminders').length,2);
});
test('email changes, inactive patients and elapsed appointments cannot receive old reminders',async()=>{
 for(const change of ['email','inactive','time']){const f=await fixture();await f.queue();if(change==='email')f.rows('Patients')[0].Email='another@example.test';if(change==='inactive')f.rows('Patients')[0].Status='Inactive';if(change==='time')f.setTime('2026-10-26T13:01:00Z');assert.equal((await f.send()).Status,'Skipped');assert.equal(f.sent.length,0);}
});
test('source change racing the dispatch claim aborts without sending',async()=>{
 const f=await fixture();await f.queue();const commit=f.db.batchCommitLiteralDocuments;f.s=f.make('reception',{batchCommitLiteralDocuments:async(e,w)=>{if(w.some(x=>x.data.Status==='Sending'))f.rows('Appointments')[0].__updateTime='racing-cancel';return commit(e,w);}});assert.equal((await f.send()).Unchanged,true);assert.equal(f.sent.length,0);assert.equal(f.row().Status,'Queued');
});
test('lost claim response never triggers a retry send',async()=>{
 const f=await fixture();await f.queue();const commit=f.db.batchCommitLiteralDocuments;f.s=f.make('reception',{batchCommitLiteralDocuments:async(e,w)=>{await commit(e,w);if(w.some(x=>x.data.Status==='Sending'))throw Error('lost claim response');}});await assert.rejects(f.send(),/lost claim/);f.s=f.make();await f.send();assert.equal(f.sent.length,0);assert.equal(f.row().Status,'Sending');
});
test('lost final persistence response cannot resend an accepted message',async()=>{
 const f=await fixture();await f.queue();const commit=f.db.batchCommitLiteralDocuments;f.s=f.make('reception',{batchCommitLiteralDocuments:async(e,w)=>{if(w.some(x=>x.data.Status==='Accepted'))throw Error('final persistence unavailable');return commit(e,w);}});await assert.rejects(f.send(),/final persistence/);assert.equal(f.row().Status,'Sending');f.s=f.make();await f.send();assert.equal(f.sent.length,1);
});
test('ambiguous and untyped provider failures are held without automatic retry',async()=>{
 for(const error of [Error('unknown'),Object.assign(Error('timeout'),{retrySafe:false,deliveryUncertain:true})]){const f=await fixture();await f.queue();let calls=0;f.s=f.make('reception',{sendConfiguredEmail:async()=>{calls++;throw error;}});assert.equal((await f.send()).Status,'Uncertain');await f.send();assert.equal(calls,1);await assert.rejects(f.change('retry'),/cannot/);}
});
test('definite rejection needs explicit retry; accepted outcome then stops sends',async()=>{
 const f=await fixture();await f.queue();f.s=f.make('reception',{sendConfiguredEmail:async()=>{throw Object.assign(Error('rejected'),{retrySafe:true});}});assert.equal((await f.send()).Status,'Failed');f.s=f.make();await f.send();assert.equal(f.sent.length,0);await f.change('retry');await f.send();await f.send();assert.equal(f.sent.length,1);assert.equal(f.row().Attempt,2);
});
test('provider review requires configuration authority, ten minute hold and explicit confirmation',async()=>{
 const f=await fixture();await f.queue();f.s=f.make('reception',{sendConfiguredEmail:async()=>{throw Error('timeout');}});await f.send();await assert.rejects(f.change('confirm-accepted',{ConfirmProviderReview:true}),/role/);f.s=f.make('admin');await assert.rejects(f.change('confirm-accepted',{ConfirmProviderReview:true}),/ten minutes/);f.setTime('2026-10-26T12:11:00Z');await assert.rejects(f.change('confirm-accepted'),/provider delivery log/);await f.change('confirm-accepted',{ConfirmProviderReview:true});await f.send();assert.equal(f.row().Status,'Accepted');assert.equal(f.sent.length,0);
});
test('cancel and repeated cancellation preserve history and do not send',async()=>{
 const f=await fixture();await f.queue();await f.change('cancel');await f.send();assert.equal(f.sent.length,0);assert.equal(f.row().Status,'Cancelled');await assert.rejects(f.change('retry'),/cannot/);assert.equal(f.rows('AppointmentReminders').length,1);
});
test('read-only and non-appointment roles cannot schedule or process',async()=>{
 const f=await fixture();await f.queue();for(const role of ['nurse','cashier'])await assert.rejects(f.make(role).sendAppointmentReminder(request({ReminderId:f.row().ReminderId,ConfirmSend:true})),/role/);const s=createHospitalService(f.environment,{...appointmentActors.admin,subscriptionReadOnly:true},f.db);await assert.rejects(s.sendAppointmentReminder(request({ReminderId:f.row().ReminderId,ConfirmSend:true})),/viewing/);assert.equal(f.sent.length,0);
});
test('branch access and request confirmation cannot be bypassed',async()=>{
 const f=await fixture();await f.queue();await assert.rejects(f.s.appointmentReminderDetails(request({BranchId:'north',ReminderId:f.row().ReminderId})),/branch/);await assert.rejects(f.s.sendAppointmentReminder(request({ReminderId:f.row().ReminderId})),/Confirm/);assert.equal(f.sent.length,0);
});
test('completed histories need dates; queued register is bounded, scoped and read-only',async()=>{
 const f=await fixture();await f.queue();f.reset();const r=await f.s.appointmentReminders(request({Status:'Queued'}));assert.equal(r.reminders.length,1);assert.equal(f.queries[0].limit,31);assert.equal(f.commits.length,0);await assert.rejects(f.s.appointmentReminders(request({Status:'Accepted'})));await assert.rejects(f.s.appointmentReminders(request({Status:'Queued',Cursor:{id:'other',value:'today',scope:'wrong'}})),/first page/);const h=await f.s.appointmentReminderHistory(request({ReminderId:f.row().ReminderId,DateRange:appointmentPeriod}));assert.equal(h.entries.length,1);
});
test('scheduler empty queue uses one bounded query and no writes',async()=>{
 const f=await fixture();f.reset();const r=await processHospitalReminderSchedule(f.environment,{...f.db,staffAccessFor:async()=>({...appointmentActors.admin})});assert.equal(r.checked,0);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,5);assert.equal(f.reads.length,0);assert.equal(f.commits.length,0);
});
test('overlapping scheduled runs retain one provider acceptance',async()=>{
 const f=await fixture();await f.queue();const opts={...f.db,staffAccessFor:async()=>({...appointmentActors.admin})};await Promise.all([processHospitalReminderSchedule(f.environment,opts),processHospitalReminderSchedule(f.environment,opts)]);assert.equal(f.sent.length,1);assert.equal((await processHospitalReminderSchedule(f.environment,opts)).checked,0);
});
test('inactive subscriptions pause scheduler before reading appointments',async()=>{
 const f=await fixture();const r=await processHospitalReminderSchedule(f.environment,{...f.db,staffAccessFor:async()=>({...appointmentActors.admin,subscriptionActive:false})});assert.equal(r.paused,true);assert.equal(f.queries.length,0);
});
test('scheduler endpoint rejects missing secret and wrong workspace without data access',async()=>{
 const request=(secret,workspace)=>new Request('https://example.test/api/hospital-appointment-reminders',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({expectedWorkspaceId:workspace})});const e={...env,HOSPITAL_REMINDER_SCHEDULER_SECRET:'synthetic-secret'};
 assert.equal((await onRequestPost({env:e,request:request('bad','test-hospital'),data:{}})).status,401);assert.equal((await onRequestPost({env:e,request:request('synthetic-secret','wrong'),data:{}})).status,409);
});
test('scheduler worker validates identity and has no public send trigger',async()=>{
 const e={HOSPITAL_REMINDER_ENDPOINT:'https://hospital.test/api/hospital-appointment-reminders',HOSPITAL_REMINDER_WORKSPACE:'test-hospital',HOSPITAL_REMINDER_SCHEDULER_SECRET:'synthetic-secret'};let calls=0;
 const r=await runWorker(e,async(url,o)=>{calls++;assert.equal(o.redirect,'error');assert.equal(JSON.parse(o.body).expectedWorkspaceId,'test-hospital');return Response.json({ok:true,edition:'hospital',workspaceId:'test-hospital',checked:0});});assert.equal(r.checked,0);assert.equal(calls,1);await assert.rejects(runWorker({...e,HOSPITAL_REMINDER_ENDPOINT:'http://unsafe.test/api/hospital-appointment-reminders'}),/Invalid/);await assert.rejects(runWorker(e,async()=>Response.json({ok:true,workspaceId:'other'})),/Unexpected/);
});
test('reminder records are included in backup registry and all query indexes exist',()=>{
 for(const c of ['AppointmentReminders','AppointmentReminderEvents'])assert.ok(HOSPITAL_COLLECTIONS.includes(c));const indexes=JSON.parse(readFileSync(new URL('../firestore.hospital.indexes.json',import.meta.url))).indexes;assert.equal(indexes.filter(i=>i.collectionGroup==='hospitalAppointmentReminders').length,3);assert.equal(indexes.filter(i=>i.collectionGroup==='hospitalAppointmentReminderEvents').length,1);
 const endpoint=readFileSync(new URL('../functions/api/staff-hospital.js',import.meta.url),'utf8');assert.ok(!endpoint.includes("'processAppointmentReminder'"));
});

test('corrected contact can be explicitly reconfirmed before sending, retaining prior message snapshots',async()=>{
 const f=await fixture();await f.queue();f.rows('Patients')[0].Email='corrected@example.test';await f.send();assert.equal(f.row().Status,'Skipped');
 const old=f.rows('AppointmentReminderEvents').find(e=>e.Type==='Queued');assert.equal(old.Snapshot.ToEmail,'patient@example.test');
 await f.queue({ReplaceUnsent:true,Revision:f.row().__updateTime});await f.send();assert.equal(f.sent.length,1);assert.equal(f.sent[0].toEmail,'corrected@example.test');assert.equal(f.rows('AppointmentReminders').length,1);assert.equal(old.Snapshot.ToEmail,'patient@example.test');
});
test('closing an uncertain send does not make it eligible for another send',async()=>{
 const f=await fixture();await f.queue();f.s=f.make('reception',{sendConfiguredEmail:async()=>{throw Error('network uncertain');}});await f.send();f.setTime('2026-10-26T12:11:00Z');f.s=f.make('admin');await f.change('confirm-cancelled',{ConfirmProviderReview:true});await assert.rejects(f.queue({ReplaceUnsent:true,Revision:f.row().__updateTime,DueAt:'2026-10-26T12:12:00Z'}),/cannot be scheduled again/);assert.equal(f.sent.length,0);
});
