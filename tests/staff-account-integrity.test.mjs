import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeRecoveryEmail } from '../functions/lib/staff-password-recovery.js';
import { resolveStaffAssignmentBranch, staffAssignmentActor } from '../functions/lib/staff-branch-context.js';
import { actorBranchScope, branchRecordVisible } from '../functions/lib/branch-scope.js';
import { staffRoleAllowedForEdition, normalizeOrganizationEdition } from '../functions/lib/organization-config.js';

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const unmodule = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');
const integrity = await read('functions/lib/staff-account-integrity.js');
const staff = await read('functions/api/staff-users.js');
const sessionSource = (await read('functions/api/staff-session.js')).replace(/^export \{[^\n]+ from [^\n]+\r?$/gm, '');

function harness(users = []) {
  let revision = 0;
  const docs = new Map(users.map((row) => [`staffUsers/${row.__id || row.Username}`, { ...row, __updateTime: `v${++revision}` }]));
  const clone = (value) => value == null ? value : structuredClone(value);
  const batches = [];
  const database = {
    getDocument: async (_env, path, id) => clone(docs.get(`${path}/${id}`) || null),
    listCollection: async (_env, path) => [...docs].filter(([key]) => key.startsWith(`${path}/`))
      .map(([key, row]) => ({ ...clone(row), __id: key.slice(path.length + 1) })),
    batchCommitLiteralDocuments: async (_env, writes) => {
      for (const write of writes) {
        const stored = docs.get(`${write.collectionPath}/${write.documentId}`);
        if ((write.exists === false && stored) || (write.updateTime && stored?.__updateTime !== write.updateTime)) {
          throw Object.assign(new Error('Synthetic concurrent write'), { status: 412 });
        }
      }
      batches.push(clone(writes));
      for (const write of writes) {
        const key = `${write.collectionPath}/${write.documentId}`;
        if (write.operation === 'delete') docs.delete(key);
        else docs.set(key, { ...clone(write.data), __updateTime: `v${++revision}` });
      }
    },
    upsertDocument: async (env, collectionPath, documentId, data, options = {}) => {
      if (collectionPath !== 'staffUsers') return;
      await database.batchCommitLiteralDocuments(env, [{ collectionPath, documentId, data, ...options }]);
    },
  };
  const common = { crypto, Date, console, normalizeRecoveryEmail, ...database };
  const core = vm.createContext(common);
  vm.runInContext(unmodule(integrity), core);
  const context = vm.createContext({
    ...common,
    ...Object.fromEntries(['assertStaffAccountFinalState', 'beginStaffAccountChange', 'commitStaffAccountChanges',
      'resolveStaffAccountTarget', 'staffAccountCondition', 'staffAccountWrite'].map((name) => [name, core[name]])),
    WEB_SECTION_KEYS: [], EXTERNAL_AUDITOR_ROLE: 'External Auditor', resolveStaffAssignmentBranch,
    staffAssignmentActor, actorBranchScope, branchRecordVisible, staffRoleAllowedForEdition, normalizeOrganizationEdition,
    staffRecordMatchesEdition: (row, actor) => !row.OrganisationEdition || row.OrganisationEdition === actor.edition,
    filterSectionsForFeatures: value => value, accountingCodeAllowedForEdition: () => true,
    canEditRequisitions: () => false, requisitionEditGrant: () => false,
    requisitionEditPermissionAuditWrite: () => null,
    formatPersonName: row => row.DisplayName || row.Username || 'Fixture User',
    staffAccountsForSubscription: value => value,
    enforceSubscriptionUserLimit: async () => {}, assertSubscriptionSeatAvailable: () => {},
    loadSubscriptionUserLimit: async () => 1000,
    hashStaffPassword: async () => ({ PasswordHash: 'synthetic-hash' }),
    getSchoolStructure: async () => ({ Branches: [{ Id: 'main' }, { Id: 'east' }] }),
    loadOrganizationNameProfile: async () => ({}),
  });
  vm.runInContext(unmodule(staff), context);
  return { core, context, docs, batches, database };
}
const admin = (username, edition = 'school') => ({ __id: username, Username: username, Role: 'Super Admin', Active: true, OrganisationEdition: edition });
const actor = (edition = 'school') => ({ username: 'owner', role: 'Super Admin', edition, canSwitchBranches: true });

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: new staff creation never edits a duplicate username; explicit edit keeps the original ID`, async () => {
    const h = harness([admin('owner', edition), { ...admin('other', edition), __id: 'legacy@id' }]);
    await assert.rejects(h.context.saveUser({}, actor(edition), { Username: 'owner', Role: 'Admin', Password: 'fixture' }), /already exists/);
    assert.equal(h.batches.length, 0);
    await h.context.saveUser({}, actor(edition), { Username: 'other', OriginalUsername: 'other', Role: 'Super Admin' });
    assert.ok(h.docs.has('staffUsers/legacy@id'));
    assert.equal(h.docs.has('staffUsers/other'), false);
  });
  test(`${edition}: CSV cannot demote or disable the last active Super Admin`, async () => {
    for (const change of [{ Role: 'Front Desk' }, { Active: false }]) {
      const h = harness([admin('owner', edition)]);
      await assert.rejects(h.context.importUsers({}, actor(edition), { users: [
        { Username: 'owner', FirstName: 'Fixture', Surname: 'Owner', ...change }
      ] }), /active Super Admin/);
      assert.equal(h.batches.length, 0);
    }
  });
}

test('R02 normalized ID collisions and login aliases cannot overwrite another branch account', async () => {
  const h = harness([{ ...admin('alice@example.com'), __id: 'alice-example.com', BranchId: 'east' }]);
  await assert.rejects(h.context.saveUser({}, { ...actor(), branchId: 'main', assignedBranchId: 'main', canSwitchBranches: false },
    { Username: 'alice-example.com', Role: 'Admin', Password: 'fixture', BranchId: 'main' }), /conflicts/);
  assert.equal(h.docs.get('staffUsers/alice-example.com').BranchId, 'east');
  const aliases = harness([{ ...admin('owner'), LoginUsername: 'another-login' }]);
  await assert.rejects(aliases.context.saveUser({}, actor(), { Username: 'another-login', Password: 'fixture' }), /conflicts/);
});

test('R02 a CSV detects collisions within its own rows without corrupting the first account', async () => {
  const h = harness([admin('owner')]);
  const result = await h.context.importUsers({}, actor(), { users: [
    { Username: 'alice@example.com', FirstName: 'Alice', Surname: 'One' },
    { Username: 'alice-example.com', FirstName: 'Alice', Surname: 'Two' },
  ] });
  assert.equal(result.imported, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(h.docs.get('staffUsers/alice-example.com').Username, 'alice@example.com');
});

test('R03 simultaneous administrator demotions cannot remove both administrators', async () => {
  const h = harness([admin('owner'), admin('other')]);
  const results = await Promise.allSettled(['owner', 'other'].map(Username => h.context.saveUser({}, actor(), {
    Username, OriginalUsername: Username, Role: 'Admin'
  })));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal([...h.docs.values()].filter(row => row.Role === 'Super Admin').length, 1);
});

test('concurrent new account creation is create-only and requires a fresh directory', async () => {
  const h = harness([admin('owner')]);
  const results = await Promise.allSettled([1, 2].map(() => h.context.saveUser({}, actor(), {
    Username: 'new-user', Role: 'Teacher', Password: 'fixture'
  })));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(h.batches.length, 1);
});

test('CSV can safely promote a replacement before retiring the previous administrator', async () => {
  const h = harness([admin('owner')]);
  const result = await h.context.importUsers({}, actor(), { users: [
    { Username: 'owner', FirstName: 'Old', Surname: 'Owner', Role: 'Admin' },
    { Username: 'new-owner', FirstName: 'New', Surname: 'Owner', Role: 'Super Admin' },
  ] });
  assert.equal(result.imported, 2);
  assert.equal(h.docs.get('staffUsers/new-owner').Role, 'Super Admin');
  assert.equal(h.docs.get('staffUsers/owner').Role, 'Admin');
});

test('account edits require an existing original identity and cannot rename it', async () => {
  const h = harness([admin('owner')]);
  await assert.rejects(h.context.saveUser({}, actor(), { Username: 'new', OriginalUsername: 'owner' }), /cannot be changed/);
  await assert.rejects(h.context.saveUser({}, actor(), { Username: 'missing', OriginalUsername: 'missing' }), /no longer exists/);
});

test('web and desktop staff editors pass explicit original identities for edits only', async () => {
  const [web, desktop, backend] = await Promise.all([
    read('js/admin.js'), fs.readFile(new URL('../../suite/main.py', import.meta.url), 'utf8'), read('functions/api/backend.js')
  ]);
  assert.match(web, /form\.dataset\.originalUsername = user\?\.Username \|\| ''/);
  assert.match(web, /payload\.OriginalUsername = form\.dataset\.originalUsername \|\| ''/);
  assert.match(desktop, /original_username=selected_account/);
  assert.match(desktop, /original_username=updated\.get\("Username", ""\)/);
  const desktopSave = backend.slice(backend.indexOf('async function saveStaffUserFromDesktop('), backend.indexOf('async function deleteStaffUserFromDesktop('));
  assert.match(desktopSave, /resolveStaffAccountTarget/);
  assert.match(desktopSave, /commitStaffAccountChanges/);
});

function sessionHarness(h, overrides = {}) {
  const context = vm.createContext({
    crypto, Date, console, Headers, Response,
    ...h.database,
    ...Object.fromEntries(['beginStaffAccountChange', 'commitStaffAccountChanges', 'staffAccountCondition', 'staffAccountWrite']
      .map(name => [name, h.core[name]])),
    requireFirestoreEnv: () => {},
    readJsonBody: request => request.json(),
    readStaffSession: async () => ({ username: 'owner', role: 'Super Admin', mustChangePassword: true }),
    findStaffUserRecord: async (_env, username) => {
      const row = [...h.docs].find(([key, value]) => key.startsWith('staffUsers/') && value.Username === username);
      return row ? { ...structuredClone(row[1]), __id: row[0].slice('staffUsers/'.length) } : null;
    },
    loadOrganizationNameProfile: async () => ({}), loadStaffProfileImage: async () => null,
    formatPersonName: row => [row.FirstName, row.Surname].filter(Boolean).join(' '),
    hashStaffPassword: async () => ({ PasswordHash: 'new-test-hash' }),
    verifyStaffApprovalPassword: async () => true,
    createStaffSession: async () => 'synthetic-session', staffSessionCookie: () => 'test-session=1',
    staffAccessFor: async () => ({}), staffUserForAccess: user => user,
    clearStaffSessionCookie: () => '', clearLegacyStaffSessionCookie: () => '', clearStaffApprovalProofCookie: () => '',
    ...overrides,
  });
  vm.runInContext(unmodule(sessionSource), context);
  return body => context.onRequestPost({ env: { ADMIN_WEB_USERNAME: 'owner' }, request: { json: async () => body } });
}

const profileBody = { action: 'updateprofile', firstName: 'Test', surname: 'Owner' };
const passwordBody = { action: 'changepassword', password: 'new-test-password', confirmPassword: 'new-test-password' };
const loginBody = { action: 'updatelogindetails', currentPassword: 'test-only', loginUsername: 'renamed-login' };

test('self-service profile and password edits preserve the stored ID and authorization', async () => {
  for (const body of [profileBody, passwordBody, loginBody]) {
    const h = harness([{ ...admin('owner'), __id: 'legacy@owner' }]);
    const response = await sessionHarness(h)(body);
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(h.docs.get('staffUsers/legacy@owner').Role, 'Super Admin');
    assert.equal(h.docs.has('staffUsers/owner'), false);
  }
});

test('concurrent profile/password edits cannot replay a stale role or re-enable a disabled account', async () => {
  for (const body of [profileBody, passwordBody]) {
    const h = harness([admin('owner')]);
    const response = await sessionHarness(h, {
      loadOrganizationNameProfile: async () => {
        h.docs.set('staffUsers/owner', { ...h.docs.get('staffUsers/owner'), Role: 'Front Desk', Active: false, __updateTime: 'changed' });
        return {};
      },
    })(body);
    assert.equal(response.status, 412);
    assert.equal(h.docs.get('staffUsers/owner').Role, 'Front Desk');
    assert.equal(h.docs.get('staffUsers/owner').Active, false);
    assert.equal(h.batches.length, 0);
  }
});

test('own-login rename cannot race another account taking its requested login', async () => {
  const h = harness([admin('owner')]);
  const response = await sessionHarness(h, {
    verifyStaffApprovalPassword: async () => {
      await h.context.saveUser({}, actor(), { Username: 'renamed-login', Role: 'Teacher', Password: 'fixture' });
      return true;
    },
  })(loginBody);
  assert.equal(response.status, 409);
  assert.equal(h.docs.get('staffUsers/owner').LoginUsername, undefined);
  assert.equal(h.docs.get('staffUsers/renamed-login').Username, 'renamed-login');
});

test('environment-admin bootstrap distinguishes a missing account from a failed read', async () => {
  for (const body of [profileBody, passwordBody, loginBody]) {
    const h = harness();
    const successful = await sessionHarness(h)(body);
    assert.equal(successful.status, 200, JSON.stringify(await successful.json()));
    assert.equal(h.docs.get('staffUsers/owner').Role, 'Super Admin');
    const failing = harness();
    const response = await sessionHarness(failing, {
      findStaffUserRecord: async () => { throw Object.assign(new Error('Unavailable'), { status: 503 }); },
    })(body);
    assert.equal(response.status, 503);
    assert.equal(failing.batches.length, 0);
  }
});
