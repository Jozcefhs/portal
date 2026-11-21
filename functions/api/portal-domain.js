import { getDocument } from '../lib/firestore.js';
import { paystackCredentialFingerprint } from '../lib/paystack-environment.js';
import { readJsonBody } from '../lib/request-security.js';
import { requireSetupAdministrator, resolveSetupSettingsAccess } from '../lib/setup-auth.js';
import { signTenantControlRequest } from '../lib/tenant-control-plane.js';
import { customPortalHostname, domainError, paymentReferenceId } from '../lib/tenant-custom-domain.js';

async function managePortalDomain(env, request) {
  const url = new URL(request.url);
  if (request.headers.get('Origin') !== url.origin) throw domainError('Open domain setup directly in the portal.', 403);
  const body = await readJsonBody(request, { maxBytes: 256 * 1024 });
  if (!['status', 'attach', 'activate', 'verify', 'review', 'import', 'prepare'].includes(body.action)) throw domainError('Unknown domain setup action.');
  const actor = await requireSetupAdministrator(env, request, body.password).catch(error => {
    if (error.status === 503 && !String(env.ADMIN_WEB_PASSWORD || '').trim()) {
      throw domainError('Sign in as a Super Administrator to manage the portal address.', 401);
    }
    throw error;
  });
  if (resolveSetupSettingsAccess(actor).scope !== 'organisation' || actor.assignedBranchIds?.length
      || !['', 'all'].includes(String(actor.schoolSectionAccess || '').toLowerCase())) {
    throw domainError('Custom domains require an organisation-wide Super Administrator.', 403);
  }
  const workspaceId = String(env.DYNAMAX_WORKSPACE_ID || '').trim().toLowerCase();
  if (!workspaceId || !env.TENANT_CONTROL_PLANE_PRIVATE_KEY || !env.CANONICAL_PORTAL_URL) {
    throw domainError('Custom domain setup is not enabled for this deployment.', 503);
  }
  const original = env.PUBLIC_PORTAL_URL ? new URL(env.PUBLIC_PORTAL_URL) : null;
  const central = new URL('/api/tenant-custom-domain', env.CANONICAL_PORTAL_URL);
  if (central.protocol !== 'https:' || central.origin === url.origin || (original && (original.protocol !== 'https:'
      || !/^[a-z0-9-]+\.pages\.dev$/.test(original.hostname)))) throw domainError('The domain control plane is unavailable.', 503);
  const details = {
    action: 'domain-' + body.action, workspaceId,
    portalHost: original?.hostname || '', observedOrigin: url.origin,
    requestId: crypto.randomUUID(), issuedAt: new Date().toISOString()
  };
  if (body.action === 'attach' || body.action === 'verify') {
    details.domainKind = body.domainKind ?? 'subdomain';
    if (!['root', 'subdomain'].includes(details.domainKind)) throw domainError('Choose Root domain or Subdomain.');
    details.hostname = customPortalHostname(body.hostname, details.domainKind);
  }
  if (body.action === 'import') details.zoneFile = String(body.zoneFile || '');
  if (body.action === 'activate') {
    if (actor.source !== 'staff-session') throw domainError('Sign in to the staff portal on the custom address first.', 403);
    if (url.protocol !== 'https:' || url.origin !== 'https://' + customPortalHostname(url.hostname, 'either')) {
      throw domainError('Open the verified custom address to make it primary.', 409);
    }
    details.paymentCheck = 'not-configured';
    if (env.PAYSTACK_SECRET_KEY) {
      const reference = paymentReferenceId(body.paymentReference);
      const intent = await getDocument(env, 'paymentIntents', reference);
      const verifiedAt = Date.parse(intent?.PortalReturnVerifiedAt);
      if (intent?.Reference !== reference || intent.Status !== 'Completed'
          || intent.PortalCheckoutOrigin !== url.origin || intent.PortalReturnVerifiedOrigin !== url.origin
          || intent.PortalPaymentCredential !== await paystackCredentialFingerprint(env.PAYSTACK_SECRET_KEY)
          || !Number.isFinite(verifiedAt) || verifiedAt > Date.now() || Date.now() - verifiedAt > 86400000) {
        throw domainError('Use a payment completed and verified on this address in the last 24 hours.', 409);
      }
      details.paymentCheck = 'checkout-verified';
    }
  }
  const signature = await signTenantControlRequest(env.TENANT_CONTROL_PLANE_PRIVATE_KEY, details);
  const response = await fetch(central, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', 'X-Dynamax-Tenant-Signature': signature },
    body: JSON.stringify(details)
  }).catch(() => { throw domainError('The Dynamax domain service could not be reached. Check status again shortly.', 502); });
  if (response.status >= 300 && response.status < 400) {
    throw domainError('The Dynamax domain service redirected the setup request. Ask support to check the configured service address.', 502);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw domainError(result?.message || 'Dynamax could not confirm the domain.', response.ok ? 502 : response.status);
  return { ...result, paymentRequired: result.paymentRequired || Boolean(env.PAYSTACK_SECRET_KEY) };
}

export async function onRequestPost({ env, request }) {
  try {
    return Response.json(await managePortalDomain(env, request), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.status ? error.message : 'Domain setup could not be completed. Try again.' },
      { status: error.status || 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
