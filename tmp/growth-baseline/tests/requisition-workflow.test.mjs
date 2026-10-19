import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  REQUISITION_STATUS,
  assertRequisitionTransition,
  requisitionCapabilities,
  requisitionWorkflowStatus
} from '../functions/lib/requisition-workflow.js';
import { staffRequisitionEventNotification } from '../functions/lib/notifications.js';

const [workflowSource, backendSource, adminSource] = await Promise.all([
  readFile(new URL('../functions/api/finance-workflow.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
]);

test('requisition offices have one non-overlapping responsibility each', () => {
  assert.deepEqual(requisitionCapabilities({ role: 'Accounts Officer' }), {
    canConfirmRequisitions: true,
    canReviewRequisitions: false,
    canApproveRequisitions: false,
    canPostRequisitions: true
  });
  assert.equal(requisitionCapabilities({ role: 'Admin' }).canReviewRequisitions, true);
  assert.equal(requisitionCapabilities({ role: 'Management' }).canReviewRequisitions, false);
  assert.equal(requisitionCapabilities({ role: 'Management' }).canApproveRequisitions, false);
  assert.equal(requisitionCapabilities({ role: 'Director' }).canApproveRequisitions, true);
  assert.equal(requisitionCapabilities({ role: 'Super Admin' }).canApproveRequisitions, true);
  assert.equal(requisitionCapabilities({ role: 'Management', assignedRole: 'Admin' }).canReviewRequisitions, true);
  assert.equal(requisitionCapabilities({ role: 'Department User' }).canConfirmRequisitions, false);
});

test('requisition transitions enforce Accounts, Admin, Director or Super Admin, then Accounts', () => {
  assert.deepEqual(
    assertRequisitionTransition({ Status: 'Submitted' }, 'Accounts Officer', REQUISITION_STATUS.ACCOUNTS_CONFIRMED),
    {
      role: 'Accounts Officer', nextStatus: 'Accounts Confirmed', event: 'Confirmed',
      stage: 'accounts', verb: 'confirm', currentStatus: 'Submitted'
    }
  );
  assert.equal(
    assertRequisitionTransition({ Status: 'Accounts Confirmed' }, 'Admin', 'Admin Reviewed').event,
    'Reviewed'
  );
  assert.equal(
    assertRequisitionTransition({ Status: 'Admin Reviewed' }, 'Director', 'Approved').event,
    'Approved'
  );
  assert.equal(assertRequisitionTransition({ Status: 'Admin Reviewed' }, 'Super Admin', 'Approved').event, 'Approved');
  assert.equal(
    assertRequisitionTransition({ Status: 'Approved', AdminReviewedAt: '2026-09-23T10:00:00Z' }, 'Accounts Officer', 'Posted').event,
    'Posted'
  );
});

test('requisition transitions reject skipped stages and wrong offices', () => {
  assert.throws(
    () => assertRequisitionTransition({ Status: 'Submitted' }, 'Management', 'Management Authorized'),
    (error) => error.status === 403 && error.code === 'REQUISITION_STAGE_ROLE_REQUIRED'
  );
  assert.throws(
    () => assertRequisitionTransition({ Status: 'Submitted' }, 'Accounts Officer', 'Approved'),
    (error) => error.status === 409 && error.code === 'REQUISITION_STAGE_ORDER_REQUIRED'
  );
  assert.throws(
    () => assertRequisitionTransition({ Status: 'Approved', AdminReviewedAt: '2026-09-23T10:00:00Z' }, 'Super Admin', 'Posted'),
    (error) => error.status === 403 && error.code === 'REQUISITION_STAGE_ROLE_REQUIRED'
  );
});

test('legacy approval without administrative review still waits for Admin', () => {
  assert.equal(requisitionWorkflowStatus({ Status: 'Approved', ApprovedAt: '2026-09-01T09:00:00Z' }), 'Management Authorized');
  assert.equal(
    assertRequisitionTransition(
      { Status: 'Approved', ApprovedAt: '2026-09-01T09:00:00Z' },
      'Super Admin',
      'Approved'
    ).event,
    'Approved'
  );
});

test('Management Authorized legacy requests remain eligible for final approval', () => {
  assert.equal(assertRequisitionTransition({ Status: 'Management Authorized' }, 'Director', 'Approved').event, 'Approved');
});

test('each requisition notification targets only the next office or requester', () => {
  const requisition = {
    ExpenseNo: 'REQ-1', Amount: 20000, Department: 'Science',
    RequestedByUsername: 'requester', BranchId: 'main', SchoolSection: 'secondary',
    RequestedAt: '2026-09-23T09:00:00Z', AccountsConfirmedAt: '2026-09-23T10:00:00Z',
    AdminStageReviewedAt: '2026-09-23T11:00:00Z', ApprovedAt: '2026-09-23T12:00:00Z',
    PostedAt: '2026-09-23T13:00:00Z'
  };
  const expectations = {
    Submitted: { roles: ['Accounts Officer'], users: [] },
    Confirmed: { roles: ['Admin'], users: [] },
    Reviewed: { roles: ['Director', 'Super Admin'], users: [] },
    Authorized: { roles: ['Director', 'Super Admin'], users: [] },
    Approved: { roles: ['Accounts Officer'], users: [] },
    Rejected: { roles: [], users: ['requester'] },
    Posted: { roles: [], users: ['requester'] }
  };
  for (const [event, expected] of Object.entries(expectations)) {
    const notification = staffRequisitionEventNotification(requisition, event, 'officer');
    assert.deepEqual(notification.TargetRoles, expected.roles, event);
    assert.deepEqual(notification.TargetUsernames, expected.users, event);
  }
});

test('shared web and desktop backends enforce the workflow without edition gates', () => {
  assert.match(workflowSource, /assertRequisitionTransition\(existing, user\.assignedRole \|\| user\.role, requestedStatus\)/);
  assert.match(backendSource, /assertRequisitionTransition\(existing, actorRole, requestedStatus\)/);
  assert.match(adminSource, /data-workflow-action="advanceRequisition"/);
  assert.match(adminSource, /canConfirmRequisitions/);
  assert.match(adminSource, /canReviewRequisitions/);
  assert.match(adminSource, /canApproveRequisitions/);
  assert.doesNotMatch(workflowSource, /Edition[^\n]{0,120}requisition/i);
});

test('printable requisition records the rejecting officer, stage and reason', () => {
  assert.match(adminSource, /record\.RejectedBy \|\| record\.UpdatedBy/);
  assert.match(adminSource, /record\.RejectedAt/);
  assert.match(adminSource, /record\.RejectedStage/);
  assert.match(adminSource, /record\.RejectionNotes/);
});
