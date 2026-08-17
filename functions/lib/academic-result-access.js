import { normalizeAcademicPolicy } from './academic-policy.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const money = (value) => {
  const number = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
};

function valuesFor(record = {}, keys = []) {
  return keys.map((key) => lower(record[key])).filter(Boolean);
}

function periodsMatch(result = {}, currentPeriod = {}, dimension = 'session') {
  const resultKeys = dimension === 'term'
    ? ['TermId', 'Term', 'TermName']
    : ['SessionId', 'AcademicSession', 'Session', 'SessionName'];
  const currentKeys = dimension === 'term'
    ? ['TermId', 'Term', 'CurrentTerm']
    : ['SessionId', 'AcademicSession', 'Session', 'CurrentAcademicSession'];
  const resultValues = new Set(valuesFor(result, resultKeys));
  return valuesFor(currentPeriod, currentKeys).some((value) => resultValues.has(value));
}

export function academicResultIsPublished(result = {}) {
  return ['published', 'locked'].includes(lower(result.PublicationStatus || result.Status));
}

export function academicResultClearanceIsActive(clearance = {}, now = new Date()) {
  if (!clearance || lower(clearance.Status) !== 'approved') return false;
  const expiresAt = clean(clearance.ExpiresAt || clearance.ExpiryDate);
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() >= now.getTime();
}

export function academicFeeCategoryBalances(invoiceRows = [], ledgerRows = []) {
  const categories = new Map();
  const category = (row) => clean(row.FeeCategoryId || row.FeeCategory || row.CategoryId || row.Category);
  const add = (name, debit, credit) => {
    if (!name) return;
    const key = lower(name);
    const current = categories.get(key) || { Id: name, Debit: 0, Credit: 0, Outstanding: 0 };
    current.Debit = money(current.Debit + money(debit));
    current.Credit = money(current.Credit + money(credit));
    current.Outstanding = Math.max(0, money(current.Debit - current.Credit));
    categories.set(key, current);
  };
  const invoiceCategories = new Set();
  (invoiceRows || []).forEach((row) => {
    const name = category(row);
    if (!name) return;
    invoiceCategories.add(lower(name));
    add(name, row.Debit ?? row.Amount, 0);
  });
  (ledgerRows || []).forEach((row) => {
    const name = category(row);
    if (!name) return;
    add(name, invoiceCategories.has(lower(name)) ? 0 : row.Debit, row.Credit);
  });
  return Object.fromEntries([...categories.entries()]);
}

export function academicFinancialSummary(invoiceRows = [], ledgerRows = []) {
  const applicable = (row) => lower(row.FeeCategoryId || row.FeeCategory || row.CategoryId || row.Category) !== 'wallet';
  const invoices = (invoiceRows || []).filter(applicable);
  const ledger = (ledgerRows || []).filter(applicable);
  const invoiceDebit = invoices.reduce((total, row) => total + money(row.Debit ?? row.Amount), 0);
  const ledgerDebit = ledger.reduce((total, row) => total + money(row.Debit), 0);
  const credit = ledger.reduce((total, row) => total + money(row.Credit), 0);
  const debit = invoiceDebit > 0 ? invoiceDebit : ledgerDebit;
  return {
    TotalDebit: money(debit),
    TotalCredit: money(credit),
    OutstandingBalance: Math.max(0, money(debit - credit)),
    FeeCategoryBalances: academicFeeCategoryBalances(invoices, ledger)
  };
}

function accessDecision(allowed, code, message, extra = {}) {
  return { Allowed: allowed, Code: code, Message: message, ...extra };
}

export function evaluateAcademicResultAccess({
  result = {},
  policy: policyValue = {},
  hasActivePolicy = false,
  currentPeriod = {},
  finance = {},
  clearance = null,
  now = new Date()
} = {}) {
  if (!academicResultIsPublished(result)) {
    return accessDecision(false, 'RESULT_NOT_PUBLISHED', 'This result has not been published for parent access.');
  }
  if (!hasActivePolicy) {
    return accessDecision(false, 'ACTIVE_POLICY_REQUIRED', 'Result access is unavailable until the school activates the applicable academic policy.');
  }
  const policy = normalizeAcademicPolicy(policyValue);
  const visibility = policy.ResultAccess.VisibilityMode;
  if (visibility === 'current-term' &&
      (!periodsMatch(result, currentPeriod, 'session') || !periodsMatch(result, currentPeriod, 'term'))) {
    return accessDecision(false, 'OUTSIDE_VISIBLE_TERM', 'The school currently permits parent access to the current term result only.');
  }
  if (visibility === 'current-session' && !periodsMatch(result, currentPeriod, 'session')) {
    return accessDecision(false, 'OUTSIDE_VISIBLE_SESSION', 'The school currently permits parent access to results from the current session only.');
  }
  if (!['current-term', 'current-session', 'all-published', 'published-and-transcripts'].includes(visibility)) {
    return accessDecision(false, 'RESULT_VISIBILITY_UNCONFIGURED', 'The school has not configured parent result visibility for this period.');
  }

  const financial = policy.ResultAccess.FinancialClearance;
  const activeClearance = academicResultClearanceIsActive(clearance, now);
  if (activeClearance && financial.AllowManualExemptions) {
    return accessDecision(true, 'ELIGIBLE_BY_EXEMPTION', 'Result access approved.', { UsedExemption: true });
  }
  const totalDebit = Math.max(0, money(finance.TotalDebit));
  const totalCredit = Math.max(0, money(finance.TotalCredit));
  const outstanding = Math.max(0, money(finance.OutstandingBalance ?? totalDebit - totalCredit));
  let financiallyEligible = false;
  if (financial.Mode === 'none') financiallyEligible = true;
  else if (financial.Mode === 'any-balance') financiallyEligible = outstanding <= 0;
  else if (financial.Mode === 'minimum-paid-percentage') {
    const percentage = totalDebit > 0 ? Math.min(100, (totalCredit / totalDebit) * 100) : 100;
    financiallyEligible = percentage + 0.0001 >= Number(financial.MinimumPaidPercentage || 0);
  } else if (financial.Mode === 'maximum-outstanding') {
    financiallyEligible = outstanding <= money(financial.MaximumOutstanding);
  } else if (financial.Mode === 'selected-fee-categories') {
    const balances = finance.FeeCategoryBalances || {};
    financiallyEligible = financial.FeeCategoryIds.every((id) => money(balances[lower(id)]?.Outstanding) <= 0);
  } else if (financial.Mode === 'manual-clearance') {
    financiallyEligible = activeClearance;
  } else {
    return accessDecision(false, 'FINANCIAL_POLICY_UNCONFIGURED', 'The school has not configured financial clearance for this result period.');
  }
  return financiallyEligible
    ? accessDecision(true, 'ELIGIBLE', 'Result access approved.', { UsedExemption: false })
    : accessDecision(false, 'FINANCIAL_CLEARANCE_REQUIRED', 'This result is currently unavailable under the school’s financial-clearance policy. Please contact the school accounts office.');
}

function publicSubjectResult(subject = {}, positionMode = 'none') {
  const output = {
    SubjectId: clean(subject.SubjectId || subject.Id),
    SubjectName: clean(subject.SubjectName || subject.Name || subject.Subject),
    Total: subject.Total ?? subject.Score ?? '',
    Grade: clean(subject.Grade),
    GradePoint: subject.GradePoint ?? subject.Point ?? '',
    Remark: clean(subject.Remark)
  };
  if (positionMode === 'subject-only') output.Position = subject.Position ?? subject.SubjectPosition ?? '';
  if (positionMode === 'assessed-count') output.AssessedCount = subject.AssessedCount ?? '';
  return output;
}

function publicAttendanceSummary(attendance = {}) {
  return {
    RegisterType: clean(attendance.RegisterType || attendance.Mode || 'Daily'),
    Present: Number(attendance.Present || 0),
    Absent: Number(attendance.Absent || 0),
    Late: Number(attendance.Late || 0),
    Excused: Number(attendance.Excused || 0),
    LeftEarly: Number(attendance.LeftEarly || 0),
    Total: Number(attendance.Total || 0),
    AttendancePercentage: Number(attendance.AttendancePercentage || 0)
  };
}

export function publicAcademicResult(result = {}, access = {}, policyValue = {}) {
  const policy = normalizeAcademicPolicy(policyValue);
  const output = {
    ResultId: clean(result.ResultId || result.__id),
    ResultReference: clean(result.ResultReference || result.VerificationReference),
    AcademicSession: clean(result.AcademicSession || result.SessionName || result.SessionId),
    Term: clean(result.Term || result.TermName || result.TermId),
    ClassName: clean(result.ClassName || result.ClassId),
    ArmName: clean(result.ArmName || result.ArmId),
    PublicationStatus: clean(result.PublicationStatus || result.Status),
    PublishedAt: clean(result.PublishedAt),
    Access: accessDecision(Boolean(access.Allowed), clean(access.Code), clean(access.Message), {
      UsedExemption: access.UsedExemption === true
    })
  };
  if (!access.Allowed) return output;
  output.Subjects = (result.Subjects || result.SubjectResults || []).map((subject) => publicSubjectResult(subject, policy.Position.Mode));
  output.OverallAverage = result.OverallAverage ?? result.Average ?? '';
  output.OverallGrade = clean(result.OverallGrade || result.Grade);
  output.TotalScore = result.TotalScore ?? result.Total ?? '';
  output.TeacherRemark = clean(result.TeacherRemark || result.FormTeacherRemark);
  output.PrincipalRemark = clean(result.PrincipalRemark || result.HeadTeacherRemark);
  output.OverallRemark = clean(result.OverallRemark);
  output.Recommendation = clean(result.Recommendation);
  output.Attendance = publicAttendanceSummary(result.Attendance || result.AttendanceSummary || {});
  if (policy.Position.Mode === 'exact-overall') output.OverallPosition = result.OverallPosition ?? result.Position ?? '';
  if (policy.Position.Mode === 'percentile-band') output.PerformanceBand = clean(result.PerformanceBand || result.PercentileBand);
  if (policy.Position.Mode === 'assessed-count') output.AssessedStudentCount = result.AssessedStudentCount ?? '';
  return output;
}
