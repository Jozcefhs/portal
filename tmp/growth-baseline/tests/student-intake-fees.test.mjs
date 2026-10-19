import test from 'node:test';
import assert from 'node:assert/strict';
import { feeMatchesApplication, resolveStudentEnrollmentCategory, buildStudentBillingPreview } from '../functions/api/backend.js';

const student = { AdmissionNo: 'DCA/26/263', DisplayName: 'Sample pupil', ClassName: 'Grade 8',
  BranchId: 'main', SchoolSection: 'secondary', EnrollmentCategory: 'Returning', AcademicProgress: 'Promoted',
  AcademicSession: '2026/2027', Term: 'First Term', StudentType: 'Boarding Student', BillingCategory: 'Regular' };
const fee = { FeeCode: 'INTAKE', FeeName: 'Intake materials', Amount: 5000, FeeCategory: 'School Fee',
  EnrollmentCategory: 'New Intake', AcademicProgress: 'All', AcademicSession: '2026/2027', Term: 'First Term',
  ClassName: 'All', StudentType: 'All', Gender: 'All', BillingCategory: 'All', Active: 'YES', PayableOnline: 'YES', BranchId: 'main' };

test('fee matching uses the intake year across all classes, even before the saved profile is corrected', async () => {
  for (const ClassName of ['Grade 7', 'Grade 8 / Classic', 'Grade 10 / Brilliance', 'Grade 12', 'Primary 4']) {
    const pupil = { ...student, ClassName, SchoolSection: ClassName.startsWith('Primary') ? 'primary' : 'secondary' };
    assert.equal(resolveStudentEnrollmentCategory(pupil), 'New Intake');
    assert.equal(feeMatchesApplication(fee, pupil), true);
    const preview = await buildStudentBillingPreview(pupil, { feeItems: [fee], invoices: [] });
    assert.equal(preview.profile.EnrollmentCategory, 'New Intake');
    assert.equal(preview.expectedTotal, 5000);
    assert.equal(preview.invoicedTotal, 0);
  }
});

test('fee class, boarding/day, branch, scholarship and academic-progress rules still apply', () => {
  for (const mismatch of [{ ClassName: 'Grade 7' }, { StudentType: 'Day Student' }, { BranchId: 'annex' },
    { BillingCategory: 'Full Scholarship' }, { AcademicProgress: 'Repeating' }]) {
    assert.equal(feeMatchesApplication({ ...fee, ...mismatch }, student), false, JSON.stringify(mismatch));
  }
  assert.equal(feeMatchesApplication({ ...fee, ClassName: 'Grade 7, Grade 8', StudentType: 'Boarding Student' }, student), true);
});

test('earlier admission years, later terms and later sessions never receive intake-only charges', async () => {
  for (const change of [{ AdmissionNo: 'DCA/25/263' }, { Term: 'Second Term' }, { Term: 'Third Term' }, { AcademicSession: '2027/2028' }]) {
    const pupil = { ...student, EnrollmentCategory: 'New Intake', ...change };
    const flexibleFee = { ...fee, AcademicSession: 'All', Term: 'All' };
    assert.equal(resolveStudentEnrollmentCategory(pupil), 'Returning');
    assert.equal(feeMatchesApplication(flexibleFee, pupil), false);
    assert.equal(feeMatchesApplication({ ...flexibleFee, EnrollmentCategory: 'Returning' }, pupil), true);
    assert.equal((await buildStudentBillingPreview(pupil, { feeItems: [flexibleFee] })).expectedTotal, 0);
  }
});

test('billing preview exposes missing intake components without rewriting existing invoices or payments', async () => {
  const data = { feeItems: [fee], invoices: [{ InvoiceId: 'OLD', AccountRef: student.AdmissionNo,
    BranchId: 'main', FeeCode: 'INTAKE', FeeName: fee.FeeName, FeeCategory: 'School Fee', Amount: 3000, Credit: 1000,
    AcademicSession: student.AcademicSession, Term: student.Term, Status: 'Part Paid' }],
    payments: [{ PaymentId: 'RECEIPT', AccountRef: student.AdmissionNo, Amount: 1000, Status: 'Paid', FeeCategory: 'School Fee' }] };
  const before = JSON.stringify({ student, data });
  const preview = await buildStudentBillingPreview(student, data);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.expectedTotal, 5000);
  assert.equal(preview.invoicedTotal, 3000);
  assert.equal(preview.difference, 2000);
  assert.equal(JSON.stringify({ student, data }), before);
});

test('unstructured legacy references retain their explicit category and linked admission handling', () => {
  for (const EnrollmentCategory of ['Returning', 'New Intake']) {
    assert.equal(resolveStudentEnrollmentCategory({ ...student, AdmissionNo: 'LEGACY-ID', EnrollmentCategory }), EnrollmentCategory);
  }
});
