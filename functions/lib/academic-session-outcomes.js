import { academicCumulativePolicyIssues, normalizeAcademicPolicy } from './academic-policy.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export const ACADEMIC_CUMULATIVE_STATUSES = Object.freeze(['Calculated Draft', 'Reviewed', 'Approved', 'Locked']);
export const ACADEMIC_PROMOTION_STATUSES = Object.freeze(['Draft', 'Reviewed', 'Approved', 'Committed']);
export const ACADEMIC_PROMOTION_OUTCOMES = Object.freeze(['Pending', 'Promoted', 'Probation', 'Repeated', 'Graduated', 'Transferred']);
export const ACADEMIC_TRANSCRIPT_STATUSES = Object.freeze(['Draft', 'Reviewed', 'Approved', 'Issued']);

function rounded(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function unique(values = []) {
  const seen = new Set();
  return values.map(clean).filter((value) => {
    const key = lower(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function active(row = {}) {
  return !['inactive', 'withdrawn', 'archived', 'cancelled'].includes(lower(row.Status));
}

function gradeForPercentage(policy, percentage) {
  return (policy.Assessment.GradeBands || []).find((band) => (
    Number(percentage) >= Number(band.MinimumPercentage)
      && Number(percentage) <= Number(band.MaximumPercentage) + 0.0001
  )) || null;
}

function matchesConfiguredTerm(result, term) {
  if (clean(term.TermId) && lower(result.TermId) === lower(term.TermId)) return true;
  return Boolean(clean(term.TermName) && lower(result.Term) === lower(term.TermName));
}

function attendanceSnapshot(results = []) {
  const fields = ['Present', 'Absent', 'Late', 'Excused', 'LeftEarly', 'Total', 'Attended'];
  const snapshot = Object.fromEntries(fields.map((field) => [field, 0]));
  results.forEach((result) => fields.forEach((field) => {
    snapshot[field] += Number(result.Attendance?.[field] || 0);
  }));
  snapshot.AttendancePercentage = snapshot.Total ? rounded((snapshot.Attended / snapshot.Total) * 100, 1) : 0;
  return snapshot;
}

function rankRows(rows, valueFor, tieMode = 'competition') {
  const ranked = [...rows].sort((left, right) => valueFor(right) - valueFor(left)
    || clean(left.StudentRef).localeCompare(clean(right.StudentRef), undefined, { numeric: true, sensitivity: 'base' }));
  let previousValue = null;
  let previousRank = 0;
  let denseRank = 0;
  ranked.forEach((row, index) => {
    const value = valueFor(row);
    if (previousValue === null || Math.abs(value - previousValue) > 0.0001) {
      denseRank += 1;
      previousRank = tieMode === 'competition' ? index + 1 : denseRank;
      previousValue = value;
    }
    row.__rank = previousRank;
  });
  return ranked;
}

function percentileBand(position, assessed) {
  if (!position || !assessed) return '';
  const percentile = (position / assessed) * 100;
  if (percentile <= 25) return 'Top quartile';
  if (percentile <= 50) return 'Upper half';
  if (percentile <= 75) return 'Lower half';
  return 'Fourth quartile';
}

function promotionDivision(result = {}) {
  const description = lower([
    result.SchoolStage,
    result.Division,
    result.ClassCode,
    result.ClassName
  ].filter(Boolean).join(' '));
  if (description.includes('junior') || /\bjss\s*[1-3]?\b/.test(description) || /\bgrade\s*(7|8|9)\b/.test(description)) {
    return 'junior-secondary';
  }
  if (description.includes('senior') || /\bsss?\s*[1-3]?\b/.test(description) || /\bgrade\s*(10|11|12)\b/.test(description)) {
    return 'senior-secondary';
  }
  return '';
}

function subjectMatchesIdentifier(subject = {}, identifier = '') {
  const normalized = lower(identifier);
  const compact = normalized.replace(/[^a-z0-9]+/g, '');
  return [subject.SubjectId, subject.SubjectCode, subject.Code, subject.SubjectName].some((value) => {
    const candidate = lower(value);
    const candidateCompact = candidate.replace(/[^a-z0-9]+/g, '');
    return candidate === normalized || (compact && candidateCompact === compact)
      || (compact.length >= 3 && candidateCompact.startsWith(compact));
  });
}

function requiredCreditRule(subjects = [], identifiers = [], mode = 'all', creditMinimum = 0) {
  if (mode === 'none') return { Passed: true, Credited: [], Missing: [] };
  const checks = identifiers.map((identifier) => {
    const subject = subjects.find((row) => subjectMatchesIdentifier(row, identifier));
    return { Identifier: identifier, Subject: subject, Credited: Boolean(subject && Number(subject.AnnualTotal || 0) >= creditMinimum) };
  });
  return {
    Passed: mode === 'any' ? checks.some((row) => row.Credited) : checks.every((row) => row.Credited),
    Credited: checks.filter((row) => row.Credited).map((row) => row.Subject?.SubjectName || row.Identifier),
    Missing: checks.filter((row) => !row.Credited).map((row) => row.Subject?.SubjectName || row.Identifier)
  };
}

export function academicCumulativeTransition(currentValue, targetValue) {
  const current = ACADEMIC_CUMULATIVE_STATUSES.find((value) => lower(value) === lower(currentValue));
  const target = ACADEMIC_CUMULATIVE_STATUSES.find((value) => lower(value) === lower(targetValue));
  if (!current || !target) return { Allowed: false, RequiresReason: false };
  const next = { 'Calculated Draft': 'Reviewed', Reviewed: 'Approved', Approved: 'Locked' };
  if (next[current] === target) return { Allowed: true, RequiresReason: false };
  if (['Reviewed', 'Approved'].includes(current) && target === 'Calculated Draft') return { Allowed: true, RequiresReason: true };
  return { Allowed: false, RequiresReason: false };
}

export function academicPromotionTransition(currentValue, targetValue) {
  const current = ACADEMIC_PROMOTION_STATUSES.find((value) => lower(value) === lower(currentValue));
  const target = ACADEMIC_PROMOTION_STATUSES.find((value) => lower(value) === lower(targetValue));
  if (!current || !target) return { Allowed: false, RequiresReason: false };
  const next = { Draft: 'Reviewed', Reviewed: 'Approved', Approved: 'Committed' };
  if (next[current] === target) return { Allowed: true, RequiresReason: false };
  if (['Reviewed', 'Approved'].includes(current) && target === 'Draft') return { Allowed: true, RequiresReason: true };
  return { Allowed: false, RequiresReason: false };
}

export function academicTranscriptTransition(currentValue, targetValue) {
  const current = ACADEMIC_TRANSCRIPT_STATUSES.find((value) => lower(value) === lower(currentValue));
  const target = ACADEMIC_TRANSCRIPT_STATUSES.find((value) => lower(value) === lower(targetValue));
  if (!current || !target) return { Allowed: false, RequiresReason: false };
  const next = { Draft: 'Reviewed', Reviewed: 'Approved', Approved: 'Issued' };
  if (next[current] === target) return { Allowed: true, RequiresReason: false };
  if (['Reviewed', 'Approved'].includes(current) && target === 'Draft') return { Allowed: true, RequiresReason: true };
  return { Allowed: false, RequiresReason: false };
}

export function calculateAcademicCumulativeDrafts(input = {}) {
  const policy = normalizeAcademicPolicy(input.Policy || {});
  const policyIssues = academicCumulativePolicyIssues(policy);
  if (policyIssues.length) return { Ready: false, Issues: policyIssues.map((issue) => issue.message), Results: [] };
  const memberships = (input.Memberships || []).filter(active);
  if (!memberships.length) return { Ready: false, Issues: ['No active students are assigned to this final classroom.'], Results: [] };
  const terms = policy.Cumulative.Terms || [];
  const configuredTerms = terms.map((term) => ({ ...term, WeightPercentage: Number(term.WeightPercentage || 0) }));
  const lockedResults = (input.TermResults || []).filter((row) => lower(row.Status) === 'locked'
    && (!clean(input.SessionId) || clean(row.SessionId) === clean(input.SessionId)));
  const issues = [];
  const results = memberships.map((membership) => {
    const studentRef = clean(membership.StudentRef);
    const available = lockedResults.filter((row) => lower(row.StudentRef) === lower(studentRef)
      && (policy.Cumulative.IncludeTransferredResults
        || (clean(row.ClassId) === clean(input.ClassId) && clean(row.ArmId) === clean(input.ArmId))));
    const byTerm = configuredTerms.map((term) => ({
      term,
      result: available.find((row) => matchesConfiguredTerm(row, term)) || null
    }));
    const missingRequiredTerms = byTerm.filter(({ term, result }) => term.Required && !result).map(({ term }) => term.TermName || term.TermId);
    const manualReviewReasons = [];
    if (missingRequiredTerms.length && policy.Cumulative.MissingTermMode === 'block') {
      issues.push(`${studentRef} is missing locked results for ${missingRequiredTerms.join(', ')}.`);
    }
    if (missingRequiredTerms.length && policy.Cumulative.MissingTermMode === 'manual-review') {
      manualReviewReasons.push(`Missing term: ${missingRequiredTerms.join(', ')}`);
    }
    const subjectIds = unique([
      ...(membership.SubjectIds || []),
      ...byTerm.flatMap(({ result }) => (result?.Subjects || []).map((subject) => subject.SubjectId))
    ]);
    if (!subjectIds.length) issues.push(`${studentRef} has no subjects in the locked term results.`);
    const Subjects = subjectIds.map((subjectId) => {
      const termRows = [];
      let subjectName = subjectId;
      let subjectCode = '';
      configuredTerms.forEach((term) => {
        const pair = byTerm.find((row) => row.term.Id === term.Id);
        const termResult = pair?.result;
        const subject = (termResult?.Subjects || []).find((row) => lower(row.SubjectId) === lower(subjectId));
        if (subject?.SubjectName) subjectName = subject.SubjectName;
        if (subject?.SubjectCode || subject?.Code) subjectCode = clean(subject.SubjectCode || subject.Code);
        if (!termResult) {
          if (policy.Cumulative.MissingTermMode === 'zero') termRows.push({ term, Total: 0, Missing: true, MissingKind: 'Term' });
          return;
        }
        if (!subject) {
          if (policy.Cumulative.MissingSubjectMode === 'block') {
            issues.push(`${studentRef}: ${subjectName} is missing from ${term.TermName || term.TermId}.`);
          } else if (policy.Cumulative.MissingSubjectMode === 'zero') {
            termRows.push({ term, Total: 0, Missing: true, MissingKind: 'Subject' });
          } else if (policy.Cumulative.MissingSubjectMode === 'manual-review') {
            manualReviewReasons.push(`${subjectName} missing from ${term.TermName || term.TermId}`);
          }
          return;
        }
        termRows.push({ term, Total: Number(subject.Total ?? subject.WeightedTotal ?? 0), Subject: subject });
      });
      const weight = termRows.reduce((sum, row) => sum + row.term.WeightPercentage, 0);
      const annualTotal = weight
        ? rounded(termRows.reduce((sum, row) => sum + (row.Total * row.term.WeightPercentage), 0) / weight)
        : 0;
      const band = gradeForPercentage(policy, annualTotal);
      return {
        SubjectId: subjectId,
        SubjectCode: subjectCode,
        SubjectName: subjectName,
        IsCore: (membership.CoreSubjectIds || []).some((id) => lower(id) === lower(subjectId)),
        Terms: termRows.map((row) => ({
          TermId: clean(row.term.TermId || row.Subject?.TermId),
          TermName: clean(row.term.TermName),
          WeightPercentage: row.term.WeightPercentage,
          Total: rounded(row.Total),
          Missing: Boolean(row.Missing),
          ResultId: clean(byTerm.find((pair) => pair.term.Id === row.term.Id)?.result?.ResultId)
        })),
        AnnualTotal: annualTotal,
        Grade: clean(band?.Grade),
        GradePoint: band?.GradePoint ?? null,
        Remark: clean(band?.Remark),
        Classification: clean(band?.Classification)
      };
    });
    const OverallAverage = Subjects.length ? rounded(Subjects.reduce((sum, row) => sum + row.AnnualTotal, 0) / Subjects.length) : 0;
    const overallBand = gradeForPercentage(policy, OverallAverage);
    const contributing = byTerm.map((row) => row.result).filter(Boolean);
    const existing = (input.ExistingResults || []).find((row) => lower(row.StudentRef) === lower(studentRef));
    return {
      CumulativeResultId: clean(input.ResultIdFor?.(membership) || existing?.CumulativeResultId),
      CumulativeReference: clean(input.ResultReferenceFor?.(membership) || existing?.CumulativeReference),
      StudentRef: studentRef,
      SessionId: clean(input.SessionId),
      AcademicSession: clean(input.AcademicSession),
      FinalTermId: clean(input.FinalTermId),
      ClassId: clean(input.ClassId),
      ClassName: clean(input.ClassName),
      SchoolStage: clean(input.SchoolStage),
      ArmId: clean(input.ArmId),
      ArmName: clean(input.ArmName),
      DepartmentId: clean(membership.DepartmentId),
      Subjects,
      SubjectCount: Subjects.length,
      OverallAverage,
      OverallGrade: clean(overallBand?.Grade),
      OverallGradePoint: overallBand?.GradePoint ?? null,
      OverallRemark: clean(overallBand?.Remark),
      OverallClassification: clean(overallBand?.Classification),
      Attendance: attendanceSnapshot(contributing),
      MissingRequiredTerms: missingRequiredTerms,
      ManualReviewRequired: Boolean(manualReviewReasons.length),
      ManualReviewReasons: unique(manualReviewReasons),
      ContributingResultIds: unique(contributing.map((row) => row.ResultId)),
      ContributingResultReferences: unique(contributing.map((row) => row.ResultReference)),
      TermWeights: configuredTerms.map((term) => ({
        TermId: term.TermId,
        TermName: term.TermName,
        WeightPercentage: term.WeightPercentage,
        Required: term.Required
      })),
      AssessedStudentCount: memberships.length,
      PositionMode: policy.Position.Mode,
      PositionTieMode: policy.Position.TieMode,
      PolicyRevisionIds: unique(input.PolicyRevisionIds || []),
      PolicyFingerprint: clean(input.PolicyFingerprint),
      PolicySnapshot: policy,
      Status: 'Calculated Draft',
      TeacherRemark: clean(existing?.TeacherRemark),
      PrincipalRemark: clean(existing?.PrincipalRemark)
    };
  });

  if (issues.length) return { Ready: false, Issues: unique(issues), Results: [] };
  const positionMode = lower(policy.Position.Mode);
  const ranked = rankRows(results, (row) => Number(row.OverallAverage || 0), policy.Position.TieMode);
  ranked.forEach((row) => {
    if (['exact-overall', 'internal-only'].includes(positionMode)) row.OverallPosition = row.__rank;
    if (positionMode === 'percentile-band') row.PerformanceBand = percentileBand(row.__rank, results.length);
    delete row.__rank;
  });
  return { Ready: true, Issues: [], Results: results };
}

export function evaluateAcademicPromotionDecision(cumulativeResult = {}, policyValue = {}) {
  const policy = normalizeAcademicPolicy(policyValue);
  const promotion = policy.Promotion;
  const criteria = [];
  const reasons = [];
  const failedSubjects = (cumulativeResult.Subjects || []).filter((subject) => lower(subject.Classification) === 'fail');
  const bySubject = new Map((cumulativeResult.Subjects || []).map((subject) => [lower(subject.SubjectId), subject]));
  const add = (name, passed, actual, expected, appliesTo = 'All') => {
    criteria.push({ Name: name, Passed: passed, Actual: actual, Expected: expected, AppliesTo: appliesTo });
    if (!passed) reasons.push(`${name}: ${actual}; required ${expected}.`);
  };
  const missingTerms = cumulativeResult.MissingRequiredTerms || [];
  const requiredTermsComplete = !promotion.RequireAllTerms || !missingTerms.length;
  if (promotion.RequireAllTerms) {
    add('Completed required terms', requiredTermsComplete,
      missingTerms.length ? `missing ${missingTerms.join(', ')}` : 'complete', 'all configured terms');
  }
  const attendance = Number(cumulativeResult.Attendance?.AttendancePercentage || 0);
  const attendancePassed = promotion.MinimumAttendancePercentage === null || attendance >= promotion.MinimumAttendancePercentage;
  if (promotion.MinimumAttendancePercentage !== null) {
    add('Attendance', attendancePassed, attendance, `at least ${promotion.MinimumAttendancePercentage}%`);
  }
  let recommendedOutcome = 'Promoted';
  let recommendationType = 'Automatic';
  let division = promotionDivision(cumulativeResult);
  let coreCreditCount = null;
  let coreSubjectCount = null;
  if (promotion.Mode === 'manual-review' || cumulativeResult.ManualReviewRequired) {
    recommendedOutcome = 'Pending';
    recommendationType = 'Manual Review';
    reasons.push(...(cumulativeResult.ManualReviewReasons || []));
  } else if (!requiredTermsComplete) {
    recommendedOutcome = 'Pending';
    recommendationType = 'Incomplete Evidence';
  } else if (promotion.Mode === 'division-rules') {
    if (!division) {
      recommendedOutcome = 'Pending';
      recommendationType = 'Division Required';
      reasons.push('The class is not identified as Junior Secondary or Senior Secondary.');
    } else if (!attendancePassed) {
      recommendedOutcome = 'Repeated';
    } else if (division === 'junior-secondary') {
      const junior = promotion.JuniorSecondary;
      const average = Number(cumulativeResult.OverallAverage || 0);
      if (junior.PromotedMinimumAverage === null || junior.ProbationMinimumAverage === null) {
        recommendedOutcome = 'Pending';
        recommendationType = 'Policy Required';
        reasons.push('Complete the Junior Secondary promotion thresholds.');
      } else if (average >= junior.PromotedMinimumAverage) {
        add('Junior promoted average', true, average, `at least ${junior.PromotedMinimumAverage}%`, 'Promoted');
        recommendedOutcome = 'Promoted';
      } else if (average >= junior.ProbationMinimumAverage) {
        add('Junior promoted average', false, average, `at least ${junior.PromotedMinimumAverage}%`, 'Promoted');
        add('Junior probation average', true, average,
          `${junior.ProbationMinimumAverage}% up to ${junior.PromotedMinimumAverage}%`, 'Probation');
        recommendedOutcome = 'Probation';
      } else {
        add('Junior probation average', false, average, `at least ${junior.ProbationMinimumAverage}%`, 'Probation');
        recommendedOutcome = 'Repeated';
      }
    } else {
      const senior = promotion.SeniorSecondary;
      const coreSubjects = (cumulativeResult.Subjects || []).filter((subject) => subject.IsCore === true);
      coreSubjectCount = coreSubjects.length;
      coreCreditCount = senior.CreditMinimumPercentage === null ? 0 : coreSubjects.filter(
        (subject) => Number(subject.AnnualTotal || 0) >= senior.CreditMinimumPercentage
      ).length;
      const coreCountReady = senior.ExpectedCoreSubjectCount !== null && coreSubjectCount === senior.ExpectedCoreSubjectCount;
      add('Department Core subjects', coreCountReady, coreSubjectCount, `exactly ${senior.ExpectedCoreSubjectCount ?? 'the configured count'}`, 'All');
      if (!coreCountReady || senior.CreditMinimumPercentage === null || senior.PromotedMinimumCredits === null || senior.ProbationCreditCount === null) {
        recommendedOutcome = 'Pending';
        recommendationType = 'Curriculum Review';
      } else {
        const promotedSubjects = requiredCreditRule(coreSubjects, senior.PromotedRequiredSubjectIds,
          senior.PromotedRequiredSubjectMode, senior.CreditMinimumPercentage);
        const promotedCreditsPassed = coreCreditCount >= senior.PromotedMinimumCredits;
        add('Core credits for promotion', promotedCreditsPassed, coreCreditCount,
          `at least ${senior.PromotedMinimumCredits}`, 'Promoted');
        add('Named Core subjects for promotion', promotedSubjects.Passed,
          promotedSubjects.Credited.length ? promotedSubjects.Credited.join(', ') : 'none credited',
          senior.PromotedRequiredSubjectMode === 'none' ? 'no named-subject requirement' : `${senior.PromotedRequiredSubjectMode} of ${senior.PromotedRequiredSubjectIds.join(', ')}`,
          'Promoted');
        if (promotedCreditsPassed && promotedSubjects.Passed) {
          recommendedOutcome = 'Promoted';
        } else {
          const probationSubjects = requiredCreditRule(coreSubjects, senior.ProbationRequiredSubjectIds,
            senior.ProbationRequiredSubjectMode, senior.CreditMinimumPercentage);
          const probationCreditsPassed = senior.ProbationCreditCountMode === 'at-least'
            ? coreCreditCount >= senior.ProbationCreditCount
            : coreCreditCount === senior.ProbationCreditCount;
          add('Core credits for probation', probationCreditsPassed, coreCreditCount,
            `${senior.ProbationCreditCountMode === 'at-least' ? 'at least' : 'exactly'} ${senior.ProbationCreditCount}`, 'Probation');
          add('Named Core subjects for probation', probationSubjects.Passed,
            probationSubjects.Credited.length ? probationSubjects.Credited.join(', ') : 'none credited',
            senior.ProbationRequiredSubjectMode === 'none' ? 'no named-subject requirement' : `${senior.ProbationRequiredSubjectMode} of ${senior.ProbationRequiredSubjectIds.join(', ')}`,
            'Probation');
          recommendedOutcome = probationCreditsPassed && probationSubjects.Passed ? 'Probation' : 'Repeated';
        }
      }
    }
  } else if (promotion.Mode !== 'criteria') {
    recommendedOutcome = 'Pending';
    recommendationType = 'Policy Required';
    reasons.push('Configure a promotion method before calculating decisions.');
  } else {
    if (promotion.MinimumOverallAverage !== null) {
      add('Overall average', Number(cumulativeResult.OverallAverage) >= promotion.MinimumOverallAverage,
        Number(cumulativeResult.OverallAverage || 0), `at least ${promotion.MinimumOverallAverage}`);
    }
    if (promotion.MaximumFailedSubjects !== null) {
      add('Failed subjects', failedSubjects.length <= promotion.MaximumFailedSubjects,
        failedSubjects.length, `no more than ${promotion.MaximumFailedSubjects}`);
    }
    promotion.RequiredCoreSubjectIds.forEach((subjectId) => {
      const subject = bySubject.get(lower(subjectId));
      add(`Required core subject ${subject?.SubjectName || subjectId}`, Boolean(subject && lower(subject.Classification) !== 'fail'),
        subject ? `${subject.Grade || subject.AnnualTotal}` : 'missing', 'pass');
    });
    if (criteria.some((criterion) => !criterion.Passed)) {
      const average = Number(cumulativeResult.OverallAverage || 0);
      const inReviewRange = promotion.ManualReviewMinimum !== null && promotion.ManualReviewMaximum !== null
        && average >= promotion.ManualReviewMinimum && average <= promotion.ManualReviewMaximum;
      recommendedOutcome = inReviewRange ? 'Pending' : 'Repeated';
      recommendationType = inReviewRange ? 'Manual Review' : 'Automatic';
    }
  }
  return {
    RecommendedOutcome: recommendedOutcome,
    RecommendationType: recommendationType,
    Criteria: criteria,
    Reasons: unique(reasons),
    PolicyDivision: division,
    CoreSubjectCount: coreSubjectCount,
    CoreCreditCount: coreCreditCount,
    FailedSubjectCount: failedSubjects.length,
    FailedSubjectIds: failedSubjects.map((subject) => subject.SubjectId)
  };
}

export function buildAcademicTranscriptDraft(input = {}) {
  const cumulativeResults = (input.CumulativeResults || []).filter((row) => lower(row.Status) === 'locked')
    .sort((left, right) => clean(left.AcademicSession).localeCompare(clean(right.AcademicSession)));
  const termResults = (input.TermResults || []).filter((row) => lower(row.Status) === 'locked')
    .sort((left, right) => clean(left.AcademicSession).localeCompare(clean(right.AcademicSession))
      || clean(left.Term).localeCompare(clean(right.Term)));
  const promotionDecisions = (input.PromotionDecisions || []).filter((row) => lower(row.Status) === 'committed');
  return {
    TranscriptId: clean(input.TranscriptId),
    TranscriptNumber: clean(input.TranscriptNumber),
    StudentRef: clean(input.StudentRef),
    StudentName: clean(input.StudentName),
    Sessions: cumulativeResults.map((result) => ({
      SessionId: result.SessionId,
      AcademicSession: result.AcademicSession,
      ClassId: result.ClassId,
      ClassName: result.ClassName,
      ArmId: result.ArmId,
      ArmName: result.ArmName,
      DepartmentId: result.DepartmentId,
      Subjects: (result.Subjects || []).map((subject) => ({
        SubjectId: subject.SubjectId,
        SubjectName: subject.SubjectName,
        AnnualTotal: subject.AnnualTotal,
        Grade: subject.Grade,
        GradePoint: subject.GradePoint,
        Classification: subject.Classification
      })),
      OverallAverage: result.OverallAverage,
      OverallGrade: result.OverallGrade,
      Attendance: result.Attendance,
      CumulativeResultId: result.CumulativeResultId,
      CumulativeReference: result.CumulativeReference
    })),
    Terms: termResults.map((result) => ({
      SessionId: result.SessionId,
      AcademicSession: result.AcademicSession,
      TermId: result.TermId,
      Term: result.Term,
      ClassName: result.ClassName,
      ArmName: result.ArmName,
      Subjects: (result.Subjects || []).map((subject) => ({
        SubjectId: subject.SubjectId,
        SubjectName: subject.SubjectName,
        Total: subject.Total,
        Grade: subject.Grade,
        GradePoint: subject.GradePoint,
        Classification: subject.Classification
      })),
      OverallAverage: result.OverallAverage,
      OverallGrade: result.OverallGrade,
      ResultId: result.ResultId,
      ResultReference: result.ResultReference
    })),
    Outcomes: promotionDecisions.map((decision) => ({
      SessionId: decision.SessionId,
      AcademicSession: decision.AcademicSession,
      Outcome: decision.FinalOutcome,
      CommittedAt: decision.CommittedAt
    })),
    Status: 'Draft',
    Version: Number(input.Version || 1),
    PreviousIssuedVersions: Array.isArray(input.PreviousIssuedVersions) ? input.PreviousIssuedVersions : []
  };
}
