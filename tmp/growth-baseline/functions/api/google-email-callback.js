import { getDocument, patchDocumentFields, patchDocumentFieldsIfCurrent } from '../lib/firestore.js';
import {
  exchangeGoogleAuthorizationCode,
  fetchVerifiedGoogleEmail,
  googleOAuthCredentials,
  revokeGoogleRefreshToken,
  sha256Base64Url,
  unprotectPkceVerifier
} from '../lib/google-email-oauth.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import {
  assertTenantEmailProjectAssignment,
  loadStoredTenantEmailRegistration,
  stageGoogleEmailProviderTransition
} from '../lib/tenant-email-provider.js';

const OAUTH_STATE_COLLECTION = 'tenantEmailOAuthStates';
const clean = (value) => String(value ?? '').trim();

function safeCode(error, fallback = 'GOOGLE_EMAIL_CONNECTION_FAILED') {
  const code = clean(error?.code || fallback).toUpperCase();
  return /^[A-Z0-9_]{3,80}$/.test(code) ? code : fallback;
}

export function shouldRevokeIssuedGoogleToken(refreshToken, retained, error = {}) {
  return Boolean(clean(refreshToken) && retained !== true && error?.refreshTokenHandled !== true);
}

function safeReturnOrigin(record, request, env) {
  const candidates = [record?.ReturnOrigin, env.CANONICAL_PORTAL_URL, request.url];
  for (const candidate of candidates) {
    try {
      const url = new URL(clean(candidate));
      if (url.protocol !== 'https:') continue;
      if (record?.PortalHost && url.hostname.toLowerCase() !== clean(record.PortalHost).toLowerCase()) continue;
      return url.origin;
    } catch (_error) {
      // Try the next trusted candidate.
    }
  }
  return new URL(request.url).origin;
}

function setupRedirect(record, request, env, status, message) {
  const target = new URL('/setup.html', safeReturnOrigin(record, request, env));
  target.searchParams.set('emailConnection', status === 'connected' ? 'connected' : 'error');
  target.searchParams.set('emailMessage', clean(message).slice(0, 180));
  return Response.redirect(target.href, 303);
}

async function markStateFailed(platformEnv, stateHash, code) {
  const now = new Date().toISOString();
  await patchDocumentFields(platformEnv, OAUTH_STATE_COLLECTION, stateHash, {
    Status: 'Failed',
    FailureCode: safeCode({ code }),
    CodeVerifierCiphertext: '',
    CodeVerifierIv: '',
    UpdatedAt: now,
    FailedAt: now
  });
}

async function markStateConnected(platformEnv, stateHash, connectedAt) {
  await patchDocumentFields(platformEnv, OAUTH_STATE_COLLECTION, stateHash, {
    Status: 'Connected',
    CodeVerifierCiphertext: '',
    CodeVerifierIv: '',
    UpdatedAt: connectedAt,
    CompletedAt: connectedAt
  });
}

async function markStatePending(platformEnv, stateHash, code) {
  const now = new Date().toISOString();
  await patchDocumentFields(platformEnv, OAUTH_STATE_COLLECTION, stateHash, {
    Status: 'StagingUnconfirmed',
    FailureCode: safeCode({ code }),
    CodeVerifierCiphertext: '',
    CodeVerifierIv: '',
    UpdatedAt: now
  });
}

async function claimOAuthState(platformEnv, stateHash, nowMs = Date.now()) {
  const record = await getDocument(platformEnv, OAUTH_STATE_COLLECTION, stateHash);
  if (!record) {
    const error = new Error('This Google connection request was not found.');
    error.status = 404;
    error.code = 'GOOGLE_EMAIL_OAUTH_STATE_NOT_FOUND';
    throw error;
  }
  if (clean(record.Status).toLowerCase() !== 'pending') {
    const error = new Error('This Google connection request was already used.');
    error.status = 409;
    error.code = 'GOOGLE_EMAIL_OAUTH_STATE_REPLAYED';
    error.oauthRecord = record;
    throw error;
  }
  const expiresAt = Date.parse(clean(record.ExpiresAt));
  const createdAt = Date.parse(clean(record.CreatedAt));
  if (!Number.isFinite(expiresAt) || !Number.isFinite(createdAt)
      || expiresAt <= nowMs || expiresAt - createdAt > 10 * 60 * 1000) {
    const error = new Error('This Google connection request expired.');
    error.status = 409;
    error.code = 'GOOGLE_EMAIL_OAUTH_STATE_EXPIRED';
    error.oauthRecord = record;
    throw error;
  }
  const usedAt = new Date(nowMs).toISOString();
  try {
    await patchDocumentFieldsIfCurrent(platformEnv, OAUTH_STATE_COLLECTION, stateHash, {
      Status: 'Processing',
      UsedAt: usedAt,
      UpdatedAt: usedAt
    }, record);
  } catch (cause) {
    const error = new Error('This Google connection request was already used.');
    error.status = 409;
    error.code = 'GOOGLE_EMAIL_OAUTH_STATE_REPLAYED';
    error.oauthRecord = record;
    error.cause = cause;
    throw error;
  }
  return record;
}

export async function onRequestGet({ request, env }) {
  let platformEnv;
  let stateHash = '';
  let record = null;
  let claimed = false;
  let issuedRefreshToken = '';
  let refreshTokenRetained = false;
  try {
    platformEnv = requirePlatformFirestoreEnv(env);
    const url = new URL(request.url);
    const state = clean(url.searchParams.get('state'));
    if (!/^[A-Za-z0-9_-]{43,160}$/.test(state)) {
      const error = new Error('The Google connection response is missing its security state.');
      error.status = 400;
      error.code = 'GOOGLE_EMAIL_OAUTH_STATE_INVALID';
      throw error;
    }
    stateHash = await sha256Base64Url(state);
    record = await claimOAuthState(platformEnv, stateHash);
    claimed = true;
    if (clean(url.searchParams.get('error'))) {
      const error = new Error('Google email access was not approved.');
      error.status = 409;
      error.code = 'GOOGLE_EMAIL_OAUTH_ACCESS_DENIED';
      throw error;
    }
    const code = clean(url.searchParams.get('code'));
    if (!code) {
      const error = new Error('Google did not return an authorization code.');
      error.status = 400;
      error.code = 'GOOGLE_EMAIL_OAUTH_RESPONSE_INVALID';
      throw error;
    }
    const registration = await loadStoredTenantEmailRegistration(
      platformEnv,
      record.RegistrationCollection,
      record.RegistrationId
    );
    if (clean(registration.CloudflareProject) !== clean(record.CloudflareProject)
        || clean(registration.WorkspaceId).toLowerCase() !== clean(record.WorkspaceId).toLowerCase()) {
      const error = new Error('The tenant assignment changed while Google access was being approved.');
      error.status = 409;
      error.code = 'GOOGLE_EMAIL_OAUTH_TENANT_CHANGED';
      throw error;
    }
    await assertTenantEmailProjectAssignment(platformEnv, registration);
    const { clientId, clientSecret } = googleOAuthCredentials(env);
    const verifier = await unprotectPkceVerifier(
      clientSecret,
      stateHash,
      record.CodeVerifierCiphertext,
      record.CodeVerifierIv
    );
    const tokens = await exchangeGoogleAuthorizationCode(env, {
      code,
      codeVerifier: verifier,
      redirectUri: clean(record.RedirectUri)
    });
    issuedRefreshToken = clean(tokens.refreshToken);
    const connectedEmail = await fetchVerifiedGoogleEmail(tokens.accessToken);
    const transition = await stageGoogleEmailProviderTransition(platformEnv, env, registration, {
      clientId,
      clientSecret,
      refreshToken: tokens.refreshToken,
      connectedEmail
    }, {
      markConnected: (connectedAt) => markStateConnected(platformEnv, stateHash, connectedAt),
      markFailed: (failureCode) => markStateFailed(platformEnv, stateHash, failureCode),
      markPending: (pendingCode) => markStatePending(platformEnv, stateHash, pendingCode)
    });
    refreshTokenRetained = true;
    return setupRedirect(
      record,
      request,
      env,
      'connected',
      transition.stagingUnconfirmed === true
        ? 'Google email setup is pending secure deployment verification. Wait a few minutes and reload Settings; if it remains pending, reconnect or contact Dynamax support.'
        : 'Google email connected. The secure tenant deployment is now queued.'
    );
  } catch (error) {
    if (shouldRevokeIssuedGoogleToken(issuedRefreshToken, refreshTokenRetained, error)) {
      await revokeGoogleRefreshToken(issuedRefreshToken).catch(() => null);
    }
    if (!record && error?.oauthRecord) record = error.oauthRecord;
    if (platformEnv && stateHash && record && claimed && error?.failureStatePersisted !== true) {
      await markStateFailed(platformEnv, stateHash, safeCode(error)).catch(() => null);
    }
    return setupRedirect(
      record,
      request,
      env,
      'error',
      error?.code === 'GOOGLE_EMAIL_OAUTH_ACCESS_DENIED'
        ? 'Google email access was not approved. No provider change was made.'
        : 'Google email could not be connected. Start a new connection and try again.'
    );
  }
}
