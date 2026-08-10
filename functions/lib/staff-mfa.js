import QRCode from 'qrcode';
import {
  batchUpsertDocuments,
  createDocumentIfAbsent,
  deleteDocumentIfCurrent,
  getDocument,
  listCollection,
  patchDocumentFieldsIfCurrent,
  queryCollection,
  updateDocumentIfCurrent,
  upsertDocument
} from './firestore.js';
import {
  createStaffSession,
  finalizeStaffAuthentication,
  findStaffUserRecord,
  requireStaffSession,
  staffAccessFor,
  staffSessionCookie,
  staffUserForAccess,
  verifyStaffApprovalPassword
} from './staff-auth.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PROFILE_COLLECTION = 'staffMfaProfiles';
const CHALLENGE_COLLECTION = 'staffMfaChallenges';
const PASSKEY_COLLECTION = 'staffPasskeys';
const POLICY_DOCUMENT_ID = 'staffMfaPolicy';
const CHALLENGE_SECONDS = 5 * 60;
const SETUP_SECONDS = 10 * 60;
const MAX_CHALLENGE_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function booleanValue(value) {
  return value === true || ['yes', 'true', '1', 'active', 'enabled'].includes(lower(value));
}

function publicDocument(row = {}) {
  const copy = { ...row };
  delete copy.__id;
  delete copy.__name;
  delete copy.__createTime;
  delete copy.__updateTime;
  return copy;
}

function base64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlBytes(value) {
  const normalized = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(clean(left));
  const b = encoder.encode(clean(right));
  if (a.length !== b.length) return false;
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function profileDocumentId(username) {
  const id = lower(username).replace(/[^a-z0-9._@-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160);
  if (!id) {
    const error = new Error('A valid staff username is required for two-factor authentication.');
    error.status = 400;
    throw error;
  }
  return id;
}

async function tokenDocumentId(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`dynamax-staff-mfa:${clean(token)}`));
  return `MFA-${base64Url(digest)}`;
}

function mfaSecretMaterial(env) {
  const secret = clean(
    env.MFA_ENCRYPTION_SECRET ||
    env.STAFF_SESSION_SECRET ||
    env.BACKEND_SHARED_SECRET ||
    env.GOOGLE_APPS_SCRIPT_SECRET
  );
  if (!secret) {
    const error = new Error('Two-factor authentication is not configured. Add STAFF_SESSION_SECRET in Cloudflare.');
    error.status = 503;
    throw error;
  }
  return secret;
}

async function encryptionKey(env) {
  const projectId = clean(env.FIREBASE_PROJECT_ID || 'dynamax');
  const material = encoder.encode(`${mfaSecretMaterial(env)}\u0000${projectId}\u0000staff-mfa-aes-gcm-v1`);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptSecret(env, username, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: encoder.encode(lower(username)),
    tagLength: 128
  }, await encryptionKey(env), encoder.encode(clean(secret)));
  return { ciphertext: base64Url(ciphertext), iv: base64Url(iv) };
}

async function decryptSecret(env, username, ciphertext, iv) {
  try {
    const clear = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: base64UrlBytes(iv),
      additionalData: encoder.encode(lower(username)),
      tagLength: 128
    }, await encryptionKey(env), base64UrlBytes(ciphertext));
    return decoder.decode(clear);
  } catch (_error) {
    const error = new Error('The saved authenticator secret could not be opened. Ask a Super Administrator to reset two-factor authentication.');
    error.status = 409;
    throw error;
  }
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let bits = 0;
  let buffer = 0;
  let output = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value) {
  const input = clean(value).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const character of input) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

function hotpCounterBytes(counter) {
  const bytes = new Uint8Array(8);
  let value = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(value & 255n);
    value >>= 8n;
  }
  return bytes;
}

export async function totpCodeForSecret(secret, epochMilliseconds = Date.now(), digits = 6, period = 30) {
  const counter = Math.floor(Number(epochMilliseconds) / 1000 / period);
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, hotpCounterBytes(counter)));
  const offset = signature[signature.length - 1] & 15;
  const binary = ((signature[offset] & 127) << 24)
    | ((signature[offset + 1] & 255) << 16)
    | ((signature[offset + 2] & 255) << 8)
    | (signature[offset + 3] & 255);
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

export async function verifyTotpCode(secret, code, options = {}) {
  const normalized = clean(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return { verified: false, step: -1 };
  const epochMilliseconds = Number(options.epochMilliseconds ?? Date.now());
  const period = Number(options.period || 30);
  const window = Math.min(2, Math.max(0, Number(options.window ?? 1)));
  const currentStep = Math.floor(epochMilliseconds / 1000 / period);
  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset;
    const generated = await totpCodeForSecret(secret, step * period * 1000, 6, period);
    if (constantTimeEqual(normalized, generated)) return { verified: true, step };
  }
  return { verified: false, step: -1 };
}

function recoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const parts = [0, 4].map((start) => Array.from(bytes.slice(start, start + 4))
    .map((byte) => alphabet[byte % alphabet.length]).join(''));
  return `DMX-${parts[0]}-${parts[1]}`;
}

function normalizeRecoveryCode(value) {
  const compact = clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return '';
  return compact.startsWith('DMX') ? compact : `DMX${compact}`;
}

async function recoveryHash(env, username, code) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${mfaSecretMaterial(env)}\u0000staff-mfa-recovery-v1`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${lower(username)}\u0000${normalizeRecoveryCode(code)}`)
  );
  return base64Url(digest);
}

async function newRecoveryCodes(env, username) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => recoveryCode());
  return {
    codes,
    hashes: await Promise.all(codes.map((code) => recoveryHash(env, username, code)))
  };
}

function qrSvg(value = '') {
  const qr = QRCode.create(clean(value), { errorCorrectionLevel: 'M' });
  const margin = 3;
  const size = qr.modules.size + margin * 2;
  const modules = [];
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (qr.modules.get(row, column)) modules.push(`M${column + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Authenticator app setup QR code" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${size}v${size}H0z"/><path fill="#071b2c" d="${modules.join('')}"/></svg>`;
}

export function normalizeStaffMfaPolicy(value = {}) {
  const rawMode = clean(value.Mode || value.mode || 'OPTIONAL').toUpperCase().replace(/[\s-]+/g, '_');
  const mode = ['DISABLED', 'OPTIONAL', 'REQUIRED_ROLES', 'REQUIRED_ALL'].includes(rawMode)
    ? rawMode
    : 'OPTIONAL';
  const roles = Array.isArray(value.RequiredRoles || value.requiredRoles)
    ? (value.RequiredRoles || value.requiredRoles).map(clean).filter(Boolean)
    : clean(value.RequiredRoles || value.requiredRoles).split(',').map(clean).filter(Boolean);
  const graceDays = Math.min(30, Math.max(0, Number(value.GraceDays ?? value.graceDays ?? 7) || 0));
  return {
    Mode: mode,
    RequiredRoles: [...new Set(roles)],
    GraceDays: graceDays,
    EnforceFrom: clean(value.EnforceFrom || value.enforceFrom),
    UpdatedAt: clean(value.UpdatedAt || value.updatedAt),
    UpdatedBy: clean(value.UpdatedBy || value.updatedBy)
  };
}

export async function getStaffMfaPolicy(env) {
  const stored = await getDocument(env, 'settings', POLICY_DOCUMENT_ID).catch(() => null);
  return normalizeStaffMfaPolicy(stored || {});
}

function policyTargetsUser(policy, user = {}) {
  if (policy.Mode === 'REQUIRED_ALL') return true;
  if (policy.Mode !== 'REQUIRED_ROLES') return false;
  return policy.RequiredRoles.some((role) => lower(role) === lower(user.role || user.Role));
}

export function evaluateStaffMfaRequirement(policyValue = {}, profile = {}, passkeyCount = 0, user = {}, now = Date.now()) {
  const policy = normalizeStaffMfaPolicy(policyValue);
  const totpActive = booleanValue(profile.TotpActive);
  const hasFactor = totpActive || Number(passkeyCount || 0) > 0;
  if (policy.Mode === 'DISABLED') {
    return { required: false, enrollmentRequired: false, hasFactor, dueAt: '', policyRequired: false };
  }
  const policyRequired = policyTargetsUser(policy, user);
  const dueAt = policyRequired ? clean(policy.EnforceFrom) : '';
  const enforcementStarted = policyRequired && (!dueAt || Date.parse(dueAt) <= Number(now));
  const required = hasFactor || enforcementStarted;
  return {
    required,
    enrollmentRequired: required && !hasFactor,
    hasFactor,
    dueAt: policyRequired && !enforcementStarted ? dueAt : '',
    policyRequired
  };
}

export async function activeStaffPasskeys(env, username) {
  const rows = await queryCollection(env, PASSKEY_COLLECTION, {
    filters: [{ field: 'UsernameKey', op: '==', value: lower(username) }]
  });
  return rows.filter((row) => row.Active === undefined || booleanValue(row.Active));
}

export async function getStaffMfaProfile(env, username) {
  return getDocument(env, PROFILE_COLLECTION, profileDocumentId(username));
}

function publicProfile(profile = {}, passkeyCount = 0) {
  return {
    username: clean(profile.Username),
    totpActive: booleanValue(profile.TotpActive),
    passkeyCount: Number(passkeyCount || 0),
    recoveryCodesRemaining: Array.isArray(profile.RecoveryCodeHashes) ? profile.RecoveryCodeHashes.length : 0,
    enabledAt: clean(profile.MfaEnabledAt),
    lastVerifiedAt: clean(profile.LastVerifiedAt),
    updatedAt: clean(profile.UpdatedAt)
  };
}

async function createLoginChallenge(env, user, details = {}) {
  for (let collisionAttempt = 0; collisionAttempt < 3; collisionAttempt += 1) {
    const ticket = randomToken();
    const id = await tokenDocumentId(ticket);
    const now = Date.now();
    const created = await createDocumentIfAbsent(env, CHALLENGE_COLLECTION, id, {
      Username: clean(user.username || user.Username),
      UsernameKey: lower(user.username || user.Username),
      Role: clean(user.role || user.Role),
      Methods: details.methods || [],
      EnrollmentRequired: Boolean(details.enrollmentRequired),
      Attempts: 0,
      CreatedAt: new Date(now).toISOString(),
      ExpiresAt: new Date(now + CHALLENGE_SECONDS * 1000).toISOString()
    });
    if (created.created) return { ticket, expiresIn: CHALLENGE_SECONDS };
  }
  const error = new Error('A secure two-factor challenge could not be created. Please try again.');
  error.status = 503;
  throw error;
}

export async function beginStaffMfaLogin(env, user = {}) {
  const username = clean(user.username || user.Username);
  const [policy, profile, passkeys] = await Promise.all([
    getStaffMfaPolicy(env),
    getStaffMfaProfile(env, username),
    activeStaffPasskeys(env, username)
  ]);
  const requirement = evaluateStaffMfaRequirement(policy, profile || {}, passkeys.length, user);
  if (!requirement.required) return { required: false, policy, requirement };
  const methods = [];
  if (passkeys.length) methods.push('passkey');
  if (booleanValue(profile?.TotpActive)) {
    methods.push('totp');
    if (Array.isArray(profile.RecoveryCodeHashes) && profile.RecoveryCodeHashes.length) methods.push('recovery');
  }
  if (!methods.length && requirement.enrollmentRequired) methods.push('totp-setup');
  const challenge = await createLoginChallenge(env, user, {
    methods,
    enrollmentRequired: requirement.enrollmentRequired
  });
  return {
    required: true,
    authenticated: false,
    mfaRequired: true,
    mfaTicket: challenge.ticket,
    expiresIn: challenge.expiresIn,
    methods,
    enrollmentRequired: requirement.enrollmentRequired,
    message: requirement.enrollmentRequired
      ? 'Two-factor authentication is required for this account. Set up an authenticator app to continue.'
      : 'Complete two-factor verification to continue.'
  };
}

export async function readStaffMfaLoginChallenge(env, ticket) {
  const token = clean(ticket);
  if (token.length < 32) {
    const error = new Error('The two-factor sign-in request is invalid. Please sign in again.');
    error.status = 400;
    throw error;
  }
  const id = await tokenDocumentId(token);
  const challenge = await getDocument(env, CHALLENGE_COLLECTION, id);
  if (!challenge || Date.parse(challenge.ExpiresAt) <= Date.now()) {
    const error = new Error('The two-factor sign-in request expired. Please sign in again.');
    error.status = 401;
    throw error;
  }
  if (Number(challenge.Attempts || 0) >= MAX_CHALLENGE_ATTEMPTS) {
    const error = new Error('Too many two-factor attempts. Please sign in again.');
    error.status = 429;
    throw error;
  }
  return { id, challenge };
}

async function recordChallengeFailure(env, id, challenge) {
  const attempts = Number(challenge.Attempts || 0) + 1;
  if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
    await deleteDocumentIfCurrent(env, CHALLENGE_COLLECTION, id, challenge).catch(() => null);
    return attempts;
  }
  await patchDocumentFieldsIfCurrent(env, CHALLENGE_COLLECTION, id, {
    Attempts: attempts,
    LastAttemptAt: new Date().toISOString()
  }, challenge).catch(() => null);
  return attempts;
}

async function consumeChallenge(env, id, challenge) {
  try {
    await deleteDocumentIfCurrent(env, CHALLENGE_COLLECTION, id, challenge);
  } catch (cause) {
    if (![404, 409, 412].includes(Number(cause?.status)) && cause?.code !== 'FIRESTORE_WRITE_CONFLICT') throw cause;
    const error = new Error('This two-factor request was already used. Please sign in again.');
    error.status = 409;
    throw error;
  }
}

async function completedSession(env, username, sourcePlatform) {
  const user = await finalizeStaffAuthentication(env, username, sourcePlatform);
  if (!user) {
    const error = new Error('This staff account is inactive or no longer exists.');
    error.status = 401;
    throw error;
  }
  const [token, access] = await Promise.all([
    createStaffSession(env, user),
    staffAccessFor(env, user)
  ]);
  return {
    user: staffUserForAccess(user, access),
    sessionToken: token,
    sessionCookie: staffSessionCookie(token)
  };
}

export async function completeStaffMfaPasskeyLogin(env, ticket, username) {
  const { id, challenge } = await readStaffMfaLoginChallenge(env, ticket);
  if (!(challenge.Methods || []).includes('passkey') || lower(challenge.UsernameKey) !== lower(username)) {
    const error = new Error('This device credential does not belong to the pending two-factor sign-in.');
    error.status = 403;
    throw error;
  }
  await consumeChallenge(env, id, challenge);
  return completedSession(env, challenge.Username, 'Web Password + Passkey');
}

async function verifyProfileTotp(env, username, profile, code, options = {}) {
  if (!booleanValue(profile?.TotpActive) || !clean(profile?.TotpCiphertext) || !clean(profile?.TotpIv)) {
    return { verified: false, reason: 'Authenticator verification is not active on this account.' };
  }
  const secret = await decryptSecret(env, username, profile.TotpCiphertext, profile.TotpIv);
  const result = await verifyTotpCode(secret, code);
  if (!result.verified) return { verified: false, reason: 'The authenticator code is incorrect or expired.' };
  if (!options.allowReplay && result.step <= Number(profile.LastTotpStep ?? -1)) {
    return { verified: false, reason: 'That authenticator code was already used. Wait for the next code.' };
  }
  return { verified: true, step: result.step };
}

async function consumeRecoveryCode(env, username, profile, code) {
  const hashes = Array.isArray(profile?.RecoveryCodeHashes) ? profile.RecoveryCodeHashes.map(clean).filter(Boolean) : [];
  if (!hashes.length) return { verified: false, reason: 'No unused recovery codes remain on this account.' };
  const providedHash = await recoveryHash(env, username, code);
  const index = hashes.findIndex((hash) => constantTimeEqual(hash, providedHash));
  if (index < 0) return { verified: false, reason: 'That recovery code is invalid or has already been used.' };
  return { verified: true, remaining: hashes.filter((_hash, itemIndex) => itemIndex !== index) };
}

export async function verifyStaffMfaLogin(env, ticket, methodValue, code) {
  const method = lower(methodValue);
  const { id, challenge } = await readStaffMfaLoginChallenge(env, ticket);
  if (!(challenge.Methods || []).includes(method) || !['totp', 'recovery'].includes(method)) {
    const error = new Error('Choose an available two-factor verification method.');
    error.status = 400;
    throw error;
  }
  const username = clean(challenge.Username);
  const profile = await getStaffMfaProfile(env, username);
  let verification;
  if (method === 'totp') verification = await verifyProfileTotp(env, username, profile, code);
  else verification = await consumeRecoveryCode(env, username, profile, code);
  if (!verification.verified) {
    const attempts = await recordChallengeFailure(env, id, challenge);
    const error = new Error(attempts >= MAX_CHALLENGE_ATTEMPTS
      ? 'Too many incorrect two-factor attempts. Please sign in again.'
      : verification.reason);
    error.status = attempts >= MAX_CHALLENGE_ATTEMPTS ? 429 : 401;
    throw error;
  }
  const now = new Date().toISOString();
  const changes = method === 'totp'
    ? { LastTotpStep: verification.step, LastVerifiedAt: now, LastVerificationMethod: 'Authenticator app' }
    : { RecoveryCodeHashes: verification.remaining, LastVerifiedAt: now, LastVerificationMethod: 'Recovery code' };
  try {
    await patchDocumentFieldsIfCurrent(env, PROFILE_COLLECTION, profile.__id, changes, profile);
  } catch (cause) {
    if (cause?.code !== 'FIRESTORE_WRITE_CONFLICT' && Number(cause?.status) !== 409) throw cause;
    const error = new Error('This verification code was already used by another request. Please sign in again.');
    error.status = 409;
    throw error;
  }
  await consumeChallenge(env, id, challenge);
  return completedSession(env, username, method === 'totp' ? 'Web Password + Authenticator' : 'Web Password + Recovery Code');
}

async function organizationMfaName(env) {
  const organization = await getDocument(env, 'settings', 'organisationProfile').catch(() => null)
    || await getDocument(env, 'settings', 'schoolProfile').catch(() => null);
  return clean(
    organization?.Name || organization?.SchoolName || organization?.ChurchName ||
    organization?.OrganizationName || organization?.OrganisationName || 'Dynamax'
  ).slice(0, 80);
}

export async function resolveStaffMfaActor(env, request, ticket = '', options = {}) {
  try {
    const user = await requireStaffSession(env, request);
    return { user, challenge: null, challengeId: '', viaTicket: false };
  } catch (sessionError) {
    if (!options.allowEnrollmentTicket || !clean(ticket)) throw sessionError;
    const { id, challenge } = await readStaffMfaLoginChallenge(env, ticket);
    if (!booleanValue(challenge.EnrollmentRequired) || !(challenge.Methods || []).includes('totp-setup')) {
      const error = new Error('This sign-in request does not permit authenticator enrollment.');
      error.status = 403;
      throw error;
    }
    const record = await findStaffUserRecord(env, challenge.Username).catch(() => null);
    const user = record || { username: challenge.Username, role: challenge.Role };
    return { user, challenge, challengeId: id, viaTicket: true };
  }
}

export async function beginTotpSetup(env, actor) {
  const username = clean(actor.user.username || actor.user.Username || actor.user.__id);
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  const encrypted = await encryptSecret(env, username, secret);
  const profileId = profileDocumentId(username);
  const current = await getDocument(env, PROFILE_COLLECTION, profileId);
  const now = Date.now();
  await upsertDocument(env, PROFILE_COLLECTION, profileId, {
    ...publicDocument(current || {}),
    Username: username,
    UsernameKey: lower(username),
    PendingTotpCiphertext: encrypted.ciphertext,
    PendingTotpIv: encrypted.iv,
    PendingTotpExpiresAt: new Date(now + SETUP_SECONDS * 1000).toISOString(),
    UpdatedAt: new Date(now).toISOString(),
    UpdatedBy: username
  });
  const issuer = await organizationMfaName(env);
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return {
    username,
    issuer,
    secret: secret.replace(/(.{4})/g, '$1 ').trim(),
    otpauthUri: uri,
    qrSvg: qrSvg(uri),
    expiresIn: SETUP_SECONDS
  };
}

export async function confirmTotpSetup(env, actor, code, currentPassword = '') {
  const username = clean(actor.user.username || actor.user.Username || actor.user.__id);
  if (!actor.viaTicket && !await verifyStaffApprovalPassword(env, username, currentPassword)) {
    const error = new Error('Enter your current password to enable or replace the authenticator app.');
    error.status = 401;
    throw error;
  }
  const profile = await getStaffMfaProfile(env, username);
  if (!profile || !clean(profile.PendingTotpCiphertext) || Date.parse(profile.PendingTotpExpiresAt) <= Date.now()) {
    const error = new Error('The authenticator setup expired. Start again.');
    error.status = 400;
    throw error;
  }
  const secret = await decryptSecret(env, username, profile.PendingTotpCiphertext, profile.PendingTotpIv);
  const verification = await verifyTotpCode(secret, code);
  if (!verification.verified) {
    const error = new Error('The authenticator code is incorrect or expired.');
    error.status = 401;
    throw error;
  }
  const recovery = await newRecoveryCodes(env, username);
  const now = new Date().toISOString();
  await updateDocumentIfCurrent(env, PROFILE_COLLECTION, profile.__id, {
    ...publicDocument(profile),
    TotpCiphertext: profile.PendingTotpCiphertext,
    TotpIv: profile.PendingTotpIv,
    TotpActive: true,
    LastTotpStep: verification.step,
    RecoveryCodeHashes: recovery.hashes,
    RecoveryCodesIssuedAt: now,
    MfaEnabledAt: clean(profile.MfaEnabledAt) || now,
    LastVerifiedAt: now,
    LastVerificationMethod: 'Authenticator setup',
    PendingTotpCiphertext: '',
    PendingTotpIv: '',
    PendingTotpExpiresAt: '',
    UpdatedAt: now,
    UpdatedBy: username
  }, profile);
  let session = null;
  if (actor.viaTicket) {
    await consumeChallenge(env, actor.challengeId, actor.challenge);
    session = await completedSession(env, username, 'Web Password + Authenticator Enrollment');
  }
  await writeMfaAudit(env, {
    action: 'ENABLE TWO-FACTOR AUTHENTICATION',
    username,
    actor: username,
    details: actor.viaTicket ? 'Required enrollment completed during sign-in' : 'Authenticator app enrolled'
  });
  return { recoveryCodes: recovery.codes, session, profile: publicProfile({ ...profile, TotpActive: true, RecoveryCodeHashes: recovery.hashes, MfaEnabledAt: clean(profile.MfaEnabledAt) || now }, 0) };
}

export async function staffMfaStatus(env, request) {
  const user = await requireStaffSession(env, request);
  const [profile, passkeys, policy] = await Promise.all([
    getStaffMfaProfile(env, user.username),
    activeStaffPasskeys(env, user.username),
    getStaffMfaPolicy(env)
  ]);
  return {
    user,
    profile: publicProfile(profile || { Username: user.username }, passkeys.length),
    policy,
    requirement: evaluateStaffMfaRequirement(policy, profile || {}, passkeys.length, user)
  };
}

async function verifyCurrentProtection(env, username, profile, code) {
  const totp = await verifyProfileTotp(env, username, profile, code, { allowReplay: true });
  if (totp.verified) return { verified: true, type: 'totp' };
  const recovery = await consumeRecoveryCode(env, username, profile, code);
  if (recovery.verified) return { verified: true, type: 'recovery', remaining: recovery.remaining };
  return { verified: false };
}

export async function regenerateStaffRecoveryCodes(env, request, body = {}) {
  const user = await requireStaffSession(env, request);
  if (!await verifyStaffApprovalPassword(env, user.username, body.currentPassword)) {
    const error = new Error('The current password is incorrect.');
    error.status = 401;
    throw error;
  }
  const profile = await getStaffMfaProfile(env, user.username);
  if (!booleanValue(profile?.TotpActive)) {
    const error = new Error('Set up an authenticator app before generating recovery codes.');
    error.status = 409;
    throw error;
  }
  const protection = await verifyCurrentProtection(env, user.username, profile, body.code);
  if (!protection.verified) {
    const error = new Error('Enter a current authenticator code or unused recovery code.');
    error.status = 401;
    throw error;
  }
  const recovery = await newRecoveryCodes(env, user.username);
  const now = new Date().toISOString();
  await patchDocumentFieldsIfCurrent(env, PROFILE_COLLECTION, profile.__id, {
    RecoveryCodeHashes: recovery.hashes,
    RecoveryCodesIssuedAt: now,
    UpdatedAt: now,
    UpdatedBy: user.username
  }, profile);
  await writeMfaAudit(env, {
    action: 'REGENERATE RECOVERY CODES', username: user.username, actor: user.username,
    details: 'Previous recovery codes invalidated'
  });
  return recovery.codes;
}

export async function disableStaffTotp(env, request, body = {}) {
  const user = await requireStaffSession(env, request);
  if (!await verifyStaffApprovalPassword(env, user.username, body.currentPassword)) {
    const error = new Error('The current password is incorrect.');
    error.status = 401;
    throw error;
  }
  const [profile, passkeys, policy] = await Promise.all([
    getStaffMfaProfile(env, user.username),
    activeStaffPasskeys(env, user.username),
    getStaffMfaPolicy(env)
  ]);
  if (!booleanValue(profile?.TotpActive)) {
    const error = new Error('Authenticator verification is not active on this account.');
    error.status = 409;
    throw error;
  }
  const protection = await verifyCurrentProtection(env, user.username, profile, body.code);
  if (!protection.verified) {
    const error = new Error('Enter a current authenticator code or unused recovery code.');
    error.status = 401;
    throw error;
  }
  const withoutTotp = evaluateStaffMfaRequirement(policy, {}, passkeys.length, user);
  if (withoutTotp.enrollmentRequired) {
    const error = new Error('Your organisation requires two-factor authentication. Add a passkey before removing the authenticator app.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  await patchDocumentFieldsIfCurrent(env, PROFILE_COLLECTION, profile.__id, {
    TotpActive: false,
    TotpCiphertext: '',
    TotpIv: '',
    RecoveryCodeHashes: [],
    RecoveryCodesIssuedAt: '',
    LastTotpStep: -1,
    UpdatedAt: now,
    UpdatedBy: user.username
  }, profile);
  await writeMfaAudit(env, {
    action: 'DISABLE AUTHENTICATOR APP', username: user.username, actor: user.username,
    details: passkeys.length ? 'Passkey protection remains active' : 'Voluntary two-factor protection disabled'
  });
}

export async function saveStaffMfaPolicy(env, request, body = {}) {
  const user = await requireStaffSession(env, request);
  if (clean(user.role) !== 'Super Admin') {
    const error = new Error('Only a Super Administrator can change the two-factor policy.');
    error.status = 403;
    throw error;
  }
  const current = await getStaffMfaPolicy(env);
  const requested = normalizeStaffMfaPolicy({
    Mode: body.mode,
    RequiredRoles: body.requiredRoles,
    GraceDays: body.graceDays
  });
  if (requested.Mode === 'REQUIRED_ROLES' && !requested.RequiredRoles.length) {
    const error = new Error('Choose at least one role for role-based enforcement.');
    error.status = 400;
    throw error;
  }
  const changedScope = requested.Mode !== current.Mode
    || JSON.stringify([...requested.RequiredRoles].sort()) !== JSON.stringify([...current.RequiredRoles].sort())
    || requested.GraceDays !== current.GraceDays;
  const now = Date.now();
  const enforceFrom = ['REQUIRED_ROLES', 'REQUIRED_ALL'].includes(requested.Mode)
    ? (changedScope ? new Date(now + requested.GraceDays * 86400000).toISOString() : current.EnforceFrom)
    : '';
  const saved = {
    ...requested,
    EnforceFrom: enforceFrom,
    UpdatedAt: new Date(now).toISOString(),
    UpdatedBy: user.username
  };
  await upsertDocument(env, 'settings', POLICY_DOCUMENT_ID, saved);
  await writeMfaAudit(env, {
    action: 'UPDATE TWO-FACTOR POLICY', username: 'All staff', actor: user.username,
    details: `${saved.Mode}; grace ${saved.GraceDays} day(s); roles ${saved.RequiredRoles.join(', ') || 'all/none'}`
  });
  return saved;
}

export async function staffMfaAdministrationStatus(env, request) {
  const user = await requireStaffSession(env, request);
  if (clean(user.role) !== 'Super Admin') {
    const error = new Error('Only a Super Administrator can view organisation-wide two-factor status.');
    error.status = 403;
    throw error;
  }
  const [policy, profiles, passkeys] = await Promise.all([
    getStaffMfaPolicy(env),
    listCollection(env, PROFILE_COLLECTION).catch(() => []),
    listCollection(env, PASSKEY_COLLECTION).catch(() => [])
  ]);
  const passkeyCounts = new Map();
  passkeys.filter((row) => row.Active === undefined || booleanValue(row.Active)).forEach((row) => {
    const key = lower(row.UsernameKey || row.Username);
    passkeyCounts.set(key, (passkeyCounts.get(key) || 0) + 1);
  });
  const accountKeys = new Set([...profiles.map((row) => lower(row.UsernameKey || row.Username)), ...passkeyCounts.keys()]);
  const accounts = [...accountKeys].filter(Boolean).map((key) => {
    const profile = profiles.find((row) => lower(row.UsernameKey || row.Username) === key) || { Username: key };
    return publicProfile(profile, passkeyCounts.get(key) || 0);
  }).sort((left, right) => left.username.localeCompare(right.username));
  return { policy, accounts };
}

export async function adminResetStaffMfa(env, request, body = {}) {
  const user = await requireStaffSession(env, request);
  if (clean(user.role) !== 'Super Admin') {
    const error = new Error('Only a Super Administrator can reset staff two-factor authentication.');
    error.status = 403;
    throw error;
  }
  if (!await verifyStaffApprovalPassword(env, user.username, body.currentPassword)) {
    const error = new Error('The current administrator password is incorrect.');
    error.status = 401;
    throw error;
  }
  const target = clean(body.targetUsername);
  if (!target) {
    const error = new Error('Choose the staff account to reset.');
    error.status = 400;
    throw error;
  }
  if (lower(target) === lower(user.username)) {
    const error = new Error('For safety, use your own security settings to change your two-factor methods.');
    error.status = 409;
    throw error;
  }
  const [profile, passkeys] = await Promise.all([
    getStaffMfaProfile(env, target),
    activeStaffPasskeys(env, target)
  ]);
  const now = new Date().toISOString();
  const writes = passkeys.map((passkey) => ({
    collectionPath: PASSKEY_COLLECTION,
    documentId: passkey.__id,
    data: { ...publicDocument(passkey), Active: false, RevokedAt: now, RevokedBy: user.username }
  }));
  if (profile) {
    writes.push({
      collectionPath: PROFILE_COLLECTION,
      documentId: profile.__id,
      data: {
        ...publicDocument(profile),
        TotpActive: false,
        TotpCiphertext: '',
        TotpIv: '',
        RecoveryCodeHashes: [],
        PendingTotpCiphertext: '',
        PendingTotpIv: '',
        PendingTotpExpiresAt: '',
        UpdatedAt: now,
        UpdatedBy: user.username,
        AdministratorResetAt: now
      }
    });
  }
  if (writes.length) await batchUpsertDocuments(env, writes);
  await writeMfaAudit(env, {
    action: 'ADMINISTRATOR RESET TWO-FACTOR AUTHENTICATION', username: target, actor: user.username,
    details: `${passkeys.length} passkey(s) revoked; authenticator and recovery codes cleared`
  });
}

export async function writeMfaAudit(env, event = {}) {
  const timestamp = new Date().toISOString();
  const id = `MFA-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, 'staffSecurityAudit', id, {
    AuditId: id,
    Timestamp: timestamp,
    Action: clean(event.action || 'TWO-FACTOR AUTHENTICATION'),
    Username: clean(event.username),
    Actor: clean(event.actor || event.username),
    ActorUsername: clean(event.actor || event.username),
    SourcePlatform: 'Web',
    Details: clean(event.details)
  });
}

export function mfaSessionResponse(payload, message = 'Two-factor verification completed.') {
  return {
    body: {
      ok: true,
      authenticated: true,
      message,
      sessionToken: payload.sessionToken,
      user: payload.user
    },
    cookie: payload.sessionCookie
  };
}
