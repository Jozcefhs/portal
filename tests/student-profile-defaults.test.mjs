import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { studentProfileDefaults, withStudentProfileDefaults, missingStudentProfileDefaults,
  studentProfileDefaultsPlan, studentProfileDefaultsFingerprint } from '../functions/lib/student-profile-defaults.js';

test('returning student defaults are Regular and Promoted across primary and secondary', () => {
  for (const SchoolSection of ['primary', 'secondary']) {
    const student = { SchoolSection, EnrollmentCategory: 'Returning', BillingCategory: ' ', AcademicProgress: '' };
    assert.deepEqual(studentProfileDefaults(student), { BillingCategory: 'Regular', AcademicProgress: 'Promoted' });
    assert.deepEqual(missingStudentProfileDefaults(student), { BillingCategory: 'Regular', AcademicProgress: 'Promoted' });
    assert.equal(student.BillingCategory, ' ');
    assert.equal(withStudentProfileDefaults(student).SchoolSection, SchoolSection);
  }
});

test('admin-selected categories and academic progress survive defaulting and backfill', () => {
  const student = { BillingCategory: 'School Staff Child', EnrollmentCategory: 'Returning', AcademicProgress: 'Repeating' };
  assert.deepEqual(studentProfileDefaults(student), { BillingCategory: 'School Staff Child', AcademicProgress: 'Repeating' });
  assert.deepEqual(missingStudentProfileDefaults(student), {});
  assert.deepEqual(studentProfileDefaults({ billingCategory: 'Scholarship', enrollmentCategory: 'Returning', academicProgress: 'Repeating' }),
    { BillingCategory: 'Scholarship', AcademicProgress: 'Repeating' });
});

test('new intake and unknown enrollment are not automatically promoted', () => {
  for (const EnrollmentCategory of ['New Intake', '']) {
    assert.deepEqual(studentProfileDefaults({ EnrollmentCategory }), { BillingCategory: 'Regular', AcademicProgress: '' });
    assert.deepEqual(missingStudentProfileDefaults({ EnrollmentCategory }), { BillingCategory: 'Regular' });
  }
  assert.equal(studentProfileDefaults({ EnrollmentCategory: 'New Intake', AcademicProgress: 'New Intake' }).AcademicProgress, 'New Intake');
});

test('canonical resets do not revive stale aliases, and repeated backfill is a no-op', () => {
  const student = { BillingCategory: '', billingCategory: 'Scholarship', AcademicProgress: '', academicProgress: 'Repeating', EnrollmentCategory: 'Returning' };
  const patch = missingStudentProfileDefaults(student);
  assert.deepEqual(patch, { BillingCategory: 'Regular', AcademicProgress: 'Promoted' });
  assert.deepEqual(missingStudentProfileDefaults({ ...student, ...patch }), {});
});

test('bulk preview tracks only missing fields and changes fingerprint on concurrent edits or scope changes', async () => {
  const rows = [{ __id: 'one', __scopePath: 'students', __updateTime: 'v1', EnrollmentCategory: 'Returning' },
    { __id: 'two', __scopePath: 'students', BillingCategory: 'Discount', AcademicProgress: 'Repeating', EnrollmentCategory: 'Returning' },
    { __id: 'three', __scopePath: 'students', EnrollmentCategory: 'New Intake' }];
  const plan = studentProfileDefaultsPlan(rows);
  assert.equal(plan.total, 3);
  assert.equal(plan.changes.length, 2);
  assert.equal(plan.billingCategory, 2);
  assert.equal(plan.academicProgress, 1);
  const scope = { branchId: 'main', schoolSectionAccess: 'All' };
  const fingerprint = await studentProfileDefaultsFingerprint(plan, scope);
  assert.equal(fingerprint, await studentProfileDefaultsFingerprint(studentProfileDefaultsPlan([...rows].reverse()), scope));
  assert.notEqual(fingerprint, await studentProfileDefaultsFingerprint(plan, { ...scope, branchId: 'other' }));
  assert.notEqual(fingerprint, await studentProfileDefaultsFingerprint(studentProfileDefaultsPlan([{ ...rows[0], __updateTime: 'v2' }, ...rows.slice(1)]), scope));
});

test('all student save paths and both web readers share the same defaults', async () => {
  const scope = await readFile(new URL('../functions/lib/school-scope.js', import.meta.url), 'utf8');
  assert.match(scope, /collection === 'students' \? withStudentProfileDefaults/);
  for (const path of ['admin.js', 'parent-dashboard.js']) {
    assert.match(await readFile(new URL(`../functions/api/${path}`, import.meta.url), 'utf8'), /row = withStudentProfileDefaults\(row\)/);
  }
});

test('maintenance is branch-scoped, revision-guarded, audited, and has no financial writes', async () => {
  const route = await readFile(new URL('../functions/api/staff-students.js', import.meta.url), 'utf8');
  const start = route.indexOf("if (['previewprofiledefaults', 'applyprofiledefaults']");
  const source = route.slice(start, route.indexOf("if (['previewgrade7intake', 'applygrade7intake']", start));
  assert.match(source, /user.role !== 'Super Admin'/);
  assert.match(source, /user.subscriptionReadOnly/);
  assert.match(source, /visibleToUser\(row, user\)/);
  assert.match(source, /updateTime: row.__updateTime/);
  assert.match(source, /updateMask:/);
  assert.match(source, /staffRecordsAudit/);
  assert.doesNotMatch(source, /collectionPath: '(?:invoices|payments|ledger|accountSummaries)'|UpdatedAt:|UpdatedBy:/);
});
