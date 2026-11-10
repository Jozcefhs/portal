import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { buildCreditActionAccountingJournal, calculateAccountFinancialSummary, calculateDueSchoolFeeCreditAllocations,
  isSchoolFeeInvoice, studentsShareParentForCreditTransfer } from '../functions/api/backend.js';
import { schoolFeeCreditScope, schoolFeeCreditSummaryId, schoolFeeCreditSummaryWrite, schoolFeeCreditQueueFields,
  readSchoolFeeCreditHistory } from '../functions/lib/school-fee-credit-scope.js';
import { schoolFeeCreditReviewReason } from '../functions/lib/school-fee-advance.js';
import { schoolSectionFor, canonicalSchoolBranchId } from '../functions/lib/school-scope.js';

const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const start = backend.indexOf('async function recordCreditAction(env, body) {');
const end = backend.indexOf('\nasync function ', start + 1);
const source = backend.slice(start, end);
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const money = value => Math.round(Number(value || 0) * 100) / 100;
const safeId = value => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
const stamp = '2026-11-10T12:00:00.000Z';
const copy = value => value ? structuredClone(value) : value;

function harness({ managed = true, beforeCommit } = {}) {
  const student = { __id: 'DCA-26-001', __updateTime: 'v1', __scopePath: 'schoolBranches/area-1-primary/sections/primary/students',
    AdmissionNo: 'DCA/26/001', AccountRef: 'DCA/26/001', BranchId: 'area-1-primary', SchoolSection: 'primary',
    DisplayName: 'Learner', ClassName: 'Grade 1', ParentEmail: 'parent@example.test' };
  const sibling = { ...student, __id: 'DCA-26-002', AdmissionNo: 'DCA/26/002', AccountRef: 'DCA/26/002' };
  const db = new Map(), commits = [], calls = { legacy: 0, managed: 0, find: [] };
  for (const pupil of [student, sibling]) {
    db.set(`${pupil.__scopePath}/${pupil.__id}`, copy(pupil));
    const scope = schoolFeeCreditScope(pupil);
    const summaryId = managed ? schoolFeeCreditSummaryId(pupil.AccountRef, scope) : safeId(pupil.AccountRef);
    db.set(`accountSummaries/${summaryId}`, { __id: summaryId, __updateTime: 'v1', AccountRef: pupil.AccountRef,
      BranchId: pupil.BranchId, SchoolSection: pupil.SchoolSection, CreditBalance: 100, PendingSchoolFeeCredit: managed ? 100 : undefined,
      SchoolFeeCreditManaged: managed, AccountScopePath: pupil.__scopePath, StudentDocumentId: pupil.__id });
    db.set(`ledger/receipt-${pupil.__id}`, { __id: `receipt-${pupil.__id}`, __updateTime: 'v1', AccountRef: pupil.AccountRef,
      BranchId: pupil.BranchId, SchoolSection: pupil.SchoolSection, FeeCategory: 'School Fee', FeeCode: 'SCHOOL_FEES_ADVANCE', Credit: 100 });
  }
  // Same displayed admission in Main Branch must remain wholly outside the action.
  db.set('ledger/foreign', { __id: 'foreign', __updateTime: 'v1', AccountRef: student.AccountRef,
    BranchId: 'main', SchoolSection: 'secondary', FeeCategory: 'School Fee', Credit: 9000 });
  db.set(`accountSummaries/${safeId(student.AccountRef)}`, { __id: safeId(student.AccountRef), __updateTime: 'v1',
    AccountRef: student.AccountRef, BranchId: managed ? 'main' : 'area-1-primary', SchoolSection: managed ? 'secondary' : 'primary', CreditBalance: managed ? 9000 : 100 });
  const getDocument = async (_env, collection, id) => copy(db.get(`${collection}/${id}`)) || null;
  const rows = collection => [...db.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => copy(value));
  const queryCollectionPages = async (_env, collection, query) => rows(collection).filter(row => query.filters.some(filter => row[filter.field] === filter.value));
  const findStudentByAccountRef = async (_env, reference, scope) => {
    calls.find.push(scope);
    assert.equal(scope.branchId, 'area-1-primary');
    const pupil = [student, sibling].find(value => value.AccountRef === reference);
    return pupil ? getDocument({}, pupil.__scopePath, pupil.__id) : null;
  };
  let sequence = 0;
  const run = vm.runInNewContext(`${source};recordCreditAction`, {
    clean, lower, crypto: webcrypto, asMoneyNumber: money, nowIso: () => stamp, safeDocumentId: safeId,
    sameText: (a, b) => lower(a) === lower(b), sameReferenceIdentity: (a, b) => lower(a) === lower(b),
    formatNairaAmount: value => String(value), yesNo: value => value, schoolSectionFor, canonicalSchoolBranchId,
    requireAccountingRole: () => {}, accountingEditionForRequest: () => 'school', accountingWriteBranch: () => {},
    requestedStudentScope: body => ({ branchId: body.UserBranchId, schoolSectionAccess: body.UserSchoolSectionAccess }),
    findStudentByAccountRef, applicationNotFound: ref => new Error(`Missing ${ref}`),
    walletAccountPayload: async (_env, pupil) => ({ ...pupil, WalletBalance: 0 }),
    getDocument, schoolFeeCreditScope, schoolFeeCreditSummaryId, schoolFeeCreditSummaryWrite, schoolFeeCreditQueueFields,
    readSchoolFeeCreditHistory: (_env, scope, _deps, options) => readSchoolFeeCreditHistory({}, scope, { getDocument, queryCollectionPages }, options),
    calculateAccountFinancialSummary, calculateDueSchoolFeeCreditAllocations, isSchoolFeeInvoice, schoolFeeCreditReviewReason,
    normalizeLedger: row => row, normalizeInvoice: row => row,
    isAvailableSchoolCreditReceipt: row => row.FeeCategory === 'School Fee' || (row.FeeCategory === 'Account Credit' && Number(row.Credit) > 0),
    accountCreditBalanceForAccount: async () => { calls.legacy++; return 100; },
    ledgerDocumentId: prefix => `${prefix}-${++sequence}`,
    studentsShareParentForCreditTransfer, findApplication: async () => null,
    accountingPeriodIsClosed: async () => false,
    syncSchoolAccountCreditJournals: async () => { calls.legacy++; return {}; },
    getAccountingChartRows: async () => [{ Code: '1020', Active: 'YES', Type: 'Asset', Group: 'Cash and Bank' }, { Code: '4910', Active: 'YES' }],
    buildCreditActionAccountingJournal,
    refreshAccountFinancialSummary: async () => { calls.legacy++; return { CreditBalance: 60 }; },
    applyDueSchoolFeeCreditsForAccount: async () => { calls.legacy++; },
    applyManagedSchoolFeeCreditForAccount: async () => { calls.managed++; return {}; },
    batchUpsertDocuments: async (_env, writes) => {
      if (beforeCommit) await beforeCommit(db, writes);
      for (const write of writes) {
        const current = db.get(`${write.collectionPath}/${write.documentId}`);
        if ((write.exists === false && current) || (write.updateTime && write.updateTime !== current?.__updateTime)) throw new Error('Atomic precondition failed');
      }
      commits.push(copy(writes));
      for (const write of writes) {
        const key = `${write.collectionPath}/${write.documentId}`, prior = db.get(key);
        db.set(key, { ...(write.updateMask ? prior : {}), ...copy(write.data), __id: write.documentId, __updateTime: `v${commits.length + 1}` });
      }
    }
  });
  return { db, commits, calls, student, sibling,
    run: input => run({}, { AccountRef: student.AccountRef, CreditAction: 'refund', Amount: 40, Notes: 'Parent instruction',
      Reference: 'refund-request-1', PaymentAccount: '1020', UserBranchId: 'area-1-primary', UserSchoolSectionAccess: 'primary', ...input }) };
}

test('managed refund uses selected branch credit and leaves the other branch summary and receipt intact', async () => {
  const h = harness(), foreign = copy(h.db.get('ledger/foreign')), bare = copy(h.db.get('accountSummaries/DCA-26-001'));
  const result = await h.run();
  assert.equal(result.availableCreditBefore, 100); assert.equal(result.availableCreditAfter, 60);
  assert.equal(h.calls.legacy, 0); assert.equal(h.commits.length, 1);
  assert.deepEqual(h.db.get('ledger/foreign'), foreign); assert.deepEqual(h.db.get('accountSummaries/DCA-26-001'), bare);
  assert.ok(h.commits[0].some(write => write.collectionPath === h.student.__scopePath && write.updateTime === 'v1'));
  assert.ok(h.commits[0].filter(write => write.collectionPath === 'ledger').every(write => write.exists === false));
  await assert.rejects(h.run(), /already been recorded/); assert.equal(h.commits.length, 1);
});

test('concurrent advance or correction on the learner aborts the complete refund batch', async () => {
  const h = harness({ beforeCommit: db => { db.get('schoolBranches/area-1-primary/sections/primary/students/DCA-26-001').__updateTime = 'advance-v2'; } });
  await assert.rejects(h.run(), /Atomic precondition/);
  assert.equal(h.commits.length, 0);
  assert.equal([...h.db.keys()].filter(key => key.startsWith('creditActions/')).length, 0);
});

test('managed credit-to-wallet movement preserves receipt and records one compensating debit plus wallet credit', async () => {
  const h = harness(), original = copy(h.db.get('ledger/receipt-DCA-26-001'));
  await h.run({ CreditAction: 'wallet' });
  const entries = h.commits[0].filter(write => write.collectionPath === 'ledger').map(write => write.data);
  assert.equal(entries.find(row => row.FeeCategory === 'Account Credit').Debit, 40);
  assert.equal(entries.find(row => row.FeeCategory === 'Wallet').Credit, 40);
  assert.deepEqual(h.db.get('ledger/receipt-DCA-26-001'), original);
});

test('managed sibling transfer guards both learners and schedules destination credit without bare summary writes', async () => {
  const h = harness();
  await h.run({ CreditAction: 'sibling', TargetAccountRef: h.sibling.AccountRef });
  assert.equal(h.calls.legacy, 0); assert.equal(h.calls.managed, 1);
  const guards = h.commits[0].filter(write => write.collectionPath === h.student.__scopePath);
  assert.equal(guards.length, 2); assert.ok(guards.every(write => write.updateTime === 'v1'));
  const summaries = h.commits[0].filter(write => write.collectionPath === 'accountSummaries').map(write => write.data);
  assert.deepEqual(summaries.map(row => row.CreditBalance), [60, 140]);
});

test('legacy credit actions share the same learner revision guard with new advance allocations', async () => {
  const h = harness({ managed: false });
  await h.run();
  assert.ok(h.calls.legacy > 0);
  assert.ok(h.commits[0].some(write => write.collectionPath === h.student.__scopePath && write.updateTime === 'v1'));
});

test('managed credit with a review hold cannot be withdrawn or transferred', async () => {
  const h = harness();
  const key = `accountSummaries/${schoolFeeCreditSummaryId(h.student.AccountRef, schoolFeeCreditScope(h.student))}`;
  h.db.get(key).SchoolFeeCreditReviewRequired = true;
  h.db.get(key).SchoolFeeCreditReviewReason = 'Existing fee conflict needs review.';
  await assert.rejects(h.run(), /Existing fee conflict needs review/);
  assert.equal(h.commits.length, 0);
});
