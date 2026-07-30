import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildRequisitionResubmission } from '../functions/api/finance-workflow.js';

const portalRoot = new URL('../', import.meta.url);
const [workflowApi, adminJs] = await Promise.all([
  readFile(new URL('functions/api/finance-workflow.js', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8')
]);

const admin = {
  role: 'Super Admin',
  username: 'admin',
  displayName: 'System Administrator',
  branchId: 'main',
  schoolSectionAccess: 'Secondary'
};

test('standard requisition resubmission archives the prior revision and resets decisions', () => {
  const timestamp = '2026-07-30T10:00:00.000Z';
  const existing = {
    ExpenseNo: 'WEB-REQ-001',
    Description: 'Old purpose',
    Amount: 12000,
    Vendor: 'Old vendor',
    Status: 'Approved',
    RevisionNumber: 2,
    RequestedAt: '2026-07-20T09:00:00.000Z',
    ApprovedAt: '2026-07-21T09:00:00.000Z',
    ApprovedBy: 'Approver',
    AccountsReviewStatus: 'Reviewed',
    AccountsReviewedBy: 'Accounts',
    __id: 'WEB-REQ-001',
    __updateTime: '2026-07-21T09:00:00.000001Z'
  };
  const result = buildRequisitionResubmission(existing, {
    description: 'Corrected purpose',
    amount: '14500',
    vendor: 'New vendor',
    date: '2026-08-02',
    reference: 'REF-2',
    notes: 'Corrected by administrator'
  }, admin, timestamp);

  assert.equal(result.priorRevision, 2);
  assert.equal(result.nextRevision, 3);
  assert.equal(result.revision.RevisionNumber, 2);
  assert.equal(result.revision.Snapshot.Description, 'Old purpose');
  assert.equal(result.revision.Snapshot.Status, 'Approved');
  assert.equal(result.revision.Snapshot.__updateTime, undefined);
  assert.equal(result.payload.Description, 'Corrected purpose');
  assert.equal(result.payload.Amount, 14500);
  assert.equal(result.payload.Status, 'Submitted');
  assert.equal(result.payload.RevisionNumber, 3);
  assert.equal(result.payload.OriginalRequestedAt, existing.RequestedAt);
  assert.equal(result.payload.ApprovedAt, '');
  assert.equal(result.payload.ApprovedBy, '');
  assert.equal(result.payload.AccountsReviewStatus, '');
  assert.equal(result.payload.ResubmittedByUsername, 'admin');
});

test('material requisition resubmission recalculates line and grand totals', () => {
  const result = buildRequisitionResubmission({
    ExpenseNo: 'WEB-MAT-001',
    RequisitionType: 'Material',
    Status: 'Rejected',
    RevisionNumber: 1,
    MaterialItems: [{ SNo: 1, Item: 'Old item', Specification: 'Old', Quantity: 1, UnitPrice: 50, Total: 50 }]
  }, {
    description: 'Updated supplies',
    items: [
      { item: 'Paper', specification: 'A4', quantity: 3, unitPrice: 2500 },
      { item: 'Ink', specification: 'Black', quantity: 2, unitPrice: 6000 }
    ]
  }, admin, '2026-07-30T11:00:00.000Z');

  assert.equal(result.payload.MaterialItems.length, 2);
  assert.deepEqual(result.payload.MaterialItems.map((item) => item.SNo), [1, 2]);
  assert.equal(result.payload.MaterialItems[0].Total, 7500);
  assert.equal(result.payload.Amount, 19500);
  assert.equal(result.payload.Status, 'Submitted');
});

test('final finance records cannot be edited and resubmitted', () => {
  assert.throws(() => buildRequisitionResubmission({
    ExpenseNo: 'WEB-REQ-PAID',
    Status: 'Paid',
    Description: 'Already paid',
    Amount: 100
  }, {
    description: 'Changed',
    amount: 200
  }, admin), /cannot be edited and resubmitted/i);
});

test('finance workflow exposes a Super Admin edit and resubmit action with concurrency and audit controls', () => {
  assert.match(workflowApi, /clean\(user\.role\) !== 'Super Admin'/);
  assert.match(workflowApi, /!existing \|\| !scopedRows\(\[existing\], user, capabilities\(user\)\)\.length/);
  assert.match(workflowApi, /clientVersion !== clean\(existing\.__updateTime\)/);
  assert.match(workflowApi, /collectionPath: 'accountingExpenseRevisions'/);
  assert.match(workflowApi, /const audit = auditWrite\([\s\S]*?'EDIT AND RESUBMIT'[\s\S]*?timestamp,\s*existing\s*\)/);
  assert.match(workflowApi, /await commitFinanceDecision\(env, \[[\s\S]*?audit\s*\]\)/);
  assert.match(workflowApi, /action === 'resubmitrequisition'/);
  assert.match(workflowApi, /documentId: endorsementId\(id, 'accounts'\),[\s\S]*?operation: 'delete'/);
});

test('web companion gives Super Admin a populated edit-and-resubmit form', () => {
  assert.match(adminJs, /data-edit-requisition=/);
  assert.match(adminJs, /function openRequisitionEditor\(record\)/);
  assert.match(adminJs, /recordVersion/);
  assert.match(adminJs, /resubmitRequisition/);
  assert.match(adminJs, /Resubmission archives this revision and resets approval and Accounts review/);
});
