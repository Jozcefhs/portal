import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildRequisitionPosting, validateRequisitionPosting } from '../functions/lib/requisition-posting.js';
import { assertRequisitionTransition, requisitionWorkflowStatus, requisitionCapabilities, REQUISITION_STATUS } from '../functions/lib/requisition-workflow.js';
import { requisitionChangedFields } from '../functions/lib/requisition-edit-history.js';
import { resolveOrganizationConfig } from '../functions/lib/organization-config.js';
import { validDocumentApprovalScope } from '../functions/api/staff-passkey.js';

const [postingSource, workflowSource, backendSource, adminSource] = await Promise.all([
  readFile(new URL('../functions/lib/requisition-posting.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/finance-workflow.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
]);
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const accounts = { role: 'Accounts Officer', username: 'accounts', displayName: 'Accounts Officer', branchId: 'main', schoolSectionAccess: 'All' };
const approved = { ExpenseNo: 'REQ-1', Status: 'Approved', AdminReviewedAt: '2026-09-27T10:00:00Z',
  ApprovedBy: 'Director', FinalApprovedRole: 'Director', BranchId: 'main', SchoolSection: 'Secondary',
  Date: '2026-09-27', Amount: 380000, Description: 'Supplies', Department: 'Audit', CostCentre: 'Works',
  MaterialItems: [{ Item: 'Fuel', Quantity: 100, UnitPrice: 1450, Total: 145000 }], __updateTime: 'v1' };
const chart = [{ Code: '6090', Active: 'YES' }, { Code: '1020', Active: 'YES' }];
const options = { postingDate: '2026-09-28', reference: 'BANK-0001', authorizationMethod: 'Password' };

function storeHarness(initial = approved, overrides = {}) {
  let record = structuredClone(initial);
  const saved = new Map();
  let commits = 0;
  const source = postingSource.slice(postingSource.indexOf('export async function postApprovedRequisition(')).replace('export ', '');
  const post = vm.runInNewContext(`(${source})`, {
    buildRequisitionPosting, validateRequisitionPosting, resolveOrganizationConfig,
    fail: (message, status, code) => { throw Object.assign(new Error(message), { status, code }); },
    getAccountingChartRows: async (_env, params) => { assert.equal(params.fresh, true); return overrides.chart || chart; },
    listCollection: async () => { if (overrides.periodError) throw new Error('period read failed'); return overrides.periods || []; },
    batchUpsertDocuments: async (_env, writes) => {
      if (overrides.commitError) throw overrides.commitError;
      for (const write of writes) {
        if ((write.exists === false && saved.has(`${write.collectionPath}/${write.documentId}`))
          || (write.updateTime && write.updateTime !== record.__updateTime)) {
          throw Object.assign(new Error('conflict'), { status: 409 });
        }
      }
      for (const write of writes) saved.set(`${write.collectionPath}/${write.documentId}`, structuredClone(write.data));
      record = { ...writes.find(write => write.collectionPath === 'accountingExpenses').data, __updateTime: 'v2' };
      commits++;
    }
  });
  return { post, saved, record: () => structuredClone(record), commits: () => commits };
}

test('posting uses the approved amount/accounts and creates a balanced immutable journal with explicit officer audit', () => {
  const result = buildRequisitionPosting(approved, accounts, { ...options, Amount: 1, ExpenseAccount: '9999', PaymentAccount: '9998', BranchId: 'other' });
  assert.equal(result.journal.JournalNo, 'SYS-EXP-REQ-1');
  assert.equal(result.journal.TotalDebit, 380000);
  assert.equal(result.journal.TotalCredit, 380000);
  assert.deepEqual(result.journal.Lines.map(row => [row.AccountCode, row.Debit, row.Credit]), [['6090', 380000, 0], ['1020', 0, 380000]]);
  assert.equal(result.journal.Department, 'Audit');
  assert.equal(result.journal.BranchId, 'main');
  assert.equal(result.journal.Date, options.postingDate);
  assert.equal(result.record.Date, approved.Date);
  assert.equal(result.record.PostedBy, accounts.displayName);
  assert.equal(result.record.ApprovedBy, 'Director');
  assert.equal(result.record.PaymentReference, options.reference);
  assert.deepEqual(result.record.MaterialItems, approved.MaterialItems);
  assert.equal(result.record.__updateTime, undefined);
  assert.equal(approved.Status, 'Approved');
  assert.equal(result.writes[0].exists, false);
  assert.equal(result.writes[1].updateTime, 'v1');
  assert.match(result.writes[2].data.Details, /amount 380000.00; debit 6090; credit 1020; posting date 2026-09-28; payment reference BANK-0001/);
});

test('only Accounts can post a final-approved request in its branch/section', () => {
  for (const role of ['Director', 'Super Admin', 'Admin', 'Management', 'Department User']) {
    assert.throws(() => buildRequisitionPosting(approved, { ...accounts, role }, options), error => error.code === 'REQUISITION_STAGE_ROLE_REQUIRED');
  }
  for (const Status of ['Submitted', 'Accounts Confirmed', 'Admin Reviewed', 'Rejected', 'Posted', 'Paid']) {
    assert.throws(() => buildRequisitionPosting({ ...approved, Status }, accounts, options));
  }
  assert.throws(() => buildRequisitionPosting({ ...approved, AdminReviewedAt: '' }, accounts, options));
  assert.throws(() => buildRequisitionPosting(approved, { ...accounts, branchId: 'other' }, options), error => error.status === 403);
  assert.throws(() => buildRequisitionPosting(approved, { ...accounts, schoolSectionAccess: 'Primary' }, options), error => error.status === 403);
  for (const patch of [{ Amount: -10 }, { Amount: Infinity }, { Amount: 'invalid' }, { __updateTime: '' }, { JournalNo: 'OLD-JOURNAL' }]) {
    assert.throws(() => buildRequisitionPosting({ ...approved, ...patch }, accounts, options));
  }
  assert.throws(() => buildRequisitionPosting(approved, accounts, { ...options, postingDate: '2026-02-30' }), /valid posting date/);
});

test('closed periods, inactive/missing accounts and edition-excluded codes prevent any financial writes', async () => {
  const journal = buildRequisitionPosting(approved, accounts, options).journal;
  for (const edition of ['school', 'church', 'other']) assert.doesNotThrow(() => validateRequisitionPosting(journal, chart, [], edition));
  for (const overrides of [
    { periods: [{ Status: 'Closed', StartDate: '2026-09-01', EndDate: '2026-09-30' }] },
    { chart: [chart[0]] }, { chart: [chart[0], { ...chart[1], Active: 'NO' }] }, { periodError: true }
  ]) {
    const store = storeHarness(approved, overrides);
    await assert.rejects(store.post({ ORGANISATION_EDITION: 'school' }, approved, accounts, options));
    assert.equal(store.saved.size, 0);
  }
  const schoolAccount = { ...journal, Lines: [{ ...journal.Lines[0], AccountCode: '5000' }, journal.Lines[1]] };
  assert.throws(() => validateRequisitionPosting(schoolAccount, [...chart, { Code: '5000' }], [], 'church'), /unavailable in this edition/);
});

test('numeric legacy journal codes are compared as identifiers in every edition without weakening account guards', () => {
  const journal = {...buildRequisitionPosting(approved,accounts,options).journal,
    Lines:[{AccountCode:6090,Debit:380000,Credit:0},{AccountCode:1020,Debit:0,Credit:380000}]};
  const before = structuredClone(journal);
  for (const edition of ['school','faith','organization']) {
    assert.doesNotThrow(() => validateRequisitionPosting(journal,chart,[],edition));
    for (const Active of ['NO',false,'false',0,'inactive','disabled']) {
      assert.throws(() => validateRequisitionPosting(journal,[chart[0],{...chart[1],Active}],[],edition),/inactive/);
    }
    assert.throws(() => validateRequisitionPosting(journal,[chart[0]],[],edition),/does not exist/);
  }
  assert.deepEqual(journal,before,'Validation must not rewrite historical journal evidence');
});

test('concurrent web/desktop posting commits exactly one journal, requisition and audit in every edition', async () => {
  for (const edition of ['school', 'church', 'other']) {
    const store = storeHarness();
    const results = await Promise.allSettled([
      store.post({ ORGANISATION_EDITION: edition }, approved, accounts, options),
      store.post({ ORGANISATION_EDITION: edition }, approved, { ...accounts, sourcePlatform: 'Desktop' }, options)
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'FINANCE_WRITE_CONFLICT');
    assert.equal(store.commits(), 1);
    assert.equal(store.saved.size, 3);
    assert.equal(store.record().Status, 'Posted');
    await assert.rejects(store.post({ ORGANISATION_EDITION: edition }, store.record(), accounts, options));
    assert.equal(store.commits(), 1);
  }
  const failed = storeHarness(approved, { commitError: new Error('database unavailable') });
  await assert.rejects(failed.post({}, approved, accounts, options), /database unavailable/);
  assert.equal(failed.record().Status, 'Approved');
  assert.equal(failed.saved.size, 0);
});

function webHarness(store, authorized = true) {
  const source = workflowSource.slice(workflowSource.indexOf('function requestedRequisitionStatus('), workflowSource.indexOf('\nasync function reviewRecord('));
  return vm.runInNewContext(`(() => { ${source}; return advanceRequisition; })()`, {
    clean, lower, REQUISITION_STATUS, assertRequisitionTransition, safeId: value => value,
    getDocument: async () => store.record(), findOneByField: async () => null,
    scopedRows: (rows, user) => rows.filter(row => !user.branchId || row.BranchId === user.branchId), capabilities: requisitionCapabilities,
    validIsoDate: value => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('valid posting date required'); return value; },
    requireDecisionAuthorization: async (_env, _user, _body, _request, action) => {
      assert.equal(action, 'requisition:posted'); if (!authorized) throw new Error('password or biometric required'); return 'Password';
    },
    buildEndorsement: async () => ({ AppliedBy: 'Accounts Officer' }), endorsementId: (id, stage) => `${id}-${stage}`,
    postApprovedRequisition: store.post, actor: user => user.displayName, notifyStaffRequisitionEvent: async () => {}
  });
}

test('web Post/Pay requires current version, date, reference and identity verification, then uses the atomic posting service', async () => {
  const input = { recordId: 'REQ-1', decision: 'Posted', recordVersion: 'v1', postingDate: options.postingDate, paymentReference: options.reference };
  for (const invalid of [{ recordVersion: '' }, { recordVersion: 'stale' }, { postingDate: '' }, { paymentReference: '' }]) {
    const store = storeHarness();
    await assert.rejects(webHarness(store)({}, accounts, { ...input, ...invalid }, {}));
    assert.equal(store.saved.size, 0);
  }
  const unauthorized = storeHarness();
  await assert.rejects(webHarness(unauthorized, false)({}, accounts, input, {}), /password or biometric/);
  assert.equal(unauthorized.saved.size, 0);
  const store = storeHarness();
  const result = await webHarness(store)({}, accounts, { ...input, Amount: 1 }, {});
  assert.equal(result.record.Status, 'Posted');
  assert.equal(result.record.Amount, approved.Amount);
  assert.equal(store.saved.size, 4);
  assert.ok(store.saved.has('financeDocumentEndorsements/REQ-1-posting'));
});

test('native posting uses the same atomic path without changing the existing desktop API response', async () => {
  const store = storeHarness();
  const source = backendSource.slice(backendSource.indexOf('function accountingRequisitionActor('), backendSource.indexOf('\nfunction validImprestDate('));
  const save = vm.runInNewContext(`(() => { ${source}; return saveAccountingExpense; })()`, {
    clean, lower, requireAccountingRole() {}, DEPARTMENT_ACCOUNTING_ROLES: [],
    getDocumentByIdOrField: async () => store.record(), accountingWriteBranch: () => 'main', accountingRequestBranch: () => 'main',
    accountingDepartment: () => 'Accounts', asMoneyNumber: Number, REQUISITION_STATUS, requisitionWorkflowStatus, assertRequisitionTransition,
    nowIso: () => '2026-09-27T15:00:00Z', enforceDepartmentSubmission: () => approved.Department, requisitionChangedFields,
    postApprovedRequisition: store.post, notifyStaffRequisitionEvent: async () => {}
  });
  const result = await save({}, { ...approved, Status: 'Posted', UserRole: 'Accounts Officer', UserUsername: accounts.username, RecordedBy: accounts.displayName });
  assert.equal(result.expense.Status, 'Posted');
  assert.equal(result.expense.JournalNo, 'SYS-EXP-REQ-1');
  assert.equal(store.saved.size, 3);
});

test('web action appears only for Accounts after final approval, with no later reject or duplicate posting button', () => {
  const block = adminSource.slice(adminSource.indexOf('function financeWorkflowStatus('), adminSource.indexOf('\nfunction financeRecordsSection('));
  const render = vm.runInNewContext(`(() => { ${block}; return financeRecordRow; })()`, {
    clean, escapeHtml: clean, money: String, pick: (record, keys) => keys.map(key => record[key]).find(Boolean) || ''
  });
  const html = render(approved, 'requisition', requisitionCapabilities(accounts));
  assert.match(html, /data-decision="Posted"/);
  assert.match(html, /data-record-version="v1"/);
  assert.match(html, /<\/span> Post \/ Pay<\/button>/);
  assert.doesNotMatch(html, /data-decision="Rejected"/);
  for (const role of ['Director', 'Super Admin', 'Admin', 'Department User']) {
    assert.doesNotMatch(render(approved, 'requisition', requisitionCapabilities({ role })), /data-decision="Posted"/);
  }
  for (const row of [{ ...approved, Status: 'Posted' }, { ...approved, AdminReviewedAt: '' }, { ...approved, Status: 'Admin Reviewed' }]) {
    assert.doesNotMatch(render(row, 'requisition', requisitionCapabilities(accounts)), /data-decision="Posted"/);
  }
});

test('biometric proof scopes match every requisition stage without authorizing another document type or action', async () => {
  const source = adminSource.slice(adminSource.indexOf('async function verifyFinanceDecisionBiometric('), adminSource.indexOf('\nasync function submitFinanceDecision('));
  for (const [decision, action] of [['Accounts Confirmed', 'confirmed'], ['Admin Reviewed', 'reviewed'], ['Approved', 'approved'], ['Posted', 'posted']]) {
    let received;
    const button = { classList: { remove() {}, add() {} }, removeAttribute() {} };
    const verify = vm.runInNewContext(`(${source})`, {
      clean, document: { getElementById: () => button },
      pendingFinanceDecision: { action: 'advanceRequisition', decision, recordType: 'requisition', recordId: 'REQ-1' },
      setButtonLoading() {}, setStatus() {}, getPasskeyCredential: async () => ({}), credentialToJSON: value => value,
      passkeyRequest: async (requestAction, body) => {
        if (requestAction === 'approval-options') { received = body; return { options: {}, ceremonyId: 'test' }; }
        return { approvalProof: 'test-proof', message: 'Verified' };
      },
      friendlyPasskeyError: error => { throw error; }
    });
    await verify();
    assert.equal(received.decisionAction, `requisition:${action}`);
    assert.equal(validDocumentApprovalScope({ recordId: received.recordId, recordType: received.recordType, action: received.decisionAction }), true);
    assert.equal(validDocumentApprovalScope({ recordId: 'REQ-1', recordType: 'bill', action: received.decisionAction }), false);
  }
  for (const scope of [
    { recordId: '', recordType: 'requisition', action: 'requisition:posted' },
    { recordId: 'REQ-1', recordType: 'requisition', action: 'delete' },
    { recordId: 'REQ-1', recordType: 'requisition', action: 'requisition:admin reviewed' }
  ]) assert.equal(validDocumentApprovalScope(scope), false);
  assert.equal(validDocumentApprovalScope({ recordId: 'BILL-1', recordType: 'bill', action: 'review:Approved' }), true);
});
