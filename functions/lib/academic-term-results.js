import { normalizeAcademicPolicy } from './academic-policy.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export const ACADEMIC_TERM_RESULT_STATUSES = Object.freeze([
  'Calculated Draft',
  'Reviewed',
  'Approved',
  'Published',
  'Locked',
  'Withdrawn'
]);

const ACTIVE_SCORE_SHEET_STATUSES = new Set(['approved', 'locked']);
const INACTIVE_MEMBERSHIP_STATUSES = new Set(['withdrawn', 'inactive', 'archived']);

function rounded(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function activeMembership(row = {}) {
  return !INACTIVE_MEMBERSHIP_STATUSES.has(lower(row.Status));
}

function uniqueIds(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(clean).filter((item) => {
    const key = lower(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rowId(row = {}, keys = []) {
  return clean(keys.map((key) => row[key]).find(Boolean));
}

function rankValues(rows, valueFor, tieMode = 'competition') {
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

function attendanceForStudent(rows = [], studentRef = '') {
  const summary = { Present: 0, Absent: 0, Late: 0, Excused: 0, LeftEarly: 0, Total: 0 };
  rows.filter((row) => lower(row.StudentRef) === lower(studentRef)).forEach((row) => {
    const key = clean(row.Status).replace(/\s+/g, '');
    if (Object.hasOwn(summary, key)) summary[key] += 1;
    summary.Total += 1;
  });
  summary.Attended = summary.Present + summary.Late + summary.LeftEarly;
  summary.AttendancePercentage = summary.Total ? rounded((summary.Attended / summary.Total) * 100, 1) : 0;
  return summary;
}

function percentileBand(position, assessed) {
  if (!position || !assessed) return '';
  const percentile = (position / assessed) * 100;
  if (percentile <= 25) return 'Top quartile';
  if (percentile <= 50) return 'Upper half';
  if (percentile <= 75) return 'Lower half';
  return 'Fourth quartile';
}

function gradeForPercentage(policy, percentage) {
  return (policy.Assessment.GradeBands || []).find((band) => (
    Number(percentage) >= Number(band.MinimumPercentage)
      && Number(percentage) <= Number(band.MaximumPercentage) + 0.0001
  )) || null;
}

function subjectSnapshot(score, sheet, subject) {
  return {
    SubjectId: clean(score.SubjectId || sheet.SubjectId),
    SubjectName: clean(subject?.Name || subject?.SubjectName || score.SubjectName || score.SubjectId || sheet.SubjectId),
    SheetId: clean(sheet.SheetId),
    ScoreId: clean(score.ScoreId),
    ScoreSheetStatus: clean(sheet.Status),
    AssessmentRevisionId: clean(score.AssessmentRevisionId || sheet.AssessmentRevisionId),
    ComponentScores: (score.ComponentScores || []).map((component) => ({
      ComponentId: clean(component.ComponentId),
      State: clean(component.State),
      RawScore: component.RawScore ?? null,
      MaximumScore: component.MaximumScore ?? null,
      WeightPercentage: component.WeightPercentage ?? null,
      Note: clean(component.Note)
    })),
    WeightedTotal: Number(score.WeightedTotal ?? score.Percentage ?? 0),
    Total: Number(score.Percentage ?? score.WeightedTotal ?? 0),
    Grade: clean(score.Grade),
    GradePoint: score.GradePoint ?? null,
    Remark: clean(score.Remark),
    Classification: clean(score.Classification),
    AssessedCount: 0
  };
}

function contextMatches(row = {}, options = {}) {
  return (!clean(options.SessionId) || clean(row.SessionId) === clean(options.SessionId))
    && (!clean(options.TermId) || clean(row.TermId) === clean(options.TermId))
    && (!clean(options.ClassId) || clean(row.ClassId) === clean(options.ClassId))
    && (!clean(options.ArmId) || clean(row.ArmId) === clean(options.ArmId));
}

export function calculateAcademicTermResultDrafts(input = {}) {
  const options = {
    SessionId: clean(input.SessionId), TermId: clean(input.TermId),
    ClassId: clean(input.ClassId), ArmId: clean(input.ArmId)
  };
  const memberships = (input.Memberships || []).filter(activeMembership).filter((row) => contextMatches(row, options));
  const scoreSheets = (input.ScoreSheets || []).filter((row) => contextMatches(row, options));
  const studentScores = input.StudentScores || [];
  const subjects = new Map((input.Subjects || []).map((row) => [lower(rowId(row, ['SubjectId', 'RecordId', '__id'])), row]));
  const existingResults = new Map((input.ExistingResults || []).map((row) => [lower(row.StudentRef), row]));
  const policy = normalizeAcademicPolicy(input.Policy || {});
  const attendanceMode = ['Daily', 'Period', 'Subject'].find((mode) => lower(mode) === lower(input.AttendanceMode)) || 'Daily';
  const attendanceRows = (input.Attendance || []).filter((row) => contextMatches(row, options)
    && lower(row.Mode || 'Daily') === lower(attendanceMode));
  const positionMode = lower(policy.Position.Mode);
  const issues = [];
  if (!memberships.length) issues.push('No active students are assigned to this classroom for the selected term.');
  if (positionMode === 'unconfigured') issues.push('Activate a position policy before calculating term results.');

  const sheetsBySubject = new Map();
  scoreSheets.forEach((sheet) => {
    if (ACTIVE_SCORE_SHEET_STATUSES.has(lower(sheet.Status))) sheetsBySubject.set(lower(sheet.SubjectId), sheet);
  });
  const scoresBySheetStudent = new Map(studentScores.map((row) => [`${lower(row.SheetId)}|${lower(row.StudentRef)}`, row]));

  const results = memberships.map((membership) => {
    const studentRef = clean(membership.StudentRef);
    const subjectIds = uniqueIds(membership.SubjectIds);
    if (!subjectIds.length) issues.push(`${studentRef} has no assigned subjects.`);
    const Subjects = subjectIds.flatMap((subjectId) => {
      const sheet = sheetsBySubject.get(lower(subjectId));
      if (!sheet) {
        issues.push(`${studentRef}: ${subjects.get(lower(subjectId))?.Name || subjectId} has no Approved or Locked score sheet.`);
        return [];
      }
      const score = scoresBySheetStudent.get(`${lower(sheet.SheetId)}|${lower(studentRef)}`);
      if (!score || lower(score.CompletionStatus) !== 'complete') {
        issues.push(`${studentRef}: ${subjects.get(lower(subjectId))?.Name || subjectId} has no complete approved score.`);
        return [];
      }
      if (clean(score.AssessmentRevisionId) !== clean(sheet.AssessmentRevisionId)) {
        issues.push(`${studentRef}: ${subjects.get(lower(subjectId))?.Name || subjectId} uses a different assessment revision from its approved score sheet.`);
        return [];
      }
      return [subjectSnapshot(score, sheet, subjects.get(lower(subjectId)))];
    });
    const TotalScore = rounded(Subjects.reduce((total, row) => total + Number(row.Total || 0), 0));
    const OverallAverage = Subjects.length ? rounded(TotalScore / Subjects.length) : 0;
    const overallBand = gradeForPercentage(policy, OverallAverage);
    const existing = existingResults.get(lower(studentRef));
    return {
      ResultId: clean(input.ResultIdFor?.(membership) || existing?.ResultId),
      ResultReference: clean(input.ResultReferenceFor?.(membership) || existing?.ResultReference),
      StudentRef: studentRef,
      SessionId: options.SessionId,
      AcademicSession: clean(input.AcademicSession),
      TermId: options.TermId,
      Term: clean(input.Term),
      ClassId: options.ClassId,
      ClassName: clean(input.ClassName),
      ArmId: options.ArmId,
      ArmName: clean(input.ArmName),
      DepartmentId: clean(membership.DepartmentId),
      Subjects,
      SubjectCount: Subjects.length,
      TotalScore,
      OverallAverage,
      OverallGrade: clean(overallBand?.Grade),
      OverallGradePoint: overallBand?.GradePoint ?? null,
      OverallRemark: clean(overallBand?.Remark),
      OverallClassification: clean(overallBand?.Classification),
      Attendance: { ...attendanceForStudent(attendanceRows, studentRef), RegisterType: attendanceMode },
      AssessedStudentCount: memberships.length,
      PositionMode: policy.Position.Mode,
      PositionTieMode: policy.Position.TieMode,
      AssessmentPolicyRevisionIds: uniqueIds(input.PolicyRevisionIds || []),
      PolicyFingerprint: clean(input.PolicyFingerprint),
      PolicySnapshot: policy,
      Status: 'Calculated Draft',
      PublicationStatus: 'Calculated Draft',
      TeacherRemark: clean(existing?.TeacherRemark),
      PrincipalRemark: clean(existing?.PrincipalRemark),
      Recommendation: clean(existing?.Recommendation)
    };
  });

  if (issues.length) return { Ready: false, Issues: [...new Set(issues)], Results: [] };

  const subjectRows = new Map();
  results.forEach((result) => result.Subjects.forEach((subject) => {
    const rows = subjectRows.get(lower(subject.SubjectId)) || [];
    rows.push({ StudentRef: result.StudentRef, Subject: subject });
    subjectRows.set(lower(subject.SubjectId), rows);
  }));
  subjectRows.forEach((rows) => {
    const ranked = rankValues(rows, (row) => Number(row.Subject.Total || 0), policy.Position.TieMode);
    ranked.forEach((row) => {
      row.Subject.AssessedCount = rows.length;
      if (['subject-only', 'internal-only'].includes(positionMode)) row.Subject.Position = row.__rank;
    });
  });

  const eligibleForOverall = results.filter((row) => row.SubjectCount >= policy.Position.MinimumAssessedSubjects);
  const overallRanks = rankValues(eligibleForOverall, (row) => Number(row.OverallAverage || 0), policy.Position.TieMode);
  overallRanks.forEach((row) => {
    if (['exact-overall', 'internal-only'].includes(positionMode)) row.OverallPosition = row.__rank;
    if (positionMode === 'percentile-band') row.PerformanceBand = percentileBand(row.__rank, eligibleForOverall.length);
    delete row.__rank;
  });
  results.forEach((row) => {
    row.Subjects.forEach((subject) => delete subject.__rank);
  });
  return { Ready: true, Issues: [], Results: results };
}

export function academicTermResultTransition(currentValue, targetValue) {
  const current = ACADEMIC_TERM_RESULT_STATUSES.find((value) => lower(value) === lower(currentValue));
  const target = ACADEMIC_TERM_RESULT_STATUSES.find((value) => lower(value) === lower(targetValue));
  if (!current || !target) return { Allowed: false, RequiresReason: false };
  const normal = {
    'Calculated Draft': 'Reviewed',
    Reviewed: 'Approved',
    Approved: 'Published',
    Published: 'Locked'
  };
  if (normal[current] === target) return { Allowed: true, RequiresReason: false };
  if (['Published', 'Locked'].includes(current) && target === 'Withdrawn') return { Allowed: true, RequiresReason: true };
  if (current === 'Withdrawn' && target === 'Calculated Draft') return { Allowed: true, RequiresReason: true };
  if (['Reviewed', 'Approved'].includes(current) && target === 'Calculated Draft') return { Allowed: true, RequiresReason: true };
  return { Allowed: false, RequiresReason: false };
}
