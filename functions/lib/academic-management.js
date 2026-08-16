import { batchCommitDocuments, listCollection } from './firestore.js';
import { enforceActorBranch } from './branch-scope.js';
import { normalizeClassKey } from './class-names.js';
import { staffRecordMatchesEdition } from './records-desk.js';
import {
  getSchoolStructure, listSchoolCollection, safeScopeId, schoolSectionFor, scopedCollectionPath
} from './school-scope.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();

export const ACADEMIC_MANAGEMENT_COLLECTIONS = Object.freeze({
  sessions: 'academicSessions',
  terms: 'academicTerms',
  classes: 'academicClasses',
  armTemplates: 'academicArmTemplates',
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
export const ACADEMIC_SUBJECT_ROLES = Object.freeze(['Core', 'Trade', 'Optional']);
export const ACADEMIC_SENIOR_CHOICE_ROLES = Object.freeze(['Trade', 'Optional']);
export const ACADEMIC_STUDENT_IMPORT_COLUMNS = Object.freeze([
  'StudentRef', 'StudentName', 'ClassCode', 'ArmCode', 'DepartmentCode',
  'TradeSubjectCodes', 'OptionalSubjectCodes', 'Reason'
]);
export const ACADEMIC_STUDENT_MOVEMENT_TYPES = Object.freeze([
  'Allocation', 'Class Transfer', 'Arm Transfer', 'Department Change', 'Subject Change', 'Withdrawal', 'Reinstatement'
]);
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

export function academicOfferingSubjectRole(offering = {}, schoolStage = '') {
  if (schoolStageValue(schoolStage) === 'junior-secondary') return 'Core';
  return oneOf(
    offering.SubjectRole || offering.RequirementType,
    ACADEMIC_SUBJECT_ROLES,
    offering.Compulsory === true ? 'Core' : 'Optional'
  );
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
      || row.DepartmentId || row.SubjectId || row.ArmId || row.ArmTemplateId || row.ClassId || row.TermId || row.SessionId || row.__id
  );
}

function statusActive(row = {}) {
  return !['archived', 'inactive', 'closed', 'withdrawn'].includes(lower(row.Status));
}

export function academicSeniorCoreSubjectIds(departments = []) {
  return uniqueIds((departments || []).filter(statusActive).flatMap((department) => department.CoreSubjectIds || []));
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

function isAcademicsDepartmentUser(user = {}) {
  const role = clean(user.role || user.Role);
  const department = lower(user.department || user.Department);
  return role === 'Department User'
    && (department === 'academic' || department === 'academics' || department.startsWith('academic ') || department.startsWith('academics '));
}

export function academicManagementCapabilities(user = {}) {
  const role = clean(user.role || user.Role);
  const allowed = new Set((user.allowedSections || user.TabAccess || []).map(clean).filter(Boolean));
  const school = isSchoolEdition(user);
  const academicsDepartmentUser = isAcademicsDepartmentUser(user);
  const enabled = school && (allowed.has('academics') || academicsDepartmentUser);
  return {
    enabled,
    canManageStructure: enabled && STRUCTURE_MANAGERS.has(role),
    canManageAllocations: enabled && ALLOCATION_MANAGERS.has(role),
    canArchive: enabled && STRUCTURE_MANAGERS.has(role),
    canDelete: enabled && STRUCTURE_MANAGERS.has(role),
    teacherView: enabled && (role === 'Teacher' || academicsDepartmentUser)
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

export function scopedSection(input = {}, required = true) {
  const value = lower(input.SchoolSection || input.schoolSection || input.Section || input.section);
  if (!value && !required) return '';
  if (value === 'all' && !required) return '';
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
    ArmTemplateId: clean(input.ArmTemplateId ?? existing?.ArmTemplateId),
    DepartmentId: clean(input.DepartmentId ?? existing?.DepartmentId),
    IsClassroom: activeValue(input.IsClassroom ?? existing?.IsClassroom, false),
    Code: clean(input.Code || input.ArmCode || existing?.Code).toUpperCase(),
    Capacity: wholeNumber(input.Capacity, wholeNumber(existing?.Capacity, 0), 0, 10000),
    Room: clean(input.Room ?? existing?.Room),
    SortOrder: wholeNumber(input.SortOrder, wholeNumber(existing?.SortOrder, 100), 1, 10000),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: section
  };
}

export function normalizeAcademicArmTemplate(input = {}, context = {}, existing = null) {
  const name = clean(input.Name || input.ArmName || input.TemplateName);
  if (!name) throw failure('Enter the reusable arm name.');
  const code = clean(input.Code || input.ArmCode || existing?.Code).toUpperCase()
    || safeScopeId(name, 'ARM').toUpperCase();
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const templateId = clean(existing?.ArmTemplateId || input.ArmTemplateId || input.RecordId)
    || academicId('arm-template', branchId, code);
  return {
    ...(existing || {}), RecordId: templateId, ArmTemplateId: templateId,
    Name: name, Code: code,
    DefaultCapacity: wholeNumber(input.DefaultCapacity ?? input.Capacity, wholeNumber(existing?.DefaultCapacity, 0), 0, 10000),
    SortOrder: wholeNumber(input.SortOrder, wholeNumber(existing?.SortOrder, 100), 1, 10000),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: 'all'
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
  const seniorChoiceRole = input.SeniorChoiceRole === undefined
    ? oneOf(existing?.SeniorChoiceRole, ACADEMIC_SENIOR_CHOICE_ROLES, '')
    : oneOf(input.SeniorChoiceRole, ACADEMIC_SENIOR_CHOICE_ROLES, '');
  const record = {
    ...(existing || {}), RecordId: subjectId, SubjectId: subjectId, Name: name, Code: code,
    SeniorChoiceRole: section === 'secondary' ? seniorChoiceRole : '',
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: section
  };
  delete record.Category;
  delete record.SubjectCategory;
  return record;
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
  const suppliedRole = clean(input.SubjectRole || input.RequirementType);
  const fallbackRole = input.Compulsory !== undefined
    ? (activeValue(input.Compulsory, false) ? 'Core' : 'Optional')
    : academicOfferingSubjectRole(existing || {});
  const subjectRole = oneOf(suppliedRole, ACADEMIC_SUBJECT_ROLES, fallbackRole);
  return {
    ...(existing || {}), RecordId: offeringId, OfferingId: offeringId,
    SessionId: sessionId, TermId: termId, ClassId: classId, ArmId: armId, SubjectId: subjectId,
    SubjectRole: subjectRole, Compulsory: subjectRole === 'Core',
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
  const allocationRole = oneOf(input.AllocationRole, ACADEMIC_TEACHER_ALLOCATION_ROLES, existing?.AllocationRole || 'Subject Teacher');
  const subjectTeacher = allocationRole === 'Subject Teacher';
  const subjectId = subjectTeacher ? clean(input.SubjectId ?? existing?.SubjectId) : '';
  if (!sessionId || !termId || !teacherUsername || !classId) {
    throw failure('Choose a session, term, teacher and class for this allocation.');
  }
  if (subjectTeacher && !subjectId) throw failure('Choose a subject for a Subject Teacher assignment.');
  if (!subjectTeacher && !armId) throw failure('Choose the class arm for a Form Teacher or Assistant Teacher assignment.');
  const branchId = safeScopeId(context.branchId || input.BranchId || existing?.BranchId);
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection || existing?.SchoolSection });
  const responsibilityId = subjectTeacher ? subjectId : lower(allocationRole);
  const allocationId = clean(existing?.AllocationId || input.AllocationId || input.RecordId)
    || academicId('teacher', branchId, section, sessionId, termId, teacherUsername, classId, armId || 'all-arms', responsibilityId);
  return {
    ...(existing || {}), RecordId: allocationId, AllocationId: allocationId,
    SessionId: sessionId, TermId: termId, TeacherUsername: teacherUsername,
    ClassId: classId, ArmId: armId, SubjectId: subjectId,
    AllocationRole: allocationRole,
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
    CoreSubjectIds: uniqueIds(input.CoreSubjectIds ?? existing?.CoreSubjectIds ?? []),
    TradeSubjectIds: uniqueIds(input.TradeSubjectIds ?? existing?.TradeSubjectIds ?? []),
    OptionalSubjectIds: uniqueIds(input.OptionalSubjectIds ?? existing?.OptionalSubjectIds ?? []),
    CurriculumStatus: clean(input.CurriculumStatus ?? existing?.CurriculumStatus),
    Status: oneOf(input.Status, ACADEMIC_MEMBERSHIP_STATUSES, existing?.Status || 'Active'),
    BranchId: branchId, SchoolSection: section
  };
}

const RECORD_TYPES = Object.freeze({
  session: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.sessions, normalize: normalizeAcademicSession, capability: 'canManageStructure' },
  term: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.terms, normalize: normalizeAcademicTerm, capability: 'canManageStructure' },
  class: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.classes, normalize: normalizeAcademicClass, capability: 'canManageStructure' },
  armtemplate: { collection: ACADEMIC_MANAGEMENT_COLLECTIONS.armTemplates, normalize: normalizeAcademicArmTemplate, capability: 'canManageStructure' },
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

function academicStudentDocumentId(reference) {
  return clean(reference)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

export function importedAcademicStudentProfile(row, scope, schoolClass, arm, session, term, user) {
  const timestamp = nowIso();
  const studentRef = clean(row.StudentRef);
  const studentName = clean(row.StudentName);
  const documentId = academicStudentDocumentId(studentRef);
  return {
    __id: documentId,
    __scopePath: scopedCollectionPath('students', scope.branchId, scope.section),
    AdmissionNo: studentRef,
    AccountRef: studentRef,
    DisplayName: studentName,
    ApplicantName: studentName,
    BranchId: scope.branchId,
    SchoolSection: scope.section,
    ClassName: clean(schoolClass?.Name),
    ClassAdmitted: clean(schoolClass?.Name),
    ClassArm: clean(arm?.Name),
    AcademicClassId: clean(schoolClass?.ClassId),
    AcademicArmId: clean(arm?.ArmId),
    AcademicSession: clean(session?.Name),
    Term: clean(term?.Name),
    EnrollmentCategory: 'Returning',
    Status: 'Active',
    ProfileCompletionStatus: 'Needs completion',
    ImportedAt: timestamp,
    ImportedBy: actorName(user),
    ImportSource: 'Academic Management',
    CreatedAt: timestamp,
    CreatedBy: actorName(user),
    UpdatedAt: timestamp,
    UpdatedBy: actorName(user)
  };
}

export function academicStudentMatchesClass(student = {}, schoolClass = {}) {
  const selectedClassId = clean(schoolClass.ClassId || schoolClass.RecordId);
  const existingClassId = clean(student.AcademicClassId);
  if (existingClassId && selectedClassId) return lower(existingClassId) === lower(selectedClassId);
  const studentClassKeys = [
    student.ClassName, student.ClassAdmitted, student.ClassApplyingFor, student.CurrentClass
  ].map(normalizeClassKey).filter(Boolean);
  const selectedClassKeys = [
    schoolClass.Name, schoolClass.Code, schoolClass.LegacyDocumentId
  ].map(normalizeClassKey).filter(Boolean);
  return studentClassKeys.some((key) => selectedClassKeys.includes(key));
}

function academicStudentClassId(student = {}, classes = []) {
  const direct = findById(classes, student.AcademicClassId);
  if (direct) return clean(direct.ClassId);
  return clean(classes.find((schoolClass) => academicStudentMatchesClass(student, schoolClass))?.ClassId);
}

function assertReference(row, message) {
  if (!row || !statusActive(row)) throw failure(message, 409, 'ACADEMIC_REFERENCE_INVALID');
  return row;
}

export function applyAcademicStudentCurriculum(state = {}, record = {}, options = {}) {
  const offerings = (state.offerings || []).filter((row) => statusActive(row)
    && row.SessionId === record.SessionId && row.TermId === record.TermId && row.ClassId === record.ClassId
    && (!row.ArmId || row.ArmId === record.ArmId));
  // Senior curriculum is intentionally independent of class offerings. Its Core subjects come
  // only from the assigned department, while Trade and Optional subjects come from the shared
  // Senior-choice configuration. Ignoring legacy Senior offerings prevents old bulk assignments
  // from leaking into the simplified curriculum model.
  const curriculumOfferings = record.SchoolStage === 'senior-secondary' ? [] : offerings;
  const roleBySubject = new Map();
  const rolePriority = { Optional: 1, Trade: 2, Core: 3 };
  curriculumOfferings.forEach((offering) => {
    const role = academicOfferingSubjectRole(offering, record.SchoolStage);
    const current = roleBySubject.get(offering.SubjectId) || 'Optional';
    if (rolePriority[role] >= rolePriority[current]) roleBySubject.set(offering.SubjectId, role);
  });
  const seniorChoiceSubjects = record.SchoolStage === 'senior-secondary'
    ? (state.subjects || []).filter((subject) => statusActive(subject)
      && subject.SchoolSection === 'secondary'
      && ACADEMIC_SENIOR_CHOICE_ROLES.includes(subject.SeniorChoiceRole))
    : [];
  seniorChoiceSubjects.forEach((subject) => {
    const role = subject.SeniorChoiceRole;
    const current = roleBySubject.get(subject.SubjectId) || 'Optional';
    if (rolePriority[role] >= rolePriority[current]) roleBySubject.set(subject.SubjectId, role);
  });
  const available = new Set([...curriculumOfferings.map((row) => row.SubjectId), ...seniorChoiceSubjects.map((row) => row.SubjectId)]);
  const offeredCore = curriculumOfferings.map((row) => row.SubjectId).filter((subjectId) => roleBySubject.get(subjectId) === 'Core');
  let coreSubjectIds = uniqueIds(offeredCore);
  if (record.SchoolStage === 'junior-secondary') {
    record.DepartmentId = '';
    coreSubjectIds = uniqueIds(curriculumOfferings.map((row) => row.SubjectId));
  } else if (record.SchoolStage === 'senior-secondary') {
    const department = findById(state.departments || [], record.DepartmentId);
    if (!department && options.allowIncompleteCurriculum !== true) {
      throw failure('Choose an active senior secondary department for this student.');
    }
    if (department) {
      assertReference(department, 'Choose an active senior secondary department for this student.');
      if (department.SchoolStage !== 'senior-secondary') throw failure('The selected department is not a Senior Secondary department.');
      coreSubjectIds = uniqueIds([...coreSubjectIds, ...(department.CoreSubjectIds || [])]);
      coreSubjectIds.forEach((subjectId) => {
        available.add(subjectId);
        roleBySubject.set(subjectId, 'Core');
      });
    }
  } else {
    record.DepartmentId = '';
  }
  if (!available.size && options.allowIncompleteCurriculum !== true) {
    throw failure(record.SchoolStage === 'senior-secondary'
      ? 'Configure department core subjects and the Senior Trade subject list before allocating students.'
      : 'Offer subjects to this class or arm before allocating students.');
  }
  const requestedSubjects = uniqueIds(record.SubjectIds);
  const invalidSubjects = requestedSubjects.filter((subjectId) => !available.has(subjectId));
  if (invalidSubjects.length) throw failure('One or more selected subjects are not available to this class or arm.');
  const coreSet = new Set(coreSubjectIds);
  const tradeAvailable = [...available].filter((subjectId) => !coreSet.has(subjectId) && roleBySubject.get(subjectId) === 'Trade');
  const tradeSet = new Set(tradeAvailable);
  const optionalAvailable = [...available].filter((subjectId) => !coreSet.has(subjectId)
    && !tradeSet.has(subjectId) && roleBySubject.get(subjectId) === 'Optional');
  const optionalSet = new Set(optionalAvailable);
  const suppliedTrade = uniqueIds(record.TradeSubjectIds);
  const suppliedOptional = uniqueIds(record.OptionalSubjectIds);
  if (suppliedTrade.some((subjectId) => !tradeSet.has(subjectId))) {
    throw failure('One or more selected Trade subjects are not offered as Trade subjects to this class or arm.');
  }
  if (suppliedOptional.some((subjectId) => !optionalSet.has(subjectId))) {
    throw failure('One or more selected optional subjects are not offered as optional subjects to this class or arm.');
  }
  const selectedTrade = uniqueIds([...suppliedTrade, ...requestedSubjects.filter((subjectId) => tradeSet.has(subjectId))]);
  const selectedOptional = uniqueIds([...suppliedOptional, ...requestedSubjects.filter((subjectId) => optionalSet.has(subjectId))]);
  if (record.SchoolStage === 'senior-secondary' && options.requireTradeSelection === true) {
    if (!tradeAvailable.length) throw failure('Configure at least one school-wide Senior Trade subject before completing subject selection.');
    if (!selectedTrade.length) throw failure('Every Senior Secondary student must select at least one Trade subject.');
  }
  record.CoreSubjectIds = coreSubjectIds;
  record.TradeSubjectIds = record.SchoolStage === 'senior-secondary' ? selectedTrade : [];
  record.OptionalSubjectIds = record.SchoolStage === 'junior-secondary' ? [] : selectedOptional;
  record.SubjectIds = record.SchoolStage === 'junior-secondary'
    ? coreSubjectIds
    : uniqueIds([...requestedSubjects, ...coreSubjectIds, ...record.TradeSubjectIds, ...record.OptionalSubjectIds]);
  if (record.SchoolStage === 'senior-secondary') {
    record.CurriculumStatus = !record.DepartmentId
      ? 'Pending Department Selection'
      : !tradeAvailable.length
        ? 'Trade Subjects Not Configured'
        : record.TradeSubjectIds.length ? 'Complete' : 'Pending Trade Selection';
  } else {
    record.CurriculumStatus = coreSubjectIds.length ? 'Complete' : 'Subjects Not Configured';
  }
  if (!record.SubjectIds.length && options.allowIncompleteCurriculum !== true) {
    throw failure('Choose at least one offered subject for this student.');
  }
  return record;
}

function sortedIds(value) {
  return uniqueIds(value).sort((a, b) => a.localeCompare(b));
}

function membershipMateriallyChanged(before = {}, after = {}) {
  return ['ClassId', 'ArmId', 'DepartmentId', 'Status'].some((key) => clean(before[key]) !== clean(after[key]))
    || ['SubjectIds', 'CoreSubjectIds', 'TradeSubjectIds', 'OptionalSubjectIds'].some((key) => (
      JSON.stringify(sortedIds(before[key])) !== JSON.stringify(sortedIds(after[key]))
    ))
    || clean(before.CurriculumStatus) !== clean(after.CurriculumStatus);
}

function membershipSnapshot(record = {}, prefix = '') {
  return {
    [`${prefix}ClassId`]: clean(record.ClassId),
    [`${prefix}ArmId`]: clean(record.ArmId),
    [`${prefix}DepartmentId`]: clean(record.DepartmentId),
    [`${prefix}SubjectIds`]: uniqueIds(record.SubjectIds),
    [`${prefix}CoreSubjectIds`]: uniqueIds(record.CoreSubjectIds),
    [`${prefix}TradeSubjectIds`]: uniqueIds(record.TradeSubjectIds),
    [`${prefix}OptionalSubjectIds`]: uniqueIds(record.OptionalSubjectIds),
    [`${prefix}CurriculumStatus`]: clean(record.CurriculumStatus)
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
    const schoolStage = schoolStageValue(schoolClass.SchoolStage, schoolClass.SchoolSection, schoolClass.Name);
    if (record.DepartmentId) {
      if (schoolStage !== 'senior-secondary') throw failure('Academic departments can be assigned only to Senior Secondary classrooms.');
      const department = assertReference(findById(state.departments, record.DepartmentId), 'Choose an active Senior Secondary department for this classroom.');
      if (department.SchoolStage !== 'senior-secondary' || department.SchoolSection !== 'secondary') {
        throw failure('The selected department is not a Senior Secondary academic department.');
      }
    }
    const existingDepartmentId = clean(people.existing?.DepartmentId);
    if (people.existing && existingDepartmentId !== clean(record.DepartmentId)) {
      const membershipDepartments = new Set(state.studentMemberships
        .filter((row) => statusActive(row) && row.ArmId === record.ArmId)
        .map((row) => clean(row.DepartmentId)));
      if (membershipDepartments.size && !(membershipDepartments.size === 1 && membershipDepartments.has(clean(record.DepartmentId)))) {
        throw failure('This classroom already contains students from another department. Move or correct those memberships before changing its department.', 409, 'ACADEMIC_CLASSROOM_DEPARTMENT_CONFLICT');
      }
    }
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
    const seniorChoiceSubjects = record.CoreSubjectIds.filter((subjectId) => {
      const subject = findById(state.subjects, subjectId);
      return ACADEMIC_SENIOR_CHOICE_ROLES.includes(subject?.SeniorChoiceRole);
    });
    if (seniorChoiceSubjects.length) {
      throw failure('A department Core subject cannot also be a school-wide Senior Trade or Optional subject. Remove it from Senior choices first.');
    }
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
      if (type === 'studentmembership' && arm.DepartmentId) {
        if (record.DepartmentId && record.DepartmentId !== arm.DepartmentId) {
          throw failure('The selected student department does not match this classroom department.', 409, 'ACADEMIC_CLASSROOM_DEPARTMENT_MISMATCH');
        }
        record.DepartmentId = arm.DepartmentId;
      }
    }
  }
  if (type === 'offering' || (type === 'teacherallocation' && record.AllocationRole === 'Subject Teacher')) {
    const subject = assertReference(findById(state.subjects, record.SubjectId), 'The selected subject is not active.');
    if (subject.SchoolSection !== record.SchoolSection) throw failure('The selected subject belongs to another school section.');
  }
  if (type === 'offering' && record.SchoolStage === 'junior-secondary') {
    record.SubjectRole = 'Core';
    record.Compulsory = true;
  }
  if (type === 'offering' && record.SchoolStage === 'senior-secondary') {
    throw failure('Senior subjects are configured through Senior departments and Senior choices. Legacy Senior class offerings can be removed from the Offering register.', 409, 'ACADEMIC_SENIOR_OFFERING_DEPRECATED');
  }
  if (type === 'offering' && record.SubjectRole === 'Trade' && record.SchoolStage !== 'senior-secondary') {
    throw failure('Trade subjects can be configured only for Senior Secondary classes.');
  }
  if (type === 'teacherallocation') {
    const teacher = people.staff.find((row) => lower(row.Username || row.username || row.__id) === record.TeacherUsername);
    if (!teacher || !activeValue(teacher.Active, true)) throw failure('The selected teacher is not an active staff account in this branch.');
    const teacherSection = lower(teacher.SchoolSectionAccess || teacher.schoolSectionAccess || 'all');
    if (['primary', 'secondary'].includes(teacherSection) && teacherSection !== record.SchoolSection) {
      throw failure('The selected teacher is restricted to another school section.', 409, 'ACADEMIC_TEACHER_SECTION_INVALID');
    }
    if (record.AllocationRole === 'Subject Teacher') {
      const offering = record.SchoolStage === 'senior-secondary' ? null : state.offerings.find((row) => statusActive(row)
        && row.SessionId === record.SessionId && row.TermId === record.TermId
        && row.ClassId === record.ClassId && row.SubjectId === record.SubjectId
        && (!row.ArmId || !record.ArmId || row.ArmId === record.ArmId));
      const subject = findById(state.subjects, record.SubjectId);
      const globallyAvailableSeniorChoice = record.SchoolStage === 'senior-secondary'
        && ACADEMIC_SENIOR_CHOICE_ROLES.includes(subject?.SeniorChoiceRole);
      const classroom = findById(state.arms, record.ArmId);
      const department = findById(state.departments, classroom?.DepartmentId);
      const availableSeniorCore = record.SchoolStage === 'senior-secondary'
        && statusActive(department)
        && (department.CoreSubjectIds || []).includes(record.SubjectId);
      if (!offering && !globallyAvailableSeniorChoice && !availableSeniorCore) {
        throw failure('Configure this subject for the selected classroom through its Senior department or Senior choices before allocating a teacher.');
      }
    }
  }
  if (type === 'studentmembership') {
    const student = people.students.find((row) => lower(studentReference(row)) === lower(record.StudentRef));
    if (!student) throw failure('The selected student was not found in this branch and school section.', 404);
    const schoolClass = findById(state.classes, record.ClassId);
    if (!people.existing && !academicStudentMatchesClass(student, schoolClass)) {
      const currentClass = clean(student.ClassName || student.ClassAdmitted || student.ClassApplyingFor) || 'another class';
      throw failure(`${record.StudentRef} belongs to ${currentClass}. Choose an arm within that student\u2019s existing class.`, 409, 'ACADEMIC_STUDENT_CLASS_MISMATCH');
    }
    applyAcademicStudentCurriculum(state, record, {
      allowIncompleteCurriculum: people.allowIncompleteCurriculum === true
    });
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
    .sort((a, b) => clean(a.Name).localeCompare(clean(b.Name), undefined, { numeric: true, sensitivity: 'base' }))
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
      && activeValue(row.Active, true)
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
    Role: clean(row.Role || row.role), Department: clean(row.Department || row.department),
    SchoolSectionAccess: clean(row.SchoolSectionAccess || row.schoolSectionAccess || 'All')
  })).sort((a, b) => a.DisplayName.localeCompare(b.DisplayName));
}

function displayStudents(rows = [], classes = []) {
  return rows.map((row) => ({
    StudentRef: studentReference(row),
    StudentName: clean(row.DisplayName || row.ApplicantName || row.StudentName || studentReference(row)),
    AcademicClassId: academicStudentClassId(row, classes),
    AcademicArmId: clean(row.AcademicArmId), AcademicDepartmentCode: clean(row.AcademicDepartmentCode),
    ClassName: clean(row.ClassName || row.ClassAdmitted), ClassAdmitted: clean(row.ClassAdmitted),
    ClassArm: clean(row.ClassArm), SchoolSection: clean(row.SchoolSection)
  })).filter((row) => row.StudentRef).sort((a, b) => a.StudentName.localeCompare(b.StudentName));
}

function sortAcademicState(state) {
  const byName = (a, b) => clean(a.Name).localeCompare(clean(b.Name), undefined, { numeric: true, sensitivity: 'base' });
  const byOrder = (a, b) => Number(a.SortOrder || 100) - Number(b.SortOrder || 100) || byName(a, b);
  return {
    sessions: [...state.sessions].sort((a, b) => clean(b.StartDate).localeCompare(clean(a.StartDate))),
    terms: [...state.terms].sort((a, b) => clean(a.StartDate).localeCompare(clean(b.StartDate))),
    classes: [...state.classes].sort(byOrder), armTemplates: [...state.armTemplates].sort(byName), arms: [...state.arms].sort(byName),
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
    students: displayStudents(students, state.classes),
    audit: audit.filter((row) => lower(row.BranchId || 'main') === lower(scope.branchId))
      .sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp))).slice(0, 100).map(publicRecord),
    summary: {
      Sessions: state.sessions.filter(statusActive).length,
      Classes: state.classes.filter(statusActive).length,
      ArmTemplates: state.armTemplates.filter(statusActive).length,
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
  const requiresSection = !['session', 'term', 'armtemplate'].includes(type);
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

function importCodeList(value) {
  const seen = new Set();
  return clean(value).split(/[;|]/).map(clean).filter((item) => {
    const key = lower(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeAcademicStudentImportRows(value) {
  let supplied = value;
  if (typeof supplied === 'string') {
    try { supplied = JSON.parse(supplied); } catch (_error) { supplied = []; }
  }
  if (!Array.isArray(supplied)) return [];
  return supplied.map((row = {}) => ({
    StudentRef: clean(row.StudentRef || row.AdmissionNo || row.AccountRef),
    StudentName: clean(row.StudentName || row.DisplayName),
    ClassCode: clean(row.ClassCode || row.ClassId || row.ClassName),
    ArmCode: clean(row.ArmCode || row.ArmId || row.ArmName),
    DepartmentCode: clean(row.DepartmentCode || row.DepartmentId || row.DepartmentName),
    TradeSubjectCodes: importCodeList(row.TradeSubjectCodes || row.TradeSubjects),
    OptionalSubjectCodes: importCodeList(row.OptionalSubjectCodes || row.OptionalSubjects),
    Reason: clean(row.Reason)
  }));
}

function academicImportReference(rows, suppliedValue, keys, label, rowNumber) {
  const value = clean(suppliedValue);
  if (!value) throw failure(`Row ${rowNumber}: enter the ${label}.`);
  const wanted = lower(value);
  const matches = rows.filter((row) => statusActive(row)
    && keys.some((key) => lower(row[key]) === wanted));
  if (!matches.length) throw failure(`Row ${rowNumber}: ${label} "${value}" was not found or is inactive.`, 404, 'ACADEMIC_IMPORT_REFERENCE_INVALID');
  if (matches.length > 1) throw failure(`Row ${rowNumber}: ${label} "${value}" is ambiguous. Use its unique code.`, 409, 'ACADEMIC_IMPORT_REFERENCE_AMBIGUOUS');
  return matches[0];
}

function stampAcademicRecord(record, user, existing = null) {
  const timestamp = nowIso();
  record.CreatedAt = clean(existing?.CreatedAt) || timestamp;
  record.CreatedBy = clean(existing?.CreatedBy) || actorName(user);
  record.UpdatedAt = timestamp;
  record.UpdatedBy = actorName(user);
  return record;
}

function batchLines(value) {
  return clean(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function batchParts(line, index, expectedCount, format) {
  const parts = line.split('|').map((part) => part.trim());
  if (parts.length !== expectedCount) {
    throw failure(`Line ${index + 1} is not in the required format. Use ${format}.`);
  }
  return parts;
}

export function parseAcademicClassBatch(input = {}, context = {}) {
  const section = scopedSection({ SchoolSection: context.section || input.SchoolSection });
  if (Array.isArray(input.Classes)) return input.Classes.map((row, index) => ({ ...row, SortOrder: row.SortOrder || (index + 1) * 10 }));
  return batchLines(input.ClassLines || input.Classes).map((line, index) => {
    const parts = batchParts(
      line, index, section === 'secondary' ? 4 : 3,
      section === 'secondary' ? 'Name | Code | Junior Secondary or Senior Secondary | Capacity' : 'Name | Code | Capacity'
    );
    return section === 'secondary'
      ? { Name: parts[0], Code: parts[1], SchoolStage: parts[2], Capacity: parts[3], SortOrder: (index + 1) * 10 }
      : { Name: parts[0], Code: parts[1], Capacity: parts[2], SchoolStage: 'primary', SortOrder: (index + 1) * 10 };
  });
}

export function parseAcademicArmTemplateBatch(input = {}) {
  if (Array.isArray(input.ArmTemplates)) return input.ArmTemplates.map((row, index) => ({ ...row, SortOrder: row.SortOrder || (index + 1) * 10 }));
  return batchLines(input.ArmTemplateLines || input.ArmTemplates).map((line, index) => {
    const parts = batchParts(line, index, 3, 'Name | Code | Default capacity');
    return { Name: parts[0], Code: parts[1], DefaultCapacity: parts[2], SortOrder: (index + 1) * 10 };
  });
}

export function parseAcademicSubjectBatch(input = {}) {
  if (Array.isArray(input.Subjects)) return input.Subjects.map((row) => ({ ...row }));
  return batchLines(input.SubjectLines || input.Subjects).map((line, index) => {
    const parts = batchParts(line, index, 2, 'Name | Code');
    return { Name: parts[0], Code: parts[1] };
  });
}

function sameSetupRecord(existing, record, keys) {
  return statusActive(existing) && keys.every((key) => {
    if (['Capacity', 'DefaultCapacity', 'SortOrder'].includes(key)) return Number(existing[key] || 0) === Number(record[key] || 0);
    return clean(existing[key]) === clean(record[key]);
  });
}

async function commitAcademicBatch(env, writes, conflictMessage) {
  if (!writes.length) return;
  try {
    await batchCommitDocuments(env, writes);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status))) {
      throw failure(conflictMessage, 409, 'ACADEMIC_WRITE_CONFLICT');
    }
    throw error;
  }
}

export async function bulkCreateAcademicClasses(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageStructure');
  const scope = await academicScope(env, user, input, { requireSection: true });
  const rows = parseAcademicClassBatch(input, scope);
  if (!rows.length) throw failure('Enter at least one class definition.');
  if (rows.length > 50) throw failure('Create at most 50 classes in one batch.');
  const state = await loadAcademicState(env, scope.branchId);
  const projected = { ...state, classes: [...state.classes] };
  const writes = [];
  let skipped = 0;
  const createdRecords = [];
  for (const row of rows) {
    const record = normalizeAcademicClass({ ...row, Status: 'Active' }, scope);
    const existing = findById(projected.classes, record.ClassId);
    if (existing) {
      if (sameSetupRecord(existing, record, ['Name', 'Code', 'SchoolStage', 'Capacity'])) {
        skipped += 1;
        continue;
      }
      throw failure(`${record.Name} already exists with different class settings. Edit that class instead.`, 409, 'ACADEMIC_BULK_CLASS_CONFLICT');
    }
    validateAcademicRecord(projected, 'class', record, {});
    stampAcademicRecord(record, user);
    projected.classes.push(record);
    createdRecords.push(record);
    writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.classes, documentId: record.ClassId, data: withoutMetadata(record), exists: false });
  }
  createdRecords.forEach((record) => {
    const compatibility = legacyClassWrite(projected, record, 'class');
    if (compatibility) writes.push(compatibility);
  });
  if (createdRecords.length) writes.push(auditWrite(user, 'BULK CREATE', 'class', {
    BranchId: scope.branchId, SchoolSection: scope.section, ClassId: `bulk-${Date.now()}`
  }, `${createdRecords.length} class(es) created; ${skipped} already matched.`));
  await commitAcademicBatch(env, writes, 'The class catalogue changed while this batch was being saved. Reload and try again.');
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = createdRecords.length
    ? `${createdRecords.length} class${createdRecords.length === 1 ? '' : 'es'} created online${skipped ? `; ${skipped} already matched and were skipped` : ''}.`
    : 'Every submitted class already exists with the same settings.';
  response.bulkResult = { Requested: rows.length, Created: createdRecords.length, Skipped: skipped };
  return response;
}

export async function bulkCreateAcademicArmTemplates(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageStructure');
  const scope = await academicScope(env, user, input, { requireSection: false });
  const rows = parseAcademicArmTemplateBatch(input);
  if (!rows.length) throw failure('Enter at least one reusable arm definition.');
  if (rows.length > 50) throw failure('Create at most 50 reusable arms in one batch.');
  const state = await loadAcademicState(env, scope.branchId);
  const projected = { ...state, armTemplates: [...state.armTemplates] };
  const writes = [];
  const createdRecords = [];
  let skipped = 0;
  for (const row of rows) {
    const record = normalizeAcademicArmTemplate({ ...row, Status: 'Active' }, scope);
    const existing = findById(projected.armTemplates, record.ArmTemplateId);
    if (existing) {
      if (sameSetupRecord(existing, record, ['Name', 'Code', 'DefaultCapacity'])) {
        skipped += 1;
        continue;
      }
      throw failure(`${record.Name} already exists with different reusable-arm settings. Edit that catalogue entry instead.`, 409, 'ACADEMIC_BULK_ARM_TEMPLATE_CONFLICT');
    }
    stampAcademicRecord(record, user);
    projected.armTemplates.push(record);
    createdRecords.push(record);
    writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.armTemplates, documentId: record.ArmTemplateId, data: withoutMetadata(record), exists: false });
  }
  if (createdRecords.length) writes.push(auditWrite(user, 'BULK CREATE', 'armtemplate', {
    BranchId: scope.branchId, SchoolSection: scope.section, ArmTemplateId: `bulk-${Date.now()}`
  }, `${createdRecords.length} reusable arm(s) created; ${skipped} already matched.`));
  await commitAcademicBatch(env, writes, 'The reusable arm catalogue changed while this batch was being saved. Reload and try again.');
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = createdRecords.length
    ? `${createdRecords.length} reusable arm${createdRecords.length === 1 ? '' : 's'} created online${skipped ? `; ${skipped} already matched and were skipped` : ''}.`
    : 'Every submitted reusable arm already exists with the same settings.';
  response.bulkResult = { Requested: rows.length, Created: createdRecords.length, Skipped: skipped };
  return response;
}

export async function bulkCreateAcademicSubjects(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageStructure');
  const scope = await academicScope(env, user, input, { requireSection: true });
  const rows = parseAcademicSubjectBatch(input);
  if (!rows.length) throw failure('Enter at least one subject definition.');
  if (rows.length > 50) throw failure('Create at most 50 subjects in one batch.');
  const state = await loadAcademicState(env, scope.branchId);
  const projected = { ...state, subjects: [...state.subjects] };
  const writes = [];
  const createdRecords = [];
  let skipped = 0;
  for (const row of rows) {
    const record = normalizeAcademicSubject({ ...row, Status: 'Active' }, scope);
    const existing = findById(projected.subjects, record.SubjectId);
    if (existing) {
      if (sameSetupRecord(existing, record, ['Name', 'Code'])) {
        skipped += 1;
        continue;
      }
      throw failure(`${record.Name} already exists with different subject settings. Edit that subject instead.`, 409, 'ACADEMIC_BULK_SUBJECT_CONFLICT');
    }
    stampAcademicRecord(record, user);
    projected.subjects.push(record);
    createdRecords.push(record);
    writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.subjects, documentId: record.SubjectId, data: withoutMetadata(record), exists: false });
  }
  if (createdRecords.length) writes.push(auditWrite(user, 'BULK CREATE', 'subject', {
    BranchId: scope.branchId, SchoolSection: scope.section, SubjectId: `bulk-${Date.now()}`
  }, `${createdRecords.length} reusable subject(s) created; ${skipped} already matched.`));
  await commitAcademicBatch(env, writes, 'The subject catalogue changed while this batch was being saved. Reload and try again.');
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = createdRecords.length
    ? `${createdRecords.length} reusable subject${createdRecords.length === 1 ? '' : 's'} created online${skipped ? `; ${skipped} already matched and were skipped` : ''}.`
    : 'Every submitted subject already exists with the same settings.';
  response.bulkResult = { Requested: rows.length, Created: createdRecords.length, Skipped: skipped };
  return response;
}

export async function configureAcademicSeniorChoiceSubjects(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageStructure');
  const scope = await academicScope(env, user, input, { requireSection: true });
  if (scope.section !== 'secondary') {
    throw failure('Senior Trade and Optional subjects can be configured only in the Secondary school section.');
  }
  const tradeSubjectIds = uniqueIds(input.TradeSubjectIds || input.TradeSubjectId);
  const optionalSubjectIds = uniqueIds(input.OptionalSubjectIds || input.OptionalSubjectId);
  if (!tradeSubjectIds.length) throw failure('Choose at least one school-wide Senior Trade subject.');
  const tradeSet = new Set(tradeSubjectIds);
  const overlap = optionalSubjectIds.filter((subjectId) => tradeSet.has(subjectId));
  if (overlap.length) throw failure('A subject cannot be both Trade and Optional. Choose only one category for each subject.');

  const state = await loadAcademicState(env, scope.branchId);
  const configuredIds = new Set([...tradeSubjectIds, ...optionalSubjectIds]);
  const coreSubjectIds = new Set(academicSeniorCoreSubjectIds(state.departments));
  if ([...configuredIds].some((subjectId) => coreSubjectIds.has(subjectId))) {
    throw failure('Subjects already assigned as department Core cannot be selected as Senior Trade or Optional subjects.');
  }
  configuredIds.forEach((subjectId) => {
    const subject = assertReference(findById(state.subjects, subjectId), 'Every selected Senior choice subject must be active.');
    if (lower(subject.SchoolSection) !== 'secondary') {
      throw failure('Every selected Senior choice subject must belong to the Secondary subject catalogue.');
    }
  });

  const writes = [];
  let updated = 0;
  state.subjects.filter((subject) => lower(subject.SchoolSection) === 'secondary').forEach((subject) => {
    const desiredRole = tradeSet.has(subject.SubjectId)
      ? 'Trade'
      : optionalSubjectIds.includes(subject.SubjectId) ? 'Optional' : '';
    if (clean(subject.SeniorChoiceRole) === desiredRole) return;
    const record = normalizeAcademicSubject({
      ...subject,
      SeniorChoiceRole: desiredRole
    }, scope, subject);
    stampAcademicRecord(record, user, subject);
    writes.push({
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.subjects,
      documentId: record.SubjectId,
      data: withoutMetadata(record),
      updateTime: subject.__updateTime
    });
    updated += 1;
  });
  if (updated) writes.push(auditWrite(user, 'CONFIGURE', 'subject', {
    BranchId: scope.branchId,
    SchoolSection: scope.section,
    SubjectId: `senior-choices-${Date.now()}`
  }, `${tradeSubjectIds.length} school-wide Senior Trade subject(s) and ${optionalSubjectIds.length} Optional subject(s) configured.`));
  await commitAcademicBatch(env, writes, 'The subject catalogue changed while Senior choices were being saved. Reload and try again.');
  const response = await bootstrapAcademicManagement(env, user, {
    ...input,
    BranchId: scope.branchId,
    SchoolSection: scope.section
  });
  response.message = updated
    ? 'Senior Trade and Optional subjects saved online and made available to every Senior classroom.'
    : 'Senior Trade and Optional subjects already match the saved configuration.';
  response.seniorChoiceResult = {
    TradeSubjects: tradeSubjectIds.length,
    OptionalSubjects: optionalSubjectIds.length,
    Updated: updated
  };
  return response;
}

export async function bulkApplyAcademicArmTemplates(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageStructure');
  const scope = await academicScope(env, user, input, { requireSection: true });
  const classIds = uniqueIds(input.ClassIds || input.ClassId);
  const templateIds = uniqueIds(input.ArmTemplateIds || input.ArmTemplateId);
  if (!classIds.length || !templateIds.length) throw failure('Choose at least one class and one reusable arm.');
  if (classIds.length * templateIds.length > 200) throw failure('Apply at most 200 class-arm combinations in one batch.');
  const state = await loadAcademicState(env, scope.branchId);
  const projected = { ...state, arms: [...state.arms] };
  const classes = classIds.map((id) => assertReference(findById(state.classes, id), 'One selected class is not active.'));
  const templates = templateIds.map((id) => assertReference(findById(state.armTemplates, id), 'One selected reusable arm is not active.'));
  if (classes.some((row) => lower(row.SchoolSection) !== scope.section)) {
    throw failure('Every selected class must belong to the selected school section.', 409, 'ACADEMIC_SECTION_MISMATCH');
  }
  const writes = [];
  const createdRecords = [];
  let skipped = 0;
  for (const schoolClass of classes) {
    for (const template of templates) {
      const record = normalizeAcademicArm({
        ClassId: schoolClass.ClassId, Name: template.Name, Code: template.Code,
        ArmTemplateId: template.ArmTemplateId, Capacity: template.DefaultCapacity,
        SortOrder: template.SortOrder, Status: 'Active'
      }, scope);
      const existing = findById(projected.arms, record.ArmId);
      if (existing) {
        if (statusActive(existing) && lower(existing.Name) === lower(record.Name)) {
          skipped += 1;
          continue;
        }
        throw failure(`${schoolClass.Name} / ${template.Name} already exists with different arm settings. Edit that arm instead.`, 409, 'ACADEMIC_BULK_ARM_CONFLICT');
      }
      validateAcademicRecord(projected, 'arm', record, {});
      stampAcademicRecord(record, user);
      projected.arms.push(record);
      createdRecords.push(record);
      writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.arms, documentId: record.ArmId, data: withoutMetadata(record), exists: false });
    }
  }
  const affectedClassIds = new Set(createdRecords.map((row) => row.ClassId));
  classes.filter((row) => affectedClassIds.has(row.ClassId)).forEach((schoolClass) => {
    const compatibility = legacyClassWrite(projected, schoolClass, 'class');
    if (compatibility) writes.push(compatibility);
  });
  if (createdRecords.length) writes.push(auditWrite(user, 'BULK APPLY', 'arm', {
    BranchId: scope.branchId, SchoolSection: scope.section, ArmId: `bulk-${Date.now()}`
  }, `${createdRecords.length} class-arm assignment(s) created; ${skipped} already matched.`));
  await commitAcademicBatch(env, writes, 'The class or arm catalogue changed while assignments were being saved. Reload and try again.');
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = createdRecords.length
    ? `${createdRecords.length} class-arm assignment${createdRecords.length === 1 ? '' : 's'} created online${skipped ? `; ${skipped} already matched and were skipped` : ''}.`
    : 'Every selected class already has the selected reusable arms.';
  response.bulkResult = { Requested: classIds.length * templateIds.length, Created: createdRecords.length, Skipped: skipped };
  return response;
}

export async function bulkApplyAcademicSubjects(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageStructure');
  const scope = await academicScope(env, user, input, { requireSection: true });
  const classIds = uniqueIds(input.ClassIds || input.ClassId);
  const subjectIds = uniqueIds(input.SubjectIds || input.SubjectId);
  if (!clean(input.SessionId) || !clean(input.TermId)) throw failure('Choose the academic session and term.');
  if (!classIds.length || !subjectIds.length) throw failure('Choose at least one class and one reusable subject.');
  if (classIds.length * subjectIds.length > 200) throw failure('Apply at most 200 class-subject combinations in one batch.');
  const state = await loadAcademicState(env, scope.branchId);
  const projected = { ...state, offerings: [...state.offerings] };
  const classes = classIds.map((id) => assertReference(findById(state.classes, id), 'One selected class is not active.'));
  const subjects = subjectIds.map((id) => assertReference(findById(state.subjects, id), 'One selected subject is not active.'));
  if (classes.some((row) => lower(row.SchoolSection) !== scope.section)) {
    throw failure('Every selected class must belong to the selected school section.', 409, 'ACADEMIC_SECTION_MISMATCH');
  }
  if (scope.section === 'secondary' && classes.some((row) => schoolStageValue(row.SchoolStage, row.SchoolSection, row.Name) !== 'junior-secondary')) {
    throw failure('Bulk subject application in the Secondary section is only for Junior Secondary classes. Configure Senior subjects through departments and Senior choices.', 409, 'ACADEMIC_JUNIOR_SUBJECT_APPLICATION_ONLY');
  }
  if (subjects.some((row) => lower(row.SchoolSection) !== scope.section)) {
    throw failure('Every selected subject must belong to the selected school section.', 409, 'ACADEMIC_SECTION_MISMATCH');
  }
  const writes = [];
  const createdRecords = [];
  let skipped = 0;
  for (const schoolClass of classes) {
    for (const subject of subjects) {
      const record = normalizeAcademicOffering({
        SessionId: input.SessionId, TermId: input.TermId, ClassId: schoolClass.ClassId,
        ArmId: '', SubjectId: subject.SubjectId,
        SubjectRole: scope.section === 'secondary' ? 'Core' : (input.SubjectRole || input.RequirementType || 'Core'),
        Compulsory: scope.section === 'secondary' ? true : input.Compulsory,
        Status: 'Active'
      }, scope);
      validateAcademicRecord(projected, 'offering', record, {});
      const existing = findById(projected.offerings, record.OfferingId);
      if (existing) {
        if (sameSetupRecord(existing, record, ['SessionId', 'TermId', 'ClassId', 'ArmId', 'SubjectId'])
          && academicOfferingSubjectRole(existing, record.SchoolStage) === record.SubjectRole) {
          skipped += 1;
          continue;
        }
        throw failure(`${schoolClass.Name} / ${subject.Name} already exists with different offering settings. Edit that offering instead.`, 409, 'ACADEMIC_BULK_SUBJECT_OFFERING_CONFLICT');
      }
      stampAcademicRecord(record, user);
      projected.offerings.push(record);
      createdRecords.push(record);
      writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.offerings, documentId: record.OfferingId, data: withoutMetadata(record), exists: false });
    }
  }
  if (createdRecords.length) writes.push(auditWrite(user, 'BULK APPLY', 'offering', {
    BranchId: scope.branchId, SchoolSection: scope.section,
    SessionId: clean(input.SessionId), TermId: clean(input.TermId), OfferingId: `bulk-${Date.now()}`
  }, `${createdRecords.length} class-subject offering(s) created; ${skipped} already matched.`));
  await commitAcademicBatch(env, writes, 'The class or subject catalogue changed while offerings were being saved. Reload and try again.');
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = createdRecords.length
    ? `${createdRecords.length} class-subject offering${createdRecords.length === 1 ? '' : 's'} created online${skipped ? `; ${skipped} already matched and were skipped` : ''}.`
    : 'Every selected class already has the selected reusable subjects.';
  response.bulkResult = { Requested: classIds.length * subjectIds.length, Created: createdRecords.length, Skipped: skipped };
  return response;
}

export async function bulkAssignAcademicSubjectTeacher(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageAllocations');
  const scope = await academicScope(env, user, input, { requireSection: true });
  const classroomIds = uniqueIds(input.ClassroomIds || input.ArmIds || input.ArmId);
  const sessionId = clean(input.SessionId);
  const termId = clean(input.TermId);
  const teacherUsername = lower(input.TeacherUsername || input.Username);
  const subjectId = clean(input.SubjectId);
  if (!sessionId || !termId || !teacherUsername || !subjectId) {
    throw failure('Choose the session, term, teacher and subject.');
  }
  if (!classroomIds.length) {
    throw failure('Choose at least one classroom.');
  }
  if (classroomIds.length > 200) {
    throw failure('Assign at most 200 classrooms in one batch.');
  }
  const [state, people] = await Promise.all([loadAcademicState(env, scope.branchId), loadPeople(env, user, scope)]);
  const projected = { ...state, teacherAllocations: [...state.teacherAllocations] };
  const classrooms = classroomIds.map((id) => assertReference(findById(state.arms, id), 'One selected classroom is not active.'));
  const subject = assertReference(findById(state.subjects, subjectId), 'The selected subject is not active.');
  if (lower(subject.SchoolSection) !== scope.section) {
    throw failure('The subject must belong to the selected school section.', 409, 'ACADEMIC_SECTION_MISMATCH');
  }
  const writes = [];
  let created = 0;
  let restored = 0;
  let skipped = 0;
  for (const classroom of classrooms) {
    if (!activeValue(classroom.IsClassroom, false)) {
      throw failure(`${classroom.Name} is an arm definition, not an opened classroom.`, 409, 'ACADEMIC_CLASSROOM_REQUIRED');
    }
    const schoolClass = assertReference(findById(state.classes, classroom.ClassId), 'The class for one selected classroom is not active.');
    if (lower(schoolClass.SchoolSection) !== scope.section || lower(classroom.SchoolSection) !== scope.section) {
      throw failure('Every selected classroom must belong to the selected school section.', 409, 'ACADEMIC_SECTION_MISMATCH');
    }
    const candidate = normalizeAcademicTeacherAllocation({
      SessionId: sessionId, TermId: termId, TeacherUsername: teacherUsername,
      ClassId: schoolClass.ClassId, ArmId: classroom.ArmId, SubjectId: subject.SubjectId,
      AllocationRole: 'Subject Teacher', Status: 'Active'
    }, scope);
    const existing = findById(projected.teacherAllocations, candidate.AllocationId);
    if (existing && statusActive(existing)) {
      skipped += 1;
      continue;
    }
    const record = existing
      ? normalizeAcademicTeacherAllocation({ ...candidate, Status: 'Active' }, scope, existing)
      : candidate;
    if (existing) {
      delete record.ArchivedAt;
      delete record.ArchivedBy;
    }
    validateAcademicRecord(projected, 'teacherallocation', record, { ...people, existing });
    stampAcademicRecord(record, user, existing);
    if (existing) {
      projected.teacherAllocations = projected.teacherAllocations.map((row) => recordId(row) === record.AllocationId ? record : row);
      writes.push({
        collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.teacherAllocations,
        documentId: record.AllocationId, data: withoutMetadata(record), updateTime: clean(existing.__updateTime)
      });
      restored += 1;
    } else {
      projected.teacherAllocations.push(record);
      writes.push({
        collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.teacherAllocations,
        documentId: record.AllocationId, data: withoutMetadata(record), exists: false
      });
      created += 1;
    }
  }
  if (created || restored) {
    writes.push(auditWrite(user, 'BULK ASSIGN', 'teacherallocation', {
      BranchId: scope.branchId, SchoolSection: scope.section, SessionId: sessionId, TermId: termId,
      TeacherUsername: teacherUsername, SubjectId: subject.SubjectId, AllocationId: `bulk-${Date.now()}`
    }, `${created} subject-teacher allocation(s) created; ${restored} restored; ${skipped} already active.`));
  }
  await commitAcademicBatch(env, writes, 'A selected class, arm or teacher allocation changed while the batch was being saved. Reload and try again.');
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = created || restored
    ? `${created + restored} subject-teacher assignment${created + restored === 1 ? '' : 's'} saved online${skipped ? `; ${skipped} already existed` : ''}. Repeat for another subject if needed.`
    : 'Every selected subject-teacher assignment already exists.';
  response.bulkResult = { Requested: classroomIds.length, Created: created, Restored: restored, Skipped: skipped };
  return response;
}

export async function updateAcademicSubjectTeacherAllocation(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageAllocations');
  const scope = await academicScope(env, user, input, { requireSection: true });
  const recordIdToReplace = clean(input.RecordId || input.AllocationId);
  const revisionToken = clean(input.RevisionToken);
  if (!recordIdToReplace || !revisionToken) throw failure('Reload the saved allocation before editing it.');
  const [state, people] = await Promise.all([loadAcademicState(env, scope.branchId), loadPeople(env, user, scope)]);
  const existing = findById(state.teacherAllocations, recordIdToReplace);
  if (!existing) throw failure('The subject-teacher allocation was not found in the selected branch.', 404);
  if (existing.AllocationRole !== 'Subject Teacher') throw failure('Form and Assistant Teachers must be changed inside their classroom.');
  if (lower(existing.SchoolSection) !== scope.section) throw failure('This allocation belongs to another school section.', 403);
  const precondition = writePrecondition(existing, revisionToken);
  const classroom = assertReference(findById(state.arms, input.ClassroomId || input.ArmId), 'Choose an active classroom.');
  if (!activeValue(classroom.IsClassroom, false)) {
    throw failure(`${classroom.Name} is an arm definition, not an opened classroom.`, 409, 'ACADEMIC_CLASSROOM_REQUIRED');
  }
  const schoolClass = assertReference(findById(state.classes, classroom.ClassId), 'The selected classroom class is not active.');
  if (lower(classroom.SchoolSection) !== scope.section || lower(schoolClass.SchoolSection) !== scope.section) {
    throw failure('The selected classroom belongs to another school section.', 409, 'ACADEMIC_SECTION_MISMATCH');
  }
  const record = normalizeAcademicTeacherAllocation({
    ...input, RecordId: '', AllocationId: '', ClassId: schoolClass.ClassId, ArmId: classroom.ArmId,
    AllocationRole: 'Subject Teacher', Status: clean(input.Status) || 'Active'
  }, scope);
  const duplicate = state.teacherAllocations.find((row) => recordId(row) !== recordId(existing) && statusActive(row)
    && row.SessionId === record.SessionId && row.TermId === record.TermId
    && row.TeacherUsername === record.TeacherUsername && row.ClassId === record.ClassId
    && row.ArmId === record.ArmId && row.SubjectId === record.SubjectId
    && row.AllocationRole === 'Subject Teacher');
  if (duplicate) throw failure('This subject-teacher allocation already exists.', 409, 'ACADEMIC_TEACHER_ALLOCATION_DUPLICATE');
  validateAcademicRecord(state, 'teacherallocation', record, { ...people, existing });
  stampAcademicRecord(record, user, existing);
  const changedIdentity = recordId(record) !== recordId(existing);
  const writes = changedIdentity
    ? [
      { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.teacherAllocations, documentId: recordId(existing), operation: 'delete', ...precondition },
      { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.teacherAllocations, documentId: recordId(record), data: withoutMetadata(record), exists: false }
    ]
    : [{
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.teacherAllocations,
      documentId: recordId(existing), data: withoutMetadata(record), ...precondition
    }];
  writes.push(auditWrite(user, 'UPDATE', 'teacherallocation', record, `${record.TeacherUsername} · ${record.SubjectId}`));
  await commitAcademicBatch(env, writes, 'This subject-teacher allocation changed while it was being updated. Reload and try again.');
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = 'Subject-teacher allocation updated online.';
  return response;
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
    const record = normalizeAcademicStudentMembership({
      ...input, StudentRef: studentRef, Status: 'Active', SubjectIds: [], CoreSubjectIds: [], TradeSubjectIds: [], OptionalSubjectIds: []
    }, scope, existing);
    validateAcademicRecord(projected, 'studentmembership', record, {
      ...people, existing, allowIncompleteCurriculum: true
    });
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
    writes.push(movementWrite(user, academicMovementForState(projected, { ...input, StudentRef: studentRef }, scope, null, record)));
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

export async function bulkImportAcademicStudentMemberships(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageAllocations');
  const scope = await academicScope(env, user, input, { requireSection: true });
  const rows = normalizeAcademicStudentImportRows(input.Rows || input.StudentMemberships || input.Students);
  if (!rows.length) throw failure('The student membership CSV has no data rows.');
  if (rows.length > 100) throw failure('Import at most 100 student memberships at a time.');
  const sessionId = clean(input.SessionId);
  const termId = clean(input.TermId);
  if (!sessionId || !termId) throw failure('Choose the academic session and term for this import.');
  const [state, people, allStudents] = await Promise.all([
    loadAcademicState(env, scope.branchId),
    loadPeople(env, user, scope),
    listSchoolCollection(env, 'students')
  ]);
  const session = assertReference(findById(state.sessions, sessionId), 'The selected session is not active.');
  const term = assertReference(findById(state.terms, termId), 'The selected term is not active.');
  if (term.SessionId !== session.SessionId) throw failure('The selected term does not belong to this academic session.');
  const projected = { ...state, studentMemberships: [...state.studentMemberships] };
  const writes = [];
  const skipped = [];
  const imported = [];
  const createdProfiles = [];
  const seenStudents = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;
    try {
      if (!row.StudentRef) throw failure(`Row ${rowNumber}: enter the student admission or account reference.`);
      const studentKey = lower(row.StudentRef);
      if (seenStudents.has(studentKey)) throw failure(`Row ${rowNumber}: ${row.StudentRef} appears more than once in this import.`);
      seenStudents.add(studentKey);
      const schoolClass = academicImportReference(
        state.classes.filter((candidate) => lower(candidate.SchoolSection) === scope.section),
        row.ClassCode,
        ['ClassId', 'RecordId', 'Code', 'Name', 'LegacyDocumentId'],
        'class code',
        rowNumber
      );
      const arm = academicImportReference(
        state.arms.filter((candidate) => candidate.ClassId === schoolClass.ClassId),
        row.ArmCode,
        ['ArmId', 'RecordId', 'Code', 'Name'],
        'arm code',
        rowNumber
      );
      let student = people.students.find((candidate) => lower(studentReference(candidate)) === studentKey);
      let createdProfile = null;
      if (!student) {
        const conflictingStudent = allStudents.find((candidate) => lower(studentReference(candidate)) === studentKey);
        if (conflictingStudent) {
          const conflictingBranch = safeScopeId(conflictingStudent.BranchId || conflictingStudent.branchId || 'main');
          const conflictingSection = schoolSectionFor(conflictingStudent);
          throw failure(
            `Row ${rowNumber}: student "${row.StudentRef}" already exists in branch "${conflictingBranch}", ${conflictingSection}. Switch to that scope or correct the student profile first.`,
            409,
            'ACADEMIC_IMPORT_STUDENT_SCOPE_CONFLICT'
          );
        }
        if (!row.StudentName) {
          throw failure(`Row ${rowNumber}: enter StudentName so a profile can be created for "${row.StudentRef}".`, 400, 'ACADEMIC_IMPORT_STUDENT_NAME_REQUIRED');
        }
        const documentId = academicStudentDocumentId(row.StudentRef);
        const documentConflict = allStudents.find((candidate) => lower(candidate.__id) === lower(documentId));
        if (documentConflict) {
          throw failure(`Row ${rowNumber}: student reference "${row.StudentRef}" conflicts with another student record.`, 409, 'ACADEMIC_IMPORT_STUDENT_ID_CONFLICT');
        }
        createdProfile = importedAcademicStudentProfile(row, scope, schoolClass, arm, session, term, user);
        student = createdProfile;
        people.students.push(student);
        allStudents.push(student);
      }
      const schoolStage = schoolStageValue(schoolClass.SchoolStage, schoolClass.SchoolSection, schoolClass.Name);
      let departmentId = '';
      if (schoolStage === 'senior-secondary' && row.DepartmentCode) {
        departmentId = academicImportReference(
          state.departments.filter((candidate) => candidate.SchoolStage === 'senior-secondary'),
          row.DepartmentCode,
          ['DepartmentId', 'RecordId', 'Code', 'Name'],
          'Senior department code',
          rowNumber
        ).DepartmentId;
      }
      const resolveSubjectIds = (codes, label) => codes.map((code) => academicImportReference(
        state.subjects.filter((candidate) => lower(candidate.SchoolSection) === scope.section),
        code,
        ['SubjectId', 'RecordId', 'Code', 'Name'],
        label,
        rowNumber
      ).SubjectId);
      const tradeSubjectIds = resolveSubjectIds(row.TradeSubjectCodes, 'Trade subject code');
      const optionalSubjectIds = resolveSubjectIds(row.OptionalSubjectCodes, 'optional subject code');
      const existingId = academicId('student', scope.branchId, scope.section, sessionId, termId, row.StudentRef);
      const existing = findById(projected.studentMemberships, existingId);
      const record = normalizeAcademicStudentMembership({
        SessionId: sessionId, TermId: termId, StudentRef: row.StudentRef,
        ClassId: schoolClass.ClassId, ArmId: arm.ArmId, DepartmentId: departmentId,
        SubjectIds: [...tradeSubjectIds, ...optionalSubjectIds], CoreSubjectIds: [],
        TradeSubjectIds: tradeSubjectIds, OptionalSubjectIds: optionalSubjectIds, CurriculumStatus: '', Status: 'Active'
      }, scope, existing);
      validateAcademicRecord(projected, 'studentmembership', record, {
        ...people, existing, allowIncompleteCurriculum: true
      });
      if (createdProfile) {
        const department = findById(projected.departments, record.DepartmentId);
        createdProfile.AcademicDepartmentId = clean(record.DepartmentId);
        createdProfile.AcademicDepartment = clean(department?.Name);
        createdProfile.AcademicDepartmentCode = clean(department?.Code);
        createdProfile.AcademicMembershipId = clean(record.MembershipId);
        createdProfile.AcademicEnrollmentStatus = clean(record.Status);
        createdProfile.SchoolStage = clean(record.SchoolStage || schoolClass.SchoolStage);
        createdProfiles.push(createdProfile);
        writes.push({
          collectionPath: createdProfile.__scopePath,
          documentId: createdProfile.__id,
          data: withoutMetadata(createdProfile),
          exists: false
        });
      }
      if (existing) {
        if (!membershipMateriallyChanged(existing, record)) {
          skipped.push(row.StudentRef);
          continue;
        }
        throw failure(`${row.StudentRef} already has a different membership in this term. Use the transfer workflow instead.`, 409, 'ACADEMIC_IMPORT_MEMBERSHIP_CONFLICT');
      }
      stampAcademicRecord(record, user);
      projected.studentMemberships.push(record);
      imported.push(record);
      writes.push({
        collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentMemberships,
        documentId: record.MembershipId, data: withoutMetadata(record), exists: false
      });
      writes.push(movementWrite(user, academicMovementForState(projected, {
        ...input, StudentRef: row.StudentRef,
        Reason: row.Reason || clean(input.Reason) || 'Imported into Academic Management.'
      }, scope, null, record)));
      const compatibility = studentCompatibilityWrite(people, projected, record);
      if (compatibility) writes.push(compatibility);
    } catch (error) {
      if (clean(error?.message).startsWith(`Row ${rowNumber}:`)) throw error;
      throw failure(`Row ${rowNumber}: ${clean(error?.message) || 'The membership is invalid.'}`, Number(error?.status) || 400, clean(error?.code));
    }
  }

  if (imported.length || createdProfiles.length) {
    writes.push(auditWrite(user, 'BULK IMPORT', 'studentmembership', {
      BranchId: scope.branchId, SchoolSection: scope.section,
      SessionId: sessionId, TermId: termId, MembershipId: `import-${Date.now()}`
    }, `${imported.length} student membership(s) imported; ${createdProfiles.length} incomplete student profile(s) created; ${skipped.length} exact match(es) skipped.`));
    await commitAcademicBatch(env, writes, 'A selected student changed while the CSV was being imported. Reload and try again.');
  }
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = imported.length || createdProfiles.length
    ? `${imported.length} student membership${imported.length === 1 ? '' : 's'} imported online${createdProfiles.length ? `; ${createdProfiles.length} missing student profile${createdProfiles.length === 1 ? '' : 's'} created for completion in Students` : ''}${skipped.length ? `; ${skipped.length} exact match${skipped.length === 1 ? '' : 'es'} skipped` : ''}.`
    : 'Every CSV row already has this exact academic membership.';
  response.importResult = {
    Requested: rows.length,
    Imported: imported.length,
    ProfilesCreated: createdProfiles.length,
    Skipped: skipped.length
  };
  return response;
}

export async function bulkAssignAcademicArmStudentSubjects(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  requireCapability(user, 'canManageAllocations');
  const scope = await academicScope(env, user, input, { requireSection: true });
  let assignments = input.Assignments || input.StudentSubjectAssignments || [];
  if (typeof assignments === 'string') {
    try { assignments = JSON.parse(assignments); } catch (_error) { assignments = []; }
  }
  if (!Array.isArray(assignments) || !assignments.length) throw failure('Choose at least one student subject selection to save.');
  if (assignments.length > 200) throw failure('Update at most 200 student subject selections in one arm batch.');
  const sessionId = clean(input.SessionId);
  const termId = clean(input.TermId);
  const classId = clean(input.ClassId);
  const armId = clean(input.ArmId);
  if (!sessionId || !termId || !classId || !armId) throw failure('Choose the session, term, Senior Secondary class and arm.');
  const state = await loadAcademicState(env, scope.branchId);
  const session = assertReference(findById(state.sessions, sessionId), 'The selected session is not active.');
  const term = assertReference(findById(state.terms, termId), 'The selected term is not active.');
  if (term.SessionId !== session.SessionId) throw failure('The selected term does not belong to this academic session.');
  const schoolClass = assertReference(findById(state.classes, classId), 'The selected class is not active.');
  if (schoolClass.SchoolSection !== scope.section) throw failure('The selected class belongs to another school section.');
  const schoolStage = schoolStageValue(schoolClass.SchoolStage, schoolClass.SchoolSection, schoolClass.Name);
  if (schoolStage !== 'senior-secondary') throw failure('Trade and optional subject selection is available only for Senior Secondary classes.');
  const arm = assertReference(findById(state.arms, armId), 'The selected class arm is not active.');
  if (arm.ClassId !== classId) throw failure('The selected class arm does not belong to this class.');

  const projected = { ...state, studentMemberships: [...state.studentMemberships] };
  const writes = [];
  const skipped = [];
  const seen = new Set();
  const reason = clean(input.Reason) || 'Arm-level Trade and optional subject selection updated.';
  for (const assignment of assignments) {
    const membershipId = clean(assignment?.MembershipId || assignment?.RecordId);
    if (!membershipId || seen.has(lower(membershipId))) throw failure('Every student subject selection must identify one unique membership.');
    seen.add(lower(membershipId));
    const existing = findById(projected.studentMemberships, membershipId);
    if (!existing || !statusActive(existing)) throw failure('One selected student membership is not active.', 409, 'ACADEMIC_REFERENCE_INVALID');
    if (existing.SessionId !== sessionId || existing.TermId !== termId || existing.ClassId !== classId || existing.ArmId !== armId) {
      throw failure(`${existing.StudentRef || 'A selected student'} does not belong to the selected class arm and period.`, 409, 'ACADEMIC_MEMBERSHIP_SCOPE_MISMATCH');
    }
    const revisionToken = clean(assignment.RevisionToken);
    if (!revisionToken || revisionToken !== clean(existing.__updateTime)) {
      throw failure(`${existing.StudentRef || 'A selected student'} changed after this arm register was loaded. Reload before saving.`, 409, 'ACADEMIC_WRITE_CONFLICT');
    }
    const tradeSubjectIds = uniqueIds(assignment.TradeSubjectIds);
    const optionalSubjectIds = uniqueIds(assignment.OptionalSubjectIds);
    const record = normalizeAcademicStudentMembership({
      ...withoutMetadata(existing), SubjectIds: [...tradeSubjectIds, ...optionalSubjectIds],
      CoreSubjectIds: [], TradeSubjectIds: tradeSubjectIds, OptionalSubjectIds: optionalSubjectIds,
      CurriculumStatus: '', Status: existing.Status
    }, scope, existing);
    record.SchoolStage = schoolStage;
    applyAcademicStudentCurriculum(projected, record, { requireTradeSelection: true });
    if (!membershipMateriallyChanged(existing, record)) {
      skipped.push(existing.StudentRef);
      continue;
    }
    stampAcademicRecord(record, user, existing);
    projected.studentMemberships = projected.studentMemberships.map((row) => recordId(row) === membershipId ? record : row);
    writes.push({
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentMemberships,
      documentId: membershipId, data: withoutMetadata(record), updateTime: revisionToken
    });
    writes.push(movementWrite(user, academicMovementForState(projected, {
      ...input, StudentRef: existing.StudentRef, Reason: reason, MovementType: 'Subject Change'
    }, scope, existing, record)));
  }
  const updated = assignments.length - skipped.length;
  if (updated) {
    writes.push(auditWrite(user, 'BULK SUBJECT ASSIGNMENT', 'studentmembership', {
      BranchId: scope.branchId, SchoolSection: scope.section, SessionId: sessionId, TermId: termId,
      MembershipId: `arm-subjects-${Date.now()}`
    }, `${updated} student subject selection(s) updated in ${schoolClass.Name} / ${arm.Name}; ${skipped.length} unchanged.`));
    try {
      await batchCommitDocuments(env, writes);
    } catch (error) {
      if ([409, 412].includes(Number(error?.status))) {
        throw failure('A student membership changed while arm subjects were being saved. Reload and try again.', 409, 'ACADEMIC_WRITE_CONFLICT');
      }
      throw error;
    }
  }
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = updated
    ? `${updated} student subject selection${updated === 1 ? '' : 's'} saved online${skipped.length ? `; ${skipped.length} unchanged` : ''}.`
    : 'Every student already has the selected Trade and optional subjects.';
  response.bulkResult = { Requested: assignments.length, Updated: updated, Skipped: skipped.length };
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
    const reassigningWithdrawn = !reinstating && lower(existing.Status) === 'withdrawn';
    if (reinstating && lower(existing.Status) !== 'withdrawn') throw failure('Only a withdrawn membership can be reinstated.', 409);
    if (!reinstating && !statusActive(existing) && !reassigningWithdrawn) throw failure('Only an active or withdrawn membership can be transferred or changed.', 409);
    record = normalizeAcademicStudentMembership({
      ...input, SessionId: existing.SessionId, TermId: existing.TermId,
      StudentRef: existing.StudentRef, Status: 'Active'
    }, scope, existing);
    validateAcademicRecord(state, 'studentmembership', record, { ...people, existing });
    if (reassigningWithdrawn && existing.ClassId === record.ClassId && existing.ArmId === record.ArmId) {
      throw failure('Choose a different classroom, or use Reinstate to restore the student to the original classroom.');
    }
    if (!reinstating && !membershipMateriallyChanged(existing, record)) {
      throw failure('Choose a different class, arm, department or subject allocation before recording a movement.');
    }
    if (reinstating || reassigningWithdrawn) {
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
  if (type === 'department') return [...state.arms, ...state.studentMemberships].filter((row) => row.DepartmentId === id && statusActive(row));
  if (type === 'offering') return [...state.teacherAllocations, ...state.studentMemberships].filter((row) => row.SessionId === record.SessionId && row.TermId === record.TermId && row.ClassId === record.ClassId && (row.SubjectId === record.SubjectId || (row.SubjectIds || []).includes(record.SubjectId)) && statusActive(row));
  return [];
}

export function academicPermanentDeleteDependants(state = {}, typeValue = '', record = {}) {
  const type = normalizedRecordType(typeValue);
  const id = recordId(record);
  if (type === 'class') {
    return [
      ...(state.classes || []).filter((row) => recordId(row) !== id && row.NextClassId === id),
      ...(state.arms || []).filter((row) => row.ClassId === id),
      ...(state.offerings || []).filter((row) => row.ClassId === id),
      ...(state.teacherAllocations || []).filter((row) => row.ClassId === id),
      ...(state.studentMemberships || []).filter((row) => row.ClassId === id),
      ...(state.studentMovements || []).filter((row) => row.FromClassId === id || row.ToClassId === id)
    ];
  }
  if (type === 'armtemplate') {
    return (state.arms || []).filter((row) => row.ArmTemplateId === id);
  }
  if (type === 'arm') {
    return [
      ...(state.offerings || []).filter((row) => row.ArmId === id),
      ...(state.teacherAllocations || []).filter((row) => row.ArmId === id),
      ...(state.studentMemberships || []).filter((row) => row.ArmId === id),
      ...(state.studentMovements || []).filter((row) => row.FromArmId === id || row.ToArmId === id)
    ];
  }
  if (type === 'subject') {
    const usesSubject = (row) => row.SubjectId === id
      || (row.SubjectIds || []).includes(id)
      || (row.CoreSubjectIds || []).includes(id)
      || (row.FromSubjectIds || []).includes(id)
      || (row.ToSubjectIds || []).includes(id);
    return [
      ...(state.departments || []).filter(usesSubject),
      ...(state.offerings || []).filter(usesSubject),
      ...(state.teacherAllocations || []).filter(usesSubject),
      ...(state.studentMemberships || []).filter(usesSubject),
      ...(state.studentMovements || []).filter(usesSubject)
    ];
  }
  if (type === 'department') {
    return [
      ...(state.arms || []).filter((row) => row.DepartmentId === id),
      ...(state.studentMemberships || []).filter((row) => row.DepartmentId === id),
      ...(state.studentMovements || []).filter((row) => row.FromDepartmentId === id || row.ToDepartmentId === id)
    ];
  }
  if (type === 'offering') {
    const matchesPeriod = (row) => row.SessionId === record.SessionId && row.TermId === record.TermId;
    const matchesArm = (armId) => !record.ArmId || armId === record.ArmId;
    return [
      ...(state.teacherAllocations || []).filter((row) => matchesPeriod(row) && row.ClassId === record.ClassId
        && row.SubjectId === record.SubjectId && matchesArm(row.ArmId)),
      ...(state.studentMemberships || []).filter((row) => matchesPeriod(row) && row.ClassId === record.ClassId
        && (row.SubjectIds || []).includes(record.SubjectId) && matchesArm(row.ArmId)),
      ...(state.studentMovements || []).filter((row) => matchesPeriod(row) && (
        (row.FromClassId === record.ClassId && (row.FromSubjectIds || []).includes(record.SubjectId) && matchesArm(row.FromArmId))
        || (row.ToClassId === record.ClassId && (row.ToSubjectIds || []).includes(record.SubjectId) && matchesArm(row.ToArmId))
      ))
    ];
  }
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
  const requiresSection = !['session', 'term', 'armtemplate'].includes(type);
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

export async function deleteAcademicManagementRecord(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  const type = normalizedRecordType(input.RecordType || input.recordType || input.Type);
  requireCapability(user, type === 'teacherallocation' ? 'canManageAllocations' : 'canDelete');
  if (!['class', 'armtemplate', 'arm', 'subject', 'department', 'offering', 'teacherallocation'].includes(type)) {
    throw failure('Only an unused structure record, subject offering or teacher allocation can be permanently deleted.');
  }
  const definition = RECORD_TYPES[type];
  const requiresSection = type !== 'armtemplate';
  const scope = await academicScope(env, user, input, { requireSection: requiresSection });
  const state = await loadAcademicState(env, scope.branchId);
  const stateKey = Object.keys(ACADEMIC_MANAGEMENT_COLLECTIONS).find((key) => ACADEMIC_MANAGEMENT_COLLECTIONS[key] === definition.collection);
  const existing = findById(state[stateKey] || [], input.RecordId);
  if (!existing) throw failure('The academic record was not found in the selected branch.', 404);
  if (requiresSection && lower(existing.SchoolSection) !== scope.section) throw failure('This academic record belongs to another school section.', 403);
  const dependants = academicPermanentDeleteDependants(state, type, existing);
  if (dependants.length) {
    const label = type === 'armtemplate' ? 'reusable arm definition' : (type === 'offering' ? 'subject offering' : type);
    throw failure(`This ${label} is referenced by ${dependants.length} academic record${dependants.length === 1 ? '' : 's'}. Remove those references or archive this record instead.`, 409, 'ACADEMIC_DELETE_REFERENCED');
  }
  const revisionToken = clean(input.RevisionToken);
  if (!revisionToken || revisionToken !== clean(existing.__updateTime)) {
    throw failure('This academic record changed after it was loaded. Reload before deleting.', 409, 'ACADEMIC_WRITE_CONFLICT');
  }
  const deletedLabel = type === 'offering' ? 'Subject offering'
    : (type === 'teacherallocation' ? 'Subject-teacher allocation' : clean(existing.Name || existing.Code || 'Academic record'));
  const writes = [
    { collectionPath: definition.collection, documentId: recordId(existing), operation: 'delete', updateTime: revisionToken },
    auditWrite(user, 'DELETE', type, existing, deletedLabel)
  ];
  if (type === 'class') {
    writes.push({
      collectionPath: 'settings/academics/classes',
      documentId: clean(existing.LegacyDocumentId) || legacyDocumentId(existing.Name),
      operation: 'delete'
    });
  }
  if (type === 'arm') {
    const projected = { ...state, arms: state.arms.filter((row) => recordId(row) !== recordId(existing)) };
    const schoolClass = findById(projected.classes, existing.ClassId);
    const compatibility = schoolClass ? legacyClassWrite(projected, schoolClass, 'class') : null;
    if (compatibility) writes.push(compatibility);
  }
  await commitAcademicBatch(env, writes, 'This academic record changed while it was being deleted. Reload and try again.');
  const response = await bootstrapAcademicManagement(env, user, { ...input, BranchId: scope.branchId, SchoolSection: scope.section });
  response.message = `${deletedLabel} deleted permanently online.`;
  return response;
}

export async function handleAcademicManagementAction(env, user = {}, input = {}) {
  const action = lower(input.action || input.Action).replace(/[^a-z]/g, '');
  if (['bootstrap', 'list', 'getacademicmanagement'].includes(action)) return bootstrapAcademicManagement(env, user, input);
  if (['save', 'saverecord', 'saveacademicsession', 'saveacademicterm', 'saveacademicclass', 'saveacademicarmtemplate', 'saveacademicarm', 'saveacademicsubject', 'saveacademicdepartment', 'saveacademicoffering', 'saveacademicteacherallocation', 'saveacademicstudentmembership'].includes(action)) {
    const inferredType = ({
      saveacademicsession: 'session', saveacademicterm: 'term', saveacademicclass: 'class', saveacademicarm: 'arm',
      saveacademicarmtemplate: 'armTemplate',
      saveacademicsubject: 'subject', saveacademicdepartment: 'department', saveacademicoffering: 'offering', saveacademicteacherallocation: 'teacherAllocation',
      saveacademicstudentmembership: 'studentMembership'
    })[action];
    return saveAcademicManagementRecord(env, user, { ...input, RecordType: input.RecordType || inferredType });
  }
  if (['bulkcreateacademicclasses', 'bulkcreateclasses'].includes(action)) return bulkCreateAcademicClasses(env, user, input);
  if (['bulkcreateacademicarmtemplates', 'bulkcreatearmtemplates'].includes(action)) return bulkCreateAcademicArmTemplates(env, user, input);
  if (['bulkapplyacademicarmtemplates', 'bulkapplyarmtemplates'].includes(action)) return bulkApplyAcademicArmTemplates(env, user, input);
  if (['bulkcreateacademicsubjects', 'bulkcreatesubjects'].includes(action)) return bulkCreateAcademicSubjects(env, user, input);
  if (['configureacademicseniorchoicesubjects', 'configureseniorchoicesubjects'].includes(action)) return configureAcademicSeniorChoiceSubjects(env, user, input);
  if (['bulkapplyacademicsubjects', 'bulkapplysubjects'].includes(action)) return bulkApplyAcademicSubjects(env, user, input);
  if (['bulkassignacademicsubjectteacher', 'bulkassignsubjectteacher'].includes(action)) return bulkAssignAcademicSubjectTeacher(env, user, input);
  if (['updateacademicsubjectteacherallocation', 'updatesubjectteacherallocation'].includes(action)) return updateAcademicSubjectTeacherAllocation(env, user, input);
  if (['bulkallocateacademicstudents', 'bulkallocatestudents'].includes(action)) return bulkAllocateAcademicStudents(env, user, input);
  if (['bulkimportacademicstudentmemberships', 'importacademicstudentmemberships'].includes(action)) return bulkImportAcademicStudentMemberships(env, user, input);
  if (['bulkassignacademicarmstudentsubjects', 'bulkassignarmstudentsubjects'].includes(action)) return bulkAssignAcademicArmStudentSubjects(env, user, input);
  if (['manageacademicstudentmembership', 'moveacademicstudentmembership', 'withdrawacademicstudentmembership', 'reinstateacademicstudentmembership'].includes(action)) {
    const inferredOperation = ({
      withdrawacademicstudentmembership: 'withdraw',
      reinstateacademicstudentmembership: 'reinstate',
      moveacademicstudentmembership: 'transfer'
    })[action];
    return manageAcademicStudentMembership(env, user, { ...input, Operation: input.Operation || inferredOperation });
  }
  if (['archive', 'archiverecord', 'archiveacademicrecord'].includes(action)) return archiveAcademicManagementRecord(env, user, input);
  if (['delete', 'deleterecord', 'deleteacademicrecord'].includes(action)) return deleteAcademicManagementRecord(env, user, input);
  throw failure('Choose a valid Academic Management action.');
}
