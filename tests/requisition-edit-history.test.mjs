import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { recordRequisitionEdit, requisitionEditHistory, requisitionEditDetails, requisitionChangedFields } from '../functions/lib/requisition-edit-history.js';
import { assertRequisitionEditPermission } from '../functions/lib/requisition-edit-permission.js';
import { buildRequisitionResubmission } from '../functions/api/finance-workflow.js';
import { applyAuthoritativeActor } from '../functions/lib/backend-security.js';
import { REQUISITION_STATUS, requisitionWorkflowStatus, assertRequisitionTransition } from '../functions/lib/requisition-workflow.js';

const timestamp = '2026-09-27T10:00:00Z';
const officer = { username: 'ada', displayName: 'Ada Director', role: 'Super Admin', assignedRole: 'Director' };
const before = { ExpenseNo: 'REQ-1', Description: 'Repairs', Date: '2026-09-27', Amount: 100,
  Status: 'Submitted', RevisionNumber: 1, __updateTime: 'version-1', RequestedByUsername: 'ada' };

test('web resubmission records the authenticated editor, exact action and changed fields', () => {
  const { payload, revision } = buildRequisitionResubmission(before, {
    description: 'Replace roof', date: before.Date, amount: 120,
    EditedBy: 'Forged officer', EditHistory: [{ Officer: 'Forged' }], approvalPassword: 'private'
  }, officer, timestamp);
  assert.equal(payload.EditedBy, 'Ada Director');
  assert.equal(payload.EditedByRole, 'Director');
  assert.equal(payload.EditHistory[0].Action, 'EDIT AND RESUBMIT REQUISITION');
  assert.deepEqual(payload.EditHistory[0].ChangedFields, ['Description', 'Amount']);
  assert.equal(payload.EditedAt, timestamp);
  assert.equal(revision.Snapshot.Amount, 100);
  assert.deepEqual(revision.Edit, payload.EditHistory[0]);
  assert.doesNotMatch(JSON.stringify(payload.EditHistory), /Forged|private/);
});

test('successive edits preserve earlier officers and ignore no-op saves', () => {
  const first = { ...before, Amount: 120 };
  recordRequisitionEdit(before, first, officer, timestamp);
  const second = { ...first, Description: 'More repairs' };
  recordRequisitionEdit(first, second, { username: 'ben', displayName: 'Ben Accounts', role: 'Accounts Officer' }, timestamp);
  assert.equal(second.RevisionNumber, 3);
  assert.deepEqual(second.EditHistory.map(row => row.Officer), ['Ada Director', 'Ben Accounts']);
  assert.equal(first.EditHistory.length, 1);
  assert.equal(recordRequisitionEdit(second, { ...second }, officer, timestamp), null);
  assert.match(requisitionEditDetails(second.EditHistory[1]), /changed: Description/);
});

test('legacy resubmissions are visible but a reviewer is never misrepresented as an editor', () => {
  assert.deepEqual(requisitionEditHistory({ UpdatedBy: 'Approver', UpdatedAt: timestamp }), []);
  const history = requisitionEditHistory({ ResubmittedBy: 'Old Editor', ResubmittedAt: timestamp });
  assert.equal(history[0].Officer, 'Old Editor');
  assert.equal(history[0].Legacy, true);
  assert.deepEqual(history[0].ChangedFields, []);
});

const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const saveSource = backend.slice(backend.indexOf('function accountingRequisitionActor('), backend.indexOf('\nfunction validImprestDate('));
function desktopHarness(existing, commit) {
  return vm.runInNewContext(`(() => { ${saveSource}; return saveAccountingExpense; })()`, {
    clean: value => String(value ?? '').trim(), lower: value => String(value ?? '').trim().toLowerCase(),
    requireAccountingRole() {}, DEPARTMENT_ACCOUNTING_ROLES: [],
    accountingRequestBranch: () => 'main', accountingDepartment: () => '', assertRequisitionEditPermission, requisitionChangedFields,
    getDocumentByIdOrField: async () => structuredClone(existing), accountingWriteBranch: () => 'main',
    asMoneyNumber: Number, REQUISITION_STATUS, requisitionWorkflowStatus, assertRequisitionTransition,
    enforceDepartmentSubmission: () => '', nowIso: () => timestamp, recordRequisitionEdit, requisitionEditDetails,
    accountingAuditWrite: (Action, EntityType, EntityId, body, Details) => ({ collectionPath: 'accountingAudit',
      documentId: 'AUD-1', data: { Action, EntityType, EntityId, UserName: body.RecordedBy, Details } }),
    safeDocumentId: value => value, batchUpsertDocuments: commit, notifyStaffRequisitionEvent: async () => {}
  });
}

test('desktop saves edit, previous snapshot and named audit in a single conditional commit in every edition', async () => {
  for (const Edition of ['School', 'Church', 'Other Organisation']) {
    let writes;
    const draft = { ...before, Status: 'Draft' };
    const save = desktopHarness(draft, async (_env, batch) => { writes = batch; });
    const body = applyAuthoritativeActor({ ...draft, Amount: 150, RecordVersion: 'version-1',
      RecordedBy: 'Spoof', UserRole: 'Super Admin', Edition }, { ...officer, role: 'Director' });
    const result = await save({}, body);
    assert.equal(result.expense.EditedBy, 'Ada Director');
    assert.equal(result.expense.EditedByRole, 'Director');
    assert.equal(writes.length, 3);
    assert.equal(writes[0].updateTime, 'version-1');
    assert.equal(writes[1].data.Action, 'EDIT REQUISITION');
    assert.equal(writes[1].data.UserName, 'Ada Director');
    assert.equal(writes[2].exists, false);
    assert.equal(writes[2].data.Snapshot.Amount, 100);
    assert.equal(writes[2].data.Edit.Officer, 'Ada Director');
  }
});

test('desktop refuses stale edits and surfaces atomic commit failures', async () => {
  let commits = 0;
  const draft = { ...before, Status: 'Draft' };
  const save = desktopHarness(draft, async () => { commits++; throw new Error('conflict'); });
  const body = applyAuthoritativeActor({ ...draft, Amount: 130 }, { ...officer, role: 'Director' });
  await assert.rejects(save({}, { ...body, RecordVersion: 'old' }), error => error.code === 'FINANCE_WRITE_CONFLICT');
  assert.equal(commits, 0);
  await assert.rejects(save({}, body), /conflict/);
  assert.equal(commits, 1);
});

test('web print escapes officer and changed-field text and includes edit actions', async () => {
  const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('function requisitionEditHistoryBlock('), source.indexOf('\nfunction openFinanceRecordPrint('));
  const render = vm.runInNewContext(`(${block})`, { escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
  const html = render({ EditHistory: [{ Action: 'EDIT REQUISITION', Officer: '<script>bad</script>',
    Timestamp: timestamp, Role: 'Director', ChangedFields: ['Amount'], RevisionNumber: 2 }] });
  assert.match(html, /EDIT REQUISITION/);
  assert.match(html, /Revision 2/);
  assert.match(html, /Amount/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(render({ UpdatedBy: 'Approver' }), '');
});
