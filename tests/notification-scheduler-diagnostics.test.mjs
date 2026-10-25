import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { notificationSchedulerDiagnostic } from '../functions/lib/notification-scheduler-diagnostics.js';

const source = await readFile(new URL('../functions/api/notification-scheduler.js', import.meta.url), 'utf8');
const stages = [
  ['processDueSchoolFeeCredits', 'school-fee-credits'], ['processFeeReminderSchedule', 'fee-reminders'],
  ['processLibraryDueReminders', 'library-reminders'], ['processScheduledSchoolAnnouncements', 'school-announcements'],
  ['processScheduledChurchAnnouncements', 'organisation-announcements'], ['processSchoolAnnouncementPushQueue', 'announcement-push-queue'],
  ['processAttendancePresenceNotifications', 'attendance-presence'], ['retryFailedPushDeliveries', 'push-delivery-retries'],
  ['processAcademicCbtPaperRetention', 'cbt-paper-retention']
];
function harness(failing, edition = 'school', body = {}, resultOverrides = {}) {
  const calls = [], logs = [];
  const error = Object.assign(new Error('Database request failed (400)'), {status:400,
    data:[{error:{status:'FAILED_PRECONDITION',message:'The query requires an index. secret@example.com sk_live_private'}}]});
  const mocks = Object.fromEntries(stages.map(([name]) => [name, async () => {
    calls.push(name); if (failing === name) throw error; return resultOverrides[name] || {};
  }]));
  const {onRequestPost} = vm.runInNewContext(`${source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/\bexport\s+/g,'')}\n({onRequestPost})`, {
    ...mocks, Response, notificationSchedulerDiagnostic, console:{error:value=>logs.push(value)},
    secureTextEqual:(a,b)=>a===b, readJsonBody:async()=>body,
    requiredDeploymentIdentity:()=>({edition,workspaceId:'synthetic'})
  });
  const data = {};
  return {calls,logs,data,run:(authorized=true)=>onRequestPost({data,env:{NOTIFICATION_SCHEDULER_SECRET:'test-secret'},
    request:new Request('https://example.invalid/api/notification-scheduler',{method:'POST',headers:{Authorization:authorized?'Bearer test-secret':'Bearer wrong'}})})};
}

test('array and object Firestore errors produce useful classifications without private payloads',()=>{
  for (const status of ['FAILED_PRECONDITION','INVALID_ARGUMENT','PERMISSION_DENIED','UNAUTHENTICATED',
    'RESOURCE_EXHAUSTED','NOT_FOUND','ABORTED','ALREADY_EXISTS','UNAVAILABLE','DEADLINE_EXCEEDED','INTERNAL']) {
    for (const array of [true,false]) {
      const payload={error:{status,message:'Private document path /students/person and parent@example.com sk_live_private'}};
      const result=notificationSchedulerDiagnostic('fee-reminders',{data:array?[payload]:payload});
      assert.equal(result.databaseCode,status);
      assert.doesNotMatch(JSON.stringify(result),/students|person|example\.com|sk_live_private/);
    }
  }
  const unknown=notificationSchedulerDiagnostic('fee-reminders',{message:'password=private',data:[{error:{status:'private',message:'private'}}]});
  assert.equal(unknown.databaseCode,undefined);
  assert.doesNotMatch(JSON.stringify(unknown),/password=private|"private"/);
});

test('each failed stage is identified in HTTP response and logs without retrying or running later stages',async()=>{
  for (const [name,stage] of stages) {
    const harnessCase=harness(name,name==='processScheduledChurchAnnouncements'?'faith':'school');
    const response=await harnessCase.run();
    assert.equal(response.status,400);
    const body=await response.json();
    assert.equal(body.diagnostic.stage,stage);
    assert.equal(body.diagnostic.issue,'DATABASE_INDEX');
    assert.equal(body.diagnostic.databaseCode,'FAILED_PRECONDITION');
    assert.equal(harnessCase.calls.at(-1),name);
    assert.equal(harnessCase.calls.filter(value=>value===name).length,1);
    assert.equal(harnessCase.logs.length,1);
    assert.doesNotMatch(JSON.stringify([body,harnessCase.logs]),/secret@example|sk_live_private|test-secret/);
  }
});

test('unauthorized calls expose no diagnostic details and cannot execute a stage',async()=>{
  const h=harness('processFeeReminderSchedule');
  const response=await h.run(false);
  assert.equal(response.status,401);
  assert.equal((await response.json()).diagnostic,undefined);
  assert.equal(h.calls.length,0);
  assert.equal(h.logs.length,0);
});

test('successful scheduled processing retains its existing results and emits no failure diagnostics',async()=>{
  const h=harness();
  const response=await h.run();
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(body.diagnostic,undefined);
  assert.equal(h.logs.length,0);
});


test('announcement-only runs never execute paper deletion or unrelated financial processing', async () => {
  const h = harness('processAcademicCbtPaperRetention', 'school', {announcementsOnly:true});
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cbtPaperCleanup.skipped, true);
  assert.deepEqual(h.calls, ['processScheduledSchoolAnnouncements', 'processSchoolAnnouncementPushQueue']);
});


test('empty scheduler polls do not write audit noise, but deliveries, work and failures remain', async()=>{
 const empty=harness();await empty.run();assert.equal(empty.data.securityAuditHandled,true);
 for(const [name,result] of [['processFeeReminderSchedule',{created:1}],['processSchoolAnnouncementPushQueue',{delivered:2}],
   ['processDueSchoolFeeCredits',{creditedInvoices:1}],['processAcademicCbtPaperRetention',{completed:1}],
   ['processScheduledSchoolAnnouncements',{failed:1}]]){
   const h=harness(null,'school',{}, {[name]:result});await h.run();assert.notEqual(h.data.securityAuditHandled,true,name);
 }
 const failed=harness('processFeeReminderSchedule');await failed.run();assert.notEqual(failed.data.securityAuditHandled,true);
});

test('reported delivery failures cannot be returned as successful scheduler runs', async()=>{
  for (const [name, result] of [
    ['processScheduledSchoolAnnouncements', {sent:2,failed:1}],
    ['processSchoolAnnouncementPushQueue', {delivered:2,failed:1}],
    ['processAttendancePresenceNotifications', {ok:false}],
    ['retryFailedPushDeliveries', {retried:3,delivered:2}]
  ]) {
    const h=harness(null,'school',{}, {[name]:result});
    const response=await h.run();
    const body=await response.json();
    assert.equal(response.status,500,name);
    assert.equal(body.ok,false,name);
    assert.match(body.message,/notification deliveries failed/);
    assert.equal(h.data.securityAuditOutcome,'Failed');
    assert.notEqual(h.data.securityAuditHandled,true);
    assert.equal(h.calls.filter(value=>value===name).length,1);
  }
});
