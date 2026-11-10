import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { readManagedSchoolFeeCreditSummary, filterSchoolFeeCreditRows, schoolFeeCreditScope, schoolFeeCreditSummaryId } from '../functions/lib/school-fee-credit-scope.js';
import { schoolSectionFor, canonicalSchoolBranchId } from '../functions/lib/school-scope.js';
import { financeOperationId } from '../functions/lib/accounting-mutation-guards.js';
import { buildSchoolInvoiceChargeAccountingJournal } from '../functions/api/backend.js';
const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const generator = source.slice(source.indexOf('async function generateSchoolFeeInvoicesForAccount('), source.indexOf('function ledgerDocumentId('));
const loader = source.slice(source.indexOf('export async function getStudentBillingData('), source.indexOf('// A read-only, bounded replacement')).replace(/^export /, '');
const clean = value => String(value ?? '').trim(), lower = value => clean(value).toLowerCase(), copy = value => structuredClone(value);
const student = { AccountRef: 'DEMO/26/001', AdmissionNo: 'DEMO/26/001', BranchId: 'area-1-primary', SchoolSection: 'primary',
  ClassName: 'Primary 1', AcademicSession: '2026/2027', Term: 'First Term', EnrollmentCategory: 'Returning',
  __id: 'student-1', __scopePath: 'schoolBranches/area-1-primary/sections/primary/students', __updateTime: 'v1' };
const scope = schoolFeeCreditScope(student), summaryId = schoolFeeCreditSummaryId(student.AccountRef, scope);
const summary = { ...student, __id: summaryId, SchoolFeeCreditManaged: true, AccountScopePath: student.__scopePath,
  StudentDocumentId: student.__id, PendingSchoolFeeCredit: 500 };
const fee = { FeeCode: 'TUI', FeeName: 'Tuition', FeeCategory: 'School Fee', Active: 'YES', Amount: 1000,
  AcademicSession: student.AcademicSession, Term: student.Term, Currency: 'NGN', DueDate: '2027-01-10' };
const invoice = { ...student, __id: 'existing', InvoiceId: 'existing', FeeCode: 'TUI', FeeName: 'Tuition', FeeCategory: 'School Fee',
  Debit: 1000, Amount: 1000, Credit: 200, Balance: 800, Status: 'Part Paid' };

function generationHarness(initial = [], options = {}) {
  const invoices = new Map(initial.map(row => [row.__id, copy(row)])), journals = new Map(), commits = [], holds = [], calls = { legacy: 0, managed: 0, queries: [] };
  const run = vm.runInNewContext(`(${generator})`, {
    clean, lower, normalizeMatchText: lower, sameText: (a,b) => lower(a) === lower(b),
    assertManualPaymentScope: () => {}, scopedPaymentWriteCondition: () => ({}),
    resolveStudentEnrollmentCategory: row => row.EnrollmentCategory, schoolSectionFor,
    readManagedSchoolFeeCreditSummary: (env, identity) => readManagedSchoolFeeCreditSummary(env, identity, { getDocument: async () => summary }),
    filterSchoolFeeCreditRows, financeOperationId, buildSchoolInvoiceChargeAccountingJournal,
    normalizeFeeItem: row => row, normalizeInvoice: row => row, asMoneyNumber: value => Number(value) || 0,
    yesNo: value => lower(value) === 'yes' ? 'YES' : 'NO', applyBillingCategoryOverrides: rows => rows,
    feeMatchesApplication: () => true, isSchoolFeeInvoice: row => row.FeeCategory === 'School Fee', isWalletFee: () => false,
    feeBranchId: row => row.BranchId, loadBillingDiscount: async () => null,
    loadBranchFinanceRows: async () => [{ ...fee, ...(options.fee || {}) }],
    queryAccountRows: async (_env, _collection, _ref, scope, queryOptions) => { calls.queries.push({ scope, queryOptions }); return [...invoices.values()].map(copy); },
    sameFinancialPeriod: (row, session, term) => row.AcademicSession === session && row.Term === term,
    resolvedPeriodValue: (value, fallback) => !value || lower(value) === 'all' ? fallback : value,
    normalizeReferenceText: lower, invoiceReminderFields: () => ({}), nowIso: () => '2026-11-10T00:00:00Z',
    feeDueDate: value => value, safeDocumentId: value => value,
    batchUpsertDocuments: async (_env, writes) => {
      if (options.beforeCommit) await options.beforeCommit();
      for (const write of writes) assert.equal((write.collectionPath === 'invoices' ? invoices : journals).has(write.documentId), false, 'create-if-absent');
      for (const write of writes) (write.collectionPath === 'invoices' ? invoices : journals).set(write.documentId, { ...copy(write.data), __id: write.documentId });
      commits.push(copy(writes));
    },
    batchCommitDocuments: async (_env, writes) => { for (const write of writes) {
      assert.equal(write.collectionPath, 'accountSummaries'); assert.equal(write.documentId, summaryId);
      assert.equal(write.updateTime, summary.__updateTime); assert.equal(write.data.SchoolFeeCreditReviewRequired, true);
      assert.deepEqual(Array.from(write.updateMask), ['SchoolFeeCreditReviewRequired', 'SchoolFeeCreditReviewReason', 'UpdatedAt']);
    } holds.push(copy(writes)); },
    applyManagedSchoolFeeCreditForAccount: async (_env, identity, { summary: saved }) => { calls.managed++; assert.equal(identity.BranchId, student.BranchId); assert.equal(saved.__id, summaryId); },
    applyDueSchoolFeeCreditsForAccount: async () => { calls.legacy++; }
  });
  return { invoices, journals, commits, holds, calls, run: () => run({}, { ResolvedStudent: student, NotificationSettings: {} }, student.AccountRef) };
}

test('managed generation excludes another branch/section with the same admission and posts one deterministic charge', async () => {
  const foreign = [{ ...invoice, __id: 'main', BranchId: 'main', __scopePath: '' },
    { ...invoice, __id: 'secondary', SchoolSection: 'secondary', __scopePath: '' }];
  const h = generationHarness(foreign), result = await h.run();
  assert.equal(result.created, 1); assert.equal(h.invoices.size, 3); assert.equal(h.journals.size, 1);
  assert.deepEqual(h.invoices.get('main'), foreign[0]); assert.deepEqual(h.invoices.get('secondary'), foreign[1]);
  assert.equal(h.calls.queries[0].scope, null); assert.equal(h.calls.queries[0].queryOptions.strict, true);
  assert.equal(h.calls.managed, 1); assert.equal(h.calls.legacy, 0);
  const id = [...h.invoices.keys()].find(key => key.startsWith('INV-SFCR-')); assert.ok(id);
  const snapshot = JSON.stringify([...h.invoices]); await h.run();
  assert.equal(h.commits.length, 1); assert.equal(JSON.stringify([...h.invoices]), snapshot);
});

test('managed generation retains existing paid allocations and rejects changed gross charges before writing', async () => {
  const h = generationHarness([invoice]); await h.run();
  assert.deepEqual(h.invoices.get(invoice.__id), invoice); assert.equal(h.commits.length, 0); assert.equal(h.calls.managed, 1);
  const changed = generationHarness([invoice], { fee: { Amount: 1200 } });
  await assert.rejects(changed.run(), /fee setup or billing discount differs/);
  assert.equal(changed.commits.length, 0); assert.equal(changed.calls.managed, 0); assert.deepEqual(changed.invoices.get(invoice.__id), invoice);
  assert.equal(changed.holds.length, 1, 'Only the credit hold is saved; no financial records are changed');
});

test('concurrent managed invoice generation cannot duplicate charges or charge journals', async () => {
  let entered = 0, release; const barrier = new Promise(resolve => { release = resolve; });
  const h = generationHarness([], { beforeCommit: async () => { if (++entered === 2) release(); await barrier; } });
  const results = await Promise.allSettled([h.run(), h.run()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(h.invoices.size, 1); assert.equal(h.journals.size, 1); assert.equal(h.commits.length, 1);
});

test('billing preview data defaults to the selected school section and reuses its managed summary', async () => {
  const rows = [invoice, { ...invoice, __id: 'foreign-section', SchoolSection: 'secondary', __scopePath: '' },
    { ...invoice, __id: 'foreign-branch', BranchId: 'main', __scopePath: '' },
    { ...invoice, __id: 'inferred-secondary', SchoolSection: '', ClassName: 'Grade 10', __scopePath: '' }];
  let summaryReads = 0;
  const run = vm.runInNewContext(`(${loader})`, {
    clean, lower, canonicalSchoolBranchId, schoolSectionFor, normalizeStudent: row => row,
    accountRefsFrom: row => [row.AccountRef], financialRowMatchesAccount: (row, account) => row.AccountRef === account.AccountRef,
    sameReferenceIdentity: (a,b) => a === b, sameText: (a,b) => lower(a) === lower(b),
    queryCollectionPages: async (_env, collection) => collection === 'accountSummaries' ? [summary] : rows,
    getDocument: async () => ({}), loadBranchFinanceRows: async () => [], feeBranchId: row => row.BranchId,
    loadBillingDiscount: async () => null, feeRowsForBranch: rows => rows,
    readManagedSchoolFeeCreditSummary: (env, identity, _deps, options) => readManagedSchoolFeeCreditSummary(env, identity,
      { getDocument: async () => { summaryReads++; throw new Error('Unexpected summary read'); } }, options),
    filterSchoolFeeCreditRows
  });
  const result = await run({}, student);
  for (const key of ['invoices', 'ledger', 'payments']) assert.deepEqual(Array.from(result[key], row => row.__id), ['existing']);
  assert.equal(summaryReads, 0); assert.equal(result.accountSummaries.length, 1);
  const explicit = await run({}, { ...student, SchoolSection: 'secondary' });
  assert.equal(explicit.invoices.length, 1, 'Canonical profile path keeps the primary context');
});
