import { getDocument, listCollection, upsertDocument } from './firestore.js';
import { filterSectionsForFeatures, resolveOrganizationConfig } from './organization-config.js';

const encoder = new TextEncoder();
const SESSION_COOKIE = '__Host-digc_staff_session';
const LEGACY_SESSION_COOKIE = 'school_staff_session';
const SESSION_SECONDS = 4 * 60 * 60;
const APPROVAL_PROOF_COOKIE = 'staff_approval_proof';
const APPROVAL_PROOF_SECONDS = 3 * 60;
const WEB_PASSWORD_ITERATIONS = 10000;

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

export function findStaffUser(users = [], identity = '') {
  const wanted = lower(identity);
  if (!wanted) return null;
  return users.find((row) => [
    row?.Username,
    row?.username,
    row?.__id
  ].some((value) => lower(value) === wanted)) || null;
}

function base64Url(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToHex(value) {
  return Array.from(new Uint8Array(value)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secureEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function sessionSecret(env) {
  const secret = clean(env.STAFF_SESSION_SECRET || env.BACKEND_SHARED_SECRET || env.GOOGLE_APPS_SCRIPT_SECRET);
  if (!secret) {
    const err = new Error('Staff sessions are not configured. Add STAFF_SESSION_SECRET in Cloudflare.');
    err.status = 500;
    throw err;
  }
  return secret;
}

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode(sessionSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signPayload(env, payloadText) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payloadText));
  return base64Url(signature);
}

async function verifiedSignedPayload(env, token) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) return null;
  let signatureBytes;
  try {
    signatureBytes = fromBase64Url(signature);
  } catch (_error) {
    return null;
  }
  const key = await hmacKey(env);
  let verified = false;
  try {
    verified = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(encoded));
  } catch (_error) {
    return null;
  }
  if (!verified) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  } catch (_error) {
    return null;
  }
}

async function verifyDesktopPassword(user, password) {
  const salt = clean(user.Salt || user.salt);
  const expected = lower(user.PasswordHash || user.passwordHash);
  if (!salt || !expected || !password) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  try {
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: Number(user.PasswordIterations || user.passwordIterations || 120000),
      hash: 'SHA-256'
    }, material, 256);
    return secureEqual(bytesToHex(bits), expected);
  } catch (error) {
    if (/iteration counts above 10000|requested 120000|pbkdf2/i.test(String(error?.message || error))) return false;
    throw error;
  }
}

export async function hashStaffPassword(password, iterations = WEB_PASSWORD_ITERATIONS) {
  if (String(password || '').length < 6) {
    const err = new Error('Password must be at least 6 characters.');
    err.status = 400;
    throw err;
  }
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToHex(saltBytes);
  const material = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256'
  }, material, 256);
  return { Salt: salt, PasswordHash: bytesToHex(bits), PasswordIterations: iterations };
}

function inferDepartment(user) {
  return clean(user.Department || user.department || ({
    'Tuck Shop User': 'Tuck Shop',
    'Clinic User': 'Clinic',
    'Kitchen User': 'Kitchen',
    'Store User': 'Organisation Store',
    'Restaurant User': 'Restaurant'
  }[clean(user.Role || user.role)] || ''));
}

function publicUser(user) {
  return {
    username: clean(user.Username || user.username || user.__id),
    displayName: clean(user.DisplayName || user.displayName || user.Username || user.username || user.__id),
    profilePhotoUrl: clean(user.ProfilePhotoDataUrl || user.profilePhotoUrl),
    role: clean(user.Role || user.role) || 'Front Desk',
    department: inferDepartment(user),
    branchId: clean(user.BranchId || user.branchId),
    schoolSectionAccess: clean(user.SchoolSectionAccess || user.schoolSectionAccess) || 'All',
    approvalEnabled: !['no', 'false', '0', ''].includes(lower(user.ApprovalEnabled ?? user.approvalEnabled ?? false)),
    approvalMaxAmount: Number(user.ApprovalMaxAmount || user.approvalMaxAmount || 0) || 0,
    approvalAccounts: Array.isArray(user.ApprovalAccounts || user.approvalAccounts)
      ? (user.ApprovalAccounts || user.approvalAccounts).map(clean).filter(Boolean)
      : clean(user.ApprovalAccounts || user.approvalAccounts).split(',').map(clean).filter(Boolean),
    tabAccess: Array.isArray(user.TabAccess || user.tabAccess)
      ? (user.TabAccess || user.tabAccess).map(clean).filter(Boolean)
      : clean(user.TabAccess || user.tabAccess).split(',').map(clean).filter(Boolean),
    mustChangePassword: user.MustChangePassword === undefined && user.mustChangePassword === undefined
      ? false
      : !['no', 'false', '0'].includes(lower(user.MustChangePassword ?? user.mustChangePassword))
  };
}

export function allowedSectionsFor(user = {}, featureFlags = null) {
  const role = clean(user.role || user.Role);
  const department = lower(user.department || user.Department);
  const custom = Array.isArray(user.tabAccess || user.TabAccess) ? (user.tabAccess || user.TabAccess).map(clean).filter(Boolean) : [];
  if (custom.length) return filterSectionsForFeatures(
    role === 'Super Admin' ? [...custom, 'staffUsers'] : custom,
    featureFlags
  );
  const roleSections = {
    'Super Admin': ['admissions', 'formPurchases', 'students', 'accounts', 'incomeAnalytics', 'members', 'services', 'funds', 'offerings', 'donations', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore', 'organizationStore', 'restaurant', 'staffUsers'],
    'Admissions Officer': ['admissions', 'formPurchases', 'students', 'financeRequests', 'payroll'],
    'Accounts Officer': ['students', 'accounts', 'incomeAnalytics', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore'],
    Management: ['admissions', 'formPurchases', 'students', 'accounts', 'incomeAnalytics', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore'],
    'Tuck Shop User': ['tuckShop', 'financeRequests', 'payroll'],
    'Clinic User': ['clinic', 'financeRequests', 'payroll'],
    'Kitchen User': ['kitchen', 'financeRequests', 'payroll'],
    'Store User': ['organizationStore', 'financeRequests', 'payroll'],
    'Restaurant User': ['restaurant', 'financeRequests', 'payroll'],
    'Front Desk': ['admissions', 'formPurchases', 'students', 'financeRequests', 'payroll'],
    Pastor: ['members', 'services', 'funds', 'offerings', 'donations'],
    'Church Administrator': ['members', 'services', 'funds', 'offerings', 'donations', 'organizationStore', 'restaurant', 'financeRequests', 'payroll'],
    'Membership Officer': ['members', 'services'],
    Treasurer: ['funds', 'offerings', 'donations', 'incomeAnalytics', 'financeRequests', 'payroll'],
    Auditor: ['funds', 'offerings', 'donations', 'incomeAnalytics', 'financeRequests']
  };
  if (role === 'Department User') {
    if (department.includes('clinic')) return filterSectionsForFeatures(['clinic', 'financeRequests', 'payroll'], featureFlags);
    if (department.includes('kitchen')) return filterSectionsForFeatures(['kitchen', 'financeRequests', 'payroll'], featureFlags);
    if (department.includes('restaurant') || department.includes('catering')) return filterSectionsForFeatures(['restaurant', 'financeRequests', 'payroll'], featureFlags);
    if (department.includes('store') || department.includes('retail') || department.includes('bookshop')) return filterSectionsForFeatures(['organizationStore', 'financeRequests', 'payroll'], featureFlags);
    if (department.includes('tuck')) return filterSectionsForFeatures(['tuckShop', 'financeRequests', 'payroll'], featureFlags);
    if (department.includes('account') || department.includes('finance')) return filterSectionsForFeatures(['accounts', 'incomeAnalytics', 'financeRequests', 'payroll'], featureFlags);
    return filterSectionsForFeatures(['financeRequests', 'payroll'], featureFlags);
  }
  return filterSectionsForFeatures(roleSections[role] || [], featureFlags);
}

export async function staffAccessFor(env, user = {}) {
  const [organizationProfile, legacyProfile] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
  return {
    edition: organization.Edition,
    featureFlags: organization.FeatureFlags,
    allowedSections: allowedSectionsFor(user, organization.FeatureFlags)
  };
}

export async function authenticateStaff(env, username, password) {
  const wanted = lower(username);
  if (!wanted || !password) return null;
  let users = [];
  try {
    users = await listCollection(env, 'staffUsers');
  } catch (_err) {
    users = [];
  }
  const user = findStaffUser(users, wanted);
  if (user) {
    const active = user.Active === undefined ? true : !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active));
    if (active && await verifyDesktopPassword(user, password)) {
      const loginAt = new Date().toISOString();
      const saved = { ...user, LastLoginAt: loginAt };
      delete saved.__id;
      delete saved.__name;
      await upsertDocument(env, 'staffUsers', user.__id, saved);
      const auditId = `LOGIN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await upsertDocument(env, 'staffSecurityAudit', auditId, {
        Timestamp: loginAt, Action: 'LOGIN', Username: clean(user.Username || user.__id),
        Role: clean(user.Role), Department: inferDepartment(user), SourcePlatform: 'Web'
      });
      return publicUser(saved);
    }
  }

  const envUsername = lower(env.ADMIN_WEB_USERNAME || 'admin');
  const envPassword = clean(env.ADMIN_WEB_PASSWORD);
  if (wanted === envUsername && envPassword && secureEqual(password, envPassword)) {
    let recoveredUser = null;
    if (user && clean(user.Role) === 'Super Admin') {
      const recoveredAt = new Date().toISOString();
      recoveredUser = { ...user, ...(await hashStaffPassword(password)), MustChangePassword: false, PasswordChangedAt: recoveredAt,
        UpdatedAt: recoveredAt, UpdatedBy: 'Cloudflare Admin Recovery', LastLoginAt: recoveredAt };
      delete recoveredUser.__id; delete recoveredUser.__name;
      await upsertDocument(env, 'staffUsers', user.__id, recoveredUser);
      const recoveryAuditId = `RECOVERY-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await upsertDocument(env, 'staffSecurityAudit', recoveryAuditId, {
        Timestamp: recoveredAt, Action: 'PASSWORD RECOVERY', Username: clean(user.Username || user.__id),
        Role: 'Super Admin', Department: inferDepartment(user), SourcePlatform: 'Web Environment Admin'
      });
    }
    const envUser = {
      username: clean(env.ADMIN_WEB_USERNAME || 'admin'),
      displayName: clean(recoveredUser?.DisplayName || env.ADMIN_WEB_DISPLAY_NAME || 'Super Admin'),
      role: 'Super Admin',
      department: inferDepartment(recoveredUser || {}),
      branchId: clean(recoveredUser?.BranchId),
      schoolSectionAccess: clean(recoveredUser?.SchoolSectionAccess) || 'All'
    };
    const auditId = `LOGIN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await upsertDocument(env, 'staffSecurityAudit', auditId, {
      Timestamp: new Date().toISOString(), Action: 'LOGIN', Username: envUser.username,
      Role: envUser.role, Department: '', SourcePlatform: 'Web Environment Admin'
    });
    return envUser;
  }
  return null;
}

export async function authenticateStaffPasskey(env, username) {
  const wanted = lower(username);
  if (!wanted) return null;
  let users = [];
  try {
    users = await listCollection(env, 'staffUsers');
  } catch (_err) {
    users = [];
  }
  const user = findStaffUser(users, wanted);
  let authenticated = null;
  if (user) {
    const active = user.Active === undefined ? true : !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active));
    if (!active) return null;
    const loginAt = new Date().toISOString();
    const saved = { ...user, LastLoginAt: loginAt };
    delete saved.__id;
    delete saved.__name;
    await upsertDocument(env, 'staffUsers', user.__id, saved);
    authenticated = publicUser(saved);
  } else if (wanted === lower(env.ADMIN_WEB_USERNAME || 'admin')) {
    authenticated = publicUser({
      username: clean(env.ADMIN_WEB_USERNAME || 'admin'),
      displayName: clean(env.ADMIN_WEB_DISPLAY_NAME || 'Super Admin'),
      role: 'Super Admin',
      schoolSectionAccess: 'All'
    });
  }
  if (!authenticated) return null;
  const loginAt = new Date().toISOString();
  const auditId = `LOGIN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, 'staffSecurityAudit', auditId, {
    Timestamp: loginAt,
    Action: 'LOGIN',
    Username: authenticated.username,
    Role: authenticated.role,
    Department: authenticated.department,
    SourcePlatform: 'Web Passkey'
  });
  return authenticated;
}

export async function verifyStaffApprovalPassword(env, username, password) {
  const wanted = lower(username);
  if (!wanted || !password) return false;
  const users = await listCollection(env, 'staffUsers').catch(() => []);
  const user = findStaffUser(users, wanted);
  if (user) {
    const active = user.Active === undefined ? true : !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active));
    if (!active) return false;
    if (await verifyDesktopPassword(user, password)) return true;
  }
  const envUsername = lower(env.ADMIN_WEB_USERNAME || 'admin');
  return wanted === envUsername && Boolean(clean(env.ADMIN_WEB_PASSWORD)) &&
    secureEqual(password, clean(env.ADMIN_WEB_PASSWORD));
}

export async function createStaffSession(env, user) {
  const payload = {
    ...publicUser(user),
    purpose: 'staff-session',
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${await signPayload(env, encoded)}`;
}

export async function createStaffApprovalProof(env, user, scope = {}) {
  const payload = {
    username: lower(user.username),
    purpose: 'finance-approval',
    recordId: clean(scope.recordId),
    recordType: lower(scope.recordType),
    action: clean(scope.action),
    exp: Math.floor(Date.now() / 1000) + APPROVAL_PROOF_SECONDS,
    nonce: crypto.randomUUID()
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${await signPayload(env, encoded)}`;
}

export async function readStaffApprovalProof(env, request, username, scope = {}) {
  const headerProof = clean(request.headers.get('X-DIGC-Approval-Proof'));
  const payload = await verifiedSignedPayload(
    env,
    headerProof || cookieValue(request, APPROVAL_PROOF_COOKIE)
  );
  return Boolean(payload &&
    payload.purpose === 'finance-approval' &&
    lower(payload.username) === lower(username) &&
    clean(payload.recordId) === clean(scope.recordId) &&
    lower(payload.recordType) === lower(scope.recordType) &&
    clean(payload.action) === clean(scope.action) &&
    Number(payload.exp) > Math.floor(Date.now() / 1000));
}

function cookieValue(request, name) {
  const cookies = String(request.headers.get('Cookie') || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) return cookie.slice(separator + 1).trim();
  }
  return '';
}

function bearerValue(request) {
  const authorization = String(request.headers.get('Authorization') || '').trim();
  if (!authorization) return { present: false, token: '' };
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
  return { present: true, token: match ? match[1] : '' };
}

export async function readStaffSession(env, request) {
  const bearer = bearerValue(request);
  const token = bearer.present
    ? bearer.token
    : cookieValue(request, SESSION_COOKIE) || cookieValue(request, LEGACY_SESSION_COOKIE);
  const payload = await verifiedSignedPayload(env, token);
  if (!payload?.exp || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
  const purpose = lower(payload.purpose);
  if (bearer.present && purpose !== 'staff-session') return null;
  if (!bearer.present && purpose && purpose !== 'staff-session') return null;
  return publicUser(payload);
}

export async function requireStaffSession(env, request) {
  let user = await readStaffSession(env, request);
  if (!user) {
    const err = new Error('Your staff session has expired. Please sign in again.');
    err.status = 401;
    throw err;
  }
  const envAdmin = lower(env.ADMIN_WEB_USERNAME || 'admin');
  const users = await listCollection(env, 'staffUsers');
  const current = findStaffUser(users, user.username);
  if (current) {
    const active = current && (current.Active === undefined || !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(current.Active)));
    if (!active) {
      const err = new Error('This staff account has been disabled or deleted.');
      err.status = 401;
      throw err;
    }
    user = publicUser(current);
  } else if (lower(user.username) !== envAdmin || user.role !== 'Super Admin') {
    const err = new Error('This staff account has been disabled or deleted.');
    err.status = 401;
    throw err;
  }
  if (user.mustChangePassword) {
    const err = new Error('You must change your temporary password before continuing.');
    err.status = 428;
    throw err;
  }
  const access = await staffAccessFor(env, user);
  return { ...user, ...access };
}

export function staffSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearStaffSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function clearLegacyStaffSessionCookie() {
  return `${LEGACY_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function staffApprovalProofCookie(token) {
  return `${APPROVAL_PROOF_COOKIE}=${token}; Path=/api/; Max-Age=${APPROVAL_PROOF_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearStaffApprovalProofCookie() {
  return `${APPROVAL_PROOF_COOKIE}=; Path=/api/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
