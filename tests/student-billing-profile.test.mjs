import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { studentProfileValue, selectStudentBillingProfile, selectStudentBillingProfiles } from '../functions/lib/student-billing-profile.js';
import { getAccountsOverview, buildStudentBillingPreview } from '../functions/api/backend.js';
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
  const view = source.slice(source.indexOf("document.querySelector('[data-billing-preview-content]')"), source.indexOf("document.getElementById('studentBillingPreviewDialog').showModal()"));
  assert.match(view, /class="admin-table-wrap"/);
  assert.match(view, /class="admin-table"/);
  assert.match(view, /escapeHtml\(row.name \|\| row.code\)/);
});
