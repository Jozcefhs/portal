import test from 'node:test';
import assert from 'node:assert/strict';
import {
  academicFeeCategoryBalances,
  academicFinancialSummary,
  academicResultClearanceIsActive,
  evaluateAcademicResultAccess,
  publicAcademicResult
} from '../functions/lib/academic-result-access.js';
import { defaultAcademicPolicy } from '../functions/lib/academic-policy.js';

function policy(visibility = 'current-term', financialMode = 'none', financial = {}) {
  const value = defaultAcademicPolicy();
  value.ResultAccess.VisibilityMode = visibility;
  value.ResultAccess.FinancialClearance = {
    ...value.ResultAccess.FinancialClearance,
    Mode: financialMode,
    ...financial
  };
  value.Position.Mode = 'none';
  return value;
}

const published = {
  ResultId: 'result-1', Status: 'Published', AcademicSession: '2026/2027', Term: 'First Term',
  Subjects: [{ SubjectId: 'math', SubjectName: 'Mathematics', Total: 78, Grade: 'A', Position: 1 }],
  OverallAverage: 78, OverallPosition: 2, ArmName: 'Brilliance', Recommendation: 'Promote after review',
  Attendance: { RegisterType: 'Daily', Present: 18, Absent: 1, Late: 1, Total: 20, AttendancePercentage: 95 },
  InternalReviewNote: 'Never expose this note'
};
const currentPeriod = { CurrentAcademicSession: '2026/2027', CurrentTerm: 'First Term' };

test('AM-001 fails closed for unpublished results and missing active policies', () => {
  assert.equal(evaluateAcademicResultAccess({ result: { ...published, Status: 'Draft' }, policy: policy(), hasActivePolicy: true, currentPeriod }).Code, 'RESULT_NOT_PUBLISHED');
  assert.equal(evaluateAcademicResultAccess({ result: published, policy: policy(), hasActivePolicy: false, currentPeriod }).Code, 'ACTIVE_POLICY_REQUIRED');
});

test('AM-001 applies current-term and current-session visibility choices', () => {
  assert.equal(evaluateAcademicResultAccess({ result: published, policy: policy(), hasActivePolicy: true, currentPeriod }).Allowed, true);
  assert.equal(evaluateAcademicResultAccess({ result: { ...published, Term: 'Second Term' }, policy: policy(), hasActivePolicy: true, currentPeriod }).Code, 'OUTSIDE_VISIBLE_TERM');
  assert.equal(evaluateAcademicResultAccess({ result: { ...published, Term: 'Second Term' }, policy: policy('current-session'), hasActivePolicy: true, currentPeriod }).Allowed, true);
  assert.equal(evaluateAcademicResultAccess({ result: { ...published, AcademicSession: '2025/2026' }, policy: policy('current-session'), hasActivePolicy: true, currentPeriod }).Code, 'OUTSIDE_VISIBLE_SESSION');
});

test('AM-001 evaluates each configured financial-clearance mode without exposing balances', () => {
  const base = { result: published, hasActivePolicy: true, currentPeriod };
  assert.equal(evaluateAcademicResultAccess({ ...base, policy: policy('all-published', 'any-balance'), finance: { OutstandingBalance: 1 } }).Allowed, false);
  assert.equal(evaluateAcademicResultAccess({ ...base, policy: policy('all-published', 'minimum-paid-percentage', { MinimumPaidPercentage: 70 }), finance: { TotalDebit: 100, TotalCredit: 75 } }).Allowed, true);
  assert.equal(evaluateAcademicResultAccess({ ...base, policy: policy('all-published', 'maximum-outstanding', { MaximumOutstanding: 5000 }), finance: { OutstandingBalance: 4000 } }).Allowed, true);
  assert.equal(evaluateAcademicResultAccess({ ...base, policy: policy('all-published', 'selected-fee-categories', { FeeCategoryIds: ['Tuition'] }), finance: { FeeCategoryBalances: { tuition: { Outstanding: 100 } } } }).Allowed, false);
  const blocked = evaluateAcademicResultAccess({ ...base, policy: policy('all-published', 'any-balance'), finance: { OutstandingBalance: 100000 } });
  assert.equal(JSON.stringify(blocked).includes('100000'), false);
});

test('AM-001 recognizes active approved exemptions and rejects expired clearance', () => {
  const active = { Status: 'Approved', ExpiresAt: '2026-09-01T00:00:00.000Z' };
  const expired = { Status: 'Approved', ExpiresAt: '2026-07-01T00:00:00.000Z' };
  const now = new Date('2026-08-16T00:00:00.000Z');
  assert.equal(academicResultClearanceIsActive(active, now), true);
  assert.equal(academicResultClearanceIsActive(expired, now), false);
  const decision = evaluateAcademicResultAccess({
    result: published, policy: policy('all-published', 'manual-clearance'), hasActivePolicy: true,
    currentPeriod, clearance: active, now
  });
  assert.equal(decision.Code, 'ELIGIBLE_BY_EXEMPTION');
  assert.equal(decision.UsedExemption, true);
});

test('AM-001 category balances do not double-count invoice credits and position data follows policy', () => {
  const balances = academicFeeCategoryBalances(
    [{ FeeCategory: 'Tuition', Debit: 100000, Credit: 50000 }],
    [{ FeeCategory: 'Tuition', Debit: 0, Credit: 50000 }]
  );
  assert.equal(balances.tuition.Outstanding, 50000);
  const hidden = publicAcademicResult(published, { Allowed: true, Code: 'ELIGIBLE', Message: 'Approved' }, policy('all-published'));
  assert.equal('OverallPosition' in hidden, false);
  assert.equal('Position' in hidden.Subjects[0], false);
  assert.equal(hidden.ArmName, 'Brilliance');
  assert.equal(hidden.Recommendation, 'Promote after review');
  assert.deepEqual(hidden.Attendance, { RegisterType: 'Daily', Present: 18, Absent: 1, Late: 1, Excused: 0, LeftEarly: 0, Total: 20, AttendancePercentage: 95 });
  assert.equal('InternalReviewNote' in hidden, false);
  const blocked = publicAcademicResult(published, { Allowed: false, Code: 'FINANCIAL_CLEARANCE_REQUIRED', Message: 'Contact accounts' }, policy('all-published'));
  assert.equal('Subjects' in blocked, false);
  assert.equal('OverallAverage' in blocked, false);
  assert.equal('Recommendation' in blocked, false);
  assert.equal('Attendance' in blocked, false);
});

test('AM-001 financial summaries exclude wallet activity from the result gate', () => {
  const summary = academicFinancialSummary(
    [{ FeeCategory: 'School Fee', Debit: 100000 }],
    [
      { FeeCategory: 'School Fee', Credit: 100000 },
      { FeeCategory: 'Wallet', Debit: 25000 }
    ]
  );
  assert.equal(summary.OutstandingBalance, 0);
  assert.equal(summary.TotalDebit, 100000);
});
