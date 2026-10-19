// Read-only audit: every persistence function below is an in-memory adapter.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { resolveStaffAssignmentBranch, staffAssignmentActor } from '../../functions/lib/staff-branch-context.js';
import { actorBranchScope, branchRecordVisible } from '../../functions/lib/branch-scope.js';

const read = path => fs.readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const moduleBody = source => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');
const source = await read('functions/api/staff-users.js');
function staffSandbox(rows, actor) {
  const written = [];
  const context = vm.createContext({
    crypto, Date, console, WEB_SECTION_KEYS: [], EXTERNAL_AUDITOR_ROLE: 'External Auditor',
    resolveStaffAssignmentBranch, staffAssignmentActor, actorBranchScope, branchRecordVisible,
    staffRecordMatchesEdition: () => true, normalizeOrganizationEdition: value => value,
    staffRoleAllowedForEdition: () => true, filterSectionsForFeatures: value => value,
    accountingCodeAllowedForEdition: () => true, canEditRequisitions: () => false,
    requisitionEditGrant: () => false, requisitionEditPermissionAuditWrite: () => null,
    formatPersonName: row => row.DisplayName || row.Username || 'Fixture User',
    staffAccountsForSubscription: value => value,
    enforceSubscriptionUserLimit: async () => {}, assertSubscriptionSeatAvailable: () => {},
    loadSubscriptionUserLimit: async () => 250,
    hashStaffPassword: async () => ({ PasswordHash: 'synthetic-only' }),
    getSchoolStructure: async () => ({ Branches: [{ Id: 'main' }, { Id: 'east' }] }),
    loadOrganizationNameProfile: async () => ({}), listCollection: async () => rows,
    batchUpsertDocuments: async (_env, writes) => written.push(...structuredClone(writes)),
    upsertDocument: async () => {},
  });
  vm.runInContext(moduleBody(source), context);
  return { context, written, actor };
}
const globalActor = { username: 'owner', role: 'Super Admin', edition: 'school', canSwitchBranches: true };

{
  const rows = [{ __id: 'admin', Username: 'admin', Role: 'Super Admin', Active: true },
    { __id: 'other-owner', Username: 'other-owner', Role: 'Super Admin', Active: true }];
  const { context, written } = staffSandbox(rows, globalActor);
  const result = await context.saveUser({}, globalActor, { Username: 'admin', Role: 'Admin', Password: 'synthetic-only' });
  assert.equal(result.ok, true);
  assert.equal(written[0].documentId, 'admin');
  assert.equal(written[0].data.Role, 'Admin');
  console.log('CONFIRMED: New-account save for an existing username can demote that account when another Super Admin exists.');
}
{
  const rows = [{ __id: 'alice-example.com', Username: 'alice@example.com', Role: 'Super Admin', Active: true, BranchId: 'east' }];
  const actor = { username: 'branch-owner', role: 'Super Admin', edition: 'school', branchId: 'main', assignedBranchId: 'main', canSwitchBranches: false };
  const { context, written } = staffSandbox(rows, actor);
  const result = await context.saveUser({}, actor, { Username: 'alice-example.com', Role: 'Admin', Password: 'synthetic-only', BranchId: 'main' });
  assert.equal(result.ok, true);
  assert.equal(written[0].documentId, rows[0].__id);
  assert.equal(written[0].data.BranchId, 'main');
  console.log('CONFIRMED: Distinct username collision overwrites the other branch account document, bypassing existing-account checks.');
}
{
  const rows = [{ __id: 'owner', Username: 'owner', Role: 'Super Admin', Active: true }];
  const { context, written } = staffSandbox(rows, globalActor);
  const result = await context.importUsers({}, globalActor, { users: [{ Username: 'owner', FirstName: 'Fixture', Surname: 'Owner', Role: 'Admin' }] });
  assert.equal(result.imported, 1);
  assert.equal(written[0].data.Role, 'Admin');
  console.log('CONFIRMED: CSV import can demote the only active Super Admin; it lacks the single-save last-admin guard.');
}

{
  const source = await read('functions/lib/branch-profile-settings.js');
  const writes = [];
  const context = vm.createContext({ Date, safeScopeId: value => value,
    getSchoolStructure: async () => ({ Branches: [{ Id: 'main' }] }),
    getDocument: async () => { throw new Error('Synthetic temporary read outage'); },
    upsertDocument: async (_env, path, id, data) => writes.push({ path, id, data }),
    deleteDocument: async () => assert.fail('No deletion expected')
  });
  vm.runInContext(moduleBody(source), context);
  await context.saveBranchProfileOverrides({}, { branchId: 'main', defaultProfile: {}, submittedProfile: { SchoolPhone: 'test-phone' } });
  assert.deepEqual(Object.keys(writes[0].data.Values), ['SchoolPhone']);
  console.log('CONFIRMED: A failed branch override read still performs a whole-document save containing only the submitted field.');
}

{
  const source = await read('functions/lib/organization-backup.js');
  const slice = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
  const context = vm.createContext({
    clean: value => String(value ?? '').trim(), lower: value => String(value ?? '').trim().toLowerCase(),
    getDocument: async () => { throw new Error('Synthetic temporary read outage'); },
    restoreError: message => new Error(message)
  });
  vm.runInContext(slice('const SUBSCRIPTION_IDENTITY_SETTING_FIELDS =', 'const RESET_PRESERVED_ROOT_COLLECTIONS ='), context);
  vm.runInContext(slice('function withoutTransportMetadata(', 'export function sanitizeBackupDocument('), context);
  vm.runInContext(slice('async function protectedRestoreDocument(', 'export async function writeOrganizationRestoreChunk('), context);
  const restored = await context.protectedRestoreDocument({}, 'settings', {
    __id: 'organisationProfile', WorkspaceId: 'old-id', Edition: 'faith', Plan: 'Professional'
  }, { username: 'owner' });
  assert.equal(restored.data.WorkspaceId, 'old-id');
  assert.equal(restored.data.Edition, 'faith');
  console.log('CONFIRMED: Failed live-profile read during restore returns backup identity values as a writable document instead of stopping.');
}
