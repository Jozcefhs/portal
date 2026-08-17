import { batchCommitDocuments, getDocument, listCollection } from './firestore.js';
import { enforceActorBranch } from './branch-scope.js';
import { normalizeClassKey } from './class-names.js';
import { staffRecordMatchesEdition } from './records-desk.js';
import { createNotification } from './notifications.js';
import { academicCumulativePolicyIssues, academicPolicyIssues, academicPolicyScopeChain, normalizeAcademicPolicy } from './academic-policy.js';
import { loadAcademicPolicyView } from './academic-policy-store.js';
import { resolveDocumentStorage } from './document-storage.js';
import { safeStoredDocument } from './document-files.js';
import { academicCbtPaperDigest } from './academic-cbt-papers.js';
import { getStudentLoginCredential } from './student-login-credentials.js';
import {
  STUDENT_FACE_MODEL_ID,
  decryptFaceDescriptor,
  faceTemplateIsUsable,
  studentFaceTemplateDocumentId,
  studentFaceTemplateEncryptionSecret,
  studentFaceTemplateMeta
} from './student-face-templates.js';
import {
  getSchoolStructure, listSchoolCollection, safeScopeId, schoolSectionFor, scopedCollectionPath
} from './school-scope.js';
import {
  ACADEMIC_ATTENDANCE_MODES,
  ACADEMIC_ATTENDANCE_STATUSES,
  ACADEMIC_TIMETABLE_VERSION_STATUSES,
  academicTeacherLoadIssues,
  academicAttendanceSummary,
  academicTimetableConflicts,
  normalizeAcademicAttendanceEntries,
  normalizeAcademicTeacherUnavailableSlots,
  normalizeAcademicTimetableDays,
  normalizeAcademicTimetableEntry,
  normalizeAcademicTimetablePeriods
} from './academic-timetable-attendance.js';
import {
  ACADEMIC_SCORE_IMPORT_MODES,
  ACADEMIC_SCORE_SHEET_STATUSES,
  academicAssessmentScheme,
  academicScoreSourceIssues,
  calculateAcademicStudentScore,
  normalizeAcademicComponentScores,
  validateAcademicCbtScoreBatch,
  validateAcademicScoreImport
} from './academic-scorebook.js';
import {
  ACADEMIC_TERM_RESULT_STATUSES,
  academicTermResultTransition,
  calculateAcademicTermResultDrafts
} from './academic-term-results.js';
import {
  ACADEMIC_CUMULATIVE_STATUSES,
  ACADEMIC_PROMOTION_OUTCOMES,
  ACADEMIC_PROMOTION_STATUSES,
  ACADEMIC_TRANSCRIPT_STATUSES,
  academicCumulativeTransition,
  academicPromotionTransition,
  academicTranscriptTransition,
  buildAcademicTranscriptDraft,
  calculateAcademicCumulativeDrafts,
  evaluateAcademicPromotionDecision
} from './academic-session-outcomes.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const identityEncoder = new TextEncoder();

function identityBase64Url(value) {
  const bytes = typeof value === 'string' ? identityEncoder.encode(value) : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function identityBase64UrlBytes(value) {
  const text = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(text + '='.repeat((4 - text.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (_error) {
    throw failure('The local CBT score signature is invalid.', 409, 'ACADEMIC_CBT_SIGNATURE_INVALID');
  }
}

function identityPublicKeyBytes(pem) {
  const normalized = clean(pem)
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '');
  if (!normalized) throw failure('The local CBT encryption key is missing.');
  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (_error) {
    throw failure('The local CBT encryption key is invalid.');
  }
}

export async function encryptLocalCbtIdentityPackage(publicKeyPem, payload, aad) {
  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey(
      'spki',
      identityPublicKeyBytes(publicKeyPem),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  } catch (_error) {
    throw failure('The local CBT encryption key is invalid.');
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const rawKey = await crypto.subtle.exportKey('raw', key);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce, additionalData: identityEncoder.encode(aad)
  }, key, identityEncoder.encode(JSON.stringify(payload)));
  const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey);
  return {
    Version: 'dynamax-local-cbt-identity-v1',
    Algorithm: 'RSA-OAEP-256+A256GCM',
    Aad: aad,
    WrappedKey: identityBase64Url(wrappedKey),
    Nonce: identityBase64Url(nonce),
    Ciphertext: identityBase64Url(ciphertext)
  };
}

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
  timetableSettings: 'academicTimetableSettings',
  timetableConstraints: 'academicTimetableConstraints',
  timetableVersions: 'academicTimetableVersions',
  timetableEntries: 'academicTimetableEntries',
  timetableSubstitutions: 'academicTimetableSubstitutions',
  studentAttendance: 'academicStudentAttendance',
  attendanceCorrections: 'academicAttendanceCorrections',
  scoreSheets: 'academicScoreSheets',
  studentScores: 'academicStudentScores',
  scoreImports: 'academicScoreImports',
  scoreSyncBatches: 'academicScoreSyncBatches',
  cbtTests: 'academicCbtTests',
  termResults: 'academicResults',
  resultEvents: 'academicResultEvents',
  cumulativeResults: 'academicCumulativeResults',
  cumulativeEvents: 'academicCumulativeEvents',
  promotionDecisions: 'academicPromotionDecisions',
  promotionEvents: 'academicPromotionEvents',
  transcripts: 'academicTranscripts',
  transcriptEvents: 'academicTranscriptEvents',
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
const TIMETABLE_MANAGERS = new Set([...STRUCTURE_MANAGERS, 'Examination Officer']);
const TIMETABLE_PUBLISHERS = new Set(['Super Admin', 'Principal', 'Management']);
const SCORE_REVIEWERS = new Set([...STRUCTURE_MANAGERS, 'Examination Officer']);
const SCORE_APPROVERS = new Set([...STRUCTURE_MANAGERS, 'Examination Officer']);

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
    row.RecordId || row.recordId || row.TranscriptEventId || row.TranscriptId || row.PromotionEventId || row.PromotionDecisionId || row.CumulativeEventId || row.CumulativeResultId || row.ResultEventId || row.ResultId || row.CbtTestId || row.ImportId || row.ScoreId || row.SheetId || row.SubstitutionId || row.AttendanceId || row.EntryId || row.VersionId || row.ConstraintId || row.TimetableSettingId
      || row.MovementId || row.MembershipId || row.AllocationId || row.OfferingId
      || row.DepartmentId || row.SubjectId || row.ArmId || row.ArmTemplateId || row.ClassId || row.TermId || row.SessionId || row.__id
  );
}

function statusActive(row = {}) {
  return !['archived', 'inactive', 'closed', 'withdrawn', 'cancelled'].includes(lower(row.Status));
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
    canManageTimetables: enabled && TIMETABLE_MANAGERS.has(role),
    canPublishTimetables: enabled && TIMETABLE_PUBLISHERS.has(role),
    canMarkAttendance: enabled && (TIMETABLE_MANAGERS.has(role) || role === 'Teacher' || academicsDepartmentUser),
    canEnterScores: enabled && (SCORE_REVIEWERS.has(role) || role === 'Teacher' || academicsDepartmentUser),
    canCreateCbt: enabled && (SCORE_REVIEWERS.has(role) || role === 'Teacher' || academicsDepartmentUser),
    canReviewScores: enabled && SCORE_REVIEWERS.has(role),
    canApproveScores: enabled && SCORE_APPROVERS.has(role),
    canCalculateResults: enabled && SCORE_REVIEWERS.has(role),
    canReviewResults: enabled && SCORE_REVIEWERS.has(role),
    canPublishResults: enabled && SCORE_APPROVERS.has(role),
    canCalculateCumulativeResults: enabled && SCORE_REVIEWERS.has(role),
    canManagePromotions: enabled && SCORE_APPROVERS.has(role),
    canIssueTranscripts: enabled && SCORE_APPROVERS.has(role),
    canImportScores: enabled && (SCORE_REVIEWERS.has(role) || role === 'Teacher' || academicsDepartmentUser),
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
    studentMovements: [...state.studentMovements].sort((a, b) => clean(b.RecordedAt || b.EffectiveDate).localeCompare(clean(a.RecordedAt || a.EffectiveDate))),
    timetableSettings: [...state.timetableSettings].sort((a, b) => clean(b.UpdatedAt).localeCompare(clean(a.UpdatedAt))),
    timetableConstraints: [...state.timetableConstraints].sort((a, b) => clean(a.TeacherUsername).localeCompare(clean(b.TeacherUsername))),
    timetableVersions: [...state.timetableVersions].sort((a, b) => clean(b.CreatedAt).localeCompare(clean(a.CreatedAt))),
    timetableEntries: [...state.timetableEntries].sort((a, b) => clean(a.DayCode).localeCompare(clean(b.DayCode))
      || clean(a.StartPeriodCode).localeCompare(clean(b.StartPeriodCode))
      || clean(a.ClassId).localeCompare(clean(b.ClassId))),
    timetableSubstitutions: [...state.timetableSubstitutions].sort((a, b) => clean(b.SubstitutionDate).localeCompare(clean(a.SubstitutionDate))
      || clean(a.TimetableEntryId).localeCompare(clean(b.TimetableEntryId))),
    studentAttendance: [...state.studentAttendance].sort((a, b) => clean(b.AttendanceDate).localeCompare(clean(a.AttendanceDate))
      || clean(a.StudentRef).localeCompare(clean(b.StudentRef))),
    attendanceCorrections: [...state.attendanceCorrections].sort((a, b) => clean(b.RequestedAt).localeCompare(clean(a.RequestedAt))),
    scoreSheets: [...state.scoreSheets].sort((a, b) => clean(a.ClassId).localeCompare(clean(b.ClassId))
      || clean(a.ArmId).localeCompare(clean(b.ArmId)) || clean(a.SubjectId).localeCompare(clean(b.SubjectId))),
    studentScores: [...state.studentScores].sort((a, b) => clean(a.SheetId).localeCompare(clean(b.SheetId))
      || clean(a.StudentRef).localeCompare(clean(b.StudentRef))),
    scoreImports: [...state.scoreImports].sort((a, b) => clean(b.CommittedAt || b.CreatedAt).localeCompare(clean(a.CommittedAt || a.CreatedAt))),
    scoreSyncBatches: [...state.scoreSyncBatches].sort((a, b) => clean(b.SynchronizedAt || b.CreatedAt).localeCompare(clean(a.SynchronizedAt || a.CreatedAt))),
    cbtTests: [...state.cbtTests].sort((a, b) => clean(b.StartsAt || b.CreatedAt).localeCompare(clean(a.StartsAt || a.CreatedAt))),
    termResults: [...state.termResults].sort((a, b) => clean(a.ClassId).localeCompare(clean(b.ClassId))
      || clean(a.ArmId).localeCompare(clean(b.ArmId)) || clean(a.StudentRef).localeCompare(clean(b.StudentRef))),
    resultEvents: [...state.resultEvents].sort((a, b) => clean(b.CreatedAt).localeCompare(clean(a.CreatedAt))),
    cumulativeResults: [...state.cumulativeResults].sort((a, b) => clean(a.ClassId).localeCompare(clean(b.ClassId))
      || clean(a.ArmId).localeCompare(clean(b.ArmId)) || clean(a.StudentRef).localeCompare(clean(b.StudentRef))),
    cumulativeEvents: [...state.cumulativeEvents].sort((a, b) => clean(b.CreatedAt).localeCompare(clean(a.CreatedAt))),
    promotionDecisions: [...state.promotionDecisions].sort((a, b) => clean(a.ClassId).localeCompare(clean(b.ClassId))
      || clean(a.ArmId).localeCompare(clean(b.ArmId)) || clean(a.StudentRef).localeCompare(clean(b.StudentRef))),
    promotionEvents: [...state.promotionEvents].sort((a, b) => clean(b.CreatedAt).localeCompare(clean(a.CreatedAt))),
    transcripts: [...state.transcripts].sort((a, b) => clean(a.StudentName || a.StudentRef).localeCompare(clean(b.StudentName || b.StudentRef))),
    transcriptEvents: [...state.transcriptEvents].sort((a, b) => clean(b.CreatedAt).localeCompare(clean(a.CreatedAt)))
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
    const substituteEntryIds = new Set(state.timetableSubstitutions.filter((row) => lower(row.Status) === 'scheduled'
      && lower(row.SubstituteTeacherUsername) === username).map((row) => row.TimetableEntryId));
    const substituteClassrooms = state.timetableEntries.filter((row) => substituteEntryIds.has(row.EntryId));
    state.teacherAllocations = state.teacherAllocations.filter((row) => lower(row.TeacherUsername) === username);
    const visibleKeys = new Set(state.teacherAllocations.map((row) => `${row.ClassId}|${row.ArmId || '*'}`));
    substituteClassrooms.forEach((row) => visibleKeys.add(`${row.ClassId}|${row.ArmId}`));
    state.studentMemberships = state.studentMemberships.filter((row) => (
      visibleKeys.has(`${row.ClassId}|${row.ArmId}`) || visibleKeys.has(`${row.ClassId}|*`)
    ));
    const visibleStudents = new Set(state.studentMemberships.map((row) => lower(row.StudentRef)));
    state.studentMovements = state.studentMovements.filter((row) => visibleStudents.has(lower(row.StudentRef)));
    const publishedVersions = new Set(state.timetableVersions.filter((row) => lower(row.Status) === 'published').map((row) => row.VersionId));
    state.timetableVersions = state.timetableVersions.filter((row) => publishedVersions.has(row.VersionId));
    state.timetableEntries = state.timetableEntries.filter((row) => publishedVersions.has(row.VersionId)
      && (lower(row.TeacherUsername) === username || substituteEntryIds.has(row.EntryId)
        || visibleKeys.has(`${row.ClassId}|${row.ArmId}`) || visibleKeys.has(`${row.ClassId}|*`)));
    const visibleEntries = new Set(state.timetableEntries.map((row) => row.EntryId));
    state.timetableSubstitutions = state.timetableSubstitutions.filter((row) => visibleEntries.has(row.TimetableEntryId)
      || lower(row.SubstituteTeacherUsername) === username);
    state.timetableConstraints = state.timetableConstraints.filter((row) => lower(row.TeacherUsername) === username);
    state.studentAttendance = state.studentAttendance.filter((row) => visibleStudents.has(lower(row.StudentRef)));
    state.attendanceCorrections = state.attendanceCorrections.filter((row) => lower(row.RequestedByUsername) === username);
    state.scoreSheets = state.scoreSheets.filter((row) => lower(row.TeacherUsername) === username
      || visibleKeys.has(`${row.ClassId}|${row.ArmId}`) || visibleKeys.has(`${row.ClassId}|*`));
    const visibleScoreSheets = new Set(state.scoreSheets.map((row) => row.SheetId));
    state.studentScores = state.studentScores.filter((row) => visibleScoreSheets.has(row.SheetId) && visibleStudents.has(lower(row.StudentRef)));
    state.scoreImports = state.scoreImports.filter((row) => visibleScoreSheets.has(row.SheetId));
    state.scoreSyncBatches = state.scoreSyncBatches.filter((row) => visibleScoreSheets.has(row.SheetId));
    state.cbtTests = state.cbtTests.filter((row) => lower(row.TeacherUsername) === username);
    state.termResults = state.termResults.filter((row) => visibleStudents.has(lower(row.StudentRef)));
    const visibleResults = new Set(state.termResults.map((row) => row.ResultId));
    state.resultEvents = state.resultEvents.filter((row) => visibleResults.has(row.ResultId));
    state.cumulativeResults = state.cumulativeResults.filter((row) => visibleStudents.has(lower(row.StudentRef)));
    const visibleCumulative = new Set(state.cumulativeResults.map((row) => row.CumulativeResultId));
    state.cumulativeEvents = state.cumulativeEvents.filter((row) => visibleCumulative.has(row.CumulativeResultId));
    state.promotionDecisions = state.promotionDecisions.filter((row) => visibleStudents.has(lower(row.StudentRef)));
    const visiblePromotions = new Set(state.promotionDecisions.map((row) => row.PromotionDecisionId));
    state.promotionEvents = state.promotionEvents.filter((row) => visiblePromotions.has(row.PromotionDecisionId));
    state.transcripts = state.transcripts.filter((row) => visibleStudents.has(lower(row.StudentRef)));
    const visibleTranscripts = new Set(state.transcripts.map((row) => row.TranscriptId));
    state.transcriptEvents = state.transcriptEvents.filter((row) => visibleTranscripts.has(row.TranscriptId));
    students = students.filter((row) => visibleStudents.has(lower(studentReference(row))));
  }
  state = sortAcademicState(state);
  const selection = currentSelection(state, input);
  const selectedSession = findById(state.sessions, selection.SessionId);
  const selectedTerm = findById(state.terms, selection.TermId);
  let assessmentScheme = academicAssessmentScheme({});
  if (selectedSession && selectedTerm) {
    try {
      assessmentScheme = await academicAssessmentForPeriod(env, scope, selectedSession, selectedTerm, { required: false });
    } catch (error) {
      assessmentScheme = { ...academicAssessmentScheme({}), Issues: [clean(error?.message || error)] };
    }
  }
  return {
    ok: true,
    message: 'Academic structure and allocations loaded.',
    permissions,
    scope: { BranchId: scope.branchId, SchoolSection: scope.section || 'all' },
    sections: scope.structure.Sections,
    selection,
    assessmentScheme,
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
      StudentMovements: state.studentMovements.length,
      TimetableVersions: state.timetableVersions.length,
      TimetableConstraints: state.timetableConstraints.filter(statusActive).length,
      TimetableEntries: state.timetableEntries.length,
      TimetableSubstitutions: state.timetableSubstitutions.filter(statusActive).length,
      AttendanceRecords: state.studentAttendance.length,
      AttendanceCorrections: state.attendanceCorrections.length,
      ScoreSheets: state.scoreSheets.length,
      StudentScores: state.studentScores.length,
      ScoreImports: state.scoreImports.length,
      ScoreSyncBatches: state.scoreSyncBatches.length,
      CbtTests: state.cbtTests.length,
      TermResults: state.termResults.length,
      ResultEvents: state.resultEvents.length,
      CumulativeResults: state.cumulativeResults.length,
      PromotionDecisions: state.promotionDecisions.length,
      Transcripts: state.transcripts.length
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

async function academicOperationalContext(env, user, input, capability) {
  requireWritableSubscription(user);
  const permissions = requireCapability(user, capability);
  const scope = await academicScope(env, user, input, { requireSection: true });
  const state = await loadAcademicState(env, scope.branchId);
  const scopedState = Object.fromEntries(Object.entries(state).map(([key, rows]) => [key, scopedRows(rows, scope)]));
  const session = assertReference(findById(scopedState.sessions, input.SessionId), 'Choose an active academic session.');
  const term = assertReference(findById(scopedState.terms, input.TermId), 'Choose an active academic term.');
  if (term.SessionId !== session.SessionId) throw failure('The selected term does not belong to this academic session.');
  return { permissions, scope, state: scopedState, session, term };
}

function academicOperationalResponse(env, user, input, scope, message) {
  return bootstrapAcademicManagement(env, user, {
    ...input, BranchId: scope.branchId, SchoolSection: scope.section
  }).then((response) => ({ ...response, message }));
}

export async function saveAcademicTimetableSettings(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state, session, term } = context;
  const timetableSettingId = academicId('timetable-settings', scope.branchId, scope.section, session.SessionId, term.TermId);
  const existing = findById(state.timetableSettings, timetableSettingId);
  const timestamp = nowIso();
  const days = normalizeAcademicTimetableDays(input.Days);
  const record = {
    ...(existing || {}), RecordId: timetableSettingId, TimetableSettingId: timetableSettingId,
    SessionId: session.SessionId, TermId: term.TermId,
    Days: days,
    Periods: normalizeAcademicTimetablePeriods(input.Periods, days),
    BranchId: scope.branchId, SchoolSection: scope.section,
    CreatedAt: clean(existing?.CreatedAt) || timestamp, CreatedBy: clean(existing?.CreatedBy) || actorName(user),
    UpdatedAt: timestamp, UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableSettings, documentId: timetableSettingId, data: withoutMetadata(record), ...writePrecondition(existing, input.RevisionToken) },
    auditWrite(user, existing ? 'UPDATE' : 'CREATE', 'timetableSettings', record, `${record.Days.length} days; ${record.Periods.length} periods`)
  ], 'The timetable configuration changed while it was being saved. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, 'School days and periods saved online.');
}

function academicTimetableConstraint(state = {}, candidate = {}) {
  return (state.timetableConstraints || []).find((row) => statusActive(row)
    && row.SessionId === candidate.SessionId && row.TermId === candidate.TermId
    && lower(row.TeacherUsername) === lower(candidate.TeacherUsername));
}

function assertAcademicTeacherScheduleRules(state, candidate, entries = state.timetableEntries || []) {
  const constraint = academicTimetableConstraint(state, candidate);
  const issues = academicTeacherLoadIssues(candidate, entries.filter(statusActive), constraint);
  if (!issues.length) return;
  const unavailable = issues.find((row) => row.Type === 'Availability');
  if (unavailable) {
    throw failure(`This teacher is unavailable on ${unavailable.DayCode} during ${unavailable.PeriodCode}.`, 409, 'ACADEMIC_TEACHER_UNAVAILABLE');
  }
  const daily = issues.find((row) => row.Type === 'DailyLoad');
  if (daily) {
    throw failure(`This lesson would give the teacher ${daily.Actual} periods on ${daily.DayCode}; the configured daily maximum is ${daily.Limit}.`, 409, 'ACADEMIC_TEACHER_DAILY_LOAD');
  }
  const weekly = issues.find((row) => row.Type === 'WeeklyLoad');
  throw failure(`This lesson would give the teacher ${weekly.Actual} periods this week; the configured weekly maximum is ${weekly.Limit}.`, 409, 'ACADEMIC_TEACHER_WEEKLY_LOAD');
}

export async function saveAcademicTimetableConstraint(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state, session, term } = context;
  const settings = state.timetableSettings.find((row) => row.SessionId === session.SessionId && row.TermId === term.TermId);
  if (!settings) throw failure('Configure the school days and periods before setting teacher availability.');
  const teacherUsername = lower(input.TeacherUsername);
  if (!teacherUsername) throw failure('Choose the teacher whose timetable limits you want to configure.');
  const people = await loadPeople(env, user, scope);
  const teacher = people.staff.find((row) => lower(row.Username || row.username || row.__id) === teacherUsername);
  if (!teacher) throw failure('The selected teacher was not found in this branch and school section.');
  const constraintId = academicId('timetable-constraint', scope.branchId, scope.section, session.SessionId, term.TermId, teacherUsername);
  const existing = findById(state.timetableConstraints, constraintId);
  const timestamp = nowIso();
  const record = {
    ...(existing || {}), RecordId: constraintId, ConstraintId: constraintId,
    TeacherUsername: teacherUsername, SessionId: session.SessionId, TermId: term.TermId,
    UnavailableSlots: normalizeAcademicTeacherUnavailableSlots(input.UnavailableSlots, settings),
    MaxPeriodsPerDay: wholeNumber(input.MaxPeriodsPerDay, wholeNumber(existing?.MaxPeriodsPerDay, 0), 0, 100),
    MaxPeriodsPerWeek: wholeNumber(input.MaxPeriodsPerWeek, wholeNumber(existing?.MaxPeriodsPerWeek, 0), 0, 1000),
    Status: oneOf(input.Status, ACADEMIC_RECORD_STATUSES, existing?.Status || 'Active'),
    BranchId: scope.branchId, SchoolSection: scope.section,
    CreatedAt: clean(existing?.CreatedAt) || timestamp, CreatedBy: clean(existing?.CreatedBy) || actorName(user),
    UpdatedAt: timestamp, UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableConstraints, documentId: constraintId, data: withoutMetadata(record), ...writePrecondition(existing, input.RevisionToken) },
    auditWrite(user, existing ? 'UPDATE' : 'CREATE', 'timetableConstraint', record, `${teacherUsername}: ${record.UnavailableSlots.length} unavailable slot(s)`)
  ], 'These teacher timetable limits changed while they were being saved. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, 'Teacher availability and workload limits saved online.');
}

export async function deleteAcademicTimetableConstraint(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state } = context;
  const existing = findById(state.timetableConstraints, input.ConstraintId || input.RecordId);
  if (!existing) throw failure('The teacher timetable limits were not found.', 404);
  const revisionToken = clean(input.RevisionToken);
  if (!revisionToken || revisionToken !== clean(existing.__updateTime)) {
    throw failure('These teacher timetable limits changed after they were loaded. Reload and try again.', 409);
  }
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableConstraints, documentId: existing.ConstraintId, operation: 'delete', updateTime: revisionToken },
    auditWrite(user, 'DELETE', 'timetableConstraint', existing, existing.TeacherUsername)
  ], 'These teacher timetable limits changed while they were being deleted. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, 'Teacher availability and workload limits deleted.');
}

export async function createAcademicTimetableVersion(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state, session, term } = context;
  const settings = state.timetableSettings.find((row) => row.SessionId === session.SessionId && row.TermId === term.TermId);
  if (!settings) throw failure('Configure the school days and periods before creating a timetable version.');
  const name = clean(input.Name);
  if (!name) throw failure('Enter a timetable version name, for example First draft.');
  const duplicate = state.timetableVersions.find((row) => row.SessionId === session.SessionId && row.TermId === term.TermId && lower(row.Name) === lower(name));
  if (duplicate) throw failure('A timetable version with this name already exists.');
  const versionId = academicId('timetable-version', scope.branchId, scope.section, session.SessionId, term.TermId, name);
  const timestamp = nowIso();
  const record = {
    RecordId: versionId, VersionId: versionId, Name: name, Status: 'Draft',
    SessionId: session.SessionId, TermId: term.TermId, BranchId: scope.branchId, SchoolSection: scope.section,
    Days: settings.Days, Periods: settings.Periods,
    CreatedAt: timestamp, CreatedBy: actorName(user), UpdatedAt: timestamp, UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableVersions, documentId: versionId, data: withoutMetadata(record), exists: false },
    auditWrite(user, 'CREATE', 'timetableVersion', record, name)
  ], 'This timetable version already exists. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, `${name} created as a draft timetable.`);
}

function assertAcademicTimetableVersionLessons(state, version, entries) {
  entries.forEach((entry) => {
    if (!academicSubjectTeacherAllocation(state, entry)) {
      throw failure(`The ${entry.DayCode} ${entry.StartPeriodCode} lesson cannot be used because its subject-teacher allocation is no longer active.`, 409, 'ACADEMIC_TIMETABLE_ALLOCATION_INVALID');
    }
    const conflicts = academicTimetableConflicts(entry, entries);
    if (conflicts.length) {
      const types = [...new Set(conflicts.map((row) => row.Type))].join(', ').toLowerCase();
      throw failure(`Resolve the ${types} conflict in ${version.Name} before continuing.`, 409, 'ACADEMIC_TIMETABLE_CONFLICT');
    }
    assertAcademicTeacherScheduleRules(state, entry, entries);
  });
}

export async function copyAcademicTimetableVersion(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state, session, term } = context;
  const source = findById(state.timetableVersions, input.SourceVersionId);
  if (!source || source.SessionId !== session.SessionId || source.TermId !== term.TermId) {
    throw failure('Choose a timetable version from the selected academic period to copy.');
  }
  if (lower(source.Status) === 'copying') throw failure('Wait for the source timetable copy to finish before copying it again.');
  const sourceEntries = state.timetableEntries.filter((row) => row.VersionId === source.VersionId && statusActive(row));
  if (!sourceEntries.length) throw failure('Add at least one lesson to the source timetable before copying it.');
  assertAcademicTimetableVersionLessons(state, source, sourceEntries);
  const name = clean(input.Name);
  if (!name) throw failure('Enter a name for the new draft timetable.');
  const versionId = academicId('timetable-version', scope.branchId, scope.section, session.SessionId, term.TermId, name);
  let target = findById(state.timetableVersions, versionId)
    || state.timetableVersions.find((row) => row.SessionId === session.SessionId && row.TermId === term.TermId && lower(row.Name) === lower(name));
  if (target && !(lower(target.Status) === 'copying' && target.CopySourceVersionId === source.VersionId)) {
    throw failure('A timetable version with this name already exists.');
  }
  const timestamp = nowIso();
  if (!target) {
    target = {
      RecordId: versionId, VersionId: versionId, Name: name, Status: 'Copying',
      CopySourceVersionId: source.VersionId, SessionId: session.SessionId, TermId: term.TermId,
      BranchId: scope.branchId, SchoolSection: scope.section, Days: source.Days, Periods: source.Periods,
      CreatedAt: timestamp, CreatedBy: actorName(user), UpdatedAt: timestamp, UpdatedBy: actorName(user)
    };
    await commitAcademicBatch(env, [{
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableVersions,
      documentId: versionId, data: withoutMetadata(target), exists: false
    }], 'A timetable version with this name was created by someone else. Reload and try again.');
  }
  const existingCopySources = new Set(state.timetableEntries.filter((row) => row.VersionId === target.VersionId)
    .map((row) => clean(row.CopySourceEntryId)).filter(Boolean));
  const pendingWrites = sourceEntries.filter((entry) => !existingCopySources.has(entry.EntryId)).map((entry) => {
    const entryId = academicId('timetable-entry-copy', target.VersionId, entry.EntryId);
    const copied = {
      ...entry, RecordId: entryId, EntryId: entryId, VersionId: target.VersionId,
      CopySourceEntryId: entry.EntryId, CreatedAt: timestamp, CreatedBy: actorName(user),
      UpdatedAt: timestamp, UpdatedBy: actorName(user), Status: 'Active'
    };
    delete copied.__id;
    delete copied.__name;
    delete copied.__createTime;
    delete copied.__updateTime;
    delete copied.__scopePath;
    return { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableEntries, documentId: entryId, data: copied, exists: false };
  });
  for (let offset = 0; offset < pendingWrites.length; offset += 450) {
    await commitAcademicBatch(env, pendingWrites.slice(offset, offset + 450), 'This timetable copy was interrupted by another update. Run the same copy again to resume it safely.');
  }
  const freshVersions = await listCollection(env, ACADEMIC_MANAGEMENT_COLLECTIONS.timetableVersions);
  const freshTarget = findById(freshVersions, target.VersionId);
  if (!freshTarget) throw failure('The copied timetable version could not be finalized. Run the same copy again to resume it.', 409);
  const completedAt = nowIso();
  const completed = {
    ...freshTarget, Status: 'Draft', CopiedEntryCount: sourceEntries.length,
    CopyCompletedAt: completedAt, UpdatedAt: completedAt, UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableVersions, documentId: freshTarget.VersionId,
      data: withoutMetadata(completed), updateTime: freshTarget.__updateTime },
    auditWrite(user, 'COPY', 'timetableVersion', completed, `${source.Name} -> ${name}; ${sourceEntries.length} lesson(s)`)
  ], 'The copied timetable changed while it was being finalized. Run the same copy again to resume it.');
  return academicOperationalResponse(env, user, input, scope, `${sourceEntries.length} lesson${sourceEntries.length === 1 ? '' : 's'} copied into ${name} as a new draft.`);
}

export function academicTimetableTargetCopyPlan(state = {}, input = {}, context = {}) {
  const source = findById(state.timetableVersions, input.SourceVersionId);
  const target = findById(state.timetableVersions, input.TargetVersionId);
  if (!source || lower(source.Status) === 'copying') throw failure('Choose an available source timetable version.');
  if (!target || target.SessionId !== context.session?.SessionId || target.TermId !== context.term?.TermId) {
    throw failure('Choose a target timetable version from the selected academic period.');
  }
  if (lower(target.Status) !== 'draft') throw failure('Targeted lessons can be copied only into a Draft timetable version.', 409, 'ACADEMIC_TIMETABLE_LOCKED');
  const sourceArm = assertReference(findById(state.arms, input.SourceArmId), 'Choose the source classroom arm.');
  const targetArm = assertReference(findById(state.arms, input.TargetArmId), 'Choose the target classroom arm.');
  const sourceClass = assertReference(findById(state.classes, input.SourceClassId || sourceArm.ClassId), 'Choose the source class.');
  const targetClass = assertReference(findById(state.classes, input.TargetClassId || targetArm.ClassId), 'Choose the target class.');
  if (sourceArm.ClassId !== sourceClass.ClassId || targetArm.ClassId !== targetClass.ClassId) {
    throw failure('Each selected arm must belong to its selected class.');
  }
  const sourceEntries = state.timetableEntries.filter((row) => statusActive(row) && row.VersionId === source.VersionId
    && row.ClassId === sourceClass.ClassId && row.ArmId === sourceArm.ArmId);
  if (!sourceEntries.length) throw failure('The selected source classroom has no lessons in that timetable version.');
  const existingTargetEntries = state.timetableEntries.filter((row) => statusActive(row) && row.VersionId === target.VersionId);
  const planned = [];
  const issues = [];
  sourceEntries.forEach((sourceEntry) => {
    const entryId = academicId('timetable-target-copy', target.VersionId, sourceEntry.EntryId, targetClass.ClassId, targetArm.ArmId);
    try {
      const candidate = {
        ...normalizeAcademicTimetableEntry({
          ...sourceEntry, ClassId: targetClass.ClassId, ArmId: targetArm.ArmId
        }, target),
        RecordId: entryId, EntryId: entryId, VersionId: target.VersionId,
        SessionId: context.session.SessionId, TermId: context.term.TermId,
        BranchId: context.scope.branchId, SchoolSection: context.scope.section,
        CopySourceEntryId: sourceEntry.EntryId, CopySourceVersionId: source.VersionId,
        CopySourceClassId: sourceClass.ClassId, CopySourceArmId: sourceArm.ArmId,
        Status: 'Active'
      };
      if (!academicSubjectTeacherAllocation(state, candidate)) {
        throw failure('The same subject-teacher allocation is not active in the target classroom and term.');
      }
      const combined = [...existingTargetEntries, ...planned.map((row) => row.Entry)];
      const conflicts = academicTimetableConflicts(candidate, combined);
      if (conflicts.length) {
        const types = [...new Set(conflicts.map((row) => row.Type))].join(', ').toLowerCase();
        throw failure(`The copied lesson has a ${types} conflict in the target timetable.`);
      }
      assertAcademicTeacherScheduleRules(state, candidate, combined);
      planned.push({ Entry: candidate, Existing: Boolean(findById(existingTargetEntries, entryId)) });
    } catch (error) {
      issues.push({
        SourceEntryId: sourceEntry.EntryId,
        DayCode: sourceEntry.DayCode,
        StartPeriodCode: sourceEntry.StartPeriodCode,
        SubjectId: sourceEntry.SubjectId,
        Message: clean(error?.message || error || 'This lesson cannot be copied.')
      });
    }
  });
  return {
    SourceVersionId: source.VersionId, SourceVersionName: source.Name,
    TargetVersionId: target.VersionId, TargetVersionName: target.Name,
    SourceClassId: sourceClass.ClassId, SourceArmId: sourceArm.ArmId,
    TargetClassId: targetClass.ClassId, TargetArmId: targetArm.ArmId,
    SourceCount: sourceEntries.length, ValidCount: planned.length,
    ExistingCount: planned.filter((row) => row.Existing).length,
    NewCount: planned.filter((row) => !row.Existing).length,
    Issues: issues, PlannedEntries: planned
  };
}

export async function previewAcademicTimetableCopy(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const plan = academicTimetableTargetCopyPlan(context.state, input, context);
  const response = await academicOperationalResponse(env, user, input, context.scope,
    plan.Issues.length
      ? `${plan.ValidCount} of ${plan.SourceCount} lessons passed validation; resolve ${plan.Issues.length} issue${plan.Issues.length === 1 ? '' : 's'} before copying.`
      : `${plan.NewCount} lesson${plan.NewCount === 1 ? '' : 's'} are ready to copy; ${plan.ExistingCount} matching lesson${plan.ExistingCount === 1 ? '' : 's'} already exist.`);
  response.copyPreview = { ...plan, PlannedEntries: undefined };
  return response;
}

export async function copyAcademicTimetableSelection(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const plan = academicTimetableTargetCopyPlan(context.state, input, context);
  if (plan.Issues.length) {
    throw failure(`Resolve the ${plan.Issues.length} targeted-copy validation issue${plan.Issues.length === 1 ? '' : 's'} before copying.`, 409, 'ACADEMIC_TIMETABLE_COPY_INVALID');
  }
  const timestamp = nowIso();
  const writes = plan.PlannedEntries.filter((row) => !row.Existing).map(({ Entry }) => ({
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableEntries,
    documentId: Entry.EntryId,
    data: withoutMetadata({ ...Entry, CreatedAt: timestamp, CreatedBy: actorName(user), UpdatedAt: timestamp, UpdatedBy: actorName(user) }),
    exists: false
  }));
  for (let offset = 0; offset < writes.length; offset += 450) {
    await commitAcademicBatch(env, writes.slice(offset, offset + 450), 'The target timetable changed while lessons were being copied. Preview the selection again.');
  }
  await commitAcademicBatch(env, [auditWrite(user, 'TARGETED_COPY', 'timetableEntry', {
    RecordId: plan.TargetVersionId, VersionId: plan.TargetVersionId,
    BranchId: context.scope.branchId, SchoolSection: context.scope.section,
    SessionId: context.session.SessionId, TermId: context.term.TermId
  }, `${plan.SourceVersionName}: ${plan.SourceClassId}/${plan.SourceArmId} -> ${plan.TargetVersionName}: ${plan.TargetClassId}/${plan.TargetArmId}; ${writes.length} lesson(s)`)]);
  return academicOperationalResponse(env, user, input, context.scope,
    writes.length
      ? `${writes.length} validated lesson${writes.length === 1 ? '' : 's'} copied into ${plan.TargetVersionName}.`
      : `Every selected lesson already exists in ${plan.TargetVersionName}; nothing was duplicated.`);
}

function academicSubjectTeacherAllocation(state, candidate) {
  return state.teacherAllocations.find((row) => statusActive(row)
    && row.SessionId === candidate.SessionId && row.TermId === candidate.TermId
    && lower(row.AllocationRole) === 'subject teacher'
    && lower(row.TeacherUsername) === lower(candidate.TeacherUsername)
    && row.ClassId === candidate.ClassId && (!row.ArmId || row.ArmId === candidate.ArmId)
    && row.SubjectId === candidate.SubjectId);
}

export async function saveAcademicTimetableEntry(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state, session, term } = context;
  const version = assertReference(findById(state.timetableVersions, input.VersionId), 'Choose an active timetable version.');
  if (version.SessionId !== session.SessionId || version.TermId !== term.TermId) throw failure('The timetable version belongs to another academic period.');
  if (lower(version.Status) !== 'draft') throw failure('Only a draft timetable can be changed.', 409, 'ACADEMIC_TIMETABLE_LOCKED');
  const requestedId = clean(input.EntryId || input.RecordId);
  const existing = requestedId ? findById(state.timetableEntries, requestedId) : null;
  if (requestedId && !existing) throw failure('The timetable lesson was not found.', 404);
  if (existing && existing.VersionId !== version.VersionId) throw failure('The timetable lesson belongs to another version.', 403);
  const entryId = clean(existing?.EntryId) || academicId('timetable-entry', version.VersionId, globalThis.crypto.randomUUID());
  const record = {
    ...normalizeAcademicTimetableEntry(input, version, existing),
    RecordId: entryId, EntryId: entryId, VersionId: version.VersionId,
    SessionId: session.SessionId, TermId: term.TermId, BranchId: scope.branchId, SchoolSection: scope.section
  };
  const schoolClass = assertReference(findById(state.classes, record.ClassId), 'Choose an active class.');
  const arm = assertReference(findById(state.arms, record.ArmId), 'Choose an active classroom arm.');
  if (arm.ClassId !== schoolClass.ClassId) throw failure('The selected arm does not belong to this class.');
  assertReference(findById(state.subjects, record.SubjectId), 'Choose an active subject.');
  if (!academicSubjectTeacherAllocation(state, record)) {
    throw failure('Assign this teacher to the selected subject and classroom before scheduling the lesson.');
  }
  const conflicts = academicTimetableConflicts(record, state.timetableEntries.filter(statusActive));
  if (conflicts.length) {
    const types = [...new Set(conflicts.map((row) => row.Type))].join(', ');
    throw failure(`Resolve the ${types.toLowerCase()} timetable conflict before saving.`, 409, 'ACADEMIC_TIMETABLE_CONFLICT');
  }
  assertAcademicTeacherScheduleRules(state, record);
  const timestamp = nowIso();
  record.Status = 'Active';
  record.CreatedAt = clean(existing?.CreatedAt) || timestamp;
  record.CreatedBy = clean(existing?.CreatedBy) || actorName(user);
  record.UpdatedAt = timestamp;
  record.UpdatedBy = actorName(user);
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableEntries, documentId: entryId, data: withoutMetadata(record), ...writePrecondition(existing, input.RevisionToken) },
    auditWrite(user, existing ? 'UPDATE' : 'CREATE', 'timetableEntry', record, `${record.DayCode} ${record.PeriodCodes.join(', ')}`)
  ], 'This timetable lesson changed while it was being saved. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, 'Timetable lesson saved without conflicts.');
}

export async function deleteAcademicTimetableEntry(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state } = context;
  const existing = findById(state.timetableEntries, input.EntryId || input.RecordId);
  if (!existing) throw failure('The timetable lesson was not found.', 404);
  const version = findById(state.timetableVersions, existing.VersionId);
  if (!version || lower(version.Status) !== 'draft') throw failure('Only lessons in a draft timetable can be deleted.', 409);
  const revisionToken = clean(input.RevisionToken);
  if (!revisionToken || revisionToken !== clean(existing.__updateTime)) throw failure('This timetable lesson changed after it was loaded. Reload and try again.', 409);
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableEntries, documentId: existing.EntryId, operation: 'delete', updateTime: revisionToken },
    auditWrite(user, 'DELETE', 'timetableEntry', existing, `${existing.DayCode} ${existing.PeriodCodes?.join(', ') || ''}`)
  ], 'This timetable lesson changed while it was being deleted. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, 'Timetable lesson deleted.');
}

function academicIsoWeekdayCode(value) {
  const date = new Date(`${clean(value)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getUTCDay()];
}

export async function saveAcademicTimetableSubstitution(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state, session, term } = context;
  const lesson = assertReference(findById(state.timetableEntries, input.TimetableEntryId), 'Choose a published timetable lesson.');
  const version = findById(state.timetableVersions, lesson.VersionId);
  if (!version || lower(version.Status) !== 'published') throw failure('Teacher substitutions can be scheduled only for a published timetable.');
  const substitutionDate = dateValue(input.SubstitutionDate, 'substitution date');
  if (substitutionDate < term.StartDate || substitutionDate > term.EndDate) throw failure('The substitution date must fall within the selected term.');
  const weekday = academicIsoWeekdayCode(substitutionDate);
  if (/^(SUN|MON|TUE|WED|THU|FRI|SAT)$/.test(clean(lesson.DayCode).toUpperCase()) && weekday !== clean(lesson.DayCode).toUpperCase()) {
    throw failure(`The selected lesson runs on ${lesson.DayCode}, but ${substitutionDate} is ${weekday}.`);
  }
  const substituteUsername = lower(input.SubstituteTeacherUsername);
  if (!substituteUsername) throw failure('Choose the substitute teacher.');
  if (substituteUsername === lower(lesson.TeacherUsername)) throw failure('Choose a different teacher for this substitution.');
  const people = await loadPeople(env, user, scope);
  const substitute = people.staff.find((row) => lower(row.Username || row.username || row.__id) === substituteUsername);
  if (!substitute) throw failure('The substitute teacher was not found in this branch.');
  const qualified = state.teacherAllocations.some((row) => statusActive(row)
    && row.SessionId === session.SessionId && row.TermId === term.TermId
    && lower(row.AllocationRole) === 'subject teacher' && row.SubjectId === lesson.SubjectId
    && lower(row.TeacherUsername) === substituteUsername);
  if (!qualified) throw failure('Assign this subject to the substitute teacher in the selected term before scheduling the substitution.');
  const candidate = { ...lesson, TeacherUsername: substituteUsername };
  const substitutionId = academicId('timetable-substitution', scope.branchId, scope.section, session.SessionId, term.TermId, substitutionDate, lesson.EntryId);
  const requestedExisting = clean(input.SubstitutionId || input.RecordId)
    ? findById(state.timetableSubstitutions, input.SubstitutionId || input.RecordId) : null;
  if (clean(input.SubstitutionId || input.RecordId) && !requestedExisting) throw failure('The teacher substitution being edited was not found.', 404);
  if (requestedExisting && lower(requestedExisting.Status) !== 'scheduled') throw failure('Only a scheduled teacher substitution can be edited.', 409);
  const conflicts = academicTimetableConflicts(candidate, state.timetableEntries.filter((row) => statusActive(row) && row.VersionId === version.VersionId));
  const teacherConflict = conflicts.find((row) => row.Type === 'Teacher');
  if (teacherConflict) throw failure('The substitute teacher already has another lesson during this period.', 409, 'ACADEMIC_TIMETABLE_CONFLICT');
  const occupied = new Set(lesson.PeriodCodes || []);
  const substitutionConflict = state.timetableSubstitutions.some((row) => lower(row.Status) === 'scheduled'
    && ![substitutionId, requestedExisting?.SubstitutionId].includes(row.SubstitutionId) && row.SubstitutionDate === substitutionDate
    && lower(row.SubstituteTeacherUsername) === substituteUsername
    && (row.PeriodCodes || []).some((periodCode) => occupied.has(periodCode)));
  if (substitutionConflict) throw failure('The substitute teacher already has another substitution during this period.', 409, 'ACADEMIC_TIMETABLE_CONFLICT');
  assertAcademicTeacherScheduleRules(state, candidate);
  const reason = clean(input.Reason).slice(0, 500);
  if (!reason) throw failure('Enter the approved reason for this teacher substitution.');
  const existing = findById(state.timetableSubstitutions, substitutionId);
  if (existing && requestedExisting && existing.SubstitutionId !== requestedExisting.SubstitutionId) {
    throw failure('Another substitution is already scheduled for this lesson and date.', 409, 'ACADEMIC_WRITE_CONFLICT');
  }
  const previous = requestedExisting || existing;
  const timestamp = nowIso();
  const record = {
    ...(previous || {}), RecordId: substitutionId, SubstitutionId: substitutionId,
    SessionId: session.SessionId, TermId: term.TermId, VersionId: version.VersionId,
    TimetableEntryId: lesson.EntryId, SubstitutionDate: substitutionDate,
    OriginalTeacherUsername: lesson.TeacherUsername, SubstituteTeacherUsername: substituteUsername,
    ClassId: lesson.ClassId, ArmId: lesson.ArmId, SubjectId: lesson.SubjectId,
    DayCode: lesson.DayCode, PeriodCodes: lesson.PeriodCodes || [], Reason: reason, Status: 'Scheduled',
    BranchId: scope.branchId, SchoolSection: scope.section,
    CreatedAt: clean(previous?.CreatedAt) || timestamp, CreatedBy: clean(previous?.CreatedBy) || actorName(user),
    UpdatedAt: timestamp, UpdatedBy: actorName(user)
  };
  const relocating = previous && previous.SubstitutionId !== substitutionId;
  await commitAcademicBatch(env, [
    ...(relocating ? [{ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableSubstitutions,
      documentId: previous.SubstitutionId, operation: 'delete', updateTime: clean(input.RevisionToken) }] : []),
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableSubstitutions, documentId: substitutionId,
      data: withoutMetadata(record), ...(relocating ? { exists: false } : writePrecondition(existing, input.RevisionToken)) },
    auditWrite(user, previous ? 'UPDATE_SUBSTITUTION' : 'CREATE_SUBSTITUTION', 'timetableSubstitution', record, reason)
  ], 'This teacher substitution changed while it was being saved. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, 'Teacher substitution scheduled and conflict-checked online.');
}

export async function cancelAcademicTimetableSubstitution(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state } = context;
  const existing = findById(state.timetableSubstitutions, input.SubstitutionId || input.RecordId);
  if (!existing || lower(existing.Status) !== 'scheduled') throw failure('The scheduled teacher substitution was not found.', 404);
  const reason = clean(input.Reason).slice(0, 500);
  if (!reason) throw failure('Enter the reason for cancelling this substitution.');
  const timestamp = nowIso();
  const updated = {
    ...existing, Status: 'Cancelled', CancellationReason: reason,
    CancelledAt: timestamp, CancelledBy: actorName(user), UpdatedAt: timestamp, UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableSubstitutions, documentId: existing.SubstitutionId,
      data: withoutMetadata(updated), ...writePrecondition(existing, input.RevisionToken) },
    auditWrite(user, 'CANCEL_SUBSTITUTION', 'timetableSubstitution', updated, reason)
  ], 'This teacher substitution changed while it was being cancelled. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, 'Teacher substitution cancelled.');
}

export async function changeAcademicTimetableVersionStatus(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canPublishTimetables');
  const { scope, state, session, term } = context;
  const version = findById(state.timetableVersions, input.VersionId || input.RecordId);
  if (!version || version.SessionId !== session.SessionId || version.TermId !== term.TermId) throw failure('The timetable version was not found.', 404);
  const requested = oneOf(input.Status, ACADEMIC_TIMETABLE_VERSION_STATUSES, '');
  const transitions = { draft: ['Approved'], approved: ['Published', 'Draft'], published: ['Withdrawn'], withdrawn: [] };
  if (!(transitions[lower(version.Status)] || []).includes(requested)) throw failure(`A ${version.Status} timetable cannot move to ${requested || 'that status'}.`, 409);
  const entries = state.timetableEntries.filter((row) => row.VersionId === version.VersionId && statusActive(row));
  if (['Approved', 'Published'].includes(requested) && !entries.length) throw failure('Add at least one lesson before approving or publishing this timetable.');
  if (['Approved', 'Published'].includes(requested)) assertAcademicTimetableVersionLessons(state, version, entries);
  const reason = clean(input.Reason).slice(0, 500);
  if (requested === 'Withdrawn' && !reason) throw failure('Enter the reason for withdrawing this timetable.');
  const timestamp = nowIso();
  const updated = {
    ...version, Status: requested, UpdatedAt: timestamp, UpdatedBy: actorName(user),
    ...(requested === 'Approved' ? { ApprovedAt: timestamp, ApprovedBy: actorName(user) } : {}),
    ...(requested === 'Published' ? { PublishedAt: timestamp, PublishedBy: actorName(user) } : {}),
    ...(requested === 'Withdrawn' ? { WithdrawnAt: timestamp, WithdrawnBy: actorName(user), WithdrawalReason: reason } : {})
  };
  const writes = [{
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableVersions, documentId: version.VersionId,
    data: withoutMetadata(updated), ...writePrecondition(version, input.RevisionToken)
  }];
  if (requested === 'Published') {
    state.timetableVersions.filter((row) => row.VersionId !== version.VersionId
      && row.SessionId === session.SessionId && row.TermId === term.TermId && lower(row.Status) === 'published').forEach((row) => {
      writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.timetableVersions, documentId: row.VersionId,
        data: withoutMetadata({ ...row, Status: 'Withdrawn', WithdrawnAt: timestamp, WithdrawnBy: actorName(user), WithdrawalReason: 'Superseded by a newly published timetable.', UpdatedAt: timestamp, UpdatedBy: actorName(user) }), updateTime: row.__updateTime });
    });
  }
  writes.push(auditWrite(user, requested.toUpperCase(), 'timetableVersion', updated, reason || updated.Name));
  await commitAcademicBatch(env, writes, 'The timetable version changed while its status was being updated. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, `${version.Name} is now ${requested.toLowerCase()}.`);
}

function academicAttendanceAuthority(user, state, input, permissions) {
  if (permissions.canManageTimetables) return true;
  const username = actorUsername(user);
  const mode = oneOf(input.Mode, ACADEMIC_ATTENDANCE_MODES, 'Daily');
  if (mode === 'Period') {
    const entry = findById(state.timetableEntries, input.TimetableEntryId);
    const substitution = entry && state.timetableSubstitutions.some((row) => lower(row.Status) === 'scheduled'
      && row.TimetableEntryId === entry.EntryId && row.SubstitutionDate === clean(input.AttendanceDate)
      && lower(row.SubstituteTeacherUsername) === username);
    return Boolean(entry && entry.ClassId === input.ClassId && entry.ArmId === input.ArmId
      && (lower(entry.TeacherUsername) === username || substitution));
  }
  return state.teacherAllocations.some((row) => statusActive(row) && lower(row.TeacherUsername) === username
    && row.SessionId === input.SessionId && row.TermId === input.TermId && row.ClassId === input.ClassId
    && (!row.ArmId || row.ArmId === input.ArmId)
    && (mode === 'Daily'
      ? ['form teacher', 'assistant teacher'].includes(lower(row.AllocationRole))
      : lower(row.AllocationRole) === 'subject teacher' && row.SubjectId === input.SubjectId));
}

function academicParentContacts(student = {}) {
  const emails = uniqueIds([
    ...(Array.isArray(student.ParentEmails) ? student.ParentEmails : []),
    student.ParentEmail, student.VerificationEmail, student.Email,
    student.FatherEmail, student.MotherEmail, student.GuardianEmail
  ]).map(lower).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  const accountRefs = uniqueIds([
    studentReference(student), student.AccountRef, student.AdmissionNo, student.ApplicationReference
  ]).map(lower).filter(Boolean);
  return { emails, accountRefs };
}

async function notifyAcademicAbsences(env, students = [], records = [], context = {}) {
  const byStudent = new Map(students.map((row) => [lower(studentReference(row)), row]));
  const uniqueRecords = new Map(records.filter((row) => lower(row.Status) === 'absent')
    .map((row) => [row.AttendanceId, row]));
  const results = await Promise.allSettled([...uniqueRecords.values()].map((record) => {
    const student = byStudent.get(lower(record.StudentRef)) || {};
    const contacts = academicParentContacts(student);
    const studentName = clean(student.DisplayName || student.ApplicantName || student.StudentName || record.StudentRef);
    const eventRevision = clean(record.MarkedAt || record.UpdatedAt || record.CreatedAt || record.AttendanceDate);
    return createNotification(env, {
      EventKey: `academic-absence:${record.AttendanceId}:${eventRevision}`,
      Type: 'Student absence', Category: 'Attendance', Audience: 'Parent', Channels: ['InApp', 'Push'],
      TargetEmails: contacts.emails, TargetAccountRefs: contacts.accountRefs,
      Title: `${studentName} was marked absent`,
      Message: `${studentName} was marked absent on ${record.AttendanceDate} in the ${record.Mode || 'Daily'} attendance register. Contact the school if this needs correction.`,
      ActionUrl: 'parent-dashboard.html?section=academics', RecordType: 'studentAttendance', RecordId: record.AttendanceId,
      BranchId: context.scope?.branchId || record.BranchId, SchoolSection: context.scope?.section || record.SchoolSection,
      ActorType: 'Staff', ActorId: context.actorUsername || record.MarkedByUsername || 'Academic Management',
      CreatedBy: context.actorName || record.MarkedBy || 'Academic Management'
    });
  }));
  return results.filter((result) => result.status === 'fulfilled' && result.value?.created).length;
}

export async function saveAcademicStudentAttendance(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canMarkAttendance');
  const { permissions, scope, state, session, term } = context;
  const attendanceDate = clean(input.AttendanceDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) throw failure('Choose a valid attendance date.');
  if (attendanceDate < term.StartDate || attendanceDate > term.EndDate) throw failure('The attendance date must fall within the selected term.');
  const schoolClass = assertReference(findById(state.classes, input.ClassId), 'Choose an active class.');
  const arm = assertReference(findById(state.arms, input.ArmId), 'Choose an active classroom arm.');
  if (arm.ClassId !== schoolClass.ClassId) throw failure('The selected arm does not belong to this class.');
  const mode = oneOf(input.Mode, ACADEMIC_ATTENDANCE_MODES, 'Daily');
  const authorityInput = { ...input, Mode: mode, SessionId: session.SessionId, TermId: term.TermId, ClassId: schoolClass.ClassId, ArmId: arm.ArmId };
  if (!academicAttendanceAuthority(user, state, authorityInput, permissions)) {
    throw failure('Only an allocated form, assistant or subject teacher may mark this register.', 403, 'ACADEMIC_ATTENDANCE_FORBIDDEN');
  }
  if (mode === 'Subject') assertReference(findById(state.subjects, input.SubjectId), 'Choose the subject for this attendance register.');
  if (mode === 'Period') {
    const lesson = findById(state.timetableEntries, input.TimetableEntryId);
    const version = lesson ? findById(state.timetableVersions, lesson.VersionId) : null;
    if (!lesson || !version || lower(version.Status) !== 'published') throw failure('Choose a lesson from the published timetable.');
  }
  const memberships = state.studentMemberships.filter((row) => statusActive(row)
    && row.SessionId === session.SessionId && row.TermId === term.TermId && row.ClassId === schoolClass.ClassId && row.ArmId === arm.ArmId);
  const attendanceRows = normalizeAcademicAttendanceEntries(input.Entries, memberships.map((row) => row.StudentRef));
  const correctionReason = clean(input.CorrectionReason).slice(0, 500);
  const registerDiscriminator = mode === 'Period' ? clean(input.TimetableEntryId) : mode === 'Subject' ? clean(input.SubjectId) : 'daily';
  const registerId = academicId('attendance-register', scope.branchId, scope.section, session.SessionId, term.TermId, attendanceDate, schoolClass.ClassId, arm.ArmId, mode, registerDiscriminator);
  const timestamp = nowIso();
  const writes = [];
  let created = 0;
  let corrected = 0;
  let requested = 0;
  const absentRecords = [];
  attendanceRows.forEach((row) => {
    const attendanceId = academicId(registerId, row.StudentRef);
    const existing = findById(state.studentAttendance, attendanceId);
    if (existing && existing.Status === row.Status && Number(existing.MinutesLate || 0) === row.MinutesLate && clean(existing.Note) === row.Note) {
      if (lower(existing.Status) === 'absent') absentRecords.push(existing);
      return;
    }
    const record = {
      ...(existing || {}), RecordId: attendanceId, AttendanceId: attendanceId, RegisterId: registerId,
      SessionId: session.SessionId, TermId: term.TermId, AttendanceDate: attendanceDate,
      ClassId: schoolClass.ClassId, ArmId: arm.ArmId, Mode: mode,
      SubjectId: mode === 'Subject' ? clean(input.SubjectId) : '',
      TimetableEntryId: mode === 'Period' ? clean(input.TimetableEntryId) : '',
      StudentRef: row.StudentRef, Status: row.Status, MinutesLate: row.MinutesLate, Note: row.Note,
      BranchId: scope.branchId, SchoolSection: scope.section,
      CreatedAt: clean(existing?.CreatedAt) || timestamp, CreatedBy: clean(existing?.CreatedBy) || actorName(user),
      MarkedAt: timestamp, MarkedBy: actorName(user), MarkedByUsername: actorUsername(user), MarkedByRole: clean(user.role || user.Role),
      UpdatedAt: timestamp, UpdatedBy: actorName(user)
    };
    if (existing && !permissions.canManageTimetables) {
      if (!correctionReason) throw failure(`Explain the correction requested for ${row.StudentRef}.`);
      const correctionId = academicId('attendance-correction', attendanceId, globalThis.crypto.randomUUID());
      const correction = {
        RecordId: correctionId, CorrectionId: correctionId, AttendanceId: attendanceId,
        AttendanceRevision: clean(existing.__updateTime), PreviousStatus: existing.Status, ProposedStatus: row.Status,
        ProposedMinutesLate: row.MinutesLate, ProposedNote: row.Note, Reason: correctionReason, Status: 'Pending',
        SessionId: session.SessionId, TermId: term.TermId, AttendanceDate: attendanceDate,
        ClassId: schoolClass.ClassId, ArmId: arm.ArmId, StudentRef: row.StudentRef,
        BranchId: scope.branchId, SchoolSection: scope.section,
        RequestedAt: timestamp, RequestedBy: actorName(user), RequestedByUsername: actorUsername(user), RequestedByRole: clean(user.role || user.Role)
      };
      writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.attendanceCorrections, documentId: correctionId, data: withoutMetadata(correction), exists: false });
      writes.push(auditWrite(user, 'REQUEST_CORRECTION', 'studentAttendance', correction, correctionReason));
      requested += 1;
      return;
    }
    if (existing && !correctionReason) throw failure(`Enter a correction reason before changing ${row.StudentRef}.`);
    writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentAttendance, documentId: attendanceId, data: withoutMetadata({
      ...record, ...(existing ? { CorrectedAt: timestamp, CorrectedBy: actorName(user), CorrectionReason: correctionReason } : {})
    }), ...writePrecondition(existing, existing ? input.RevisionTokens?.[attendanceId] || existing.__updateTime : '') });
    writes.push(auditWrite(user, existing ? 'CORRECT' : 'MARK', 'studentAttendance', record,
      existing ? `${existing.Status} -> ${record.Status}: ${correctionReason}` : record.Status));
    if (lower(record.Status) === 'absent') absentRecords.push(record);
    if (existing) corrected += 1; else created += 1;
  });
  if (writes.length) await commitAcademicBatch(env, writes, 'The attendance register changed while it was being saved. Reload and try again.');
  let absenceNotifications = 0;
  if (absentRecords.length) {
    const people = await loadPeople(env, user, scope).catch(() => ({ students: [] }));
    absenceNotifications = await notifyAcademicAbsences(env, people.students || [], absentRecords, {
      scope, actorName: actorName(user), actorUsername: actorUsername(user)
    }).catch(() => 0);
  }
  const summary = academicAttendanceSummary(attendanceRows);
  const message = requested
    ? `Attendance saved; ${requested} correction request${requested === 1 ? '' : 's'} sent for approval.`
    : `Attendance saved: ${summary.Present} present, ${summary.Absent} absent, ${summary.Late} late${corrected ? `; ${corrected} corrected` : ''}${absenceNotifications ? `; ${absenceNotifications} new parent absence notification${absenceNotifications === 1 ? '' : 's'}` : ''}.`;
  return academicOperationalResponse(env, user, input, scope, message);
}

export async function decideAcademicAttendanceCorrection(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManageTimetables');
  const { scope, state } = context;
  const correction = findById(state.attendanceCorrections, input.CorrectionId || input.RecordId);
  if (!correction || lower(correction.Status) !== 'pending') throw failure('The pending attendance correction was not found.', 404);
  const decision = oneOf(input.Decision, ['Approved', 'Rejected'], '');
  if (!decision) throw failure('Choose Approved or Rejected.');
  const reason = clean(input.Reason).slice(0, 500);
  if (!reason) throw failure('Enter the decision reason.');
  const existing = findById(state.studentAttendance, correction.AttendanceId);
  if (!existing) throw failure('The original attendance record was not found.', 409);
  if (clean(existing.__updateTime) !== clean(correction.AttendanceRevision)) {
    throw failure('The attendance record changed after this correction was requested. Reject it and review the latest record.', 409, 'ACADEMIC_WRITE_CONFLICT');
  }
  const timestamp = nowIso();
  const decided = {
    ...correction, Status: decision, DecisionReason: reason, DecidedAt: timestamp,
    DecidedBy: actorName(user), DecidedByUsername: actorUsername(user), DecidedByRole: clean(user.role || user.Role)
  };
  const writes = [{
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.attendanceCorrections, documentId: correction.CorrectionId,
    data: withoutMetadata(decided), ...writePrecondition(correction, input.RevisionToken)
  }];
  if (decision === 'Approved') {
    writes.push({
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentAttendance, documentId: existing.AttendanceId,
      data: withoutMetadata({ ...existing, Status: correction.ProposedStatus, MinutesLate: correction.ProposedMinutesLate,
        Note: correction.ProposedNote, CorrectedAt: timestamp, CorrectedBy: actorName(user), CorrectionReason: correction.Reason,
        UpdatedAt: timestamp, UpdatedBy: actorName(user) }), updateTime: existing.__updateTime
    });
  }
  writes.push(auditWrite(user, decision === 'Approved' ? 'APPROVE_CORRECTION' : 'REJECT_CORRECTION', 'studentAttendance', decided, reason));
  await commitAcademicBatch(env, writes, 'The attendance correction changed while it was being decided. Reload and try again.');
  let absenceNotifications = 0;
  if (decision === 'Approved' && lower(correction.ProposedStatus) === 'absent') {
    const people = await loadPeople(env, user, scope).catch(() => ({ students: [] }));
    absenceNotifications = await notifyAcademicAbsences(env, people.students || [], [{
      ...existing, Status: 'Absent', MinutesLate: correction.ProposedMinutesLate, Note: correction.ProposedNote,
      MarkedAt: timestamp, UpdatedAt: timestamp
    }], { scope, actorName: actorName(user), actorUsername: actorUsername(user) }).catch(() => 0);
  }
  return academicOperationalResponse(env, user, input, scope,
    `Attendance correction ${decision.toLowerCase()}${absenceNotifications ? '; the parent was notified of the approved absence' : ''}.`);
}

async function academicAssessmentFingerprint(scheme = {}) {
  const material = JSON.stringify({ Components: scheme.Components || [], GradeBands: scheme.GradeBands || [] });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return `assessment-${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
}

async function academicResultPolicyFingerprint(policy = {}) {
  const material = JSON.stringify(normalizeAcademicPolicy(policy));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return `result-policy-${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
}

async function academicResultReference(resultId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean(resultId)));
  return `TR-${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase()}`;
}

async function academicAssessmentForPeriod(env, scope, session, term, { required = true, classId = '', subjectId = '' } = {}) {
  const scopeChain = academicPolicyScopeChain({
    BranchId: scope.branchId, SectionId: scope.section, ClassId: classId, SubjectId: subjectId
  });
  const view = await loadAcademicPolicyView(env, {
    scope: scopeChain.at(-1),
    scopeChain,
    period: { Session: session.Name, Term: term.Name }
  });
  const sourceRevisionIds = (view.Sources || []).map((row) => clean(row.RevisionId)).filter(Boolean);
  const scheme = academicAssessmentScheme(view.ActivePolicy);
  if (sourceRevisionIds.length) {
    scheme.RevisionId = await academicAssessmentFingerprint(scheme);
    scheme.SourceRevisionIds = sourceRevisionIds;
  } else {
    scheme.Ready = false;
    scheme.Issues = [...scheme.Issues, 'Activate the assessment and grading policy for this academic period.'];
  }
  if (required && !scheme.Ready) {
    throw failure(scheme.Issues[0] || 'Configure and activate the assessment and grading policy first.', 409, 'ACADEMIC_ASSESSMENT_SCHEME_REQUIRED');
  }
  return scheme;
}

function academicScoreSheetId(scope, sessionId, termId, classId, armId, subjectId) {
  return academicId('score-sheet', scope.branchId, scope.section, sessionId, termId, classId, armId, subjectId);
}

function academicStudentScoreId(sheetId, studentRef) {
  return academicId('student-score', sheetId, studentRef);
}

function academicScoreRoster(state, candidate) {
  return state.studentMemberships.filter((row) => statusActive(row)
    && row.SessionId === candidate.SessionId && row.TermId === candidate.TermId
    && row.ClassId === candidate.ClassId && row.ArmId === candidate.ArmId
    && (row.SubjectIds || []).includes(candidate.SubjectId));
}

function academicScoreTeacherAllocations(state, candidate) {
  return state.teacherAllocations.filter((row) => statusActive(row)
    && row.SessionId === candidate.SessionId && row.TermId === candidate.TermId
    && lower(row.AllocationRole) === 'subject teacher'
    && row.ClassId === candidate.ClassId && (!row.ArmId || row.ArmId === candidate.ArmId)
    && row.SubjectId === candidate.SubjectId);
}

function assertAcademicScoreSheetAuthority(user, permissions, state, candidate, existing = null) {
  const allocations = academicScoreTeacherAllocations(state, candidate);
  if (!allocations.length) throw failure('Assign a subject teacher to this classroom and subject before opening its scorebook.', 409, 'ACADEMIC_SCORE_TEACHER_REQUIRED');
  const username = actorUsername(user);
  const requestedTeacher = lower(existing?.TeacherUsername || candidate.TeacherUsername || (permissions.teacherView ? username : ''));
  const allocation = allocations.find((row) => !requestedTeacher || lower(row.TeacherUsername) === requestedTeacher);
  if (!allocation) throw failure('The selected teacher is not allocated to this subject and classroom.', 403, 'ACADEMIC_SCORE_ALLOCATION_FORBIDDEN');
  if (permissions.teacherView && lower(allocation.TeacherUsername) !== username) {
    throw failure('Teachers may enter scores only for their own allocated subjects and classrooms.', 403, 'ACADEMIC_SCORE_ALLOCATION_FORBIDDEN');
  }
  return allocation;
}

async function academicScoreSheetContext(env, user, input, capability = 'canEnterScores') {
  const context = await academicOperationalContext(env, user, input, capability);
  const { permissions, scope, state, session, term } = context;
  const schoolClass = assertReference(findById(state.classes, input.ClassId), 'Choose an active class.');
  const arm = assertReference(findById(state.arms, input.ArmId), 'Choose an active classroom arm.');
  const subject = assertReference(findById(state.subjects, input.SubjectId), 'Choose an active subject.');
  if (arm.ClassId !== schoolClass.ClassId) throw failure('The selected arm does not belong to this class.');
  if (schoolClass.SchoolSection !== scope.section || subject.SchoolSection !== scope.section) {
    throw failure('The selected scorebook belongs to another school section.', 403, 'ACADEMIC_SECTION_FORBIDDEN');
  }
  const candidate = {
    SessionId: session.SessionId, TermId: term.TermId, ClassId: schoolClass.ClassId,
    ArmId: arm.ArmId, SubjectId: subject.SubjectId, TeacherUsername: lower(input.TeacherUsername)
  };
  const SheetId = academicScoreSheetId(scope, session.SessionId, term.TermId, schoolClass.ClassId, arm.ArmId, subject.SubjectId);
  const existing = findById(state.scoreSheets, input.SheetId || SheetId);
  if (input.SheetId && !existing) throw failure('The selected score sheet was not found.', 404);
  if (existing && existing.SheetId !== SheetId) throw failure('The selected score sheet belongs to another classroom, subject or period.', 403);
  const allocation = assertAcademicScoreSheetAuthority(user, permissions, state, candidate, existing);
  const roster = academicScoreRoster(state, candidate);
  if (!roster.length) throw failure('No students in this classroom are allocated to the selected subject.', 409, 'ACADEMIC_SCORE_ROSTER_EMPTY');
  let scheme;
  if (existing) {
    scheme = academicAssessmentScheme({ Assessment: {
      Components: existing.AssessmentComponents || [], GradeBands: existing.GradeBands || []
    } }, { RevisionId: existing.AssessmentRevisionId });
    scheme.SourceRevisionIds = existing.AssessmentSourceRevisionIds || [];
    if (!scheme.Ready || !scheme.RevisionId) {
      throw failure('This score sheet has an invalid historical assessment snapshot. An academic administrator must review it before scores can change.', 409, 'ACADEMIC_SCORE_SNAPSHOT_INVALID');
    }
  } else {
    scheme = await academicAssessmentForPeriod(env, scope, session, term, {
      classId: schoolClass.ClassId, subjectId: subject.SubjectId
    });
  }
  return { ...context, schoolClass, arm, subject, SheetId, existing, allocation, roster, scheme };
}

function academicScoreSheetRecord(context, existing, user, timestamp, updates = {}) {
  const { scope, session, term, schoolClass, arm, subject, SheetId, allocation, roster, scheme } = context;
  return {
    ...(existing || {}), RecordId: SheetId, SheetId,
    SessionId: session.SessionId, TermId: term.TermId,
    ClassId: schoolClass.ClassId, ArmId: arm.ArmId, SubjectId: subject.SubjectId,
    TeacherUsername: lower(existing?.TeacherUsername || allocation.TeacherUsername),
    AssessmentRevisionId: scheme.RevisionId,
    AssessmentSourceRevisionIds: scheme.SourceRevisionIds || [],
    AssessmentComponents: scheme.Components,
    GradeBands: scheme.GradeBands,
    RosterCount: roster.length,
    Status: existing?.Status || 'Draft',
    BranchId: scope.branchId, SchoolSection: scope.section,
    CreatedAt: clean(existing?.CreatedAt) || timestamp,
    CreatedBy: clean(existing?.CreatedBy) || actorName(user),
    UpdatedAt: timestamp, UpdatedBy: actorName(user),
    ...updates
  };
}

function academicScoreRowsInput(value) {
  let rows = value;
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch (_error) { rows = []; }
  }
  return Array.isArray(rows) ? rows : [];
}

export async function getAcademicScorebookContext(env, user = {}, input = {}) {
  const context = await academicScoreSheetContext(env, user, input, 'canEnterScores');
  const response = await academicOperationalResponse(env, user, input, context.scope, 'Scorebook context loaded.');
  response.assessmentScheme = context.scheme;
  response.scorebookContext = {
    SheetId: context.SheetId,
    ClassId: context.schoolClass.ClassId,
    ArmId: context.arm.ArmId,
    SubjectId: context.subject.SubjectId,
    TeacherUsername: context.allocation.TeacherUsername,
    RosterCount: context.roster.length
  };
  return response;
}

function academicScoreSheetCounts(scores = []) {
  return {
    EnteredCount: scores.length,
    CompleteCount: scores.filter((row) => row.CompletionStatus === 'Complete').length,
    IncompleteCount: scores.filter((row) => row.CompletionStatus !== 'Complete').length
  };
}

export async function saveAcademicScoreDraft(env, user = {}, input = {}) {
  const context = await academicScoreSheetContext(env, user, input, 'canEnterScores');
  const { scope, state, SheetId, existing, roster, scheme } = context;
  if (existing && lower(existing.Status) !== 'draft') throw failure('Only a Draft score sheet can be edited.', 409, 'ACADEMIC_SCORE_SHEET_LOCKED');
  const suppliedRows = academicScoreRowsInput(input.Rows);
  if (!suppliedRows.length) throw failure('Enter at least one student score before saving.');
  if (suppliedRows.length > 200) throw failure('Save at most 200 student scores at a time.');
  const rosterRefs = new Set(roster.map((row) => lower(row.StudentRef)));
  const seen = new Set();
  const timestamp = nowIso();
  const updatedScores = suppliedRows.map((row) => {
    const studentRef = clean(row.StudentRef);
    const key = lower(studentRef);
    if (!studentRef || !rosterRefs.has(key)) throw failure(`${studentRef || 'A selected student'} is not in this subject roster.`, 409, 'ACADEMIC_SCORE_STUDENT_INVALID');
    if (seen.has(key)) throw failure(`${studentRef} appears more than once in this score save.`);
    seen.add(key);
    const ScoreId = academicStudentScoreId(SheetId, studentRef);
    const previous = findById(state.studentScores, ScoreId);
    const normalizedScores = normalizeAcademicComponentScores(row.ComponentScores, scheme, {
      existing: previous?.ComponentScores || [], partial: true
    });
    const previousScores = normalizeAcademicComponentScores(previous?.ComponentScores || [], scheme);
    const previousByComponent = new Map(previousScores.map((score) => [score.ComponentId, score]));
    const changedScores = normalizedScores.filter((score) => {
      const before = previousByComponent.get(score.ComponentId);
      return !before || before.State !== score.State || Number(before.RawScore ?? 0) !== Number(score.RawScore ?? 0);
    });
    const sourceIssues = academicScoreSourceIssues(scheme, changedScores, 'manual');
    if (sourceIssues.length) throw failure(sourceIssues[0], 409, 'ACADEMIC_SCORE_SOURCE_FORBIDDEN');
    const calculated = calculateAcademicStudentScore(scheme, normalizedScores);
    return {
      previous,
      record: {
        ...(previous || {}), RecordId: ScoreId, ScoreId, SheetId, StudentRef: studentRef,
        SessionId: context.session.SessionId, TermId: context.term.TermId,
        ClassId: context.schoolClass.ClassId, ArmId: context.arm.ArmId, SubjectId: context.subject.SubjectId,
        AssessmentRevisionId: scheme.RevisionId,
        ...calculated,
        SourceType: 'Manual', SourceId: '',
        BranchId: scope.branchId, SchoolSection: scope.section,
        CreatedAt: clean(previous?.CreatedAt) || timestamp,
        CreatedBy: clean(previous?.CreatedBy) || actorName(user),
        UpdatedAt: timestamp, UpdatedBy: actorName(user), UpdatedByUsername: actorUsername(user)
      },
      revisionToken: clean(row.RevisionToken)
    };
  });
  const projectedScores = [
    ...state.studentScores.filter((row) => row.SheetId === SheetId && !updatedScores.some((item) => item.record.ScoreId === row.ScoreId)),
    ...updatedScores.map((item) => item.record)
  ];
  const sheet = academicScoreSheetRecord(context, existing, user, timestamp, {
    ...academicScoreSheetCounts(projectedScores), LastSavedAt: timestamp, LastSavedBy: actorName(user)
  });
  const writes = updatedScores.map(({ previous, record, revisionToken }) => ({
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentScores,
    documentId: record.ScoreId, data: withoutMetadata(record), ...writePrecondition(previous, revisionToken)
  }));
  writes.push({
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreSheets,
    documentId: SheetId, data: withoutMetadata(sheet), ...writePrecondition(existing, input.SheetRevisionToken)
  });
  writes.push(auditWrite(user, 'SAVE_DRAFT', 'scoreSheet', sheet, `${updatedScores.length} student score${updatedScores.length === 1 ? '' : 's'}`));
  await commitAcademicBatch(env, writes, 'The score sheet changed while it was being saved. Reload before entering scores again.');
  return academicOperationalResponse(env, user, input, scope, `${updatedScores.length} student score${updatedScores.length === 1 ? '' : 's'} saved as a draft.`);
}

function assertAcademicScoreSheetComplete(state, sheet, roster) {
  const scores = state.studentScores.filter((row) => row.SheetId === sheet.SheetId);
  const complete = new Set(scores.filter((row) => row.CompletionStatus === 'Complete').map((row) => lower(row.StudentRef)));
  const pending = roster.filter((row) => !complete.has(lower(row.StudentRef)));
  if (pending.length) throw failure(`${pending.length} student score${pending.length === 1 ? ' is' : 's are'} incomplete. Complete every required component before submission.`, 409, 'ACADEMIC_SCORE_SHEET_INCOMPLETE');
  return scores;
}

export async function changeAcademicScoreSheetStatus(env, user = {}, input = {}) {
  const context = await academicScoreSheetContext(env, user, input, 'canEnterScores');
  const { permissions, scope, state, existing, roster } = context;
  if (!existing) throw failure('Save at least one draft score before changing the score-sheet status.', 409);
  const target = oneOf(input.Status || input.TargetStatus, ACADEMIC_SCORE_SHEET_STATUSES, '');
  if (!target) throw failure('Choose Draft, Submitted, Approved or Locked.');
  const current = clean(existing.Status || 'Draft');
  const reason = clean(input.Reason).slice(0, 500);
  const normalTransition = (current === 'Draft' && target === 'Submitted')
    || (current === 'Submitted' && target === 'Approved')
    || (current === 'Approved' && target === 'Locked');
  const reopening = target === 'Draft' && ['Submitted', 'Approved', 'Locked'].includes(current);
  if (!normalTransition && !reopening) throw failure(`${current} score sheets cannot move directly to ${target}.`, 409, 'ACADEMIC_SCORE_STATUS_INVALID');
  if (target === 'Submitted') assertAcademicScoreSheetComplete(state, existing, roster);
  if (target === 'Approved' && !permissions.canReviewScores) throw failure('Only an academic reviewer may approve submitted scores.', 403);
  if (target === 'Locked' && !permissions.canApproveScores) throw failure('Only an academic approver may lock approved scores.', 403);
  if (reopening && !permissions.canReviewScores) throw failure('Only an academic reviewer may reopen a score sheet.', 403);
  if (reopening && !reason) throw failure('Enter the approved reason for reopening this score sheet.');
  const timestamp = nowIso();
  const eventName = target === 'Submitted' ? 'Submitted' : target === 'Approved' ? 'Approved' : target === 'Locked' ? 'Locked' : 'Reopened';
  const record = academicScoreSheetRecord(context, existing, user, timestamp, {
    Status: target,
    [`${eventName}At`]: timestamp,
    [`${eventName}By`]: actorName(user),
    [`${eventName}ByUsername`]: actorUsername(user),
    ...(reopening ? { ReopenReason: reason } : {})
  });
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreSheets, documentId: record.SheetId,
      data: withoutMetadata(record), ...writePrecondition(existing, input.RevisionToken || input.SheetRevisionToken) },
    auditWrite(user, eventName.toUpperCase(), 'scoreSheet', record, reason || `${current} -> ${target}`)
  ], 'The score sheet changed while its status was being updated. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope,
    reopening ? `Score sheet reopened as Draft: ${reason}` : `Score sheet moved from ${current} to ${target}.`);
}

async function academicTermResultContext(env, user, input, capability = 'canCalculateResults') {
  const context = await academicOperationalContext(env, user, input, capability);
  const { scope, state, session, term } = context;
  const schoolClass = assertReference(findById(state.classes, input.ClassId), 'Choose an active class.');
  const arm = assertReference(findById(state.arms, input.ArmId), 'Choose an active classroom arm.');
  if (arm.ClassId !== schoolClass.ClassId) throw failure('The selected arm does not belong to this class.');
  const scopeChain = academicPolicyScopeChain({
    BranchId: scope.branchId, SectionId: scope.section, ClassId: schoolClass.ClassId
  });
  const policyView = await loadAcademicPolicyView(env, {
    scope: scopeChain.at(-1), scopeChain, period: { Session: session.Name, Term: term.Name }
  });
  const policyRevisionIds = (policyView.Sources || []).map((row) => clean(row.RevisionId)).filter(Boolean);
  if (!policyRevisionIds.length) {
    throw failure('Activate the academic policy for this class and term before calculating results.', 409, 'ACADEMIC_RESULT_POLICY_REQUIRED');
  }
  const policy = normalizeAcademicPolicy(policyView.ActivePolicy || {});
  const policyIssues = academicPolicyIssues(policy, { forActivation: true });
  if (policyIssues.length) {
    throw failure(`Complete the active academic policy before calculating results: ${policyIssues[0].message}`, 409, 'ACADEMIC_RESULT_POLICY_INCOMPLETE');
  }
  return {
    ...context, schoolClass, arm, policy, policyRevisionIds,
    policyFingerprint: await academicResultPolicyFingerprint(policy)
  };
}

function academicTermResultId(scope, sessionId, termId, classId, armId, studentRef) {
  return academicId('term-result', scope.branchId, scope.section, sessionId, termId, classId, armId, studentRef);
}

function resultRevisionToken(input = {}, resultId = '') {
  let supplied = input.RevisionTokens || {};
  if (typeof supplied === 'string') {
    try { supplied = JSON.parse(supplied); } catch (_error) { supplied = {}; }
  }
  return clean(supplied?.[resultId] || (clean(input.ResultId) === clean(resultId) ? input.RevisionToken : ''));
}

function academicResultEventWrite(user, result, eventType, details = '') {
  const eventId = `RESULT-EVENT-${Date.now()}-${globalThis.crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  return {
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.resultEvents,
    documentId: eventId,
    exists: false,
    data: {
      RecordId: eventId, ResultEventId: eventId, ResultId: result.ResultId,
      StudentRef: result.StudentRef, SessionId: result.SessionId, TermId: result.TermId,
      ClassId: result.ClassId, ArmId: result.ArmId,
      EventType: clean(eventType), Status: clean(result.Status),
      Details: clean(details).slice(0, 1000),
      BranchId: result.BranchId, SchoolSection: result.SchoolSection,
      CreatedAt: nowIso(), CreatedBy: actorName(user), CreatedByUsername: actorUsername(user)
    }
  };
}

async function notifyAcademicResultLifecycle(env, user, scope, results, target) {
  if (!['Published', 'Withdrawn'].includes(target)) return;
  const people = await loadPeople(env, user, scope).catch(() => ({ students: [] }));
  const byStudent = new Map((people.students || []).map((row) => [lower(studentReference(row)), row]));
  await Promise.allSettled(results.map((result) => {
    const student = byStudent.get(lower(result.StudentRef)) || {};
    const contacts = academicParentContacts(student);
    const name = clean(student.DisplayName || student.ApplicantName || student.StudentName || result.StudentRef);
    const published = target === 'Published';
    return createNotification(env, {
      EventKey: `academic-result:${result.ResultId}:${target}:${clean(result.UpdatedAt)}`,
      Type: published ? 'Term result published' : 'Term result withdrawn',
      Category: 'Academics', Audience: 'Parent', Channels: ['InApp', 'Push'],
      TargetEmails: contacts.emails, TargetAccountRefs: contacts.accountRefs,
      Title: published ? `${name}'s term result is published` : `${name}'s term result is temporarily unavailable`,
      Message: published
        ? `The ${result.Term || 'current term'} result is published. Sign in to the parent dashboard; access remains subject to the school's active result policy.`
        : `The ${result.Term || 'term'} result was withdrawn for controlled correction and is no longer available to parents. The school will republish it after review.`,
      ActionUrl: 'parent-dashboard.html?section=results', RecordType: 'academicResult', RecordId: result.ResultId,
      BranchId: scope.branchId, SchoolSection: scope.section,
      ActorType: 'Staff', ActorId: actorUsername(user), CreatedBy: actorName(user)
    });
  }));
}

export async function calculateAcademicTermResults(env, user = {}, input = {}) {
  const context = await academicTermResultContext(env, user, input, 'canCalculateResults');
  const { scope, state, session, term, schoolClass, arm, policy, policyRevisionIds, policyFingerprint } = context;
  const memberships = state.studentMemberships.filter((row) => statusActive(row)
    && row.SessionId === session.SessionId && row.TermId === term.TermId
    && row.ClassId === schoolClass.ClassId && row.ArmId === arm.ArmId);
  if (memberships.length > 200) throw failure('Calculate at most 200 student results in one classroom batch.');
  const existingResults = state.termResults.filter((row) => row.SessionId === session.SessionId && row.TermId === term.TermId
    && row.ClassId === schoolClass.ClassId && row.ArmId === arm.ArmId);
  const immutable = existingResults.find((row) => lower(row.Status) !== 'calculated draft');
  if (immutable) {
    throw failure(`${immutable.StudentRef} already has a ${immutable.Status} result. Reopen or withdraw the affected result through the controlled workflow first.`, 409, 'ACADEMIC_RESULT_IMMUTABLE');
  }
  const ids = new Map();
  const references = new Map();
  for (const membership of memberships) {
    const id = academicTermResultId(scope, session.SessionId, term.TermId, schoolClass.ClassId, arm.ArmId, membership.StudentRef);
    ids.set(lower(membership.StudentRef), id);
    references.set(lower(membership.StudentRef), clean(findById(existingResults, id)?.ResultReference) || await academicResultReference(id));
  }
  const calculation = calculateAcademicTermResultDrafts({
    SessionId: session.SessionId, AcademicSession: session.Name,
    TermId: term.TermId, Term: term.Name,
    ClassId: schoolClass.ClassId, ClassName: schoolClass.Name,
    ArmId: arm.ArmId, ArmName: arm.Name,
    Memberships: memberships,
    ScoreSheets: state.scoreSheets,
    StudentScores: state.studentScores,
    Subjects: state.subjects,
    Attendance: state.studentAttendance,
    AttendanceMode: oneOf(input.AttendanceMode, ACADEMIC_ATTENDANCE_MODES, 'Daily'),
    ExistingResults: existingResults,
    Policy: policy,
    PolicyRevisionIds: policyRevisionIds,
    PolicyFingerprint: policyFingerprint,
    ResultIdFor: (membership) => ids.get(lower(membership.StudentRef)),
    ResultReferenceFor: (membership) => references.get(lower(membership.StudentRef))
  });
  if (!calculation.Ready) {
    const summary = calculation.Issues.slice(0, 5).join(' ');
    const remaining = calculation.Issues.length > 5 ? ` ${calculation.Issues.length - 5} more issue(s) require attention.` : '';
    throw failure(`${summary}${remaining}`, 409, 'ACADEMIC_RESULT_CALCULATION_BLOCKED');
  }
  const timestamp = nowIso();
  const writes = [];
  calculation.Results.forEach((draft) => {
    const existing = findById(existingResults, draft.ResultId);
    const result = {
      ...(existing || {}), ...draft,
      RecordId: draft.ResultId,
      BranchId: scope.branchId, SchoolSection: scope.section,
      CalculationRevision: Number(existing?.CalculationRevision || 0) + 1,
      CalculatedAt: timestamp, CalculatedBy: actorName(user), CalculatedByUsername: actorUsername(user),
      CreatedAt: clean(existing?.CreatedAt) || timestamp,
      CreatedBy: clean(existing?.CreatedBy) || actorName(user),
      UpdatedAt: timestamp, UpdatedBy: actorName(user)
    };
    writes.push({
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.termResults,
      documentId: result.ResultId,
      data: withoutMetadata(result),
      ...writePrecondition(existing, resultRevisionToken(input, result.ResultId))
    });
    writes.push(academicResultEventWrite(user, result, existing ? 'RECALCULATED' : 'CALCULATED',
      `${result.SubjectCount} subject(s); ${result.Attendance.RegisterType} attendance; policy ${result.PolicyFingerprint}`));
  });
  writes.push(auditWrite(user, existingResults.length ? 'RECALCULATE' : 'CALCULATE', 'termResult', {
    RecordId: `classroom-results-${schoolClass.ClassId}-${arm.ArmId}`,
    SessionId: session.SessionId, TermId: term.TermId,
    BranchId: scope.branchId, SchoolSection: scope.section
  }, `${calculation.Results.length} Calculated Draft result(s); policy ${policyFingerprint}`));
  await commitAcademicBatch(env, writes, 'One or more term results changed while the classroom was being calculated. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope,
    `${calculation.Results.length} term result${calculation.Results.length === 1 ? '' : 's'} calculated as Draft from approved scores.`);
}

function academicTermResultIds(value) {
  let ids = value;
  if (typeof ids === 'string') {
    try { ids = JSON.parse(ids); } catch (_error) { ids = ids.split(','); }
  }
  return uniqueIds(Array.isArray(ids) ? ids : []);
}

export async function previewAcademicTermResultWithdrawal(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canPublishResults');
  const ids = academicTermResultIds(input.ResultIds || [input.ResultId]);
  const results = ids.map((id) => findById(context.state.termResults, id)).filter(Boolean);
  if (!results.length || results.length !== ids.length) throw failure('One or more selected term results were not found.', 404);
  const eligible = results.filter((row) => ['published', 'locked'].includes(lower(row.Status)));
  if (eligible.length !== results.length) throw failure('Only Published or Locked results can be withdrawn.', 409);
  return {
    ok: true,
    message: `${eligible.length} published result${eligible.length === 1 ? '' : 's'} will become unavailable to parents immediately. The saved result snapshot and audit history will be retained.`,
    resultWithdrawalPreview: {
      ResultCount: eligible.length,
      StudentRefs: eligible.map((row) => row.StudentRef),
      ParentAccessRemoved: true,
      SnapshotRetained: true,
      RequiresReason: true,
      RequiresReapprovalBeforeRepublishing: true
    }
  };
}

export async function changeAcademicTermResultStatus(env, user = {}, input = {}) {
  const target = ACADEMIC_TERM_RESULT_STATUSES.find((value) => lower(value) === lower(input.Status || input.TargetStatus));
  if (!target) throw failure('Choose a valid term-result status.');
  const capability = ['Published', 'Locked', 'Withdrawn'].includes(target) ? 'canPublishResults' : 'canReviewResults';
  const context = await academicOperationalContext(env, user, input, capability);
  const { scope, state } = context;
  const ids = academicTermResultIds(input.ResultIds || [input.ResultId]);
  if (!ids.length || ids.length > 200) throw failure('Choose between 1 and 200 term results.');
  const results = ids.map((id) => findById(state.termResults, id));
  if (results.some((row) => !row)) throw failure('One or more selected term results were not found.', 404);
  if (target === 'Published') {
    const invalid = results.find((result) => academicPolicyIssues(result.PolicySnapshot || {}, { forActivation: true }).length);
    if (invalid) throw failure(`${invalid.StudentRef} has an incomplete policy snapshot and cannot be published. Recalculate it after activating the complete policy.`, 409, 'ACADEMIC_RESULT_POLICY_SNAPSHOT_INVALID');
  }
  const reason = clean(input.Reason).slice(0, 500);
  const transitions = results.map((result) => academicTermResultTransition(result.Status, target));
  if (transitions.some((transition) => !transition.Allowed)) {
    throw failure(`The selected results cannot move directly to ${target}.`, 409, 'ACADEMIC_RESULT_STATUS_INVALID');
  }
  if (transitions.some((transition) => transition.RequiresReason) && !reason) {
    throw failure('Enter the approved reason for this result withdrawal or reopening.');
  }
  if (target === 'Withdrawn' && input.ImpactAcknowledged !== true) {
    throw failure('Preview and acknowledge the parent-access impact before withdrawing published results.', 409, 'ACADEMIC_RESULT_IMPACT_ACKNOWLEDGEMENT_REQUIRED');
  }
  const timestamp = nowIso();
  const writes = [];
  results.forEach((existing) => {
    const event = target === 'Calculated Draft' ? 'Reopened' : target;
    const result = {
      ...existing,
      Status: target,
      PublicationStatus: target,
      UpdatedAt: timestamp, UpdatedBy: actorName(user),
      [`${event.replace(/\s+/g, '')}At`]: timestamp,
      [`${event.replace(/\s+/g, '')}By`]: actorName(user),
      [`${event.replace(/\s+/g, '')}ByUsername`]: actorUsername(user),
      ...(reason ? { [`${event.replace(/\s+/g, '')}Reason`]: reason } : {}),
      ...(target === 'Withdrawn' ? { WithdrawnFromStatus: existing.Status } : {})
    };
    writes.push({
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.termResults,
      documentId: result.ResultId,
      data: withoutMetadata(result),
      ...writePrecondition(existing, resultRevisionToken(input, result.ResultId))
    });
    writes.push(academicResultEventWrite(user, result, event.toUpperCase(), reason || `${existing.Status} -> ${target}`));
  });
  writes.push(auditWrite(user, target.toUpperCase(), 'termResult', {
    RecordId: results[0].ResultId,
    SessionId: results[0].SessionId, TermId: results[0].TermId,
    BranchId: scope.branchId, SchoolSection: scope.section
  }, `${results.length} result(s): ${reason || `${results[0].Status} -> ${target}`}`));
  await commitAcademicBatch(env, writes, 'One or more selected term results changed while their status was being updated. Reload and try again.');
  await notifyAcademicResultLifecycle(env, user, scope, results.map((existing) => ({
    ...existing, Status: target, UpdatedAt: timestamp
  })), target);
  return academicOperationalResponse(env, user, input, scope,
    `${results.length} term result${results.length === 1 ? '' : 's'} moved to ${target}.`);
}

export async function saveAcademicTermResultRemarks(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canEnterScores');
  const { permissions, scope, state } = context;
  const existing = findById(state.termResults, input.ResultId);
  if (!existing) throw failure('Choose a calculated term result.', 404);
  if (lower(existing.Status) !== 'calculated draft') {
    throw failure('Remarks can change only while the result is a Calculated Draft.', 409, 'ACADEMIC_RESULT_REMARKS_LOCKED');
  }
  if (permissions.teacherView) {
    const assigned = state.teacherAllocations.some((row) => statusActive(row)
      && row.SessionId === existing.SessionId && row.TermId === existing.TermId
      && row.ClassId === existing.ClassId && row.ArmId === existing.ArmId
      && ['form teacher', 'assistant teacher'].includes(lower(row.AllocationRole))
      && lower(row.TeacherUsername) === actorUsername(user));
    if (!assigned) throw failure('Only this classroom’s Form Teacher or Assistant may enter the teacher remark.', 403);
  }
  const timestamp = nowIso();
  const result = {
    ...existing,
    TeacherRemark: clean(input.TeacherRemark).slice(0, 1000),
    Recommendation: clean(input.Recommendation).slice(0, 1000),
    ...(permissions.canPublishResults ? { PrincipalRemark: clean(input.PrincipalRemark).slice(0, 1000) } : {}),
    UpdatedAt: timestamp, UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.termResults, documentId: result.ResultId,
      data: withoutMetadata(result), ...writePrecondition(existing, input.RevisionToken) },
    academicResultEventWrite(user, result, 'REMARKS_UPDATED', 'Draft result comments updated.'),
    auditWrite(user, 'UPDATE_REMARKS', 'termResult', result, 'Draft result comments updated.')
  ], 'This result changed while its remarks were being saved. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, `${result.StudentRef} result remarks saved.`);
}

function academicOutcomeEventWrite(user, collectionPath, prefix, record, eventType, details = '') {
  const eventId = `${prefix}-EVENT-${Date.now()}-${globalThis.crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const identity = prefix === 'CUMULATIVE'
    ? { CumulativeEventId: eventId, CumulativeResultId: record.CumulativeResultId }
    : prefix === 'PROMOTION'
      ? { PromotionEventId: eventId, PromotionDecisionId: record.PromotionDecisionId }
      : { TranscriptEventId: eventId, TranscriptId: record.TranscriptId };
  return {
    collectionPath,
    documentId: eventId,
    exists: false,
    data: {
      RecordId: eventId,
      ...identity,
      StudentRef: record.StudentRef,
      SessionId: clean(record.SessionId),
      TermId: clean(record.FinalTermId || record.TermId),
      ClassId: clean(record.ClassId),
      ArmId: clean(record.ArmId),
      EventType: clean(eventType),
      Status: clean(record.Status),
      Details: clean(details).slice(0, 1000),
      BranchId: record.BranchId,
      SchoolSection: record.SchoolSection,
      CreatedAt: nowIso(),
      CreatedBy: actorName(user),
      CreatedByUsername: actorUsername(user)
    }
  };
}

async function academicOutcomeReference(recordIdValue, prefix) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean(recordIdValue)));
  return `${prefix}-${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase()}`;
}

function academicCumulativeResultId(scope, sessionId, classId, armId, studentRef) {
  return academicId('cumulative-result', scope.branchId, scope.section, sessionId, classId, armId, studentRef);
}

export async function calculateAcademicCumulativeResults(env, user = {}, input = {}) {
  const context = await academicTermResultContext(env, user, input, 'canCalculateCumulativeResults');
  const { scope, state, session, term, schoolClass, arm, policy, policyRevisionIds, policyFingerprint } = context;
  const cumulativeIssues = academicCumulativePolicyIssues(policy);
  if (cumulativeIssues.length) {
    throw failure(`Complete the cumulative-result policy before calculating: ${cumulativeIssues[0].message}`, 409, 'ACADEMIC_CUMULATIVE_POLICY_INCOMPLETE');
  }
  const memberships = state.studentMemberships.filter((row) => statusActive(row)
    && row.SessionId === session.SessionId && row.TermId === term.TermId
    && row.ClassId === schoolClass.ClassId && row.ArmId === arm.ArmId);
  if (memberships.length > 200) throw failure('Calculate at most 200 cumulative results in one classroom batch.');
  const existingResults = state.cumulativeResults.filter((row) => row.SessionId === session.SessionId
    && row.ClassId === schoolClass.ClassId && row.ArmId === arm.ArmId);
  const immutable = existingResults.find((row) => lower(row.Status) !== 'calculated draft');
  if (immutable) {
    throw failure(`${immutable.StudentRef} already has a ${immutable.Status} cumulative result. Reopen the affected result before recalculating.`, 409, 'ACADEMIC_CUMULATIVE_IMMUTABLE');
  }
  const ids = new Map();
  const references = new Map();
  for (const membership of memberships) {
    const id = academicCumulativeResultId(scope, session.SessionId, schoolClass.ClassId, arm.ArmId, membership.StudentRef);
    ids.set(lower(membership.StudentRef), id);
    references.set(lower(membership.StudentRef), clean(findById(existingResults, id)?.CumulativeReference)
      || await academicOutcomeReference(id, 'CR'));
  }
  const calculation = calculateAcademicCumulativeDrafts({
    SessionId: session.SessionId,
    AcademicSession: session.Name,
    FinalTermId: term.TermId,
    ClassId: schoolClass.ClassId,
    ClassName: schoolClass.Name,
    SchoolStage: schoolClass.SchoolStage,
    ArmId: arm.ArmId,
    ArmName: arm.Name,
    Memberships: memberships,
    TermResults: state.termResults,
    ExistingResults: existingResults,
    Policy: policy,
    PolicyRevisionIds: policyRevisionIds,
    PolicyFingerprint: policyFingerprint,
    ResultIdFor: (membership) => ids.get(lower(membership.StudentRef)),
    ResultReferenceFor: (membership) => references.get(lower(membership.StudentRef))
  });
  if (!calculation.Ready) {
    const summary = calculation.Issues.slice(0, 5).join(' ');
    const remaining = calculation.Issues.length > 5 ? ` ${calculation.Issues.length - 5} more issue(s) require attention.` : '';
    throw failure(`${summary}${remaining}`, 409, 'ACADEMIC_CUMULATIVE_CALCULATION_BLOCKED');
  }
  const timestamp = nowIso();
  const writes = [];
  calculation.Results.forEach((draft) => {
    const existing = findById(existingResults, draft.CumulativeResultId);
    const result = {
      ...(existing || {}),
      ...draft,
      RecordId: draft.CumulativeResultId,
      BranchId: scope.branchId,
      SchoolSection: scope.section,
      CalculationRevision: Number(existing?.CalculationRevision || 0) + 1,
      CalculatedAt: timestamp,
      CalculatedBy: actorName(user),
      CalculatedByUsername: actorUsername(user),
      CreatedAt: clean(existing?.CreatedAt) || timestamp,
      CreatedBy: clean(existing?.CreatedBy) || actorName(user),
      UpdatedAt: timestamp,
      UpdatedBy: actorName(user)
    };
    writes.push({
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.cumulativeResults,
      documentId: result.CumulativeResultId,
      data: withoutMetadata(result),
      ...writePrecondition(existing, resultRevisionToken(input, result.CumulativeResultId))
    });
    writes.push(academicOutcomeEventWrite(
      user,
      ACADEMIC_MANAGEMENT_COLLECTIONS.cumulativeEvents,
      'CUMULATIVE',
      result,
      existing ? 'RECALCULATED' : 'CALCULATED',
      `${result.SubjectCount} subject(s); ${result.ContributingResultIds.length} locked term result(s); policy ${policyFingerprint}`
    ));
  });
  writes.push(auditWrite(user, existingResults.length ? 'RECALCULATE' : 'CALCULATE', 'cumulativeResult', {
    RecordId: `cumulative-${schoolClass.ClassId}-${arm.ArmId}`,
    SessionId: session.SessionId,
    TermId: term.TermId,
    BranchId: scope.branchId,
    SchoolSection: scope.section
  }, `${calculation.Results.length} Calculated Draft cumulative result(s); policy ${policyFingerprint}`));
  await commitAcademicBatch(env, writes, 'One or more cumulative results changed while the classroom was being calculated. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope,
    `${calculation.Results.length} cumulative result${calculation.Results.length === 1 ? '' : 's'} calculated as Draft from locked term results.`);
}

export async function changeAcademicCumulativeStatus(env, user = {}, input = {}) {
  const target = ACADEMIC_CUMULATIVE_STATUSES.find((value) => lower(value) === lower(input.Status || input.TargetStatus));
  if (!target) throw failure('Choose a valid cumulative-result status.');
  const context = await academicOperationalContext(env, user, input, 'canCalculateCumulativeResults');
  const ids = academicTermResultIds(input.CumulativeResultIds || [input.CumulativeResultId]);
  if (!ids.length || ids.length > 200) throw failure('Choose between 1 and 200 cumulative results.');
  const results = ids.map((id) => findById(context.state.cumulativeResults, id));
  if (results.some((row) => !row)) throw failure('One or more selected cumulative results were not found.', 404);
  const transitions = results.map((result) => academicCumulativeTransition(result.Status, target));
  if (transitions.some((transition) => !transition.Allowed)) {
    throw failure(`The selected cumulative results cannot move directly to ${target}.`, 409, 'ACADEMIC_CUMULATIVE_STATUS_INVALID');
  }
  const reason = clean(input.Reason).slice(0, 500);
  if (transitions.some((transition) => transition.RequiresReason) && !reason) throw failure('Enter the approved reason for reopening these results.');
  const timestamp = nowIso();
  const writes = [];
  results.forEach((existing) => {
    const result = {
      ...existing,
      Status: target,
      UpdatedAt: timestamp,
      UpdatedBy: actorName(user),
      [`${target.replace(/\s+/g, '')}At`]: timestamp,
      [`${target.replace(/\s+/g, '')}By`]: actorName(user),
      ...(reason ? { ReopenReason: reason } : {})
    };
    writes.push({
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.cumulativeResults,
      documentId: result.CumulativeResultId,
      data: withoutMetadata(result),
      ...writePrecondition(existing, resultRevisionToken(input, result.CumulativeResultId))
    });
    writes.push(academicOutcomeEventWrite(user, ACADEMIC_MANAGEMENT_COLLECTIONS.cumulativeEvents,
      'CUMULATIVE', result, target.toUpperCase(), reason || `${existing.Status} -> ${target}`));
  });
  writes.push(auditWrite(user, target.toUpperCase(), 'cumulativeResult', {
    RecordId: ids.join(',').slice(0, 250),
    SessionId: context.session.SessionId,
    TermId: context.term.TermId,
    BranchId: context.scope.branchId,
    SchoolSection: context.scope.section
  }, reason || `${results.length} cumulative result(s) moved to ${target}.`));
  await commitAcademicBatch(env, writes, 'One or more cumulative results changed while their status was being updated. Reload and try again.');
  return academicOperationalResponse(env, user, input, context.scope,
    `${results.length} cumulative result${results.length === 1 ? '' : 's'} moved to ${target}.`);
}

function academicPromotionDecisionId(scope, sessionId, classId, armId, studentRef) {
  return academicId('promotion-decision', scope.branchId, scope.section, sessionId, classId, armId, studentRef);
}

export async function calculateAcademicPromotionDecisions(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManagePromotions');
  const { scope, state, session } = context;
  const schoolClass = assertReference(findById(state.classes, input.ClassId), 'Choose a class.');
  const arm = assertReference(findById(state.arms, input.ArmId), 'Choose a classroom arm.');
  if (arm.ClassId !== schoolClass.ClassId) throw failure('The selected arm does not belong to this class.');
  const cumulative = state.cumulativeResults.filter((row) => lower(row.Status) === 'locked'
    && row.SessionId === session.SessionId && row.ClassId === schoolClass.ClassId && row.ArmId === arm.ArmId);
  if (!cumulative.length) throw failure('Lock the classroom cumulative results before calculating promotion decisions.', 409, 'ACADEMIC_CUMULATIVE_LOCK_REQUIRED');
  const existingDecisions = state.promotionDecisions.filter((row) => row.SessionId === session.SessionId
    && row.ClassId === schoolClass.ClassId && row.ArmId === arm.ArmId);
  const immutable = existingDecisions.find((row) => lower(row.Status) !== 'draft');
  if (immutable) throw failure(`${immutable.StudentRef} already has a ${immutable.Status} promotion decision. Reopen it before recalculating.`, 409, 'ACADEMIC_PROMOTION_IMMUTABLE');
  const timestamp = nowIso();
  const writes = [];
  cumulative.forEach((result) => {
    const id = academicPromotionDecisionId(scope, session.SessionId, schoolClass.ClassId, arm.ArmId, result.StudentRef);
    const existing = findById(existingDecisions, id);
    const recommendation = evaluateAcademicPromotionDecision(result, result.PolicySnapshot || {});
    const decision = {
      ...(existing || {}),
      RecordId: id,
      PromotionDecisionId: id,
      CumulativeResultId: result.CumulativeResultId,
      CumulativeReference: result.CumulativeReference,
      StudentRef: result.StudentRef,
      SessionId: session.SessionId,
      AcademicSession: session.Name,
      FinalTermId: result.FinalTermId,
      ClassId: schoolClass.ClassId,
      ClassName: schoolClass.Name,
      SchoolStage: clean(result.SchoolStage || schoolClass.SchoolStage),
      ArmId: arm.ArmId,
      ArmName: arm.Name,
      DepartmentId: result.DepartmentId,
      OverallAverage: result.OverallAverage,
      AttendancePercentage: result.Attendance?.AttendancePercentage || 0,
      ...recommendation,
      FinalOutcome: recommendation.RecommendedOutcome,
      OverrideReason: '',
      Status: 'Draft',
      PolicyRevisionIds: result.PolicyRevisionIds || [],
      PolicyFingerprint: result.PolicyFingerprint,
      PolicySnapshot: result.PolicySnapshot,
      BranchId: scope.branchId,
      SchoolSection: scope.section,
      CalculatedAt: timestamp,
      CalculatedBy: actorName(user),
      CreatedAt: clean(existing?.CreatedAt) || timestamp,
      CreatedBy: clean(existing?.CreatedBy) || actorName(user),
      UpdatedAt: timestamp,
      UpdatedBy: actorName(user)
    };
    writes.push({
      collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.promotionDecisions,
      documentId: id,
      data: withoutMetadata(decision),
      ...writePrecondition(existing, resultRevisionToken(input, id))
    });
    writes.push(academicOutcomeEventWrite(user, ACADEMIC_MANAGEMENT_COLLECTIONS.promotionEvents,
      'PROMOTION', decision, existing ? 'RECALCULATED' : 'CALCULATED', `${recommendation.RecommendationType}: ${recommendation.RecommendedOutcome}`));
  });
  writes.push(auditWrite(user, existingDecisions.length ? 'RECALCULATE' : 'CALCULATE', 'promotionDecision', {
    RecordId: `promotion-${schoolClass.ClassId}-${arm.ArmId}`,
    SessionId: session.SessionId,
    TermId: context.term.TermId,
    BranchId: scope.branchId,
    SchoolSection: scope.section
  }, `${cumulative.length} Draft promotion recommendation(s) calculated from Locked cumulative results.`));
  await commitAcademicBatch(env, writes, 'One or more promotion decisions changed while recommendations were being calculated. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope,
    `${cumulative.length} promotion recommendation${cumulative.length === 1 ? '' : 's'} calculated as Draft.`);
}

export async function saveAcademicPromotionOutcome(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canManagePromotions');
  const existing = findById(context.state.promotionDecisions, input.PromotionDecisionId);
  if (!existing) throw failure('Choose a promotion decision.', 404);
  if (lower(existing.Status) !== 'draft') throw failure('The final outcome can change only while the decision is Draft.', 409);
  const outcome = ACADEMIC_PROMOTION_OUTCOMES.find((value) => lower(value) === lower(input.FinalOutcome));
  if (!outcome) throw failure('Choose a valid promotion outcome.');
  const reason = clean(input.OverrideReason || input.Reason).slice(0, 500);
  if (outcome !== existing.RecommendedOutcome && !reason) throw failure('Enter the reason for overriding the calculated recommendation.');
  const decision = {
    ...existing,
    FinalOutcome: outcome,
    OverrideReason: outcome === existing.RecommendedOutcome ? '' : reason,
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.promotionDecisions, documentId: decision.PromotionDecisionId,
      data: withoutMetadata(decision), ...writePrecondition(existing, input.RevisionToken) },
    academicOutcomeEventWrite(user, ACADEMIC_MANAGEMENT_COLLECTIONS.promotionEvents,
      'PROMOTION', decision, 'OUTCOME_UPDATED', reason || `Final outcome set to ${outcome}.`),
    auditWrite(user, 'UPDATE_OUTCOME', 'promotionDecision', decision,
      reason || `${existing.RecommendedOutcome} -> ${outcome}`)
  ], 'This promotion decision changed while its outcome was being saved. Reload and try again.');
  return academicOperationalResponse(env, user, input, context.scope, `${decision.StudentRef} final outcome saved as ${outcome}.`);
}

export async function changeAcademicPromotionStatus(env, user = {}, input = {}) {
  const target = ACADEMIC_PROMOTION_STATUSES.find((value) => lower(value) === lower(input.Status || input.TargetStatus));
  if (!target) throw failure('Choose a valid promotion-decision status.');
  const context = await academicOperationalContext(env, user, input, 'canManagePromotions');
  const existing = findById(context.state.promotionDecisions, input.PromotionDecisionId);
  if (!existing) throw failure('Choose a promotion decision.', 404);
  const transition = academicPromotionTransition(existing.Status, target);
  if (!transition.Allowed) throw failure(`This promotion decision cannot move directly to ${target}.`, 409);
  const reason = clean(input.Reason).slice(0, 500);
  if (transition.RequiresReason && !reason) throw failure('Enter the approved reason for reopening this promotion decision.');
  if (target === 'Approved' && existing.FinalOutcome === 'Pending') {
    throw failure('Choose a final promotion outcome before approving this decision.', 409, 'ACADEMIC_PROMOTION_OUTCOME_REQUIRED');
  }
  const timestamp = nowIso();
  let destination = null;
  const writes = [];
  if (target === 'Committed' && ['Promoted', 'Probation', 'Repeated'].includes(existing.FinalOutcome)) {
    const destinationSession = assertReference(findById(context.state.sessions, input.DestinationSessionId), 'Choose the destination academic session.');
    const destinationTerm = assertReference(findById(context.state.terms, input.DestinationTermId), 'Choose the destination term.');
    const destinationClass = assertReference(findById(context.state.classes, input.DestinationClassId), 'Choose the destination class.');
    const destinationArm = assertReference(findById(context.state.arms, input.DestinationArmId), 'Choose the destination classroom arm.');
    if (destinationTerm.SessionId !== destinationSession.SessionId || destinationArm.ClassId !== destinationClass.ClassId) {
      throw failure('The selected promotion destination is inconsistent.');
    }
    destination = normalizeAcademicStudentMembership({
      SessionId: destinationSession.SessionId,
      TermId: destinationTerm.TermId,
      StudentRef: existing.StudentRef,
      ClassId: destinationClass.ClassId,
      ArmId: destinationArm.ArmId,
      DepartmentId: destinationArm.DepartmentId,
      SubjectIds: [], CoreSubjectIds: [], TradeSubjectIds: [], OptionalSubjectIds: [],
      CurriculumStatus: 'Pending subject allocation', Status: 'Active'
    }, context.scope);
    const currentDestination = findById(context.state.studentMemberships, destination.MembershipId);
    if (currentDestination && (currentDestination.ClassId !== destination.ClassId || currentDestination.ArmId !== destination.ArmId)) {
      throw failure('This student already has a different membership in the destination period.', 409, 'ACADEMIC_PROMOTION_DESTINATION_CONFLICT');
    }
    if (!currentDestination) {
      assertAcademicMembershipCapacity(context.state, destination);
      destination.CreatedAt = timestamp;
      destination.CreatedBy = actorName(user);
      destination.UpdatedAt = timestamp;
      destination.UpdatedBy = actorName(user);
      writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentMemberships,
        documentId: destination.MembershipId, data: withoutMetadata(destination), exists: false });
      writes.push(movementWrite(user, academicMovementForState(context.state, {
        SessionId: destination.SessionId,
        TermId: destination.TermId,
        StudentRef: destination.StudentRef,
        MovementType: 'Allocation',
        Reason: `${existing.FinalOutcome} from ${existing.AcademicSession}.`
      }, context.scope, null, destination)));
    }
  }
  const decision = {
    ...existing,
    Status: target,
    ...(destination ? {
      DestinationSessionId: destination.SessionId,
      DestinationTermId: destination.TermId,
      DestinationClassId: destination.ClassId,
      DestinationArmId: destination.ArmId,
      DestinationMembershipId: destination.MembershipId
    } : {}),
    ...(target === 'Committed' ? { CommittedAt: timestamp, CommittedBy: actorName(user) } : {}),
    ...(reason ? { ReopenReason: reason } : {}),
    UpdatedAt: timestamp,
    UpdatedBy: actorName(user)
  };
  writes.unshift({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.promotionDecisions,
    documentId: decision.PromotionDecisionId, data: withoutMetadata(decision), ...writePrecondition(existing, input.RevisionToken) });
  writes.push(academicOutcomeEventWrite(user, ACADEMIC_MANAGEMENT_COLLECTIONS.promotionEvents,
    'PROMOTION', decision, target.toUpperCase(), reason || `${existing.Status} -> ${target}`));
  writes.push(auditWrite(user, target.toUpperCase(), 'promotionDecision', decision,
    reason || `${existing.Status} -> ${target}${destination ? '; destination membership created' : ''}`));
  await commitAcademicBatch(env, writes, 'This promotion decision changed while its status was being updated. Reload and try again.');
  return academicOperationalResponse(env, user, input, context.scope,
    `${decision.StudentRef} promotion decision moved to ${target}${destination ? ' and the next-session membership was created' : ''}.`);
}

function academicTranscriptId(scope, studentRef) {
  return academicId('transcript', scope.branchId, scope.section, studentRef);
}

function transcriptPriorVersion(record = {}) {
  return {
    Version: record.Version,
    Status: record.Status,
    IssuedAt: record.IssuedAt,
    IssuedBy: record.IssuedBy,
    Sessions: record.Sessions || [],
    Terms: record.Terms || [],
    Outcomes: record.Outcomes || [],
    ReplacedAt: nowIso()
  };
}

export async function createAcademicTranscriptDraft(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canIssueTranscripts');
  const studentRef = clean(input.StudentRef);
  if (!studentRef) throw failure('Choose a student for this transcript.');
  const cumulative = context.state.cumulativeResults.filter((row) => lower(row.StudentRef) === lower(studentRef));
  const lockedCumulative = cumulative.filter((row) => lower(row.Status) === 'locked');
  if (!lockedCumulative.length) throw failure('At least one locked cumulative session result is required before creating a transcript.', 409, 'ACADEMIC_TRANSCRIPT_CUMULATIVE_REQUIRED');
  const transcriptId = academicTranscriptId(context.scope, studentRef);
  const existing = findById(context.state.transcripts, transcriptId);
  const reissuing = lower(existing?.Status) === 'issued';
  const reason = clean(input.Reason || input.ReissueReason).slice(0, 500);
  if (reissuing && !reason) throw failure('Enter the reason for creating a corrected transcript version.');
  if (existing && !['draft', 'issued'].includes(lower(existing.Status))) {
    throw failure(`This transcript is ${existing.Status}. Reopen it before rebuilding the draft.`, 409, 'ACADEMIC_TRANSCRIPT_IMMUTABLE');
  }
  const people = await loadPeople(env, user, context.scope);
  const student = people.students.find((row) => lower(studentReference(row)) === lower(studentRef)) || {};
  const transcriptNumber = clean(existing?.TranscriptNumber) || await academicOutcomeReference(transcriptId, 'TRN');
  const previous = reissuing
    ? [...(existing.PreviousIssuedVersions || []), transcriptPriorVersion(existing)].slice(-20)
    : (existing?.PreviousIssuedVersions || []);
  const timestamp = nowIso();
  const draft = buildAcademicTranscriptDraft({
    TranscriptId: transcriptId,
    TranscriptNumber: transcriptNumber,
    StudentRef: studentRef,
    StudentName: clean(student.DisplayName || student.ApplicantName || student.StudentName || studentRef),
    CumulativeResults: lockedCumulative,
    TermResults: context.state.termResults.filter((row) => lower(row.StudentRef) === lower(studentRef)),
    PromotionDecisions: context.state.promotionDecisions.filter((row) => lower(row.StudentRef) === lower(studentRef)),
    Version: Number(existing?.Version || 0) + (reissuing ? 1 : (existing ? 0 : 1)),
    PreviousIssuedVersions: previous
  });
  const record = {
    ...(existing || {}),
    ...draft,
    RecordId: transcriptId,
    BranchId: context.scope.branchId,
    SchoolSection: context.scope.section,
    ReissueReason: reissuing ? reason : '',
    CreatedAt: clean(existing?.CreatedAt) || timestamp,
    CreatedBy: clean(existing?.CreatedBy) || actorName(user),
    UpdatedAt: timestamp,
    UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.transcripts, documentId: transcriptId,
      data: withoutMetadata(record), ...writePrecondition(existing, input.RevisionToken) },
    academicOutcomeEventWrite(user, ACADEMIC_MANAGEMENT_COLLECTIONS.transcriptEvents,
      'TRANSCRIPT', record, reissuing ? 'REISSUE_DRAFTED' : (existing ? 'REBUILT' : 'CREATED'), reason || `${record.Sessions.length} locked session(s)`),
    auditWrite(user, reissuing ? 'REISSUE_DRAFT' : (existing ? 'REBUILD_DRAFT' : 'CREATE_DRAFT'),
      'transcript', record, reason || `${record.Sessions.length} locked session(s)`)
  ], 'This transcript changed while its draft was being created. Reload and try again.');
  return academicOperationalResponse(env, user, input, context.scope,
    `${record.TranscriptNumber} version ${record.Version} saved as Draft from locked academic records.`);
}

export async function changeAcademicTranscriptStatus(env, user = {}, input = {}) {
  const target = ACADEMIC_TRANSCRIPT_STATUSES.find((value) => lower(value) === lower(input.Status || input.TargetStatus));
  if (!target) throw failure('Choose a valid transcript status.');
  const context = await academicOperationalContext(env, user, input, 'canIssueTranscripts');
  const existing = findById(context.state.transcripts, input.TranscriptId);
  if (!existing) throw failure('Choose a transcript.', 404);
  const transition = academicTranscriptTransition(existing.Status, target);
  if (!transition.Allowed) throw failure(`This transcript cannot move directly to ${target}.`, 409);
  const reason = clean(input.Reason).slice(0, 500);
  if (transition.RequiresReason && !reason) throw failure('Enter the approved reason for reopening this transcript.');
  const timestamp = nowIso();
  const record = {
    ...existing,
    Status: target,
    ...(target === 'Issued' ? { IssuedAt: timestamp, IssuedBy: actorName(user), IssuedByUsername: actorUsername(user) } : {}),
    ...(reason ? { ReopenReason: reason } : {}),
    UpdatedAt: timestamp,
    UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.transcripts, documentId: record.TranscriptId,
      data: withoutMetadata(record), ...writePrecondition(existing, input.RevisionToken) },
    academicOutcomeEventWrite(user, ACADEMIC_MANAGEMENT_COLLECTIONS.transcriptEvents,
      'TRANSCRIPT', record, target.toUpperCase(), reason || `${existing.Status} -> ${target}`),
    auditWrite(user, target.toUpperCase(), 'transcript', record, reason || `${existing.Status} -> ${target}`)
  ], 'This transcript changed while its status was being updated. Reload and try again.');
  return academicOperationalResponse(env, user, input, context.scope, `${record.TranscriptNumber} moved to ${target}.`);
}

export async function previewAcademicScoreImport(env, user = {}, input = {}) {
  const context = await academicScoreSheetContext(env, user, input, 'canImportScores');
  if (context.existing && lower(context.existing.Status) !== 'draft') throw failure('Spreadsheet imports are allowed only while the score sheet is Draft.', 409);
  const preview = validateAcademicScoreImport(input.Rows, {
    scheme: context.scheme,
    roster: context.roster,
    sourceMode: 'spreadsheet',
    existingScores: context.state.studentScores.filter((row) => row.SheetId === context.SheetId)
  });
  const response = await academicOperationalResponse(env, user, input, context.scope,
    `${preview.ValidRows} of ${preview.TotalRows} spreadsheet row${preview.TotalRows === 1 ? '' : 's'} passed validation.`);
  response.scoreImportPreview = preview;
  return response;
}

function normalizedImportKey(value) {
  const key = clean(value).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 100);
  if (key.length < 8) throw failure('The score import needs a stable idempotency key of at least 8 characters.');
  return key;
}

export async function importAcademicScores(env, user = {}, input = {}) {
  const context = await academicScoreSheetContext(env, user, input, 'canImportScores');
  const { scope, state, SheetId, existing, scheme } = context;
  if (existing && lower(existing.Status) !== 'draft') throw failure('Spreadsheet imports are allowed only while the score sheet is Draft.', 409);
  const mode = oneOf(input.CommitMode, ACADEMIC_SCORE_IMPORT_MODES, 'all-or-nothing');
  const importKey = normalizedImportKey(input.ImportKey || input.IdempotencyKey);
  const ImportId = academicId('score-import', SheetId, importKey);
  const previousImport = findById(state.scoreImports, ImportId);
  if (previousImport) {
    const response = await academicOperationalResponse(env, user, input, scope, 'This spreadsheet import was already processed; no score was duplicated.');
    response.scoreImport = publicRecord(previousImport);
    return response;
  }
  const preview = validateAcademicScoreImport(input.Rows, {
    scheme,
    roster: context.roster,
    sourceMode: 'spreadsheet',
    existingScores: state.studentScores.filter((row) => row.SheetId === SheetId)
  });
  if (!preview.TotalRows) throw failure('The spreadsheet has no score rows.');
  if (preview.TotalRows > 200) throw failure('Import at most 200 student scores at a time.');
  if (mode === 'all-or-nothing' && preview.InvalidRows) {
    const error = failure(`The import has ${preview.InvalidRows} invalid row${preview.InvalidRows === 1 ? '' : 's'}. Correct every row before committing an all-or-nothing import.`, 409, 'ACADEMIC_SCORE_IMPORT_INVALID');
    error.preview = preview;
    throw error;
  }
  const valid = preview.Rows.filter((row) => row.Valid);
  if (!valid.length) throw failure('No valid score rows are available to import.', 409, 'ACADEMIC_SCORE_IMPORT_INVALID');
  const timestamp = nowIso();
  const PreviousScores = [];
  const importedScores = valid.map((row) => {
    const ScoreId = academicStudentScoreId(SheetId, row.StudentRef);
    const previous = findById(state.studentScores, ScoreId);
    PreviousScores.push({ ScoreId, Existed: Boolean(previous), Data: previous ? withoutMetadata(previous) : null });
    return {
      previous,
      record: {
        ...(previous || {}), RecordId: ScoreId, ScoreId, SheetId, StudentRef: row.StudentRef,
        SessionId: context.session.SessionId, TermId: context.term.TermId,
        ClassId: context.schoolClass.ClassId, ArmId: context.arm.ArmId, SubjectId: context.subject.SubjectId,
        AssessmentRevisionId: scheme.RevisionId,
        ...row.Calculated,
        SourceType: 'SpreadsheetImport', SourceId: ImportId,
        BranchId: scope.branchId, SchoolSection: scope.section,
        CreatedAt: clean(previous?.CreatedAt) || timestamp,
        CreatedBy: clean(previous?.CreatedBy) || actorName(user),
        UpdatedAt: timestamp, UpdatedBy: actorName(user), UpdatedByUsername: actorUsername(user)
      }
    };
  });
  const projectedScores = [
    ...state.studentScores.filter((row) => row.SheetId === SheetId && !importedScores.some((item) => item.record.ScoreId === row.ScoreId)),
    ...importedScores.map((item) => item.record)
  ];
  const sheet = academicScoreSheetRecord(context, existing, user, timestamp, {
    ...academicScoreSheetCounts(projectedScores), LastSavedAt: timestamp, LastSavedBy: actorName(user), LastImportId: ImportId
  });
  const importRecord = {
    RecordId: ImportId, ImportId, ImportKey: importKey, SheetId, Status: 'Committed', CommitMode: mode,
    SourceFileName: clean(input.SourceFileName).slice(0, 240),
    SourceFormat: oneOf(input.SourceFormat, ['CSV', 'XLSX'], 'CSV'),
    TotalRows: preview.TotalRows, ImportedRows: valid.length, RejectedRows: preview.InvalidRows,
    Rejected: preview.Rows.filter((row) => !row.Valid).map((row) => ({ RowNumber: row.RowNumber, StudentRef: row.StudentRef, Issues: row.Issues })),
    AffectedScoreIds: importedScores.map((row) => row.record.ScoreId), PreviousScores,
    SessionId: context.session.SessionId, TermId: context.term.TermId,
    ClassId: context.schoolClass.ClassId, ArmId: context.arm.ArmId, SubjectId: context.subject.SubjectId,
    AssessmentRevisionId: scheme.RevisionId,
    BranchId: scope.branchId, SchoolSection: scope.section,
    CommittedAt: timestamp, CommittedBy: actorName(user), CommittedByUsername: actorUsername(user)
  };
  const writes = importedScores.map(({ previous, record }) => ({
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentScores,
    documentId: record.ScoreId, data: withoutMetadata(record), ...(previous ? { updateTime: previous.__updateTime } : { exists: false })
  }));
  writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreSheets, documentId: SheetId,
    data: withoutMetadata(sheet), ...(existing ? { updateTime: existing.__updateTime } : { exists: false }) });
  writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreImports, documentId: ImportId,
    data: withoutMetadata(importRecord), exists: false });
  writes.push(auditWrite(user, 'IMPORT', 'scoreSheet', sheet, `${valid.length} imported; ${preview.InvalidRows} rejected; ${mode}`));
  await commitAcademicBatch(env, writes, 'The score sheet changed while the spreadsheet was being imported. Preview the file again.');
  const response = await academicOperationalResponse(env, user, input, scope,
    `${valid.length} spreadsheet score${valid.length === 1 ? '' : 's'} imported as Draft${preview.InvalidRows ? `; ${preview.InvalidRows} invalid row${preview.InvalidRows === 1 ? '' : 's'} skipped` : ''}.`);
  response.scoreImport = publicRecord(importRecord);
  return response;
}

export async function rollbackAcademicScoreImport(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canImportScores');
  const { permissions, scope, state } = context;
  const importRecord = findById(state.scoreImports, input.ImportId || input.RecordId);
  if (!importRecord || lower(importRecord.Status) !== 'committed') throw failure('The committed score import was not found.', 404);
  const sheet = findById(state.scoreSheets, importRecord.SheetId);
  if (!sheet || lower(sheet.Status) !== 'draft') throw failure('Only an unpublished Draft score import can be rolled back.', 409, 'ACADEMIC_SCORE_IMPORT_LOCKED');
  assertAcademicScoreSheetAuthority(user, permissions, state, sheet, sheet);
  const reason = clean(input.Reason).slice(0, 500);
  if (!reason) throw failure('Enter the approved reason for rolling back this score import.');
  const previousById = new Map((importRecord.PreviousScores || []).map((row) => [row.ScoreId, row]));
  const currentScores = (importRecord.AffectedScoreIds || []).map((scoreId) => findById(state.studentScores, scoreId));
  if (currentScores.some((row) => !row || row.SourceId !== importRecord.ImportId || row.UpdatedAt !== importRecord.CommittedAt)) {
    throw failure('One or more imported scores changed after this import. Reopen and correct them manually instead of rolling back.', 409, 'ACADEMIC_SCORE_IMPORT_CHANGED');
  }
  const timestamp = nowIso();
  const writes = currentScores.map((current) => {
    const previous = previousById.get(current.ScoreId);
    return previous?.Existed
      ? { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentScores, documentId: current.ScoreId,
          data: previous.Data, updateTime: current.__updateTime }
      : { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentScores, documentId: current.ScoreId,
          operation: 'delete', updateTime: current.__updateTime };
  });
  const restoredScores = state.studentScores.filter((row) => row.SheetId === sheet.SheetId
    && !(importRecord.AffectedScoreIds || []).includes(row.ScoreId));
  (importRecord.PreviousScores || []).filter((row) => row.Existed).forEach((row) => restoredScores.push(row.Data));
  const updatedSheet = {
    ...sheet, ...academicScoreSheetCounts(restoredScores), LastImportId: '',
    UpdatedAt: timestamp, UpdatedBy: actorName(user)
  };
  const rolledBack = {
    ...importRecord, Status: 'RolledBack', RollbackReason: reason,
    RolledBackAt: timestamp, RolledBackBy: actorName(user), RolledBackByUsername: actorUsername(user)
  };
  writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreSheets, documentId: sheet.SheetId,
    data: withoutMetadata(updatedSheet), updateTime: sheet.__updateTime });
  writes.push({ collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreImports, documentId: importRecord.ImportId,
    data: withoutMetadata(rolledBack), ...writePrecondition(importRecord, input.RevisionToken) });
  writes.push(auditWrite(user, 'ROLLBACK_IMPORT', 'scoreSheet', sheet, reason));
  await commitAcademicBatch(env, writes, 'The score import changed while it was being rolled back. Reload and try again.');
  return academicOperationalResponse(env, user, input, scope, `${currentScores.length} imported student score${currentScores.length === 1 ? '' : 's'} rolled back.`);
}

function canonicalAcademicCbtValue(value) {
  if (Array.isArray(value)) return value.map(canonicalAcademicCbtValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalAcademicCbtValue(value[key])]));
  }
  return value;
}

function academicCbtScoreBatchMaterial(input = {}) {
  const keys = [
    'Version', 'BatchId', 'ExamId', 'SourceTestId', 'SourcePackageDigest',
    'SessionId', 'TermId', 'ClassId', 'ArmId', 'SubjectId',
    'AssessmentComponentId', 'MaximumScore', 'SourceType', 'MarkingRevision',
    'ApprovalStatus', 'ApprovedBy', 'ApprovedAt', 'ProviderId', 'SourceFileName', 'Scores'
  ];
  return Object.fromEntries(keys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

export async function academicCbtScoreBatchDigest(input = {}) {
  const material = JSON.stringify(canonicalAcademicCbtValue(academicCbtScoreBatchMaterial(input)));
  const digest = await crypto.subtle.digest('SHA-256', identityEncoder.encode(material));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyAcademicCbtScoreSignature(input = {}) {
  if (clean(input.SignatureAlgorithm) !== 'RSASSA-PKCS1-v1_5-SHA256') {
    throw failure('The local CBT score batch uses an unsupported signature algorithm.', 409, 'ACADEMIC_CBT_SIGNATURE_INVALID');
  }
  let publicBytes;
  let publicKey;
  try {
    publicBytes = identityPublicKeyBytes(input.SigningPublicKey);
    publicKey = await crypto.subtle.importKey(
      'spki', publicBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
  } catch (_error) {
    throw failure('The local CBT score-signing public key is invalid.', 409, 'ACADEMIC_CBT_SIGNATURE_INVALID');
  }
  const keyDigest = await crypto.subtle.digest('SHA-256', publicBytes);
  const calculatedKeyId = [...new Uint8Array(keyDigest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
  if (lower(input.SigningKeyId) !== calculatedKeyId) {
    throw failure('The local CBT signing-key identifier does not match its public key.', 409, 'ACADEMIC_CBT_SIGNATURE_INVALID');
  }
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', publicKey, identityBase64UrlBytes(input.Signature),
    identityEncoder.encode(clean(input.BatchDigest).toLowerCase())
  );
  if (!verified) throw failure('The local CBT score batch signature could not be verified.', 409, 'ACADEMIC_CBT_SIGNATURE_INVALID');
  return calculatedKeyId;
}

export async function syncAcademicCbtScores(env, user = {}, input = {}) {
  const context = await academicScoreSheetContext(env, user, input, 'canImportScores');
  const { permissions, scope, state, SheetId, existing, scheme } = context;
  if (!permissions.canReviewScores) {
    throw failure('Only an academic or examination reviewer may synchronize an approved CBT score batch.', 403, 'ACADEMIC_CBT_SYNC_REVIEWER_REQUIRED');
  }
  if (existing && lower(existing.Status) !== 'draft') {
    throw failure('CBT scores can synchronize only while the online score sheet is Draft.', 409, 'ACADEMIC_SCORE_SHEET_LOCKED');
  }
  if (lower(input.ApprovalStatus) !== 'approved') {
    throw failure('Review and approve the complete CBT marking batch before synchronization.', 409, 'ACADEMIC_CBT_MARKING_NOT_APPROVED');
  }
  const sourceType = oneOf(input.SourceType, ['BuiltInCBT', 'ExternalCBT'], '');
  if (!sourceType) throw failure('Choose BuiltInCBT or ExternalCBT as the score source.');
  const sourceMode = sourceType === 'BuiltInCBT' ? 'built-in-cbt' : 'external-cbt';
  const preview = validateAcademicCbtScoreBatch(input, {
    scheme, roster: context.roster, sourceMode
  });
  if (!preview.Ready) {
    const error = failure(preview.Issues[0] || 'The CBT score batch did not pass online validation.', 409, 'ACADEMIC_CBT_SCORE_BATCH_INVALID');
    error.preview = preview;
    throw error;
  }
  const expectedDigest = clean(input.BatchDigest).toLowerCase();
  const calculatedDigest = await academicCbtScoreBatchDigest(input);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || expectedDigest !== calculatedDigest) {
    throw failure('The CBT score batch digest does not match its score payload.', 409, 'ACADEMIC_CBT_SCORE_DIGEST_INVALID');
  }
  let signingKeyId = '';
  if (sourceType === 'BuiltInCBT') {
    signingKeyId = await verifyAcademicCbtScoreSignature(input);
    const pinned = state.scoreSyncBatches.find((row) => row.SourceType === 'BuiltInCBT' && clean(row.SigningKeyId));
    if (pinned && lower(pinned.SigningKeyId) !== lower(signingKeyId)) {
      throw failure('This branch is already linked to another local CBT score-signing key. Use the controlled recovery process before replacing it.', 409, 'ACADEMIC_CBT_SIGNING_KEY_CHANGED');
    }
  }
  const batchKey = normalizedImportKey(input.BatchId);
  const SyncId = academicId('score-sync', SheetId, batchKey);
  const previousBatch = findById(state.scoreSyncBatches, SyncId);
  if (previousBatch) {
    if (lower(previousBatch.BatchDigest) !== expectedDigest) {
      throw failure('This CBT synchronization key was already used for a different score payload.', 409, 'ACADEMIC_CBT_SYNC_KEY_REUSED');
    }
    const response = await academicOperationalResponse(env, user, input, scope,
      'This approved CBT batch was already synchronized; no score was duplicated.');
    response.scoreSyncReceipt = publicRecord(previousBatch);
    return response;
  }
  const timestamp = nowIso();
  const component = preview.Component;
  const updatedScores = preview.Rows.map((row) => {
    const ScoreId = academicStudentScoreId(SheetId, row.StudentRef);
    const previous = findById(state.studentScores, ScoreId);
    const componentScores = normalizeAcademicComponentScores([{
      ComponentId: component.Id,
      State: row.State,
      RawScore: row.RawScore,
      Note: `${sourceType === 'BuiltInCBT' ? 'Built-in' : 'External'} CBT batch ${batchKey}`
    }], scheme, { existing: previous?.ComponentScores || [], partial: true });
    return {
      previous,
      record: {
        ...(previous || {}), RecordId: ScoreId, ScoreId, SheetId, StudentRef: row.StudentRef,
        SessionId: context.session.SessionId, TermId: context.term.TermId,
        ClassId: context.schoolClass.ClassId, ArmId: context.arm.ArmId, SubjectId: context.subject.SubjectId,
        AssessmentRevisionId: scheme.RevisionId,
        ...calculateAcademicStudentScore(scheme, componentScores),
        SourceType: sourceType, SourceId: SyncId, SourceBatchId: batchKey,
        BranchId: scope.branchId, SchoolSection: scope.section,
        CreatedAt: clean(previous?.CreatedAt) || timestamp,
        CreatedBy: clean(previous?.CreatedBy) || actorName(user),
        UpdatedAt: timestamp, UpdatedBy: actorName(user), UpdatedByUsername: actorUsername(user)
      }
    };
  });
  const projectedScores = [
    ...state.studentScores.filter((row) => row.SheetId === SheetId
      && !updatedScores.some((item) => item.record.ScoreId === row.ScoreId)),
    ...updatedScores.map((item) => item.record)
  ];
  const sheet = academicScoreSheetRecord(context, existing, user, timestamp, {
    ...academicScoreSheetCounts(projectedScores), LastSavedAt: timestamp,
    LastSavedBy: actorName(user), LastScoreSyncId: SyncId
  });
  const syncRecord = {
    RecordId: SyncId, SyncId, BatchId: batchKey, BatchDigest: expectedDigest,
    SheetId, Status: 'Committed', SourceType,
    SourceTestId: clean(input.SourceTestId || input.ExamId),
    ProviderId: clean(input.ProviderId).slice(0, 120),
    SourceFileName: clean(input.SourceFileName).slice(0, 240),
    SigningKeyId: signingKeyId,
    AssessmentComponentId: component.Id, MaximumScore: component.MaximumScore,
    NumericCount: preview.NumericCount, AbsentCount: preview.AbsentCount,
    ImportedRows: updatedScores.length, RosterCount: preview.RosterCount,
    AffectedScoreIds: updatedScores.map((row) => row.record.ScoreId),
    SessionId: context.session.SessionId, TermId: context.term.TermId,
    ClassId: context.schoolClass.ClassId, ArmId: context.arm.ArmId, SubjectId: context.subject.SubjectId,
    BranchId: scope.branchId, SchoolSection: scope.section,
    SynchronizedAt: timestamp, SynchronizedBy: actorName(user), SynchronizedByUsername: actorUsername(user)
  };
  const writes = updatedScores.map(({ previous, record }) => ({
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentScores,
    documentId: record.ScoreId, data: withoutMetadata(record),
    ...(previous ? { updateTime: previous.__updateTime } : { exists: false })
  }));
  writes.push({
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreSheets,
    documentId: SheetId, data: withoutMetadata(sheet),
    ...(existing ? { updateTime: existing.__updateTime } : { exists: false })
  });
  writes.push({
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreSyncBatches,
    documentId: SyncId, data: withoutMetadata(syncRecord), exists: false
  });
  writes.push(auditWrite(user, 'SYNC_CBT_SCORES', 'scoreSyncBatch', syncRecord,
    `${sourceType}; ${updatedScores.length} students; ${preview.AbsentCount} absent`));
  await commitAcademicBatch(env, writes,
    'The score sheet changed while CBT scores were synchronizing. Reload and retry the same approved batch.');
  const response = await academicOperationalResponse(env, user, input, scope,
    `${updatedScores.length} approved CBT score${updatedScores.length === 1 ? '' : 's'} synchronized into the Draft scorebook.`);
  response.scoreSyncReceipt = publicRecord(syncRecord);
  return response;
}

export const ACADEMIC_CBT_OPTION_STYLES = Object.freeze({
  ABC: Object.freeze(['A', 'B', 'C']),
  ABCD: Object.freeze(['A', 'B', 'C', 'D']),
  ABCDE: Object.freeze(['A', 'B', 'C', 'D', 'E']),
  ABCDEF: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']),
  TRUE_FALSE: Object.freeze(['True', 'False'])
});

function academicCbtOptionStyle(value) {
  const normalized = clean(value).toUpperCase().replace(/[\s/-]+/g, '_');
  if (ACADEMIC_CBT_OPTION_STYLES[normalized]) return normalized;
  throw failure('Choose ABC, ABCD, ABCDE, ABCDEF or True/False answer style.', 400, 'ACADEMIC_CBT_OPTION_STYLE_INVALID');
}

function academicCbtAuthority(user, context, record) {
  if (context.permissions.teacherView && lower(record.TeacherUsername) !== actorUsername(user)) {
    throw failure('Teachers may manage only their own allocated CBT tests.', 403, 'ACADEMIC_CBT_OWNER_FORBIDDEN');
  }
  return record;
}

async function academicCbtPackageDigest(record = {}) {
  const material = JSON.stringify({
    CbtTestId: record.CbtTestId,
    SessionId: record.SessionId,
    TermId: record.TermId,
    ClassId: record.ClassId,
    ArmId: record.ArmId,
    SubjectId: record.SubjectId,
    TeacherUsername: record.TeacherUsername,
    AssessmentComponentId: record.AssessmentComponentId,
    MaximumScore: record.MaximumScore,
    StartsAt: record.StartsAt,
    EndsAt: record.EndsAt,
    NumberOfQuestions: record.NumberOfQuestions,
    OptionStyle: record.OptionStyle,
    Options: record.Options,
    AnswerKey: record.AnswerKey,
    StudentRefs: record.StudentRefs,
    PaperDigest: record.PaperDigest
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function validateAcademicCbtTestInput(env, user = {}, input = {}) {
  const context = await academicScoreSheetContext(env, user, input, 'canCreateCbt');
  const componentId = clean(input.AssessmentComponentId);
  const component = (context.scheme.Components || []).find((row) => row.Id === componentId);
  if (!component || !['any', 'built-in-cbt'].includes(lower(component.SourceMode))) {
    throw failure('Choose an active Test Type that accepts Built-in CBT scores.', 409, 'ACADEMIC_CBT_COMPONENT_REQUIRED');
  }
  const questionCount = Number(input.NumberOfQuestions);
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 200) {
    throw failure('Number of questions must be a whole number between 1 and 200.', 400, 'ACADEMIC_CBT_QUESTION_COUNT_INVALID');
  }
  const durationMinutes = Number(input.DurationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
    throw failure('Duration must be a whole number between 1 and 480 minutes.', 400, 'ACADEMIC_CBT_DURATION_INVALID');
  }
  const optionStyle = academicCbtOptionStyle(input.OptionStyle);
  const options = [...ACADEMIC_CBT_OPTION_STYLES[optionStyle]];
  const answerKey = Array.isArray(input.AnswerKey) ? input.AnswerKey.map(clean) : [];
  if (answerKey.length !== questionCount || answerKey.some((answer) => !options.includes(answer))) {
    throw failure('Select one valid correct answer for every question.', 400, 'ACADEMIC_CBT_ANSWER_KEY_INCOMPLETE');
  }
  const startsAt = new Date(clean(input.StartsAt));
  if (!Number.isFinite(startsAt.getTime())) throw failure('Choose a valid test date and start time.', 400, 'ACADEMIC_CBT_SCHEDULE_INVALID');
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
  if (endsAt.getTime() <= Date.now()) throw failure('The test schedule has already ended. Choose a current or future start time.', 400, 'ACADEMIC_CBT_SCHEDULE_ENDED');
  const paperUrl = clean(input.PaperUrl);
  const paperFileName = clean(input.PaperFileName);
  const paperMimeType = lower(input.PaperMimeType);
  const paperDigest = lower(input.PaperDigest);
  if (input.RequirePaper !== false) {
    if (!paperUrl || !paperFileName || !['application/pdf', 'image/jpeg', 'image/png'].includes(paperMimeType)) {
      throw failure('Upload a valid PDF, JPEG or PNG question paper.', 400, 'ACADEMIC_CBT_PAPER_REQUIRED');
    }
    if (!/^[a-f0-9]{64}$/.test(paperDigest)) throw failure('The uploaded question paper digest is invalid.', 400, 'ACADEMIC_CBT_PAPER_DIGEST_INVALID');
  }
  const requestedId = clean(input.CbtTestId);
  const existing = requestedId ? findById(context.state.cbtTests, requestedId) : null;
  if (requestedId && !existing) throw failure('The selected CBT test was not found.', 404, 'ACADEMIC_CBT_TEST_NOT_FOUND');
  if (existing) {
    academicCbtAuthority(user, context, existing);
    if (clean(existing.LocalDownloadedAt)) {
      throw failure('This test has already been downloaded to a local CBT server. Create a corrected test instead of changing its package.', 409, 'ACADEMIC_CBT_ALREADY_DOWNLOADED');
    }
  }
  const timestamp = nowIso();
  const cbtTestId = existing?.CbtTestId || academicId(
    'cbt-test', context.scope.branchId, context.scope.section, context.session.SessionId,
    context.term.TermId, clean(input.ClientRequestId) || crypto.randomUUID()
  );
  const studentRefs = context.roster.map((row) => clean(row.StudentRef)).filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  const maximumScore = Number(component.MaximumScore);
  const record = {
    ...(existing || {}),
    RecordId: cbtTestId,
    CbtTestId: cbtTestId,
    Title: `${clean(component.Name)} · ${clean(context.subject.Name)} · ${clean(context.schoolClass.Name)} / ${clean(context.arm.Name)}`,
    SessionId: context.session.SessionId,
    TermId: context.term.TermId,
    ClassId: context.schoolClass.ClassId,
    ArmId: context.arm.ArmId,
    SubjectId: context.subject.SubjectId,
    SubjectName: clean(context.subject.Name),
    TeacherUsername: lower(context.allocation.TeacherUsername),
    AssessmentComponentId: component.Id,
    AssessmentComponentName: clean(component.Name),
    MaximumScore: maximumScore,
    StartsAt: startsAt.toISOString(),
    EndsAt: endsAt.toISOString(),
    DurationMinutes: durationMinutes,
    NumberOfQuestions: questionCount,
    OptionStyle: optionStyle,
    Options: options,
    AnswerKey: answerKey,
    StudentRefs: studentRefs,
    RosterCount: studentRefs.length,
    PaperUrl: paperUrl || clean(existing?.PaperUrl),
    PaperFileName: paperFileName || clean(existing?.PaperFileName),
    PaperMimeType: paperMimeType || clean(existing?.PaperMimeType),
    PaperDigest: paperDigest || clean(existing?.PaperDigest),
    PaperByteLength: Number(input.PaperByteLength || existing?.PaperByteLength || 0),
    Status: 'Scheduled',
    PackageRevision: Number(existing?.PackageRevision || 0) + 1,
    BranchId: context.scope.branchId,
    SchoolSection: context.scope.section,
    CreatedAt: clean(existing?.CreatedAt) || timestamp,
    CreatedBy: clean(existing?.CreatedBy) || actorName(user),
    UpdatedAt: timestamp,
    UpdatedBy: actorName(user)
  };
  record.PackageDigest = await academicCbtPackageDigest(record);
  return { context, component, existing, record };
}

export async function saveAcademicCbtTest(env, user = {}, input = {}) {
  const { context, existing, record } = await validateAcademicCbtTestInput(env, user, { ...input, RequirePaper: true });
  const writes = [{
    collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.cbtTests,
    documentId: record.CbtTestId,
    data: withoutMetadata(record),
    ...writePrecondition(existing, input.RevisionToken)
  }, auditWrite(user, existing ? 'UPDATE' : 'CREATE', 'cbtTests', record,
    `${record.AssessmentComponentName}; ${record.NumberOfQuestions} questions; ${record.RosterCount} students; starts ${record.StartsAt}`)];
  await commitAcademicBatch(env, writes, 'The CBT test changed while it was being saved. Reload and try again.');
  return academicOperationalResponse(env, user, input, context.scope,
    `${record.AssessmentComponentName} CBT test scheduled for ${record.RosterCount} student${record.RosterCount === 1 ? '' : 's'}.`);
}

async function deleteAcademicCbtPaper(env, paperUrl) {
  const storage = await resolveDocumentStorage(env);
  if (!storage.configured || !clean(paperUrl)) return false;
  const response = await fetch(storage.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ Secret: storage.secret, Action: 'deleteStoredDocument', DocumentUrl: paperUrl })
  }).catch(() => null);
  const data = response ? await response.json().catch(() => ({})) : {};
  return Boolean(response?.ok && data.ok);
}

export async function deleteAcademicCbtTest(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canCreateCbt');
  const record = findById(context.state.cbtTests, input.CbtTestId);
  if (!record) throw failure('The selected CBT test was not found.', 404, 'ACADEMIC_CBT_TEST_NOT_FOUND');
  academicCbtAuthority(user, context, record);
  if (clean(record.LocalDownloadedAt)) {
    throw failure('This test has already reached a local CBT server and cannot be deleted online.', 409, 'ACADEMIC_CBT_ALREADY_DOWNLOADED');
  }
  const revisionToken = clean(input.RevisionToken);
  if (!revisionToken) throw failure('Reload this CBT register before deleting the test.', 409);
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.cbtTests, documentId: record.CbtTestId, operation: 'delete', updateTime: revisionToken },
    auditWrite(user, 'DELETE', 'cbtTests', record, clean(input.Reason) || 'CBT test created in error.')
  ], 'The CBT test changed while it was being deleted. Reload and try again.');
  await deleteAcademicCbtPaper(env, record.PaperUrl).catch(() => false);
  return academicOperationalResponse(env, user, input, context.scope, 'The unused online CBT test was deleted.');
}

async function loadAcademicCbtPaper(env, record) {
  const storage = await resolveDocumentStorage(env);
  if (!storage.configured) throw failure('Google Drive document storage is not configured.', 503, 'DOCUMENT_STORAGE_NOT_CONFIGURED');
  const response = await fetch(storage.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ Secret: storage.secret, Action: 'getStoredDocument', DocumentUrl: record.PaperUrl })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !clean(data.fileBase64)) {
    throw failure(data.message || 'The CBT question paper could not be downloaded from Google Drive.', 502, 'ACADEMIC_CBT_PAPER_UNAVAILABLE');
  }
  const stored = safeStoredDocument(data.fileName || record.PaperFileName, data.fileBase64);
  if (!stored.valid || !stored.inlineSafe || !['application/pdf', 'image/jpeg', 'image/png'].includes(stored.mimeType)) {
    throw failure('The stored CBT paper failed its file validation.', 409, 'ACADEMIC_CBT_PAPER_INVALID');
  }
  if (await academicCbtPaperDigest(data.fileBase64) !== lower(record.PaperDigest)) {
    throw failure('The stored CBT paper no longer matches its scheduled package.', 409, 'ACADEMIC_CBT_PAPER_DIGEST_MISMATCH');
  }
  return { FileName: stored.fileName, MimeType: stored.mimeType, FileBase64: clean(data.fileBase64) };
}

export async function downloadAcademicCbtTestPackage(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canCreateCbt');
  const record = findById(context.state.cbtTests, input.CbtTestId);
  if (!record) throw failure('The selected CBT test was not found.', 404, 'ACADEMIC_CBT_TEST_NOT_FOUND');
  academicCbtAuthority(user, context, record);
  const paper = await loadAcademicCbtPaper(env, record);
  return {
    ok: true,
    message: 'The scheduled CBT package is ready for local import.',
    cbtPackage: { ...publicRecord(record), Paper: paper }
  };
}

export async function acknowledgeAcademicCbtImport(env, user = {}, input = {}) {
  const context = await academicOperationalContext(env, user, input, 'canCreateCbt');
  const record = findById(context.state.cbtTests, input.CbtTestId);
  if (!record) throw failure('The selected CBT test was not found.', 404, 'ACADEMIC_CBT_TEST_NOT_FOUND');
  academicCbtAuthority(user, context, record);
  if (Number(input.PackageRevision) !== Number(record.PackageRevision)) {
    throw failure('The online CBT package changed before the local import completed. Download it again.', 409, 'ACADEMIC_CBT_PACKAGE_CHANGED');
  }
  const updated = {
    ...record,
    LocalDownloadedAt: clean(record.LocalDownloadedAt) || nowIso(),
    LocalDownloadedBy: clean(record.LocalDownloadedBy) || actorName(user),
    LocalPackageDigest: clean(input.LocalPackageDigest),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user)
  };
  await commitAcademicBatch(env, [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.cbtTests, documentId: record.CbtTestId, data: withoutMetadata(updated), ...writePrecondition(record, input.RevisionToken) },
    auditWrite(user, 'DOWNLOAD', 'cbtTests', updated, 'Scheduled test imported into the desktop local CBT server.')
  ], 'The CBT test changed before its local import could be acknowledged.');
  return academicOperationalResponse(env, user, input, context.scope, 'The local CBT import was acknowledged online.');
}

export async function prepareLocalCbtIdentityPackage(env, user = {}, input = {}) {
  requireWritableSubscription(user);
  const readiness = lower(input.ExamKind) === 'readiness';
  let context;
  if (readiness) {
    const operational = await academicOperationalContext(env, user, input, 'canCreateCbt');
    const { permissions, scope, state, session, term } = operational;
    const schoolClass = assertReference(findById(state.classes, input.ClassId), 'Choose an active class.');
    const arm = assertReference(findById(state.arms, input.ArmId), 'Choose an active classroom arm.');
    const subject = assertReference(findById(state.subjects, input.SubjectId), 'Choose an active subject.');
    if (arm.ClassId !== schoolClass.ClassId) throw failure('The selected arm does not belong to this class.');
    if (schoolClass.SchoolSection !== scope.section || subject.SchoolSection !== scope.section) {
      throw failure('The selected CBT roster belongs to another school section.', 403, 'ACADEMIC_SECTION_FORBIDDEN');
    }
    const candidate = {
      SessionId: session.SessionId, TermId: term.TermId, ClassId: schoolClass.ClassId,
      ArmId: arm.ArmId, SubjectId: subject.SubjectId, TeacherUsername: lower(input.TeacherUsername)
    };
    const allocation = assertAcademicScoreSheetAuthority(user, permissions, state, candidate);
    const roster = academicScoreRoster(state, candidate);
    if (!roster.length) throw failure('No students in this classroom are allocated to the selected subject.', 409, 'ACADEMIC_SCORE_ROSTER_EMPTY');
    context = { ...operational, schoolClass, arm, subject, allocation, roster, scheme: { Components: [] } };
  } else {
    context = await academicScoreSheetContext(env, user, input, 'canCreateCbt');
  }
  const { scope } = context;
  const componentId = clean(input.AssessmentComponentId);
  const component = readiness ? null : (context.scheme.Components || []).find((row) => row.Id === componentId);
  if (!readiness && (!component || !['any', 'built-in-cbt'].includes(lower(component.SourceMode)))) {
    throw failure('Choose an active test type that accepts built-in CBT scores.', 409, 'ACADEMIC_CBT_COMPONENT_REQUIRED');
  }
  const requested = Array.isArray(input.StudentRefs) ? input.StudentRefs.map(clean).filter(Boolean) : [];
  const studentRefs = [...new Set(requested.map(lower))];
  if (!studentRefs.length) throw failure('Add at least one student to the local CBT roster.');
  if (studentRefs.length > 1000) throw failure('A local CBT identity package cannot exceed 1,000 students.', 413);
  const permittedStudents = new Set((context.roster || []).map((row) => lower(row.StudentRef)));
  const forbidden = studentRefs.filter((reference) => !permittedStudents.has(reference));
  if (forbidden.length) {
    throw failure('One or more requested students are not allocated to this teacher, classroom and subject.', 403, 'ACADEMIC_CBT_ROSTER_FORBIDDEN');
  }
  const wanted = new Set(studentRefs);
  const allStudents = await listSchoolCollection(env, 'students', {
    branchId: scope.branchId,
    schoolSectionAccess: scope.section
  });
  const studentsByRef = new Map();
  allStudents.forEach((student) => {
    if (safeScopeId(student.BranchId || 'main') !== scope.branchId) return;
    if (schoolSectionFor(student) !== scope.section) return;
    const reference = studentReference(student);
    if (!wanted.has(lower(reference)) || studentsByRef.has(lower(reference))) return;
    studentsByRef.set(lower(reference), student);
  });

  const identities = [];
  const missing = [];
  for (const normalizedReference of studentRefs) {
    const student = studentsByRef.get(normalizedReference);
    if (!student) {
      missing.push({ StudentRef: requested.find((value) => lower(value) === normalizedReference) || normalizedReference, Reason: 'Student not found in this branch and school section.' });
      continue;
    }
    const reference = studentReference(student);
    const identity = {
      StudentRef: reference,
      DisplayName: clean(student.DisplayName || student.ApplicantName || student.StudentName) || reference,
      Password: null,
      Face: null
    };
    const credential = await getStudentLoginCredential(env, student);
    if (credential && credential.Active !== false && clean(credential.PasswordHash)) {
      identity.Password = {
        Salt: clean(credential.Salt),
        PasswordHash: clean(credential.PasswordHash),
        PasswordIterations: Number(credential.PasswordIterations || 10000),
        PasswordHashVersion: clean(credential.PasswordHashVersion)
      };
    }
    const templatePath = scopedCollectionPath('studentFaceTemplates', scope.branchId, scope.section);
    const template = await getDocument(
      env,
      templatePath,
      await studentFaceTemplateDocumentId(reference)
    ).catch(() => null);
    if (template && faceTemplateIsUsable(template) && clean(template.DescriptorCiphertext)) {
      try {
        identity.Face = {
          Descriptor: await decryptFaceDescriptor(
            template,
            studentFaceTemplateEncryptionSecret(env, template),
            studentFaceTemplateMeta(env, template)
          ),
          ModelId: clean(template.ModelId || STUDENT_FACE_MODEL_ID),
          TemplateVersion: Number(template.TemplateVersion || 1),
          TemplateExpiresAt: clean(template.TemplateExpiresAt)
        };
      } catch (_error) {
        identity.Face = null;
      }
    }
    if (!identity.Password && !identity.Face) {
      missing.push({
        StudentRef: reference,
        DisplayName: identity.DisplayName,
        Reason: 'Set a student password or enroll an active face template before using local CBT.'
      });
    }
    identities.push(identity);
  }

  const aad = [
    'dynamax-local-cbt-identity-v1',
    clean(env.DYNAMAX_WORKSPACE_ID || env.FIREBASE_PROJECT_ID),
    scope.branchId,
    scope.section
  ].join('|');
  const envelope = await encryptLocalCbtIdentityPackage(input.PublicKeyPem, {
    Version: 1,
    WorkspaceId: clean(env.DYNAMAX_WORKSPACE_ID || env.FIREBASE_PROJECT_ID),
    BranchId: scope.branchId,
    SchoolSection: scope.section,
    GeneratedAt: nowIso(),
    FaceModelId: STUDENT_FACE_MODEL_ID,
    Identities: identities
  }, aad);
  const readyCount = identities.filter((identity) => identity.Password || identity.Face).length;
  return {
    ok: true,
    message: missing.length
      ? `${readyCount} student login${readyCount === 1 ? '' : 's'} ready; ${missing.length} require a password or face enrollment.`
      : `${identities.length} student login${identities.length === 1 ? '' : 's'} secured for offline CBT.`,
    envelope,
    summary: {
      Requested: studentRefs.length,
      Packaged: identities.length,
      AssessmentComponentId: component?.Id || '',
      AssessmentComponentName: component?.Name || '',
      TeacherUsername: context.allocation.TeacherUsername,
      PasswordReady: identities.filter((identity) => identity.Password).length,
      FaceReady: identities.filter((identity) => identity.Face).length,
      Missing: missing
    }
  };
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
  if (['saveacademictimetablesettings', 'savetimetablesettings'].includes(action)) return saveAcademicTimetableSettings(env, user, input);
  if (['saveacademictimetableconstraint', 'savetimetableconstraint'].includes(action)) return saveAcademicTimetableConstraint(env, user, input);
  if (['deleteacademictimetableconstraint', 'deletetimetableconstraint'].includes(action)) return deleteAcademicTimetableConstraint(env, user, input);
  if (['createacademictimetableversion', 'createtimetableversion'].includes(action)) return createAcademicTimetableVersion(env, user, input);
  if (['copyacademictimetableversion', 'copytimetableversion'].includes(action)) return copyAcademicTimetableVersion(env, user, input);
  if (['previewacademictimetablecopy', 'previewtimetablecopy'].includes(action)) return previewAcademicTimetableCopy(env, user, input);
  if (['copyacademictimetableselection', 'copytimetableselection'].includes(action)) return copyAcademicTimetableSelection(env, user, input);
  if (['saveacademictimetableentry', 'savetimetableentry'].includes(action)) return saveAcademicTimetableEntry(env, user, input);
  if (['deleteacademictimetableentry', 'deletetimetableentry'].includes(action)) return deleteAcademicTimetableEntry(env, user, input);
  if (['saveacademictimetablesubstitution', 'savetimetablesubstitution'].includes(action)) return saveAcademicTimetableSubstitution(env, user, input);
  if (['cancelacademictimetablesubstitution', 'canceltimetablesubstitution'].includes(action)) return cancelAcademicTimetableSubstitution(env, user, input);
  if (['changeacademictimetableversionstatus', 'changetimetableversionstatus'].includes(action)) return changeAcademicTimetableVersionStatus(env, user, input);
  if (['saveacademicstudentattendance', 'saveacademicattendance'].includes(action)) return saveAcademicStudentAttendance(env, user, input);
  if (['decideacademicattendancecorrection', 'decideattendancecorrection'].includes(action)) return decideAcademicAttendanceCorrection(env, user, input);
  if (['saveacademicscoredraft', 'saveacademicstudentscores'].includes(action)) return saveAcademicScoreDraft(env, user, input);
  if (['getacademicscorebookcontext', 'openscorebook'].includes(action)) return getAcademicScorebookContext(env, user, input);
  if (['changeacademicscoresheetstatus', 'changescoresheetstatus'].includes(action)) return changeAcademicScoreSheetStatus(env, user, input);
  if (['previewacademicscoreimport', 'previewscoresheetimport'].includes(action)) return previewAcademicScoreImport(env, user, input);
  if (['importacademicscores', 'commitscoreimport'].includes(action)) return importAcademicScores(env, user, input);
  if (['rollbackacademicscoreimport', 'rollbackscoreimport'].includes(action)) return rollbackAcademicScoreImport(env, user, input);
  if (['syncacademiccbtscores', 'synccbtresults'].includes(action)) return syncAcademicCbtScores(env, user, input);
  if (['calculateacademictermresults', 'calculatetermresults'].includes(action)) return calculateAcademicTermResults(env, user, input);
  if (['previewacademictermresultwithdrawal', 'previewtermresultwithdrawal'].includes(action)) return previewAcademicTermResultWithdrawal(env, user, input);
  if (['changeacademictermresultstatus', 'changetermresultstatus'].includes(action)) return changeAcademicTermResultStatus(env, user, input);
  if (['saveacademictermresultremarks', 'savetermresultremarks'].includes(action)) return saveAcademicTermResultRemarks(env, user, input);
  if (['calculateacademiccumulativeresults', 'calculatecumulativeresults'].includes(action)) return calculateAcademicCumulativeResults(env, user, input);
  if (['changeacademiccumulativestatus', 'changecumulativeresultstatus'].includes(action)) return changeAcademicCumulativeStatus(env, user, input);
  if (['calculateacademicpromotiondecisions', 'calculatepromotions'].includes(action)) return calculateAcademicPromotionDecisions(env, user, input);
  if (['saveacademicpromotionoutcome', 'savepromotionoutcome'].includes(action)) return saveAcademicPromotionOutcome(env, user, input);
  if (['changeacademicpromotionstatus', 'changepromotionstatus'].includes(action)) return changeAcademicPromotionStatus(env, user, input);
  if (['createacademictranscriptdraft', 'createtranscript'].includes(action)) return createAcademicTranscriptDraft(env, user, input);
  if (['changeacademictranscriptstatus', 'changetranscriptstatus'].includes(action)) return changeAcademicTranscriptStatus(env, user, input);
  if (['deleteacademiccbttest', 'deletecbttest'].includes(action)) return deleteAcademicCbtTest(env, user, input);
  if (['downloadacademiccbttestpackage', 'downloadcbttestpackage'].includes(action)) return downloadAcademicCbtTestPackage(env, user, input);
  if (['acknowledgeacademiccbtimport', 'acknowledgecbtimport'].includes(action)) return acknowledgeAcademicCbtImport(env, user, input);
  if (['preparelocalcbtidentitypackage', 'preparecbtidentitypackage'].includes(action)) return prepareLocalCbtIdentityPackage(env, user, input);
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
