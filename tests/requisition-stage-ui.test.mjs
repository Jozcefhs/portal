import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildRequisitionResubmission } from '../functions/api/finance-workflow.js';
import { buildRequisitionPosting } from '../functions/lib/requisition-posting.js';
import { assertRequisitionTransition, requisitionCapabilities, REQUISITION_STATUS } from '../functions/lib/requisition-workflow.js';

const [adminSource, workflowSource] = await Promise.all([
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/finance-workflow.js', import.meta.url), 'utf8')
]);
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const rowSource = adminSource.slice(adminSource.indexOf('function financeWorkflowStatus('), adminSource.indexOf('\nfunction financeRecordsSection('));
const render = vm.runInNewContext(`(() => { ${rowSource}; return financeRecordRow; })()`, {
  clean, escapeHtml, money: value => String(value || 0),
  pick: (record, keys) => keys.map(key => record[key]).find(value => clean(value)) || ''
});
const access = role => ({ ...requisitionCapabilities({ role }), canEditRequisitions: true });
const timestamp = '2026-09-27T13:00:00Z';

function approvalHarness(initial) {
  let record = { ...initial, __updateTime: 'v2' };
  const events = [];
  const journals = [];
  const source = workflowSource.slice(workflowSource.indexOf('function requestedRequisitionStatus('), workflowSource.indexOf('\nasync function reviewRecord('));
  const advance = vm.runInNewContext(`(() => { ${source}; return advanceRequisition; })()`, {
    clean, lower, REQUISITION_STATUS, assertRequisitionTransition,
    getDocument: async () => record, findOneByField: async () => null, safeId: value => value,
    scopedRows: rows => rows, capabilities: requisitionCapabilities, nowIso: () => timestamp,
    requireDecisionAuthorization: async () => 'Password', buildEndorsement: async () => ({}),
    validIsoDate: value => value,
    postApprovedRequisition: async (_env, existing, user, options) => {
      const posting = buildRequisitionPosting(existing, user, options, timestamp);
      journals.push(posting.journal);
      record = { ...posting.record, __updateTime: 'posted' };
      return { ok: true, record };
    },
    actor: user => user.displayName, removeFirestoreMetadata: row => row,
    documentVersion: row => row.__updateTime, endorsementId: (id, stage) => `${id}-${stage}`,
    auditWrite: (_user, action) => ({ collectionPath: 'accountingAudit', data: { Action: action } }),
    commitFinanceDecision: async (_env, writes) => {
      const update = writes.find(write => write.collectionPath === 'accountingExpenses');
      assert.equal(update.updateTime, record.__updateTime);
      record = { ...update.data, __updateTime: `${record.__updateTime}-next` };
    },
    notifyStaffRequisitionEvent: async (_env, _payload, event) => { events.push(event); }
  });
  return {
    advance: (user, decision) => advance({}, user, { recordId: initial.ExpenseNo, decision,
      recordVersion: record.__updateTime, postingDate: '2026-09-27', paymentReference: 'BANK-123' }, {}),
    record: () => record, events, journals
  };
}

test('Director sees why approval is unavailable at Accounts Confirmed, while Admin sees Review', () => {
  const record = { ExpenseNo: 'REQ-1', Status: 'Accounts Confirmed', ResubmittedAt: timestamp, RevisionNumber: 2 };
  for (const role of ['Director', 'Super Admin']) {
    const html = render(record, 'requisition', access(role));
    assert.match(html, /Awaiting Admin review/);
    assert.match(html, /Director approval becomes available after Admin review/);
    assert.match(html, /earlier approvals were reset/);
    assert.doesNotMatch(html, /data-decision="Approved"/);
  }
  const adminHtml = render(record, 'requisition', access('Admin'));
  assert.match(adminHtml, /data-decision="Admin Reviewed"/);
  assert.match(adminHtml, /<\/span> Review<\/button>/);
  assert.doesNotMatch(adminHtml, /data-decision="Approved"/);
});

test('an Admin-edited revision completes Accounts confirmation, Admin review, Director approval and Accounts posting in every edition', async () => {
  const admin = { role: 'Management', assignedRole: 'Admin', username: 'admin', displayName: 'Admin Editor', requisitionEditEnabled: true };
  for (const Edition of ['School', 'Church', 'Other Organisation']) {
    for (const RequisitionType of ['Standard', 'Material']) {
      for (const finalRole of ['Director', 'Super Admin']) {
        const previous = { ExpenseNo: 'REQ-1', RequisitionType, Edition, Description: 'Supplies', Date: '2026-09-27',
          Amount: 100, Status: 'Admin Reviewed', RevisionNumber: 1, AccountsConfirmedBy: 'Old accounts',
          AccountsConfirmedAt: 'old', AdminStageReviewedBy: 'Old admin', AdminStageReviewedAt: 'old',
          MaterialItems: [{ Item: 'Fuel', Specification: 'Litres', Quantity: 1, UnitPrice: 100, Total: 100 }] };
        const { payload } = buildRequisitionResubmission(previous, {
          description: 'Supplies', date: previous.Date, amount: 200,
          items: [{ item: 'Fuel', specification: 'Litres', quantity: 2, unitPrice: 100 }]
        }, admin, timestamp);
        assert.equal(payload.Status, 'Submitted');
        assert.equal(payload.AdminStageReviewedAt, '');
        assert.equal(payload.AccountsConfirmedAt, '');
        assert.equal(payload.ResubmittedBy, 'Admin Editor');
        const flow = approvalHarness(payload);
        const director = { role: 'Super Admin', assignedRole: finalRole, username: 'final', displayName: 'Final Approver' };
        await assert.rejects(flow.advance(director, 'Approved'), error => error.code === 'REQUISITION_STAGE_ROLE_REQUIRED');
        await flow.advance({ role: 'Accounts Officer', username: 'accounts', displayName: 'Accounts Officer' }, 'Accounts Confirmed');
        await assert.rejects(flow.advance(director, 'Approved'), error => error.code === 'REQUISITION_STAGE_ROLE_REQUIRED');
        await flow.advance(admin, 'Admin Reviewed');
        assert.equal(flow.record().AdminStageReviewedBy, 'Admin Editor');
        const html = render(flow.record(), 'requisition', access(finalRole));
        assert.match(html, /data-decision="Approved"/);
        assert.match(html, /<\/span> Approve<\/button>/);
        assert.doesNotMatch(html, /Director approval becomes available after Admin review/);
        await flow.advance(director, 'Approved');
        assert.equal(flow.record().Status, 'Approved');
        assert.equal(flow.record().FinalApprovedRole, finalRole);
        assert.equal(flow.record().ApprovedBy, 'Final Approver');
        assert.deepEqual(flow.events, ['Confirmed', 'Reviewed', 'Approved']);
        assert.match(render(flow.record(), 'requisition', access(finalRole)), /Awaiting Accounts posting \/ payment/);
        assert.match(render(flow.record(), 'requisition', access('Accounts Officer')), /data-decision="Posted"/);
        await flow.advance({ role: 'Accounts Officer', username: 'accounts', displayName: 'Accounts Officer' }, 'Posted');
        assert.equal(flow.record().Status, 'Posted');
        assert.equal(flow.record().PostedBy, 'Accounts Officer');
        assert.equal(flow.journals.length, 1);
        assert.equal(flow.journals[0].TotalDebit, 200);
        assert.equal(flow.journals[0].TotalCredit, 200);
        assert.deepEqual(flow.events, ['Confirmed', 'Reviewed', 'Approved', 'Posted']);
        assert.doesNotMatch(render(flow.record(), 'requisition', access('Accounts Officer')), /data-decision="Posted"/);
      }
    }
  }
});

test('pending-stage guidance does not add approval controls to bills or completed/rejected requisitions', () => {
  for (const Status of ['Rejected', 'Posted', 'Paid', 'Cancelled']) {
    const html = render({ ExpenseNo: 'REQ-1', Status, ResubmittedAt: timestamp }, 'requisition', access('Director'));
    assert.doesNotMatch(html, /finance-next-step|data-decision="Approved"/);
  }
  assert.doesNotMatch(render({ BillNo: 'BILL-1', Status: 'Submitted' }, 'bill', {}), /finance-next-step/);
  assert.match(render({ ExpenseNo: 'REQ-1', Status: 'Management Authorized' }, 'requisition', access('Director')), /data-decision="Approved"/);
});
