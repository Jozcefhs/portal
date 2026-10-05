import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { studentProfileValue, selectStudentBillingProfile, selectStudentBillingProfiles } from '../functions/lib/student-billing-profile.js';
import { getAccountsOverview, buildStudentBillingPreview, studentBillingReconciliationPlan } from '../functions/api/backend.js';
import { billingPreviewStudent } from '../functions/api/student-billing-preview.js';

const student = { AdmissionNo: 'DCA/24/1874', DisplayName: 'Test student', ClassName: 'Grade 12',
  StudentType: 'Boarding Student', Gender: 'Female', BillingCategory: 'Regular', BranchId: 'main',
  AcademicSession: '2026/2027', Term: 'First Term', SchoolSection: 'secondary', ProfileCompletionStatus: 'Complete',
  __scopePath: 'schoolBranches/main/sections/secondary/students' };
const inputs = (students) => ({ schoolProfile: {}, students, applications: [], accounts: [], payments: [],
  invoices: [], ledger: [], feeItems: [], billingCategories: [], accountSummaries: [] });

test('saved billing profile wins over stale imported aliases, including deliberate resets', async () => {
  const row = { ...student, studentType: 'Day Student', gender: 'Not set', billingCategory: 'Discounted',
    className: 'Grade 10', academicProgress: 'Repeating', AcademicProgress: 'Promoted', BillingCategory: '' };
  const overview = await getAccountsOverview({}, inputs([row]));
  assert.equal(overview.accounts[0].StudentType, 'Boarding Student');
  assert.equal(overview.accounts[0].Gender, 'Female');
  assert.equal(overview.accounts[0].BillingCategory, 'Regular');
  assert.equal(overview.accounts[0].ClassName, 'Grade 12');
  assert.equal(overview.accounts[0].AcademicProgress, 'Promoted');
  assert.equal(studentProfileValue({ Gender: '', gender: 'Male' }, 'Gender', ['gender']), '');
  assert.equal(studentProfileValue({ studentType: 'Boarding Student' }, 'StudentType', ['studentType']), 'Boarding Student');
});

test('completed scoped profile supersedes an incomplete legacy root copy in either order', async () => {
  const legacy = { ...student, StudentType: 'Day Student', Gender: '', ProfileCompletionStatus: 'Needs completion', __scopePath: 'students' };
  for (const rows of [[legacy, student], [student, legacy]]) {
    const overview = await getAccountsOverview({}, inputs(rows));
    assert.equal(overview.accounts.length, 1);
    assert.equal(overview.accounts[0].StudentType, 'Boarding Student');
    assert.equal(overview.accounts[0].Gender, 'Female');
  }
  assert.equal(selectStudentBillingProfiles([{ ...legacy, ProfileCompletionStatus: 'Complete', UpdatedAt: '2026-10-05' }, student])[0].__scopePath, 'students');
});

test('profile selection separates branch and primary/secondary identities', () => {
  const primary = { ...student, SchoolSection: 'primary', __scopePath: 'schoolBranches/main/sections/primary/students' };
  const other = { ...student, BranchId: 'other', __scopePath: 'schoolBranches/other/sections/secondary/students' };
  assert.equal(selectStudentBillingProfiles([student, primary, other]).length, 3);
  assert.equal(billingPreviewStudent([student, primary, other], { branchId: 'main', schoolSectionAccess: 'secondary' }, student.AdmissionNo).StudentType, 'Boarding Student');
  assert.throws(() => billingPreviewStudent([primary, other], { branchId: 'main', schoolSectionAccess: 'secondary' }, student.AdmissionNo), /not found/);
  assert.throws(() => billingPreviewStudent([student, primary], { branchId: 'main', schoolSectionAccess: 'All' }, student.AdmissionNo), /more than one/);
  assert.equal(selectStudentBillingProfile([student, primary, other], { branchId: 'main', schoolSectionAccess: 'secondary' }).StudentType, 'Boarding Student');
  assert.equal(selectStudentBillingProfile([primary, other], { branchId: 'main', schoolSectionAccess: 'secondary' }), null);
  assert.throws(() => selectStudentBillingProfile([student, primary], { branchId: 'main' }), /ambiguous/);
});

test('future invoice lookups use the same completed-profile priority and preserve explicit identity paths', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const lookup = source.slice(source.indexOf('async function findStudentByAccountRef('), source.indexOf('function findStudentByAccountRefInRows'));
  assert.match(lookup, /selectStudentBillingProfile\(await getSchoolDocumentsById/);
  assert.match(lookup, /scopePath\s*\? await getDocument\(env, scopePath/);
  assert.match(lookup, /selectStudentBillingProfile\(rows, requestedScope\)/);
  assert.doesNotMatch(lookup, /rows\[0\]/);
  const legacy = { ...student, StudentType: 'Day Student', ProfileCompletionStatus: 'Needs completion', __scopePath: 'students' };
  assert.equal(selectStudentBillingProfile([legacy, student], { branchId: 'main' }).StudentType, 'Boarding Student');
});

test('billing preview identifies missing boarding/female charges without changing financial input', async () => {
  const fee = { Active: 'YES', PayableOnline: 'YES', FeeCategory: 'School Fee', ClassName: 'All', BillingCategory: 'All',
    AcademicSession: '2026/2027', Term: 'First Term', EnrollmentCategory: 'All', AcademicProgress: 'All' };
  const data = { feeItems: [{ ...fee, FeeCode: 'TUITION', FeeName: 'Tuition', StudentType: 'All', Gender: 'All', Amount: 100 },
    { ...fee, FeeCode: 'BOARD', FeeName: 'Boarding', StudentType: 'Boarding Student', Gender: 'All', Amount: 200 },
    { ...fee, FeeCode: 'FEMALE', FeeName: 'Female uniform', StudentType: 'All', Gender: 'Female', Amount: 30 }],
    invoices: [{ InvoiceId: 'INV-1', AccountRef: student.AdmissionNo, FeeCategory: 'School Fee', FeeCode: 'TUITION', Amount: 100,
      AcademicSession: '2026/2027', Term: 'First Term' }],
    accountSummaries: [{ AccountRef: student.AdmissionNo, CreditBalance: 415720 }] };
  const before = JSON.stringify(data);
  const preview = await buildStudentBillingPreview(student, data);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.profile.Gender, 'Female');
  assert.equal(preview.expectedTotal, 330);
  assert.equal(preview.invoicedTotal, 100);
  assert.equal(preview.difference, 230);
  assert.equal(preview.recordedCredit, 415720);
  assert.equal(JSON.stringify(data), before);
  assert.equal(preview.rows.find((row) => row.code === 'BOARD').difference, 200);
});

test('preview excludes other periods and exposes obsolete charges for review', async () => {
  const invoice = { AccountRef: student.AdmissionNo, FeeCode: 'OLD-DAY', FeeCategory: 'School Fee', Amount: 50,
    AcademicSession: '2026/2027', Term: 'First Term' };
  const preview = await buildStudentBillingPreview(student, { invoices: [invoice,
    { ...invoice, FeeCode: 'OLD-TERM', Term: 'Second Term' },
    { ...invoice, FeeCode: 'VOID', Status: 'Cancelled' }] });
  assert.equal(preview.invoicedTotal, 50);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].difference, -50);
});

test('billing preview endpoint enforces staff scope and has no posting or financial write path', async () => {
  const source = await readFile(new URL('../functions/api/student-billing-preview.js', import.meta.url), 'utf8');
  assert.match(source, /requireStaffSession/);
  assert.match(source, /includes\('accounts'\)/);
  assert.match(source, /includes\('students'\)/);
  assert.match(source, /schoolSectionAccess: user.schoolSectionAccess/);
  assert.doesNotMatch(source, /upsertDocument|patchDocument|generateSchoolFeeInvoices|recordManualPayment|recalculateAccount/);
});

test('preview uses the existing padded, scrollable finance table layout', async () => {
  const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(source, /class="config-group" data-billing-preview-content/);
  const start = source.indexOf('const profile = preview.profile;');
  const view = source.slice(start, source.indexOf("document.getElementById('studentBillingPreviewDialog').showModal()", start));
  assert.match(view, /class="admin-table-wrap"/);
  assert.match(view, /class="admin-table"/);
  assert.match(view, /escapeHtml\(row.name \|\| row.code\)/);
});

const reconciliationData = () => ({ feeItems: ['TUITION', 'BOARD'].map((code, index) => ({
  FeeCode: code, FeeName: code, FeeCategory: 'School Fee', Active: 'YES', Amount: index ? 200 : 100,
  StudentType: index ? 'Boarding Student' : 'All', Gender: 'All', ClassName: 'All', BillingCategory: 'All',
  AcademicSession: '2026/2027', Term: 'First Term'
})), invoices: [{ InvoiceId: 'INV-1', AccountRef: student.AdmissionNo, FeeCategory: 'School Fee',
  FeeCode: 'TUITION', Amount: 100, Credit: 100, AcademicSession: '2026/2027', Term: 'First Term' }] });

test('missing-only reconciliation applies to completed primary and secondary students without changing input', async () => {
  for (const section of ['primary', 'secondary']) {
    const row = { ...student, SchoolSection: section, ClassName: section === 'primary' ? 'Primary 5' : 'Grade 12',
      __scopePath: `schoolBranches/main/sections/${section}/students` };
    const data = reconciliationData();
    const before = JSON.stringify(data);
    const plan = await studentBillingReconciliationPlan(row, data);
    assert.equal(plan.ready, true);
    assert.equal(plan.missing.length, 1);
    assert.equal(plan.difference, 200);
    assert.equal(plan.previewToken.length, 64);
    assert.equal(JSON.stringify(data), before);
  }
});

test('reconciliation excludes incomplete profiles, unbilled accounts, changed amounts and duplicates', async () => {
  assert.equal((await studentBillingReconciliationPlan({ ...student, ProfileCompletionStatus: '' }, reconciliationData())).ready, false);
  assert.equal((await studentBillingReconciliationPlan(student, { ...reconciliationData(), invoices: [] })).ready, false);
  const changed = reconciliationData();
  changed.invoices[0].Amount = 90;
  assert.equal((await studentBillingReconciliationPlan(student, changed)).ready, false);
  const duplicates = reconciliationData();
  duplicates.invoices.push({ ...duplicates.invoices[0], InvoiceId: 'INV-2' });
  assert.equal((await studentBillingReconciliationPlan(student, duplicates)).ready, false);
});

test('obsolete day charges and cancelled components need finance review, not automatic reversal or rebilling', async () => {
  const data = reconciliationData();
  data.invoices.push({ ...data.invoices[0], InvoiceId: 'CANCELLED-BOARD', FeeCode: 'BOARD', Status: 'Cancelled', Amount: 200 });
  const cancelled = await studentBillingReconciliationPlan(student, data);
  assert.equal(cancelled.ready, false);
  assert.match(cancelled.reason, /cancelled/);
  data.invoices[1] = { ...data.invoices[0], InvoiceId: 'OLD-DAY', FeeCode: 'DAY', Amount: 50 };
  assert.equal((await studentBillingReconciliationPlan(student, data)).ready, false);
});

test('preview token changes on profile or charge changes but permits newly received real payments', async () => {
  const data = reconciliationData();
  const first = await studentBillingReconciliationPlan(student, data);
  assert.notEqual((await studentBillingReconciliationPlan({ ...student, __updateTime: 'new-revision' }, data)).previewToken, first.previewToken);
  data.feeItems[1].Amount += 1;
  assert.notEqual((await studentBillingReconciliationPlan(student, data)).previewToken, first.previewToken);
  data.feeItems[1].Amount -= 1;
  data.accountSummaries = [{ AccountRef: student.AdmissionNo, CreditBalance: 500 }];
  assert.equal((await studentBillingReconciliationPlan(student, data)).previewToken, first.previewToken);
});

test('reconciliation route requires branch-scoped school finance authority and complete reports', async () => {
  const route = await readFile(new URL('../functions/api/student-billing-reconciliation.js', import.meta.url), 'utf8');
  assert.match(route, /user.role !== 'Super Admin'/);
  assert.match(route, /user.edition !== 'school'/);
  assert.match(route, /includes\('accounts'\)/);
  assert.match(route, /includes\('students'\)/);
  assert.match(route, /listCollectionForReport/);
  assert.match(route, /PreviewToken/);
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const source = backend.slice(backend.indexOf('export async function reconcileStudentBilling'), backend.indexOf('async function saveOrganizationModulePreferences'));
  assert.match(source, /exists: false/);
  assert.match(source, /updateTime: row.__updateTime/);
  assert.match(source, /updateMask: \[field\]/);
  assert.match(source, /audit.data.Before/);
  assert.match(source, /await batchCommitDocuments/);
  assert.doesNotMatch(source, /recordManualPayment|deleteDocument|generateSchoolFeeInvoicesForAccount/);
});
