import { batchCommitDocuments, getDocument, requireFirestoreEnv } from '../lib/firestore.js';
import { CHURCH_COLLECTIONS, churchCollectionPath, safeChurchDocumentId } from '../lib/church-foundation.js';
import { resolveMembershipBranch } from '../lib/church-membership.js';
import {
  createStaffAttendanceProof,
  readStaffAttendanceProof,
  requireStaffSession
} from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  STUDENT_FACE_MODEL_ID,
  STUDENT_FACE_TEMPLATE_VERSION,
  decryptFaceDescriptor,
  encryptFaceDescriptor,
  faceDescriptorSimilarity,
  faceTemplateIsUsable,
  validateFaceDescriptor
} from '../lib/student-face-templates.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function failure(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function enabled(value, fallback = true) {
  const normalized = lower(value);
  if (!normalized) return fallback;
  return !['no', 'false', '0', 'off', 'disabled'].includes(normalized);
}

function workspaceId(env = {}) {
  return clean(env.DYNAMAX_WORKSPACE_ID || env.FIREBASE_PROJECT_ID);
}

function branchFor(user, body = {}) {
  return resolveMembershipBranch(user, body.BranchId || body.branchId || 'main');
}

function usernameFor(user = {}) {
  return lower(user.username || user.Username || user.email || user.Email);
}

function templatePath(branchId) {
  return churchCollectionPath(CHURCH_COLLECTIONS.staffAttendanceFaceTemplates, branchId);
}

function templateId(username) {
  return safeChurchDocumentId(`STAFF-FACE-${lower(username)}`);
}

function configured(env = {}) {
  return enabled(env.STAFF_ATTENDANCE_FACE_ENABLED, true) && clean(env.FACE_TEMPLATE_ENCRYPTION_KEY).length >= 24;
}

function matchThreshold(env = {}) {
  const value = Number(env.STAFF_ATTENDANCE_FACE_MATCH_THRESHOLD);
  return Number.isFinite(value) ? Math.max(0.6, Math.min(0.95, value)) : 0.72;
}

function templateExpiresAt(env = {}, now = Date.now()) {
  const configured = Number(env.STAFF_ATTENDANCE_FACE_RETENTION_DAYS);
  const days = Number.isInteger(configured) ? Math.max(30, Math.min(730, configured)) : 365;
  return new Date(Number(now) + (days * 24 * 60 * 60 * 1000)).toISOString();
}

function templateMeta(env, branchId, username, keyVersion = '') {
  return {
    workspaceId: workspaceId(env),
    branchId,
    schoolSection: 'staff-attendance',
    studentId: username,
    modelId: STUDENT_FACE_MODEL_ID,
    templateVersion: STUDENT_FACE_TEMPLATE_VERSION,
    keyVersion: clean(keyVersion || env.FACE_TEMPLATE_KEY_VERSION || 'v1')
  };
}

function encryptionSecret(env, record = {}) {
  const currentVersion = clean(env.FACE_TEMPLATE_KEY_VERSION || 'v1');
  const storedVersion = clean(record.EncryptionKeyVersion || 'v1');
  if (currentVersion === storedVersion) return clean(env.FACE_TEMPLATE_ENCRYPTION_KEY);
  let previous = {};
  try {
    previous = JSON.parse(clean(env.FACE_TEMPLATE_PREVIOUS_KEYS) || '{}');
  } catch (_error) {
    failure('The configured face-template keyring is invalid.', 503);
  }
  const secret = clean(previous[storedVersion]);
  if (secret.length < 24) failure(`The face-template key ${storedVersion} is unavailable.`, 503);
  return secret;
}

function ensureConfigured(env = {}) {
  if (!configured(env)) {
    failure('Staff face attendance requires FACE_TEMPLATE_ENCRYPTION_KEY and an enabled face-attendance setting.', 503);
  }
}

function auditWrite(env, user, branchId, action, result) {
  const id = safeChurchDocumentId(`STAFF-FACE-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  return {
    collectionPath: churchCollectionPath(CHURCH_COLLECTIONS.staffTimeAudit, branchId),
    documentId: id,
    data: {
      AuditId: id,
      BranchId: branchId,
      Username: usernameFor(user),
      DisplayName: clean(user.displayName || user.DisplayName || user.username),
      Action: clean(action),
      Result: clean(result),
      Timestamp: new Date().toISOString(),
      WorkspaceId: workspaceId(env),
      SourcePlatform: 'Web staff attendance'
    },
    exists: false
  };
}

async function status(env, user, body) {
  const branchId = branchFor(user, body);
  const username = usernameFor(user);
  const saved = await getDocument(env, templatePath(branchId), templateId(username)).catch(() => null);
  return {
    ok: true,
    enabled: configured(env),
    enrolled: Boolean(saved && faceTemplateIsUsable(saved)),
    expired: Boolean(saved && !faceTemplateIsUsable(saved)),
    templateExpiresAt: clean(saved?.TemplateExpiresAt),
    message: configured(env)
      ? saved && faceTemplateIsUsable(saved)
        ? 'Your encrypted attendance face template is active.'
        : 'Enroll your face before choosing face recognition for attendance.'
      : 'Face attendance is not configured for this deployment.'
  };
}

async function requireEnrollmentProof(env, user, body, direction) {
  const proof = await readStaffAttendanceProof(env, body.AttendanceProof, usernameFor(user), {
    siteId: 'SELF',
    direction
  });
  if (!proof || lower(proof.method) !== 'passkey') {
    failure('Confirm this face-template change with your registered device biometric.', 403);
  }
}

async function enroll(env, user, body) {
  ensureConfigured(env);
  await requireEnrollmentProof(env, user, body, 'ENROLL');
  if (clean(body.modelId) !== STUDENT_FACE_MODEL_ID) failure('The captured face template uses an unsupported model.');
  const descriptor = validateFaceDescriptor(body.descriptor);
  const sampleCount = Number(body.sampleCount);
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 8) failure('Capture between two and eight live face samples.');
  const branchId = branchFor(user, body);
  const username = usernameFor(user);
  const path = templatePath(branchId);
  const id = templateId(username);
  const existing = await getDocument(env, path, id).catch(() => null);
  const timestamp = new Date().toISOString();
  const meta = templateMeta(env, branchId, username);
  const encrypted = await encryptFaceDescriptor(descriptor, env.FACE_TEMPLATE_ENCRYPTION_KEY, meta);
  const template = {
    TemplateId: id,
    BranchId: branchId,
    Username: username,
    DisplayName: clean(user.displayName || user.DisplayName || user.username),
    ModelId: STUDENT_FACE_MODEL_ID,
    TemplateVersion: STUDENT_FACE_TEMPLATE_VERSION,
    SampleCount: sampleCount,
    Active: true,
    TemplateExpiresAt: templateExpiresAt(env, Date.parse(timestamp)),
    EnrolledAt: clean(existing?.EnrolledAt) || timestamp,
    UpdatedAt: timestamp,
    ...encrypted
  };
  await batchCommitDocuments(env, [
    { collectionPath: path, documentId: id, data: template },
    auditWrite(env, user, branchId, existing ? 'REPLACE ATTENDANCE FACE' : 'ENROLL ATTENDANCE FACE', 'completed')
  ]);
  return { ok: true, enrolled: true, message: existing ? 'Attendance face enrollment replaced.' : 'Attendance face enrollment completed.' };
}

async function revoke(env, user, body) {
  await requireEnrollmentProof(env, user, body, 'REVOKE');
  const branchId = branchFor(user, body);
  const username = usernameFor(user);
  await batchCommitDocuments(env, [
    { collectionPath: templatePath(branchId), documentId: templateId(username), operation: 'delete' },
    auditWrite(env, user, branchId, 'REVOKE ATTENDANCE FACE', 'deleted')
  ]);
  return { ok: true, enrolled: false, message: 'Attendance face enrollment removed.' };
}

async function verify(env, user, body) {
  ensureConfigured(env);
  const direction = clean(body.Direction || body.direction).toUpperCase();
  const siteId = clean(body.SiteId || body.siteId);
  if (!siteId || !['IN', 'OUT', 'CHECK'].includes(direction)) failure('The attendance face-verification request is invalid.');
  if (clean(body.modelId) !== STUDENT_FACE_MODEL_ID) failure('The captured face template uses an unsupported model.');
  const query = validateFaceDescriptor(body.descriptor);
  const branchId = branchFor(user, body);
  const username = usernameFor(user);
  const saved = await getDocument(env, templatePath(branchId), templateId(username)).catch(() => null);
  if (!saved || !faceTemplateIsUsable(saved)) failure('No active attendance face enrollment was found for this staff account.', 404);
  const stored = await decryptFaceDescriptor(
    saved,
    encryptionSecret(env, saved),
    templateMeta(env, branchId, username, saved.EncryptionKeyVersion)
  );
  const similarity = faceDescriptorSimilarity(query, stored);
  const threshold = matchThreshold(env);
  const matched = similarity >= threshold;
  await batchCommitDocuments(env, [auditWrite(env, user, branchId, 'VERIFY ATTENDANCE FACE', matched ? 'matched' : 'rejected')]);
  if (!matched) failure('Live face recognition did not match the signed-in staff account.', 401);
  const proof = await createStaffAttendanceProof(env, user, { siteId, direction, method: 'face' });
  return {
    ok: true,
    attendanceProof: proof,
    method: 'Live face recognition',
    message: 'Live face recognition verified for this attendance action.'
  };
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 128 * 1024 });
    const action = lower(body.action || 'status');
    const result = action === 'status'
      ? await status(env, user, body)
      : action === 'enroll'
        ? await enroll(env, user, body)
        : action === 'revoke'
          ? await revoke(env, user, body)
          : action === 'verify'
            ? await verify(env, user, body)
            : failure('Choose a valid staff face-attendance action.');
    return Response.json(result, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  }
}
