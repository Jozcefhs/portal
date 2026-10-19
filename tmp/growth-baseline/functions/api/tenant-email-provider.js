import { createDocumentIfAbsent } from '../lib/firestore.js';
import { createGoogleOAuthStart } from '../lib/google-email-oauth.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { assertFreshTenantControlRequest, verifyTenantControlRequest } from '../lib/tenant-control-plane.js';
import {
  findTenantEmailControlRegistration,
  stageBrevoEmailProviderTransition
} from '../lib/tenant-email-provider.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const OAUTH_STATE_COLLECTION = 'tenantEmailOAuthStates';

async function requireSignedTenantRequest(platformEnv, request, details) {
  assertFreshTenantControlRequest(details);
  const registration = await findTenantEmailControlRegistration(platformEnv, details);
  const signature = clean(request.headers.get('X-Dynamax-Tenant-Signature'));
  if (!await verifyTenantControlRequest(registration.TenantControlPublicKey, details, signature)) {
    const error = new Error('The tenant email-control signature is invalid.');
    error.status = 401;
    error.code = 'TENANT_CONTROL_SIGNATURE_INVALID';
    throw error;
  }
  const requestRecord = await createDocumentIfAbsent(platformEnv, 'tenantControlRequests', clean(details.requestId), {
    RequestId: clean(details.requestId),
    WorkspaceId: clean(details.workspaceId),
    Action: clean(details.action),
    IssuedAt: clean(details.issuedAt),
    ReceivedAt: new Date().toISOString(),
    ExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  });
  if (!requestRecord.created) {
    const error = new Error('This email-control request was already used. Try again.');
    error.status = 409;
    error.code = 'TENANT_CONTROL_REQUEST_REPLAYED';
    throw error;
  }
  return registration;
}

async function startGoogleEmailConnection(platformEnv, request, env, details, registration) {
  const oauth = await createGoogleOAuthStart(env, request.url);
  const registrationId = clean(registration.__id || registration.Reference || registration.Id);
  const stateRecord = await createDocumentIfAbsent(platformEnv, OAUTH_STATE_COLLECTION, oauth.stateHash, {
    StateHash: oauth.stateHash,
    Status: 'Pending',
    RequestId: clean(details.requestId),
    WorkspaceId: clean(details.workspaceId),
    PortalHost: clean(details.portalHost).toLowerCase(),
    CloudflareProject: clean(registration.CloudflareProject),
    RegistrationCollection: clean(registration.__controlCollection || 'tenantRegistrations'),
    RegistrationId: registrationId,
    ReturnOrigin: new URL(clean(registration.PortalUrl)).origin,
    RedirectUri: oauth.redirectUri,
    CodeVerifierCiphertext: oauth.codeVerifierCiphertext,
    CodeVerifierIv: oauth.codeVerifierIv,
    CreatedAt: oauth.createdAt,
    ExpiresAt: oauth.expiresAt
  });
  if (!stateRecord.created) {
    const error = new Error('Could not create a unique Google connection request. Try again.');
    error.status = 409;
    error.code = 'GOOGLE_EMAIL_OAUTH_STATE_COLLISION';
    throw error;
  }
  return Response.json({
    ok: true,
    authorizationUrl: oauth.authorizationUrl,
    expiresAt: oauth.expiresAt,
    message: 'Continue to Google and approve send-only email access. This request expires in nine minutes.'
  }, { headers: { 'Cache-Control': 'no-store' } });
}

async function useBrevo(platformEnv, env, details, registration) {
  const transition = await stageBrevoEmailProviderTransition(platformEnv, env, details, registration);
  return Response.json({
    ok: true,
    provider: 'brevo',
    deploymentQueued: true,
    stagingUnconfirmed: transition.stagingUnconfirmed === true,
    message: transition.stagingUnconfirmed === true
      ? 'Brevo setup is pending secure deployment verification. Wait a few minutes, then reload Settings; do not select it again yet.'
      : 'Brevo was selected and its verified tenant deployment is queued. Dynamax will remove the Gmail credential from the deployed tenant; revoke the former Google account grant manually after the switch is live if desired.'
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    const details = await readJsonBody(request, { maxBytes: 16 * 1024 });
    const action = lower(details.action);
    if (!['start-google-email', 'use-brevo'].includes(action)) {
      const error = new Error('Unsupported tenant email-control action.');
      error.status = 400;
      throw error;
    }
    const registration = await requireSignedTenantRequest(platformEnv, request, details);
    if (action === 'start-google-email') {
      return await startGoogleEmailConnection(platformEnv, request, env, details, registration);
    }
    return await useBrevo(platformEnv, env, details, registration);
  } catch (error) {
    return Response.json({ ok: false, code: clean(error.code), message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
