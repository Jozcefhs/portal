import { createDocumentIfAbsent, patchDocumentFields, queryCollection } from '../lib/firestore.js';
import { setPagesProductionSecret, retryLatestPagesProductionDeployment } from '../lib/cloudflare-pages-secrets.js';
import { validatePaystackSecretKey } from '../lib/paystack-connection.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { assertFreshTenantControlRequest, verifyTenantControlRequest } from '../lib/tenant-control-plane.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function portalHost(value) {
  try { return new URL(clean(value)).hostname.toLowerCase(); } catch (_error) { return ''; }
}

function activeRegistration(registration = {}) {
  const states = [registration.Status, registration.SubscriptionStatus, registration.LifecycleStage].map(lower);
  return !states.some((state) => ['rejected', 'cancelled', 'retired', 'terminated', 'deleted'].includes(state));
}

async function tenantRegistration(platformEnv, details) {
  const rows = await queryCollection(platformEnv, 'tenantRegistrations', {
    filters: [{ field: 'WorkspaceId', op: '==', value: clean(details.workspaceId) }],
    limit: 20
  });
  const registration = rows
    .filter(activeRegistration)
    .sort((left, right) => clean(right.UpdatedAt || right.CreatedAt).localeCompare(clean(left.UpdatedAt || left.CreatedAt)))[0];
  if (!registration) {
    const error = new Error('This tenant is not attached to an active Dynamax subscription.');
    error.status = 404;
    error.code = 'TENANT_REGISTRATION_NOT_FOUND';
    throw error;
  }
  const expectedHost = portalHost(registration.PortalUrl);
  if (!expectedHost || expectedHost !== lower(details.portalHost)) {
    const error = new Error('The tenant portal does not match the registered workspace.');
    error.status = 409;
    error.code = 'TENANT_PORTAL_MISMATCH';
    throw error;
  }
  return registration;
}

export async function onRequestPost({ request, env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    const details = await readJsonBody(request, { maxBytes: 8 * 1024 });
    if (lower(details.action) !== 'connect-paystack') {
      const error = new Error('Unsupported tenant payment-control action.');
      error.status = 400;
      throw error;
    }
    assertFreshTenantControlRequest(details);
    const registration = await tenantRegistration(platformEnv, details);
    const signature = clean(request.headers.get('X-Dynamax-Tenant-Signature'));
    if (!await verifyTenantControlRequest(registration.TenantControlPublicKey, details, signature)) {
      const error = new Error('The tenant payment-control signature is invalid.');
      error.status = 401;
      error.code = 'TENANT_CONTROL_SIGNATURE_INVALID';
      throw error;
    }
    if (registration.PaystackConnected === true && details.replaceConfirmed !== true) {
      const error = new Error('Confirm that you want to replace the connected Paystack account.');
      error.status = 409;
      error.code = 'PAYSTACK_REPLACEMENT_CONFIRMATION_REQUIRED';
      throw error;
    }
    const validation = await validatePaystackSecretKey(details.paystackSecretKey);
    const requestRecord = await createDocumentIfAbsent(platformEnv, 'tenantControlRequests', clean(details.requestId), {
      RequestId: clean(details.requestId),
      WorkspaceId: clean(details.workspaceId),
      Action: 'Connect Paystack',
      PaystackMode: validation.mode,
      IssuedAt: clean(details.issuedAt),
      ReceivedAt: new Date().toISOString(),
      ExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
    if (!requestRecord.created) {
      const error = new Error('This payment-control request was already used. Try again.');
      error.status = 409;
      error.code = 'TENANT_CONTROL_REQUEST_REPLAYED';
      throw error;
    }
    const cloudflareProject = clean(registration.CloudflareProject);
    await setPagesProductionSecret(env, cloudflareProject, 'PAYSTACK_SECRET_KEY', details.paystackSecretKey);
    const deployment = await retryLatestPagesProductionDeployment(env, cloudflareProject);
    const connectedAt = new Date().toISOString();
    await patchDocumentFields(platformEnv, 'tenantRegistrations', clean(registration.__id || registration.Reference), {
      PaystackConnected: true,
      PaystackMode: validation.mode,
      PaystackConnectedAt: connectedAt,
      PaystackConnectedBy: 'Tenant Super Administrator',
      PaystackDeploymentQueued: deployment.queued === true,
      UpdatedAt: connectedAt
    });
    const webhookUrl = new URL('/api/paystack-webhook', clean(registration.PortalUrl)).href;
    return Response.json({
      ok: true,
      message: deployment.queued
        ? `Paystack ${validation.mode} mode was connected securely. The tenant deployment is updating now.`
        : `Paystack ${validation.mode} mode was connected securely.`,
      mode: validation.mode,
      connectedAt,
      deploymentQueued: deployment.queued,
      webhookUrl
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, code: clean(error.code), message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
