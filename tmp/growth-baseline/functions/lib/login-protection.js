import {
  createDocumentIfAbsent,
  deleteDocument,
  getDocument,
  updateDocumentIfCurrent
} from './firestore.js';

const COLLECTION = 'staffLoginAttempts';
const PASSKEY_OPTIONS_COLLECTION = 'staffPasskeyOptionAttempts';
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const PASSKEY_OPTIONS_WINDOW_MS = 10 * 60 * 1000;
const PASSKEY_OPTIONS_PER_SOURCE = 30;
const PASSKEY_OPTIONS_PER_USERNAME_SOURCE = 12;

function clean(value) {
  return String(value ?? '').trim();
}

function base64Url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function digestText(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean(value))));
}

async function requestSourceKey(request) {
  const connectingIp = clean(request?.headers?.get('CF-Connecting-IP'));
  if (connectingIp) return (await digestText(`ip:${connectingIp}`)).slice(0, 48);
  const forwardedIp = clean(request?.headers?.get('X-Forwarded-For')).split(',')[0].trim();
  if (forwardedIp) return (await digestText(`forwarded:${forwardedIp}`)).slice(0, 48);
  const fallback = [
    clean(request?.headers?.get('User-Agent')).slice(0, 300),
    clean(request?.headers?.get('Accept-Language')).slice(0, 120)
  ].join('|');
  return (await digestText(`browser:${fallback || 'unknown'}`)).slice(0, 48);
}

async function attemptId(username, request) {
  const normalized = clean(username).toLowerCase();
  const sourceKey = await requestSourceKey(request);
  return `staff-${(await digestText(`${normalized}:${sourceKey}`)).slice(0, 64)}`;
}

function milliseconds(value) {
  const parsed = new Date(clean(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function checkStaffLoginAllowed(env, username, request) {
  const id = await attemptId(username, request);
  const row = await getDocument(env, COLLECTION, id).catch(() => null);
  const now = Date.now();
  const lockedUntil = milliseconds(row?.LockedUntil);
  if (lockedUntil > now) {
    return {
      allowed: false,
      id,
      retryAfter: Math.max(1, Math.ceil((lockedUntil - now) / 1000))
    };
  }
  return { allowed: true, id, row };
}

export async function recordStaffLoginFailure(env, username, request, current = null) {
  const id = current?.id || await attemptId(username, request);
  const now = Date.now();
  const updatedAt = new Date(now).toISOString();
  const ip = clean(request?.headers?.get('CF-Connecting-IP'));
  let ipHash = '';
  if (ip) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    ipHash = base64Url(digest).slice(0, 24);
  }
  let row = current?.row || null;
  for (let writeAttempt = 0; writeAttempt < 4; writeAttempt += 1) {
    if (!row) row = await getDocument(env, COLLECTION, id).catch(() => null);
    const windowStarted = milliseconds(row?.WindowStartedAt);
    const insideWindow = windowStarted && now - windowStarted < WINDOW_MS;
    const failures = (insideWindow ? Number(row?.Failures || 0) : 0) + 1;
    const locked = failures >= MAX_FAILURES;
    const payload = {
      AttemptId: id,
      Failures: failures,
      WindowStartedAt: insideWindow ? clean(row?.WindowStartedAt) : updatedAt,
      LockedUntil: locked ? new Date(now + LOCK_MS).toISOString() : '',
      LastIpHash: ipHash,
      UpdatedAt: updatedAt,
      ExpiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString()
    };
    try {
      if (row?.__updateTime) {
        await updateDocumentIfCurrent(env, COLLECTION, id, payload, row);
      } else {
        const created = await createDocumentIfAbsent(env, COLLECTION, id, payload);
        if (!created.created) {
          row = created.document || null;
          continue;
        }
      }
      return {
        locked,
        retryAfter: locked ? Math.ceil(LOCK_MS / 1000) : 0,
        remaining: Math.max(0, MAX_FAILURES - failures)
      };
    } catch (error) {
      if (error?.code !== 'FIRESTORE_WRITE_CONFLICT' && Number(error?.status) !== 409) throw error;
      row = null;
    }
  }
  const error = new Error('Login attempt protection is temporarily busy. Please try again.');
  error.status = 429;
  throw error;
}

export async function clearStaffLoginFailures(env, username, request, current = null) {
  const id = current?.id || await attemptId(username, request);
  await deleteDocument(env, COLLECTION, id).catch(() => null);
}

async function consumeWindowAllowance(env, collection, id, options = {}) {
  const now = Date.now();
  const updatedAt = new Date(now).toISOString();
  const windowMs = Math.max(60 * 1000, Number(options.windowMs || PASSKEY_OPTIONS_WINDOW_MS));
  const maximum = Math.max(1, Number(options.maximum || PASSKEY_OPTIONS_PER_SOURCE));
  let row = null;
  for (let writeAttempt = 0; writeAttempt < 4; writeAttempt += 1) {
    if (!row) row = await getDocument(env, collection, id).catch(() => null);
    const windowStarted = milliseconds(row?.WindowStartedAt);
    const insideWindow = Boolean(windowStarted && now - windowStarted < windowMs);
    const requests = insideWindow ? Math.max(0, Number(row?.Requests || 0)) : 0;
    if (requests >= maximum) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((windowStarted + windowMs - now) / 1000))
      };
    }
    const payload = {
      AttemptId: id,
      Requests: requests + 1,
      WindowStartedAt: insideWindow ? clean(row?.WindowStartedAt) : updatedAt,
      UpdatedAt: updatedAt,
      ExpiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString()
    };
    try {
      if (row?.__updateTime) {
        await updateDocumentIfCurrent(env, collection, id, payload, row);
      } else {
        const created = await createDocumentIfAbsent(env, collection, id, payload);
        if (!created.created) {
          row = created.document || null;
          continue;
        }
      }
      return {
        allowed: true,
        remaining: Math.max(0, maximum - requests - 1)
      };
    } catch (error) {
      if (error?.code !== 'FIRESTORE_WRITE_CONFLICT' && Number(error?.status) !== 409) throw error;
      row = null;
    }
  }
  const error = new Error('Biometric sign-in protection is temporarily busy. Please try again.');
  error.status = 429;
  error.retryAfter = 5;
  throw error;
}

export async function consumePasskeyAuthenticationOptionAllowance(env, username, request) {
  const sourceKey = await requestSourceKey(request);
  const sourceId = `passkey-source-${(await digestText(sourceKey)).slice(0, 64)}`;
  const sourceAllowance = await consumeWindowAllowance(env, PASSKEY_OPTIONS_COLLECTION, sourceId, {
    windowMs: PASSKEY_OPTIONS_WINDOW_MS,
    maximum: PASSKEY_OPTIONS_PER_SOURCE
  });
  if (!sourceAllowance.allowed) return sourceAllowance;

  const normalizedUsername = clean(username).toLowerCase();
  if (!normalizedUsername) return sourceAllowance;
  const usernameSourceId = `passkey-user-source-${(await digestText(`${normalizedUsername}:${sourceKey}`)).slice(0, 64)}`;
  return consumeWindowAllowance(env, PASSKEY_OPTIONS_COLLECTION, usernameSourceId, {
    windowMs: PASSKEY_OPTIONS_WINDOW_MS,
    maximum: PASSKEY_OPTIONS_PER_USERNAME_SOURCE
  });
}
