import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import { paystackSecretMode } from '../lib/paystack-environment.js';
import { normalizePaystackSecretKey } from '../lib/paystack-connection.js';
import { readJsonBody } from '../lib/request-security.js';
import { requireSetupAdministrator, resolveSetupSettingsAccess } from '../lib/setup-auth.js';
import { signTenantControlRequest } from '../lib/tenant-control-plane.js';

const clean = (value) => String(value ?? '').trim();

function centralEndpoint(env, request) {
  let central;
  try { central = new URL(clean(env.CANONICAL_PORTAL_URL)); } catch (_error) { central = null; }
  const local = new URL(request.url);
  if (!central || central.protocol !== 'https:' || central.origin === local.origin) {
    const error = new Error('Secure payment onboarding is not configured for this tenant.');
    error.status = 503;
    error.code = 'PAYSTACK_ONBOARDING_NOT_CONFIGURED';
    throw error;
  }
  return new URL('/api/tenant-paystack-connection', central.origin);
}

function assertSameOrigin(request) {
  const origin = clean(request.headers.get('Origin'));
  if (origin && origin !== new URL(request.url).origin) {
    const error = new Error('Cross-site payment configuration requests are not allowed.');
    error.status = 403;
    throw error;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request, { maxBytes: 8 * 1024 });
    const actor = await requireSetupAdministrator(env, request, body.password);
    const access = resolveSetupSettingsAccess(actor, body.SettingsScope || body.settingsScope, body.BranchId || body.branchId);
    if (access.scope !== 'organisation') {
      const error = new Error('Only an organisation-wide Super Administrator can connect or replace the Paystack account.');
      error.status = 403;
      throw error;
    }
    const currentMode = paystackSecretMode(env.PAYSTACK_SECRET_KEY);
    const currentConfigured = currentMode !== 'not-configured';
    if (currentConfigured && body.confirmReplacement !== true) {
      const error = new Error('Confirm that you want to replace the connected Paystack account.');
      error.status = 409;
      error.code = 'PAYSTACK_REPLACEMENT_CONFIRMATION_REQUIRED';
      throw error;
    }
    const paystackSecretKey = normalizePaystackSecretKey(body.paystackSecretKey);
    const identity = requiredDeploymentIdentity(env);
    const privateKey = clean(env.TENANT_CONTROL_PLANE_PRIVATE_KEY);
    if (!privateKey) {
      const error = new Error('Secure payment onboarding has not been enabled for this tenant yet. Contact Dynamax support to complete the one-time tenant security upgrade.');
      error.status = 503;
      error.code = 'TENANT_CONTROL_KEY_NOT_CONFIGURED';
      throw error;
    }
    const details = {
      action: 'connect-paystack',
      workspaceId: identity.workspaceId,
      portalHost: new URL(request.url).hostname,
      requestId: crypto.randomUUID(),
      issuedAt: new Date().toISOString(),
      replaceConfirmed: body.confirmReplacement === true,
      paystackSecretKey
    };
    const signature = await signTenantControlRequest(privateKey, details);
    const response = await fetch(centralEndpoint(env, request), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dynamax-Portal': details.portalHost,
        'X-Dynamax-Tenant-Signature': signature
      },
      body: JSON.stringify(details)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const error = new Error(data?.message || 'The Dynamax payment control plane did not accept this request.');
      error.status = response.status || 502;
      error.code = clean(data?.code);
      throw error;
    }
    return Response.json({
      ok: true,
      message: clean(data.message) || 'Paystack connected securely.',
      mode: clean(data.mode),
      connectedAt: clean(data.connectedAt),
      deploymentQueued: data.deploymentQueued === true,
      webhookUrl: clean(data.webhookUrl)
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, code: clean(error.code), message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
