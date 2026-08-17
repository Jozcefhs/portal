import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  academicCumulativeTransition,
  academicPromotionTransition,
  academicTranscriptTransition,
  buildAcademicTranscriptDraft,
  calculateAcademicCumulativeDrafts,
  evaluateAcademicPromotionDecision
} from '../functions/lib/academic-session-outcomes.js';
import { defaultAcademicPolicy } from '../functions/lib/academic-policy.js';

const [managementSource, adminSource, verifierSource, qrSource, serviceWorkerSource, desktopSource] = await Promise.all([
  readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/verify-academic-transcript.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/academic-transcript-qr.js', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../../suite/modules/academic_management.py', import.meta.url), 'utf8')
]);

function policy() {
  const value = defaultAcademicPolicy();
  value.Position.Mode = 'exact-overall';
  value.Assessment.GradeBands = [
    { Grade: 'A', MinimumPercentage: 70, MaximumPercentage: 100, GradePoint: 5, Classification: 'pass' },
    { Grade: 'B', MinimumPercentage: 50, MaximumPercentage: 69.99, GradePoint: 4, Classification: 'pass' },
    { Grade: 'F', MinimumPercentage: 0, MaximumPercentage: 49.99, GradePoint: 0, Classification: 'fail' }
  ];
  value.Cumulative.Terms = [
    { Id: 'first', TermName: 'First Term', WeightPercentage: 30, Required: true, Order: 1 },
    { Id: 'second', TermName: 'Second Term', WeightPercentage: 30, Required: true, Order: 2 },
    { Id: 'third', TermName: 'Third Term', WeightPercentage: 40, Required: true, Order: 3 }
  ];
  value.Promotion = {
    Mode: 'criteria', MinimumOverallAverage: 50, RequiredCoreSubjectIds: ['math'],
    MaximumFailedSubjects: 1, MinimumAttendancePercentage: 75, RequireAllTerms: true,
    ManualReviewMinimum: 45, ManualReviewMaximum: 49.99
  };
  return value;
}

function termResult(studentRef, term, math, english, attendance = { Present: 8, Late: 1, Total: 10, Attended: 9 }) {
  return {
    ResultId: `${studentRef}-${term}`, ResultReference: `TR-${studentRef}-${term}`,
    StudentRef: studentRef, SessionId: 's1', AcademicSession: '2026/2027', Term: term,
    Status: 'Locked', ClassId: 'c1', ArmId: 'a1', Attendance: attendance,
    Subjects: [
      { SubjectId: 'math', SubjectName: 'Mathematics', Total: math },
      { SubjectId: 'eng', SubjectName: 'English Language', Total: english }
    ]
  };
}

const memberships = [
  { StudentRef: 'DCA/001', SubjectIds: ['math', 'eng'], CoreSubjectIds: ['math', 'eng'], Status: 'Active' },
  { StudentRef: 'DCA/002', SubjectIds: ['math', 'eng'], CoreSubjectIds: ['math', 'eng'], Status: 'Active' }
];

function calculate(overrides = {}) {
  return calculateAcademicCumulativeDrafts({
    SessionId: 's1', AcademicSession: '2026/2027', FinalTermId: 't3',
    ClassId: 'c1', ClassName: 'Grade 10', ArmId: 'a1', ArmName: 'Brilliance',
    Memberships: memberships,
    TermResults: [
      termResult('DCA/001', 'First Term', 60, 70), termResult('DCA/001', 'Second Term', 70, 80), termResult('DCA/001', 'Third Term', 80, 90),
      termResult('DCA/002', 'First Term', 50, 55), termResult('DCA/002', 'Second Term', 50, 55), termResult('DCA/002', 'Third Term', 50, 55)
    ],
    Policy: policy(), PolicyRevisionIds: ['policy-r1'], PolicyFingerprint: 'policy-fingerprint',
    ResultIdFor: (row) => `cumulative-${row.StudentRef}`,
    ResultReferenceFor: (row) => `CR-${row.StudentRef}`,
    ...overrides
  });
}

test('Milestone 10 calculates weighted immutable cumulative drafts from Locked term results', () => {
  const output = calculate();
  assert.equal(output.Ready, true);
  assert.equal(output.Results.length, 2);
  const first = output.Results[0];
  assert.equal(first.Subjects[0].AnnualTotal, 71);
  assert.equal(first.Subjects[1].AnnualTotal, 81);
  assert.equal(first.OverallAverage, 76);
  assert.equal(first.OverallPosition, 1);
  assert.equal(first.ContributingResultIds.length, 3);
  assert.equal(first.Attendance.AttendancePercentage, 90);
  assert.equal(first.Status, 'Calculated Draft');
  assert.equal(first.PolicyFingerprint, 'policy-fingerprint');
});

test('cumulative missing-term and missing-subject behavior follows policy choices', () => {
  const rows = calculate().Results;
  const termResults = [
    termResult('DCA/001', 'First Term', 60, 70), termResult('DCA/001', 'Third Term', 80, 90),
    termResult('DCA/002', 'First Term', 50, 55), termResult('DCA/002', 'Second Term', 50, 55), termResult('DCA/002', 'Third Term', 50, 55)
  ];
  const blocked = calculate({ TermResults: termResults });
  assert.equal(blocked.Ready, false);
  assert.ok(blocked.Issues.some((issue) => issue.includes('missing locked results')));

  const configured = policy();
  configured.Cumulative.MissingTermMode = 'manual-review';
  const review = calculate({ TermResults: termResults, Policy: configured, ExistingResults: rows });
  assert.equal(review.Ready, true);
  assert.equal(review.Results[0].ManualReviewRequired, true);
});

test('promotion criteria create automatic, repeat and manual-review recommendations without hardcoding decisions', () => {
  const promoted = evaluateAcademicPromotionDecision(calculate().Results[0], policy());
  assert.equal(promoted.RecommendedOutcome, 'Promoted');
  const failing = structuredClone(calculate().Results[1]);
  failing.OverallAverage = 40;
  failing.Subjects.forEach((subject) => { subject.Classification = 'fail'; subject.Grade = 'F'; });
  const repeated = evaluateAcademicPromotionDecision(failing, policy());
  assert.equal(repeated.RecommendedOutcome, 'Repeated');
  const manual = policy();
  manual.Promotion.Mode = 'manual-review';
  assert.equal(evaluateAcademicPromotionDecision(calculate().Results[0], manual).RecommendedOutcome, 'Pending');
});

test('cumulative, promotion and transcript lifecycles require review before immutable states', () => {
  assert.equal(academicCumulativeTransition('Calculated Draft', 'Reviewed').Allowed, true);
  assert.equal(academicCumulativeTransition('Calculated Draft', 'Locked').Allowed, false);
  assert.equal(academicPromotionTransition('Approved', 'Committed').Allowed, true);
  assert.equal(academicTranscriptTransition('Approved', 'Issued').Allowed, true);
});

test('transcript drafts snapshot locked sessions, terms and committed outcomes', () => {
  const cumulative = { ...calculate().Results[0], Status: 'Locked' };
  const transcript = buildAcademicTranscriptDraft({
    TranscriptId: 'transcript-1', TranscriptNumber: 'TRN-0001', StudentRef: 'DCA/001', StudentName: 'Ada Student',
    CumulativeResults: [cumulative],
    TermResults: [termResult('DCA/001', 'First Term', 60, 70)],
    PromotionDecisions: [{ Status: 'Committed', SessionId: 's1', AcademicSession: '2026/2027', FinalOutcome: 'Promoted' }]
  });
  assert.equal(transcript.Status, 'Draft');
  assert.equal(transcript.Sessions.length, 1);
  assert.equal(transcript.Terms.length, 1);
  assert.equal(transcript.Outcomes[0].Outcome, 'Promoted');
});

test('Milestone 10 live actions persist outcomes, promotion destinations and immutable event history', () => {
  assert.match(managementSource, /academicCumulativeResults/);
  assert.match(managementSource, /academicPromotionDecisions/);
  assert.match(managementSource, /academicTranscripts/);
  assert.match(managementSource, /calculateAcademicCumulativeResults/);
  assert.match(managementSource, /changeAcademicCumulativeStatus/);
  assert.match(managementSource, /calculateAcademicPromotionDecisions/);
  assert.match(managementSource, /DestinationMembershipId/);
  assert.match(managementSource, /createAcademicTranscriptDraft/);
  assert.match(managementSource, /academicOutcomeEventWrite/);
  assert.match(managementSource, /auditWrite\(user, target\.toUpperCase\(\), 'transcript'/);
});

test('web and desktop companions expose the same session-outcome workflow without desktop packaging', () => {
  assert.match(adminSource, /Session outcomes/);
  assert.match(adminSource, /Cumulative results/);
  assert.match(adminSource, /Promotion decisions/);
  assert.match(adminSource, /Official Transcripts/);
  assert.match(adminSource, /academic-transcript-qr/);
  assert.match(desktopSource, /\("Session Outcomes",/);
  assert.match(desktopSource, /Create Transcript Online/);
  assert.match(desktopSource, /calculateAcademicPromotionDecisions/);
  assert.match(desktopSource, /build_transcript_print_html/);
});

test('public transcript verification discloses validation metadata only', () => {
  assert.match(verifierSource, /PreviousIssuedVersions/);
  assert.match(verifierSource, /lower\(transcript\?\.Status\) === 'issued'/);
  assert.match(verifierSource, /TranscriptNumber/);
  assert.match(verifierSource, /SessionCount/);
  assert.doesNotMatch(verifierSource, /StudentName/);
  assert.doesNotMatch(verifierSource, /StudentRef/);
  assert.doesNotMatch(verifierSource, /Subjects/);
  assert.match(qrSource, /verify-transcript\.html/);
  assert.match(serviceWorkerSource, /verify-transcript\.html/);
  assert.match(serviceWorkerSource, /js\/verify-transcript\.js/);
});
