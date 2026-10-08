import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/staff-workspace-cache.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const sandbox = vm.createContext({ Response, TextEncoder, DOMException, Date });
vm.runInContext(source, sandbox);
const { create, requestPolicy } = sandbox.DynamaxWorkspaceCache;
const url = (path) => new URL(path, 'https://school.example');
const post = (action, extra = {}) => ({ method: 'POST', body: JSON.stringify({ action, ...extra }) });
const json = (value = { ok: true, rows: [1] }, status = 200) => Response.json(value, { status });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };
function fixture(options = {}) {
  const state = { scope: 'main|admin|access', signal: new AbortController().signal, expiresAt: 0 };
  const cache = create({ context: () => state, ...options });
  return { state, cache };
}

test('all audited modules reuse read-only snapshots, including empty results', async () => {
  const { cache } = fixture();
  for (const [path, action, init] of [
    ['admin', 'section'], ['income-analytics', '', { method: 'POST', body: '{"period":"monthly"}' }],
    ...['staff-hr', 'staff-conduct', 'staff-library', 'finance-workflow', 'staff-stores',
      'staff-departments', 'staff-members', 'staff-organization-departments', 'staff-services',
      'staff-funds', 'staff-church-payments', 'staff-offerings'].map((path) => [path, 'list']),
    ['staff-correspondence', 'bootstrap'], ['staff-academics', 'bootstrap'],
    ['external-audit', 'records'], ['staff-payroll', '', {}], ['staff-hotel', '', {}]
  ]) {
    let reads = 0;
    const load = () => cache.fetch(url(`/api/${path}`), init || post(action), async () => { reads++; return json({ ok: true, rows: [] }); });
    assert.deepEqual(await (await load()).json(), { ok: true, rows: [] });
    assert.deepEqual(await (await load()).json(), { ok: true, rows: [] });
    assert.equal(reads, 1, path);
  }
});

test('concurrent loads share one network request and each caller can consume its response', async () => {
  const { cache } = fixture(); const gate = deferred(); let reads = 0;
  const network = async () => { reads++; await gate.promise; return json(); };
  const loads = [cache.fetch(url('/api/staff-hr'), post('list'), network), cache.fetch(url('/api/staff-hr'), post('list'), network)];
  gate.resolve();
  const responses = await Promise.all(loads);
  assert.equal(reads, 1);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
});

test('homework context reuses scoped snapshots but audience preview stays live and sends invalidate reads', async () => {
  assert.equal(requestPolicy(url('/api/staff-homework'), post('getContext', { SchoolSection: 'primary' })).cacheable, true);
  const preview = requestPolicy(url('/api/staff-homework'), post('previewHomework'));
  assert.equal(preview.cacheable, false); assert.equal(preview.mutation, false);
  assert.equal(requestPolicy(url('/api/staff-homework'), post('sendHomework')).mutation, true);
});

test('filters, cursors and module request payloads are independently keyed', async () => {
  const { cache } = fixture(); let reads = 0;
  const network = async () => { reads++; return json(); };
  for (const body of [{ action: 'list', dateFrom: '2026-10-01' }, { dateFrom: '2026-10-01', action: 'list' },
    { action: 'list', dateFrom: '2026-09-01' }, { action: 'list', dateFrom: '2026-10-01', cursor: 'next' }]) {
    await cache.fetch(url('/api/external-audit'), { method: 'POST', body: JSON.stringify(body) }, network);
  }
  assert.equal(reads, 3);
});

test('refresh and mutation invalidate previous snapshots; unknown POSTs are not assumed to be reads', async () => {
  const { cache } = fixture(); let reads = 0;
  const load = () => cache.fetch(url('/api/staff-library'), post('list'), async () => { reads++; return json(); });
  await load(); cache.clear(); await load();
  await cache.fetch(url('/api/staff-library'), post('save'), async () => json()); await load();
  await cache.fetch(url('/api/init-church-payment'), { method: 'POST', body: '{"Amount":1000}' }, async () => json()); await load();
  assert.equal(reads, 4);
});

test('late reads cannot repopulate the cache during or after a write, even when the write fails', async () => {
  const { cache } = fixture(); const gate = deferred(); let reads = 0;
  const load = () => cache.fetch(url('/api/finance-workflow'), post('list'), async () => { reads++; await gate.promise; return json(); });
  const pending = load();
  const failure = assert.rejects(pending, { name: 'AbortError' });
  await cache.fetch(url('/api/finance-workflow'), post('approve'), async () => json({ ok: false }, 503));
  gate.resolve(); await failure; await load();
  assert.equal(reads, 2);
});

test('branch, user/access and session changes invalidate snapshots and discard previous results', async () => {
  for (const mutate of [(state) => { state.scope = 'east|admin|access'; }, (state) => { state.scope = 'main|other|access'; },
    (state) => { state.scope = 'main|admin|reduced-access'; }, (state) => { state.signal = new AbortController().signal; }]) {
    const { state, cache } = fixture(); const gate = deferred(); let reads = 0;
    const load = () => cache.fetch(url('/api/staff-hr'), post('list'), async () => { reads++; await gate.promise; return json(); });
    const pending = load(); const rejected = assert.rejects(pending, { name: 'AbortError' });
    mutate(state); gate.resolve(); await rejected; await load(); await load();
    assert.equal(reads, 2);
  }
});

test('failed/non-JSON loads are not cached and authentication/attendance/payment checks stay live', async () => {
  const { cache } = fixture(); let reads = 0;
  for (const response of [json({ ok: false }), json({ ok: false }, 401), new Response('<html>temporary error</html>')]) {
    const load = () => cache.fetch(url('/api/staff-hr'), post('list'), async () => { reads++; return response.clone(); });
    await load(); await load();
  }
  assert.equal(reads, 6);
  for (const path of ['staff-session', 'staff-mfa', 'staff-passkey', 'staff-users', 'staff-attendance', 'desktop-pairing', 'staff-direct-transfers', 'staff-wallet']) {
    assert.equal(requestPolicy(url(`/api/${path}`), post('list')).cacheable, false, path);
  }
  assert.equal(requestPolicy(url('/api/staff-library'), post('list', { approvalPassword: 'not-a-real-password' })).cacheable, false);
  assert.equal(requestPolicy(url('/api/staff-attendance'), post('presencequick')).mutation, false);
  assert.equal(requestPolicy(url('/api/staff-attendance'), post('presence')).mutation, true);
});

test('expired audit grants cannot reuse data; clearing cache advances the snapshot revision', async () => {
  const { cache, state } = fixture(); let reads = 0;
  const load = () => cache.fetch(url('/api/external-audit'), post('list'), async () => { reads++; return json(); });
  await load(); const version = cache.version();
  state.expiresAt = Date.now() - 1;
  assert.ok(cache.version() > version);
  await load(); await load(); assert.equal(reads, 3);
});

test('memory is bounded and neither records nor credentials are written to browser storage', async () => {
  const { cache } = fixture({ maxEntries: 1 }); let reads = 0;
  const network = async () => { reads++; return json(); };
  await cache.fetch(url('/api/staff-hr'), post('list'), network);
  await cache.fetch(url('/api/staff-library'), post('list'), network);
  await cache.fetch(url('/api/staff-hr'), post('list'), network);
  assert.equal(reads, 3);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  assert.match(admin, /panelEl.addEventListener\('click'[\s\S]*?\^refresh/);
  assert.match(admin, /function clearStaffWorkspaceState\(\) \{\s*invalidateStaffWorkspaceReads\(\)/);
  assert.match(admin, /function clearBranchScopedWorkspaceData\(\) \{\s*invalidateStaffWorkspaceReads\(\)/);
});

test('the shared cache is loaded before the staff workspace and module refresh clears it', async () => {
  const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('js/staff-workspace-cache.js?v=20261005-teacher-homework') < html.indexOf('js/admin.js?v=20261008-wallet-card-setup-billing-review-completion'));
  assert.match(admin, /function refreshDashboard\(\) \{\s*invalidateStaffWorkspaceReads\(\)/);
  assert.match(admin, /id="refreshIncomeAnalytics"/);
});

test('staff request integration keeps branch/auth headers, retries failures and reuses module data', async () => {
  const { cache } = fixture();
  const calls = [];
  const ctx = vm.createContext({ URL, Headers, Request, staffWorkspaceReads: cache,
    selectedBranchId: 'main', staffBearerToken: 'test-session', staffSessionAbortController: new AbortController(),
    clean: (value) => String(value ?? '').trim(), window: {
      location: { href: 'https://school.example/admin.html', origin: 'https://school.example' },
      setTimeout: (done) => { done(); },
      fetch: async (input, init) => {
        calls.push({ input, init });
        if (calls.length === 1) return json({ ok: false }, 503);
        return json();
      }
    } });
  vm.runInContext(admin.slice(admin.indexOf('const TRANSIENT_API_STATUS_CODES'), admin.indexOf('async function refreshStaffSiteProfile')), ctx);
  const load = () => vm.runInContext("staffFetch('/api/staff-hr', {method:'POST', dynamaxRetrySafe:true, body:'{\"action\":\"list\"}'})", ctx);
  await load(); await load();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.get('X-Dynamax-Branch'), 'main');
  assert.equal(calls[1].init.headers.get('Authorization'), 'Bearer test-session');
  assert.equal(calls[1].init.dynamaxRetrySafe, undefined);
  await vm.runInContext("staffFetch('/api/staff-attendance', {method:'POST', body:'{\"action\":\"presencequick\"}'})", ctx);
  await load(); assert.equal(calls.length, 3, 'live presence polling does not discard unrelated records');
  await vm.runInContext("staffFetch('/api/staff-hr', {method:'POST', body:'{\"action\":\"save\"}'})", ctx);
  await load(); assert.equal(calls.length, 5, 'saved changes require a new module snapshot');
});

function incomeFixture(request) {
  let revision = 0;
  const renders = [];
  const ctx = vm.createContext({ incomeAnalyticsFilter: { period: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-31' },
    incomeAnalyticsSnapshot: null, incomeAnalyticsData: null, incomeAnalyticsRequest: 0, activeSection: 'incomeAnalytics',
    staffWorkspaceReads: { version: () => revision }, staffFetch: request, panelEl: { innerHTML: '' },
    clean: (value) => String(value ?? '').trim(), escapeHtml: (value) => value,
    showLogin: () => {}, combineIncomeAnalyticsPages: (pages) => ({ ...pages[0], transactions: pages.flatMap((p) => p.transactions), summary: { totalIncome: 200 } }),
    renderIncomeAnalytics: (report) => { if (ctx.activeSection === 'incomeAnalytics') renders.push(report); } });
  vm.runInContext(admin.slice(admin.indexOf('async function loadIncomeAnalytics('), admin.indexOf('function csvCell(')), ctx);
  return { ctx, renders, invalidate: () => { revision++; }, load: () => vm.runInContext('loadIncomeAnalytics()', ctx) };
}
const incomePage = (extra = {}) => json({ ok: true, filter: { period: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-31' },
  period: { dateFrom: '2026-10-01' }, transactions: [{ amount: 100 }], ...extra });

test('income finishes all pages in background and returning uses the complete report with no new reads', async () => {
  const gate = deferred(), started = deferred(); let reads = 0;
  const { ctx, load, renders } = incomeFixture(async () => {
    reads++; if (reads === 1) return incomePage({ nextCursor: { date: 'one', name: 'next' } });
    started.resolve(); await gate.promise; return incomePage();
  });
  const first = load(); await started.promise;
  ctx.activeSection = 'accounts'; ctx.panelEl.innerHTML = 'Accounts';
  gate.resolve(); await first;
  assert.equal(ctx.panelEl.innerHTML, 'Accounts'); assert.equal(renders.length, 0);
  assert.equal(ctx.incomeAnalyticsData.transactions.length, 2);
  ctx.activeSection = 'incomeAnalytics'; await load(); await load();
  assert.equal(reads, 2); assert.equal(renders.length, 2);
});

test('income in-flight revisits share the report load; refresh and changed filters fetch anew', async () => {
  const gate = deferred(); let reads = 0;
  const { ctx, load, invalidate } = incomeFixture(async () => { reads++; await gate.promise; return incomePage(); });
  const first = load(); const returnVisit = load(); gate.resolve(); await Promise.all([first, returnVisit]);
  assert.equal(reads, 1);
  invalidate(); await load(); assert.equal(reads, 2);
  ctx.incomeAnalyticsFilter.dateFrom = '2026-09-01'; await load(); assert.equal(reads, 3);
});

test('income late results and partial failures are not saved as complete reports', async () => {
  const gate = deferred();
  const { ctx, load, invalidate, renders } = incomeFixture(async () => { await gate.promise; return incomePage(); });
  const pending = load(); invalidate(); gate.resolve(); await pending;
  assert.equal(ctx.incomeAnalyticsData, null); assert.equal(renders.length, 0);
  let reads = 0;
  const failed = incomeFixture(async () => { if (++reads === 1) throw new Error('unavailable'); return incomePage(); });
  await failed.load(); await failed.load(); assert.equal(reads, 2);
});
