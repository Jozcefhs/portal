import { getDocument, upsertDocument } from './firestore.js';

const encoder = new TextEncoder();
const SESSION_COOKIE = '__Host-digc_parent_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 10000;
const PASSWORD_HASH_VERSION = 'pbkdf2-sha256-v1';
const CREDENTIAL_COLLECTION = 'parentCredentials';

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
  const secret = clean(
    env.PARENT_SESSION_SECRET
    || env.STAFF_SESSION_SECRET
    || env.BACKEND_SHARED_SECRET
  );
  if (!secret) {
    const error = new Error('Parent sessions are not configured. Add PARENT_SESSION_SECRET in Cloudflare.');
    error.status = 503;
    throw error;
  }
  return secret;
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(sessionSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
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
  const verified = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(env),
    signatureBytes,
    encoder.encode(encoded)
  ).catch(() => false);
  if (!verified) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  } catch (_error) {
    return null;
  }
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

function parentCredentialId(email) {
  return lower(email).replace(/[\/\\?#\[\]]/g, '-').slice(0, 240);
}

export async function hashParentPassword(password, iterations = PASSWORD_ITERATIONS) {
  const value = String(password || '');
  if (value.length < 8) {
    const error = new Error('Password must be at least 8 characters.');
    error.status = 400;
    throw error;
  }
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const material = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: encoder.encode(salt),
    iterations,
    hash: 'SHA-256'
  }, material, 256);
  return {
    Salt: salt,
    PasswordHash: bytesToHex(bits),
    PasswordIterations: iterations,
    PasswordHashVersion: PASSWORD_HASH_VERSION
  };
}

export async function verifyParentPasswordHash(credential, password) {
  if (lower(credential?.PasswordHashVersion) !== PASSWORD_HASH_VERSION) return false;
  const salt = clean(credential?.Salt);
  const expected = lower(credential?.PasswordHash);
  if (!salt || !expected || !String(password || '')) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: encoder.encode(salt),
    iterations: Number(credential.PasswordIterations || PASSWORD_ITERATIONS),
    hash: 'SHA-256'
  }, material, 256);
  return secureEqual(bytesToHex(bits), expected);
}

export async function getParentCredential(env, email) {
  const id = parentCredentialId(email);
  if (!id) return null;
  const credential = await getDocument(env, CREDENTIAL_COLLECTION, id);
  return credential && lower(credential.Email || credential.__id) === lower(email) ? credential : null;
}

export async function verifyStoredParentPassword(env, email, password) {
  const credential = await getParentCredential(env, email);
  if (!credential) return { configured: false, valid: false };
  return {
    configured: true,
    valid: await verifyParentPasswordHash(credential, password)
  };
}

export async function saveParentPassword(env, email, password) {
  const normalizedEmail = lower(email);
  if (!normalizedEmail) {
    const error = new Error('Parent email is required.');
    error.status = 400;
    throw error;
  }
  if (String(password || '') !== String(password || '').trim()) {
    const error = new Error('Password cannot begin or end with a space.');
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const existing = await getParentCredential(env, normalizedEmail);
  const passwordFields = await hashParentPassword(password);
  const record = {
    Email: normalizedEmail,
    ...passwordFields,
    PasswordChangedAt: now,
    UpdatedAt: now,
    CreatedAt: clean(existing?.CreatedAt) || now
  };
  await upsertDocument(env, CREDENTIAL_COLLECTION, parentCredentialId(normalizedEmail), record);
  return record;
}

export async function createParentSession(env, email) {
  const normalizedEmail = lower(email);
  if (!normalizedEmail) throw new Error('Parent email is required for a session.');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    email: normalizedEmail,
    purpose: 'parent-session',
    iat: now,
    exp: now + SESSION_SECONDS
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${await signPayload(env, encoded)}`;
}

export async function readParentSession(env, request) {
  const payload = await verifiedSignedPayload(env, cookieValue(request, SESSION_COOKIE));
  if (!payload || payload.purpose !== 'parent-session') return null;
  if (!payload.exp || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
  const email = lower(payload.email);
  return email ? { email } : null;
}

export function parentSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearParentSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
