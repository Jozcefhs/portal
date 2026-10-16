function clean(value) { return String(value ?? '').trim(); }

export function intakeSessionStartYear(value) {
  const match = clean(value).match(/^(\d{4})\s*\/\s*(\d{4})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  return Number(match[1]);
}

export function intakeTermNumber(value) {
  const term = clean(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (['first', 'firstterm', 'term1', '1', '1st', '1stterm'].includes(term)) return 1;
  if (['second', 'secondterm', 'term2', '2', '2nd', '2ndterm'].includes(term)) return 2;
  if (['third', 'thirdterm', 'term3', '3', '3rd', '3rdterm'].includes(term)) return 3;
  return null;
}

// Only structured admission numbers carry a trustworthy year. Never infer an
// intake from a class, a creation timestamp, a wallet card or an application ID.
export function admissionYearCode(student = {}) {
  const reference = clean(student.AdmissionNo || student.admissionNo || student.AdmissionNumber || student.admissionNumber || student.AccountRef);
  const match = reference.match(/^[a-z][a-z0-9]*\s*[\/-]\s*(\d{2}|\d{4})\s*[\/-]\s*\d+$/i);
  return match ? match[1] : '';
}

export function admissionYearEnrollmentCategory(student = {}, period = {}) {
  const startYear = intakeSessionStartYear(period.AcademicSession || student.AcademicSession || student.academicSession);
  const term = intakeTermNumber(period.Term || student.Term || student.term);
  const year = admissionYearCode(student);
  if (startYear === null || term === null || !year) return null;
  const matches = year.length === 4 ? Number(year) === startYear : Number(year) === startYear % 100;
  return matches && term === 1 ? 'New Intake' : 'Returning';
}
