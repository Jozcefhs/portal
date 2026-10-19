import {
  batchCommitDocuments,
  getDocument,
  listCollection,
  requireFirestoreEnv,
  upsertDocument
} from '../lib/firestore.js';
import {
  recordReferencesMatch,
  recordsDeskCapabilities,
  studentSearchCard
} from '../lib/records-desk.js';
import {
  getSchoolStructure,
  listSchoolCollection,
  safeScopeId,
  schoolSectionFor,
  scopedCollectionPath
} from '../lib/school-scope.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  STUDENT_FACE_MODEL_ID,
  STUDENT_FACE_TEMPLATE_VERSION,
  bestFaceTemplateMatch,
  decryptFaceDescriptor,
  encryptFaceDescriptor,
  faceTemplateIsUsable,
  studentFaceLookupConfigured,
  studentFaceLookupEnabled,
  studentFaceMatchSettings,
  studentFaceTemplateExpiresAt,
  validateFaceDescriptor
} from '../lib/student-face-templates.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const MANAGER_ROLES = new Set(['Super Admin', 'Principal', 'Admissions Officer']);
const LOOKUP_WINDOW_MS = 5 * 60 * 1000;
const LOOKUP_LIMIT = 20;
const DEFAULT_DIRECT_GALLERY_LIMIT = 250;
const lookupWindows = new Map();

function error(message, status = 400) {
  const failure = new Error(message);
  failure.status = status;
  return failure;
}

function nowIso() {
  return new Date().toISOString();
}

async function studentTemplateDocumentId(value) {
  const normalized = lower(value);
  if (!normalized) throw error('The student reference is invalid.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return `face-${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function workspaceId(env) {
  return clean(env.DYNAMAX_WORKSPACE_ID || env.FIREBASE_PROJECT_ID);
}

function directGalleryLimit(env = {}) {
  const configured = Number(env.STUDENT_FACE_MAX_GALLERY);
  if (!Number.isInteger(configured)) return DEFAULT_DIRECT_GALLERY_LIMIT;
  return Math.max(25, Math.min(1000, configured));
}

function faceTemplateMeta(env, row = {}) {
  return {
    workspaceId: workspaceId(env),
    branchId: safeScopeId(row.BranchId),
    schoolSection: schoolSectionFor(row),
    studentId: clean(row.StudentRef),
    modelId: clean(row.ModelId || STUDENT_FACE_MODEL_ID),
    templateVersion: Number(row.TemplateVersion || STUDENT_FACE_TEMPLATE_VERSION),
    keyVersion: clean(row.EncryptionKeyVersion || env.FACE_TEMPLATE_KEY_VERSION || 'v1')
  };
}

function activeStudent(row = {}) {
  const status = lower(row.Status || row.AcademicProgress || row.EnrollmentStatus);
  return !['inactive', 'withdrawn', 'graduated', 'deleted', 'disabled'].includes(status);
}

function studentReference(row = {}) {
  return clean(row.AdmissionNo || row.AccountRef || row.ApplicationReference || row.__id);
}

function explicitLookupPermission(user = {}) {
  return user.biometricLookupEnabled === true ||
    ['yes', 'true', '1', 'enabled'].includes(lower(user.BiometricLookupEnabled));
}

function ensureSchoolRecordsDesk(user = {}) {
  const capabilities = recordsDeskCapabilities(user);
  if (lower(user.edition) !== 'school') {
    throw error('Student face lookup is available only in a school workspace.', 403);
  }
  if (!capabilities.enabled || !capabilities.canSearchStudents) {
    throw error('This staff account cannot search student records.', 403);
  }
  return capabilities;
}

function canManageTemplates(user = {}) {
  return explicitLookupPermission(user) && MANAGER_ROLES.has(clean(user.role));
}

function canEraseTemplates(user = {}) {
  return MANAGER_ROLES.has(clean(user.role));
}

function ensureLookupPermission(user = {}) {
  if (!explicitLookupPermission(user)) {
    throw error('Student face lookup has not been enabled for this staff account.', 403);
  }
}

function ensureConfigured(env = {}) {
  if (!studentFaceLookupEnabled(env)) {
    throw error('Student face lookup is disabled for this school.', 503);
  }
  if (!studentFaceLookupConfigured(env)) {
    throw error('Student face lookup encryption is not configured.', 503);
  }
}

async function enforceLookupRate(user = {}, env = {}) {
  const now = Date.now();
  const key = `${workspaceId(env)}|${lower(user.username)}`;
  if (typeof env.STUDENT_FACE_RATE_LIMITER?.limit === 'function') {
    const result = await env.STUDENT_FACE_RATE_LIMITER.limit({ key });
    if (!result?.success) {
      throw error('Too many face lookups were attempted. Use manual search or wait a few minutes.', 429);
    }
    return;
  }
  if (lookupWindows.size > 500) {
    for (const [entryKey, entry] of lookupWindows.entries()) {
      if (entry.resetAt <= now) lookupWindows.delete(entryKey);
    }
  }
  const current = lookupWindows.get(key);
  if (!current || current.resetAt <= now) {
    lookupWindows.set(key, { count: 1, resetAt: now + LOOKUP_WINDOW_MS });
    return;
  }
  if (current.count >= LOOKUP_LIMIT) {
    throw error('Too many face lookups were attempted. Use manual search or wait a few minutes.', 429);
  }
  current.count += 1;
}

function requestedSchoolScope(user = {}, branchId = '') {
  const assignedBranch = safeScopeId(user.branchId || '', '');
  const requestedBranch = safeScopeId(branchId || '', '');
  if (assignedBranch && requestedBranch && assignedBranch !== requestedBranch) {
    throw error('This staff account is restricted to another branch.', 403);
  }
  return {
    branchId: assignedBranch || requestedBranch,
    schoolSectionAccess: clean(user.schoolSectionAccess || 'All')
  };
}

async function accessibleStudents(env, user, branchId = '') {
  const scope = requestedSchoolScope(user, branchId);
  return (await listSchoolCollection(env, 'students', scope))
    .filter(activeStudent)
    .filter((row) => {
      if (scope.branchId && safeScopeId(row.BranchId || 'main') !== scope.branchId) return false;
      const section = lower(scope.schoolSectionAccess);
      return !['primary', 'secondary'].includes(section) || schoolSectionFor(row) === section;
    });
}

async function findAccessibleStudent(env, user, studentId, branchId = '') {
  const wanted = clean(studentId);
  if (!wanted) throw error('Choose a student before enrolling a face template.');
  const rows = (await accessibleStudents(env, user, branchId))
    .filter((row) => recordReferencesMatch(wanted, row));
  const unique = new Map();
  rows.forEach((row) => {
    const key = [
      safeScopeId(row.BranchId || 'main'),
      schoolSectionFor(row),
      lower(studentReference(row))
    ].join('|');
    if (!unique.has(key)) unique.set(key, row);
  });
  if (!unique.size) throw error('The student was not found in your permitted school scope.', 404);
  if (unique.size > 1) throw error('More than one student uses that reference. Choose the branch-specific record.', 409);
  return [...unique.values()][0];
}

async function permittedTemplatePaths(env, user) {
  const structure = await getSchoolStructure(env);
  const assignedBranch = safeScopeId(user.branchId || '', '');
  const assignedSection = lower(user.schoolSectionAccess);
  const branches = assignedBranch ? [assignedBranch] : structure.Branches.map((row) => row.Id);
  const sections = ['primary', 'secondary'].includes(assignedSection)
    ? [assignedSection]
    : structure.Sections;
  return [...new Set(branches.flatMap((branchId) =>
    sections.map((section) => scopedCollectionPath('studentFaceTemplates', branchId, section))
  ))];
}

function faceAuditWrite(env, user, action, details = {}) {
  const auditId = `FACE-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    collectionPath: 'staffFaceLookupAudit',
    documentId: auditId,
    data: {
      AuditId: auditId,
      Timestamp: nowIso(),
      Action: clean(action),
      Actor: clean(user.displayName || user.username),
      ActorUsername: clean(user.username),
      BranchId: clean(details.BranchId || user.branchId),
      SchoolSection: clean(details.SchoolSection || user.schoolSectionAccess),
      StudentRef: clean(details.StudentRef),
      Result: clean(details.Result),
      ModelId: clean(details.ModelId || STUDENT_FACE_MODEL_ID),
      WorkspaceId: workspaceId(env),
      SourcePlatform: 'Web Records Desk'
    }
  };
}

async function writeAudit(env, user, action, details = {}) {
  const audit = faceAuditWrite(env, user, action, details);
  await upsertDocument(env, audit.collectionPath, audit.documentId, audit.data);
}

function templateEncryptionSecret(env, template = {}) {
  const currentVersion = clean(env.FACE_TEMPLATE_KEY_VERSION || 'v1');
  const templateVersion = clean(template.EncryptionKeyVersion || 'v1');
  if (templateVersion === currentVersion) return clean(env.FACE_TEMPLATE_ENCRYPTION_KEY);
  let previous = {};
  try {
    previous = JSON.parse(clean(env.FACE_TEMPLATE_PREVIOUS_KEYS) || '{}');
  } catch (_failure) {
    throw error('The configured face-template keyring is invalid.', 503);
  }
  const secret = clean(previous?.[templateVersion]);
  if (secret.length < 24) {
    throw error(`The face-template key ${templateVersion} is unavailable.`, 503);
  }
  return secret;
}

async function status(env, user, body) {
  const configured = studentFaceLookupConfigured(env);
  const result = {
    ok: true,
    enabled: studentFaceLookupEnabled(env),
    configured,
    canLookup: explicitLookupPermission(user),
    canManage: canManageTemplates(user),
    canErase: canEraseTemplates(user),
    modelId: STUDENT_FACE_MODEL_ID,
    templateVersion: STUDENT_FACE_TEMPLATE_VERSION,
    enrolled: false,
    message: configured
      ? 'Student face lookup is ready.'
      : 'Student face lookup requires the school feature flag and encryption secret.'
  };
  if (!clean(body.studentId) || !result.canErase) return result;
  const student = await findAccessibleStudent(env, user, body.studentId, body.branchId);
  const branchId = safeScopeId(student.BranchId || 'main');
  const schoolSection = schoolSectionFor(student);
  const path = scopedCollectionPath('studentFaceTemplates', branchId, schoolSection);
  const documentId = await studentTemplateDocumentId(studentReference(student));
  const saved = await getDocument(env, path, documentId).catch(() => null);
  if (saved && faceTemplateIsUsable(saved)) {
    result.enrolled = true;
    result.templateExpiresAt = clean(saved.TemplateExpiresAt);
    result.enrolledAt = clean(saved.EnrolledAt);
    result.sampleCount = Number(saved.SampleCount || 0);
  } else if (saved) {
    result.expired = true;
    result.enrollmentMessage = 'The saved face enrollment is inactive or its retention period has ended. Re-enroll to renew it.';
  }
  return result;
}

async function enroll(env, user, body) {
  ensureConfigured(env);
  if (!canManageTemplates(user)) {
    throw error('This staff account cannot enroll student face templates.', 403);
  }
  const modelId = clean(body.modelId);
  if (modelId !== STUDENT_FACE_MODEL_ID) {
    throw error('The captured template uses an unsupported face model.');
  }
  const descriptor = validateFaceDescriptor(body.descriptor);
  const sampleCount = Number(body.sampleCount);
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 8) {
    throw error('Capture between two and eight live face samples.');
  }
  const student = await findAccessibleStudent(env, user, body.studentId, body.branchId);
  const studentRef = studentReference(student);
  const branchId = safeScopeId(student.BranchId || 'main');
  const schoolSection = schoolSectionFor(student);
  const path = scopedCollectionPath('studentFaceTemplates', branchId, schoolSection);
  const documentId = await studentTemplateDocumentId(studentRef);
  const existing = await getDocument(env, path, documentId).catch(() => null);
  const meta = {
    workspaceId: workspaceId(env),
    branchId,
    schoolSection,
    studentId: studentRef,
    modelId,
    templateVersion: STUDENT_FACE_TEMPLATE_VERSION,
    keyVersion: clean(env.FACE_TEMPLATE_KEY_VERSION || 'v1')
  };
  const encrypted = await encryptFaceDescriptor(
    descriptor,
    env.FACE_TEMPLATE_ENCRYPTION_KEY,
    meta
  );
  const timestamp = nowIso();
  const savedTemplate = {
    StudentRef: studentRef,
    ApplicationReference: clean(student.ApplicationReference),
    BranchId: branchId,
    SchoolSection: schoolSection,
    ModelId: modelId,
    TemplateVersion: STUDENT_FACE_TEMPLATE_VERSION,
    SampleCount: sampleCount,
    Active: true,
    TemplateExpiresAt: studentFaceTemplateExpiresAt(env, Date.parse(timestamp)),
    EnrolledAt: existing?.EnrolledAt || timestamp,
    EnrolledBy: existing?.EnrolledBy || clean(user.displayName || user.username),
    UpdatedAt: timestamp,
    UpdatedBy: clean(user.displayName || user.username),
    ...encrypted
  };
  const audit = faceAuditWrite(env, user, existing ? 'REPLACE TEMPLATE' : 'ENROLL TEMPLATE', {
    BranchId: branchId,
    SchoolSection: schoolSection,
    StudentRef: studentRef,
    Result: 'completed',
    ModelId: modelId
  });
  await batchCommitDocuments(env, [
    { collectionPath: path, documentId, data: savedTemplate },
    audit
  ]);
  return {
    ok: true,
    enrolled: true,
    message: existing ? 'Student face template replaced.' : 'Student face template enrolled.'
  };
}

async function revoke(env, user, body) {
  if (!canEraseTemplates(user)) {
    throw error('This staff account cannot remove student face templates.', 403);
  }
  const student = await findAccessibleStudent(env, user, body.studentId, body.branchId);
  const studentRef = studentReference(student);
  const branchId = safeScopeId(student.BranchId || 'main');
  const schoolSection = schoolSectionFor(student);
  const path = scopedCollectionPath('studentFaceTemplates', branchId, schoolSection);
  const documentId = await studentTemplateDocumentId(studentRef);
  const audit = faceAuditWrite(env, user, 'REVOKE TEMPLATE', {
    BranchId: branchId,
    SchoolSection: schoolSection,
    StudentRef: studentRef,
    Result: 'deleted'
  });
  await batchCommitDocuments(env, [
    { collectionPath: path, documentId, operation: 'delete' },
    audit
  ]);
  return { ok: true, enrolled: false, message: 'Student face template removed.' };
}

function candidateStudent(rows, template) {
  const branchId = safeScopeId(template.BranchId || 'main');
  const schoolSection = schoolSectionFor(template);
  return rows.find((row) =>
    safeScopeId(row.BranchId || 'main') === branchId &&
    schoolSectionFor(row) === schoolSection &&
    recordReferencesMatch(template.StudentRef, row)
  ) || null;
}

async function match(env, user, body) {
  ensureConfigured(env);
  ensureLookupPermission(user);
  await enforceLookupRate(user, env);
  const modelId = clean(body.modelId);
  if (modelId !== STUDENT_FACE_MODEL_ID) {
    throw error('The captured template uses an unsupported face model.');
  }
  const query = validateFaceDescriptor(body.descriptor);
  const [paths, students] = await Promise.all([
    permittedTemplatePaths(env, user),
    accessibleStudents(env, user)
  ]);
  const groups = await Promise.all(paths.map((path) => listCollection(env, path)));
  const templates = groups.flat().filter((row) =>
    clean(row.ModelId) === modelId &&
    clean(row.DescriptorCiphertext) &&
    clean(row.DescriptorIv) &&
    faceTemplateIsUsable(row)
  );
  const galleryLimit = directGalleryLimit(env);
  if (templates.length > galleryLimit) {
    throw error(`This face gallery has ${templates.length} active templates and exceeds the direct-match limit of ${galleryLimit}. Use manual search until a scoped biometric index is configured.`, 413);
  }
  const candidates = [];
  let decryptionFailures = 0;
  for (const template of templates) {
    const student = candidateStudent(students, template);
    if (!student) continue;
    try {
      const descriptor = await decryptFaceDescriptor(
        template,
        templateEncryptionSecret(env, template),
        faceTemplateMeta(env, template)
      );
      candidates.push({ record: template, descriptor, student });
    } catch (_failure) {
      decryptionFailures += 1;
    }
  }
  if (decryptionFailures) {
    throw error('One or more enrolled face templates could not be decrypted. Ask an administrator to repair the face-template key configuration.', 503);
  }
  const result = bestFaceTemplateMatch(query, candidates, studentFaceMatchSettings(env));
  const matched = result.match?.student || null;
  await writeAudit(env, user, 'FACE LOOKUP', {
    BranchId: matched?.BranchId || user.branchId,
    SchoolSection: matched ? schoolSectionFor(matched) : user.schoolSectionAccess,
    StudentRef: matched ? studentReference(matched) : '',
    Result: result.outcome,
    ModelId: modelId
  });
  if (!matched) {
    return {
      ok: true,
      outcome: result.outcome,
      match: null,
      message: result.outcome === 'ambiguous'
        ? 'The scan was too close to more than one enrolled student. Use manual search.'
        : 'No confident student match was found. Use manual search.'
    };
  }
  const card = studentSearchCard(matched);
  return {
    ok: true,
    outcome: 'matched',
    match: {
      type: 'students',
      id: card.id,
      title: card.title,
      subtitle: card.subtitle,
      branchId: card.branchId,
      schoolSection: card.schoolSection,
      scoreBand: result.match.similarity >= 0.82 ? 'very-high' : 'high'
    },
    message: 'A possible student match was found. Confirm the student before opening the record.'
  };
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    ensureSchoolRecordsDesk(user);
    const body = await readJsonBody(request, { maxBytes: 128 * 1024 });
    const action = lower(body.action || 'status');
    let result;
    if (action === 'status') result = await status(env, user, body);
    else if (action === 'enroll') result = await enroll(env, user, body);
    else if (action === 'revoke') result = await revoke(env, user, body);
    else if (action === 'match') result = await match(env, user, body);
    else throw error('Choose a valid student face-lookup action.');
    return Response.json(result, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (failure) {
    return Response.json({ ok: false, message: failure.message || String(failure) }, {
      status: failure.status || 500,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
}
