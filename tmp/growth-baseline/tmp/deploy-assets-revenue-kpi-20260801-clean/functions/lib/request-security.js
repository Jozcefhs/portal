import {
  createDocumentIfAbsent,
  deleteDocumentIfCurrent,
  getDocument,
  patchDocumentFieldsIfCurrent
} from './firestore.js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const IDEMPOTENCY_COLLECTION = 'requestIdempotency';
const REQUEST_ALLOWANCE_COLLECTION = 'requestRateLimits';
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const DEFAULT_IDEMPOTENCY_LEASE_SECONDS = 5 * 60;
const MIN_IDEMPOTENCY_LEASE_SECONDS = 30;
const MAX_IDEMPOTENCY_LEASE_SECONDS = 15 * 60;

function clean(value) {
  return String(value ?? '').trim();
}

function safeScope(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'request';
}

function base64Url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return base64Url(digest);
}

export async function consumeRequestAllowance(env, request, options = {}) {
  const scope = safeScope(options.scope || 'public');
  const maximum = Math.max(1, Math.min(1000, Number(options.maximum || 20)));
  const windowSeconds = Math.max(60, Math.min(24 * 60 * 60, Number(options.windowSeconds || 15 * 60)));
  const source = clean(request.headers.get('CF-Connecting-IP'))
    || clean(request.headers.get('X-Forwarded-For')).split(',')[0].trim()
    || `${clean(request.headers.get('User-Agent')).slice(0, 240)}|${clean(request.headers.get('Accept-Language')).slice(0, 80)}`
    || 'unknown';
  const documentId = `${scope}-${(await sha256(`${scope}:${source}`)).slice(0, 64)}`;
  const now = Date.now();
  let current = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!current) current = await getDocument(env, REQUEST_ALLOWANCE_COLLECTION, documentId).catch(() => null);
    const windowStarted = timestampMilliseconds(current?.WindowStartedAt);
    const insideWindow = Boolean(windowStarted && now - windowStarted < windowSeconds * 1000);
    const requests = insideWindow ? Math.max(0, Number(current?.Requests || 0)) : 0;
    if (requests >= maximum) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil(((windowStarted + (windowSeconds * 1000)) - now) / 1000))
      };
    }
    const updatedAt = new Date(now).toISOString();
    const payload = {
      Scope: scope,
      Requests: requests + 1,
      WindowStartedAt: insideWindow ? clean(current?.WindowStartedAt) : updatedAt,
      UpdatedAt: updatedAt,
      ExpiresAt: new Date(now + (windowSeconds * 2000)).toISOString()
    };
    try {
      if (current?.__updateTime) {
        await patchDocumentFieldsIfCurrent(env, REQUEST_ALLOWANCE_COLLECTION, documentId, payload, current);
      } else {
        const created = await createDocumentIfAbsent(env, REQUEST_ALLOWANCE_COLLECTION, documentId, payload);
        if (!created.created) {
          current = created.document || null;
          continue;
        }
      }
      return { allowed: true, remaining: Math.max(0, maximum - requests - 1) };
    } catch (error) {
      if (Number(error?.status) !== 409 && error?.code !== 'FIRESTORE_WRITE_CONFLICT') throw error;
      current = null;
    }
  }
  throw httpError('Request protection is temporarily busy. Please try again.', 429, 'RATE_LIMIT_BUSY');
}

export async function secureSecretEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([sha256(clean(left)), sha256(clean(right))]);
  let difference = leftHash.length ^ rightHash.length;
  const length = Math.max(leftHash.length, rightHash.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftHash.charCodeAt(index) || 0) ^ (rightHash.charCodeAt(index) || 0);
  }
  return difference === 0 && Boolean(clean(left)) && Boolean(clean(right));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (!['turnstileToken', 'approvalPassword'].includes(key)) {
      result[key] = stableValue(value[key]);
    }
    return result;
  }, {});
}

function publicReplayPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 90000) {
    return {
      ok: Boolean(value.ok),
      message: clean(value.message) || 'The request was already completed.',
      reference: clean(value.reference || value.applicationReference || value.paymentReference)
    };
  }
  return value;
}

function httpError(message, status, code = '') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function boundedLeaseMilliseconds(options = {}) {
  const requestedSeconds = options.leaseSeconds === undefined
    ? Number(options.leaseMinutes || 0) * 60
    : Number(options.leaseSeconds);
  const seconds = Number.isFinite(requestedSeconds) && requestedSeconds > 0
    ? requestedSeconds
    : DEFAULT_IDEMPOTENCY_LEASE_SECONDS;
  return Math.round(Math.min(MAX_IDEMPOTENCY_LEASE_SECONDS, Math.max(MIN_IDEMPOTENCY_LEASE_SECONDS, seconds)) * 1000);
}

function timestampMilliseconds(value) {
  const parsed = new Date(clean(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function claimGuard(existing, fallback = {}) {
  return {
    enabled: true,
    owner: true,
    documentId: fallback.documentId,
    fingerprint: fallback.fingerprint,
    scope: clean(existing.Scope || fallback.scope),
    actor: clean(existing.Actor || fallback.actor),
    keyHash: clean(existing.KeyHash || fallback.keyHash),
    leaseId: clean(existing.LeaseId || fallback.leaseId),
    leaseExpiresAt: clean(existing.LeaseExpiresAt || fallback.leaseExpiresAt),
    attempt: Math.max(1, Number(existing.Attempt || fallback.attempt || 1)),
    createdAt: clean(existing.CreatedAt || fallback.createdAt),
    expiresAt: clean(existing.ExpiresAt || fallback.expiresAt)
  };
}

function claimOwnershipError() {
  return httpError(
    'This request is no longer owned by the current worker. Its outcome must be read from the idempotency record.',
    409,
    'IDEMPOTENCY_OWNERSHIP_LOST'
  );
}

async function currentOwnedClaim(env, guard) {
  const current = await getDocument(env, IDEMPOTENCY_COLLECTION, guard.documentId);
  if (!current) throw claimOwnershipError();
  if (clean(current.Fingerprint) && clean(current.Fingerprint) !== clean(guard.fingerprint)) {
    throw claimOwnershipError();
  }
  if (!clean(guard.leaseId) || clean(current.LeaseId) !== clean(guard.leaseId)) {
    throw claimOwnershipError();
  }
  return current;
}

export async function readJsonBody(request, options = {}) {
  const maxBytes = Math.max(1024, Number(options.maxBytes || 1024 * 1024));
  const lengthHeader = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(lengthHeader) && lengthHeader > maxBytes) {
    throw httpError(`Request body exceeds the ${Math.ceil(maxBytes / 1024)} KB limit.`, 413, 'REQUEST_TOO_LARGE');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw httpError(`Request body exceeds the ${Math.ceil(maxBytes / 1024)} KB limit.`, 413, 'REQUEST_TOO_LARGE');
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError('The request body is not valid JSON.', 400, 'INVALID_JSON');
  }
}

export function idempotencyKeyFrom(request, body = {}) {
  return clean(
    request.headers.get('Idempotency-Key')
      || body.idempotencyKey
      || body.IdempotencyKey
      || ''
  );
}

export async function beginIdempotentRequest(env, request, body, options = {}) {
  const key = idempotencyKeyFrom(request, body);
  if (!key) return { enabled: false };
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw httpError('The idempotency key is invalid.', 400, 'INVALID_IDEMPOTENCY_KEY');
  }

  const scope = safeScope(options.scope);
  const actor = clean(options.actor).toLowerCase().slice(0, 160);
  const fingerprintSource = options.fingerprintPayload === undefined ? body : options.fingerprintPayload;
  const fingerprint = await sha256(JSON.stringify(stableValue(fingerprintSource || {})));
  const documentId = `${scope}-${(await sha256(`${scope}:${actor}:${key}`)).slice(0, 64)}`;
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + Math.max(5, Number(options.ttlMinutes || 1440)) * 60000).toISOString();
  const leaseMilliseconds = boundedLeaseMilliseconds(options);
  const leaseId = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseMilliseconds).toISOString();
  const initial = {
    Scope: scope,
    Actor: actor,
    KeyHash: await sha256(key),
    Fingerprint: fingerprint,
    Status: 'Processing',
    LeaseId: leaseId,
    LeaseExpiresAt: leaseExpiresAt,
    Attempt: 1,
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
    ExpiresAt: expiresAt
  };
  const claimed = await createDocumentIfAbsent(env, IDEMPOTENCY_COLLECTION, documentId, initial);
  if (claimed.created) {
    return claimGuard(claimed.document || initial, {
      documentId,
      fingerprint,
      scope,
      actor,
      keyHash: initial.KeyHash,
      leaseId,
      leaseExpiresAt,
      attempt: 1,
      createdAt,
      expiresAt
    });
  }

  const existing = claimed.document || {};
  if (clean(existing.Fingerprint) && clean(existing.Fingerprint) !== fingerprint) {
    throw httpError('This idempotency key was already used for a different request.', 409, 'IDEMPOTENCY_CONFLICT');
  }
  if (clean(existing.Status).toLowerCase() === 'completed') {
    return {
      enabled: true,
      owner: false,
      replay: true,
      documentId,
      response: existing.Response && typeof existing.Response === 'object'
        ? existing.Response
        : { ok: true, message: 'The request was already completed.' }
    };
  }
  if (clean(existing.Status).toLowerCase() === 'failed') {
    return {
      enabled: true,
      owner: false,
      replay: true,
      documentId,
      status: Number(existing.HttpStatus || 409),
      response: existing.Response && typeof existing.Response === 'object'
        ? existing.Response
        : { ok: false, message: 'The earlier request failed. Use a new idempotency key to retry.' }
    };
  }
  if (['uncertain', 'unknown'].includes(clean(existing.Status).toLowerCase())) {
    return {
      enabled: true,
      owner: false,
      replay: true,
      uncertain: true,
      documentId,
      status: Number(existing.HttpStatus || 503),
      response: existing.Response && typeof existing.Response === 'object'
        ? existing.Response
        : {
            ok: false,
            code: 'IDEMPOTENCY_OUTCOME_UNCERTAIN',
            outcomeUncertain: true,
            message: 'The earlier request may have reached an external service. Automatic retry is suppressed to avoid a duplicate.'
          }
    };
  }

  if (clean(existing.Status).toLowerCase() !== 'processing') {
    throw httpError('This idempotency key is locked by an unresolved request.', 409, 'IDEMPOTENCY_LOCKED');
  }

  const fallbackLeaseStart = timestampMilliseconds(existing.UpdatedAt || existing.CreatedAt);
  const storedLeaseExpiry = timestampMilliseconds(existing.LeaseExpiresAt);
  const maximumStoredLeaseExpiry = fallbackLeaseStart
    ? fallbackLeaseStart + (MAX_IDEMPOTENCY_LEASE_SECONDS * 1000)
    : storedLeaseExpiry;
  const leaseExpiry = storedLeaseExpiry
    ? Math.min(storedLeaseExpiry, maximumStoredLeaseExpiry)
    : fallbackLeaseStart + leaseMilliseconds;
  if (leaseExpiry > now.getTime()) {
    throw httpError('An identical request is already being processed.', 409, 'IDEMPOTENCY_IN_PROGRESS');
  }

  const reclaimedAt = now.toISOString();
  const reclaimedLeaseId = crypto.randomUUID();
  const reclaimedLeaseExpiresAt = new Date(now.getTime() + leaseMilliseconds).toISOString();
  const attempt = Math.min(1000000, Math.max(1, Number(existing.Attempt || 1)) + 1);
  let reclaimed;
  try {
    reclaimed = await patchDocumentFieldsIfCurrent(env, IDEMPOTENCY_COLLECTION, documentId, {
      Status: 'Processing',
      LeaseId: reclaimedLeaseId,
      LeaseExpiresAt: reclaimedLeaseExpiresAt,
      Attempt: attempt,
      ReclaimedAt: reclaimedAt,
      UpdatedAt: reclaimedAt
    }, existing);
  } catch (error) {
    if (Number(error?.status) === 409) {
      throw httpError('An identical request is already being processed.', 409, 'IDEMPOTENCY_IN_PROGRESS');
    }
    throw error;
  }
  return claimGuard(reclaimed || existing, {
    documentId,
    fingerprint,
    scope,
    actor,
    keyHash: clean(existing.KeyHash || initial.KeyHash),
    leaseId: reclaimedLeaseId,
    leaseExpiresAt: reclaimedLeaseExpiresAt,
    attempt,
    createdAt: clean(existing.CreatedAt || createdAt),
    expiresAt: clean(existing.ExpiresAt || expiresAt)
  });
}

export async function completeIdempotentRequest(env, guard, response, status = 200) {
  if (!guard?.enabled || !guard.owner) return;
  const current = await currentOwnedClaim(env, guard);
  if (clean(current.Status).toLowerCase() === 'completed') return;
  if (clean(current.Status).toLowerCase() !== 'processing') throw claimOwnershipError();
  const now = new Date().toISOString();
  await patchDocumentFieldsIfCurrent(env, IDEMPOTENCY_COLLECTION, guard.documentId, {
    Status: 'Completed',
    HttpStatus: Number(status || 200),
    Response: publicReplayPayload(response),
    UpdatedAt: now,
    CompletedAt: now
  }, current);
}

export async function failIdempotentRequest(env, guard, error) {
  if (!guard?.enabled || !guard.owner) return;
  try {
    const current = await currentOwnedClaim(env, guard);
    if (clean(current.Status).toLowerCase() !== 'processing') return;
    const now = new Date().toISOString();
    const requestedStatus = Number(error?.status || 500);
    const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : 500;
    const uncertain = status >= 500 || error?.retryable === true || error?.outcomeUncertain === true;
    await patchDocumentFieldsIfCurrent(env, IDEMPOTENCY_COLLECTION, guard.documentId, uncertain
      ? {
          Status: 'Uncertain',
          HttpStatus: status >= 500 ? status : 503,
          Response: {
            ok: false,
            code: 'IDEMPOTENCY_OUTCOME_UNCERTAIN',
            outcomeUncertain: true,
            message: 'The request outcome is uncertain. Automatic retry with this key is suppressed to avoid a duplicate.'
          },
          OutcomeUncertain: true,
          UncertaintyReason: clean(error?.uncertaintyReason || error?.message).slice(0, 500),
          UpdatedAt: now,
          UncertainAt: now
        }
      : {
          Status: 'Failed',
          HttpStatus: status,
          Response: {
            ok: false,
            message: clean(error?.message)
          },
          UpdatedAt: now,
          FailedAt: now
        }, current);
  } catch {
    // Best effort only: never let idempotency bookkeeping replace the original request error.
  }
}

export async function releaseIdempotentRequest(env, guard) {
  if (!guard?.enabled || !guard.owner) return false;
  try {
    const current = await currentOwnedClaim(env, guard);
    if (clean(current.Status).toLowerCase() !== 'processing') return false;
    await deleteDocumentIfCurrent(env, IDEMPOTENCY_COLLECTION, guard.documentId, current);
    return true;
  } catch {
    return false;
  }
}

export async function verifyTurnstile(env, request, body = {}, expectedAction = '') {
  const secret = clean(env.TURNSTILE_SECRET_KEY);
  const siteKey = clean(env.TURNSTILE_SITE_KEY);
  if (!secret && !siteKey) return { configured: false, success: true };
  if (!secret || !siteKey) {
    throw httpError('Human verification is not fully configured. Add both Turnstile keys.', 503, 'TURNSTILE_NOT_CONFIGURED');
  }

  const token = clean(body.turnstileToken || body.TurnstileToken);
  if (!token || token.length > 2048) {
    throw httpError('Complete the security check and try again.', 403, 'TURNSTILE_REQUIRED');
  }
  const form = new URLSearchParams({
    secret,
    response: token,
    idempotency_key: crypto.randomUUID()
  });
  const remoteIp = clean(request.headers.get('CF-Connecting-IP'));
  if (remoteIp) form.set('remoteip', remoteIp);

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) {
    throw httpError('The security check could not be verified. Please try again.', 403, 'TURNSTILE_FAILED');
  }

  const wantedAction = clean(expectedAction);
  if (wantedAction && clean(result.action) !== wantedAction) {
    throw httpError('The security check did not match this action.', 403, 'TURNSTILE_ACTION_MISMATCH');
  }
  const allowedHostnames = clean(env.TURNSTILE_ALLOWED_HOSTNAMES)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowedHostnames.length && !allowedHostnames.includes(clean(result.hostname).toLowerCase())) {
    throw httpError('The security check came from an untrusted hostname.', 403, 'TURNSTILE_HOSTNAME_MISMATCH');
  }
  return result;
}

export function tooManyRequests(message = 'Too many requests. Please wait and try again.', retryAfter = 10) {
  return Response.json({ ok: false, message }, {
    status: 429,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': String(Math.max(1, Number(retryAfter || 10)))
    }
  });
}
