import { batchCommitDocuments, getDocument, queryCollectionPages } from './firestore.js';
import { listBranchCollection } from './branch-reads.js';
import { normalizeClassKey } from './class-names.js';
import { enforceActorBranch } from './branch-scope.js';
import { academicManagementCapabilities, normalizeAcademicStudentMembership, findAcademicStudentMembership,
  applyAcademicStudentCurriculum, assertAcademicMembershipCapacity } from './academic-management.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const active = row => row && !['archived', 'closed', 'inactive', 'withdrawn', 'cancelled', 'transferred'].includes(lower(row.Status));
const id = row => clean(row?.__id || row?.RecordId || row?.MembershipId || row?.SessionId || row?.TermId);
const fail = (message, code = 'SESSION_MOVEMENT_INVALID', status = 409) => Object.assign(new Error(message), { code, status });
const collections = { sessions: 'academicSessions', terms: 'academicTerms', classes: 'academicClasses', arms: 'academicArms',
  departments: 'academicDepartments', subjects: 'academicSubjects', offerings: 'academicSubjectOfferings' };
const dataOnly = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
const sameScope = (row, branch, section) => lower(row.BranchId || 'main') === lower(branch)
  && lower(row.SchoolSection || 'secondary') === section;

// One request-local cache, shared by the selected students; never a tenant-wide
// roster/score scan. A successful guarded write advances cached revisions.
export async function moveStudentSession(env, user, initialProfile, input, cache = new Map(), dependencies = {}) {
  if (!academicManagementCapabilities(user).canManageAllocations || user.subscriptionReadOnly || user.subscriptionActive === false) {
    throw fail('This account cannot move academic memberships.', 'SESSION_MOVEMENT_FORBIDDEN', 403);
  }
  const db = { getDocument, queryCollectionPages, batchCommitDocuments, listBranchCollection, ...dependencies };
  const branch = clean(initialProfile.BranchId || 'main'), section = lower(initialProfile.SchoolSection || 'secondary');
  enforceActorBranch(user, branch);
  if (!['', 'all', section].includes(lower(user.schoolSectionAccess))) throw fail('This student is outside the assigned school section.', 'SESSION_MOVEMENT_FORBIDDEN', 403);
  const ref = clean(initialProfile.AdmissionNo), path = clean(initialProfile.__scopePath), profileId = clean(initialProfile.__id);
  if (!ref || !path || !profileId || !initialProfile.__updateTime) throw fail('Reload the student register before moving this student.');
  const cacheKey = `${branch}/${section}/${clean(input.AcademicSession)}/${clean(input.Term)}`;
  let profile = initialProfile;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (!['active', 'enrolled', ''].includes(lower(profile.Status))) throw fail(`This student is ${profile.Status} and was not moved.`);
      let state = cache.get(cacheKey);
      if (!state) {
        state = Object.fromEntries(await Promise.all(Object.entries(collections).map(async ([key, collection]) => [key,
          (await db.listBranchCollection(env, collection, branch)).filter(row => sameScope(row, branch, section))])));
        cache.set(cacheKey, state);
      }
      const resolve = (rows, name, label, compare = (row, value) => lower(row.Name) === lower(value)) => {
        const matches = rows.filter(row => active(row) && compare(row, name));
        if (matches.length !== 1) throw fail(`Configure one active ${label} named "${name}" in this branch and section before moving students. Nothing was changed for this student.`);
        return matches[0];
      };
      const session = resolve(state.sessions, input.AcademicSession, 'academic session');
      const term = resolve(state.terms.filter(row => row.SessionId === session.SessionId), input.Term, 'term');
      const schoolClass = resolve(state.classes, input.NewClass, 'class', (row, value) => normalizeClassKey(row.Name) === normalizeClassKey(value));
      const receiptKey = JSON.stringify([branch, section, ref.toLowerCase(), session.SessionId, term.TermId]);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(receiptKey))), b => b.toString(16).padStart(2, '0')).join('');
      const receiptId = `SESSION-${digest}`;
      const receipt = await db.getDocument(env, 'academicStudentMovements', receiptId);
      if (receipt) {
        if (receipt.SessionMovementReceipt !== true || receipt.StudentRef !== ref || receipt.ToClassId !== schoolClass.ClassId
          || (clean(input.NewClassArm) && lower(input.NewClassArm) !== lower(receipt.ToArmName))) {
          throw fail('A different session movement already exists for this student and destination period. Use Academic Management transfer to change that placement.');
        }
        return { status: 'alreadyMoved', student: profile, message: 'Already moved; the saved movement and any subsequent transfers were preserved.' };
      }
      if (input.RevisionToken && input.RevisionToken !== profile.__updateTime) throw fail('The selected student changed after loading. Refresh Students and retry.', 'SESSION_MOVEMENT_STALE_SELECTION');
      const armName = clean(input.NewClassArm || profile.ClassArm);
      const arm = armName ? resolve(state.arms.filter(row => row.ClassId === schoolClass.ClassId), armName, 'destination arm') : null;
      const identity = { BranchId: branch, SchoolSection: section, SessionId: session.SessionId, TermId: term.TermId, StudentRef: ref };
      const refs = [...new Set([ref, ref.toLowerCase(), ref.toUpperCase()])];
      const memberships = (await db.queryCollectionPages(env, 'academicStudentMemberships', {
        filters: [{ field: 'StudentRef', op: 'in', value: refs }], pageSize: 100, maxRows: 500
      })).filter(row => sameScope(row, branch, section));
      if (profile.AcademicMembershipId && !memberships.some(row => id(row) === profile.AcademicMembershipId)) {
        const linked = await db.getDocument(env, 'academicStudentMemberships', profile.AcademicMembershipId);
        if (linked && sameScope(linked, branch, section) && lower(linked.StudentRef) === lower(ref)) memberships.push(linked);
      }
      const destination = findAcademicStudentMembership(memberships, identity);
      if (destination && (!active(destination) || destination.ClassId !== schoolClass.ClassId || clean(destination.ArmId) !== clean(arm?.ArmId))) {
        throw fail('This student already has a different placement in the destination period. Use Academic Management transfer; existing records were preserved.');
      }
      const source = memberships.find(row => id(row) === profile.AcademicMembershipId && active(row))
        || memberships.find(row => active(row) && state.sessions.some(s => s.SessionId === row.SessionId && lower(s.Name) === lower(profile.AcademicSession))
          && state.terms.some(t => t.TermId === row.TermId && lower(t.Name) === lower(profile.Term)));
      const sameProfilePeriod = lower(profile.AcademicSession) === lower(session.Name) && lower(profile.Term) === lower(term.Name);
      if (sameProfilePeriod && normalizeClassKey(profile.ClassName || profile.ClassAdmitted) !== normalizeClassKey(schoolClass.Name)) {
        throw fail('Session Movement advances a session or term. Use Academic Management transfer to change class within the same period.');
      }
      const progress = clean(input.AcademicProgress) || 'Promoted';
      if (!['Promoted', 'Repeating'].includes(progress)) throw fail('Choose Promoted or Repeating.');
      const timestamp = dependencies.now || new Date().toISOString(), actor = clean(user.displayName || user.username) || 'Academic Management';
      let record = destination;
      if (!record) {
        record = normalizeAcademicStudentMembership({ ...identity, ClassId: schoolClass.ClassId, ArmId: arm?.ArmId || '',
          DepartmentId: arm?.DepartmentId || '', Status: 'Active' }, { branchId: branch, section, allowMissingArm: !arm });
        record.SchoolStage = schoolClass.SchoolStage;
        applyAcademicStudentCurriculum(state, record, { allowIncompleteCurriculum: true });
        Object.assign(record, { CreatedAt: timestamp, CreatedBy: actor, UpdatedAt: timestamp, UpdatedBy: actor });
      }
      const department = state.departments.find(row => row.DepartmentId === record.DepartmentId);
      const placement = { ClassName: schoolClass.Name, ClassAdmitted: schoolClass.Name, ClassArm: arm?.Name || '',
        AcademicSession: session.Name, Term: term.Name, AcademicClassId: record.ClassId, AcademicArmId: record.ArmId,
        AcademicMembershipId: record.MembershipId, AcademicEnrollmentStatus: 'Active', SchoolStage: schoolClass.SchoolStage,
        AcademicDepartmentId: record.DepartmentId || '', AcademicDepartment: department?.Name || '', AcademicDepartmentCode: department?.Code || '',
        EnrollmentCategory: 'Returning', AcademicProgress: progress };
      if (destination && Object.entries(placement).every(([key, value]) => clean(profile[key]) === clean(value))) {
        return { status: 'alreadyMoved', student: profile, message: 'Already in this session and classroom; no history was added.' };
      }
      if (!destination && (Number(schoolClass.Capacity) > 0 || Number(arm?.Capacity) > 0)) {
        const occupants = (await db.queryCollectionPages(env, 'academicStudentMemberships', {
          filters: [{ field: 'ClassId', op: '==', value: schoolClass.ClassId }, { field: 'SessionId', op: '==', value: session.SessionId },
            { field: 'TermId', op: '==', value: term.TermId }], pageSize: 200, maxRows: 10000
        })).filter(row => sameScope(row, branch, section));
        assertAcademicMembershipCapacity({ ...state, studentMemberships: occupants }, record);
      }
      const oldClass = clean(profile.ClassName || profile.ClassAdmitted);
      const historyLine = `${timestamp} | ${oldClass || 'Unspecified'} -> ${schoolClass.Name} | ${session.Name} | ${term.Name} | ${actor}`;
      const patch = { ...placement, PreviousClass: oldClass, PromotedAt: timestamp, PromotedBy: actor,
        PromotionHistory: profile.PromotionHistory ? `${profile.PromotionHistory}\n${historyLine}` : historyLine,
        UpdatedAt: timestamp, UpdatedBy: actor };
      const writes = [], guards = [];
      const guard = (collectionPath, row) => {
        if (!row.__updateTime || !id(row)) throw fail('An academic record revision is missing. Refresh and retry.');
        guards.push({ row, index: writes.length });
        writes.push({ collectionPath, documentId: id(row), literalDocumentId: true, updateTime: row.__updateTime,
          data: { Status: row.Status || 'Active' }, updateMask: ['Status'] });
      };
      for (const [collection, row] of [['academicSessions', session], ['academicTerms', term], ['academicClasses', schoolClass],
        ['academicArms', arm], ['academicDepartments', department]]) if (row) guard(collection, row);
      if (destination) guard('academicStudentMemberships', destination);
      else writes.push({ collectionPath: 'academicStudentMemberships', documentId: record.MembershipId, exists: false, data: dataOnly(record) });
      if (source && id(source) !== id(destination)) guard('academicStudentMemberships', source);
      const movement = { ...identity, MovementId: receiptId, SessionMovementReceipt: true, MovementType: 'Session movement',
        Status: 'Completed', StudentRef: ref, MembershipId: record.MembershipId, FromMembershipId: source?.MembershipId || '',
        FromSessionId: source?.SessionId || '', FromTermId: source?.TermId || '', FromClassId: source?.ClassId || '', FromArmId: source?.ArmId || '',
        ToClassId: record.ClassId, ToArmId: record.ArmId, ToArmName: arm?.Name || '', ToSessionId: session.SessionId, ToTermId: term.TermId,
        Reason: `${progress} to ${session.Name}, ${term.Name}`, EffectiveDate: timestamp.slice(0, 10), CreatedAt: timestamp, CreatedBy: actor };
      writes.push({ collectionPath: 'academicStudentMovements', documentId: receiptId, exists: false, data: movement },
        { collectionPath: 'academicManagementAudit', documentId: receiptId, exists: false, data: { ...identity, AuditId: receiptId,
          Timestamp: timestamp, Action: 'SESSION MOVEMENT', RecordType: 'studentmembership', RecordId: record.MembershipId, Actor: actor,
          Details: movement.Reason, Summary: 'Destination membership and profile saved together. Previous-period records preserved.' } },
        { collectionPath: path, documentId: profileId, literalDocumentId: true, updateTime: profile.__updateTime, data: patch, updateMask: Object.keys(patch) });
      const result = await db.batchCommitDocuments(env, writes);
      for (const { row, index } of guards) row.__updateTime = result.writeResults[index].updateTime;
      return { status: 'moved', student: { ...profile, ...patch, __updateTime: result.writeResults.at(-1).updateTime }, message: 'Profile and academic membership moved together.' };
    } catch (error) {
      if (attempt === 2 || ![409, 412].includes(Number(error.status)) || error.code?.startsWith('SESSION_MOVEMENT')) throw error;
      cache.delete(cacheKey);
      profile = await db.getDocument(env, path, profileId);
      if (!profile) throw fail('The student record no longer exists. No replacement was created.');
      profile = { ...profile, __scopePath: path };
    }
  }
}
