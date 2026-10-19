import { schoolSectionFor, safeScopeId } from './school-scope.js';
import { admissionYearCode, admissionYearEnrollmentCategory, intakeSessionStartYear, intakeTermNumber } from './student-intake-classification.js';

function clean(value) { return String(value ?? '').trim(); }

export function admissionYearIntakePlan(rows = [], { branchId, academicSession, schoolSectionAccess = 'All' } = {}) {
  const branch = safeScopeId(branchId || '');
  const year = intakeSessionStartYear(academicSession);
  const section = clean(schoolSectionAccess).toLowerCase();
  if (!clean(branchId) || ['all', '*'].includes(clean(branchId).toLowerCase()) || year === null || !['all','primary','secondary'].includes(section)) {
    throw Object.assign(new Error('Choose a branch, school section and valid academic session before reviewing intake.'), {status:400});
  }
  const session = `${year}/${year + 1}`;
  const inScope = (rows || []).filter((row) =>
    safeScopeId(row.BranchId || row.branchId || 'main') === branch &&
    (section === 'all' || schoolSectionFor(row) === section)
  );
  const active = inScope.filter(row => !['inactive','withdrawn','deleted','archived','graduated'].includes(clean(row.Status || row.StudentStatus).toLowerCase()));
  const inSession = active.filter(row => clean(row.AcademicSession || row.academicSession).replace(/\s/g, '') === session);
  const firstTerm = inSession.filter(row => intakeTermNumber(row.Term || row.term) === 1);
  const recognized = firstTerm.filter(row => admissionYearCode(row));
  const matching = recognized.filter(row => admissionYearEnrollmentCategory(row) === 'New Intake');
  const toChange = matching.filter((row) => clean(row.EnrollmentCategory || row.enrollmentCategory).toLowerCase() !== 'new intake');
  return {
    branchId: branch, schoolSectionAccess: section, academicSession: session, term: 'First Term', admissionYear: String(year).slice(-2),
    total: matching.length, alreadyNew: matching.length - toChange.length, toChange,
    excludedInactive: inScope.length - active.length,
    excludedOtherSession: active.length - inSession.length,
    excludedOtherTerm: inSession.length - firstTerm.length,
    unrecognizedAdmissionNumbers: firstTerm.length - recognized.length,
    excludedAdmissionYear: recognized.length - matching.length,
    missingRevision: toChange.filter(row => !clean(row.__updateTime) || !clean(row.__scopePath) || !clean(row.__id)).length
  };
}

export async function admissionYearIntakeFingerprint(plan) {
  const text = ['admission-year-first-term-v1', plan.branchId, plan.schoolSectionAccess, plan.academicSession, plan.term, ...plan.toChange.map((row) => [
    clean(row.__scopePath), clean(row.__id), clean(row.__updateTime),
    clean(row.AdmissionNo || row.AccountRef), clean(row.EnrollmentCategory || row.enrollmentCategory)
  ].join('|')).sort()].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
