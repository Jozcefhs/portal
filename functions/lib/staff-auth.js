import { findOneByField, getDocument, listCollection, patchDocumentFields, upsertDocument } from './firestore.js';
import { accountingCodeAllowedForEdition } from './accounting-edition-scope.js';
import {
  featureFlagsForEdition,
  featureFlagsForPlan,
  filterSectionsForFeatures,
  resolveOrganizationConfig
} from './organization-config.js';
import { deploymentIdentityDetails, requiredDeploymentIdentity } from './deployment-identity.js';
import { configuredModulesForUser, defaultModulesForRole } from './role-module-access.js';
import { getSchoolStructure } from './school-scope.js';
import { applyStaffBranchContext } from './staff-branch-context.js';
import { refreshOrganizationPlanPolicy } from './plan-policy-sync.js';

const encoder = new TextEncoder();
const SESSION_COOKIE = '__Host-digc_staff_session';
const LEGACY_SESSION_COOKIE = 'school_staff_session';
const SESSION_SECONDS = 4 * 60 * 60;
const APPROVAL_PROOF_COOKIE = 'staff_approval_proof';
const APPROVAL_PROOF_SECONDS = 3 * 60;
const ATTENDANCE_PROOF_SECONDS = 2 * 60;
const WEB_PASSWORD_ITERATIONS = 10000;
const WEB_PASSWORD_HASH_VERSION = 'pbkdf2-sha256-v1';
const ACCESS_CONFIG_CACHE_MS = 15000;

let accessConfigCache = null;

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function isFirestoreQuotaError(error) {
  return clean(error?.code) === 'FIRESTORE_QUOTA_EXHAUSTED'
    || clean(error?.upstreamCode).toUpperCase() === 'RESOURCE_EXHAUSTED'
    || /quota|resource exhausted/i.test(clean(error?.message));
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

export function findStaffLoginUser(users = [], identity = '') {
  const wanted = lower(identity);
  if (!wanted) return null;
  return users.find((row) => {
    const explicitLogin = clean(row?.LoginUsername || row?.loginUsername);
    const identities = explicitLogin
      ? [explicitLogin]
      : [row?.Username, row?.username, row?.__id];
    return identities.some((value) => lower(value) === wanted);
  }) || null;
}

function safeStaffId(value) {
  return lower(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function staffIdentityMatches(user, identity) {
  return [user?.Username, user?.username, user?.__id].some((value) => lower(value) === lower(identity));
}

export async function findStaffUserRecord(env, identity, options = {}) {
  const wanted = lower(identity);
  if (!wanted) return null;
  const directId = safeStaffId(wanted);
  if (directId) {
    const direct = await getDocument(env, 'staffUsers', directId);
    if (direct && staffIdentityMatches(direct, wanted)) return direct;
  }
  const indexed = await findOneByField(env, 'staffUsers', 'UsernameKey', wanted);
  if (indexed && staffIdentityMatches(indexed, wanted)) return indexed;
  if (options.allowListFallback === false) return null;
  const legacy = findStaffUser(await listCollection(env, 'staffUsers'), wanted);
  if (legacy?.__id && !clean(legacy.UsernameKey)) {
    await patchDocumentFields(env, 'staffUsers', legacy.__id, {
      UsernameKey: lower(legacy.Username || legacy.username || legacy.__id)
    }).catch(() => null);
  }
  return legacy;
}

export async function findStaffLoginRecord(env, identity) {
  const wanted = lower(identity);
  if (!wanted) return null;
  const direct = await findStaffUserRecord(env, wanted, { allowListFallback: false });
  if (direct) {
    const effectiveLogin = clean(direct.LoginUsername || direct.loginUsername || direct.Username || direct.username || direct.__id);
    if (lower(effectiveLogin) === wanted) return direct;
  }
  const indexed = await findOneByField(env, 'staffUsers', 'LoginUsernameKey', wanted);
  if (indexed) return indexed;
  const legacy = findStaffLoginUser(await listCollection(env, 'staffUsers'), wanted);
  if (legacy?.__id && !clean(legacy.LoginUsernameKey)) {
    await patchDocumentFields(env, 'staffUsers', legacy.__id, {
      LoginUsername: clean(legacy.LoginUsername || legacy.Username || legacy.__id),
      LoginUsernameKey: wanted
    }).catch(() => null);
  }
  return legacy;
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
    err.status = 503;
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
  const version = lower(user.PasswordHashVersion || user.passwordHashVersion || WEB_PASSWORD_HASH_VERSION);
  if (version !== WEB_PASSWORD_HASH_VERSION) return false;
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
  return {
    Salt: salt,
    PasswordHash: bytesToHex(bits),
    PasswordIterations: iterations,
    PasswordHashVersion: WEB_PASSWORD_HASH_VERSION
  };
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
    loginUsername: clean(user.LoginUsername || user.loginUsername || user.Username || user.username || user.__id),
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
    biometricLookupEnabled: !['no', 'false', '0', ''].includes(
      lower(user.BiometricLookupEnabled ?? user.biometricLookupEnabled ?? false)
    ),
    tabAccess: Array.isArray(user.TabAccess || user.tabAccess)
      ? (user.TabAccess || user.tabAccess).map(clean).filter(Boolean)
      : clean(user.TabAccess || user.tabAccess).split(',').map(clean).filter(Boolean),
    mustChangePassword: user.MustChangePassword === undefined && user.mustChangePassword === undefined
      ? false
      : !['no', 'false', '0'].includes(lower(user.MustChangePassword ?? user.mustChangePassword))
  };
}

export function allowedSectionsFor(user = {}, featureFlags = null, options = {}) {
  const role = clean(user.role || user.Role);
  const department = lower(user.department || user.Department);
  const custom = Array.isArray(user.tabAccess || user.TabAccess) ? (user.tabAccess || user.TabAccess).map(clean).filter(Boolean) : [];
  if (custom.length) {
    const inherited = role === 'Super Admin'
      ? [...custom, 'humanResources', 'dataBackup', 'securityAudit', 'staffUsers']
      : [...custom, 'humanResources'];
    const recordsDeskSources = new Set([
      'admissions', 'students', 'accounts', 'clinic', 'tuckShop',
      'staffUsers', 'members', 'funds', 'offerings', 'executiveOffice'
    ]);
    if (inherited.some((section) => recordsDeskSources.has(section))) inherited.push('recordsDesk');
    return filterSectionsForFeatures([...new Set(inherited)], featureFlags);
  }
  if (Array.isArray(options.roleModules)) {
    const configured = [...options.roleModules];
    if (role === 'Super Admin') {
      if (!configured.includes('dataBackup')) configured.push('dataBackup');
      if (!configured.includes('securityAudit')) configured.push('securityAudit');
      if (!configured.includes('staffUsers')) configured.push('staffUsers');
    }
    return filterSectionsForFeatures([...new Set(configured)], featureFlags);
  }
  return defaultModulesForRole(role, {
    edition: options.edition || 'school',
    featureFlags,
    department
  });
}

export function invalidateStaffAccessCache() {
  accessConfigCache = null;
}

export function sectionAccessFor(user = {}, organization = {}, roleAccess = null) {
  const edition = clean(organization.Edition || organization.edition) || 'school';
  const subscriptionPlan = clean(organization.Plan || organization.plan) || 'Professional';
  const subscriptionActive = organization.SubscriptionActive !== false;
  const featureFlags = organization.FeatureFlags || organization.featureFlags || featureFlagsForEdition(edition);
  const planFeatureFlags = featureFlagsForPlan(
    edition,
    subscriptionPlan,
    {},
    organization.PlanEntitlements || organization.FeatureEntitlements || null
  );
  const editionFeatureFlags = featureFlagsForEdition(edition);
  const configuredRoleModules = configuredModulesForUser(
    roleAccess,
    user,
    clean(user.role || user.Role),
    edition,
    featureFlags
  );
  const availableRoleModules = configuredModulesForUser(
    roleAccess,
    user,
    clean(user.role || user.Role),
    edition,
    editionFeatureFlags
  );
  const planRoleModules = configuredModulesForUser(
    roleAccess,
    user,
    clean(user.role || user.Role),
    edition,
    planFeatureFlags
  );
  const allowedSections = allowedSectionsFor(user, featureFlags, {
    edition,
    roleModules: configuredRoleModules
  });
  const availableSections = allowedSectionsFor(user, editionFeatureFlags, {
    edition,
    roleModules: availableRoleModules
  });
  const planSections = allowedSectionsFor(user, planFeatureFlags, {
    edition,
    roleModules: planRoleModules
  });
  const customUserModules = Array.isArray(user.tabAccess || user.TabAccess)
    ? (user.tabAccess || user.TabAccess).map(clean).filter(Boolean)
    : [];
  if (edition === 'faith' && configuredRoleModules === null && !customUserModules.length
      && featureFlags.staffAttendance === true && !allowedSections.includes('staffAttendance')) {
    allowedSections.push('staffAttendance');
  }
  if (edition === 'faith' && availableRoleModules === null && !customUserModules.length
      && editionFeatureFlags.staffAttendance === true && !availableSections.includes('staffAttendance')) {
    availableSections.push('staffAttendance');
  }
  if (edition === 'faith' && planRoleModules === null && !customUserModules.length
      && planFeatureFlags.staffAttendance === true && !planSections.includes('staffAttendance')) {
    planSections.push('staffAttendance');
  }
  const planSet = new Set(planSections);
  const effectiveAllowedSections = subscriptionActive ? allowedSections : [];
  return {
    edition,
    featureFlags,
    subscriptionPlan,
    subscriptionActive,
    subscriptionReadOnly: organization.SubscriptionReadOnly === true,
    subscriptionState: clean(organization.SubscriptionState || organization.subscriptionState) || (subscriptionActive ? 'active' : 'inactive'),
    subscriptionStatus: clean(organization.SubscriptionStatus || organization.subscriptionStatus),
    trialStartedAt: clean(organization.TrialStartedAt || organization.trialStartedAt),
    trialEndsAt: clean(organization.TrialEndsAt || organization.trialEndsAt),
    trialDaysRemaining: Number(organization.TrialDaysRemaining || organization.trialDaysRemaining || 0),
    paidThroughAt: clean(organization.PaidThroughAt || organization.paidThroughAt),
    renewalDueAt: clean(organization.RenewalDueAt || organization.renewalDueAt),
    gracePeriodEndsAt: clean(organization.GracePeriodEndsAt || organization.gracePeriodEndsAt),
    dataRetentionEndsAt: clean(organization.DataRetentionEndsAt || organization.dataRetentionEndsAt),
    subscriptionMessage: clean(organization.SubscriptionMessage || organization.subscriptionMessage),
    allowedSections: effectiveAllowedSections,
    availableSections,
    restrictedSections: subscriptionActive
      ? availableSections.filter((section) => !planSet.has(section))
      : availableSections
  };
}

export async function staffAccessFor(env, user = {}) {
  const environmentKey = `${clean(env.FIREBASE_PROJECT_ID)}|${clean(env.ORGANISATION_EDITION || env.ORGANIZATION_EDITION)}`;
  const now = Date.now();
  let organization;
  let roleAccess;
  if (accessConfigCache && accessConfigCache.environmentKey === environmentKey && accessConfigCache.expiresAt > now) {
    organization = accessConfigCache.organization;
    roleAccess = accessConfigCache.roleAccess;
  } else {
    let [organizationProfile, storedRoleAccess] = await Promise.all([
      getDocument(env, 'settings', 'organisationProfile').catch(() => null),
      getDocument(env, 'settings', 'roleModuleAccess').catch(() => null)
    ]);
    const legacyProfile = organizationProfile
      ? null
      : await getDocument(env, 'settings', 'schoolProfile').catch(() => null);
    if (organizationProfile) {
      deploymentIdentityDetails({
        env,
        identity: requiredDeploymentIdentity(env),
        organizationProfile
      });
      organizationProfile = await refreshOrganizationPlanPolicy(env, organizationProfile);
    }
    organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
    roleAccess = storedRoleAccess;
    accessConfigCache = {
      environmentKey,
      organization,
      roleAccess,
      expiresAt: Date.now() + ACCESS_CONFIG_CACHE_MS
    };
  }
  return sectionAccessFor(user, organization, roleAccess);
}

export function staffUserForAccess(user = {}, access = {}) {
  const edition = clean(access.edition) || 'school';
  const list = (value) => Array.isArray(value)
    ? value.map(clean).filter(Boolean)
    : clean(value).split(',').map(clean).filter(Boolean);
  return {
    ...user,
    ...access,
    schoolSectionAccess: edition === 'school' ? clean(user.schoolSectionAccess) || 'All' : '',
    approvalAccounts: list(user.approvalAccounts)
      .filter((code) => accountingCodeAllowedForEdition(code, edition)),
    biometricLookupEnabled: edition === 'school' && Boolean(user.biometricLookupEnabled),
    tabAccess: filterSectionsForFeatures(list(user.tabAccess), access.featureFlags)
  };
}

export async function authenticateStaff(env, username, password) {
  const wanted = lower(username);
  if (!wanted || !password) return null;
  const envUsername = lower(env.ADMIN_WEB_USERNAME || 'admin');
  let user = null;
  try {
    user = await findStaffLoginRecord(env, wanted);
  } catch (error) {
    if (wanted !== envUsername && isFirestoreQuotaError(error)) throw error;
    user = null;
  }
  if (user) {
    const active = user.Active === undefined ? true : !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active));
    if (active && await verifyDesktopPassword(user, password)) {
      const loginAt = new Date().toISOString();
      const saved = { ...user, LastLoginAt: loginAt };
      delete saved.__id;
      delete saved.__name;
      await patchDocumentFields(env, 'staffUsers', user.__id, { LastLoginAt: loginAt });
      const auditId = `LOGIN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await upsertDocument(env, 'staffSecurityAudit', auditId, {
        Timestamp: loginAt, Action: 'LOGIN', Username: clean(user.Username || user.__id),
        Role: clean(user.Role), Department: inferDepartment(user), SourcePlatform: 'Web'
      });
      return publicUser(saved);
    }
  }

  const envPassword = clean(env.ADMIN_WEB_PASSWORD);
  const configuredRecord = wanted === envUsername
    ? await findStaffUserRecord(env, envUsername).catch(() => null)
    : null;
  const configuredHasPassword = Boolean(
    clean(configuredRecord?.PasswordHash || configuredRecord?.passwordHash) &&
    clean(configuredRecord?.Salt || configuredRecord?.salt)
  );
  if (!configuredHasPassword && wanted === envUsername && envPassword && secureEqual(password, envPassword)) {
    let recoveredUser = null;
    if (configuredRecord && clean(configuredRecord.Role) === 'Super Admin') {
      const recoveredAt = new Date().toISOString();
      recoveredUser = { ...configuredRecord, ...(await hashStaffPassword(password)), MustChangePassword: false, PasswordChangedAt: recoveredAt,
        UpdatedAt: recoveredAt, UpdatedBy: 'Cloudflare Admin Recovery', LastLoginAt: recoveredAt };
      delete recoveredUser.__id; delete recoveredUser.__name;
      await upsertDocument(env, 'staffUsers', configuredRecord.__id, recoveredUser);
      const recoveryAuditId = `RECOVERY-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await upsertDocument(env, 'staffSecurityAudit', recoveryAuditId, {
        Timestamp: recoveredAt, Action: 'PASSWORD RECOVERY', Username: clean(configuredRecord.Username || configuredRecord.__id),
        Role: 'Super Admin', Department: inferDepartment(configuredRecord), SourcePlatform: 'Web Environment Admin'
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
  let user = null;
  try {
    user = await findStaffUserRecord(env, wanted);
  } catch (_err) {
    user = null;
  }
  let authenticated = null;
  if (user) {
    const active = user.Active === undefined ? true : !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active));
    if (!active) return null;
    const loginAt = new Date().toISOString();
    const saved = { ...user, LastLoginAt: loginAt };
    delete saved.__id;
    delete saved.__name;
    await patchDocumentFields(env, 'staffUsers', user.__id, { LastLoginAt: loginAt });
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
  const user = await findStaffUserRecord(env, wanted).catch(() => null);
  if (user) {
    const active = user.Active === undefined ? true : !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active));
    if (!active) return false;
    return verifyDesktopPassword(user, password);
  }
  const envUsername = lower(env.ADMIN_WEB_USERNAME || 'admin');
  return wanted === envUsername && Boolean(clean(env.ADMIN_WEB_PASSWORD)) &&
    secureEqual(password, clean(env.ADMIN_WEB_PASSWORD));
}

export async function createStaffSession(env, user) {
  const sessionUser = publicUser(user);
  delete sessionUser.profilePhotoUrl;
  const payload = {
    ...sessionUser,
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
  const current = await findStaffUserRecord(env, user.username);
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
  const requestedBranch = request.headers.get('X-Dynamax-Branch') || '';
  const needsConfiguredBranchValidation = !clean(user.branchId)
    && clean(requestedBranch)
    && lower(requestedBranch) !== 'all';
  const structure = needsConfiguredBranchValidation ? await getSchoolStructure(env) : {};
  return applyStaffBranchContext(staffUserForAccess(user, access), requestedBranch, structure);
}

export async function createStaffAttendanceProof(env, user, scope = {}) {
  const method = lower(scope.method);
  if (!['passkey', 'face'].includes(method)) throw new Error('Choose a valid attendance identity method.');
  const payload = {
    username: lower(user.username),
    purpose: 'staff-attendance-presence',
    siteId: clean(scope.siteId),
    direction: clean(scope.direction).toUpperCase(),
    method,
    exp: Math.floor(Date.now() / 1000) + ATTENDANCE_PROOF_SECONDS,
    nonce: crypto.randomUUID()
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${await signPayload(env, encoded)}`;
}

export async function readStaffAttendanceProof(env, token, username, scope = {}) {
  const payload = await verifiedSignedPayload(env, clean(token));
  const valid = payload &&
    payload.purpose === 'staff-attendance-presence' &&
    lower(payload.username) === lower(username) &&
    clean(payload.siteId) === clean(scope.siteId) &&
    clean(payload.direction).toUpperCase() === clean(scope.direction).toUpperCase() &&
    ['passkey', 'face'].includes(lower(payload.method)) &&
    Number(payload.exp) > Math.floor(Date.now() / 1000);
  return valid ? payload : null;
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
