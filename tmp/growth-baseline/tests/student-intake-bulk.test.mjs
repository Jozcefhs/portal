import test from 'node:test';
import assert from 'node:assert/strict';
import { admissionYearIntakeFingerprint, admissionYearIntakePlan } from '../functions/lib/student-intake-bulk.js';
import { admissionYearEnrollmentCategory, admissionYearCode } from '../functions/lib/student-intake-classification.js';

const row = (id, className, category, overrides = {}) => ({
  __id: id,
  __scopePath: 'schoolBranches/main/sections/secondary/students',
  __updateTime: `2026-09-30T12:00:0${id}Z`,
  BranchId: 'main', SchoolSection: 'secondary', AcademicSession: '2026/2027',
  AdmissionNo: `DCA/26/${id}`, Term: 'First Term',
  ClassName: className, EnrollmentCategory: category,
  ...overrides
});

test('admission year and First Term determine intake independently of class or saved category', () => {
  for (const className of ['Grade 7', 'Grade 7 / Brilliance', 'Grade 8', 'Grade 10 / Genius', 'Primary 5', 'Nursery 2']) {
    assert.equal(admissionYearEnrollmentCategory(row('263', className, 'Returning')), 'New Intake');
  }
  for (const AdmissionNo of ['DCA/26/263', ' dca / 26 / 263 ', 'ABC/2026/001', 'DCA-26-263']) {
    assert.equal(admissionYearEnrollmentCategory(row('1', 'Grade 8', '', { AdmissionNo })), 'New Intake');
  }
  for (const Term of ['Second Term', 'Third Term', 'term2', '3']) {
    assert.equal(admissionYearEnrollmentCategory(row('1', 'Grade 7', 'New Intake', { Term })), 'Returning');
  }
  assert.equal(admissionYearEnrollmentCategory(row('1', 'Grade 7', 'New Intake', { AdmissionNo: 'DCA/25/001' })), 'Returning');
  assert.equal(admissionYearEnrollmentCategory(row('1', 'Grade 8', 'New Intake', { AcademicSession: '2027/2028' })), 'Returning');
  assert.equal(admissionYearEnrollmentCategory(row('1', 'Grade 10', 'Returning', { AdmissionNo: 'DCA/27/001', AcademicSession: '2027/2028' })), 'New Intake');
});

test('missing or unrecognised admission numbers and periods do not invent an intake classification', () => {
  for (const AdmissionNo of ['', 'DCA/26X/1', 'DCA/26/', '26', 'PAYMENT-20261016', 'DCA/26/001/extra']) {
    assert.equal(admissionYearCode({ AdmissionNo }), '');
    assert.equal(admissionYearEnrollmentCategory(row('1', 'Grade 7', '', { AdmissionNo })), null);
  }
  for (const overrides of [{ AcademicSession: '' }, { AcademicSession: '2026/2028' }, { Term: '' }, { Term: 'All' }]) {
    assert.equal(admissionYearEnrollmentCategory(row('1', 'Grade 7', '', overrides)), null);
  }
  assert.equal(admissionYearEnrollmentCategory({ AccountRef: 'DCA/26/001', AcademicSession: '2026/2027', Term: 'First Term' }), 'New Intake');
});

test('intake plan is branch/session scoped and skips already corrected records', async () => {
  const rows = [
    row('1', 'Grade 7', 'Returning'),
    row('2', 'Grade 7 / Brilliance', 'New Intake'),
    row('3', 'Grade 7', 'Returning', { BranchId: 'area-one' }),
    row('4', 'Grade 7', 'Returning', { AcademicSession: '2025/2026' }),
    row('5', 'Grade 8', 'Returning'),
    row('6', 'Primary 5', 'Returning', { SchoolSection: 'primary' }),
    row('7', 'Grade 10', 'Returning'),
    row('8', 'Grade 7', 'Returning', { AdmissionNo: 'DCA/25/008' }),
    row('9', 'Grade 10', 'Returning', { Term: 'Second Term' }),
    row('10', 'Grade 10', 'Returning', { Term: '' }),
    row('11', 'Grade 10', 'Returning', { Status: 'Withdrawn' }),
    row('12', 'Grade 10', 'Returning', { AdmissionNo: 'UNKNOWN' })
  ];
  const before = JSON.stringify(rows);
  const scope = { branchId: 'main', academicSession: '2026/2027', schoolSectionAccess: 'All' };
  const plan = admissionYearIntakePlan(rows, scope);
  assert.equal(plan.total, 5);
  assert.equal(plan.alreadyNew, 1);
  assert.deepEqual(plan.toChange.map((item) => item.__id), ['1', '5', '6', '7']);
  assert.equal(plan.excludedOtherSession, 1);
  assert.equal(plan.excludedAdmissionYear, 1);
  assert.equal(plan.excludedOtherTerm, 2);
  assert.equal(plan.excludedInactive, 1);
  assert.equal(plan.unrecognizedAdmissionNumbers, 1);
  assert.equal(plan.missingRevision, 0);
  const fingerprint = await admissionYearIntakeFingerprint(plan);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  const changed = admissionYearIntakePlan([row('1', 'Grade 7', 'New Intake'), ...rows.slice(1)], scope);
  assert.notEqual(await admissionYearIntakeFingerprint(changed), fingerprint);
  assert.equal(await admissionYearIntakeFingerprint(admissionYearIntakePlan([...rows].reverse(), scope)), fingerprint);
  assert.notEqual(await admissionYearIntakeFingerprint(admissionYearIntakePlan([{ ...rows[0], __updateTime: 'new' }, ...rows.slice(1)], scope)), fingerprint);
  assert.equal(JSON.stringify(rows), before);
  const corrected = rows.map(item => plan.toChange.includes(item) ? { ...item, EnrollmentCategory: 'New Intake' } : item);
  assert.equal(admissionYearIntakePlan(corrected, scope).toChange.length, 0);
  assert.deepEqual(admissionYearIntakePlan(rows, { ...scope, schoolSectionAccess: 'Primary' }).toChange.map(item => item.__id), ['6']);
  assert.equal(admissionYearIntakePlan(rows, { ...scope, schoolSectionAccess: 'Secondary' }).toChange.length, 3);
});

test('missing revisions block application rather than allowing an unconditional write', () => {
  const plan = admissionYearIntakePlan([row('1', 'Grade 8', 'Returning', { __updateTime: '' })], { branchId: 'main', academicSession: '2026/2027' });
  assert.equal(plan.missingRevision, 1);
});

test('intake plan rejects broad or unspecified scope', () => {
  for (const overrides of [{ branchId: '' }, { branchId: 'all' }, { branchId: '*' }, { academicSession: '' },
    { academicSession: '2026/2028' }, { schoolSectionAccess: 'Unknown' }]) {
    assert.throws(() => admissionYearIntakePlan([], { branchId: 'main', academicSession: '2026/2027', ...overrides }), /Choose a branch/);
  }
});
