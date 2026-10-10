import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  applyBillingCategoryOverrides, buildStudentBillingPreview,
  calculateAccountFinancialSummary, feeMatchesApplication,
  isSchoolFeeInvoice, resolveStudentEnrollmentCategory,
  studentBillingReconciliationPlan, sameFinancialPeriod
} from '../functions/api/backend.js';
import { accountSummaryForKeys } from '../functions/api/parent-dashboard.js';
import { assertManualPaymentScope, scopedPaymentWriteCondition } from '../functions/lib/manual-payment-scope.js';

const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const now = '2026-10-06T00:00:00.000Z';
const accountRef = 'TEST/26/053';
const student = {
  AdmissionNo: accountRef, AccountRef: accountRef, DisplayName: 'Test student',
  ClassName: 'Grade 7', StudentType: 'Boarding Student', Gender: 'Male',
  BillingCategory: 'Regular', EnrollmentCategory: 'New Intake', BranchId: 'main',
  AcademicSession: '2026/2027', Term: 'First Term', SchoolSection: 'secondary',
  ProfileCompletionStatus: 'Complete'
};
const baseFee = {
  Active: 'YES', PayableOnline: 'YES', ClassName: 'All', StudentType: 'All',
  BillingCategory: 'Regular', EnrollmentCategory: 'New Intake', Gender: 'All',
  AcademicSession: '2026/2027', Term: 'First Term', AcademicProgress: 'All'
};
const acceptanceFee = category => ({ ...baseFee, FeeCode: 'ACC_BOA',
  FeeName: 'Acceptance fee', FeeCategory: category, Amount: 150000,
  StudentType: 'Boarding', RequiredForEnrollment: 'YES', Term: 'All' });
const schoolFee = { ...baseFee, FeeCode: 'TUITION', FeeName: 'School fee',
  FeeCategory: 'School Fee', Amount: 1488885 };

// Exercise the actual generator with in-memory storage, not a reimplementation
// of its selection logic. No request reaches Firestore or posts real invoices.
function invoiceGenerator(feeItems) {
  const writes = [];
  const stored = new Map();
  let nextId = 0;
  const acceptanceSource = source.slice(source.indexOf('function isAcceptanceFeeLike('),
    source.indexOf('function accountRefsFrom('));
  const isAcceptanceFeeLike = vm.runInNewContext(`(${acceptanceSource})`, { normalizeMatchText: lower });
  const generatorSource = source.slice(source.indexOf('async function generateSchoolFeeInvoicesForAccount('),
    source.indexOf('function ledgerDocumentId('));
  const generate = vm.runInNewContext(`(${generatorSource})`, {
    assertManualPaymentScope, scopedPaymentWriteCondition,
    clean, normalizeMatchText: lower,
    yesNo: value => ['yes', 'true', '1'].includes(lower(value)) ? 'YES' : 'NO',
    asMoneyNumber: value => Number(value) || 0, normalizeFeeItem: row => row,
    isSchoolFeeInvoice, isAcceptanceFeeLike, resolveStudentEnrollmentCategory,
    applyBillingCategoryOverrides, feeMatchesApplication, isWalletFee: () => false,
    listCollection: async () => feeItems, queryAccountRows: async () => [...stored.values()],
    normalizeInvoice: row => row, loadNotificationSettings: async () => ({}),
    resolvedPeriodValue: (value, fallback) => lower(value) === 'all' ? fallback : value || fallback,
    normalizeReferenceText: lower, sameText: (a, b) => lower(a) === lower(b),
    sameFinancialPeriod, ledgerDocumentId: () => `TEST-INV-${++nextId}`,
    schoolSectionFor: row => row.SchoolSection,
    invoiceReminderFields: () => ({}), nowIso: () => now, feeDueDate: value => value,
    safeDocumentId: clean,
    batchUpsertDocuments: async (_env, rows) => {
      writes.push(...rows);
      rows.forEach(row => stored.set(row.documentId, row.data));
    },
    applyDueSchoolFeeCreditsForAccount: async () => ({})
  });
  return { generate, writes };
}

for (const section of ['primary', 'secondary']) {
  test(`acceptance is a deposit, not an extra ${section} first-time charge`, async () => {
    const profile = { ...student, SchoolSection: section,
      ClassName: section === 'primary' ? 'Primary 5' : 'Grade 7' };
    const fees = [acceptanceFee('Admission'), schoolFee];
    const before = JSON.stringify(fees);
    const { generate, writes } = invoiceGenerator(fees);
    const result = await generate({}, { ResolvedStudent: profile, NotificationSettings: {} }, accountRef);
    assert.equal(result.created, 1);
    assert.deepEqual(writes.map(row => row.data.FeeCode), ['TUITION']);
    const invoices = writes.map(row => ({ ...row.data, Credit: schoolFee.Amount }));
    const ledger = [{ AccountRef: accountRef, FeeCode: 'SCHOOL_FEES_TOTAL',
      FeeCategory: 'School Fee', Credit: 1638885, AcademicSession: profile.AcademicSession, Term: profile.Term }];
    const data = { feeItems: fees, invoices, ledger };
    const preview = await buildStudentBillingPreview(profile, data);
    const plan = await studentBillingReconciliationPlan(profile, data);
    assert.equal(preview.expectedTotal, 1488885);
    assert.equal(preview.invoicedTotal, 1488885);
    assert.equal(preview.difference, 0);
    assert.equal(plan.ready, false);
    assert.deepEqual(plan.missing, []);
    const backend = calculateAccountFinancialSummary(invoices, ledger, accountRef, now);
    const parent = accountSummaryForKeys([], [accountRef], ledger, invoices);
    assert.equal(backend.TotalDebit, 1488885);
    assert.equal(backend.TotalCredit, 1638885);
    assert.equal(backend.CreditBalance, 150000);
    assert.equal(parent.CreditBalance, 150000);
    assert.equal(parent.OutstandingBalance, 0);
    assert.equal(JSON.stringify(fees), before);
    const repeated = await generate({}, { ResolvedStudent: profile, NotificationSettings: {} }, accountRef);
    assert.equal(repeated.created, 0);
    assert.equal(repeated.updated, 1);
    assert.equal(new Set(writes.map(row => row.documentId)).size, 1);
  });
}

test('split acceptance deposit and fee receipt preserve genuine excess credit', () => {
  const invoices = [{ AccountRef: accountRef, ...schoolFee, Debit: 1488885, Credit: 1488885 }];
  const ledger = [
    { AccountRef: accountRef, FeeCode: 'ACC_BOA', FeeName: 'Acceptance fee', FeeCategory: 'Admission', Credit: 150000 },
    { AccountRef: accountRef, FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee', Credit: 1488885 }
  ];
  const before = JSON.stringify({ invoices, ledger });
  const backend = calculateAccountFinancialSummary(invoices, ledger, accountRef, now);
  const parent = accountSummaryForKeys([], [accountRef], ledger, invoices);
  assert.equal(backend.TotalCredit, 1638885);
  assert.equal(backend.CreditBalance, 150000);
  assert.equal(parent.CreditBalance, 150000);
  assert.equal(JSON.stringify({ invoices, ledger }), before);
});
