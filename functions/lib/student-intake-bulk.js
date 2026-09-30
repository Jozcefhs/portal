import { schoolSectionFor, safeScopeId } from './school-scope.js';

function clean(value) { return String(value ?? '').trim(); }

export function isGradeSevenStudent(row = {}) {
  const className = clean(row.ClassName || row.className || row.ClassAdmitted || row.classAdmitted);
  return /^(?:grade\s*7|jss\s*1)(?:$|[\s/–-].*)/i.test(className);
}

export function gradeSevenIntakePlan(rows = [], { branchId, academicSession } = {}) {
  const branch = safeScopeId(branchId || '');
  const session = clean(academicSession);
  if (!branchId || !/^\d{4}\/\d{4}$/.test(session)) {
    throw new Error('Choose a branch and academic session before reviewing Grade 7 intake.');
  }
  const inBranch = (rows || []).filter((row) =>
    safeScopeId(row.BranchId || row.branchId || 'main') === branch &&
    schoolSectionFor(row) === 'secondary' &&
    isGradeSevenStudent(row)
  );
  const matching = inBranch.filter((row) => clean(row.AcademicSession || row.academicSession) === session);
  const alreadyNew = matching.filter((row) => clean(row.EnrollmentCategory || row.enrollmentCategory).toLowerCase() === 'new intake');
  const toChange = matching.filter((row) => clean(row.EnrollmentCategory || row.enrollmentCategory).toLowerCase() !== 'new intake');
  return {
    branchId: branch,
    academicSession: session,
    total: matching.length,
    alreadyNew: alreadyNew.length,
    toChange,
    excludedOtherSession: inBranch.length - matching.length,
    missingRevision: toChange.filter((row) => !clean(row.__updateTime)).length
  };
}

export async function gradeSevenIntakeFingerprint(plan) {
  const text = [plan.branchId, plan.academicSession, ...plan.toChange.map((row) => [
    clean(row.__scopePath), clean(row.__id || row.AdmissionNo || row.AccountRef),
    clean(row.__updateTime), clean(row.EnrollmentCategory || row.enrollmentCategory)
  ].join('|')).sort()].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
