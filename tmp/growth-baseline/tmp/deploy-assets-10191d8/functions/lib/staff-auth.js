import { listCollection, upsertDocument } from './firestore.js';

const encoder = new TextEncoder();
const SESSION_COOKIE = 'school_staff_session';
const SESSION_SECONDS = 4 * 60 * 60;
const WEB_PASSWORD_ITERATIONS = 10000;

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
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
    'Kitchen User': 'Kitchen'
  }[clean(user.Role || user.role)] || ''));
}

function publicUser(user) {
  return {
    username: clean(user.Username || user.username || user.__id),
    displayName: clean(user.DisplayName || user.displayName || user.Username || user.username || user.__id),
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

export function allowedSectionsFor(user = {}) {
  const role = clean(user.role || user.Role);
  const department = lower(user.department || user.Department);
  const custom = Array.isArray(user.tabAccess || user.TabAccess) ? (user.tabAccess || user.TabAccess).map(clean).filter(Boolean) : [];
  if (custom.length) return [...new Set(role === 'Super Admin' ? [...custom, 'staffUsers'] : custom)];
  const roleSections = {
    'Super Admin': ['admissions', 'formPurchases', 'students', 'accounts', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore', 'staffUsers'],
    'Admissions Officer': ['admissions', 'formPurchases', 'students', 'financeRequests', 'payroll'],
    'Accounts Officer': ['students', 'accounts', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore'],
    Management: ['admissions', 'formPurchases', 'students', 'accounts', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore'],
    'Tuck Shop User': ['tuckShop', 'financeRequests', 'payroll'],
    'Clinic User': ['clinic', 'financeRequests', 'payroll'],
    'Kitchen User': ['kitchen', 'financeRequests', 'payroll'],
    'Front Desk': ['admissions', 'formPurchases', 'students', 'financeRequests', 'payroll']
  };
  if (role === 'Department User') {
    if (department.includes('clinic')) return ['clinic', 'financeRequests', 'payroll'];
    if (department.includes('kitchen')) return ['kitchen', 'financeRequests', 'payroll'];
    if (department.includes('tuck')) return ['tuckShop', 'financeRequests', 'payroll'];
    if (department.includes('account') || department.includes('finance')) return ['accounts', 'financeRequests', 'payroll'];
    return ['financeRequests', 'payroll'];
  }
  return roleSections[role] || [];
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
  const user = users.find((row) => lower(row.Username || row.username || row.__id) === wanted);
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

export async function createStaffSession(env, user) {
  const payload = {
    ...publicUser(user),
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${await signPayload(env, encoded)}`;
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

export async function readStaffSession(env, request) {
  const token = cookieValue(request, SESSION_COOKIE);
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const verified = await crypto.subtle.verify('HMAC', await hmacKey(env), fromBase64Url(signature), encoder.encode(encoded));
  if (!verified) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (!payload.exp || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    return publicUser(payload);
  } catch (_err) {
    return null;
  }
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
  const current = users.find((row) => lower(row.Username || row.username || row.__id) === lower(user.username));
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
  return { ...user, allowedSections: allowedSectionsFor(user) };
}

export function staffSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearStaffSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
