import { studentStatusKind } from './student-academic-status.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const fail = (message, code = 'ACADEMIC_CLASSROOM_REMOVAL_BLOCKED') => Object.assign(new Error(message), { status: 409, code });

export async function checkClassroomRemovals({ input, state, scope, query, students, today = new Date(Date.now() + 3600000).toISOString().slice(0, 10) }) {
  const requests = input.RemoveClassrooms || [];
  if (!Array.isArray(requests) || requests.length > 10) throw fail('Remove at most 10 classrooms at a time.');
  if (!requests.length) return [];
  if (input.ConfirmClassroomRemoval !== true) throw fail('Review and confirm the classrooms to remove.');
  const classes = new Set(input.ClassIds || []), ids = new Set();
  const targets = requests.map(request => {
    const id = clean(request.ArmId), row = state.arms.find(arm => arm.ArmId === id);
    if (!row || ids.has(id) || !classes.has(row.ClassId)
      || clean(row.BranchId).toLowerCase() !== clean(scope.branchId).toLowerCase()
      || clean(row.SchoolSection).toLowerCase() !== clean(scope.section).toLowerCase()
      || ![true, 'true', 'yes', '1'].includes(typeof row.IsClassroom === 'string' ? row.IsClassroom.toLowerCase() : row.IsClassroom)) {
      throw fail('A removal target is not a classroom in the selected classes and school section.');
    }
    if (!clean(request.RevisionToken) || request.RevisionToken !== row.__updateTime) {
      throw fail('A classroom changed after it was loaded. Refresh and review the selections again.', 'ACADEMIC_WRITE_CONFLICT');
    }
    ids.add(id);
    return row;
  });
  const label = row => `${state.classes.find(item => item.ClassId === row.ClassId)?.Name || row.ClassId} / ${row.Name}`;
  const inScope = row => (!clean(row.BranchId) || lower(row.BranchId) === lower(scope.branchId))
    && (!clean(row.SchoolSection) || lower(row.SchoolSection) === lower(scope.section));
  const ended = period => period && (['closed', 'archived'].includes(lower(period.Status))
    || (/^\d{4}-\d{2}-\d{2}$/.test(clean(period.EndDate)) && period.EndDate < today));
  const current = row => inScope(row) && !row.SupersededByMembershipId
    && !['archived', 'closed', 'cancelled', 'inactive', 'withdrawn', 'transferred'].includes(lower(row.Status))
    && studentStatusKind(row.Status) === 'active'
    && !ended((state.sessions || []).find(period => period.SessionId === row.SessionId))
    && !ended((state.terms || []).find(period => period.TermId === row.TermId));
  // Archiving removes a classroom from new allocations; it never deletes its
  // identity or history. Only current/future students block removal, not old
  // transfers, scores, diaries, attendance, teachers or closed-period rosters.
  // Read every matching membership: an archived first row cannot hide an active one.
  const memberships = await query('academicStudentMemberships', {
    filters: [{ field: 'ArmId', op: 'in', value: [...ids] }],
    select: ['ArmId', 'ClassId', 'BranchId', 'SchoolSection', 'SessionId', 'TermId', 'StudentRef', 'Status', 'SupersededByMembershipId'],
    pageSize: 500, maxRows: 50000
  });
  const occupied = targets.filter(row => memberships.some(member => member.ArmId === row.ArmId && current(member)));
  if (occupied.length) throw fail(`Cannot remove ${occupied.map(label).join(', ')}: students are still assigned to this classroom in an open academic period. Transfer or withdraw them first. No classrooms were changed.`);
  // Protect imported pupils without a membership, but do not let stale profile
  // labels override a confirmed current membership in a different classroom.
  const assignedRefs = new Set([...(state.studentMemberships || []), ...memberships].filter(current).map(row => lower(row.StudentRef)).filter(Boolean));
  const profiles = await students();
  const occupiedProfiles = targets.filter(row => profiles.some(student => {
    if (!inScope(student) || studentStatusKind(student.Status || student.status) !== 'active') return false;
    const refs = [student.StudentRef, student.AdmissionNo, student.AccountRef].map(lower).filter(Boolean);
    if (refs.some(ref => assignedRefs.has(ref))) return false;
    const schoolClass = state.classes.find(item => item.ClassId === row.ClassId);
    const className = clean(student.ClassName || student.ClassAdmitted).toLowerCase();
    return clean(student.AcademicArmId) === row.ArmId || (className === clean(schoolClass?.Name).toLowerCase()
      && clean(student.ClassArm).toLowerCase() === clean(row.Name).toLowerCase());
  }));
  if (occupiedProfiles.length) throw fail(`Cannot remove ${occupiedProfiles.map(label).join(', ')}: an active student profile without a current academic membership still uses this classroom. Transfer or update that student first. No classrooms were changed.`);
  return targets;
}
