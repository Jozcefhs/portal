const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const inactive = new Set(['on leave', 'suspended', 'inactive', 'withdrawn', 'expelled', 'graduated', 'transferred', 'left school', 'deceased']);
const reference = row => lower(row.StudentRef || row.AdmissionNo || row.AccountRef);
const identity = row => `${lower(row.BranchId || 'main')}|${lower(row.SchoolSection || 'secondary')}|${reference(row)}`;

export function studentStatusAllowsActiveRoster(value) {
  return !inactive.has(lower(value));
}

export function academicRosterPeriodIsHistorical(state, input, today = new Date(Date.now() + 3600000).toISOString().slice(0, 10)) {
  const session = (state.sessions || []).find(row => row.SessionId === input.SessionId);
  const term = (state.terms || []).find(row => row.TermId === input.TermId && row.SessionId === input.SessionId);
  return [session, term].some(row => ['closed', 'archived'].includes(lower(row?.Status)))
    || Boolean(clean(term?.EndDate) && term.EndDate < today);
}

// A response-only projection. Saved placements and historical marks are retained.
// Profiles already loaded for this scope supply the authoritative learner status.
export function academicRosterWithStudentStatuses(memberships = [], students = [], state = {}) {
  const profiles = new Map();
  for (const student of students) {
    const key = identity(student), status = clean(student.Status || student.status);
    const previous = profiles.get(key);
    // Conflicting duplicate profiles cannot make an excluded learner active.
    if (!previous || !studentStatusAllowsActiveRoster(status)) profiles.set(key, status);
  }
  return memberships.map(row => {
    const status = profiles.get(identity(row));
    if (!status || academicRosterPeriodIsHistorical(state, row)) return row;
    return { ...row, StudentStatus: status, ActiveRosterExcluded: !studentStatusAllowsActiveRoster(status) };
  });
}

export function activeAcademicStudentRoster(memberships = [], students = [], state = {}) {
  return academicRosterWithStudentStatuses(memberships, students, state)
    .filter(row => row.ActiveRosterExcluded !== true && studentStatusAllowsActiveRoster(row.Status));
}
