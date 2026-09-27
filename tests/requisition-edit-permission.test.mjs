import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { canEditRequisitions, requisitionEditGrant, assertRequisitionEditPermission, requisitionEditPermissionAuditWrite } from '../functions/lib/requisition-edit-permission.js';
import { resolveAuthoritativeDesktopActor, applyAuthoritativeActor } from '../functions/lib/backend-security.js';
import { buildRequisitionResubmission } from '../functions/api/finance-workflow.js';
import { requisitionChangedFields, requisitionEditDetails } from '../functions/lib/requisition-edit-history.js';
import { requisitionWorkflowStatus, REQUISITION_STATUS, assertRequisitionTransition } from '../functions/lib/requisition-workflow.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const workflow = await readFile(new URL('../functions/api/finance-workflow.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');

test('edit access is opt-in per officer, separate from approvals, with existing administrator parity', () => {
  for (const role of ['Accounts Officer', 'Admin', 'Management', 'Department User']) {
    assert.equal(canEditRequisitions({ role, approvalEnabled: true }), false);
    assert.equal(canEditRequisitions({ role, approvalEnabled: true, requisitionEditEnabled: true }), true);
    assert.equal(canEditRequisitions({ role, approvalEnabled: true, requisitionEditEnabled: false }), false);
  }
  assert.equal(canEditRequisitions({ role: 'Department User', RequisitionEditEnabled: true, ApprovalEnabled: false }), false);
  for (const role of ['Super Admin', 'Director']) assert.equal(canEditRequisitions({ role }), true);
  for (const invalid of [false, 'false', 'NO', 'disabled', 'anything', 0, null, undefined]) {
    assert.equal(requisitionEditGrant(invalid, { Role: 'Accounts Officer' }), false);
  }
  assert.equal(canEditRequisitions({ role: 'Management', assignedRole: 'Admin', requisitionEditEnabled: true }), true);
});

test('desktop grant and revocation use current database permission, not submitted permission flags', () => {
  const body = { UserUsername: 'accounts', UserRole: 'Super Admin', UserRequisitionEditEnabled: true, RequisitionEditEnabled: true };
  for (const granted of [true, false]) {
    const actor = resolveAuthoritativeDesktopActor(body, [{ Username: 'accounts', Role: 'Accounts Officer',
      RequisitionEditEnabled: granted, Active: true }]);
    const authoritative = applyAuthoritativeActor(body, actor);
    assert.equal(authoritative.UserRequisitionEditEnabled, granted);
    assert.equal(canEditRequisitions(actor), granted);
  }
  assert.throws(() => resolveAuthoritativeDesktopActor(body, [{ Username: 'accounts', Active: false }]), /disabled/);
});

function resubmitHarness(existing, writes, reads) {
  const source = workflow.slice(workflow.indexOf('export async function resubmitRequisition('), workflow.indexOf('\nasync function submitBill(')).replace('export ', '');
  return vm.runInNewContext(`(${source})`, {
    clean, assertRequisitionEditPermission, safeId: value => value,
    getDocument: async () => { reads.count++; return existing; },
    scopedRows: (rows, user) => rows.filter(row => !user.branchId || row.BranchId === user.branchId),
    capabilities: () => ({}), assertRequisitionResubmittable() {},
    nowIso: () => '2026-09-27T11:30:00Z', buildRequisitionResubmission, requisitionEditDetails,
    auditWrite: (user, action, type, id, details) => ({ collectionPath: 'accountingAudit', data: { User: user.displayName, Action: action, Details: details } }),
    commitFinanceDecision: async (_env, batch) => { writes.push(...batch); },
    documentVersion: row => row.__updateTime, endorsementId: (id, stage) => `${id}-${stage}`,
    notifyStaffRequisitionSubmitted: async () => {}, actor: user => user.displayName
  });
}

test('granted web/desktop officers reset earlier approvals and keep named revision and audit atomically', async () => {
  const existing = { ExpenseNo: 'REQ-1', Status: 'Admin Reviewed', Date: '2026-09-27', Amount: 100,
    Description: 'Repairs', BranchId: 'main', RevisionNumber: 2, __updateTime: 'v2',
    AccountsConfirmedBy: 'Previous accounts', AdminStageReviewedBy: 'Previous admin' };
  for (const role of ['Accounts Officer', 'Admin', 'Management']) {
    const writes = [], reads = { count: 0 };
    const submit = resubmitHarness(existing, writes, reads);
    const user = { role, displayName: 'Chosen Officer', username: 'chosen', branchId: 'main', requisitionEditEnabled: true };
    await submit({}, user, { recordId: 'REQ-1', recordVersion: 'v2', date: existing.Date, description: 'Revised repairs', amount: 120 });
    const record = writes.find(write => write.collectionPath === 'accountingExpenses');
    assert.equal(record.data.Status, 'Submitted');
    assert.equal(record.data.AccountsConfirmedBy, '');
    assert.equal(record.data.AdminStageReviewedBy, '');
    assert.equal(record.data.EditHistory[0].Officer, 'Chosen Officer');
    assert.equal(record.data.RevisionNumber, 3);
    assert.equal(record.updateTime, 'v2');
    assert.equal(writes.filter(write => write.collectionPath === 'accountingExpenseRevisions').length, 1);
    assert.equal(writes.filter(write => write.operation === 'delete').length, 6);
    assert.equal(writes.filter(write => write.collectionPath === 'accountingAudit').length, 1);
  }
});

test('ungranted/revoked access, foreign branch, stale record and final approval remain fail-closed', async () => {
  const existing = { ExpenseNo: 'REQ-1', Status: 'Submitted', BranchId: 'main', __updateTime: 'v2' };
  const user = { username: 'chosen', role: 'Accounts Officer', branchId: 'main', requisitionEditEnabled: true };
  const writes = [], reads = { count: 0 };
  const submit = resubmitHarness(existing, writes, reads);
  await assert.rejects(submit({}, { ...user, requisitionEditEnabled: false }, {}), error => error.code === 'REQUISITION_EDIT_PERMISSION_REQUIRED');
  assert.equal(reads.count, 0);
  await assert.rejects(submit({}, { ...user, branchId: 'west' }, { recordId: 'REQ-1' }), error => error.status === 404);
  await assert.rejects(submit({}, user, { recordId: 'REQ-1', recordVersion: 'old' }), error => error.code === 'FINANCE_WRITE_CONFLICT');
  const finalSubmit = resubmitHarness({ ...existing, AdminReviewedAt: '2026-09-27', Status: 'Approved' }, writes, reads);
  await assert.rejects(finalSubmit({}, user, { recordId: 'REQ-1', recordVersion: 'v2' }), /approved requisition cannot be edited/);
  const legacyApproved = resubmitHarness({ ...existing, Status: 'Approved' }, writes, reads);
  await assert.rejects(legacyApproved({}, user, { recordId: 'REQ-1', recordVersion: 'v2' }), /approved requisition cannot be edited/);
  assert.equal(writes.length, 0);
});

test('officer checkbox honours eligibility, revocation and administrator role changes', async () => {
  const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const source = admin.slice(admin.indexOf('function syncRequisitionEditPermission('), admin.indexOf('\nfunction openStaffUserDialog('));
  const sync = vm.runInNewContext(`(${source})`, { clean });
  const input = { checked: false, disabled: false };
  const help = { textContent: '' };
  const form = { elements: { RequisitionEditEnabled: input, Role: { value: 'Accounts Officer' }, ApprovalEnabled: { checked: false } },
    querySelector: () => help };
  sync(form);
  assert.equal(input.disabled, false);
  assert.equal(input.checked, false);
  input.checked = true;
  sync(form);
  assert.equal(input.checked, true);
  form.elements.Role.value = 'Department User';
  form.elements.ApprovalEnabled.checked = true;
  sync(form);
  assert.equal(input.checked, true);
  form.elements.ApprovalEnabled.checked = false;
  sync(form);
  assert.equal(input.checked, false);
  assert.equal(input.disabled, true);
  form.elements.Role.value = 'Director';
  sync(form, true);
  assert.equal(input.checked, true);
  assert.equal(input.disabled, true);
  form.elements.Role.value = 'Admin';
  sync(form, true);
  assert.equal(input.checked, false);
  assert.equal(input.disabled, false);
});

test('legacy desktop edit is routed through the same permission guard, while status transitions cannot alter amounts', async () => {
  const source = backend.slice(backend.indexOf('function accountingRequisitionActor('), backend.indexOf('\nfunction validImprestDate('));
  const existing = { ExpenseNo: 'REQ-1', Status: 'Submitted', Description: 'Repairs', Amount: 100, Date: '2026-09-27', __updateTime: 'v2' };
  let delegated = 0;
  const save = vm.runInNewContext(`(() => { ${source}; return saveAccountingExpense; })()`, {
    clean, lower, requireAccountingRole() {}, DEPARTMENT_ACCOUNTING_ROLES: [],
    getDocumentByIdOrField: async () => existing, accountingWriteBranch: () => 'main',
    accountingRequestBranch: () => 'main', accountingDepartment: () => '', asMoneyNumber: Number,
    requisitionWorkflowStatus, REQUISITION_STATUS, assertRequisitionTransition, assertRequisitionEditPermission,
    enforceDepartmentSubmission: () => '', nowIso: () => '2026-09-27T11:30:00Z', requisitionChangedFields,
    resubmitRequisition: async (_env, user) => { assertRequisitionEditPermission(user); delegated++; return { ok: true }; }
  });
  const input = { ...existing, UserUsername: 'accounts', UserRole: 'Accounts Officer', RecordedBy: 'Officer', RecordVersion: 'v2' };
  await assert.rejects(save({}, { ...input, Amount: 200 }), error => error.code === 'REQUISITION_EDIT_PERMISSION_REQUIRED');
  assert.equal(delegated, 0);
  await save({}, { ...input, Amount: 200, UserRequisitionEditEnabled: true });
  assert.equal(delegated, 1);
  await assert.rejects(save({}, { ...input, Status: 'Accounts Confirmed', Amount: 200, UserRequisitionEditEnabled: true }), error => error.code === 'REQUISITION_EDIT_REQUIRES_RESUBMISSION');
});

test('permission control is saved independently from approval authority and consumed by the web workflow', async () => {
  const [users, admin] = await Promise.all([
    readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
  ]);
  assert.match(users, /ensureSuperAdmin\(actor\);/);
  assert.match(users, /RequisitionEditEnabled: requisitionEditGrant/);
  assert.match(users, /requisitionEditPermissionAuditWrite\(existing \|\| \{\}, payload, actor\)/);
  assert.match(users, /\.\.\.\(permissionAudit \? \[permissionAudit\] : \[\]\)/);
  assert.match(admin, /name="RequisitionEditEnabled"/);
  assert.match(admin, /payload\.RequisitionEditEnabled = form\.elements\.RequisitionEditEnabled\.checked/);
  assert.match(admin, /type === 'requisition' && capabilities\.canEditRequisitions/);
});

test('grant and revocation audit identifies the deciding administrator and exact officer', () => {
  const officer = { Username: 'ada', DisplayName: 'Ada Officer', Role: 'Accounts Officer', BranchId: 'west' };
  const actor = { username: 'super', displayName: 'Super Administrator', sourcePlatform: 'Desktop' };
  const granted = { ...officer, RequisitionEditEnabled: true };
  const grant = requisitionEditPermissionAuditWrite(officer, granted, actor);
  assert.equal(grant.collectionPath, 'staffSecurityAudit');
  assert.equal(grant.data.Action, 'GRANT REQUISITION EDIT ACCESS');
  assert.equal(grant.data.ActorUsername, 'super');
  assert.equal(grant.data.Actor, 'Super Administrator');
  assert.equal(grant.data.Username, 'ada');
  assert.equal(grant.data.BranchId, 'west');
  assert.equal(grant.data.SourcePlatform, 'Desktop');
  assert.match(grant.data.Details, /Ada Officer.*Accounts Officer.*granted/);
  const revoke = requisitionEditPermissionAuditWrite(granted, officer, actor);
  assert.equal(revoke.data.Action, 'REVOKE REQUISITION EDIT ACCESS');
  assert.equal(requisitionEditPermissionAuditWrite(granted, granted, actor), null);
});

test('large staff imports keep every permission grant and officer update in the same bounded batch', async () => {
  const usersSource = await readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8');
  const source = usersSource.slice(usersSource.indexOf('async function importUsers('), usersSource.indexOf('\nasync function deleteUser('));
  const batches = [];
  const importer = vm.runInNewContext(`(${source})`, {
    clean, lower, listCollection: async () => [], normalizeOrganizationEdition: value => value,
    loadSubscriptionUserLimit: async () => 1000, staffAccountsForSubscription: rows => rows,
    getSchoolStructure: async () => ({}), loadOrganizationNameProfile: async () => ({}),
    requiredStaffImportIdentity: row => row, staffImportIdentity: row => ({ ...row, DisplayName: `${row.FirstName} ${row.Surname}` }),
    safeId: value => value, ensureRoleAvailable() {}, assertSubscriptionSeatAvailable() {},
    resolveStaffAssignmentBranch: () => 'main', assignmentActor: (_env, actor) => actor,
    schoolSectionAccessForRole: () => 'All', activeValue: value => value === true,
    requisitionEditGrant, requisitionEditPermissionAuditWrite, scopedApprovalAccounts: () => [],
    explicitOptIn: value => value === true, scopedTabAccess: () => [], nowIso: () => '2026-09-27',
    batchUpsertDocuments: async (_env, batch) => batches.push(batch), audit: async () => {}, actorBranchScope: () => 'main'
  });
  const result = await importer({}, { username: 'super', displayName: 'Super Administrator', edition: 'school' }, {
    users: Array.from({ length: 500 }, (_, index) => ({ Username: `officer-${index}`, FirstName: 'Officer', Surname: `${index}`,
      Role: 'Accounts Officer', RequisitionEditEnabled: true }))
  });
  assert.equal(result.imported, 500);
  assert.equal(result.failures.length, 0);
  assert.equal(batches.length, 2);
  for (const batch of batches) {
    assert.equal(batch.length, 500);
    for (let index = 0; index < batch.length; index += 2) {
      assert.equal(batch[index].collectionPath, 'staffUsers');
      assert.equal(batch[index].data.RequisitionEditEnabled, true);
      assert.equal(batch[index + 1].data.Username, batch[index].data.Username);
      assert.equal(batch[index + 1].data.Action, 'GRANT REQUISITION EDIT ACCESS');
    }
  }
});
