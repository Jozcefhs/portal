import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadCompleteSecurityAudit } from '../js/security-audit-workspace.js';
import { normalizedLegacyAudit } from '../functions/lib/security-audit.js';
import { branchRecordVisible } from '../functions/lib/branch-scope.js';
import { secureTextEqual } from '../functions/lib/backend-security.js';

const auditSource = await readFile(new URL('../functions/lib/security-audit.js', import.meta.url), 'utf8');
const endpointSource = await readFile(new URL('../functions/api/security-audit.js', import.meta.url), 'utf8');
const schedulerSource = await readFile(new URL('../functions/api/notification-scheduler.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const scope = { fromDate: '2026-09-01', toDate: '2026-10-04' };
const env = { FIREBASE_PROJECT_ID: 'test', FIREBASE_CLIENT_EMAIL: 'test@example.test', FIREBASE_PRIVATE_KEY: 'mock' };
const timestamp = '2026-10-03T12:00:00.000Z';
const name = (collection, id) => `projects/test/databases/(default)/documents/${collection}/${id}`;
const row = (collection, id, extra = {}) => ({ __id: id, __name: name(collection, id), Timestamp: timestamp,
  Action: 'APPROVE BILL', Method: 'POST', HttpStatus: 200, BranchId: 'main', ...extra });
const isolated = (source, exports, mocks) => vm.runInNewContext(
  `${source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '')}\n;({${exports.join(',')}})`,
  { Response, Request, crypto, console: { warn() {} }, ...mocks });
const auditModule = (queryCollection = async () => [], mocks = {}) => isolated(auditSource,
  ['loadAggregatedSecurityAudit', 'persistRequestSecurityAudit', 'writeSecurityAudit'],
  { queryCollection, readStaffSession: async () => null, upsertDocument: async () => {}, ...mocks });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('all sources page beyond the old limit, including an entirely hidden first batch and equal timestamps', async () => {
  const platform = Array.from({ length: 360 }, (_, i) => row('platformSecurityAudit', `p-${String(i).padStart(4, '0')}`,
    i < 300 ? { Action: 'LIST DESKTOP PAIRING', Route: '/api/desktop-pairing' } : {}));
  const identity = Array.from({ length: 610 }, (_, i) => row('staffSecurityAudit', `u-${String(i).padStart(4, '0')}`, { Action: 'LOGIN' }));
  const calls = [];
  const module = auditModule(async (_env, collection, options) => {
    calls.push({ collection, options });
    const records = collection === 'platformSecurityAudit' ? platform : collection === 'staffSecurityAudit' ? identity : [];
    const start = options.startAfterName ? records.findIndex((item) => item.__name === options.startAfterName) + 1 : 0;
    return records.slice(start, start + options.limit);
  });
  let cursor;
  const rows = [];
  const readTimes = new Set();
  let batches = 0;
  while (true) {
    const batch = await module.loadAggregatedSecurityAudit(env, { ...scope, paged: true, perSourceLimit: 300, batchCursor: cursor });
    batches++;
    readTimes.add(batch.readTime);
    rows.push(...batch.rows);
    assert.equal(batch.warnings.length, 0);
    if (batches === 1) assert.equal(batch.rows.some((item) => item.SourceCollection === 'platformSecurityAudit'), false);
    if (batch.done) break;
    cursor = batch.nextCursor;
  }
  assert.equal(batches, 3);
  assert.equal(rows.length, 670);
  assert.equal(new Set(rows.map((item) => `${item.SourceCollection}/${item.AuditId}`)).size, 670);
  assert.equal(readTimes.size, 1);
  assert.equal(calls.filter((item) => item.collection === 'hrAudit').length, 1);
  const continuation = calls.find((item) => item.options.startAfterName);
  assert.equal(continuation.options.startAfterFieldValue, timestamp);
  assert.deepEqual(plain(continuation.options.orderBy), [{ field: 'Timestamp', direction: 'DESCENDING' }, { field: '__name__', direction: 'DESCENDING' }]);
});

test('an exact full batch probes for the next page rather than emitting a false source-limit warning', async () => {
  const records = Array.from({ length: 300 }, (_, i) => row('staffSecurityAudit', `id-${i}`));
  const module = auditModule(async (_env, collection, options) => collection === 'staffSecurityAudit' && !options.startAfterName ? records : []);
  const first = await module.loadAggregatedSecurityAudit(env, { ...scope, paged: true, perSourceLimit: 300 });
  assert.equal(first.done, false);
  const second = await module.loadAggregatedSecurityAudit(env, { ...scope, paged: true, perSourceLimit: 300, batchCursor: first.nextCursor });
  assert.equal(second.done, true);
  assert.equal(second.rows.length, 0);
  assert.equal(second.warnings.length, 0);
});

test('cursor validation rejects cross-project, cross-collection, changed period, missing sources and expired snapshots before reading', async () => {
  const module = auditModule(async () => { throw new Error('Should not query'); });
  const initial = await auditModule(async (_env, collection) => collection === 'staffSecurityAudit'
    ? Array.from({ length: 50 }, (_, i) => row(collection, `id-${i}`)) : []).loadAggregatedSecurityAudit(env, { ...scope, paged: true, perSourceLimit: 50 });
  for (const mutate of [
    (cursor) => { cursor.fromDate = '2026-08-01'; },
    (cursor) => { cursor.readTime = '2020-01-01T00:00:00Z'; },
    (cursor) => { cursor.readTime = '2099-01-01T00:00:00Z'; },
    (cursor) => { delete cursor.sources.hrAudit; },
    (cursor) => { cursor.sources.staffSecurityAudit.name = name('accountingAudit', 'id'); },
    (cursor) => { cursor.sources.staffSecurityAudit.name = 'projects/other/databases/(default)/documents/staffSecurityAudit/id'; },
    (cursor) => { cursor.sources.staffSecurityAudit.timestamp = '2026-08-01T00:00:00Z'; }
  ]) {
    const cursor = plain(initial.nextCursor);
    mutate(cursor);
    await assert.rejects(module.loadAggregatedSecurityAudit(env, { ...scope, paged: true, batchCursor: cursor }), /cursor is invalid or expired/);
  }
});

test('failed sources and stalled cursors never claim completeness', async () => {
  const failed = await auditModule(async () => { throw new Error('offline'); }).loadAggregatedSecurityAudit(env, { ...scope, paged: true });
  assert.equal(failed.done, false);
  assert.equal(failed.warnings.length, 7);
  const stalled = await auditModule(async () => Array.from({ length: 300 }, () => ({ Timestamp: timestamp })))
    .loadAggregatedSecurityAudit(env, { ...scope, paged: true, perSourceLimit: 300 });
  assert.equal(stalled.done, false);
  assert.equal(stalled.warnings.length, 7);
});

test('paged endpoint retains every batch record past display limits and reapplies branch authorization on continuation', async () => {
  const records = Array.from({ length: 1100 }, (_, i) => ({ AuditId: `id-${i}`, SourceCollection: 'staffSecurityAudit',
    Action: 'LOGIN', ActorUsername: 'admin', BranchId: i % 2 ? 'east' : 'main', Timestamp: timestamp }));
  let actor = { role: 'Super Admin', branchId: 'main' };
  const module = isolated(endpointSource, ['onRequestPost'], {
    requireFirestoreEnv() {}, requireStaffSession: async () => actor, branchRecordVisible,
    readJsonBody: (request) => request.json(),
    loadAggregatedSecurityAudit: async () => ({ rows: records, warnings: [], paged: true, done: true,
      nextCursor: null, readTime: timestamp, scanned: 1100 })
  });
  const request = () => new Request('https://example.test/api/security-audit', { method: 'POST', body: JSON.stringify({ ...scope, paged: true, limit: 50 }) });
  let response = await module.onRequestPost({ env, request: request() });
  const result = await response.json();
  assert.equal(result.rows.length, 550);
  assert.ok(result.rows.every((item) => item.BranchId === 'main'));
  assert.deepEqual(result.facets.branches, ['main']);
  actor = { role: 'Teacher', allowedSections: [] };
  response = await module.onRequestPost({ env, request: request() });
  assert.equal(response.status, 403);
});

test('client merges all batches and facets, deduplicates by collection and never publishes intermediate totals', async () => {
  const progress = [];
  let calls = 0;
  const cursor = { ...scope, readTime: timestamp, sources: { next: 'x' } };
  const record = (collection, id) => ({ AuditId: id, SourceCollection: collection, Timestamp: timestamp });
  const result = await loadCompleteSecurityAudit(async (action, payload) => {
    assert.equal(action, 'list');
    assert.equal(payload.paged, true);
    calls++;
    if (calls === 2) assert.deepEqual(payload.batchCursor, cursor);
    return { ...scope, paged: true, readTime: timestamp, scanned: 300, warnings: [],
      rows: calls === 1 ? [record('staffSecurityAudit', 'one')] : [record('staffSecurityAudit', 'one'), record('platformSecurityAudit', 'one')],
      facets: { users: calls === 1 ? ['admin'] : ['admin', 'teacher'] }, done: calls === 2, nextCursor: calls === 1 ? cursor : null };
  }, scope, (value) => progress.push(value));
  assert.equal(result.totalMatches, 2);
  assert.equal(result.complete, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.facets.users, ['admin', 'teacher']);
  assert.deepEqual(progress, [{ scanned: 300, loaded: 1 }, { scanned: 600, loaded: 2 }]);
});

test('client rejects warnings, old servers, changed snapshots, stalled cursors and cancellation', async () => {
  const cursor = { ...scope, readTime: timestamp, sources: {} };
  const base = { ...scope, paged: true, readTime: timestamp, rows: [], facets: {}, warnings: [], done: false, nextCursor: cursor };
  for (const payload of [{ ...base, warnings: ['Source unavailable'] }, { ...base, paged: false },
    { ...base, fromDate: '2026-08-01' }, { ...base, nextCursor: null }, { ...base, done: true }]) {
    await assert.rejects(loadCompleteSecurityAudit(async () => payload, scope));
  }
  await assert.rejects(loadCompleteSecurityAudit(async () => base, scope), /cursor did not advance/);
  let calls = 0;
  await assert.rejects(loadCompleteSecurityAudit(async () => (++calls === 1 ? base : { ...base, readTime: 'different' }), scope), /snapshot changed/);
  let current = true;
  const result = await loadCompleteSecurityAudit(async () => { current = false; return base; }, scope, () => assert.fail('Cancelled progress'), () => current);
  assert.equal(result, null);
});

test('scheduler identity is set only after secret authorization and propagated without leaking credentials', async () => {
  const process = async () => ({});
  const scheduler = isolated(schedulerSource, ['onRequestPost'], { secureTextEqual, readJsonBody: (request) => request.json(),
    requiredDeploymentIdentity: () => ({ workspaceId: 'test', edition: 'school' }),
    processDueSchoolFeeCredits: process, processFeeReminderSchedule: process, processLibraryDueReminders: process,
    processScheduledSchoolAnnouncements: process, processScheduledChurchAnnouncements: process,
    processSchoolAnnouncementPushQueue: process, processAttendancePresenceNotifications: process, retryFailedPushDeliveries: process });
  const context = (secret) => ({ env: { NOTIFICATION_SCHEDULER_SECRET: 'test-secret' }, data: {},
    request: new Request('https://example.test/api/notification-scheduler', { method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: '{}' }) });
  const denied = context('wrong');
  assert.equal((await scheduler.onRequestPost(denied)).status, 401);
  assert.equal(denied.data.securityAuditActor, undefined);
  const verified = context('test-secret');
  assert.equal((await scheduler.onRequestPost(verified)).status, 200);
  assert.equal(verified.data.securityAuditActor.role, 'System');
  assert.equal(verified.data.securityAuditAction, 'RUN NOTIFICATION SCHEDULER');
  assert.equal(verified.data.securityAuditActivityClass, 'Routine system');
  let written;
  const audit = auditModule(undefined, { upsertDocument: async (_env, _collection, _id, value) => { written = value; },
    readStaffSession: async () => assert.fail('A verified service should not need a staff session') });
  await audit.persistRequestSecurityAudit({ env, request: verified.request, prepared: { pathname: '/api/notification-scheduler',
    method: 'POST', action: 'SUBMIT TO NOTIFICATION SCHEDULER', sourcePlatform: 'Web' },
  authoritativeActor: verified.data.securityAuditActor, authoritativeAction: verified.data.securityAuditAction,
  authoritativeActivityClass: verified.data.securityAuditActivityClass,
  authoritativeOutcome: verified.data.securityAuditOutcome, authoritativeDetails: verified.data.securityAuditDetails,
  response: { status: 200 } });
  assert.equal(written.Actor, 'System — Notification Scheduler');
  assert.equal(written.ActorRole, 'System');
  assert.equal(written.SourcePlatform, 'System');
  assert.equal(written.Module, 'Notifications');
  assert.equal(written.ActivityClass, 'Routine system');
  assert.doesNotMatch(JSON.stringify(written), /test-secret/);
});

test('scheduler financial postings and internal delivery failures remain non-routine', async () => {
  for (const [creditResult, deliveryResult, expectedOutcome] of [
    [{ creditedInvoices: 2 }, {}, 'Success'],
    [{ ok: false, failed: 1 }, {}, 'Failed'],
    [{}, { failed: 1 }, 'Failed']
  ]) {
    const process = async () => ({});
    const module = isolated(schedulerSource, ['onRequestPost'], { secureTextEqual, readJsonBody: (request) => request.json(),
      requiredDeploymentIdentity: () => ({ workspaceId: 'test', edition: 'school' }),
      processDueSchoolFeeCredits: async () => creditResult, processFeeReminderSchedule: process, processLibraryDueReminders: process,
      processScheduledSchoolAnnouncements: async () => deliveryResult, processScheduledChurchAnnouncements: process,
      processSchoolAnnouncementPushQueue: process, processAttendancePresenceNotifications: process, retryFailedPushDeliveries: process });
    const context = { env: { NOTIFICATION_SCHEDULER_SECRET: 'test-secret' }, data: {},
      request: new Request('https://example.test/api/notification-scheduler', { method: 'POST',
        headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' }, body: '{}' }) };
    await module.onRequestPost(context);
    assert.equal(context.data.securityAuditActivityClass, 'System activity');
    assert.equal(context.data.securityAuditOutcome, expectedOutcome);
  }
});

test('routine system successes are hidden only by a display filter, with failures, financial actions and unclassified history visible', () => {
  const routine = { AuditId: 'routine', ActivityClass: 'Routine system', ActorRole: 'System',
    ActorUsername: 'system:notification-scheduler', Route: '/api/notification-scheduler', Outcome: 'Success', HttpStatus: 200 };
  const rows = [routine, { ...routine, AuditId: 'failed', Outcome: 'Failed' },
    { ...routine, AuditId: 'denied', HttpStatus: 401 }, { ...routine, AuditId: 'financial', ActivityClass: 'System activity' },
    { ...routine, AuditId: 'historical', ActorRole: 'Identity not recorded', ActivityClass: '' },
    { ...routine, AuditId: 'unverified', ActorUsername: 'external' }];
  const context = vm.createContext({ securityAuditData: { rows, filters: {} },
    clean: (value) => String(value ?? '').trim(), lower: (value) => String(value ?? '').trim().toLowerCase() });
  vm.runInContext(adminSource.slice(adminSource.indexOf('function securityAuditFilteredRows('), adminSource.indexOf('function securityAuditDateTime(')), context);
  assert.equal(vm.runInContext('securityAuditFilteredRows().length', context), 5);
  assert.equal(rows.length, 6);
  vm.runInContext('securityAuditData.filters.includeRoutineSystem = true', context);
  assert.equal(vm.runInContext('securityAuditFilteredRows().length', context), 6);
});

test('unidentified requests are not called staff or trusted system users; historical records are not rewritten', async () => {
  const record = { Actor: 'External user', ActorUsername: 'external', ActorRole: 'External',
    Route: '/api/notification-scheduler', Action: 'SUBMIT TO NOTIFICATION SCHEDULER', HttpStatus: 200 };
  const normalized = normalizedLegacyAudit(record, { collection: 'platformSecurityAudit' });
  assert.match(normalized.Actor, /historical identity not recorded/);
  assert.equal(normalized.ActorRole, 'Identity not recorded');
  assert.equal(record.Actor, 'External user');
  assert.equal(normalizedLegacyAudit({ ...record, Route: '/api/desktop-pairing', HttpStatus: 401 }, { collection: 'platformSecurityAudit' }).Actor, 'Unidentified request');
  let written;
  await auditModule(undefined, { upsertDocument: async (_env, _collection, _id, value) => { written = value; } })
    .writeSecurityAudit(env, { action: 'DENIED REQUEST', outcome: 'Denied', status: 401 });
  assert.equal(written.Actor, 'Unidentified request');
  assert.equal(written.ActorRole, 'Unidentified');
});

test('table pagination bounds rendering but preserves the full filtered count', () => {
  const nodes = new Map();
  for (const key of ['[data-security-audit-rows]', '[data-security-audit-count]', '[data-security-audit-page]']) nodes.set(key, {});
  const controls = { securityAuditPrevious: {}, securityAuditNext: {} };
  const rows = Array.from({ length: 600 }, (_, i) => ({ AuditId: i }));
  const context = vm.createContext({ activeSection: 'securityAudit', securityAuditData: { page: 1, complete: true },
    securityAuditFilteredRows: () => rows, securityAuditRowsHtml: (items) => JSON.stringify(items),
    panelEl: { querySelector: (key) => nodes.get(key) }, document: { getElementById: (id) => controls[id] }, renderModuleSummary() {} });
  vm.runInContext(adminSource.slice(adminSource.indexOf('function updateSecurityAuditTable('), adminSource.indexOf('function renderSecurityAudit(')), context);
  vm.runInContext('updateSecurityAuditTable()', context);
  const rendered = JSON.parse(nodes.get('[data-security-audit-rows]').innerHTML);
  assert.equal(rendered.length, 250);
  assert.equal(rendered[0].AuditId, 250);
  assert.equal(nodes.get('[data-security-audit-count]').textContent, '600 matching actions');
  assert.match(nodes.get('[data-security-audit-page]').textContent, /Page 2 of 3/);
});
