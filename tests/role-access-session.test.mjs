import * as branchAccess from '../functions/lib/staff-branch-access.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as roles from '../functions/lib/role-module-access.js';
import * as organization from '../functions/lib/organization-config.js';
import * as branches from '../functions/lib/staff-branch-context.js';
import { objectToFirestoreFields, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { actorBranchScope } from '../functions/lib/branch-scope.js';

const authSource = await readFile(new URL('../functions/lib/staff-auth.js', import.meta.url), 'utf8');
const credentialSource = await readFile(new URL('../functions/lib/staff-credential-state.js', import.meta.url), 'utf8');
const usersSource = await readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8');
const sessionSource = await readFile(new URL('../functions/api/staff-session.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const unmodule = source => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(edition = 'school') {
  const documents = new Map();
  const writes = [];
  let revision = 0;
  let policyReadError = null;
  const env = { FIREBASE_PROJECT_ID: `fixture-${edition}`, ORGANISATION_EDITION: edition,
    STAFF_SESSION_SECRET: 'local-role-policy-test-secret-not-a-live-credential' };
  const put = (collection, id, data) => {
    const doc = { name: `${collection}/${id}`, fields: objectToFirestoreFields(data), updateTime: `v${++revision}` };
    documents.set(`${collection}/${id}`, doc);
    return doc;
  };
  const database = {
    getDocument: async (_env, collection, id) => {
      if (id === 'roleModuleAccess' && policyReadError) throw policyReadError;
      const doc = documents.get(`${collection}/${id}`);
      return doc ? firestoreDocumentToObject(clone(doc)) : null;
    },
    upsertDocument: async (_env, collection, id, data, options = {}) => {
      const current = documents.get(`${collection}/${id}`);
      if (options.exists === false && current || options.updateTime && current?.updateTime !== options.updateTime) {
        throw Object.assign(new Error('Concurrent write'), { status: 409 });
      }
      writes.push({ collection, id, data: clone(data) });
      return put(collection, id, data);
    },
    updateDocumentIfCurrent: async (env, collection, id, data, current) =>
      database.upsertDocument(env, collection, id, data, { updateTime: current.__updateTime })
  };
  const flags = organization.featureFlagsForEdition(edition);
  const common = { ...branchAccess,
    TextEncoder, TextDecoder, Request, Response, Headers, URL, crypto, btoa, atob, console,
    ...roles, ...organization, ...branches, ...database,
    EXTERNAL_AUDITOR_ROLE: 'External Auditor',
    externalAuditAccessExpired: () => false, requisitionEditGrant: () => false,
    accountingCodeAllowedForEdition: () => true,
    getSchoolStructure: async () => ({ Branches: [{ Id: 'main' }, { Id: 'east' }] }),
    resolveOrganizationConfig: () => ({ Edition: edition, Plan: 'Professional', FeatureFlags: flags, PlanFeatureFlags: flags }),
    refreshOrganizationPlanPolicy: async (_env, profile) => profile
  };
  const worker = () => {
    const context = vm.createContext({ ...common });
    vm.runInContext(unmodule(credentialSource), context);
    vm.runInContext(unmodule(authSource), context);
    return context;
  };
  const reader = worker(), writer = worker();
  const session = vm.createContext({ ...common, ...reader,
    loadStaffProfileImage: async () => null, loadOrganizationNameProfile: async () => ({}),
    formatPersonName: row => row.DisplayName || row.Username });
  vm.runInContext(unmodule(sessionSource.replace(/^export \{[^\n]+ from [^\n]+\r?$/gm, '')), session);
  const admin = vm.createContext({ ...common, actorBranchScope,
    invalidateStaffAccessCache: writer.invalidateStaffAccessCache });
  vm.runInContext(unmodule(usersSource), admin);
  const save = (Modules, scope = 'main', Role = 'Procurement Officer') => admin.saveRoleAccess(env,
    { username: 'owner', role: 'Super Admin', branchId: scope === 'global' ? '' : scope, edition, featureFlags: flags }, { Role, Modules });
  const requestFor = async (user, branch = 'main') => {
    put('staffUsers', user.Username, { Active: true, MustChangePassword: false, ...user });
    const token = await reader.createStaffSession(env, user);
    return new Request('https://fixture.example/api/admin', {
      headers: { Authorization: `Bearer ${token}`, 'X-Dynamax-Branch': branch }
    });
  };
  return { env, put, reader, writer, admin, session, save, requestFor, documents, writes,
    failPolicyReads: error => { policyReadError = error; },
    getPolicy: () => database.getDocument(env, 'settings', 'roleModuleAccess') };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: a role saved by another worker reaches an already signed-in Procurement Officer`, async () => {
    const f = fixture(edition);
    await f.save(['payroll']);
    const request = await f.requestFor({ Username: 'buyer', Role: 'Procurement Officer', BranchId: 'main', TabAccess: ['staffAttendance'] });
    const before = await f.reader.requireStaffSession(f.env, request);
    assert.ok(!before.allowedSections.includes('incomeAnalytics'));
    await f.save(['incomeAnalytics']);
    const after = await f.reader.requireStaffSession(f.env, request);
    assert.ok(after.allowedSections.includes('incomeAnalytics'), 'must not reuse another worker\'s stale role policy');
    assert.ok(after.allowedSections.includes('procurement'));
    assert.ok(after.allowedSections.includes('staffAttendance'), 'individual additions stay additive');
    await f.save(['payroll']);
    assert.ok(!(await f.reader.requireStaffSession(f.env, request)).allowedSections.includes('incomeAnalytics'), 'revocation must also take effect');
    assert.ok(f.writes.every(write => write.collection !== 'staffUsers'), 'role changes must not be copied into individual accounts');
  });

  test(`${edition}: organisation-wide officers receive the role policy for their validated working branch`, async () => {
    const f = fixture(edition);
    await f.save(['incomeAnalytics'], 'main');
    await f.save(['staffAttendance'], 'east');
    await f.save(['payroll'], 'global');
    const user = { Username: 'buyer', Role: 'Procurement Officer', BranchId: '' };
    const main = await f.reader.requireStaffSession(f.env, await f.requestFor(user, 'main'));
    assert.ok(main.allowedSections.includes('incomeAnalytics'));
    assert.equal(main.branchId, 'main');
    assert.equal(main.assignedBranchId, '');
    const east = await f.reader.requireStaffSession(f.env, await f.requestFor(user, 'east'));
    assert.ok(!east.allowedSections.includes('incomeAnalytics'));
    assert.ok(east.allowedSections.includes('staffAttendance'));
    const all = await f.reader.requireStaffSession(f.env, await f.requestFor(user, 'all'));
    assert.ok(!all.allowedSections.includes('incomeAnalytics'), 'all-branch access must not inherit a branch-only grant');
    assert.ok(!all.allowedSections.includes('staffAttendance'));
    await assert.rejects(f.reader.requireStaffSession(f.env, await f.requestFor({ ...user, BranchId: 'main' }, 'east')), error => error.status === 403);
    await assert.rejects(f.reader.requireStaffSession(f.env, await f.requestFor(user, 'unknown')), error => error.status === 403);
    const refreshed = await f.session.onRequestGet({ env: f.env, request: await f.requestFor(user, 'main') });
    assert.equal(refreshed.status, 200);
    const refreshedBody = await refreshed.json();
    assert.ok(refreshedBody.user.allowedSections.includes('incomeAnalytics'));
    assert.equal(refreshedBody.user.activeBranchId, 'main');
    assert.equal(refreshedBody.user.assignedBranchId, '');
  });
}

test('policy read failures do not silently use defaults or overwrite existing role settings', async () => {
  const f = fixture();
  await f.save(['incomeAnalytics']);
  const request = await f.requestFor({ Username: 'buyer', Role: 'Procurement Officer', BranchId: 'main' });
  await f.reader.requireStaffSession(f.env, request); // Warm the configuration cache.
  const previous = clone(await f.getPolicy());
  const count = f.writes.length;
  f.failPolicyReads(Object.assign(new Error('Policy database temporarily unavailable'), { status: 503 }));
  await assert.rejects(f.reader.requireStaffSession(f.env, request), /temporarily unavailable/);
  await assert.rejects(f.save(['staffAttendance']), /temporarily unavailable/);
  await assert.rejects(f.admin.resetRoleAccess(f.env, { branchId: 'main', edition: 'school' }, { Role: 'Procurement Officer' }), /temporarily unavailable/);
  assert.equal(f.writes.length, count);
  f.failPolicyReads(null);
  assert.deepEqual(clone(await f.getPolicy()), previous);
});

test('session refresh uses the same working-branch access resolver as authenticated requests', () => {
  assert.ok(sessionSource.includes('staffUserForRequest(context.env, user, context.request)'));
});

test('initial dashboard opens the selected branch with its server-provided role permissions', async () => {
  const requests = [];
  const context = vm.createContext({
    clean: value => String(value ?? '').trim(), activeSection: 'overview', selectedBranchId: 'all',
    legacyDashboardSections: new Set(), availableBranches: [], dashboardStatus: {},
    setDashboardRefreshLoading() {}, setStatus() {}, readStoredStaffBranch: () => 'main'
  });
  context.staffFetch = async () => {
    const branch = context.selectedBranchId;
    requests.push(branch);
    return Response.json({ ok: true, branches: [{ id: 'main' }], defaultBranchId: 'main',
      user: { canSwitchBranches: true, branchId: branch === 'all' ? '' : branch, activeBranchId: branch,
        allowedSections: branch === 'all' ? ['procurement'] : ['procurement', 'incomeAnalytics'] } });
  };
  const start = adminSource.indexOf('async function loadDashboard(options = {})');
  const end = adminSource.indexOf('    dashboardData = merge ?', start);
  // Execute the real network/branch-selection path, stopping before DOM rendering.
  vm.runInContext(`${adminSource.slice(start, end)}\nreturn data; } finally {} }`, context);
  const result = await context.loadDashboard({ mode: 'shell' });
  assert.deepEqual(requests, ['all', 'main']);
  assert.equal(result.user.activeBranchId, 'main');
  assert.ok(result.user.allowedSections.includes('incomeAnalytics'));
});
