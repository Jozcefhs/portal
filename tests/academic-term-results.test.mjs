import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  academicAutomaticResultComments,
  academicTermResultTransition,
  calculateAcademicMidTermResultDrafts,
  calculateAcademicTermResultDrafts
} from '../functions/lib/academic-term-results.js';
import { defaultAcademicPolicy } from '../functions/lib/academic-policy.js';
import { publicAcademicResult } from '../functions/lib/academic-result-access.js';

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

test('result calculation resolves catalogue Id aliases without changing saved scores', () => {
  const before = structuredClone(studentScores);
  const output = calculation({ Subjects: [{ Id: 'math', Name: 'Mathematics' }, { Id: 'eng', Name: 'English Language' }] });
  assert.equal(output.Ready, true);
  assert.equal(output.Results[0].Subjects.find(row => row.SubjectId === 'eng').SubjectName, 'English Language');
  assert.match(output.Results[0].TeacherRemark, /English Language/);
  assert.deepEqual(studentScores, before);
});

test('Milestone 9 calculates reproducible term-result drafts only from Approved or Locked score sheets', () => {
  const output = calculation();
  assert.equal(output.Ready, true);
  assert.equal(output.Results.length, 2);
  const first = output.Results[0];
  assert.equal(first.Status, 'Calculated Draft');
  assert.equal(first.OverallAverage, 75);
  assert.equal(first.ClassAverage, 70);
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
  assert.ok(output.Results.every((row) => row.ClassAverage === 70));
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

test('timetable-only subjects need no score sheet and do not affect averages or subject counts', () => {
  const withTimetableSubject = calculation({
    Memberships: memberships.map((row) => ({ ...row, SubjectIds: [...row.SubjectIds, 'leap'] })),
    Subjects: [
      { SubjectId: 'math', Name: 'Mathematics' },
      { SubjectId: 'eng', Name: 'English Language' },
      { SubjectId: 'leap', Name: 'L.E.A.P', AssessmentCategory: 'TimetableOnly' }
    ]
  });
  assert.equal(withTimetableSubject.Ready, true);
  assert.deepEqual(withTimetableSubject.Results.map((row) => row.OverallAverage), [75, 65]);
  assert.ok(withTimetableSubject.Results.every((row) => row.SubjectCount === 2
    && row.Subjects.every((subject) => subject.SubjectId !== 'leap')));
  const onlyTimetable = calculation({
    Memberships: memberships.map((row) => ({ ...row, SubjectIds: ['leap'] })),
    Subjects: [{ SubjectId: 'leap', Name: 'L.E.A.P', AssessmentCategory: 'TimetableOnly' }]
  });
  assert.equal(onlyTimetable.Ready, false);
  assert.ok(onlyTimetable.Issues.some((issue) => issue.includes('no graded subjects assigned')));
});

test('Milestone 9 applies the configured position display mode without forcing class position', () => {
  const noPosition = calculation({ Policy: resultPolicy('none') });
  assert.equal('OverallPosition' in noPosition.Results[0], false);
  const subjectPosition = calculation({ Policy: resultPolicy('subject-only') });
  assert.equal(subjectPosition.Results[0].Subjects[0].Position, 1);
  assert.equal('OverallPosition' in subjectPosition.Results[0], false);
});

test('term results generate useful editable comments and preserve saved wording on recalculation', () => {
  const policy = resultPolicy();
  policy.Promotion.Mode = 'criteria';
  policy.Promotion.MinimumOverallAverage = 70;
  const output = calculation({ Policy: policy, SchoolStage: 'primary' });
  const second = output.Results.find((row) => row.StudentRef === 'DCA/002');
  assert.match(second.TeacherRemark, /Mathematics/);
  assert.match(second.PrincipalRemark, /promotion benchmark of 70%/);
  assert.equal(academicAutomaticResultComments(second, policy).TeacherRemark, second.TeacherRemark);

  const preserved = calculation({
    Policy: policy,
    SchoolStage: 'primary',
    ExistingResults: [{ StudentRef: 'DCA/001', TeacherRemark: 'Teacher wording retained.', PrincipalRemark: 'Head teacher wording retained.' }]
  });
  assert.equal(preserved.Results[0].TeacherRemark, 'Teacher wording retained.');
  assert.equal(preserved.Results[0].PrincipalRemark, 'Head teacher wording retained.');
});

test('senior principal comments use configured Core-credit promotion indicators', () => {
  const configured = resultPolicy();
  configured.Promotion = {
    Mode: 'division-rules',
    SeniorSecondary: {
      CreditMinimumPercentage: 50,
      ExpectedCoreSubjectCount: 2,
      PromotedMinimumCredits: 2,
      PromotedRequiredSubjectIds: [],
      PromotedRequiredSubjectMode: 'all',
      ProbationCreditCount: 1,
      ProbationCreditCountMode: 'exactly',
      ProbationRequiredSubjectIds: [],
      ProbationRequiredSubjectMode: 'any'
    }
  };
  const output = calculation({
    SchoolStage: 'senior-secondary',
    Policy: configured,
    Memberships: memberships.map((row) => ({ ...row, CoreSubjectIds: ['math', 'eng'] }))
  });
  assert.match(output.Results[0].PrincipalRemark, /Core credit/);
  assert.match(output.Results[0].PrincipalRemark, /configured senior promotion indicator/);
});

test('mid-term results use only the one or two policy-authorized assessment components', () => {
  const policy = resultPolicy();
  policy.MidTerm = { Enabled: true, ComponentIds: ['ca'] };
  const output = calculateAcademicMidTermResultDrafts({
    SessionId: 's1', AcademicSession: '2026/2027', TermId: 't1', Term: 'First Term',
    ClassId: 'c1', ClassName: 'Grade 10', ArmId: 'a1', ArmName: 'Brilliance',
    Memberships: memberships,
    ScoreSheets: scoreSheets.map((row) => ({ ...row, Status: 'Draft' })),
    StudentScores: studentScores,
    Subjects: [{ SubjectId: 'math', Name: 'Mathematics' }, { SubjectId: 'eng', Name: 'English Language' }],
    Policy: policy,
    ResultIdFor: (row) => `midterm-${row.StudentRef}`,
    ResultReferenceFor: (row) => `MTR-${row.StudentRef}`
  });
  assert.equal(output.Ready, true);
  assert.equal(output.Results[0].ResultType, 'Mid-Term');
  assert.deepEqual(output.Results[0].IncludedAssessmentComponentIds, ['ca']);
  assert.equal(output.Results[0].OverallAverage, 75);
  assert.deepEqual(output.Results[0].Subjects[0].ComponentScores.map((row) => row.ComponentId), ['ca']);
});

function midTermWithUntaught(overrides = {}) {
  const policy=resultPolicy();policy.MidTerm={Enabled:true,ComponentIds:['ca']};
  return {
    SessionId:'s1',TermId:'t1',ClassId:'c1',ArmId:'a1',Policy:policy,
    Memberships:memberships.map(row=>({...row,SubjectIds:[...row.SubjectIds,'trade']})),
    ScoreSheets:scoreSheets,StudentScores:studentScores,
    Subjects:[{SubjectId:'math',Name:'Mathematics'},{SubjectId:'eng',Name:'English Language'},
      {SubjectId:'trade',Name:'Computer Hardware and GSM Repairs'}],
    NotTaughtSubjectIds:['trade'],NotTaughtReason:'Trade lessons have not commenced.',...overrides
  };
}

test('explicit not-taught selection unblocks mid-term without changing memberships, marks or average',()=>{
  const input=midTermWithUntaught(),before=structuredClone(input);
  assert.equal(calculateAcademicMidTermResultDrafts({...input,NotTaughtSubjectIds:[]}).Ready,false);
  const output=calculateAcademicMidTermResultDrafts(input);
  assert.equal(output.Ready,true,output.Issues.join('\n'));
  assert.equal(output.Results[0].OverallAverage,75);
  assert.equal(output.Results[0].SubjectCount,2);
  assert.deepEqual(output.Results[0].NotTaughtSubjects,[{SubjectId:'trade',SubjectName:'Computer Hardware and GSM Repairs',Reason:input.NotTaughtReason,Status:'Not taught this mid-term'}]);
  assert.equal(output.Results[0].Status,'Calculated Draft','Normal approval/publication workflow remains required');
  assert.deepEqual(input,before);
  assert.deepEqual(calculateAcademicMidTermResultDrafts(input),output,'Repeating the calculation is deterministic');
  const publicResult=publicAcademicResult({...output.Results[0],Status:'Published'},{Allowed:true},input.Policy);
  assert.deepEqual(publicResult.NotTaughtSubjects,[{SubjectName:'Computer Hardware and GSM Repairs',Status:'Not taught this mid-term'}]);
  assert.equal('NotTaughtSubjects' in publicAcademicResult(output.Results[0],{Allowed:false},input.Policy),false);
});

test('not-taught exclusions require a reason, a subject assigned in this classroom and assessed subjects remaining',()=>{
  for (const overrides of [{NotTaughtReason:''},{NotTaughtReason:'x'.repeat(1001)},{NotTaughtSubjectIds:['other-class-subject']}]) {
    assert.equal(calculateAcademicMidTermResultDrafts(midTermWithUntaught(overrides)).Ready,false);
  }
  const input=midTermWithUntaught({Memberships:memberships.map(row=>({...row,SubjectIds:['trade']}))});
  const output=calculateAcademicMidTermResultDrafts(input);
  assert.equal(output.Ready,false);assert.match(output.Issues.join(' '),/no graded subjects/);
  assert.equal(calculateAcademicTermResultDrafts(midTermWithUntaught()).Ready,false,'End-of-term completeness is never bypassed');
});

test('existing marks, zeroes, absences, exemptions and split parts cannot be concealed as not taught',()=>{
  const sheet={...scoreSheets[0],SubjectId:'trade',SheetId:'trade-sheet'};
  for (const component of [
    {ComponentId:'ca',State:'Numeric',RawScore:0},
    {ComponentId:'ca',State:'Absent',RawScore:null},
    {ComponentId:'ca',State:'Exempt',RawScore:null},
    {ComponentId:'ca',State:'Missing',RawScore:null,Parts:[{PartId:'theory',State:'Numeric',RawScore:12}]}
  ]) {
    const input=midTermWithUntaught({ScoreSheets:[...scoreSheets,sheet],StudentScores:[...studentScores,
      {...score('trade-sheet','trade','DCA/001',0,'F'),ComponentScores:[component]}]});
    const output=calculateAcademicMidTermResultDrafts(input);
    assert.equal(output.Ready,false);assert.match(output.Issues.join(' '),/already has recorded/);
  }
});

test('empty trade sheets can be excluded; other classroom marks and inactive memberships do not leak into the decision',()=>{
  const input=midTermWithUntaught({
    Memberships:[...midTermWithUntaught().Memberships,{...memberships[0],StudentRef:'OLD',Status:'Archived'}],
    ScoreSheets:[...scoreSheets,{...scoreSheets[0],SubjectId:'trade',SheetId:'other-trade',ArmId:'other-arm'}],
    StudentScores:[...studentScores,score('other-trade','trade','DCA/001',90,'A')]
  });
  const output=calculateAcademicMidTermResultDrafts(input);
  assert.equal(output.Ready,true);assert.equal(output.Results.length,2);
  const later=midTermWithUntaught({NotTaughtSubjectIds:[],ExistingResults:output.Results,
    ScoreSheets:[...scoreSheets,{...scoreSheets[0],SubjectId:'trade',SheetId:'trade-sheet'}],
    StudentScores:[...studentScores,...memberships.map(row=>score('trade-sheet','trade',row.StudentRef,90,'A'))]});
  const recalculated=calculateAcademicMidTermResultDrafts(later);
  assert.equal(recalculated.Ready,true);assert.equal(recalculated.Results[0].SubjectCount,3);
  assert.deepEqual(recalculated.Results[0].NotTaughtSubjects,[]);
});

test('Milestone 9 lifecycle requires review, approval and publication, with controlled withdrawal and reopening', () => {
  assert.deepEqual(academicTermResultTransition('Calculated Draft', 'Reviewed'), { Allowed: true, RequiresReason: false });
  assert.equal(academicTermResultTransition('Reviewed', 'Published').Allowed, false);
  assert.deepEqual(academicTermResultTransition('Published', 'Withdrawn'), { Allowed: true, RequiresReason: true });
  assert.deepEqual(academicTermResultTransition('Withdrawn', 'Calculated Draft'), { Allowed: true, RequiresReason: true });
});

test('Milestone 9 server contract stores parent-compatible results and controlled lifecycle events', async () => {
  const [source, endpointSource, adminSource] = await Promise.all([
    readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/staff-academics.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
  ]);
  ['academicResults', 'academicResultEvents', 'calculateAcademicTermResults', 'previewAcademicTermResultWithdrawal', 'changeAcademicTermResultStatus']
    .forEach((token) => assert.match(source, new RegExp(token)));
  assert.match(source, /ImpactAcknowledged/);
  assert.match(source, /PolicyFingerprint/);
  assert.match(source, /ACADEMIC_RESULT_POLICY_INCOMPLETE/);
  assert.match(source, /ACADEMIC_RESULT_IMMUTABLE/);
  assert.match(source, /issues: calculation\.Issues/);
  assert.match(endpointSource, /issueCount: Math\.max\(issues\.length/);
  assert.match(adminSource, /showAcademicCalculationFailure/);
  assert.match(adminSource, /items: issues/);
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
