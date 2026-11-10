import { getDocument, queryCollectionPages } from './firestore.js';
import { schoolSectionFor, scopedCollectionPath } from './school-scope.js';
import { normalizeClassKey } from './class-names.js';
import { studentStatusChanged, studentProfileHasChanges } from './student-academic-status.js';
import { studentPlacementAcquired } from './academic-placement-guards.js';

const clean = value => String(value ?? '').trim(), lower = value => clean(value).toLowerCase();
const fail = message => Object.assign(new Error(message), { status: 409, code: 'STUDENT_IMPORT_REVIEW_REQUIRED' });
const dataOnly = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__') && key !== 'RevisionToken'));

// Generic backups may add a genuinely new profile, but must not bypass the
// status/placement workflows or replace a profile using another branch's ID.
export async function prepareImportedStudentWrite(env, documentId, input, dependencies = {}) {
  const db = { getDocument, queryCollectionPages, ...dependencies };
  const legacyCandidate = await db.getDocument(env, 'students', documentId);
  const branch = lower(input.BranchId || legacyCandidate?.BranchId || 'main');
  const section = schoolSectionFor({ ...legacyCandidate, ...input });
  const legacy = legacyCandidate && lower(legacyCandidate.BranchId || 'main') === branch && schoolSectionFor(legacyCandidate) === section ? legacyCandidate : null;
  const path = scopedCollectionPath('students', branch, section);
  const ref = clean(input.AdmissionNo || input.AccountRef || legacy?.AdmissionNo);
  if (!ref) throw fail('An admission number is required for a student import.');
  const matches = await db.queryCollectionPages(env, path, { filters: [{ field: 'AdmissionNo', op: 'in', value: [...new Set([ref, lower(ref), ref.toUpperCase()])] }], pageSize: 10, maxRows: 10 });
  if (legacy && lower(legacy.AdmissionNo || legacy.AccountRef) !== lower(ref)) {
    throw fail('This imported document ID belongs to a different learner. Use the branch pupil import workflow.');
  }
  if (matches.length + Number(Boolean(legacy)) > 1) throw fail('More than one saved learner matches this import. Review the existing profiles before importing.');
  const before = legacy || matches[0] || null;
  const after = { ...dataOnly(before || {}), ...dataOnly(input), BranchId: branch, SchoolSection: section, AdmissionNo: ref };
  if (before) {
    const placementChanged = normalizeClassKey(before.ClassName || before.ClassAdmitted) !== normalizeClassKey(after.ClassName || after.ClassAdmitted)
      || ['ClassArm', 'AcademicClassId', 'AcademicArmId', 'AcademicSession', 'Term'].some(key => lower(before[key]) !== lower(after[key]));
    if (studentStatusChanged(before, after) || placementChanged) throw fail('Change an existing pupil’s status or classroom through Students or Academic Management. A generic import cannot bypass membership history.');
    if (!before.__updateTime) throw fail('The saved learner revision is missing. Reload before importing.');
    if (!studentProfileHasChanges(before, after)) return { unchanged: true };
  }
  return { write: { collectionPath: legacy ? 'students' : path, documentId: clean(before?.__id || documentId),
    literalDocumentId: true, data: after, ...(before ? { updateTime: before.__updateTime } : { exists: false }) },
    placement: studentPlacementAcquired(before, after) ? after : null };
}
