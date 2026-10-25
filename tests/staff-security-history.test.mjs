import * as branchAccess from '../functions/lib/staff-branch-access.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadStaffSecurityHistory } from '../functions/lib/staff-security-history.js';
import { actorBranchScope, branchRecordVisible } from '../functions/lib/branch-scope.js';

const env = { FIREBASE_PROJECT_ID: 'test-project' };
const actor = { username: 'owner', role: 'Super Admin', edition: 'school', branchId: 'main' };
const record = (index, changes = {}) => ({ __id: `record-${String(index).padStart(6, '0')}`,
  Timestamp: new Date(Date.UTC(2026, 9, 15, 0, 0, index)).toISOString(),
  BranchId: 'main', Action: 'LOGIN', Username: 'fixture', Actor: 'Fixture officer', SourcePlatform: 'Web', ...changes });
function fixture(size, changes = () => ({})) {
  const records = Array.from({ length: size }, (_, i) => record(i, changes(i)));
  const calls = [], snapshots = new Map();
  const fetchPage = async (_env, path, options) => {
    assert.equal(path, 'staffSecurityAudit');
    const params = new URLSearchParams(options.query);
    assert.equal(params.get('orderBy'), 'Timestamp desc, __name__ desc');
    assert.ok(options.pageSize <= 80);
    const readTime = params.get('readTime');
    assert.ok(readTime);
    if (!snapshots.has(readTime)) snapshots.set(readTime, records.slice().sort((a, b) =>
      b.Timestamp.localeCompare(a.Timestamp) || b.__id.localeCompare(a.__id)));
    calls.push(options);
    const snapshot = snapshots.get(readTime), offset = Number(options.pageToken || 0);
    return { documents: snapshot.slice(offset, offset + options.pageSize),
      nextPageToken: offset + options.pageSize < snapshot.length ? String(offset + options.pageSize) : '' };
  };
  return { records, calls, read: (cursor = null, user = actor) => loadStaffSecurityHistory(env, user, cursor, { listCollectionPage: fetchPage }) };
}

test('large audit history loads bounded newest-first pages past the old 5,000-record limit without writes', async () => {
  const f = fixture(6005), before = JSON.stringify(f.records), ids = [];
  let cursor = null, pages = 0;
  do {
    const result = await f.read(cursor);
    if (!pages) { assert.equal(result.rows[0].AuditId, 'record-006004'); assert.equal(f.calls.length, 1); }
    ids.push(...result.rows.map(row => row.AuditId));
    cursor = result.nextCursor;
    pages++;
  } while (cursor);
  assert.equal(ids.length, 6005);
  assert.equal(new Set(ids).size, 6005);
  assert.equal(f.calls.length, pages);
  assert.equal(JSON.stringify(f.records), before);
});

test('timestamp ties and newly inserted events cannot duplicate or skip records in an existing snapshot', async () => {
  const f = fixture(170, () => ({ Timestamp: '2026-10-15T12:00:00.000Z' }));
  const first = await f.read();
  f.records.push(record(99999));
  const second = await f.read(first.nextCursor), third = await f.read(second.nextCursor);
  const ids = [...first.rows, ...second.rows, ...third.rows].map(row => row.AuditId);
  assert.equal(ids.length, 170);
  assert.equal(new Set(ids).size, 170);
  assert.equal(ids.includes('record-099999'), false);
  assert.equal(third.nextCursor, null);
});

test('branch filtering retains legacy main and lowercase branch fields without leaking other branches', async () => {
  const f = fixture(120, i => i % 3 === 0 ? { BranchId: 'east' } : i % 3 === 1 ? { BranchId: undefined } : { BranchId: '', branchId: 'main' });
  const main = await f.read(), east = await f.read(null, { ...actor, branchId: 'east' });
  const remaining = await f.read(main.nextCursor);
  const mainRows = [...main.rows, ...remaining.rows];
  assert.equal(mainRows.length, 80);
  assert.equal(new Set(mainRows.map(row => row.AuditId)).size, 80);
  assert.equal(remaining.nextCursor, null);
  assert.ok(mainRows.every(row => row.BranchId === 'main'));
  assert.equal(east.rows.length, 40);
  assert.ok(east.rows.every(row => row.BranchId === 'east'));
  const all = await f.read(null, { ...actor, branchId: '' });
  assert.equal(all.rows.length, 80);
  assert.ok(all.rows.some(row => row.BranchId === 'east'));
});

test('sparse branch pages remain bounded and expose continuation instead of falsely reporting empty history', async () => {
  const f = fixture(600, i => ({ BranchId: i < 20 ? 'main' : 'east' }));
  const first = await f.read();
  assert.equal(first.rows.length, 0);
  assert.ok(first.nextCursor);
  assert.equal(f.calls.length, 4);
  const next = await f.read(first.nextCursor);
  assert.equal(next.rows.length, 20);
  assert.equal(next.nextCursor, null);
});

test('cursor validation rejects stale or different-workspace continuations before reads', async () => {
  const f = fixture(100), first = await f.read(), count = f.calls.length;
  for (const cursor of [[], '', { ...first.nextCursor, version: 2 }, { ...first.nextCursor, pageToken: 'x'.repeat(12001) },
    { ...first.nextCursor, readTime: undefined }, { ...first.nextCursor, readTime: '' },
    { ...first.nextCursor, readTime: 'not-a-date' }, { ...first.nextCursor, readTime: new Date(Date.now() + 60000).toISOString() },
    { ...first.nextCursor, readTime: new Date(Date.now() - 3600000).toISOString() }]) {
    await assert.rejects(f.read(cursor), { status: 400 });
  }
  await assert.rejects(f.read(first.nextCursor, { ...actor, branchId: 'east' }), { status: 400 });
  await assert.rejects(f.read(first.nextCursor, { ...actor, edition: 'church' }), { status: 400 });
  assert.equal(f.calls.length, count);
});

test('repeated cursors and failed later reads do not masquerade as complete or partial successful history', async () => {
  let reads = 0;
  await assert.rejects(loadStaffSecurityHistory(env, actor, null, { listCollectionPage: async () => {
    reads++; return { documents: [record(reads, { BranchId: 'east' })], nextPageToken: 'stuck' };
  } }), /could not advance/);
  assert.equal(reads, 2);
  reads = 0;
  await assert.rejects(loadStaffSecurityHistory(env, actor, null, { listCollectionPage: async () => {
    if (++reads > 1) throw new Error('Database unavailable');
    return { documents: [record(1)], nextPageToken: 'next' };
  } }), /Database unavailable/);
});

const staffSource = await readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8');
function routeHarness({ user = actor, auditFails = false, staffFails = false, signedIn = true } = {}) {
  const calls = [];
  const context = vm.createContext({ ...branchAccess, Response, WEB_SECTION_KEYS: [], actorBranchScope, branchRecordVisible,
    requireFirestoreEnv: () => {}, requireStaffSession: async () => {
      if (!signedIn) throw Object.assign(new Error('Sign in required'), { status: 401 });
      return user;
    }, readJsonBody: async request => request,
    loadStaffSecurityHistory: async () => { calls.push('audit'); if (auditFails) throw new Error('Database unavailable'); return { rows: [], nextCursor: null }; },
    listCollection: async (_env, name) => { calls.push(name); assert.notEqual(name, 'staffSecurityAudit');
      if (staffFails) throw new Error('Staff read failed');
      return name === 'staffUsers' ? [{ Username: 'fixture', Role: 'Teacher', BranchId: 'main', Active: true }] : []; },
    getDocument: async () => null, roleAccessView: () => ({}), loadSubscriptionUserLimit: async () => 100,
    getSchoolStructure: async () => ({}), loadOrganizationNameProfile: async () => ({}),
    resolveOrganizationConfig: () => ({}), staffRecordMatchesEdition: () => true,
    staffAccountsForSubscription: rows => rows, activeStaffAccountCount: rows => rows.length,
    accountingChartChoicesForEdition: rows => rows, configuredStaffBranches: () => [],
    staffAssignmentActor: user => user, normalizeOrganizationEdition: value => value,
    formatPersonName: row => row.Username, canEditRequisitions: () => false, filterSectionsForFeatures: rows => rows
  });
  vm.runInContext(staffSource.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, ''), context);
  return { calls, send: request => context.onRequestPost({ request, env }) };
}

test('staff directory no longer depends on reading audit history; older clients degrade explicitly', async () => {
  for (const edition of ['school', 'faith', 'organization']) {
    const h = routeHarness({ user: { ...actor, edition }, auditFails: true });
    const response = await h.send({ action: 'list', includeAudit: false });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).users.length, 1);
    assert.ok(!h.calls.includes('audit'));
    const legacy = await h.send({ action: 'list' });
    assert.equal(legacy.status, 200);
    assert.match((await legacy.json()).auditWarning, /could not be loaded/);
  }
});

test('dedicated history read retains authentication and Super Admin restriction; mandatory staff failures still fail', async () => {
  const allowed = routeHarness();
  const response = await allowed.send({ action: 'list-security-audit' });
  assert.equal(response.status, 200);
  assert.deepEqual(allowed.calls, ['audit']);
  const denied = routeHarness({ user: { ...actor, role: 'Teacher' } });
  assert.equal((await denied.send({ action: 'list-security-audit' })).status, 403);
  assert.equal(denied.calls.length, 0);
  const anonymous = routeHarness({ signedIn: false });
  assert.equal((await anonymous.send({ action: 'list-security-audit' })).status, 401);
  assert.equal(anonymous.calls.length, 0);
  const failed = routeHarness({ staffFails: true });
  assert.equal((await failed.send({ action: 'list', includeAudit: false })).status, 500);
});
