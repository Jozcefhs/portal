import { getDocument, queryCollectionPages } from './firestore.js';
import { normalizeClassKey } from './class-names.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const inactive = new Set(['archived', 'closed', 'inactive', 'withdrawn', 'cancelled', 'transferred', 'expelled', 'graduated', 'left school', 'deceased', 'suspended', 'on leave']);
const active = row => row && !inactive.has(lower(row.Status));
const id = (row, arm = false) => clean(row?.__id || row?.RecordId || (arm ? row?.ArmId : row?.ClassId));
const fail = () => Object.assign(new Error('The destination class or arm changed, is inactive, or could not be uniquely verified. Reload the classroom setup before assigning this pupil; no records were changed.'), { status: 409, code: 'ACADEMIC_PLACEMENT_CONFLICT' });
const sameScope = (row, scope) => lower(row.BranchId || 'main') === lower(scope.branchId || scope.BranchId || 'main')
  && lower(row.SchoolSection || 'secondary') === lower(scope.section || scope.SchoolSection || 'secondary');

export function studentPlacementAcquired(before, after) {
  if (!active(after) || !clean(after.ClassName || after.ClassAdmitted || after.AcademicClassId)) return false;
  return !before || !active(before)
    || normalizeClassKey(before.ClassName || before.ClassAdmitted) !== normalizeClassKey(after.ClassName || after.ClassAdmitted)
    || ['ClassArm', 'AcademicClassId', 'AcademicArmId'].some(key => lower(before[key]) !== lower(after[key]));
}

function placementRows(state, placement, scope, profile = false) {
  const classId = clean(profile ? placement.AcademicClassId : placement.ClassId);
  const className = clean(placement.ClassName || placement.ClassAdmitted);
  const classes = (state.classes || []).filter(row => sameScope(row, scope) && active(row)
    && (classId ? clean(row.ClassId || row.RecordId || row.__id) === classId : normalizeClassKey(row.Name) === normalizeClassKey(className)));
  if (classes.length !== 1) throw fail();
  const schoolClass = classes[0];
  if (profile && className && normalizeClassKey(schoolClass.Name) !== normalizeClassKey(className)) throw fail();
  const armId = clean(profile ? placement.AcademicArmId : placement.ArmId), armName = clean(placement.ClassArm);
  if (!armId && !armName) return [schoolClass, null];
  const arms = (state.arms || []).filter(row => sameScope(row, scope) && active(row)
    && clean(row.ClassId) === clean(schoolClass.ClassId || schoolClass.RecordId || schoolClass.__id)
    && (armId ? clean(row.ArmId || row.RecordId || row.__id) === armId : lower(row.Name).replace(/\s+/g, ' ') === lower(armName).replace(/\s+/g, ' ')));
  if (arms.length !== 1 || (profile && armName && lower(arms[0].Name).replace(/\s+/g, ' ') !== lower(armName).replace(/\s+/g, ' '))) throw fail();
  return [schoolClass, arms[0]];
}

export function academicPlacementGuardWrites(state, placement, scope, options = {}) {
  return placementRows(state, placement, scope, options.profile === true).flatMap((row, index) => {
    if (!row) return [];
    if (!id(row, index) || !row.__updateTime) throw fail();
    return [{ collectionPath: index ? 'academicArms' : 'academicClasses', documentId: id(row, index), literalDocumentId: true,
      data: { Status: row.Status || 'Active' }, updateMask: ['Status'], updateTime: row.__updateTime }];
  });
}

// Called only for a real placement mutation. One CAS touch per destination,
// regardless of pupil count; score edits and identical retries add no writes.
export function appendAcademicPlacementGuards(writes, state, scope) {
  const guards = new Map();
  for (const write of writes) {
    if (write.operation === 'delete' || !write.data || write.updateMask) continue;
    const next = write.data;
    if (write.collectionPath === 'academicStudentMemberships') {
      const before = (state.studentMemberships || []).find(row => clean(row.__id || row.MembershipId || row.RecordId) === clean(write.documentId));
      if (!active(next) || (before && active(before) && ['ClassId', 'ArmId', 'SessionId', 'TermId'].every(key => clean(before[key]) === clean(next[key])))) continue;
      for (const guard of academicPlacementGuardWrites(state, next, scope)) guards.set(`${guard.collectionPath}/${guard.documentId}`, guard);
    } else if (/(^|\/)students$/.test(write.collectionPath) && write.exists === false && studentPlacementAcquired(null, next)) {
      for (const guard of academicPlacementGuardWrites(state, next, scope, { profile: true })) guards.set(`${guard.collectionPath}/${guard.documentId}`, guard);
    }
  }
  for (const [key, guard] of guards) {
    const existing = writes.find(write => `${write.collectionPath}/${write.documentId}` === key);
    if (existing) {
      if (existing.operation === 'delete' || !existing.updateTime || existing.updateTime !== guard.updateTime || (existing.data?.Status && !active(existing.data))) throw fail();
    } else writes.push(guard);
  }
  return writes;
}

// Profile-only import/enrollment/reactivation shares the same fence as academic
// assignment. Resolve only the selected branch's definitions, never pupils.
export async function readStudentPlacementGuards(env, before, after, dependencies = {}) {
  if (!studentPlacementAcquired(before, after)) return [];
  const db = { getDocument, queryCollectionPages, ...dependencies };
  const scope = { branchId: lower(after.BranchId || 'main'), section: lower(after.SchoolSection || 'secondary') };
  const classId = clean(after.AcademicClassId), armId = clean(after.AcademicArmId);
  const classes = classId ? [await db.getDocument(env, 'academicClasses', classId)].filter(Boolean)
    : await db.queryCollectionPages(env, 'academicClasses', { filters: [{ field: 'BranchId', op: '==', value: scope.branchId }], pageSize: 100, maxRows: 1000 });
  const [schoolClass] = placementRows({ classes, arms: [] }, { ...after, AcademicArmId: '', ClassArm: '' }, scope, true);
  const arms = armId ? [await db.getDocument(env, 'academicArms', armId)].filter(Boolean)
    : clean(after.ClassArm) ? await db.queryCollectionPages(env, 'academicArms', { filters: [{ field: 'ClassId', op: '==', value: schoolClass.ClassId || schoolClass.RecordId || schoolClass.__id }], pageSize: 100, maxRows: 1000 }) : [];
  return academicPlacementGuardWrites({ classes, arms }, after, scope, { profile: true });
}
