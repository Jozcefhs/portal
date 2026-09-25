import { getDocument, listCollection } from './firestore.js';
import { parseDesktopDeviceCredential, verifyDesktopDeviceCredential } from './desktop-pairing.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export function secureTextEqual(left, right) {
  const a = new TextEncoder().encode(clean(left));
  const b = new TextEncoder().encode(clean(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

export function configuredDesktopSecret(env = {}) {
  return clean(env.BACKEND_SHARED_SECRET);
}

export function requireConfiguredDesktopSecret(env = {}, label = 'desktop backend') {
  const secret = configuredDesktopSecret(env);
  if (secret) return secret;
  const error = new Error(`The ${label} is not configured. Add BACKEND_SHARED_SECRET in Cloudflare.`);
  error.status = 503;
  error.code = 'BACKEND_SECRET_NOT_CONFIGURED';
  throw error;
}

export function verifyDesktopSecret(env = {}, supplied = '', label = 'desktop backend') {
  const expected = requireConfiguredDesktopSecret(env, label);
  if (secureTextEqual(supplied, expected)) return true;
  const error = new Error('Unauthorized.');
  error.status = 401;
  error.code = 'BACKEND_SECRET_INVALID';
  throw error;
}

export async function verifyDesktopCredential(env = {}, supplied = '', label = 'desktop backend') {
  const credential = clean(supplied);
  if (parseDesktopDeviceCredential(credential)) {
    const device = await verifyDesktopDeviceCredential(env, credential);
    if (device) {
      return {
        type: 'device',
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        branchId: clean(device.branchId),
        branchName: clean(device.branchName),
        organisationWide: !clean(device.branchId)
      };
    }
    const error = new Error('Unauthorized. This desktop device is not paired or has been revoked.');
    error.status = 401;
    error.code = 'DESKTOP_DEVICE_INVALID';
    throw error;
  }
  verifyDesktopSecret(env, credential, label);
  return { type: 'legacy-secret' };
}

function canonicalDeviceBranchId(value) {
  const branchId = lower(value)
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return branchId === 'main-branch' ? 'main' : branchId;
}

function desktopBranchMismatch(field, deviceBranchId) {
  const error = new Error(`This computer is paired with branch ${deviceBranchId} and cannot access a different branch through ${field}.`);
  error.status = 403;
  error.code = 'DESKTOP_DEVICE_BRANCH_MISMATCH';
  return error;
}

function branchFromScopePath(value) {
  const path = clean(value).replace(/^\/+|\/+$/g, '');
  const match = /^(?:schoolBranches|organisationBranches)\/([^/]+)(?:\/|$)/i.exec(path);
  return match ? canonicalDeviceBranchId(match[1]) : '';
}

function assertBranchBoundPayload(value, deviceBranchId, path = 'request', depth = 0) {
  if (depth > 24 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertBranchBoundPayload(item, deviceBranchId, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  Object.entries(value).forEach(([key, item]) => {
    const field = `${path}.${key}`;
    if (/branchid$/i.test(key) && item !== null && typeof item !== 'object') {
      const requested = canonicalDeviceBranchId(item);
      if (requested && requested !== deviceBranchId) throw desktopBranchMismatch(field, deviceBranchId);
    }
    if ((/^__scopepath$/i.test(key) || /scopepath$/i.test(key)) && item !== null && typeof item !== 'object') {
      const scopePath = clean(item);
      if (scopePath) {
        const pathBranch = branchFromScopePath(scopePath);
        if (pathBranch && pathBranch !== deviceBranchId) throw desktopBranchMismatch(field, deviceBranchId);
        // Legacy root student/application collections represent the main branch.
        // A non-main device must always use an explicitly branch-scoped path.
        if (!pathBranch && deviceBranchId !== 'main') throw desktopBranchMismatch(field, deviceBranchId);
      }
    }
    assertBranchBoundPayload(item, deviceBranchId, field, depth + 1);
  });
}

export function applyDesktopDeviceBranchScope(body = {}, authentication = {}) {
  const deviceBranchId = canonicalDeviceBranchId(authentication?.branchId);
  if (clean(authentication?.type) !== 'device' || !deviceBranchId) return body;
  assertBranchBoundPayload(body, deviceBranchId);
  return {
    ...body,
    BranchId: deviceBranchId,
    branchId: deviceBranchId,
    UserBranchId: deviceBranchId,
    userBranchId: deviceBranchId,
    DeviceBranchId: deviceBranchId,
    DeviceBranchName: clean(authentication.branchName)
  };
}

export function isActiveStaffUser(user) {
  if (!user) return false;
  if (user.Active === undefined) return true;
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active));
}

export function resolveAuthoritativeDesktopActor(body = {}, users = [], env = {}) {
  const username = clean(body.UserUsername || body.userUsername);
  if (!username) {
    const error = new Error('Your signed-in username is required for this protected action.');
    error.status = 401;
    error.code = 'BACKEND_ACTOR_REQUIRED';
    throw error;
  }
  const user = users.find((row) => lower(row.Username || row.username || row.__id) === lower(username));
  if (user && isActiveStaffUser(user)) {
    const authoritativeUsername = clean(user.Username || user.username || user.__id);
    return {
      username: authoritativeUsername,
      displayName: clean(user.DisplayName || user.displayName || authoritativeUsername),
      role: clean(user.Role || user.role) || 'Front Desk',
      department: clean(user.Department || user.department),
      branchId: clean(user.BranchId || user.branchId),
      schoolSectionAccess: clean(user.SchoolSectionAccess || user.schoolSectionAccess) || 'All',
      tabAccess: Array.isArray(user.TabAccess || user.tabAccess)
        ? (user.TabAccess || user.tabAccess).map(clean).filter(Boolean)
        : clean(user.TabAccess || user.tabAccess).split(',').map(clean).filter(Boolean),
      source: 'staffUsers'
    };
  }
  const recoveryUsername = clean(env.ADMIN_WEB_USERNAME);
  if (recoveryUsername && lower(recoveryUsername) === lower(username)) {
    return {
      username: recoveryUsername,
      displayName: clean(env.ADMIN_WEB_DISPLAY_NAME || 'Super Admin'),
      role: 'Super Admin',
      department: '',
      branchId: '',
      schoolSectionAccess: 'All',
      tabAccess: [],
      source: 'environment-admin'
    };
  }
  const error = new Error(user ? 'This staff account is disabled.' : 'The signed-in staff account was not found in the database.');
  error.status = 403;
  error.code = user ? 'BACKEND_ACTOR_DISABLED' : 'BACKEND_ACTOR_NOT_FOUND';
  throw error;
}

function safeStaffId(value) {
  return lower(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function staffIdentityMatches(user, identity) {
  return [user?.Username, user?.username, user?.__id].some((value) => lower(value) === lower(identity));
}

export async function resolveAuthoritativeDesktopActorForEnv(env = {}, body = {}) {
  const username = clean(body.UserUsername || body.userUsername);
  if (!username) return resolveAuthoritativeDesktopActor(body, [], env);
  const documentId = safeStaffId(username);
  let direct = null;
  if (documentId) direct = await getDocument(env, 'staffUsers', documentId);
  if (direct && staffIdentityMatches(direct, username)) {
    return resolveAuthoritativeDesktopActor(body, [direct], env);
  }
  const users = await listCollection(env, 'staffUsers');
  return resolveAuthoritativeDesktopActor(body, users, env);
}

export function applyAuthoritativeActor(body, actor) {
  const assignedRole = actor.role;
  return {
    ...body,
    UserUsername: actor.username,
    UserRole: assignedRole === 'Director' ? 'Super Admin' : assignedRole === 'Admin' ? 'Management' : assignedRole,
    UserAssignedRole: assignedRole,
    UserDepartment: actor.department,
    UserBranchId: actor.branchId,
    UserSchoolSectionAccess: actor.schoolSectionAccess,
    UserTabAccess: actor.tabAccess,
    RecordedBy: actor.displayName
  };
}
