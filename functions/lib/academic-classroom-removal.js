const clean = value => String(value ?? '').trim();
const fail = (message, code = 'ACADEMIC_CLASSROOM_REMOVAL_BLOCKED') => Object.assign(new Error(message), { status: 409, code });

// Probe references, not whole collections. Archived/historical records count too.
const references = [
  ...['academicSubjectOfferings', 'academicTeacherAllocations', 'academicStudentMemberships',
    'academicTimetableEntries', 'academicTimetableSubstitutions', 'academicStudentAttendance',
    'academicAttendanceCorrections', 'academicScoreSheets', 'academicStudentScores',
    'academicScoreImports', 'academicScoreSyncBatches', 'academicCbtTests', 'academicResults',
    'academicCumulativeResults', 'academicPromotionDecisions', 'academicDiarySchemes',
    'academicWeeklyDiaries', 'academicDiaryHistory', 'academicResultClearances',
    'academicResultEvents', 'academicCumulativeEvents', 'academicPromotionEvents',
    'academicTimetableConstraints'].map(collection => [collection, 'ArmId', 'in']),
  ['academicStudentMovements', 'FromArmId', 'in'], ['academicStudentMovements', 'ToArmId', 'in'],
  ['academicCbtTests', 'ArmIds', 'array-contains-any'],
  ['academicTimetableConstraints', 'ArmIds', 'array-contains-any']
];

export async function checkClassroomRemovals({ input, state, scope, query, students }) {
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
  const labels = targets.map(row => `${state.classes.find(item => item.ClassId === row.ClassId)?.Name || row.ClassId} / ${row.Name}`).join(', ');
  for (const [collection, field, op] of references) {
    const rows = await query(collection, { filters: [{ field, op, value: [...ids] }], select: [field], limit: 1 });
    if (rows.length) throw fail(`Cannot remove ${labels}: a classroom is linked to ${collection.replace(/^academic/, '')}. No classrooms were changed. Existing records must be retained.`);
  }
  // Also protect imported pupils who have not yet received an academic membership.
  const profiles = await students();
  if (profiles.some(student => targets.some(row => {
    const schoolClass = state.classes.find(item => item.ClassId === row.ClassId);
    const className = clean(student.ClassName || student.ClassAdmitted).toLowerCase();
    return ids.has(clean(student.AcademicArmId)) || (className === clean(schoolClass?.Name).toLowerCase()
      && clean(student.ClassArm).toLowerCase() === clean(row.Name).toLowerCase());
  }))) throw fail(`Cannot remove ${labels}: a student profile still uses this classroom. No classrooms were changed.`);
  return targets;
}
