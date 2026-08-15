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
  departments: 'academicDepartments',
  offerings: 'academicSubjectOfferings',
  teacherAllocations: 'academicTeacherAllocations',
  studentMemberships: 'academicStudentMemberships',
  studentMovements: 'academicStudentMovements',
  audit: 'academicManagementAudit'
});

export const ACADEMIC_SESSION_STATUSES = Object.freeze(['Planned', 'Active', 'Closed', 'Archived']);
export const ACADEMIC_TERM_STATUSES = Object.freeze(['Planned', 'Active', 'Closed', 'Archived']);
export const ACADEMIC_RECORD_STATUSES = Object.freeze(['Active', 'Inactive', 'Archived']);
export const ACADEMIC_MEMBERSHIP_STATUSES = Object.freeze(['Active', 'Inactive', 'Withdrawn', 'Archived']);
export const ACADEMIC_STUDENT_MOVEMENT_TYPES = Object.freeze([
  'Allocation', 'Class Transfer', 'Arm Transfer', 'Department Change', 'Subject Change', 'Withdrawal', 'Reinstatement'
]);
export const ACADEMIC_SUBJECT_CATEGORIES = Object.freeze(['Core', 'Elective', 'Vocational', 'Co-curricular']);
export const ACADEMIC_SCHOOL_STAGES = Object.freeze(['primary', 'junior-secondary', 'senior-secondary']);
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

function schoolStageValue(value, section = '', className = '') {
  if (lower(section) === 'primary') return 'primary';
  const wanted = lower(value).replace(/[\s_]+/g, '-');
  if (['junior', 'jss', 'junior-secondary'].includes(wanted)) return 'junior-secondary';
  if (['senior', 'sss', 'senior-secondary'].includes(wanted)) return 'senior-secondary';
  const name = lower(className);
  if (/\b(jss|junior)(?:[\s_-]*\d+)?\b/.test(name)) return 'junior-secondary';
  if (/\b(sss?|senior)(?:[\s_-]*\d+)?\b/.test(name)) return 'senior-secondary';
  return '';
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
    row.RecordId || row.recordId || row.MovementId || row.MembershipId || row.AllocationId || row.OfferingId
      || row.DepartmentId || row.SubjectId || row.ArmId || row.ClassId || row.TermId || row.SessionId || row.__id
  );
}

function statusActive(row = {}) {
  return !['archived', 'inactive', 'closed', 'withdrawn'].includes(lower(row.Status));
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
  const schoolStage = schoolStageValue(input.SchoolStage || input.SecondaryDivision || existing?.SchoolStage, section, name);
  if (section === 'secondary' && !schoolStage) throw failure('Choose Junior Secondary or Senior Secondary for this class.');
  const classId = clean(existing?.ClassId || input.ClassId || input.RecordId) || academicId('class', branchId, section, name);
  return {
    ...(existing || {}), RecordId: classId, ClassId: classId, Name: name,
    Code: clean(input.Code || input.ClassCode || existing?.Code) || safeScopeId(name, 'class').toUpperCase(),
    Capacity: wholeNumber(input.Capacity, wholeNumber(existing?.Capacity, 0), 0, 10000),
    SortOrder: wholeNumber(input.SortOrder, wholeNumber(existing?.SortOrder, 100), 1, 10000),
    NextClassId: clean(input.NextClassId ?? existing?.NextClassId),
    SchoolStage: schoolStage,
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    LegacyDocumentId: clean(existing?.LegacyDocumentId) || legacyDocumentId(name),
    BranchId: branchId, SchoolSection: section
  };
}

export function normalizeAcademicDepartment(input = {}, context = {}, existing = null) {
  const name = clean(input.Name || input.DepartmentName);
  const code = clean(input.Code || input.DepartmentCode).toUpperCase();
  if (!name) throw failure('Enter the senior secondary department name.');
  if (!code) throw failure('Enter a stable department code.');
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection || existing?.SchoolSection });
  if (section !== 'secondary') throw failure('Academic departments are available only in Secondary school.');
  const departmentId = clean(existing?.DepartmentId || input.DepartmentId || input.RecordId)
    || academicId('department', branchId, 'senior-secondary', code);
  return {
    ...(existing || {}), RecordId: departmentId, DepartmentId: departmentId,
    Name: name, Code: code,
    CoreSubjectIds: uniqueIds(input.CoreSubjectIds ?? existing?.CoreSubjectIds ?? []),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: 'secondary', SchoolStage: 'senior-secondary'
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
    ClassId: classId, ArmId: armId, DepartmentId: clean(input.DepartmentId ?? existing?.DepartmentId),
    SubjectIds: uniqueIds(input.SubjectIds ?? existing?.SubjectIds ?? []),
    Status: oneOf(input.Status, ACADEMIC_MEMBERSHIP_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: section
  };
}

const RECORD_TYPES = Object.freeze({
  session: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.sessions, normalize: normalizeAcademicSession, capability: 'canManageStructure' },
  term: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.terms, normalize: normalizeAcademicTerm, capability: 'canManageStructure' },
  class: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.classes, normalize: normalizeAcademicClass, capability: 'canManageStructure' },
  arm: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.arms, normalize: normalizeAcademicArm, capability: 'canManageStructure' },
  subject: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.subjects, normalize: normalizeAcademicSubject, capability: 'canManageStructure' },
  department: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.departments, normalize: normalizeAcademicDepartment, capability: 'canManageStructure' },
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

export function applyAcademicStudentCurriculum(state = {}, record = {}) {
  const offerings = (state.offerings || []).filter((row) => statusActive(row)
    && row.SessionId === record.SessionId && row.TermId === record.TermId && row.ClassId === record.ClassId
    && (!row.ArmId || row.ArmId === record.ArmId));
  const available = new Set(offerings.map((row) => row.SubjectId));
  const compulsory = offerings.filter((row) => row.Compulsory === true).map((row) => row.SubjectId);
  if (!offerings.length) throw failure('Offer subjects to this class or arm before allocating students.');
  if (record.SchoolStage === 'junior-secondary') {
    record.DepartmentId = '';
    record.SubjectIds = [...available];
  } else if (record.SchoolStage === 'senior-secondary') {
    const department = assertReference(findById(state.departments || [], record.DepartmentId), 'Choose an active senior secondary department for this student.');
    if (department.SchoolStage !== 'senior-secondary') throw failure('The selected department is not a Senior Secondary department.');
    const missingCore = (department.CoreSubjectIds || []).filter((subjectId) => !available.has(subjectId));
    if (missingCore.length) throw failure('Offer every department core subject to this senior class before allocating students.');
    record.SubjectIds = uniqueIds([...record.SubjectIds, ...compulsory, ...(department.CoreSubjectIds || [])]);
  } else {
    record.DepartmentId = '';
    record.SubjectIds = uniqueIds([...record.SubjectIds, ...compulsory]);
  }
  if (!record.SubjectIds.length) throw failure('Choose at least one offered subject for this student.');
  const invalid = record.SubjectIds.filter((subjectId) => !available.has(subjectId));
  if (invalid.length) throw failure('One or more selected subjects are not offered to this class or arm.');
  return record;
}

function sortedIds(value) {
  return uniqueIds(value).sort((a, b) => a.localeCompare(b));
}

function membershipMateriallyChanged(before = {}, after = {}) {
  return ['ClassId', 'ArmId', 'DepartmentId', 'Status'].some((key) => clean(before[key]) !== clean(after[key]))
    || JSON.stringify(sortedIds(before.SubjectIds)) !== JSON.stringify(sortedIds(after.SubjectIds));
}

function membershipSnapshot(record = {}, prefix = '') {
  return {
    [`${prefix}ClassId`]: clean(record.ClassId),
    [`${prefix}ArmId`]: clean(record.ArmId),
    [`${prefix}DepartmentId`]: clean(record.DepartmentId),
    [`${prefix}SubjectIds`]: uniqueIds(record.SubjectIds)
  };
}

function movementType(before, after, operation = '') {
  const requested = lower(operation);
  if (requested === 'withdraw') return 'Withdrawal';
  if (requested === 'reinstate') return 'Reinstatement';
  if (!before) return 'Allocation';
  if (before.ClassId !== after.ClassId) return 'Class Transfer';
  if (before.ArmId !== after.ArmId) return 'Arm Transfer';
  if (before.DepartmentId !== after.DepartmentId) return 'Department Change';
  return 'Subject Change';
}

export function normalizeAcademicStudentMovement(input = {}, context = {}, before = null, after = null) {
  const branchId = safeScopeId(context.branchId || input.BranchId || before?.BranchId || after?.BranchId);
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection || before?.SchoolSection || after?.SchoolSection });
  const studentRef = clean(input.StudentRef || before?.StudentRef || after?.StudentRef);
  const sessionId = clean(input.SessionId || before?.SessionId || after?.SessionId);
  const termId = clean(input.TermId || before?.TermId || after?.TermId);
  if (!studentRef || !sessionId || !termId) throw failure('Student, session and term are required for an academic movement.');
  const type = oneOf(input.MovementType || movementType(before, after, input.Operation), ACADEMIC_STUDENT_MOVEMENT_TYPES, 'Allocation');
  const effectiveDate = dateValue(input.EffectiveDate || nowIso().slice(0, 10), 'movement effective date');
  const reason = clean(input.Reason || input.MovementReason);
  if (type !== 'Allocation' && !reason) throw failure('Enter the reason for this student movement.');
  const token = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const movementId = clean(input.MovementId) || academicId('movement', branchId, section, sessionId, termId, studentRef, token);
  return {
    RecordId: movementId, MovementId: movementId, MovementType: type,
    StudentRef: studentRef, SessionId: sessionId, TermId: termId,
    ...membershipSnapshot(before || {}, 'From'),
    ...membershipSnapshot(after || {}, 'To'),
    EffectiveDate: effectiveDate, Reason: reason,
    BranchId: branchId, SchoolSection: section, Status: 'Applied'
  };
}

function academicMovementForState(state, input, context, before = null, after = null) {
  const termId = clean(input.TermId || before?.TermId || after?.TermId);
  const term = assertReference(findById(state.terms || [], termId), 'The selected term is not active.');
  const effectiveDate = clean(input.EffectiveDate) || clean(term.StartDate) || nowIso().slice(0, 10);
  if (term.StartDate && effectiveDate < term.StartDate) throw failure('Movement date cannot be before the selected term starts.');
  if (term.EndDate && effectiveDate > term.EndDate) throw failure('Movement date cannot be after the selected term ends.');
  return normalizeAcademicStudentMovement({ ...input, EffectiveDate: effectiveDate }, context, before, after);
}

export function assertAcademicMembershipCapacity(state = {}, record = {}, excludeMembershipId = '') {
  if (!statusActive(record)) return { ClassCount: 0, ClassCapacity: 0, ArmCount: 0, ArmCapacity: 0 };
  const activeMemberships = (state.studentMemberships || []).filter((row) => statusActive(row)
    && recordId(row) !== clean(excludeMembershipId)
    && row.SessionId === record.SessionId && row.TermId === record.TermId);
  const schoolClass = assertReference(findById(state.classes || [], record.ClassId), 'The selected class is not active.');
  const classCapacity = wholeNumber(schoolClass.Capacity, 0, 0, 10000);
  const classCount = activeMemberships.filter((row) => row.ClassId === record.ClassId).length;
  if (classCapacity && classCount >= classCapacity) {
    throw failure(`${schoolClass.Name || 'The selected class'} has reached its configured capacity.`, 409, 'ACADEMIC_CLASS_CAPACITY_REACHED');
  }
  const arm = assertReference(findById(state.arms || [], record.ArmId), 'The selected class arm is not active.');
  const armCapacity = wholeNumber(arm.Capacity, 0, 0, 10000);
  const armCount = activeMemberships.filter((row) => row.ClassId === record.ClassId && row.ArmId === record.ArmId).length;
  if (armCapacity && armCount >= armCapacity) {
    throw failure(`${arm.Name || 'The selected arm'} has reached its configured capacity.`, 409, 'ACADEMIC_ARM_CAPACITY_REACHED');
  }
  return { ClassCount: classCount, ClassCapacity: classCapacity, ArmCount: armCount, ArmCapacity: armCapacity };
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
  if (type === 'class') {
    if (record.NextClassId) {
      if (record.NextClassId === record.ClassId) throw failure('A class cannot be its own next class.');
      const nextClass = assertReference(findById(state.classes, record.NextClassId), 'The selected next class is not active.');
      if (nextClass.SchoolSection !== record.SchoolSection) throw failure('The next class must belong to the same school section.');
      const visited = new Set([record.ClassId]);
      let cursor = nextClass;
      while (cursor) {
        if (visited.has(cursor.ClassId)) throw failure('The next-class sequence cannot contain a cycle.');
        visited.add(cursor.ClassId);
        cursor = cursor.NextClassId ? findById(state.classes, cursor.NextClassId) : null;
      }
    }
    const capacity = wholeNumber(record.Capacity, 0, 0, 10000);
    const periodCounts = new Map();
    state.studentMemberships.filter((row) => statusActive(row) && row.ClassId === record.ClassId).forEach((row) => {
      const key = `${row.SessionId}|${row.TermId}`;
      periodCounts.set(key, (periodCounts.get(key) || 0) + 1);
    });
    const highestEnrollment = Math.max(0, ...periodCounts.values());
    if (capacity && highestEnrollment > capacity) throw failure(`Class capacity cannot be below its current enrollment of ${highestEnrollment}.`, 409);
  }
  if (type === 'arm') {
    const capacity = wholeNumber(record.Capacity, 0, 0, 10000);
    const periodCounts = new Map();
    state.studentMemberships.filter((row) => statusActive(row) && row.ArmId === record.ArmId).forEach((row) => {
      const key = `${row.SessionId}|${row.TermId}`;
      periodCounts.set(key, (periodCounts.get(key) || 0) + 1);
    });
    const highestEnrollment = Math.max(0, ...periodCounts.values());
    if (capacity && highestEnrollment > capacity) throw failure(`Arm capacity cannot be below its current enrollment of ${highestEnrollment}.`, 409);
  }
  if (type === 'department') {
    if (!record.CoreSubjectIds.length) throw failure('Assign at least one core subject to this senior secondary department.');
    const invalidSubjects = record.CoreSubjectIds.filter((subjectId) => {
      const subject = findById(state.subjects, subjectId);
      return !subject || !statusActive(subject) || subject.SchoolSection !== 'secondary';
    });
    if (invalidSubjects.length) throw failure('Every department core subject must be an active Secondary subject.');
  }
  if (['offering', 'teacherallocation', 'studentmembership'].includes(type)) {
    const session = assertReference(findById(state.sessions, record.SessionId), 'The selected session is not active.');
    const term = assertReference(findById(state.terms, record.TermId), 'The selected term is not active.');
    const schoolClass = assertReference(findById(state.classes, record.ClassId), 'The selected class is not active.');
    if (term.SessionId !== session.SessionId) throw failure('The selected term does not belong to this academic session.');
    if (schoolClass.SchoolSection !== record.SchoolSection) throw failure('The selected class belongs to another school section.');
    record.SchoolStage = schoolStageValue(schoolClass.SchoolStage, schoolClass.SchoolSection, schoolClass.Name);
    if (schoolClass.SchoolSection === 'secondary' && !record.SchoolStage) {
      throw failure('Classify this class as Junior Secondary or Senior Secondary before using it for allocations.');
    }
    if (record.ArmId) {
      const arm = assertReference(findById(state.arms, record.ArmId), 'The selected class arm is not active.');
      if (arm.ClassId !== record.ClassId) throw failure('The selected class arm does not belong to this class.');
    }
  }
  if (['offering', 'teacherallocation'].includes(type)) {
    const subject = assertReference(findById(state.subjects, record.SubjectId), 'The selected subject is not active.');
    if (subject.SchoolSection !== record.SchoolSection) throw failure('The selected subject belongs to another school section.');
  }
  if (type === 'offering' && record.SchoolStage === 'junior-secondary') {
    record.Compulsory = true;
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
    applyAcademicStudentCurriculum(state, record);
    assertAcademicMembershipCapacity(state, record, recordId(people.existing || {}));
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

function movementWrite(user, movement) {
  const recordedAt = nowIso();
  return {
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentMovements,
    documentId: movement.MovementId,
    exists: false,
    data: {
      ...withoutMetadata(movement), RecordedAt: recordedAt,
      RecordedBy: actorName(user), RecordedByUsername: actorUsername(user), RecordedByRole: clean(user.role || user.Role)
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
      SchoolStage: schoolClass.SchoolStage,
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
  const department = findById(state.departments, record.DepartmentId);
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
      AcademicClassId: clean(record.ClassId),
      AcademicArmId: clean(record.ArmId),
      AcademicMembershipId: clean(record.MembershipId),
      AcademicEnrollmentStatus: clean(record.Status),
      SchoolStage: clean(record.SchoolStage || schoolClass?.SchoolStage),
      AcademicDepartmentId: clean(record.DepartmentId),
      AcademicDepartment: clean(department?.Name),
      AcademicDepartmentCode: clean(department?.Code),
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
    subjects: [...state.subjects].sort(byName), departments: [...state.departments].sort(byName),
    offerings: [...state.offerings].sort((a, b) => clean(a.ClassId).localeCompare(clean(b.ClassId)) || clean(a.SubjectId).localeCompare(clean(b.SubjectId))),
    teacherAllocations: [...state.teacherAllocations].sort((a, b) =>
      clean(a.TeacherUsername).localeCompare(clean(b.TeacherUsername))
      || clean(a.ClassId).localeCompare(clean(b.ClassId))
      || clean(a.ArmId).localeCompare(clean(b.ArmId))
      || clean(a.SubjectId).localeCompare(clean(b.SubjectId))),
    studentMemberships: [...state.studentMemberships].sort((a, b) => clean(a.StudentRef).localeCompare(clean(b.StudentRef))),
    studentMovements: [...state.studentMovements].sort((a, b) => clean(b.RecordedAt || b.EffectiveDate).localeCompare(clean(a.RecordedAt || a.EffectiveDate)))
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
    state.studentMovements = state.studentMovements.filter((row) => visibleStudents.has(lower(row.StudentRef)));
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
      Departments: state.departments.filter(statusActive).length,
      TeacherAllocations: state.teacherAllocations.filter(statusActive).length,
      StudentMemberships: state.studentMemberships.filter(statusActive).length,
      StudentMovements: state.studentMovements.length
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
  const normalizedInput = type === 'studentmembership' && !existing ? { ...input, Status: 'Active' } : input;
  const record = definition.normalize(normalizedInput, scope, existing);
  validateAcademicRecord(state, type, record, { ...people, existing });
  if (type === 'studentmembership' && existing && membershipMateriallyChanged(existing, record)) {
    throw failure('Use the transfer, curriculum-change, withdrawal or reinstatement workflow so this membership change is preserved in history.', 409, 'ACADEMIC_MOVEMENT_REQUIRED');
  }
  const timestamp = nowIso();
  record.CreatedAt = clean(existing?.CreatedAt) || timestamp;
  record.CreatedBy = clean(existing?.CreatedBy) || actorName(user);
  record.UpdatedAt = timestamp;
  record.UpdatedBy = actorName(user);
  const precondition = writePrecondition(existing, input.RevisionToken);
  const writes = [{ collectionPath: definition.collection, documentId: recordId(record), data: withoutMetadata(record), ...precondition }];
  writes.push(auditWrite(user, existing ? 'UPDATE' : 'CREATE', type, record, clean(record.Name || record.StudentRef || record.TeacherUsername)));
  if (type === 'studentmembership' && !existing) {
    writes.push(movementWrite(user, academicMovementForState(state, input, scope, null, record)));
  }
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

function uniqueStudentReferences(value) {
  const supplied = Array.isArray(value) ? value : clean(value).split(',');
  const seen = new Set();
  return supplied.map(clean).filter((reference) => {
    const key = lower(reference);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stampAcademicRecord(record, user, existing = null) {
  const timestamp = nowIso();
  record.CreatedAt = clean(existing?.CreatedAt) || timestamp;
  record.CreatedBy = clean(existing?.CreatedBy) || actorName(user);
  record.UpdatedAt = timestamp;
  record.UpdatedBy = actorName(user);
  return record;
}

export async function bulkAllocateAcademicStudents(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageAllocations');
  const scope = await academicScope(env, user, input, { requireSection: true });
  const studentRefs = uniqueStudentReferences(input.StudentRefs || input.StudentRef);
  if (!studentRefs.length) throw failure('Choose at least one student for bulk allocation.');
  if (studentRefs.length > 100) throw failure('Allocate at most 100 students in one batch.');
  const [state, people] = await Promise.all([loadAcademicState(env, scope.branchId), loadPeople(env, user, scope)]);
  const projected = { ...state, studentMemberships: [...state.studentMemberships] };
  const writes = [];
  const skipped = [];
  for (const studentRef of studentRefs) {
    const existingId = academicId('student', scope.branchId, scope.section, input.SessionId, input.TermId, studentRef);
    const existing = findById(projected.studentMemberships, existingId);
    const record = normalizeAcademicStudentMembership({ ...input, StudentRef, Status: 'Active' }, scope, existing);
    validateAcademicRecord(projected, 'studentmembership', record, { ...people, existing });
    if (existing) {
      if (!membershipMateriallyChanged(existing, record)) {
        skipped.push(studentRef);
        continue;
      }
      throw failure(`${studentRef} already has a different membership in this term. Use the transfer workflow instead.`, 409, 'ACADEMIC_BULK_MEMBERSHIP_CONFLICT');
    }
    stampAcademicRecord(record, user);
    projected.studentMemberships.push(record);
    writes.push({
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentMemberships,
      documentId: record.MembershipId, data: withoutMetadata(record), exists: false
    });
    writes.push(movementWrite(user, academicMovementForState(projected, { ...input, StudentRef }, scope, null, record)));
    const compatibility = studentCompatibilityWrite(people, projected, record);
    if (compatibility) writes.push(compatibility);
  }
  const created = studentRefs.length - skipped.length;
  if (created) {
    writes.push(auditWrite(user, 'BULK ALLOCATE', 'studentmembership', {
      BranchId: scope.branchId, SchoolSection: scope.section,
      SessionId: clean(input.SessionId), TermId: clean(input.TermId),
      MembershipId: `bulk-${Date.now()}`
    }, `${created} student(s) allocated; ${skipped.length} already matched.`));
    try {
      await batchCommitDocuments(env, writes);
    } catch (error) {
      if ([409, 412].includes(Number(error?.status))) {
        throw failure('A selected student changed while the batch was being saved. Reload and try again.', 409, 'ACADEMIC_WRITE_CONFLICT');
      }
      throw error;
    }
  }
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = created
    ? `${created} student${created === 1 ? '' : 's'} allocated online${skipped.length ? `; ${skipped.length} already matched and were skipped` : ''}.`
    : 'Every selected student already has this exact allocation.';
  response.bulkResult = { Requested: studentRefs.length, Created: created, Skipped: skipped.length };
  return response;
}

export async function manageAcademicStudentMembership(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageAllocations');
  const scope = await academicScope(env, user, input, { requireSection: true });
  const [state, people] = await Promise.all([loadAcademicState(env, scope.branchId), loadPeople(env, user, scope)]);
  const existing = findById(state.studentMemberships, input.RecordId || input.MembershipId);
  if (!existing) throw failure('The selected student membership was not found.', 404);
  if (lower(existing.SchoolSection) !== scope.section) throw failure('This membership belongs to another school section.', 403);
  const expected = clean(input.RevisionToken);
  if (!expected || expected !== clean(existing.__updateTime)) {
    throw failure('This student membership changed after it was loaded. Reload before continuing.', 409, 'ACADEMIC_WRITE_CONFLICT');
  }
  const operation = lower(input.Operation || input.MovementOperation || 'transfer').replace(/[^a-z]/g, '');
  if (!['transfer', 'move', 'change', 'withdraw', 'withdrawal', 'reinstate', 'reinstatement'].includes(operation)) {
    throw failure('Choose transfer, withdrawal or reinstatement for this student movement.');
  }
  const reason = clean(input.Reason || input.MovementReason);
  if (!reason) throw failure('Enter the reason for this student movement.');
  let record;
  if (operation === 'withdraw' || operation === 'withdrawal') {
    if (!statusActive(existing)) throw failure('Only an active membership can be withdrawn.', 409);
    record = {
      ...withoutMetadata(existing), Status: 'Withdrawn',
      WithdrawalDate: dateValue(input.EffectiveDate || nowIso().slice(0, 10), 'withdrawal date'),
      WithdrawalReason: reason
    };
  } else {
    const reinstating = operation === 'reinstate' || operation === 'reinstatement';
    if (reinstating && lower(existing.Status) !== 'withdrawn') throw failure('Only a withdrawn membership can be reinstated.', 409);
    if (!reinstating && !statusActive(existing)) throw failure('Only an active membership can be transferred or changed.', 409);
    record = normalizeAcademicStudentMembership({
      ...input, SessionId: existing.SessionId, TermId: existing.TermId,
      StudentRef: existing.StudentRef, Status: 'Active'
    }, scope, existing);
    validateAcademicRecord(state, 'studentmembership', record, { ...people, existing });
    if (!reinstating && !membershipMateriallyChanged(existing, record)) {
      throw failure('Choose a different class, arm, department or subject allocation before recording a movement.');
    }
    if (reinstating) {
      delete record.WithdrawalDate;
      delete record.WithdrawalReason;
    }
  }
  stampAcademicRecord(record, user, existing);
  const movement = academicMovementForState(state, {
    ...input, StudentRef: existing.StudentRef,
    Operation: operation, MovementType: movementType(existing, record, operation)
  }, scope, existing, operation.startsWith('withdraw') ? null : record);
  const projected = {
    ...state,
    studentMemberships: [...state.studentMemberships.filter((row) => recordId(row) !== recordId(existing)), record]
  };
  const writes = [
    {
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentMemberships,
      documentId: existing.MembershipId, data: withoutMetadata(record), updateTime: expected
    },
    movementWrite(user, movement),
    auditWrite(user, movement.MovementType, 'studentmembership', record, reason)
  ];
  const compatibility = studentCompatibilityWrite(people, projected, record);
  if (compatibility) writes.push(compatibility);
  try {
    await batchCommitDocuments(env, writes);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status))) {
      throw failure('This student or membership changed while the movement was being saved. Reload and try again.', 409, 'ACADEMIC_WRITE_CONFLICT');
    }
    throw error;
  }
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = `${movement.MovementType} recorded online for ${existing.StudentRef}.`;
  return response;
}

function activeDependants(state, type, record) {
  const id = recordId(record);
  if (type === 'session') return [...state.terms, ...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.SessionId === id && statusActive(row));
  if (type === 'term') return [...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.TermId === id && statusActive(row));
  if (type === 'class') return [...state.arms, ...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.ClassId === id && statusActive(row));
  if (type === 'arm') return [...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.ArmId === id && statusActive(row));
  if (type === 'subject') return [...state.departments, ...state.offerings, ...state.teacherAllocations, ...state.studentMemberships].filter((row) => (row.SubjectId === id || (row.SubjectIds || []).includes(id) || (row.CoreSubjectIds || []).includes(id)) && statusActive(row));
  if (type === 'department') return state.studentMemberships.filter((row) => row.DepartmentId === id && statusActive(row));
  if (type === 'offering') return [...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.SessionId === record.SessionId && row.TermId === record.TermId && row.ClassId === record.ClassId && (row.SubjectId === record.SubjectId || (row.SubjectIds || []).includes(record.SubjectId)) && statusActive(row));
  return [];
}

export async function archiveAcademicManagementRecord(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  const type = normalizedRecordType(input.RecordType || input.recordType || input.Type);
  const definition = RECORD_TYPES[type];
  if (!definition) throw failure('Choose a valid academic record type.');
  if (type === 'studentmembership') {
    throw failure('Use the withdrawal workflow for student memberships so the change is preserved in movement history.', 409, 'ACADEMIC_MOVEMENT_REQUIRED');
  }
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
  if (['save', 'saverecord', 'saveacademicsession', 'saveacademicterm', 'saveacademicclass', 'saveacademicarm', 'saveacademicsubject', 'saveacademicdepartment', 'saveacademicoffering', 'saveacademicteacherallocation', 'saveacademicstudentmembership'].includes(action)) {
    const inferredType = ({
      saveacademicsession: 'session', saveacademicterm: 'term', saveacademicclass: 'class', saveacademicarm: 'arm',
      saveacademicsubject: 'subject', saveacademicdepartment: 'department', saveacademicoffering: 'offering', saveacademicteacherallocation: 'teacherAllocation',
      saveacademicstudentmembership: 'studentMembership'
    })[action];
    return saveAcademicManagementRecord(env, user, { ...input, RecordType: input.RecordType || inferredType });
  }
  if (['bulkallocateacademicstudents', 'bulkallocatestudents'].includes(action)) return bulkAllocateAcademicStudents(env, user, input);
  if (['manageacademicstudentmembership', 'moveacademicstudentmembership', 'withdrawacademicstudentmembership', 'reinstateacademicstudentmembership'].includes(action)) {
    const inferredOperation = ({
      withdrawacademicstudentmembership: 'withdraw',
      reinstateacademicstudentmembership: 'reinstate',
      moveacademicstudentmembership: 'transfer'
    })[action];
    return manageAcademicStudentMembership(env, user, { ...input, Operation: input.Operation || inferredOperation });
  }
  if (['archive', 'archiverecord', 'archiveacademicrecord'].includes(action)) return archiveAcademicManagementRecord(env, user, input);
  throw failure('Choose a valid Academic Management action.');
}
