import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  academicTermResultTransition,
  calculateAcademicTermResultDrafts
} from '../functions/lib/academic-term-results.js';
import { defaultAcademicPolicy } from '../functions/lib/academic-policy.js';

function resultPolicy(positionMode = 'exact-overall') {
  const policy = defaultAcademicPolicy();
  policy.Position.Mode = positionMode;
  policy.Position.TieMode = 'competition';
  policy.ResultAccess.VisibilityMode = 'current-term';
  policy.ResultAccess.FinancialClearance.Mode = 'none';
  policy.Promotion.Mode = 'manual-review';
  policy.Assessment.Components = [
    { Id: 'ca', Name: 'CA', MaximumScore: 40, WeightPercentage: 40, Required: true, Order: 1 },
    { Id: 'exam', Name: 'Exam', MaximumScore: 60, WeightPercentage: 60, Required: true, Order: 2 }
  ];
  policy.Assessment.GradeBands = [
    { Grade: 'A', MinimumPercentage: 70, MaximumPercentage: 100, GradePoint: 5, Remark: 'Excellent' },
    { Grade: 'B', MinimumPercentage: 50, MaximumPercentage: 69.99, GradePoint: 4, Remark: 'Good' },
    { Grade: 'F', MinimumPercentage: 0, MaximumPercentage: 49.99, GradePoint: 0, Remark: 'Needs improvement', Classification: 'fail' }
  ];
  return policy;
}

const memberships = [
  { StudentRef: 'DCA/001', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', SubjectIds: ['math', 'eng'], Status: 'Active' },
  { StudentRef: 'DCA/002', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', SubjectIds: ['math', 'eng'], Status: 'Active' }
];
const scoreSheets = [
  { SheetId: 'math-sheet', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', SubjectId: 'math', AssessmentRevisionId: 'rev-1', Status: 'Approved' },
  { SheetId: 'eng-sheet', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', SubjectId: 'eng', AssessmentRevisionId: 'rev-1', Status: 'Locked' }
];
function score(sheetId, subjectId, studentRef, percentage, grade) {
  return {
    ScoreId: `${sheetId}-${studentRef}`, SheetId: sheetId, StudentRef: studentRef, SubjectId: subjectId,
    AssessmentRevisionId: 'rev-1', CompletionStatus: 'Complete', Percentage: percentage, WeightedTotal: percentage,
    Grade: grade, GradePoint: grade === 'A' ? 5 : 4, Remark: grade === 'A' ? 'Excellent' : 'Good', Classification: 'pass',
    ComponentScores: [{ ComponentId: 'ca', State: 'Numeric', RawScore: percentage * 0.4, MaximumScore: 40, WeightPercentage: 40 }]
  };
}
const studentScores = [
  score('math-sheet', 'math', 'DCA/001', 80, 'A'), score('eng-sheet', 'eng', 'DCA/001', 70, 'A'),
  score('math-sheet', 'math', 'DCA/002', 60, 'B'), score('eng-sheet', 'eng', 'DCA/002', 70, 'A')
];

function calculation(overrides = {}) {
  return calculateAcademicTermResultDrafts({
    SessionId: 's1', AcademicSession: '2026/2027', TermId: 't1', Term: 'First Term',
    ClassId: 'c1', ClassName: 'Grade 10', ArmId: 'a1', ArmName: 'Brilliance',
    Memberships: memberships, ScoreSheets: scoreSheets, StudentScores: studentScores,
    Subjects: [{ SubjectId: 'math', Name: 'Mathematics' }, { SubjectId: 'eng', Name: 'English Language' }],
    Attendance: [
      { StudentRef: 'DCA/001', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', Mode: 'Daily', Status: 'Present' },
      { StudentRef: 'DCA/001', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', Mode: 'Daily', Status: 'Late' },
      { StudentRef: 'DCA/001', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', Mode: 'Period', Status: 'Absent' }
    ],
    Policy: resultPolicy(), PolicyRevisionIds: ['policy-r1'], PolicyFingerprint: 'policy-fingerprint',
    ResultIdFor: (row) => `result-${row.StudentRef}`, ResultReferenceFor: (row) => `TR-${row.StudentRef}`,
    ...overrides
  });
}

test('Milestone 9 calculates reproducible term-result drafts only from Approved or Locked score sheets', () => {
  const output = calculation();
  assert.equal(output.Ready, true);
  assert.equal(output.Results.length, 2);
  const first = output.Results[0];
  assert.equal(first.Status, 'Calculated Draft');
  assert.equal(first.OverallAverage, 75);
  assert.equal(first.OverallGrade, 'A');
  assert.equal(first.OverallPosition, 1);
  assert.equal(first.AssessedStudentCount, 2);
  assert.equal(first.Subjects[0].Position, undefined);
  assert.equal(first.Subjects[0].AssessmentRevisionId, 'rev-1');
  assert.equal(first.Attendance.AttendancePercentage, 100);
  assert.equal(first.Attendance.Total, 2);
  assert.equal(first.Attendance.RegisterType, 'Daily');
  assert.deepEqual(first.AssessmentPolicyRevisionIds, ['policy-r1']);
  assert.equal(first.PolicyFingerprint, 'policy-fingerprint');
});

test('Milestone 9 blocks the classroom calculation when any subject sheet or student score is incomplete', () => {
  const submitted = calculation({ ScoreSheets: scoreSheets.map((row) => row.SubjectId === 'eng' ? { ...row, Status: 'Submitted' } : row) });
  assert.equal(submitted.Ready, false);
  assert.ok(submitted.Issues.some((issue) => issue.includes('no Approved or Locked score sheet')));
  const incompleteScores = studentScores.map((row) => row.StudentRef === 'DCA/002' && row.SubjectId === 'math'
    ? { ...row, CompletionStatus: 'Incomplete' } : row);
  const incomplete = calculation({ StudentScores: incompleteScores });
  assert.equal(incomplete.Ready, false);
  assert.ok(incomplete.Issues.some((issue) => issue.includes('no complete approved score')));
});

test('Milestone 9 applies the configured position display mode without forcing class position', () => {
  const noPosition = calculation({ Policy: resultPolicy('none') });
  assert.equal('OverallPosition' in noPosition.Results[0], false);
  const subjectPosition = calculation({ Policy: resultPolicy('subject-only') });
  assert.equal(subjectPosition.Results[0].Subjects[0].Position, 1);
  assert.equal('OverallPosition' in subjectPosition.Results[0], false);
});

test('Milestone 9 lifecycle requires review, approval and publication, with controlled withdrawal and reopening', () => {
  assert.deepEqual(academicTermResultTransition('Calculated Draft', 'Reviewed'), { Allowed: true, RequiresReason: false });
  assert.equal(academicTermResultTransition('Reviewed', 'Published').Allowed, false);
  assert.deepEqual(academicTermResultTransition('Published', 'Withdrawn'), { Allowed: true, RequiresReason: true });
  assert.deepEqual(academicTermResultTransition('Withdrawn', 'Calculated Draft'), { Allowed: true, RequiresReason: true });
});

test('Milestone 9 server contract stores parent-compatible results and controlled lifecycle events', async () => {
  const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
  ['academicResults', 'academicResultEvents', 'calculateAcademicTermResults', 'previewAcademicTermResultWithdrawal', 'changeAcademicTermResultStatus']
    .forEach((token) => assert.match(source, new RegExp(token)));
  assert.match(source, /ImpactAcknowledged/);
  assert.match(source, /PolicyFingerprint/);
  assert.match(source, /ACADEMIC_RESULT_POLICY_INCOMPLETE/);
  assert.match(source, /ACADEMIC_RESULT_IMMUTABLE/);
});

test('Milestone 9 exposes a privacy-minimized public verifier and QR route', async () => {
  const [verificationSource, qrSource, pageSource, clientSource] = await Promise.all([
    readFile(new URL('../functions/api/verify-academic-result.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/academic-result-qr.js', import.meta.url), 'utf8'),
    readFile(new URL('../verify-result.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/verify-result.js', import.meta.url), 'utf8')
  ]);
  assert.match(verificationSource, /\['published', 'locked'\]/);
  assert.match(verificationSource, /queryCollection\(env, 'academicResults'/);
  assert.doesNotMatch(verificationSource, /listCollection\(env, 'academicResults'/);
  ['ResultReference', 'AcademicSession', 'Term', 'ClassName', 'ArmName', 'PublicationStatus', 'PublishedAt', 'SubjectCount']
    .forEach((field) => assert.match(verificationSource, new RegExp(field)));
  ['StudentRef', 'StudentName', 'Subjects:', 'OverallAverage', 'TeacherRemark', 'PrincipalRemark']
    .forEach((field) => assert.doesNotMatch(verificationSource, new RegExp(field)));
  assert.match(qrSource, /verify-result\.html\?reference=/);
  assert.match(pageSource, /id="verifyAcademicResultForm"/);
  assert.match(clientSource, /api\/verify-academic-result\?reference=/);
});
