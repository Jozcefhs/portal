import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildStudentBillingPreview, studentBillingReconciliationPlan, normalizeInvoice,
  normalizeFeeItem, calculateAccountFinancialSummary, getAccountsOverview, sameFinancialPeriod,
  applyBillingCategoryOverrides, feeMatchesApplication, isSchoolFeeInvoice } from '../functions/api/backend.js';
import { parentCreditReview } from '../functions/lib/student-billing-diagnostics.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const sameText = (a, b) => lower(a) === lower(b);
const profile = { AdmissionNo: 'TEST/26/274', AccountRef: 'TEST/26/274', DisplayName: 'Review test student',
  ClassName: 'Grade 10', StudentType: 'Day Student', Gender: 'Female', BillingCategory: 'Regular',
  EnrollmentCategory: 'New Intake', AcademicProgress: 'Promoted', ProfileCompletionStatus: 'Complete',
  BranchId: 'main', SchoolSection: 'secondary', AcademicSession: '2026/2027', Term: 'First Term',
  Status: 'Enrolled', __scopePath: 'schoolBranches/main/sections/secondary/students' };
const amounts = [['TUITION', 870600], ['TXT_SNR_10', 148060], ['LEGN10', 10000]];

function fixture(replaced = false) {
  const common = { AccountRef: profile.AccountRef, BranchId: 'main', SchoolSection: 'secondary',
    AcademicSession: profile.AcademicSession, Term: profile.Term, Currency: 'NGN', FeeCategory: 'School Fee' };
  const feeItems = amounts.map(([FeeCode, Amount]) => ({ ...common, FeeCode, FeeName: FeeCode,
    Amount, Active: 'YES', PayableOnline: 'YES', ClassName: 'Grade 10', StudentType: 'All', Gender: 'All',
    BillingCategory: 'All', EnrollmentCategory: FeeCode === 'LEGN10' ? 'New Intake' : 'All', AcademicProgress: 'All' }));
  const invoices = amounts.map(([FeeCode, Amount], index) => ({ ...common, InvoiceId: `ORIGINAL-${FeeCode}`,
    FeeCode, FeeName: FeeCode, Amount, Debit: Amount, Credit: Amount, Balance: 0, Status: 'Paid',
    Date: '2026-10-01', CreatedAt: '2026-10-01', __id: `original-${FeeCode}`, __updateTime: 'v1',
    ...(index ? { FeeChargeReversed: 'YES', FeeChargeReversalId: `REV-${FeeCode}`,
      FeeChargeReversalAmount: Amount, FeeChargeReleasedCredit: Amount } : {}) }));
  if (replaced) for (const [FeeCode, Amount] of amounts.slice(1)) invoices.push({ ...common,
    InvoiceId: `RESTORED-${FeeCode}`, FeeCode, FeeName: FeeCode, Amount, Debit: Amount, Credit: Amount,
    Balance: 0, Status: 'Paid', Date: '2026-11-04', CreatedAt: '2026-11-04',
    RecoveryId: `RECOVERY-${FeeCode}`, RecoveryKind: 'Reinstated textbook/yearbook charge',
    ReplacesInvoiceIds: [`ORIGINAL-${FeeCode}`], ReinstatedFromReversalIds: [`REV-${FeeCode}`],
    Source: 'Reviewed reinstated school charge', __id: `restored-${FeeCode}`, __updateTime: 'v1' });
  const ledger = [{ ...common, FeeCode: 'TUITION', Credit: 1028660, Debit: 0, Reference: 'RECEIPT', Date: '2026-10-01' },
    { ...common, FeeCategory: 'Wallet', FeeCode: 'WALLET_TOPUP', EntryType: 'Wallet Topup', Credit: 500, Debit: 0, Reference: 'WALLET' }];
  return { schoolProfile: {}, feeItems, invoices, ledger, payments: [], billingCategoryDiscounts: [],
    accountSummaries: [calculateAccountFinancialSummary(invoices, ledger, profile.AccountRef, '2026-11-04')] };
}

test('reversed-only textbook and yearbook gaps remain visible but ordinary reconciliation cannot recreate them', async () => {
  const data = fixture(), before = structuredClone(data);
  const plan = await studentBillingReconciliationPlan(profile, data);
  assert.equal(plan.expectedTotal, 1028660); assert.equal(plan.invoicedTotal, 870600);
  assert.equal(plan.recordedCredit, 158060); assert.equal(plan.difference, 158060);
  assert.equal(plan.ready, false); assert.equal(plan.postingTotal, 0); assert.equal(plan.eligibleMissing.length, 0);
  assert.deepEqual(plan.blockedMissing.map(row => row.code).sort(), ['LEGN10', 'TXT_SNR_10']);
  for (const row of plan.blockedMissing) {
    assert.equal(row.missing, true); assert.equal(row.conflict, false); assert.deepEqual(row.invoiceIds, []);
    assert.deepEqual(row.reversedInvoiceIds, [`ORIGINAL-${row.code}`]);
    assert.match(row.postingBlock, /reviewed charge recovery/);
  }
  assert.deepEqual(data, before);
});

test('active replacements restore the exact bill without counting reversed history as duplicate charges', async () => {
  const data = fixture(true), before = structuredClone(data);
  const preview = await buildStudentBillingPreview(profile, data);
  assert.equal(preview.expectedTotal, 1028660); assert.equal(preview.invoicedTotal, 1028660);
  assert.equal(preview.recordedCredit, 0); assert.equal(preview.difference, 0);
  assert.equal(preview.billingReview.status, 'matched'); assert.equal(parentCreditReview(preview).status, 'matched');
  for (const code of ['TXT_SNR_10', 'LEGN10']) {
    const row = preview.rows.find(item => item.code === code);
    assert.deepEqual(row.invoiceIds, [`RESTORED-${code}`]);
    assert.deepEqual(row.reversedInvoiceIds, [`ORIGINAL-${code}`]);
  }
  const overview = await getAccountsOverview({}, { ...data, students: [profile], applications: [], accounts: [], billingCategories: [] });
  const account = overview.accounts[0];
  assert.equal(account.TotalDebit, 1028660); assert.equal(account.TotalCredit, 1028660);
  assert.equal(account.ExcessCredit, 0); assert.equal(account.WalletBalance, 500);
  assert.equal(overview.invoices.length, 5, 'all invoice history remains available');
  assert.deepEqual(data, before);
});

test('active duplicates and invalid reversal metadata still fail review', async () => {
  const data = fixture(true);
  data.invoices.push({ ...data.invoices.at(-1), InvoiceId: 'SECOND-ACTIVE' });
  const preview = await buildStudentBillingPreview(profile, data);
  assert.equal(preview.rows.find(row => row.code === 'LEGN10').conflict, true);
  const malformed = fixture(true); malformed.invoices[1].FeeChargeReleasedCredit--;
  await assert.rejects(buildStudentBillingPreview(profile, malformed), /Invalid invoice reversal metadata/);
  const statusOnly = fixture(true); delete statusOnly.invoices[1].FeeChargeReversed;
  statusOnly.invoices[1].Status = 'Reversed';
  const unverified = await buildStudentBillingPreview(profile, statusOnly);
  assert.equal(unverified.rows.find(row => row.code === 'TXT_SNR_10').conflict, true);
});

const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const generator = source.slice(source.indexOf('async function generateSchoolFeeInvoicesForAccount('), source.indexOf('function ledgerDocumentId('));
function generatorHarness(data) {
  const original = structuredClone(data), writes = [];
  const run = vm.runInNewContext(`(${generator})`, {
    clean, lower, sameText, normalizeMatchText: lower, sameFinancialPeriod,
    assertManualPaymentScope: () => {}, scopedPaymentWriteCondition: () => ({}),
    resolveStudentEnrollmentCategory: row => row.EnrollmentCategory,
    yesNo: value => lower(value) === 'yes' ? 'YES' : 'NO', asMoneyNumber: value => Number(value) || 0,
    normalizeFeeItem, normalizeInvoice, applyBillingCategoryOverrides, feeMatchesApplication, isSchoolFeeInvoice,
    isWalletFee: row => lower(row.FeeCategory) === 'wallet', isFullScholarship: () => false,
    loadBillingDiscount: async () => null, feeBranchId: row => row.BranchId,
    loadBranchFinanceRows: async () => data.feeItems, queryAccountRows: async () => data.invoices,
    loadNotificationSettings: async () => ({}), resolvedPeriodValue: (value, fallback) => lower(value) === 'all' ? fallback : value,
    normalizeReferenceText: lower, ledgerDocumentId: () => 'UNEXPECTED-NEW-INVOICE', schoolSectionFor: row => row.SchoolSection,
    invoiceReminderFields: () => ({}), nowIso: () => '2026-11-04T12:00:00Z', feeDueDate: value => value,
    safeDocumentId: value => value,
    batchUpsertDocuments: async (_env, rows) => { writes.push(...structuredClone(rows)); },
    applyDueSchoolFeeCreditsForAccount: async () => {}
  });
  return { original, writes, run: () => run({}, { ResolvedStudent: profile, NotificationSettings: {} }, profile.AccountRef) };
}

test('Generate School Fees blocks reversed-only history before writes and never overwrites reversed or restored invoices on retry', async () => {
  const missing = fixture(), missingRun = generatorHarness(missing);
  await assert.rejects(missingRun.run(), /reviewed recovery/);
  assert.equal(missingRun.writes.length, 0); assert.deepEqual(missing, missingRun.original);
  const restored = fixture(true), h = generatorHarness(restored);
  for (let retry = 0; retry < 2; retry++) {
    const result = await h.run(); assert.equal(result.created, 0);
    assert.ok(h.writes.every(row => row.data.FeeCode === 'TUITION'));
  }
  assert.deepEqual(restored, h.original);
  restored.feeItems.find(row => row.FeeCode === 'TXT_SNR_10').Amount++;
  const count = h.writes.length;
  await assert.rejects(h.run(), /reviewed recovery/); assert.equal(h.writes.length, count);
});

test('ordinary reconciliation rejects both before recovery and repeated posting after recovery without financial writes', async () => {
  const posting = source.slice(source.indexOf('export async function reconcileStudentBilling'),
    source.indexOf('// A narrowly scoped, reviewed correction for BOW')).replace(/^export /, '');
  for (const replaced of [false, true]) {
    const data = fixture(replaced), original = structuredClone(data), plan = await studentBillingReconciliationPlan(profile, data);
    let writes = 0;
    const run = vm.runInNewContext(`(${posting})`, {
      getStudentBillingData: async () => data, studentBillingReconciliationPlan,
      batchCommitDocuments: async () => { writes++; }
    });
    await assert.rejects(run({}, profile, plan.previewToken, {}), replaced ? /already match/ : /reviewed charge recovery/);
    assert.equal(writes, 0); assert.deepEqual(data, original);
  }
});
