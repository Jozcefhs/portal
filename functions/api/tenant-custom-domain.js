import { patchDocumentFieldsIfCurrent, queryCollection } from '../lib/firestore.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { assertFreshTenantControlRequest, verifyTenantControlRequest } from '../lib/tenant-control-plane.js';
import { assertTenantProjectAssignment } from '../lib/tenant-project-pool.js';
import { customPortalHostname, domainError, domainSetupState, pagesDomain, readRootPortalZone } from '../lib/tenant-custom-domain.js';

const actions = ['domain-status', 'domain-attach', 'domain-activate'];
const collection = 'tenantRegistrations';

async function manageDomain(env, request) {
  const platform = requirePlatformFirestoreEnv(env);
  const details = await readJsonBody(request, { maxBytes: 4096 });
  if (!actions.includes(details.action)) throw domainError('Unknown domain setup action.');
  assertFreshTenantControlRequest(details);
  const signature = request.headers.get('X-Dynamax-Tenant-Signature');
  if (!signature) throw domainError('Missing tenant request signature.', 401);
  const rows = await queryCollection(platform, collection, {
    filters: [{ field: 'WorkspaceId', op: '==', value: details.workspaceId }], limit: 20
  });
  const candidates = rows.filter(row => row.PortalUrl === 'https://' + details.portalHost
    && row.AdminActivatedAt && ![row.Status, row.SubscriptionStatus, row.LifecycleStage].some(value =>
      /retired|terminat|cancel|reject|delet|expired/i.test(String(value || ''))));
  if (candidates.length !== 1) throw domainError('An active, assigned subscriber workspace is required.', 403);
  const registration = candidates[0];
  if (!await verifyTenantControlRequest(registration.TenantControlPublicKey, details, signature)) {
    throw domainError('Invalid tenant request signature.', 401);
  }
  const project = registration.CloudflareProject;
  if (registration.PortalUrl !== 'https://' + project + '.pages.dev') throw domainError('The assigned project does not match the portal.', 409);
  const id = registration.__id || registration.Reference;
  await assertTenantProjectAssignment(platform, project, {
    registrationReference: registration.Reference || id, workspaceId: details.workspaceId
  });

  let hostname = registration.CustomPortalHostname || '';
  let domainKind = registration.CustomPortalDomainKind || 'subdomain';
  if (details.action === 'domain-attach') {
    const kind = details.domainKind ?? 'subdomain';
    if (!['root', 'subdomain'].includes(kind)) throw domainError('Choose Root domain or Subdomain.');
    const requested = customPortalHostname(details.hostname, kind);
    if (hostname && (hostname !== requested || domainKind !== kind)) throw domainError('This workspace already has a custom domain setup. Contact Dynamax support to replace it.', 409);
    if (!hostname) {
      await patchDocumentFieldsIfCurrent(platform, collection, id,
        { CustomPortalHostname: requested, CustomPortalDomainKind: kind, CustomPortalRequestedAt: new Date().toISOString() }, { updateTime: registration.__updateTime });
      hostname = requested;
      domainKind = kind;
    }
  }
  const root = domainKind === 'root';
  const zone = root && registration.CustomPortalRootZoneId
    ? await readRootPortalZone(env, hostname, registration.CustomPortalRootZoneId) : null;
  const provider = hostname && (!root || zone?.status === 'active')
    ? await pagesDomain(env, project, hostname, { attach: details.action === 'domain-attach' }) : null;
  if (details.action === 'domain-activate') {
    const primaryUrl = 'https://' + hostname;
    if (!hostname || provider?.status !== 'active' || details.observedOrigin !== primaryUrl) {
      throw domainError('Wait for Cloudflare activation, then sign in and open setup on the custom address.', 409);
    }
    if (!['checkout-verified', 'not-configured'].includes(details.paymentCheck)
        || (registration.PaystackConnected === true && details.paymentCheck !== 'checkout-verified')) {
      throw domainError('Complete payment verification on the custom address first.', 409);
    }
    if (registration.PrimaryPortalUrl !== primaryUrl) {
      const verifiedAt = new Date().toISOString();
      await patchDocumentFieldsIfCurrent(platform, collection, id, {
        PrimaryPortalUrl: primaryUrl, CustomPortalVerifiedAt: verifiedAt,
        CustomPortalPaymentCheck: details.paymentCheck
      }, { updateTime: registration.__updateTime });
      registration.PrimaryPortalUrl = primaryUrl;
    }
  }
  return domainSetupState({ ...registration, CustomPortalHostname: hostname, CustomPortalDomainKind: domainKind }, provider, zone);
}

export async function onRequestPost({ request, env }) {
  try {
    return Response.json({ ok: true, ...await manageDomain(env, request) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.status ? error.message : 'Domain setup could not be completed. Try again.' },
      { status: error.status || 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
