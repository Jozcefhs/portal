import { batchCommitDocuments, listCollection } from './firestore.js';
import { enforceActorBranch } from './branch-scope.js';
import { normalizeClassKey } from './class-names.js';
import { staffRecordMatchesEdition } from './records-desk.js';
import { getSchoolStructure, listSchoolCollection, safeScopeId } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();

export const ACADEMIC_MANAGEMENT_COLLECTIONS = Object.freeze({
  sessions: 'academicSessions',
  terms: 'academicTerms',
  classes: 'academicClasses',
  arms: 'academicArms',
  subjects: 'academicSubjects',
  offerings: 'academicSubjectOfferings',
  teacherAllocations: 'academicTeacherAllocations',
  studentMemberships: 'academicStudentMemberships',
  audit: 'academicManagementAudit'
});

export const ACADEMIC_SESSION_STATUSES = Object.freeze(['Planned', 'Active', 'Closed', 'Archived']);
export const ACADEMIC_TERM_STATUSES = Object.freeze(['Planned', 'Active', 'Closed', 'Archived']);
export const ACADEMIC_RECORD_STATUSES = Object.freeze(['Active', 'Inactive', 'Archived']);
export const ACADEMIC_SUBJECT_CATEGORIES = Object.freeze(['Core', 'Elective', 'Vocational', 'Co-curricular']);
export const ACADEMIC_TEACHER_ALLOCATION_ROLES = Object.freeze(['Subject Teacher', 'Form Teacher', 'Assistant Teacher']);

const STRUCTURE_MANAGERS = new Set(['Super Admin', 'Principal', 'Management']);
const ALLOCATION_MANAGERS = new Set([...STRUCTURE_MANAGERS, 'Admissions Officer']);

function failure(message, status = 400, code = '') {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function activeValue(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  const normalized = lower(value);
  if (!normalized) return fallback;
  return !['no', 'false', '0', 'inactive', 'disabled', 'archived', 'closed'].includes(normalized);
}

function oneOf(value, choices, fallback) {
  const wanted = lower(value);
  return choices.find((choice) => lower(choice) === wanted) || fallback;
}

function wholeNumber(value, fallback = 0, minimum = 0, maximum = 1000000) {
  if (value === '' || value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function dateValue(value, label, required = true) {
  const date = clean(value);
  if (!date && !required) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw failure(`Enter a valid ${label}.`);
  return date;
}

function assertDateOrder(start, end, label) {
  if (start && end && start > end) throw failure(`${label} end date cannot be before its start date.`);
}

function uniqueIds(value) {
  const supplied = Array.isArray(value) ? value : clean(value).split(',');
  return [...new Set(supplied.map((item) => clean(item)).filter(Boolean))];
}

function academicId(...parts) {
  const normalized = parts.map((part) => safeScopeId(part, '')).filter(Boolean);
  if (normalized.length !== parts.length) throw failure('Academic record identifiers cannot be blank.');
  return normalized.join('__');
}

function legacyDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

function actorName(user = {}) {
  return clean(user.displayName || user.DisplayName || user.username || user.Username) || 'Administrator';
}

function actorUsername(user = {}) {
  return lower(user.username || user.Username);
}

function recordId(row = {}) {
  return clean(
    row.RecordId || row.recordId || row.SessionId || row.TermId || row.ClassId || row.ArmId
      || row.SubjectId || row.OfferingId || row.AllocationId || row.MembershipId || row.__id
  );
}

function statusActive(row = {}) {
  return !['archived', 'inactive', 'closed'].includes(lower(row.Status));
}

function publicRecord(row = {}) {
  const copy = { ...row, RecordId: recordId(row), RevisionToken: clean(row.__updateTime) };
  delete copy.__name;
  delete copy.__id;
  delete copy.__createTime;
  delete copy.__updateTime;
  delete copy.__scopePath;
  return copy;
}

function isSchoolEdition(user = {}) {
  return lower(user.edition || user.Edition || user.OrganisationEdition || user.OrganizationEdition) === 'school';
}

export function academicManagementCapabilities(user = {}) {
  const role = clean(user.role || user.Role);
  const allowed = new Set((user.allowedSections || user.TabAccess || []).map(clean).filter(Boolean));
  const school = isSchoolEdition(user);
  const enabled = school && allowed.has('academics');
  return {
    enabled,
    canManageStructure: enabled && STRUCTURE_MANAGERS.has(role),
    canManageAllocations: enabled && ALLOCATION_MANAGERS.has(role),
    canArchive: enabled && STRUCTURE_MANAGERS.has(role),
    teacherView: enabled && role === 'Teacher'
  };
}

function requireCapability(user, capability = 'enabled') {
  const permissions = academicManagementCapabilities(user);
  if (permissions[capability]) return permissions;
  throw failure('This staff account is not permitted to use Academic Management.', 403, 'ACADEMIC_ACCESS_FORBIDDEN');
}

function requireWritableSubscription(user = {}) {
  if (user.subscriptionActive === false) {
    throw failure(user.subscriptionMessage || 'The organisation subscription is not active.', 402, 'SUBSCRIPTION_REQUIRED');
  }
  if (user.subscriptionReadOnly === true) {
    throw failure(user.subscriptionMessage || 'Academic records are read-only during the payment grace period.', 403, 'SUBSCRIPTION_READ_ONLY');
  }
}

function scopedSection(input = {}, required = true) {
  const value = lower(input.SchoolSection || input.schoolSection || input.Section || input.section);
  if (!value && !required) return '';
  if (!['primary', 'secondary'].includes(value)) throw failure('Choose Primary or Secondary school section.');
  return value;
}

function assertUserSection(user = {}, section = '') {
  const assigned = lower(user.schoolSectionAccess || user.SchoolSectionAccess || 'all');
  if (assigned !== 'all' && section && assigned !== section) {
    throw failure('This staff account is restricted to another school section.', 403, 'ACADEMIC_SECTION_FORBIDDEN');
  }
}

async function academicScope(env, user = {}, input = {}, { requireSection = false } = {}) {
  const structure = await getSchoolStructure(env);
  const requestedBranch = clean(input.BranchId || input.branchId || user.branchId || user.BranchId);
  if (!requestedBranch || lower(requestedBranch) === 'all') {
    throw failure('Select one school branch before opening Academic Management.', 400, 'ACADEMIC_BRANCH_REQUIRED');
  }
  const branchId = enforceActorBranch(user, requestedBranch, '', structure.ActiveBranchId || 'main');
  const branch = structure.Branches.find((row) => lower(row.Id || row.id) === lower(branchId));
  if (!branch) throw failure('The selected branch is not configured for this school.', 403, 'ACADEMIC_BRANCH_FORBIDDEN');
  const section = scopedSection(input, requireSection);
  assertUserSection(user, section);
  return { branchId: safeScopeId(branchId), section, structure };
}

export function normalizeAcademicSession(input = {}, context = {}, existing = null) {
  const name = clean(input.Name || input.SessionName || input.AcademicSession);
  if (!name) throw failure('Enter the academic session name, for example 2026/2027.');
  const startDate = dateValue(input.StartDate, 'session start date');
  const endDate = dateValue(input.EndDate, 'session end date');
  assertDateOrder(startDate, endDate, 'Academic session');
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const sessionId = clean(existing?.SessionId || input.SessionId || input.RecordId) || academicId('session', branchId, name);
  return {
    ...(existing || {}), RecordId: sessionId, SessionId: sessionId, Name: name,
    StartDate: startDate, EndDate: endDate,
    Status: oneOf(input.Status, ACADEMIC_SESSION_STATUSES, existing?.Status || 'Planned'),
    BranchId: branchId, SchoolSection: 'all'
  };
}

export function normalizeAcademicTerm(input = {}, context = {}, existing = null) {
  const sessionId = clean(input.SessionId || existing?.SessionId);
  const name = clean(input.Name || input.TermName || input.Term);
  if (!sessionId) throw failure('Choose the academic session for this term.');
  if (!name) throw failure('Enter the term name.');
  const startDate = dateValue(input.StartDate, 'term start date');
  const endDate = dateValue(input.EndDate, 'term end date');
  assertDateOrder(startDate, endDate, 'Academic term');
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const termId = clean(existing?.TermId || input.TermId || input.RecordId) || academicId(sessionId, 'term', name);
  return {
    ...(existing || {}), RecordId: termId, TermId: termId, SessionId: sessionId, Name: name,
    StartDate: startDate, EndDate: endDate,
    Status: oneOf(input.Status, ACADEMIC_TERM_STATUSES, existing?.Status || 'Planned'),
    BranchId: branchId, SchoolSection: 'all'
  };
}

export function normalizeAcademicClass(input = {}, context = {}, existing = null) {
  const name = clean(input.Name || input.ClassName);
  if (!name) throw failure('Enter the class name.');
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection || existing?.SchoolSection });
  const classId = clean(existing?.ClassId || input.ClassId || input.RecordId) || academicId('class', branchId, section, name);
  return {
    ...(existing || {}), RecordId: classId, ClassId: classId, Name: name,
    Code: clean(input.Code || input.ClassCode || existing?.Code) || safeScopeId(name, 'class').toUpperCase(),
    Capacity: wholeNumber(input.Capacity, wholeNumber(existing?.Capacity, 0), 0, 10000),
    SortOrder: wholeNumber(input.SortOrder, wholeNumber(existing?.SortOrder, 100), 1, 10000),
    NextClassId: clean(input.NextClassId ?? existing?.NextClassId),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    LegacyDocumentId: clean(existing?.LegacyDocumentId) || legacyDocumentId(name),
    BranchId: branchId, SchoolSection: section
  };
}

export function normalizeAcademicArm(input = {}, context = {}, existing = null) {
  const classId = clean(input.ClassId || existing?.ClassId);
  const name = clean(input.Name || input.ArmName || input.ClassArm);
  if (!classId) throw failure('Choose the class for this arm.');
  if (!name) throw failure('Enter the arm name.');
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection || existing?.SchoolSection });
  const armId = clean(existing?.ArmId || input.ArmId || input.RecordId) || academicId(classId, 'arm', name);
  return {
    ...(existing || {}), RecordId: armId, ArmId: armId, ClassId: classId, Name: name,
    Capacity: wholeNumber(input.Capacity, wholeNumber(existing?.Capacity, 0), 0, 10000),
    Room: clean(input.Room ?? existing?.Room),
    SortOrder: wholeNumber(input.SortOrder, wholeNumber(existing?.SortOrder, 100), 1, 10000),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: section
  };
}

export function normalizeAcademicSubject(input = {}, context = {}, existing = null) {
  const name = clean(input.Name || input.SubjectName);
  const code = clean(input.Code || input.SubjectCode).toUpperCase();
  if (!name) throw failure('Enter the subject name.');
  if (!code) throw failure('Enter a stable subject code.');
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection || existing?.SchoolSection });
  const subjectId = clean(existing?.SubjectId || input.SubjectId || input.RecordId) || academicId('subject', branchId, section, code);
  return {
    ...(existing || {}), RecordId: subjectId, SubjectId: subjectId, Name: name, Code: code,
    Category: oneOf(input.Category, ACADEMIC_SUBJECT_CATEGORIES, existing?.Category || 'Core'),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: section
  };
}

export function normalizeAcademicOffering(input = {}, context = {}, existing = null) {
  const sessionId = clean(input.SessionId || existing?.SessionId);
  const termId = clean(input.TermId || existing?.TermId);
  const classId = clean(input.ClassId || existing?.ClassId);
  const armId = clean(input.ArmId ?? existing?.ArmId);
  const subjectId = clean(input.SubjectId || existing?.SubjectId);
  if (!sessionId || !termId || !classId || !subjectId) throw failure('Choose a session, term, class and subject for the offering.');
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection || existing?.SchoolSection });
  const offeringId = clean(existing?.OfferingId || input.OfferingId || input.RecordId)
    || academicId('offering', branchId, section, sessionId, termId, classId, armId || 'all-arms', subjectId);
  return {
    ...(existing || {}), RecordId: offeringId, OfferingId: offeringId,
    SessionId: sessionId, TermId: termId, ClassId: classId, ArmId: armId, SubjectId: subjectId,
    Compulsory: activeValue(input.Compulsory, activeValue(existing?.Compulsory, false)),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: section
  };
}

export function normalizeAcademicTeacherAllocation(input = {}, context = {}, existing = null) {
  const sessionId = clean(input.SessionId || existing?.SessionId);
  const termId = clean(input.TermId || existing?.TermId);
  const teacherUsername = lower(input.TeacherUsername || input.Username || existing?.TeacherUsername);
  const classId = clean(input.ClassId || existing?.ClassId);
  const armId = clean(input.ArmId ?? existing?.ArmId);
  const subjectId = clean(input.SubjectId || existing?.SubjectId);
  if (!sessionId || !termId || !teacherUsername || !classId || !subjectId) {
    throw failure('Choose a session, term, teacher, class and subject for this allocation.');
  }
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection || existing?.SchoolSection });
  const allocationId = clean(existing?.AllocationId || input.AllocationId || input.RecordId)
    || academicId('teacher', branchId, section, sessionId, termId, teacherUsername, classId, armId || 'all-arms', subjectId);
  return {
    ...(existing || {}), RecordId: allocationId, AllocationId: allocationId,
    SessionId: sessionId, TermId: termId, TeacherUsername: teacherUsername,
    ClassId: classId, ArmId: armId, SubjectId: subjectId,
    AllocationRole: oneOf(input.AllocationRole, ACADEMIC_TEACHER_ALLOCATION_ROLES, existing?.AllocationRole || 'Subject Teacher'),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: section
  };
}

export function normalizeAcademicStudentMembership(input = {}, context = {}, existing = null) {
  const sessionId = clean(input.SessionId || existing?.SessionId);
  const termId = clean(input.TermId || existing?.TermId);
  const studentRef = clean(input.StudentRef || input.AdmissionNo || existing?.StudentRef);
  const classId = clean(input.ClassId || existing?.ClassId);
  const armId = clean(input.ArmId || existing?.ArmId);
  if (!sessionId || !termId || !studentRef || !classId || !armId) {
    throw failure('Choose a session, term, student, class and arm for this membership.');
  }
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection || existing?.SchoolSection });
  const membershipId = clean(existing?.MembershipId || input.MembershipId || input.RecordId)
    || academicId('student', branchId, section, sessionId, termId, studentRef);
  return {
    ...(existing || {}), RecordId: membershipId, MembershipId: membershipId,
    SessionId: sessionId, TermId: termId, StudentRef: studentRef,
    ClassId: classId, ArmId: armId, SubjectIds: uniqueIds(input.SubjectIds ?? existing?.SubjectIds ?? []),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: section
  };
}

const RECORD_TYPES = Object.freeze({
  session: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.sessions, normalize: normalizeAcademicSession, capability: 'canManageStructure' },
  term: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.terms, normalize: normalizeAcademicTerm, capability: 'canManageStructure' },
  class: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.classes, normalize: normalizeAcademicClass, capability: 'canManageStructure' },
  arm: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.arms, normalize: normalizeAcademicArm, capability: 'canManageStructure' },
  subject: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.subjects, normalize: normalizeAcademicSubject, capability: 'canManageStructure' },
  offering: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.offerings, normalize: normalizeAcademicOffering, capability: 'canManageStructure' },
  teacherallocation: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.teacherAllocations, normalize: normalizeAcademicTeacherAllocation, capability: 'canManageAllocations' },
  studentmembership: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.studentMemberships, normalize: normalizeAcademicStudentMembership, capability: 'canManageAllocations' }
});

function normalizedRecordType(value) {
  return lower(value).replace(/[^a-z]/g, '');
}

async function loadAcademicState(env, branchId) {
  const collections = Object.entries(ACADEMIC_MANAGEMENT_COLLECTIONS).filter(([key]) => key !== 'audit');
  const groups = await Promise.all(collections.map(([, collection]) => listCollection(env, collection).catch(() => [])));
  return Object.fromEntries(collections.map(([key], index) => [
    key,
    groups[index].filter((row) => lower(row.BranchId || 'main') === lower(branchId))
  ]));
}

function findById(rows = [], id = '') {
  return rows.find((row) => lower(recordId(row)) === lower(id)) || null;
}

function studentReference(row = {}) {
  return clean(row.AdmissionNo || row.AccountRef || row.ApplicationReference || row.__id);
}

function assertReference(row, message) {
  if (!row || !statusActive(row)) throw failure(message, 409, 'ACADEMIC_REFERENCE_INVALID');
  return row;
}

function validateActiveConflict(state, type, record, existing) {
  if (!statusActive(record)) return;
  if (type === 'session') {
    const conflict = state.sessions.find((row) => statusActive(row) && lower(row.Status) === 'active' && recordId(row) !== recordId(existing || record));
    if (lower(record.Status) === 'active' && conflict) throw failure(`Close ${conflict.Name || 'the current session'} before activating another academic session.`, 409);
  }
  if (type === 'term') {
    const conflict = state.terms.find((row) => row.SessionId === record.SessionId && statusActive(row) && lower(row.Status) === 'active' && recordId(row) !== recordId(existing || record));
    if (lower(record.Status) === 'active' && conflict) throw failure(`Close ${conflict.Name || 'the current term'} before activating another term in this session.`, 409);
  }
}

function validateAcademicRecord(state, type, record, people = {}) {
  validateActiveConflict(state, type, record, people.existing);
  if (type === 'term') {
    const session = assertReference(findById(state.sessions, record.SessionId), 'The selected academic session is not active.');
    if (record.StartDate < session.StartDate || record.EndDate > session.EndDate) throw failure('Term dates must fall within the selected academic session.');
  }
  if (type === 'arm') {
    const schoolClass = assertReference(findById(state.classes, record.ClassId), 'The selected class is not active.');
    if (schoolClass.SchoolSection !== record.SchoolSection) throw failure('The class arm must belong to the same school section as its class.');
  }
  if (['offering', 'teacherallocation', 'studentmembership'].includes(type)) {
    const session = assertReference(findById(state.sessions, record.SessionId), 'The selected session is not active.');
    const term = assertReference(findById(state.terms, record.TermId), 'The selected term is not active.');
    const schoolClass = assertReference(findById(state.classes, record.ClassId), 'The selected class is not active.');
    if (term.SessionId !== session.SessionId) throw failure('The selected term does not belong to this academic session.');
    if (schoolClass.SchoolSection !== record.SchoolSection) throw failure('The selected class belongs to another school section.');
    if (record.ArmId) {
      const arm = assertReference(findById(state.arms, record.ArmId), 'The selected class arm is not active.');
      if (arm.ClassId !== record.ClassId) throw failure('The selected class arm does not belong to this class.');
    }
  }
  if (['offering', 'teacherallocation'].includes(type)) {
    const subject = assertReference(findById(state.subjects, record.SubjectId), 'The selected subject is not active.');
    if (subject.SchoolSection !== record.SchoolSection) throw failure('The selected subject belongs to another school section.');
  }
  if (type === 'teacherallocation') {
    const teacher = people.staff.find((row) => lower(row.Username || row.username || row.__id) === record.TeacherUsername);
    if (!teacher || !activeValue(teacher.Active, true)) throw failure('The selected teacher is not an active staff account in this branch.');
    const teacherSection = lower(teacher.SchoolSectionAccess || teacher.schoolSectionAccess || 'all');
    if (['primary', 'secondary'].includes(teacherSection) && teacherSection !== record.SchoolSection) {
      throw failure('The selected teacher is restricted to another school section.', 409, 'ACADEMIC_TEACHER_SECTION_INVALID');
    }
    const offering = state.offerings.find((row) => statusActive(row)
      && row.SessionId === record.SessionId && row.TermId === record.TermId
      && row.ClassId === record.ClassId && row.SubjectId === record.SubjectId
      && (!row.ArmId || !record.ArmId || row.ArmId === record.ArmId));
    if (!offering) throw failure('Offer this subject to the selected class or arm before allocating a teacher.');
  }
  if (type === 'studentmembership') {
    const student = people.students.find((row) => lower(studentReference(row)) === lower(record.StudentRef));
    if (!student) throw failure('The selected student was not found in this branch and school section.', 404);
    const offerings = state.offerings.filter((row) => statusActive(row)
      && row.SessionId === record.SessionId && row.TermId === record.TermId && row.ClassId === record.ClassId
      && (!row.ArmId || row.ArmId === record.ArmId));
    const available = new Set(offerings.map((row) => row.SubjectId));
    const compulsory = offerings.filter((row) => row.Compulsory === true).map((row) => row.SubjectId);
    record.SubjectIds = uniqueIds([...record.SubjectIds, ...compulsory]);
    if (offerings.length && !record.SubjectIds.length) throw failure('Choose at least one offered subject for this student.');
    const invalid = record.SubjectIds.filter((subjectId) => !available.has(subjectId));
    if (invalid.length) throw failure('One or more selected subjects are not offered to this class or arm.');
  }
}

function writePrecondition(existing, revisionToken) {
  if (!existing) return { exists: false };
  const expected = clean(revisionToken);
  if (!expected || expected !== clean(existing.__updateTime)) {
    throw failure('This academic record changed after it was loaded. Reload before saving.', 409, 'ACADEMIC_WRITE_CONFLICT');
  }
  return { updateTime: expected };
}

function auditWrite(user, action, type, record, details = '') {
  const id = `ACADEMIC-${Date.now()}-${globalThis.crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  return {
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.audit,
    documentId: id,
    exists: false,
    data: {
      AuditId: id, Timestamp: nowIso(), Action: clean(action).toUpperCase(), RecordType: type,
      RecordId: recordId(record), BranchId: record.BranchId, SchoolSection: record.SchoolSection,
      SessionId: clean(record.SessionId), TermId: clean(record.TermId),
      Actor: actorName(user), ActorUsername: actorUsername(user), ActorRole: clean(user.role || user.Role),
      Details: clean(details).slice(0, 1000)
    }
  };
}

function withoutMetadata(row = {}) {
  const copy = { ...row };
  ['__id', '__name', '__createTime', '__updateTime', '__scopePath', 'RevisionToken'].forEach((key) => delete copy[key]);
  return copy;
}

function legacyClassWrite(state, projectedRecord, type) {
  const schoolClass = type === 'class'
    ? projectedRecord
    : findById(state.classes, projectedRecord.ClassId);
  if (!schoolClass) return null;
  const projectedArms = type === 'arm'
    ? [...state.arms.filter((row) => recordId(row) !== recordId(projectedRecord)), projectedRecord]
    : state.arms;
  const arms = projectedArms.filter((row) => row.ClassId === schoolClass.ClassId && statusActive(row))
    .sort((a, b) => Number(a.SortOrder || 100) - Number(b.SortOrder || 100))
    .map((row) => clean(row.Name)).filter(Boolean);
  return {
    collectionPath: 'settings/academics/classes',
    documentId: clean(schoolClass.LegacyDocumentId) || legacyDocumentId(schoolClass.Name),
    data: {
      ClassName: schoolClass.Name,
      Arms: arms.join(', '),
      Active: statusActive(schoolClass) ? 'YES' : 'NO',
      SortOrder: Number(schoolClass.SortOrder || 100),
      UpdatedAt: nowIso(),
      UpdatedBy: 'Academic Management'
    }
  };
}

function studentCompatibilityWrite(people, state, record) {
  const student = people.students.find((row) => lower(studentReference(row)) === lower(record.StudentRef));
  const schoolClass = findById(state.classes, record.ClassId);
  const arm = findById(state.arms, record.ArmId);
  const session = findById(state.sessions, record.SessionId);
  const term = findById(state.terms, record.TermId);
  if (!student || !student.__scopePath || !student.__id || !student.__updateTime) return null;
  return {
    collectionPath: student.__scopePath,
    documentId: student.__id,
    updateTime: student.__updateTime,
    data: {
      ...withoutMetadata(student),
      ClassName: clean(schoolClass?.Name),
      ClassAdmitted: clean(schoolClass?.Name),
      ClassArm: clean(arm?.Name),
      AcademicSession: clean(session?.Name),
      Term: clean(term?.Name),
      UpdatedAt: nowIso(),
      UpdatedBy: 'Academic Management'
    }
  };
}

async function loadPeople(env, user, scope) {
  const [staff, students] = await Promise.all([
    listCollection(env, 'staffUsers'),
    listSchoolCollection(env, 'students', {
      branchId: scope.branchId,
      schoolSectionAccess: scope.section || user.schoolSectionAccess || 'All'
    })
  ]);
  return {
    staff: staff.filter((row) => staffRecordMatchesEdition(row, { ...user, edition: 'school' })
      && lower(row.BranchId || 'main') === lower(scope.branchId)),
    students
  };
}

function scopedRows(rows, scope) {
  if (!scope.section) return rows;
  return rows.filter((row) => !clean(row.SchoolSection) || row.SchoolSection === 'all' || lower(row.SchoolSection) === scope.section);
}

function displayStaff(rows = []) {
  return rows.map((row) => ({
    Username: clean(row.Username || row.username || row.__id),
    DisplayName: clean(row.DisplayName || row.displayName || row.Username || row.__id),
    Role: clean(row.Role || row.role),
    SchoolSectionAccess: clean(row.SchoolSectionAccess || row.schoolSectionAccess || 'All')
  })).sort((a, b) => a.DisplayName.localeCompare(b.DisplayName));
}

function displayStudents(rows = []) {
  return rows.map((row) => ({
    StudentRef: studentReference(row),
    StudentName: clean(row.DisplayName || row.ApplicantName || row.StudentName || studentReference(row)),
    ClassName: clean(row.ClassName), ClassArm: clean(row.ClassArm), SchoolSection: clean(row.SchoolSection)
  })).filter((row) => row.StudentRef).sort((a, b) => a.StudentName.localeCompare(b.StudentName));
}

function sortAcademicState(state) {
  const byName = (a, b) => clean(a.Name).localeCompare(clean(b.Name));
  const byOrder = (a, b) => Number(a.SortOrder || 100) - Number(b.SortOrder || 100) || byName(a, b);
  return {
    sessions: [...state.sessions].sort((a, b) => clean(b.StartDate).localeCompare(clean(a.StartDate))),
    terms: [...state.terms].sort((a, b) => clean(a.StartDate).localeCompare(clean(b.StartDate))),
    classes: [...state.classes].sort(byOrder), arms: [...state.arms].sort(byOrder),
    subjects: [...state.subjects].sort(byName), offerings: [...state.offerings].sort((a, b) => clean(a.ClassId).localeCompare(clean(b.ClassId)) || clean(a.SubjectId).localeCompare(clean(b.SubjectId))),
    teacherAllocations: [...state.teacherAllocations].sort((a, b) => clean(a.TeacherUsername).localeCompare(clean(b.TeacherUsername))),
    studentMemberships: [...state.studentMemberships].sort((a, b) => clean(a.StudentRef).localeCompare(clean(b.StudentRef)))
  };
}

function currentSelection(state, input = {}) {
  const session = findById(state.sessions, input.SessionId)
    || state.sessions.find((row) => lower(row.Status) === 'active') || state.sessions.find(statusActive) || null;
  const terms = state.terms.filter((row) => !session || row.SessionId === session.SessionId);
  const term = findById(terms, input.TermId) || terms.find((row) => lower(row.Status) === 'active') || terms.find(statusActive) || null;
  return { SessionId: clean(session?.SessionId), TermId: clean(term?.TermId) };
}

export async function bootstrapAcademicManagement(env, user = {}, input = {}) {
  const permissions = requireCapability(user, 'enabled');
  const scope = await academicScope(env, user, input, { requireSection: false });
  const [rawState, people, audit] = await Promise.all([
    loadAcademicState(env, scope.branchId),
    loadPeople(env, user, scope),
    permissions.canManageStructure
      ? listCollection(env, ACADEMIC_MANAGEMENT_COLLECTIONS.audit).catch(() => [])
      : Promise.resolve([])
  ]);
  let state = Object.fromEntries(Object.entries(rawState).map(([key, rows]) => [key, scopedRows(rows, scope)]));
  let students = people.students;
  if (permissions.teacherView) {
    const username = actorUsername(user);
    state.teacherAllocations = state.teacherAllocations.filter((row) => lower(row.TeacherUsername) === username);
    const visibleKeys = new Set(state.teacherAllocations.map((row) => `${row.ClassId}|${row.ArmId || '*'}`));
    state.studentMemberships = state.studentMemberships.filter((row) => (
      visibleKeys.has(`${row.ClassId}|${row.ArmId}`) || visibleKeys.has(`${row.ClassId}|*`)
    ));
    const visibleStudents = new Set(state.studentMemberships.map((row) => lower(row.StudentRef)));
    students = students.filter((row) => visibleStudents.has(lower(studentReference(row))));
  }
  state = sortAcademicState(state);
  const selection = currentSelection(state, input);
  return {
    ok: true,
    message: 'Academic structure and allocations loaded.',
    permissions,
    scope: { BranchId: scope.branchId, SchoolSection: scope.section || 'all' },
    sections: scope.structure.Sections,
    selection,
    ...Object.fromEntries(Object.entries(state).map(([key, rows]) => [key, rows.map(publicRecord)])),
    staff: displayStaff(permissions.teacherView ? people.staff.filter((row) => lower(row.Username || row.__id) === actorUsername(user)) : people.staff),
    students: displayStudents(students),
    audit: audit.filter((row) => lower(row.BranchId || 'main') === lower(scope.branchId))
      .sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp))).slice(0, 100).map(publicRecord),
    summary: {
      Sessions: state.sessions.filter(statusActive).length,
      Classes: state.classes.filter(statusActive).length,
      Arms: state.arms.filter(statusActive).length,
      Subjects: state.subjects.filter(statusActive).length,
      TeacherAllocations: state.teacherAllocations.filter(statusActive).length,
      StudentMemberships: state.studentMemberships.filter(statusActive).length
    }
  };
}

export async function saveAcademicManagementRecord(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  const type = normalizedRecordType(input.RecordType || input.recordType || input.Type);
  const definition = RECORD_TYPES[type];
  if (!definition) throw failure('Choose a valid academic record type.');
  requireCapability(user, definition.capability);
  const requiresSection = !['session', 'term'].includes(type);
  const scope = await academicScope(env, user, input, { requireSection: requiresSection });
  const [state, people] = await Promise.all([loadAcademicState(env, scope.branchId), loadPeople(env, user, scope)]);
  const requestedId = clean(input.RecordId || input.recordId);
  const existing = requestedId ? findById(state[Object.keys(ACADEMIC_MANAGEMENT_COLLECTIONS).find((key) => ACADEMIC_MANAGEMENT_COLLECTIONS[key] === definition.collection)] || [], requestedId) : null;
  if (requestedId && !existing) throw failure('The academic record was not found in the selected branch.', 404);
  if (existing && requiresSection && lower(existing.SchoolSection) !== scope.section) throw failure('This academic record belongs to another school section.', 403);
  const record = definition.normalize(input, scope, existing);
  validateAcademicRecord(state, type, record, { ...people, existing });
  const timestamp = nowIso();
  record.CreatedAt = clean(existing?.CreatedAt) || timestamp;
  record.CreatedBy = clean(existing?.CreatedBy) || actorName(user);
  record.UpdatedAt = timestamp;
  record.UpdatedBy = actorName(user);
  const precondition = writePrecondition(existing, input.RevisionToken);
  const writes = [{ collectionPath: definition.collection, documentId: recordId(record), data: withoutMetadata(record), ...precondition }];
  writes.push(auditWrite(user, existing ? 'UPDATE' : 'CREATE', type, record, clean(record.Name || record.StudentRef || record.TeacherUsername)));
  if (['class', 'arm'].includes(type)) {
    const compatibility = legacyClassWrite(state, record, type);
    if (compatibility) writes.push(compatibility);
  }
  if (type === 'studentmembership') {
    const projected = { ...state, studentMemberships: [...state.studentMemberships.filter((row) => recordId(row) !== recordId(record)), record] };
    const compatibility = studentCompatibilityWrite(people, projected, record);
    if (compatibility) writes.push(compatibility);
  }
  try {
    await batchCommitDocuments(env, writes);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status))) {
      throw failure('This academic record changed while it was being saved. Reload and try again.', 409, 'ACADEMIC_WRITE_CONFLICT');
    }
    throw error;
  }
  return bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
}

function activeDependants(state, type, record) {
  const id = recordId(record);
  if (type === 'session') return [...state.terms, ...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.SessionId === id && statusActive(row));
  if (type === 'term') return [...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.TermId === id && statusActive(row));
  if (type === 'class') return [...state.arms, ...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.ClassId === id && statusActive(row));
  if (type === 'arm') return [...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.ArmId === id && statusActive(row));
  if (type === 'subject') return [...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => (row.SubjectId === id || (row.SubjectIds || []).includes(id)) && statusActive(row));
  if (type === 'offering') return [...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.SessionId === record.SessionId && row.TermId === record.TermId && row.ClassId === record.ClassId && (row.SubjectId === record.SubjectId || (row.SubjectIds || []).includes(record.SubjectId)) && statusActive(row));
  return [];
}

export async function archiveAcademicManagementRecord(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  const type = normalizedRecordType(input.RecordType || input.recordType || input.Type);
  const definition = RECORD_TYPES[type];
  if (!definition) throw failure('Choose a valid academic record type.');
  requireCapability(user, ['teacherallocation', 'studentmembership'].includes(type) ? 'canManageAllocations' : 'canArchive');
  const requiresSection = !['session', 'term'].includes(type);
  const scope = await academicScope(env, user, input, { requireSection: requiresSection });
  const state = await loadAcademicState(env, scope.branchId);
  const stateKey = Object.keys(ACADEMIC_MANAGEMENT_COLLECTIONS).find((key) => ACADEMIC_MANAGEMENT_COLLECTIONS[key] === definition.collection);
  const existing = findById(state[stateKey] || [], input.RecordId);
  if (!existing) throw failure('The academic record was not found in the selected branch.', 404);
  if (requiresSection && lower(existing.SchoolSection) !== scope.section) throw failure('This academic record belongs to another school section.', 403);
  const dependants = activeDependants(state, type, existing);
  if (dependants.length) throw failure(`Archive the ${dependants.length} active dependent record${dependants.length === 1 ? '' : 's'} first.`, 409, 'ACADEMIC_DEPENDANTS_ACTIVE');
  const revisionToken = clean(input.RevisionToken);
  if (!revisionToken || revisionToken !== clean(existing.__updateTime)) throw failure('This academic record changed after it was loaded. Reload before archiving.', 409, 'ACADEMIC_WRITE_CONFLICT');
  const archived = {
    ...withoutMetadata(existing), Status: 'Archived', ArchivedAt: nowIso(), ArchivedBy: actorName(user),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user)
  };
  const writes = [
    { collectionPath: definition.collection, documentId: recordId(existing), data: archived, updateTime: revisionToken },
    auditWrite(user, 'ARCHIVE', type, archived, clean(existing.Name || existing.StudentRef || existing.TeacherUsername))
  ];
  if (['class', 'arm'].includes(type)) {
    const compatibility = legacyClassWrite(state, archived, type);
    if (compatibility) writes.push(compatibility);
  }
  await batchCommitDocuments(env, writes);
  return bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
}

export async function handleAcademicManagementAction(env, user = {}, input = {}) {
  const action = lower(input.action || input.Action).replace(/[^a-z]/g, '');
  if (['bootstrap', 'list', 'getacademicmanagement'].includes(action)) return bootstrapAcademicManagement(env, user, input);
  if (['save', 'saverecord', 'saveacademicsession', 'saveacademicterm', 'saveacademicclass', 'saveacademicarm', 'saveacademicsubject', 'saveacademicoffering', 'saveacademicteacherallocation', 'saveacademicstudentmembership'].includes(action)) {
    const inferredType = ({
      saveacademicsession: 'session', saveacademicterm: 'term', saveacademicclass: 'class', saveacademicarm: 'arm',
      saveacademicsubject: 'subject', saveacademicoffering: 'offering', saveacademicteacherallocation: 'teacherAllocation',
      saveacademicstudentmembership: 'studentMembership'
    })[action];
    return saveAcademicManagementRecord(env, user, { ...input, RecordType: input.RecordType || inferredType });
  }
  if (['archive', 'archiverecord', 'archiveacademicrecord'].includes(action)) return archiveAcademicManagementRecord(env, user, input);
  throw failure('Choose a valid Academic Management action.');
}
