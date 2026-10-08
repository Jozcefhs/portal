import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  applyBillingCategoryOverrides, buildStudentBillingPreview, feeMatchesApplication,
  matchingFullScholarshipFeeItems, resolveStudentEnrollmentCategory, isSchoolFeeInvoice
} from '../functions/api/backend.js';
import { parentAcademicScholarshipFees } from '../functions/api/parent-dashboard.js';
import {
  academicFullScholarshipFinancialSummary, academicFinancialSummary,
  evaluateAcademicResultAccess, publicAcademicResult
} from '../functions/lib/academic-result-access.js';
import { defaultAcademicPolicy } from '../functions/lib/academic-policy.js';
import { isFullScholarship, explicitlyIncludesFullScholarship } from '../functions/lib/full-scholarship.js';

const student = { AdmissionNo: 'TEST/26/001', BillingCategory: 'Full Scholarship',
  ClassName: 'Grade 7', StudentType: 'Day Student', Gender: 'Female', BranchId: 'main',
  SchoolSection: 'secondary', AcademicSession: '2026/2027', Term: 'First Term',
  EnrollmentCategory: 'Returning', AcademicProgress: 'Promoted', Status: 'Active' };
const fee = { Active: 'YES', PayableOnline: 'YES', FeeCategory: 'School Fee', ClassName: 'All',
  StudentType: 'All', Gender: 'All', EnrollmentCategory: 'All', AcademicProgress: 'All',
  AcademicSession: 'All', Term: 'All', FeeCode: 'TUI', FeeName: 'Tuition', Amount: 100000,
  BillingCategory: 'All' };
const result = { ResultId: 'result-1', Status: 'Published', AcademicSession: '2026/2027',
  Term: 'First Term', ClassName: 'Grade 7', Subjects: [{ SubjectName: 'Math', Total: 80 }] };
const period = { AcademicSession: '2026/2027', Term: 'First Term' };
const policy = (mode = 'any-balance', extra = {}) => {
  const value = defaultAcademicPolicy();
  value.ResultAccess.VisibilityMode = 'all-published';
  Object.assign(value.ResultAccess.FinancialClearance, { Mode: mode, ...extra });
  return value;
};
const decision = (extra = {}) => evaluateAcademicResultAccess({ result, student, scholarshipFees: [],
  policy: policy(), hasActivePolicy: true, currentPeriod: period,
  finance: { OutstandingBalance: 1000000 }, ...extra });

test('only the exact Full Scholarship category is exempt, regardless of case/whitespace', () => {
  assert.equal(isFullScholarship('  FULL  scholarship  '), true);
  for (const value of ['Partial Scholarship', 'Scholarship', 'Sponsored', 'Regular', '']) {
    assert.equal(isFullScholarship(value), false);
  }
  assert.equal(explicitlyIncludesFullScholarship(['Partial Scholarship', 'Full scholarship']), true);
  assert.equal(explicitlyIncludesFullScholarship(['All', 'Full Scholarship']), false);
});

for (const section of ['primary', 'secondary']) {
  const pupil = { ...student, SchoolSection: section, ClassName: section === 'primary' ? 'Primary 5' : 'Grade 7' };
  test(`${section} Full Scholarship excludes generic fees and keeps only explicit assignments`, async () => {
    const exception = { ...fee, FeeCode: 'EX', FeeName: 'Special materials', Amount: 5000,
      BillingCategories: ['Sponsored', 'Full Scholarship'] };
    const rows = [fee, exception, { ...fee, BillingCategory: 'Regular', FeeCode: 'REG' },
      { ...fee, BillingCategory: 'Partial Scholarship', FeeCode: 'PART' },
      { ...fee, BillingCategory: '', FeeCode: 'BLANK' }, { ...fee, BillingCategory: '*', FeeCode: 'STAR' }];
    const before = JSON.stringify(rows);
    assert.deepEqual(rows.filter((row) => feeMatchesApplication(row, pupil)).map((row) => row.FeeCode), ['EX']);
    assert.deepEqual(applyBillingCategoryOverrides(rows, pupil).map((row) => row.FeeCode), ['EX']);
    assert.deepEqual(matchingFullScholarshipFeeItems(rows, pupil).map((row) => row.FeeCode), ['EX']);
    const preview = await buildStudentBillingPreview(pupil, { feeItems: rows, invoices: [] });
    assert.equal(preview.expectedTotal, 5000);
    assert.equal((await buildStudentBillingPreview(pupil, { feeItems: [fee] })).expectedTotal, 0);
    assert.equal(JSON.stringify(rows), before);
  });

  test(`${section} explicit scholarship fees must still match class, type, period and classifications`, () => {
    const assigned = { ...fee, BillingCategory: 'Full Scholarship' };
    const mismatches = [
      { ClassName: 'Grade 12' }, { StudentType: 'Boarding' }, { AcademicSession: '2025/2026' },
      { Term: 'Second Term' }, { Gender: 'Male' }, { EnrollmentCategory: 'New Intake' },
      { AcademicProgress: 'Repeating' }, { Active: 'NO' }, { Amount: 0 }, { FeeCategory: 'Wallet' },
      { BranchId: 'other' }, { SchoolSection: section === 'primary' ? 'secondary' : 'primary' },
      { FeeCode: 'ACC', FeeName: 'Acceptance fee', FeeCategory: 'Admission' }
    ];
    for (const mismatch of mismatches) {
      assert.deepEqual(matchingFullScholarshipFeeItems([{ ...assigned, ...mismatch }], pupil), [], JSON.stringify(mismatch));
    }
  });
}

test('Regular, Partial Scholarship and staff-child generic/override rules remain unchanged', () => {
  for (const category of ['Regular', 'Partial Scholarship', 'School Staff Child', 'Sponsored']) {
    assert.equal(feeMatchesApplication(fee, { ...student, BillingCategory: category }), true);
    const account = { ...student, BillingCategory: category };
    const specific = { ...fee, FeeCode: 'SPEC', BillingCategory: category, Amount: 50000 };
    assert.deepEqual(applyBillingCategoryOverrides([fee, specific].filter((row) => feeMatchesApplication(row, account)), account)
      .map((row) => row.FeeCode), ['SPEC']);
  }
});

test('result finance exemption applies independently of accountant modes and scholarship switches', () => {
  for (const mode of ['none', 'any-balance', 'minimum-paid-percentage', 'maximum-outstanding',
    'selected-fee-categories', 'manual-clearance', 'unconfigured']) {
    const access = decision({ policy: policy(mode, { RecognizeScholarships: false, AllowManualExemptions: false }) });
    assert.equal(access.Allowed, true, mode);
    assert.equal(access.Code, 'ELIGIBLE_BY_FULL_SCHOLARSHIP');
    assert.equal(access.UsedExemption, true);
  }
  assert.equal(decision({ student: { ...student, BillingCategory: 'Partial Scholarship' } }).Allowed, false);
  assert.equal(decision({ scholarshipFees: null }).Allowed, false);
});

test('scholarship does not bypass publication, visibility or active academic policy', () => {
  assert.equal(decision({ result: { ...result, Status: 'Draft' } }).Code, 'RESULT_NOT_PUBLISHED');
  assert.equal(decision({ hasActivePolicy: false }).Code, 'ACTIVE_POLICY_REQUIRED');
  const value = policy();
  value.ResultAccess.VisibilityMode = 'current-term';
  assert.equal(decision({ policy: value, currentPeriod: { ...period, Term: 'Second Term' } }).Code, 'OUTSIDE_VISIBLE_TERM');
  value.ResultAccess.VisibilityMode = 'current-session';
  assert.equal(decision({ policy: value, currentPeriod: { ...period, AcademicSession: '2027/2028' } }).Code, 'OUTSIDE_VISIBLE_SESSION');
});

test('result exceptions use the result period/class and cannot cross branch or section', () => {
  const assigned = { ...fee, BillingCategory: 'Full Scholarship', ClassName: 'Grade 7', Term: 'First Term' };
  const child = { ...student, ClassName: 'Grade 8', Term: 'Second Term' };
  assert.deepEqual(parentAcademicScholarshipFees(child, result, [assigned]).map((row) => row.FeeCode), ['TUI']);
  for (const scope of [{ BranchId: 'other' }, { SchoolSection: 'primary' }]) {
    assert.deepEqual(parentAcademicScholarshipFees(child, result, [{ ...assigned, ...scope }]), []);
  }
  assert.equal(parentAcademicScholarshipFees(child, result, null), null);
});

test('financial restrictions consider only assigned scholarship charges and their actual allocations', () => {
  const assigned = [{ ...fee, FeeCode: 'EX', BillingCategory: 'Full Scholarship' }];
  const invoices = [{ ...period, FeeCode: 'OLD', FeeCategory: 'School Fee', Debit: 1000000, Credit: 0 },
    { ...period, FeeCode: 'EX', FeeCategory: 'School Fee', Debit: 5000, Credit: 3000 },
    { ...period, Term: 'Second Term', FeeCode: 'EX', FeeCategory: 'School Fee', Debit: 9000, Credit: 0 },
    { ...period, FeeCode: 'EX', FeeCategory: 'School Fee', Status: 'Cancelled', Debit: 7000, Credit: 0 }];
  const ledger = [{ ...period, FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee', Credit: 3000 },
    { ...period, FeeCode: 'EX', FeeCategory: 'School Fee', Credit: 3000 }];
  const before = JSON.stringify({ invoices, ledger });
  const finance = academicFullScholarshipFinancialSummary(assigned, invoices, ledger, period);
  assert.equal(finance.TotalDebit, 5000);
  assert.equal(finance.TotalCredit, 3000);
  assert.equal(finance.OutstandingBalance, 2000);
  assert.equal(finance.FeeCategoryBalances['school fee'].Outstanding, 2000);
  assert.equal(decision({ scholarshipFees: assigned, finance }).Code, 'FINANCIAL_CLEARANCE_REQUIRED');
  assert.equal(decision({ scholarshipFees: assigned, finance, policy: policy('minimum-paid-percentage', { MinimumPaidPercentage: 50 }) }).Allowed, true);
  assert.equal(decision({ scholarshipFees: assigned, finance, policy: policy('manual-clearance') }).Allowed, false);
  const paid = academicFullScholarshipFinancialSummary(assigned, [{ ...invoices[1], Credit: 5000 }], ledger, period);
  assert.equal(decision({ scholarshipFees: assigned, finance: paid }).Allowed, true);
  const visible = publicAcademicResult(result, decision(), policy());
  assert.equal(visible.Subjects.length, 1);
  assert.equal(visible.Access.UsedExemption, true);
  assert.equal(JSON.stringify({ invoices, ledger }), before);
});

test('ledger-only exception charges are considered without using unrelated credit', () => {
  const assigned = [{ ...fee, FeeCode: 'EX', BillingCategory: 'Full Scholarship' }];
  const finance = academicFullScholarshipFinancialSummary(assigned, [], [
    { ...period, FeeCode: 'EX', FeeCategory: 'School Fee', Debit: 5000, Credit: 1000 },
    { ...period, FeeCode: 'OLD', FeeCategory: 'School Fee', Credit: 500000 }
  ], period);
  assert.equal(finance.OutstandingBalance, 4000);
});

test('mixed invoice and ledger-only exceptions both count; invoice overallocations are capped', () => {
  const assigned = ['EX', 'EX2'].map((code) => ({ ...fee, FeeCode: code, BillingCategory: 'Full Scholarship' }));
  const finance = academicFullScholarshipFinancialSummary(assigned,
    [{ ...period, FeeCode: 'EX', FeeCategory: 'School Fee', Debit: 5000, Credit: 10000 }],
    [{ ...period, FeeCode: 'EX2', FeeCategory: 'School Fee', Debit: 10000, Credit: 1000 }], period);
  assert.equal(finance.TotalDebit, 15000);
  assert.equal(finance.TotalCredit, 6000);
  assert.equal(finance.OutstandingBalance, 9000);
  assert.equal(finance.FeeCategoryBalances['school fee'].Outstanding, 9000);
});

test('parent view and print use server-loaded scholarship assignments, audited after eligibility', async () => {
  const source = await readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8');
  const activity = source.slice(source.indexOf('async function getChildActivity('), source.indexOf('async function', source.indexOf('async function getChildActivity(') + 30));
  assert.match(activity, /isFullScholarship\(child.BillingCategory\) \? listCollection\(env, 'feeItems'\)/);
  assert.match(activity, /feeItems: scholarshipFeeItems/);
  assert.doesNotMatch(activity, /listCollection\(env, 'feeItems'\)\.catch/);
  const block = source.slice(source.indexOf('async function parentAcademicResults('), source.indexOf('function isWalletFee('));
  let audits = 0;
  let activePolicy = policy('manual-clearance');
  const run = vm.runInNewContext(`(${block})`, {
    clean: (value) => String(value ?? '').trim(), lower: (value) => String(value ?? '').trim().toLowerCase(),
    recordMatchesSelectedChildScope: (row, scope) => row.BranchId === scope.branchId && row.SchoolSection === scope.schoolSection,
    academicResultBelongsToChild: (row, child) => row.StudentRef === child.AdmissionNo,
    academicResultId: (row) => row.ResultId, academicFinancialSummary, parentAcademicScholarshipFees,
    academicResultPeriod: () => period, academicPolicyScopeChain: () => [{}],
    loadAcademicPolicyView: async () => ({ ActivePolicy: activePolicy, Sources: [{}] }),
    academicPolicyIssues: () => [], evaluateAcademicResultAccess, academicFullScholarshipFinancialSummary,
    academicClearanceForResult: () => null, publicAcademicResult,
    auditParentAcademicResultAccess: async () => { audits += 1; }
  });
  const ownResult = { ...result, StudentRef: student.AdmissionNo, BranchId: 'main', SchoolSection: 'secondary' };
  for (const purpose of ['View', 'Print']) {
    const rows = await run({}, { child: student, selectedScope: { branchId: 'main', schoolSection: 'secondary' },
      schoolProfile: {}, resultRows: [ownResult, { ...ownResult, BranchId: 'other' },
        { ...ownResult, StudentRef: 'OTHER' }, { ...ownResult, SchoolSection: 'primary' }], feeItems: [fee], purpose });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Access.Code, 'ELIGIBLE_BY_FULL_SCHOLARSHIP');
  }
  assert.equal(audits, 2);
  activePolicy = policy('any-balance');
  const options = { child: student, selectedScope: { branchId: 'main', schoolSection: 'secondary' },
    schoolProfile: {}, resultRows: [ownResult], feeItems: [{ ...fee, FeeCode: 'EX', BillingCategory: 'Full Scholarship' }],
    invoices: [{ ...period, FeeCode: 'OLD', FeeCategory: 'School Fee', Debit: 1000000, Credit: 0 },
      { ...period, FeeCode: 'EX', FeeCategory: 'School Fee', Debit: 5000, Credit: 0 }],
    accountSummary: { OutstandingBalance: 1005000 }, ledger: [] };
  const blocked = await run({}, options);
  assert.equal(blocked[0].Access.Code, 'FINANCIAL_CLEARANCE_REQUIRED');
  assert.equal('Subjects' in blocked[0], false);
  const paid = await run({}, { ...options, invoices: options.invoices.map((row) =>
    row.FeeCode === 'EX' ? { ...row, Credit: 5000 } : row) });
  assert.equal(paid[0].Access.Allowed, true);
  assert.equal(paid[0].Subjects.length, 1);
  assert.equal(audits, 4);
});

test('actual invoice generator treats scholarship-without-assigned-fees as a successful no-op', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('async function generateSchoolFeeInvoicesForAccount('),
    source.indexOf('function ledgerDocumentId('));
  let items = [fee];
  const writes = [];
  let creditApplications = 0;
  const lower = (value) => String(value ?? '').trim().toLowerCase();
  const run = vm.runInNewContext(`(${block})`, {
    clean: (value) => String(value ?? '').trim(), normalizeMatchText: lower,
    yesNo: (value) => lower(value) === 'yes' ? 'YES' : 'NO', asMoneyNumber: (value) => Number(value) || 0,
    normalizeFeeItem: (row) => row, isFullScholarship, resolveStudentEnrollmentCategory,
    applyBillingCategoryOverrides, feeMatchesApplication, isSchoolFeeInvoice,
    isWalletFee: (row) => lower(row.FeeCategory) === 'wallet',
    listCollection: async () => items, queryAccountRows: async () => [], normalizeInvoice: (row) => row,
    loadNotificationSettings: async () => ({}), resolvedPeriodValue: (value, fallback) => lower(value) === 'all' ? fallback : value,
    normalizeReferenceText: lower, ledgerDocumentId: () => 'test-invoice', schoolSectionFor: (row) => row.SchoolSection,
    invoiceReminderFields: () => ({}), nowIso: () => '2026-10-08T00:00:00.000Z',
    feeDueDate: (value) => value, safeDocumentId: (value) => value,
    batchUpsertDocuments: async (_env, rows) => { writes.push(...rows); },
    applyDueSchoolFeeCreditsForAccount: async () => { creditApplications += 1; }
  });
  for (const edition of ['school', 'church', 'other']) {
    for (const section of ['primary', 'secondary']) {
      const reply = await run({ ORGANISATION_EDITION: edition }, {
        ResolvedStudent: { ...student, SchoolSection: section }, NotificationSettings: {}
      }, student.AdmissionNo);
      assert.equal(reply.ok, true);
      assert.equal(reply.exempt, true);
      assert.equal(reply.created, 0);
      assert.equal(reply.updated, 0);
    }
  }
  assert.equal(writes.length, 0);
  assert.equal(creditApplications, 0);
  items = [fee, { ...fee, FeeCode: 'EX', FeeName: 'Special materials', BillingCategory: 'Full Scholarship', Amount: 5000 }];
  const reply = await run({}, { ResolvedStudent: student, NotificationSettings: {} }, student.AdmissionNo);
  assert.equal(reply.created, 1);
  assert.deepEqual(writes.map((row) => row.data.FeeCode), ['EX']);
  assert.equal(writes[0].data.Debit, 5000);
});
