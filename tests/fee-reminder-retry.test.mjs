import test from 'node:test';
import assert from 'node:assert/strict';
import { processFeeReminderSchedule, invoiceReminderFields } from '../functions/lib/notification-reminders.js';
import { parentPaymentDueNotification } from '../functions/lib/notifications.js';
import { queueNotificationPush } from '../functions/lib/school-announcements.js';
import { runDailyNotifications } from '../scripts/run-daily-notifications.mjs';

const env = { FIREBASE_PROJECT_ID: 'test-project', DYNAMAX_WORKSPACE_ID: 'school' };
const prefix = 'projects/test-project/databases/(default)/documents/invoices/';
const row = (id, extra = {}) => ({ InvoiceId: id, __id: id, __name: prefix + id, __updateTime: 'v1',
  AccountRef: 'LEARNER-1', ParentEmail: 'parent@example.invalid', BranchId: 'main', SchoolSection: 'primary',
  AcademicSession: '2026/2027', Term: 'First Term', Currency: 'NGN', FeeCategory: 'School Fee', FeeCode: id,
  DueDate: '2026-11-10', Balance: 100, Amount: 200, Credit: 100, Status: 'Part Paid',
  ReminderEligible: true, NextReminderDate: '2026-11-10', ...extra });
function harness(rows) {
  const documents = new Map(rows.map(row => [row.__id, structuredClone(row)]));
  const notices = new Map(), jobs = new Map(), queries = [], writes = [];
  const options = { today: '2026-11-10', loadNotificationSettings: async () => ({}),
    queryCollection: async (_env, _collection, query) => {
      queries.push(query);
      let found = [...documents.values()].filter(row => (query.filters || []).every(({ field, op, value }) => {
        if (op === '==') return row[field] === value;
        if (op === '>') return row[field] > value;
        if (op === '>=') return row[field] >= value;
        return row[field] <= value;
      }));
      const field = query.orderBy?.[0]?.field;
      if (field) found.sort((a,b) => a[field].localeCompare(b[field]) || a.__name.localeCompare(b.__name));
      if (query.startAfterName) found = found.filter(row => row[field] > query.startAfterFieldValue
        || row[field] === query.startAfterFieldValue && row.__name > query.startAfterName);
      return structuredClone(found.slice(0, query.limit));
    },
    notifyParentPaymentDue: async (_env, invoice, deliveryOptions) => {
      assert.deepEqual(deliveryOptions, { retryDelivery: false, deliver: false });
      const event = parentPaymentDueNotification(invoice);
      const created = !notices.has(event.EventKey);
      if (created) notices.set(event.EventKey, { ...event, NotificationId: event.EventKey, balance: invoice.Balance });
      return { created, notification: notices.get(event.EventKey) };
    },
    queueNotificationPush: async (_env, notification) => {
      if (!jobs.has(notification.NotificationId)) jobs.set(notification.NotificationId, { Status: 'Pending' });
      return jobs.get(notification.NotificationId);
    },
    batchUpsertDocuments: async (_env, batch) => {
      for (const write of batch) assert.equal(documents.get(write.documentId).__updateTime, write.updateTime);
      for (const write of batch) {
        assert.equal(write.literalDocumentId, true);
        assert.deepEqual(Object.keys(write.data), write.updateMask);
        assert.equal(write.updateMask.some(field => ['Amount','Balance','Credit','Status','AccountRef'].includes(field)), false);
        Object.assign(documents.get(write.documentId), write.data, { __updateTime: 'v2' }); writes.push(write);
      }
    }
  };
  return { documents, notices, jobs, queries, writes, options,
    run: extra => processFeeReminderSchedule(env, { ...options, ...extra }) };
}

test('complete fee total survives page boundaries, stays branch scoped, and retry adds no notifications or writes', async () => {
  const h = harness([row('A'),row('B'),row('C',{ BranchId:'another-branch' })]);
  const first = await h.run({ limit:1 });
  assert.equal(first.created,1); assert.equal([...h.notices.values()][0].balance,200);
  assert.equal(h.writes.length,2); assert.equal(h.documents.get('C').LastReminderStage,undefined);
  let next = first;
  while(next.hasMore) next = await h.run({limit:1,cursor:next.cursor});
  assert.equal(h.notices.size,2); assert.equal(h.jobs.size,2);
  assert.deepEqual(await h.run().then(({created,updated,pushQueued})=>({created,updated,pushQueued})),{created:0,updated:0,pushQueued:0});
  assert.equal(h.documents.get('A').Balance,100); assert.equal(h.documents.get('A').Credit,100);
});

test('overdue retries never send earlier missed stages, including the next day',async()=>{
  const h=harness([row('A',{DueDate:'2026-10-11',SentReminderStages:['overdue-30']})]);
  assert.equal((await h.run()).created,0);
  assert.equal((await h.run({today:'2026-11-11'})).created,0);
  assert.equal(invoiceReminderFields(h.documents.get('A'),{},'2026-11-10').ReminderEligible,false);
  const pending=invoiceReminderFields(row('A',{DueDate:'2026-09-01'}),{},'2026-11-10');
  assert.equal(pending.ReminderEligible,true); assert.equal(pending.NextReminderStage,'overdue-30');
});

test('interrupting metadata commit retains one durable reminder and retries only its metadata',async()=>{
  const h=harness([row('A',{__id:'legacy%2Fid',__name:prefix+'legacy%2Fid'})]);
  await assert.rejects(h.run({batchUpsertDocuments:async()=>{throw Error('Interrupted');}}),/Interrupted/);
  assert.equal(h.notices.size,1); assert.equal(h.jobs.size,1);
  const retry=await h.run(); assert.equal(retry.created,0); assert.equal(retry.duplicates,1);
  assert.equal(h.notices.size,1); assert.equal(h.jobs.size,1); assert.equal(h.writes[0].documentId,'legacy%2Fid');
  assert.equal((await h.run()).updated,0);
});

test('concurrent payment is never overwritten and paid invoices are skipped on retry',async()=>{
  const h=harness([row('A')]); const notify=h.options.notifyParentPaymentDue;
  await assert.rejects(h.run({notifyParentPaymentDue:async(...args)=>{
    const result=await notify(...args); Object.assign(h.documents.get('A'),{__updateTime:'paid',Balance:0,Credit:200,Status:'Paid'}); return result;
  }}));
  assert.equal(h.documents.get('A').Balance,0); assert.equal(h.documents.get('A').Credit,200);
  assert.equal((await h.run()).created,0); assert.equal(h.writes.length,0);
});

test('optional charges never merge into the school-fee reminder',async()=>{
  const h=harness([row('A'),row('B',{FeeCategory:'Club',FeeCode:'CHESS',FeeName:'Chess'})]);
  assert.equal((await h.run()).created,2);
  assert.deepEqual([...h.notices.values()].map(row=>row.balance),[100,100]);
});

test('blank scheduled dates are excluded; foreign cursors and oversized accounts cannot send partial totals',async()=>{
  const h=harness([row('A')]); await h.run();
  assert.ok(h.queries[0].filters.some(f=>f.field==='NextReminderDate'&&f.op==='>'&&f.value===''));
  await assert.rejects(h.run({cursor:{scheduled:{afterName:'projects/foreign/databases/(default)/documents/invoices/A',afterValue:'2026-11-10'}}}),/cursor/);
  const large=harness(Array.from({length:501},(_,i)=>row(String(i))));
  await assert.rejects(large.run(),/bounded review limit/); assert.equal(large.notices.size,0);
});

test('generic queue uses deterministic create-only jobs and does not reset completed delivery progress',async()=>{
  const records=new Map(); const createDocumentIfAbsent=async(_env,collection,id,data)=>{
    assert.equal(collection,'notificationAnnouncementPushJobs');
    const created=!records.has(id); if(created)records.set(id,data); return {created,document:records.get(id)};
  };
  const notification={NotificationId:'same-event'};
  const first=await queueNotificationPush(env,notification,{createDocumentIfAbsent}); first.Status='Completed'; first.Offset=2;
  const again=await queueNotificationPush(env,notification,{createDocumentIfAbsent});
  assert.equal(records.size,1); assert.equal(again.Status,'Completed'); assert.equal(again.Offset,2);
});

const workflowEnv={SCHEDULER_MODE:'reminders',ENDPOINT:'https://school.example.invalid/api/notification-scheduler',
 SCHEDULER_SECRET:'private',EXPECTED_WORKSPACE_ID:'school',EXPECTED_EDITION:'school',PROCESS_DATE:'2026-11-10'};
test('daily runner forwards cursors and validates tenant without exposing response identities',async()=>{
 const bodies=[],logs=[]; const result=await runDailyNotifications(workflowEnv,{log:row=>logs.push(row),fetch:async(_url,init)=>{
  bodies.push(JSON.parse(init.body)); return Response.json({ok:true,workspaceId:'school',edition:'school',private:'parent@example.invalid',
    reminders:{created:bodies.length===1?1:0,hasMore:bodies.length===1,cursor:{legacy:{done:true},scheduled:{afterName:'next'}}}});
 }});
 assert.equal(result.pages,2); assert.equal(result.created,1); assert.equal(bodies[0].feeRemindersOnly,true);
 assert.deepEqual(bodies[1].reminderCursor,{legacy:{done:true},scheduled:{afterName:'next'}});
 assert.doesNotMatch(logs.join(''),/private|parent@example/);
});
test('daily runner surfaces sanitized failure and never hides or blindly retries authorization failures',async()=>{
 const logs=[];let requests=0;
 await assert.rejects(runDailyNotifications(workflowEnv,{log:row=>logs.push(row),fetch:async()=>{
  requests++;return Response.json({ok:false,message:'secret parent@example.invalid',diagnostic:{stage:'authorization',issue:'STAGE_FAILED'}},{status:401});
 }}),/HTTP 401/);
 assert.equal(requests,1); assert.doesNotMatch(logs.join(''),/secret|parent@example/);
});
