import { getDocument, queryCollectionPages } from './firestore.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const branch = value => {
  const key = lower(value || 'main').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return key === 'main-branch' ? 'main' : key;
};
const safeId = value => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/-+/g, '-').slice(0, 140);
const fail = message => Object.assign(new Error(message), { status: 409, code: 'STUDENT_APPLICATION_STATUS_CONFLICT' });
const appReference = row => clean(row?.ApplicationReference || row?.ApplicationID || row?.applicationReference);
const admission = row => clean(row?.AdmissionNo || row?.AdmissionNumber || row?.admissionNo || row?.AccountRef);

export function enrolledApplication(row = {}) {
  return lower(row.Enrolled) === 'yes' || lower(row.Status) === 'enrolled' || Boolean(clean(row.EnrolledAt))
    || row.StudentStatusLinkedEnrollment === true;
}

export function applicationLinkedToStudent(application, student) {
  if (branch(application.BranchId) !== branch(student.BranchId)
      || lower(application.SchoolSection || 'secondary') !== lower(student.SchoolSection || 'secondary')) return false;
  const reference = appReference(application), saved = appReference(student);
  if (saved && (!reference || lower(reference) !== lower(saved))) return false;
  const studentAdmission = admission(student), applicationAdmission = admission(application);
  if (studentAdmission && applicationAdmission && lower(studentAdmission) !== lower(applicationAdmission)) return false;
  return Boolean(saved && reference || enrolledApplication(application) && studentAdmission && lower(studentAdmission) === lower(applicationAdmission));
}

// Only the learner's saved application reference is queried. Shared admission
// numbers in another branch never select a linked application.
export async function studentApplicationStatusWrites(env, before, after, options = {}, dependencies = {}) {
  const db = { getDocument, queryCollectionPages, ...dependencies };
  const reference = appReference(before);
  let rows;
  if (options.applicationUpdate) {
    rows = [options.applicationUpdate.before];
  } else if (!reference) return { writes: [], applications: [] };
  else {
    const branchId = branch(before.BranchId), section = lower(before.SchoolSection || after.SchoolSection || 'secondary');
    const paths = [`schoolBranches/${branchId}/sections/${section}/applications`, 'applications'];
    const direct = await Promise.all(paths.map(async path => {
      const row = await db.getDocument(env, path, safeId(reference));
      return row ? { ...row, __scopePath: path } : null;
    }));
    rows = direct.filter(row => row && applicationLinkedToStudent(row, { ...before, SchoolSection: section }));
    if (!rows.length) {
      const queried = await Promise.all(paths.map(async path => (await db.queryCollectionPages(env, path, {
        filters: ['ApplicationReference', 'ApplicationID', 'applicationReference'].map(field => ({ field, op: '==', value: reference })),
        filterJoin: 'OR', pageSize: 10, maxRows: 10
      })).map(row => ({ ...row, __scopePath: path }))));
      rows = queried.flat().filter(row => applicationLinkedToStudent(row, { ...before, SchoolSection: section }));
    }
  }
  if (rows.length > 1) throw fail('More than one admission record is linked to this learner in this branch. Review the duplicate links before changing status.');
  const writes = [], applications = [];
  for (const row of rows) {
    if (!row || !applicationLinkedToStudent(row, { ...before, SchoolSection: before.SchoolSection || after.SchoolSection })) {
      throw fail('The admission record is not linked to this learner in the selected branch and school section.');
    }
    if (!row.__id || !row.__scopePath || !row.__updateTime) throw fail('Reload the linked admission record before changing status.');
    const requested = options.applicationUpdate?.after || {};
    // Admission decisions and offer/payment milestones remain independent.
    const desired = { ...requested, StudentStatus: after.Status, EnrollmentStatus: after.Status,
      StudentStatusReason: clean(after.StatusReason), StudentStatusEffectiveDate: clean(after.StatusEffectiveDate) };
    if (enrolledApplication(row)) Object.assign(desired, { Status: after.Status, StudentStatusLinkedEnrollment: true });
    else desired.Status = row.Status;
    const patch = Object.fromEntries(Object.entries(desired).filter(([key, value]) => !key.startsWith('__')
      && !['RevisionToken', 'UpdatedAt', 'ReviewDate', 'ReviewedBy', 'UpdatedBy', 'StudentStatusUpdatedBy', 'StudentStatusUpdatedAt'].includes(key)
      && JSON.stringify(row[key]) !== JSON.stringify(value)));
    if (!Object.keys(patch).length) { applications.push(row); continue; }
    Object.assign(patch, { StudentStatusUpdatedAt: after.StatusUpdatedAt || after.UpdatedAt,
      StudentStatusUpdatedBy: clean(after.StatusUpdatedBy || after.UpdatedBy),
      UpdatedAt: after.UpdatedAt, UpdatedBy: after.StatusUpdatedBy || after.UpdatedBy });
    writes.push({ collectionPath: row.__scopePath, documentId: row.__id, literalDocumentId: true,
      data: patch, updateMask: Object.keys(patch), updateTime: row.__updateTime });
    applications.push({ ...row, ...patch });
  }
  return { writes, applications };
}
