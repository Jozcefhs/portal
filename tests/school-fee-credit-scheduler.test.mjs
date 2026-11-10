import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { runSchoolFeeCreditSchedule } from '../functions/lib/school-fee-credit-scheduler.js';
import { listSchoolFeeCreditCandidates } from '../functions/lib/school-fee-credit-scope.js';

const today = '2026-11-10';
const managed = (id, branchId = 'main', changes = {}) => ({ __id: id, __name: `accountSummaries/${id}`, __updateTime: 'v1',
  AccountRef: 'DCA/26/001', BranchId: branchId, SchoolSection: 'primary', SchoolFeeCreditManaged: true,
  PendingSchoolFeeCredit: 100, CreditBalance: 0, NextSchoolFeeCreditDueDate: today, ...changes });
function fixture(rows = []) {
  let state = null, revision = 0, failCheckpoint = false;
  const reads = [], writes = [], applications = [], settled = new Set();
  const queryCollection = async (_env, collection, options) => {
    reads.push({ collection, options });
    const field = options.filters[0].field;
    return rows.filter(row => Number(row[field]) > 0).sort((a, b) => Number(a[field]) - Number(b[field]) || a.__name.localeCompare(b.__name))
      .filter(row => !options.startAfterName || Number(row[field]) > options.startAfterFieldValue
        || Number(row[field]) === options.startAfterFieldValue && row.__name > options.startAfterName).slice(0, options.limit);
  };
  const deps = {
    getDocument: async (_env, collection, id) => { reads.push({ collection, id }); return collection === 'settings'
      ? structuredClone(state) : structuredClone(rows.find(row => row.__id === id) || null); }, queryCollection,
    listSchoolFeeCreditCandidates: (env, options) => listSchoolFeeCreditCandidates(env, options, { queryCollection }),
    applyManagedSchoolFeeCreditForAccount: async (_env, row, options) => {
      applications.push({ row, options });
      if (settled.has(row.__id)) return { allocations: [] };
      settled.add(row.__id); return { allocations: [{ applied: 100 }] };
    },
    applyLegacySchoolFeeCreditCandidate: async () => ({ allocations: [], deferred: true }),
    batchCommitDocuments: async (_env, batch) => {
      if (failCheckpoint) { failCheckpoint = false; throw new Error('Checkpoint conflict'); }
      const row = batch[0];
      if (state && row.updateTime !== state.__updateTime) throw new Error('Checkpoint version changed');
      writes.push(structuredClone(batch)); state = { ...structuredClone(row.data), __updateTime: `v${++revision}` };
    }
  };
  return { deps, rows, reads, writes, applications, settled, state: () => state,
    checkpointConflict: () => { failCheckpoint = true; }, run: (limit = 2, date = today) => runSchoolFeeCreditSchedule({}, { today: date, limit }, deps) };
}

test('managed schedule paginates the single-field queue and preserves branch identity for matching admission numbers', async () => {
  const f = fixture([managed('a'), managed('b', 'area-1-primary'), managed('c', 'garden', { SchoolFeeCreditReviewRequired: true }),
    managed('d', 'main', { NextSchoolFeeCreditDueDate: '2027-01-01' }), managed('e', 'main', { NextSchoolFeeCreditDueDate: '' })]);
  let last; for (let index = 0; index < 8; index++) { last = await f.run(); if (!last.hasMore) break; }
  assert.equal(last.hasMore, false); assert.equal(f.applications.length, 2);
  assert.deepEqual(f.applications.map(call => call.row.BranchId), ['main', 'area-1-primary']);
  assert.equal(f.applications[0].options.summary.__id, 'a');
  const queueReads = f.reads.filter(row => row.options?.filters[0].field === 'PendingSchoolFeeCredit');
  assert.equal(queueReads.length, 3); assert.equal(queueReads[1].options.startAfterName, 'accountSummaries/b');
  assert.equal(queueReads[0].options.filters.length, 1);
  const count = f.writes.length; f.reads.length = 0;
  const repeated = await f.run(); assert.equal(repeated.skipped, true); assert.equal(f.writes.length, count);
  assert.deepEqual(f.reads, [{ collection: 'settings', id: 'schoolFeeCreditScheduler' }]);
});

test('future credits are reconsidered on their due date and completed same-day retries perform no writes', async () => {
  const f = fixture([managed('future', 'main', { NextSchoolFeeCreditDueDate: '2026-11-11' })]);
  await f.run(); await f.run(); assert.equal(f.applications.length, 0);
  await f.run(2, '2026-11-11'); assert.equal(f.applications.length, 1);
  await f.run(2, '2026-11-11');
  const count = f.writes.length; await f.run(2, '2026-11-11'); assert.equal(f.writes.length, count);
});

test('one failed account does not block later candidates and its point-read retry cannot duplicate completed allocations', async () => {
  const f = fixture([managed('a'), managed('b'), managed('c')]);
  const apply = f.deps.applyManagedSchoolFeeCreditForAccount; let rejected = false;
  f.deps.applyManagedSchoolFeeCreditForAccount = async (...args) => {
    if (args[1].__id === 'a' && !rejected) { rejected = true; throw new Error('Concurrent account update'); }
    return apply(...args);
  };
  await f.run(); await f.run(); await f.run();
  assert.equal(f.state().Phase, 'retry'); assert.deepEqual(f.state().RetryCandidates, [{ id: 'a', kind: 'managed' }]);
  const last = await f.run(); assert.equal(last.hasMore, false); assert.equal(last.ok, true);
  assert.equal(f.settled.size, 3); assert.equal(f.applications.filter(call => call.row.__id === 'b').length, 1);
  assert.ok(f.reads.some(row => row.collection === 'accountSummaries' && row.id === 'a'));
});

test('lost scheduler checkpoint retries safe account allocation and retains financial idempotency', async () => {
  const f = fixture([managed('a')]); f.checkpointConflict();
  await assert.rejects(f.run(), /Checkpoint conflict/); assert.equal(f.settled.size, 1);
  const retry = await f.run(); assert.equal(retry.creditedInvoices, 0); assert.equal(f.settled.size, 1);
});

test('legacy scheduler dispatch supplies verified branch and section to every financial query path', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function applyLegacySchoolFeeCreditCandidate('), end = source.indexOf('\nexport function isStandaloneAcceptanceInvoiceForPayment', start);
  const calls = [];
  const fn = vm.runInNewContext(`${source.slice(start, end)}\napplyLegacySchoolFeeCreditCandidate`, {
    clean: value => String(value ?? '').trim(),
    schoolFeeCreditScope: row => ({ accountRef: row.AccountRef, branchId: row.BranchId, schoolSectionAccess: row.SchoolSection,
      references: [row.AccountRef], scopePath: row.__scopePath }),
    findStudentByAccountRef: async (_env, ref, scope) => { calls.push(scope); return { __id: 'child', __scopePath: 'schoolBranches/area-1-primary/sections/primary/students', AdmissionNo: ref }; },
    readManagedSchoolFeeCreditSummary: async () => ({ summary: null }),
    applyDueSchoolFeeCreditsForAccount: async (...args) => { calls.push(args.at(-1)); return { allocations: [] }; }
  });
  assert.equal((await fn({}, { AccountRef: 'DCA/26/001' }, { today })).deferred, true); assert.equal(calls.length, 0);
  await fn({}, { AccountRef: 'DCA/26/001', BranchId: 'area-1-primary', SchoolSection: 'primary' }, { today });
  assert.equal(calls.length, 2); for (const call of calls) { assert.equal(call.branchId, 'area-1-primary'); assert.equal(call.schoolSectionAccess, 'primary'); assert.equal(call.strictReads, true); }
  assert.match(source, /return runSchoolFeeCreditSchedule\(env/);
});

test('credit-only continuation invokes no notification deliveries or unrelated scans', async () => {
  const source = await readFile(new URL('../functions/api/notification-scheduler.js', import.meta.url), 'utf8');
  const forbidden = () => assert.fail('Credit continuation must not send notifications');
  let calls = 0;
  const handler = vm.runInNewContext(`${source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '')}\nonRequestPost`, {
    Response, secureTextEqual: (a, b) => a === b, readJsonBody: request => request.json(),
    requiredDeploymentIdentity: () => ({ edition: 'school', workspaceId: 'school' }),
    processDueSchoolFeeCredits: async () => { calls++; return { ok: true, hasMore: true, creditedInvoices: 0 }; },
    processFeeReminderSchedule: forbidden, processLibraryDueReminders: forbidden, processScheduledSchoolAnnouncements: forbidden,
    processScheduledChurchAnnouncements: forbidden, processSchoolAnnouncementPushQueue: forbidden,
    processAttendancePresenceNotifications: forbidden, retryFailedPushDeliveries: forbidden, processAcademicCbtPaperRetention: forbidden
  });
  const response = await handler({ env: { NOTIFICATION_SCHEDULER_SECRET: 'test' }, data: {},
    request: new Request('https://school.invalid/api/notification-scheduler', { method: 'POST',
      headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ schoolFeeCreditsOnly: true }) }) });
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal((await response.json()).schoolFeeCredits.hasMore, true);
  const workflow = await readFile(new URL('../.github/workflows/notification-reminders.yml', import.meta.url), 'utf8');
  const runner = await readFile(new URL('../scripts/run-daily-notifications.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /SCHEDULER_MODE: credits/); assert.match(runner, /schoolFeeCreditsOnly/); assert.match(runner, /hasMore/);
});

test('daily workflow completes every credit page before starting unrelated reminders', async () => {
  const workflow = await readFile(new URL('../.github/workflows/notification-reminders.yml', import.meta.url), 'utf8');
  const creditStep = workflow.indexOf('- name: Process school-fee credits');
  const reminderStep = workflow.indexOf('- name: Process fee reminders');
  assert.ok(creditStep >= 0 && reminderStep > creditStep);
  const credits = workflow.slice(creditStep, reminderStep);
  const reminders = workflow.slice(reminderStep);
  assert.match(credits, /SCHEDULER_MODE: credits/);
  assert.match(credits, /run-daily-notifications.mjs/);
  assert.match(reminders, /SCHEDULER_MODE: reminders/);
  assert.match(reminders, /SCHEDULER_MODE: maintenance/);
  assert.match(workflow, /githubEnvironment/);
  assert.match(workflow, /EXPECTED_WORKSPACE_ID/);
  assert.doesNotMatch(workflow, /secrets.NOTIFICATION_SCHEDULER_URL/);
});
