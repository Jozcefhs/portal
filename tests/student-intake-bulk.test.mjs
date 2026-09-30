import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeSevenIntakeFingerprint, gradeSevenIntakePlan, isGradeSevenStudent } from '../functions/lib/student-intake-bulk.js';

const row = (id, className, category, overrides = {}) => ({
  __id: id,
  __scopePath: 'schoolBranches/main/sections/secondary/students',
  __updateTime: `2026-09-30T12:00:0${id}Z`,
  BranchId: 'main', SchoolSection: 'secondary', AcademicSession: '2026/2027',
  ClassName: className, EnrollmentCategory: category,
  ...overrides
});

test('Grade 7 matching includes all arms but excludes Grade 8 and Grade 70', () => {
  assert.equal(isGradeSevenStudent(row('1', 'Grade 7', 'Returning')), true);
  assert.equal(isGradeSevenStudent(row('2', 'Grade 7 / Brilliance', 'Returning')), true);
  assert.equal(isGradeSevenStudent(row('2b', 'Grade 7 Brilliance', 'Returning')), true);
  assert.equal(isGradeSevenStudent(row('3', 'JSS 1', 'Returning')), true);
  assert.equal(isGradeSevenStudent(row('4', 'Grade 8', 'Returning')), false);
  assert.equal(isGradeSevenStudent(row('5', 'Grade 70', 'Returning')), false);
});

test('intake plan is branch/session scoped and skips already corrected records', async () => {
  const rows = [
    row('1', 'Grade 7', 'Returning'),
    row('2', 'Grade 7 / Brilliance', 'New Intake'),
    row('3', 'Grade 7', 'Returning', { BranchId: 'area-one' }),
    row('4', 'Grade 7', 'Returning', { AcademicSession: '2025/2026' }),
    row('5', 'Grade 8', 'Returning'),
    row('6', 'Grade 7', 'Returning', { SchoolSection: 'primary' })
  ];
  const plan = gradeSevenIntakePlan(rows, { branchId: 'main', academicSession: '2026/2027' });
  assert.equal(plan.total, 2);
  assert.equal(plan.alreadyNew, 1);
  assert.deepEqual(plan.toChange.map((item) => item.__id), ['1']);
  assert.equal(plan.excludedOtherSession, 1);
  assert.equal(plan.missingRevision, 0);
  const fingerprint = await gradeSevenIntakeFingerprint(plan);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  const changed = gradeSevenIntakePlan([row('1', 'Grade 7', 'New Intake'), ...rows.slice(1)], { branchId: 'main', academicSession: '2026/2027' });
  assert.notEqual(await gradeSevenIntakeFingerprint(changed), fingerprint);
});

test('intake plan rejects broad or unspecified scope', () => {
  assert.throws(() => gradeSevenIntakePlan([], { branchId: '', academicSession: '2026/2027' }), /Choose a branch/);
  assert.throws(() => gradeSevenIntakePlan([], { branchId: 'main', academicSession: '' }), /Choose a branch/);
});
