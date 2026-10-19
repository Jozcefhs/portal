import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadCompleteSecurityAudit } from '../js/security-audit-workspace.js';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const loader = source.slice(source.indexOf('function securityAuditCacheKey('), source.indexOf('async function staffUserRequest('))
  .replace(/await import\('\.\/security-audit-workspace\.js\?v=[^']+'\)/, 'await Promise.resolve(testAuditModule)');
const record = { AuditId: 'one', SourceCollection: 'staffSecurityAudit', Timestamp: '2026-10-03T12:00:00Z', Action: 'LOGIN' };
function batch(payload, extra = {}) {
  return { ...payload, paged: true, done: true, nextCursor: null, readTime: '2026-10-04T00:00:00Z',
    rows: [record], warnings: [], facets: { actions: ['LOGIN'] }, scanned: 1, ...extra };
}
function context(request) {
  const renders = [];
  const ctx = vm.createContext({ activeSection: 'securityAudit', selectedBranchId: 'main',
    currentUser: { username: 'admin', role: 'Super Admin', allowedSections: ['securityAudit'] },
    staffSessionAbortController: new AbortController(),
    securityAuditData: { rows: [], facets: {}, warnings: [], fromDate: '2026-09-01', toDate: '2026-10-04',
      filters: { search: 'admin', includeRoutineSystem: true } },
    panelEl: { innerHTML: '' }, securityAuditDefaultDate: () => '2026-09-01',
    testAuditModule: { loadCompleteSecurityAudit }, securityAuditRequest: request,
    renderSecurityAudit: () => renders.push({ section: ctx.activeSection, data: ctx.securityAuditData }) });
  vm.runInContext(loader, ctx);
  return { ctx, renders, load: (force = false) => vm.runInContext(`loadSecurityAudit(${force})`, ctx) };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('returning to a completed audit uses the same snapshot, filters and page without new reads', async () => {
  let reads = 0;
  const { ctx, renders, load } = context(async (_action, payload) => { reads++; return batch(payload); });
  await load();
  const cached = ctx.securityAuditData;
  cached.page = 3;
  ctx.activeSection = 'accounts';
  await load();
  ctx.activeSection = 'securityAudit';
  await load();
  assert.equal(reads, 1);
  assert.equal(ctx.securityAuditData, cached);
  assert.equal(ctx.securityAuditData.page, 3);
  assert.equal(ctx.securityAuditData.filters.search, 'admin');
  assert.equal(ctx.securityAuditData.filters.includeRoutineSystem, true);
  assert.equal(renders.length, 2);
  assert.ok(ctx.securityAuditData.loadedAt);
});

test('navigation during loading shares the running request and retains progress instead of restarting', async () => {
  const gate = deferred();
  const secondStarted = deferred();
  let reads = 0;
  const { ctx, load } = context(async (_action, payload) => {
    reads++;
    if (reads === 1) return batch(payload, { done: false, scanned: 300, nextCursor: {
      fromDate: payload.fromDate, toDate: payload.toDate, readTime: '2026-10-04T00:00:00Z', sources: { next: 'one' }
    } });
    secondStarted.resolve();
    await gate.promise;
    return batch(payload, { rows: [{ ...record, AuditId: 'two' }] });
  });
  const first = load();
  await secondStarted.promise;
  const state = ctx.securityAuditData;
  ctx.activeSection = 'accounts';
  ctx.panelEl.innerHTML = 'Accounts';
  ctx.activeSection = 'securityAudit';
  const returning = load();
  assert.equal(reads, 2);
  assert.equal(ctx.securityAuditData, state);
  assert.match(ctx.panelEl.innerHTML, /300 records checked; 1 relevant actions found/);
  gate.resolve();
  await Promise.all([first, returning]);
  assert.equal(reads, 2);
  assert.equal(ctx.securityAuditData.complete, true);
  assert.equal(ctx.securityAuditData.rows.length, 2);
});

test('background completion caches the result without overwriting the module currently on screen', async () => {
  const gate = deferred();
  const started = deferred();
  let reads = 0;
  const { ctx, renders, load } = context(async (_action, payload) => {
    reads++; started.resolve(); await gate.promise; return batch(payload);
  });
  const pending = load();
  await started.promise;
  ctx.activeSection = 'accounts';
  ctx.panelEl.innerHTML = 'Accounts';
  gate.resolve();
  await pending;
  assert.equal(ctx.panelEl.innerHTML, 'Accounts');
  assert.equal(renders.length, 0);
  assert.equal(ctx.securityAuditData.complete, true);
  ctx.activeSection = 'securityAudit';
  await load();
  assert.equal(reads, 1);
  assert.equal(renders.length, 1);
});

test('refresh, changed dates, branch, staff access or session trigger a fresh load', async () => {
  for (const mutate of [
    (ctx) => { ctx.securityAuditData.fromDate = '2026-10-01'; },
    (ctx) => { ctx.selectedBranchId = 'east'; },
    (ctx) => { ctx.currentUser.username = 'different'; },
    (ctx) => { ctx.currentUser.role = 'Auditor'; },
    (ctx) => { ctx.currentUser.allowedSections = []; },
    (ctx) => { ctx.staffSessionAbortController.abort(); ctx.staffSessionAbortController = new AbortController(); }
  ]) {
    let reads = 0;
    const { ctx, load } = context(async (_action, payload) => { reads++; return batch(payload); });
    await load();
    const first = ctx.securityAuditData;
    mutate(ctx);
    await load();
    assert.equal(reads, 2);
    assert.notEqual(ctx.securityAuditData, first);
  }
  let reads = 0;
  const { load } = context(async (_action, payload) => { reads++; return batch(payload); });
  await load();
  await load(true);
  assert.equal(reads, 2);
});

test('late results from a previous branch or session are discarded and stop further batches', async () => {
  for (const invalidate of [
    (ctx) => { ctx.selectedBranchId = 'east'; },
    (ctx) => { ctx.staffSessionAbortController.abort(); },
    (ctx) => { ctx.securityAuditData = { rows: [], filters: {}, fromDate: '', toDate: '' }; }
  ]) {
    const gate = deferred();
    const started = deferred();
    let reads = 0;
    const { ctx, renders, load } = context(async (_action, payload) => {
      reads++; started.resolve(); await gate.promise;
      return batch(payload, { done: false, nextCursor: { fromDate: payload.fromDate, toDate: payload.toDate, readTime: '2026-10-04T00:00:00Z', sources: {} } });
    });
    const pending = load();
    await started.promise;
    invalidate(ctx);
    gate.resolve();
    await pending;
    assert.equal(reads, 1);
    assert.equal(renders.length, 0);
    assert.equal(ctx.securityAuditData.rows.length, 0);
  }
});

test('failed loads are retryable and not reused as completed snapshots', async () => {
  let reads = 0;
  const { ctx, load } = context(async (_action, payload) => {
    reads++;
    if (reads === 1) throw new Error('Source unavailable');
    return batch(payload);
  });
  await load();
  assert.equal(ctx.securityAuditData.complete, false);
  assert.equal(ctx.securityAuditData.loadPromise, null);
  await load();
  assert.equal(reads, 2);
  assert.equal(ctx.securityAuditData.complete, true);
});

test('both login and branch changes clear cached audit data alongside aborting session requests', () => {
  for (const [start, end] of [['function clearStaffWorkspaceState(', 'function staffBranchStorageKey('],
    ['function clearBranchScopedWorkspaceData(', 'async function switchStaffBranch(']]) {
    const section = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(section, /staffSessionAbortController\.abort\(\)/);
    assert.match(section, /securityAuditData = \{\s*rows: \[\]/);
  }
  assert.match(source, /Snapshot loaded/);
  assert.match(source, /Use Refresh to check for newer actions/);
});
