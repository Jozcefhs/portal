import { batchCommitDocuments, getDocument, queryCollectionPages } from './firestore.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const id = row => clean(row?.__id || row?.MembershipId || row?.RecordId);
const failure = (message, code = 'STUDENT_STATUS_CONFLICT') => Object.assign(new Error(message), { status: 409, code });
export const STUDENT_STATUSES = Object.freeze(['Active', 'Enrolled', 'On Leave', 'Suspended', 'Inactive', 'Withdrawn', 'Expelled', 'Graduated', 'Transferred', 'Left School', 'Deceased']);
const temporary = new Set(['on leave', 'suspended', 'inactive']);
const permanent = new Set(['withdrawn', 'expelled', 'graduated', 'transferred', 'left school', 'deceased']);
const inactiveMembership = new Set(['inactive', 'withdrawn', 'archived', 'closed', 'cancelled', 'transferred']);

export function studentStatusKind(value) {
  return temporary.has(lower(value)) ? 'temporary' : permanent.has(lower(value)) ? 'permanent' : 'active';
}

export function studentStatusChanged(before = {}, after = {}) {
  return Object.hasOwn(after, 'Status') && lower(before.Status || before.status || 'Active') !== lower(after.Status || 'Active');
}

export function assertStudentCanHaveActiveMembership(student, membership) {
  if (student && studentStatusKind(student.Status || student.status) !== 'active' && !inactiveMembership.has(lower(membership.Status))) {
    throw failure(`This student is ${clean(student.Status || student.status)}. Return the student to Active before allocating, transferring or reinstating an active class membership.`, 'STUDENT_NOT_ACTIVE');
  }
}

// Invoked by the common student writer, after the calling route's existing
// authorization. One commit fences the profile, memberships and period revisions.
// Scores, attendance, payments and other history are never write targets.
export async function saveStudentStatusWithMemberships(env, before, after, options, dependencies = {}) {
  const db = { getDocument, queryCollectionPages, batchCommitDocuments, ...dependencies };
  const status = STUDENT_STATUSES.find(value => lower(value) === lower(after.Status));
  if (!status) throw failure('Choose a valid student status.', 'STUDENT_STATUS_INVALID');
  if (!before?.__updateTime || !options.updateTime || options.updateTime !== before.__updateTime) {
    throw failure('This student changed after the screen was loaded. Refresh and retry; nothing was saved.');
  }
  const now = dependencies.now || new Date().toISOString();
  const today = new Date(Date.parse(now) + 60 * 60 * 1000).toISOString().slice(0, 10); // School dates use WAT.
  const date = clean(after.StatusEffectiveDate) || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today) {
    throw failure('Status changes take effect when saved. Use today or an earlier valid effective date; future-dated changes are not scheduled.', 'STUDENT_STATUS_DATE_INVALID');
  }
  const branch = lower(before.BranchId || 'main');
  const section = lower(before.SchoolSection || after.SchoolSection || 'secondary');
  const inScope = row => lower(row.BranchId || 'main') === branch && lower(row.SchoolSection || 'secondary') === section;
  if (lower(after.BranchId || 'main') !== branch || lower(after.SchoolSection || section) !== section) throw failure('Change school placement separately from student status.');
  const references = [...new Set([before.AdmissionNo, before.AccountRef, before.StudentRef].map(clean).filter(Boolean))];
  if (!references.length) throw failure('The student admission/account reference is missing.');
  const queryRefs = [...new Set(references.flatMap(value => [value, value.toLowerCase(), value.toUpperCase()]))];
  const matches = await db.queryCollectionPages(env, 'academicStudentMemberships', {
    filters: [{ field: 'StudentRef', op: 'in', value: queryRefs }], pageSize: 100, maxRows: 400
  });
  if (clean(before.AcademicMembershipId) && !matches.some(row => id(row) === clean(before.AcademicMembershipId))) {
    const linked = await db.getDocument(env, 'academicStudentMemberships', before.AcademicMembershipId);
    if (linked) matches.push(linked); // Legacy mixed-case references still use the saved membership ID.
  }
  const memberships = matches.filter(row => inScope(row) && references.some(ref => lower(ref) === lower(row.StudentRef)));
  const kind = studentStatusKind(status);
  const actor = clean(after.StatusUpdatedBy || after.UpdatedBy) || 'School Office';
  const reason = clean(after.StatusReason) || `Student status changed to ${status}.`;
  const writes = [], guards = new Map(), periods = new Map();
  const eligible = [];
  for (const row of memberships) {
    if (row.SupersededByMembershipId || ['archived', 'closed', 'cancelled', 'transferred'].includes(lower(row.Status))) continue;
    if (kind === 'active' ? row.ProfileStatusManaged !== true : inactiveMembership.has(lower(row.Status)) && row.ProfileStatusManaged !== true) continue;
    for (const [collection, periodId] of [['academicSessions', row.SessionId], ['academicTerms', row.TermId]]) {
      const key = `${collection}/${clean(periodId)}`;
      if (!periods.has(key)) periods.set(key, periodId ? await db.getDocument(env, collection, periodId) : null);
    }
    const session = periods.get(`academicSessions/${clean(row.SessionId)}`);
    const term = periods.get(`academicTerms/${clean(row.TermId)}`);
    if (!session || !term || !inScope(session) || !inScope(term) || term.SessionId !== row.SessionId) {
      throw failure('An academic membership has an unknown or inconsistent session/term. No status or membership was changed.');
    }
    // Never rewrite a closed or completed historical class roster.
    if ([session, term].some(period => ['closed', 'archived'].includes(lower(period.Status))) || (clean(term.EndDate) && term.EndDate < today)) continue;
    if (kind === 'active' && (lower(session.Name) !== lower(after.AcademicSession) || lower(term.Name) !== lower(after.Term))) continue;
    eligible.push(row);
    for (const [collection, period] of [['academicSessions', session], ['academicTerms', term]]) {
      if (!period.__updateTime) throw failure('The academic period revision could not be verified. Refresh and retry.');
      const periodId = clean(period.__id || (collection === 'academicSessions' ? row.SessionId : row.TermId));
      guards.set(`${collection}/${periodId}`, { collectionPath: collection, documentId: periodId, literalDocumentId: true,
        data: { Status: period.Status }, updateMask: ['Status'], updateTime: period.__updateTime });
    }
  }
  let selected = eligible;
  if (kind === 'active') {
    const current = memberships.filter(row => !inactiveMembership.has(lower(row.Status)) && eligible.some(candidate => candidate.SessionId === row.SessionId && candidate.TermId === row.TermId));
    if (current.length) throw failure('This student already has an active membership. Review the current allocation before restoring an older placement.');
    const preferred = eligible.filter(row => id(row) === clean(before.AcademicMembershipId));
    selected = preferred.length === 1 ? preferred : eligible;
    if (selected.length > 1) throw failure('More than one previous placement could be restored. Resolve the correct class/arm in Academic Management; nothing was changed.');
    for (const row of selected) {
      for (const [collection, recordId] of [['academicClasses', row.ClassId], ['academicArms', row.ArmId]]) {
        if (!recordId && collection === 'academicArms') continue; // Legitimate unassigned arm.
        const placement = recordId ? await db.getDocument(env, collection, recordId) : null;
        if (!placement || !inScope(placement) || inactiveMembership.has(lower(placement.Status)) || (collection === 'academicArms' && placement.ClassId !== row.ClassId)) {
          throw failure('The saved class/arm is no longer active. Review the student placement before reinstatement.');
        }
        if (!placement.__updateTime) throw failure('The saved class/arm revision could not be verified.');
        guards.set(`${collection}/${recordId}`, { collectionPath: collection, documentId: clean(placement.__id || recordId), literalDocumentId: true,
          data: { Status: placement.Status }, updateMask: ['Status'], updateTime: placement.__updateTime });
      }
    }
  }
  for (const row of selected) {
    if (!id(row) || !row.__updateTime) throw failure('An academic membership revision could not be verified. Refresh and retry.');
    const target = kind === 'active' ? 'Active' : kind === 'temporary' ? 'Inactive' : 'Withdrawn';
    const patch = { Status: target, ProfileStatusManaged: kind !== 'active', ProfileStudentStatus: status,
      ProfileStatusEffectiveDate: date, ProfileStatusReason: reason, UpdatedAt: now, UpdatedBy: actor };
    writes.push({ collectionPath: 'academicStudentMemberships', documentId: id(row), literalDocumentId: true,
      data: patch, updateMask: Object.keys(patch), updateTime: row.__updateTime });
    const movementId = `STATUS-${crypto.randomUUID()}`;
    writes.push({ collectionPath: 'academicStudentMovements', documentId: movementId, exists: false,
      data: { MovementId: movementId, MembershipId: row.MembershipId || id(row), StudentRef: row.StudentRef,
        BranchId: row.BranchId || branch, SchoolSection: section, SessionId: row.SessionId, TermId: row.TermId,
        MovementType: kind === 'active' ? 'Reinstatement' : kind === 'temporary' ? 'Temporary absence' : 'Withdrawal',
        FromClassId: row.ClassId, ToClassId: row.ClassId, FromArmId: row.ArmId || '', ToArmId: row.ArmId || '',
        PreviousStatus: row.Status, NewStatus: target, StudentStatus: status, Reason: reason, EffectiveDate: date,
        RecordedAt: now, RecordedBy: actor, Source: 'Student status synchronization' } });
  }
  const profile = { ...after, Status: status, ...(Object.hasOwn(before, 'status') ? { status } : {}), StatusEffectiveDate: date, StatusUpdatedAt: now, StatusUpdatedBy: actor,
    UpdatedAt: now, UpdatedBy: actor,
    ...(kind !== 'active' ? { AcademicEnrollmentStatus: kind === 'temporary' ? 'Inactive' : 'Withdrawn' }
      : selected.length ? { AcademicEnrollmentStatus: 'Active', AcademicMembershipId: selected[0].MembershipId || id(selected[0]) } : {}) };
  // Only changed profile fields are written: retained data keeps its stored type.
  const patch = Object.fromEntries(Object.entries(profile).filter(([key, value]) => !key.startsWith('__') && key !== 'RevisionToken' && JSON.stringify(value) !== JSON.stringify(before[key])));
  writes.push(...guards.values());
  const auditId = `STATUS-${crypto.randomUUID()}`;
  writes.push({ collectionPath: 'academicManagementAudit', documentId: auditId, exists: false,
    data: { AuditId: auditId, Timestamp: now, Action: 'STUDENT STATUS CHANGE', RecordType: 'student',
      RecordId: options.documentId, StudentRef: references[0], BranchId: branch, SchoolSection: section,
      Actor: actor, PreviousStatus: before.Status || 'Active', NewStatus: status,
      Details: reason, MembershipIds: selected.map(id), Summary: `${selected.length} active-period membership(s) synchronized; historical records preserved.` } });
  writes.push({ collectionPath: options.collectionPath, documentId: options.documentId, literalDocumentId: true,
    data: patch, updateMask: Object.keys(patch), updateTime: before.__updateTime });
  let result;
  try { result = await db.batchCommitDocuments(env, writes); }
  catch (error) {
    if ([409, 412].includes(Number(error.status))) throw failure('The student, placement or academic period changed while saving. Refresh and retry; no partial status change was saved.');
    throw error;
  }
  return { ...profile, __id: options.documentId, __scopePath: options.collectionPath,
    __updateTime: result?.writeResults?.at(-1)?.updateTime || '', __academicStatusMembershipCount: selected.length };
}
