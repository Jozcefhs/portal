import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ACADEMIC_ANALYSIS_STATE_KEYS,
  academicManagementCapabilities,
  academicManagementViewStateKeys
} from '../functions/lib/academic-management.js';

await import(`../js/academic-results-analysis.js?test=${Date.now()}`);
const { buildAcademicSessionAnalysis } = globalThis.DynamaxAcademicResultsAnalysis;

const [adminSource, htmlSource, serviceWorkerSource] = await Promise.all([
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8')
]);

function result(studentRef, average, math, english, options = {}) {
  return {
    CumulativeResultId: `annual-${studentRef}`, StudentRef: studentRef,
    SessionId: 'session-1', ClassId: 'class-10', ClassName: 'Grade 10',
    SchoolStage: 'senior-secondary', ArmId: options.armId || 'arm-a',
    ArmName: options.armId === 'arm-b' ? 'Excellence' : 'Brilliance', DepartmentId: 'science',
    OverallAverage: average, OverallGrade: average >= 70 ? 'A' : average >= 50 ? 'C' : 'F',
    OverallClassification: average >= 50 ? 'Pass' : 'Fail', Status: options.status || 'Locked',
    Attendance: { Total: 100, AttendancePercentage: options.attendance ?? 90 },
    Subjects: [
      { SubjectId: 'math', SubjectName: 'Mathematics', AnnualTotal: math, Grade: math >= 50 ? 'C' : 'F', Classification: math >= 50 ? 'Pass' : 'Fail' },
      { SubjectId: 'eng', SubjectName: 'English', AnnualTotal: english, Grade: english >= 50 ? 'C' : 'F', Classification: english >= 50 ? 'Pass' : 'Fail' }
    ],
    ContributingResultIds: ['first', 'second', 'third'].map((term) => `${studentRef}-${term}`),
    TermWeights: ['First Term', 'Second Term', 'Third Term'].map((TermName) => ({ TermName, Required: true })),
    MissingRequiredTerms: []
  };
}

function termResult(studentRef, termId, average, math, english, armId = 'arm-a') {
  return {
    ResultId: `${studentRef}-${termId}`, StudentRef: studentRef, SessionId: 'session-1',
    TermId: termId, Term: termId === 'term-1' ? 'First Term' : 'Second Term',
    ClassId: 'class-10', ClassName: 'Grade 10', ArmId: armId,
    ArmName: armId === 'arm-b' ? 'Excellence' : 'Brilliance', DepartmentId: 'science',
    OverallAverage: average, OverallGrade: average >= 50 ? 'C' : 'F',
    OverallClassification: average >= 50 ? 'Pass' : 'Fail', Status: 'Locked',
    Attendance: { Total: 30, AttendancePercentage: 90 },
    Subjects: [
      { SubjectId: 'math', SubjectName: 'Mathematics', Total: math, Classification: math >= 50 ? 'Pass' : 'Fail' },
      { SubjectId: 'eng', SubjectName: 'English', Total: english, Classification: english >= 50 ? 'Pass' : 'Fail' }
    ]
  };
}

function analysisInput() {
  return {
    SessionId: 'session-1',
    Students: [
      { StudentRef: 'DCA/001', StudentName: 'Ada Student', Gender: 'Female', StudentType: 'Boarding' },
      { StudentRef: 'DCA/002', StudentName: 'Ben Student', Gender: 'Male', StudentType: 'Day' }
    ],
    Classes: [{ ClassId: 'class-10', Name: 'Grade 10', SchoolStage: 'senior-secondary' }],
    Arms: [{ ArmId: 'arm-a', ClassId: 'class-10', Name: 'Brilliance' }, { ArmId: 'arm-b', ClassId: 'class-10', Name: 'Excellence' }],
    Subjects: [{ SubjectId: 'math', Name: 'Mathematics' }, { SubjectId: 'eng', Name: 'English' }],
    Departments: [{ DepartmentId: 'science', Name: 'Science' }],
    Staff: [{ Username: 'math.teacher', DisplayName: 'Martha Maths' }, { Username: 'english.teacher', DisplayName: 'Emeka English' }],
    Terms: [
      { TermId: 'term-1', SessionId: 'session-1', Name: 'First Term', StartDate: '2026-09-01' },
      { TermId: 'term-2', SessionId: 'session-1', Name: 'Second Term', StartDate: '2027-01-08' }
    ],
    TeacherAllocations: [
      { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-10', ArmId: '', SubjectId: 'math', TeacherUsername: 'math.teacher', AllocationRole: 'Subject Teacher', Status: 'Active' },
      { SessionId: 'session-1', TermId: 'term-2', ClassId: 'class-10', ArmId: '', SubjectId: 'math', TeacherUsername: 'math.teacher', AllocationRole: 'Subject Teacher', Status: 'Active' },
      { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-10', ArmId: '', SubjectId: 'eng', TeacherUsername: 'english.teacher', AllocationRole: 'Subject Teacher', Status: 'Active' }
    ],
    StudentMemberships: [
      { SessionId: 'session-1', TermId: 'term-1', StudentRef: 'DCA/001', ClassId: 'class-10', ArmId: 'arm-a', DepartmentId: 'science', Status: 'Active' },
      { SessionId: 'session-1', TermId: 'term-1', StudentRef: 'DCA/002', ClassId: 'class-10', ArmId: 'arm-b', DepartmentId: 'science', Status: 'Active' }
    ],
    CumulativeResults: [
      result('DCA/001', 75, 80, 70, { attendance: 95, armId: 'arm-a' }),
      result('DCA/002', 45, 35, 55, { attendance: 60, armId: 'arm-b', status: 'Reviewed' })
    ],
    TermResults: [
      termResult('DCA/001', 'term-1', 70, 75, 65, 'arm-a'),
      termResult('DCA/002', 'term-1', 40, 30, 50, 'arm-b'),
      termResult('DCA/001', 'term-2', 80, 85, 75, 'arm-a'),
      termResult('DCA/002', 'term-2', 50, 40, 60, 'arm-b')
    ],
    PromotionDecisions: [
      { SessionId: 'session-1', StudentRef: 'DCA/001', FinalOutcome: 'Promoted', Status: 'Committed' },
      { SessionId: 'session-1', StudentRef: 'DCA/002', FinalOutcome: 'Repeated', Status: 'Approved' }
    ]
  };
}

test('management session analysis calculates annual performance, coverage, risk and comparisons', () => {
  const output = buildAcademicSessionAnalysis(analysisInput(), { period: 'annual' });
  assert.equal(output.Rows.length, 2);
  assert.equal(output.Metrics.Average, 60);
  assert.equal(output.Metrics.PassRate, 50);
  assert.equal(output.Metrics.Highest, 75);
  assert.equal(output.Metrics.Lowest, 45);
  assert.equal(output.Metrics.AtRiskCount, 1);
  assert.equal(output.Metrics.CoverageRate, 100);
  assert.equal(output.Comparisons.Arms.length, 2);
  assert.equal(output.Comparisons.Subjects.find((row) => row.Key === 'math').Average, 57.5);
  assert.ok(output.Facets.teachers.some((row) => row.label === 'Martha Maths'));
});

test('combined demographic, subject, teacher, status and score filters change the analysed cohort', () => {
  const femaleMath = buildAcademicSessionAnalysis(analysisInput(), {
    period: 'annual', gender: 'Female', subjectId: 'math', teacherUsername: 'math.teacher',
    resultStatus: 'Locked', minimumAverage: '70'
  });
  assert.equal(femaleMath.Rows.length, 1);
  assert.equal(femaleMath.Rows[0].StudentRef, 'DCA/001');
  assert.equal(femaleMath.Rows[0].Score, 80);
  assert.equal(femaleMath.Rows[0].StudentType, 'Boarding');

  const risk = buildAcademicSessionAnalysis(analysisInput(), {
    period: 'annual', attendanceBand: '50–74%', promotionOutcome: 'Repeated', classification: 'Fail'
  });
  assert.deepEqual(risk.Rows.map((row) => row.StudentRef), ['DCA/002']);
});

test('term selection changes the source rows while retaining session trend analysis', () => {
  const output = buildAcademicSessionAnalysis(analysisInput(), { period: 'term-1' });
  assert.equal(output.Annual, false);
  assert.equal(output.Period, 'First Term');
  assert.equal(output.Metrics.Average, 55);
  assert.deepEqual(output.Comparisons.Terms.map((row) => row.Label), ['First Term', 'Second Term']);
});

test('session analysis is management-only and uses a bounded analysis state projection', () => {
  const management = academicManagementCapabilities({ edition: 'school', role: 'Management', allowedSections: ['academics'] });
  const teacher = academicManagementCapabilities({ edition: 'school', role: 'Teacher', allowedSections: ['academics'] });
  assert.equal(management.canViewResultsAnalysis, true);
  assert.equal(teacher.canViewResultsAnalysis, false);
  assert.equal(academicManagementViewStateKeys('analysis'), ACADEMIC_ANALYSIS_STATE_KEYS);
  assert.deepEqual(ACADEMIC_ANALYSIS_STATE_KEYS, [
    'sessions', 'terms', 'classes', 'arms', 'subjects', 'departments',
    'teacherAllocations', 'studentMemberships', 'termResults', 'cumulativeResults', 'promotionDecisions'
  ]);
});

test('staff portal loads the analysis engine and exposes filters, comparisons and CSV export', () => {
  assert.match(htmlSource, /js\/academic-results-analysis\.js/);
  assert.match(serviceWorkerSource, /js\/academic-results-analysis\.js/);
  assert.match(adminSource, /Session analysis/);
  assert.match(adminSource, /Filter the complete session/);
  assert.match(adminSource, /Teacher \/ subject performance/);
  assert.match(adminSource, /Class average/);
  assert.match(adminSource, /data-academic-analysis-export/);
  assert.match(adminSource, /academicSessionAnalysisCsv/);
});
