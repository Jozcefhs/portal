import { createDocumentIfAbsent, getDocument } from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { assignedStaffBranches } from './staff-branch-access.js';
import { hashStaffPassword, requireStaffSession, verifyDesktopPassword, verifyStaffApprovalPassword } from './staff-auth.js';
import { checkStaffLoginAllowed, recordStaffLoginFailure, clearStaffLoginFailures } from './login-protection.js';

const collection = 'schoolSetupCredentials';
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
const store = { getDocument, createDocumentIfAbsent };
export async function schoolSetupEnrollmentRequired(env, db = store) {
  if (String(env.ADMIN_WEB_PASSWORD || '').trim()) return false;
  const identity = requiredDeploymentIdentity(env);
  return identity.edition === 'school' && !await db.getDocument(env, collection, identity.workspaceId);
}

export async function matchesEnrolledPassword(env, password, request, db = store) {
  if (!password || typeof password !== 'string' || password.length > 256) return false;
  const { workspaceId } = requiredDeploymentIdentity(env);
  const credential = await db.getDocument(env, collection, workspaceId);
  if (!credential) return false;
  const key = 'school-setup:' + workspaceId;
  const attempt = await checkStaffLoginAllowed(env, key, request);
  if (!attempt.allowed) fail('Too many password attempts. Try again later.', 429);
  const accepted = await verifyDesktopPassword(credential, password);
  if (!accepted) await recordStaffLoginFailure(env, key, request, attempt);
  else if (attempt.row) await clearStaffLoginFailures(env, key, request, attempt);
  return accepted;
}

export function assertSchoolPasswordOwner(actor) {
  if (actor.role !== 'Super Admin' || assignedStaffBranches(actor) !== null ||
      !['', 'all'].includes(String(actor.schoolSectionAccess || '').toLowerCase())) {
    fail('An organisation-wide Super Administrator must set the first school setup password.', 403);
  }
}

export async function enrollSchoolSetupPassword(env, request, body, db = store,
  auth = { requireStaffSession, verifyStaffApprovalPassword, checkStaffLoginAllowed, recordStaffLoginFailure }) {
  const identity = requiredDeploymentIdentity(env);
  if (identity.edition !== 'school') fail('This option is for school portals.', 403);
  if (request.headers.get('Origin') !== new URL(request.url).origin) fail('Open School Settings directly in this portal.', 403);
  const actor = await auth.requireStaffSession(env, request);
  assertSchoolPasswordOwner(actor);
  if (!await schoolSetupEnrollmentRequired(env, db)) fail('A school setup password already exists.', 409);
  const { staffPassword, newPassword } = body;
  if (typeof staffPassword !== 'string' || !staffPassword || staffPassword.length > 1024 ||
      typeof newPassword !== 'string' || newPassword.trim().length < 12 || newPassword.length > 256 ||
      newPassword.trim() === staffPassword.trim()) {
    fail('Enter your current staff password and choose a different setup password of 12–256 characters.', 400);
  }
  const attempt = await auth.checkStaffLoginAllowed(env, actor.username, request);
  if (!attempt.allowed) fail('Too many password attempts. Try again later.', 429);
  if (!await auth.verifyStaffApprovalPassword(env, actor.username, staffPassword)) {
    await auth.recordStaffLoginFailure(env, actor.username, request, attempt);
    fail('Your current staff password could not be verified.', 403);
  }
  const result = await db.createDocumentIfAbsent(env, collection, identity.workspaceId, {
    ...await hashStaffPassword(newPassword), CreatedBy: actor.username, CreatedAt: new Date().toISOString()
  });
  if (!result.created) fail('Another administrator has already set the school setup password.', 409);
}
