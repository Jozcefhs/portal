import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { assertServiceWorkerCacheVersion } from './helpers/service-worker-cache-version.mjs';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function renderStaffSecurityActivity()'), source.indexOf("loginForm.addEventListener('submit'"));
const row = id => ({ AuditId: id, Timestamp: '2026-10-16T12:00:00Z', Action: 'LOGIN', Username: 'fixture', Actor: 'Officer', SourcePlatform: 'Web' });
const cursor = token => ({ version: 1, pageToken: token, readTime: '2026-10-16T12:00:00Z', scope: 'main' });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(request) {
  const panel = { innerHTML: '', querySelector: () => null };
  const calls = [], timers = new Map();
  let timerId = 0;
  const context = vm.createContext({ AbortController, currentUser: { username: 'owner', role: 'Super Admin' }, selectedBranchId: 'main', activeSection: 'staffUsers',
    staffAuditState: { cursor: null, loaded: false, loading: false, error: '' }, staffAuditData: [], staffUsersLoadVersion: 0,
    staffSessionAbortController: new AbortController(),
    staffUsersData: [], staffSeatUsage: null, staffApprovalAccounts: [], staffRoleAccessData: null, staffModulePreferencesData: null,
    staffNameFormat: '', staffNameMigration: {}, availableBranches: [], canAssignStaffBranches: false, staffMfaAdminData: null,
    panelEl: { innerHTML: 'Staff controls', querySelector: selector => selector === '.staff-security-activity' ? panel : null },
    clean: value => String(value ?? '').trim(), escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    DynamaxTime: { formatDateTime: value => value }, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    staffUserRequest: async (action, payload, options) => { calls.push({ action, payload, options }); return request(action, payload, options); },
    mfaRequest: async () => ({ accounts: [] }), renderModuleSummary: () => {}, renderStaffUsers: () => { context.panelEl.innerHTML = 'Staff directory rendered'; },
    takeRecordsDeskHandoff: () => null, recordsDeskHandoffReference: () => ''
  });
  vm.runInContext(functions, context);
  return { context, panel, calls, timers };
}

test('directory renders before pending audit read finishes and audit errors do not replace staff controls', async () => {
  const pending = deferred();
  const h = harness(action => action === 'list' ? { users: [{ Username: 'fixture' }] } : pending.promise);
  await h.context.loadStaffUsers();
  assert.equal(h.context.panelEl.innerHTML, 'Staff directory rendered');
  assert.equal(h.context.staffUsersData.length, 1);
  assert.equal(h.calls[0].payload.includeAudit, false);
  assert.equal(h.calls[1].action, 'list-security-audit');
  assert.match(h.panel.innerHTML, /Loading security activity/);
  pending.reject(new Error('Database unavailable'));
  await tick();
  assert.equal(h.context.panelEl.innerHTML, 'Staff directory rendered');
  assert.match(h.panel.innerHTML, /Retry loading activity/);
  assert.doesNotMatch(h.panel.innerHTML, /No security activity recorded/);
  assert.equal(h.timers.size, 0);
});

test('paging appends unique rows and failed pages retain the last cursor and history for retry', async () => {
  let page = 0;
  const h = harness(() => {
    if (++page === 1) return { rows: [row('a')], nextCursor: cursor('next') };
    if (page === 2) throw new Error('Temporary outage <script>');
    return { rows: [row('a'), row('b'), row('b')], nextCursor: null };
  });
  await h.context.loadStaffSecurityActivity();
  const firstCursor = h.context.staffAuditState.cursor;
  await h.context.loadStaffSecurityActivity();
  assert.equal(h.context.staffAuditState.cursor, firstCursor);
  assert.equal(h.context.staffAuditData.length, 1);
  assert.match(h.panel.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(h.panel.innerHTML, /<script>/);
  await h.context.loadStaffSecurityActivity();
  assert.deepEqual(Array.from(h.context.staffAuditData, row => row.AuditId), ['a', 'b']);
  assert.equal(h.calls[2].payload.cursor, firstCursor);
  assert.match(h.panel.innerHTML, /End of available history/);
  assert.doesNotMatch(h.panel.innerHTML, /data-more-staff-audit/);
  assert.equal(h.context.panelEl.innerHTML, 'Staff controls');
});

test('duplicate clicks do not start overlapping reads, and refresh starts a new history snapshot', async () => {
  const pending = deferred();
  let requests = 0;
  const h = harness(() => ++requests === 1 ? pending.promise : { rows: [row('new')], nextCursor: null });
  const loading = h.context.loadStaffSecurityActivity();
  await h.context.loadStaffSecurityActivity();
  await h.context.loadStaffSecurityActivity(true);
  assert.equal(h.calls.length, 1);
  assert.match(h.panel.innerHTML, /data-refresh-staff-audit disabled/);
  pending.resolve({ rows: [row('old')], nextCursor: cursor('older') });
  await loading;
  await h.context.loadStaffSecurityActivity(true);
  assert.equal(h.calls[1].payload.cursor, null);
  assert.deepEqual(Array.from(h.context.staffAuditData, row => row.AuditId), ['new']);
});

test('late audit responses cannot populate another branch, session, workspace or replaced history state', async () => {
  for (const change of [ctx => { ctx.selectedBranchId = 'east'; }, ctx => { ctx.currentUser = { username: 'another' }; },
    ctx => { ctx.activeSection = 'students'; }, ctx => { ctx.staffAuditState = null; },
    ctx => { ctx.staffSessionAbortController = new AbortController(); }]) {
    const pending = deferred(), h = harness(() => pending.promise);
    const loading = h.context.loadStaffSecurityActivity();
    change(h.context);
    h.panel.innerHTML = 'New workspace';
    pending.resolve({ rows: [row('old-branch')], nextCursor: null });
    await loading;
    assert.equal(h.context.staffAuditData.length, 0);
    assert.equal(h.panel.innerHTML, 'New workspace');
    assert.equal(h.timers.size, 0);
  }
});

test('late directory responses cannot restore a previous branch and newer refresh wins', async () => {
  const pending = deferred(), h = harness(action => action === 'list' ? pending.promise : { rows: [], nextCursor: null });
  const loading = h.context.loadStaffUsers();
  h.context.selectedBranchId = 'east';
  pending.resolve({ users: [{ Username: 'wrong branch' }] });
  await loading;
  assert.equal(h.context.staffUsersData.length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.context.panelEl.innerHTML, 'Staff controls');
  const first = deferred(), second = deferred();
  let requests = 0;
  const next = harness(action => action !== 'list' ? { rows: [], nextCursor: null } : ++requests === 1 ? first.promise : second.promise);
  const older = next.context.loadStaffUsers(), newer = next.context.loadStaffUsers();
  second.resolve({ users: [{ Username: 'new' }] });
  await newer;
  first.resolve({ users: [{ Username: 'stale' }] });
  await older;
  assert.equal(next.context.staffUsersData[0].Username, 'new');
});

test('timeout leaves directory usable and offers retry without a false empty-history result', async () => {
  const h = harness((_action, _payload, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')))));
  const loading = h.context.loadStaffSecurityActivity();
  h.timers.values().next().value();
  await loading;
  assert.equal(h.context.panelEl.innerHTML, 'Staff controls');
  assert.match(h.panel.innerHTML, /took too long/);
  assert.match(h.panel.innerHTML, /Retry loading activity/);
  assert.doesNotMatch(h.panel.innerHTML, /No security activity recorded/);
});

test('session cancellation aborts the audit request without replacing the new workspace', async () => {
  const h = harness((_action, _payload, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')))));
  const loading = h.context.loadStaffSecurityActivity();
  h.context.staffSessionAbortController.abort();
  h.panel.innerHTML = 'Another workspace';
  await loading;
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.equal(h.panel.innerHTML, 'Another workspace');
  assert.equal(h.timers.size, 0);
});

test('empty filtered pages with a continuation remain navigable; incomplete/repeated pages report errors', async () => {
  const h = harness(() => ({ rows: [], nextCursor: cursor('next') }));
  await h.context.loadStaffSecurityActivity();
  assert.match(h.panel.innerHTML, /Load older activity/);
  assert.doesNotMatch(h.panel.innerHTML, /No security activity recorded/);
  await h.context.loadStaffSecurityActivity();
  assert.match(h.panel.innerHTML, /did not return a complete new page/);
  const invalid = harness(() => ({ rows: [] }));
  await invalid.context.loadStaffSecurityActivity();
  assert.match(invalid.panel.innerHTML, /Retry loading activity/);
});

test('updated admin asset and service-worker generation invalidate older staff-loading code', async () => {
  const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
  assert.match(html, /js\/admin\.js\?v=[^"\s]*staff-security-history/);
  assert.match(html, /js\/staff-workspace-cache\.js\?v=[^"\s]*staff-security-history/);
  assertServiceWorkerCacheVersion(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), 407);
});
