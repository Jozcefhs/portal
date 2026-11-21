import { patchDocumentFieldsIfCurrent, queryCollection } from '../lib/firestore.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { assertFreshTenantControlRequest, verifyTenantControlRequest } from '../lib/tenant-control-plane.js';
import { assertTenantProjectAssignment } from '../lib/tenant-project-pool.js';
import { customPortalHostname, domainError, domainSetupState, pagesDomain, readRootPortalZone } from '../lib/tenant-custom-domain.js';
import { MANAGED_ORGANISATION_COLLECTION } from '../lib/managed-organisations.js';
import { ownershipRecord, hasRootProof, provisionRoot, reviewRootRecords, importRootRecords, prepareRootRecords } from '../lib/root-domain-setup.js';
import { tenantControlSecretHash } from '../lib/tenant-control-plane.js';

const actions = ['domain-status', 'domain-attach', 'domain-activate', 'domain-verify', 'domain-review', 'domain-import', 'domain-prepare'];

async function manageDomain(env, request) {
  const platform = requirePlatformFirestoreEnv(env);
  const details = await readJsonBody(request, { maxBytes: 256 * 1024 });
  if (!actions.includes(details.action)) throw domainError('Unknown domain setup action.');
  assertFreshTenantControlRequest(details);
  const signature = request.headers.get('X-Dynamax-Tenant-Signature');
  if (!signature) throw domainError('Missing tenant request signature.', 401);
  let collection = 'tenantRegistrations';
  const rows = await queryCollection(platform, collection, {
    filters: [{ field: 'WorkspaceId', op: '==', value: details.workspaceId }], limit: 20
  });
  let candidates = rows.filter(row => row.PortalUrl === 'https://' + details.portalHost
    && row.AdminActivatedAt && ![row.Status, row.SubscriptionStatus, row.LifecycleStage].some(value =>
      /retired|terminat|cancel|reject|delet|expired/i.test(String(value || ''))));
  if (!candidates.length && !rows.some(row => row.PortalUrl === 'https://' + details.portalHost)) {
    collection = MANAGED_ORGANISATION_COLLECTION;
    const managed = await queryCollection(platform, collection, {
      filters: [{ field: 'WorkspaceId', op: '==', value: details.workspaceId }], limit: 20
    });
    candidates = managed.filter(row => (!details.portalHost || row.PortalUrl === 'https://' + details.portalHost)
      && (details.observedOrigin === row.PortalUrl || details.observedOrigin === 'https://' + row.CustomPortalHostname)
      && String(row.Status || 'active').toLowerCase() === 'active');
  }
  if (candidates.length !== 1) throw domainError('An active, assigned subscriber workspace is required.', 403);
  const registration = candidates[0];
  if (!await verifyTenantControlRequest(registration.TenantControlPublicKey, details, signature)) {
    throw domainError('Invalid tenant request signature.', 401);
  }
  const project = registration.CloudflareProject;
  if (registration.PortalUrl !== 'https://' + project + '.pages.dev') throw domainError('The assigned project does not match the portal.', 409);
  const id = registration.__id || registration.Reference || registration.Id;
  if (collection === 'tenantRegistrations') await assertTenantProjectAssignment(platform, project, {
    registrationReference: registration.Reference || id, workspaceId: details.workspaceId
  });

  let hostname = registration.CustomPortalHostname || '';
  let domainKind = registration.CustomPortalDomainKind || 'subdomain';
  if (details.action === 'domain-attach' || details.action === 'domain-verify') {
    const kind = details.domainKind ?? 'subdomain';
    if (!['root', 'subdomain'].includes(kind)) throw domainError('Choose Root domain or Subdomain.');
    const requested = customPortalHostname(details.hostname, kind);
    if (hostname && (hostname !== requested || domainKind !== kind)) throw domainError('This workspace already has a custom domain setup. Contact Dynamax support to replace it.', 409);
    if (kind === 'root' && !registration.CustomPortalRootZoneId) {
      const proof = await ownershipRecord(project, id, requested);
      const state = { ...registration, CustomPortalHostname: requested, CustomPortalDomainKind: kind };
      if (details.action === 'domain-verify' && await hasRootProof(proof)) {
        const version = hostname ? registration : await patchDocumentFieldsIfCurrent(platform, collection, id, {
          CustomPortalHostname: requested, CustomPortalDomainKind: kind, CustomPortalRequestedAt: new Date().toISOString()
        }, registration);
        const zoneId = await provisionRoot(env, platform, requested, project, collection + '/' + id);
        const fields = { CustomPortalRootZoneId: zoneId, CustomPortalSelfService: true };
        await patchDocumentFieldsIfCurrent(platform, collection, id, fields, version);
        return { ...domainSetupState({ ...state, ...fields }, null), status: 'review-dns', nameservers: [] };
      }
      return { ...domainSetupState(state, null), status: 'awaiting-ownership', proof, nameservers: [] };
    }
    if (details.action === 'domain-verify') throw domainError('Refresh the current DNS setup before continuing.', 409);
    if (!hostname) {
      await patchDocumentFieldsIfCurrent(platform, collection, id,
        { CustomPortalHostname: requested, CustomPortalDomainKind: kind, CustomPortalRequestedAt: new Date().toISOString() }, { updateTime: registration.__updateTime });
      hostname = requested;
      domainKind = kind;
    }
  }
  const root = domainKind === 'root';
  if (root && !registration.CustomPortalRootZoneId && details.action === 'domain-status') {
    return { ...domainSetupState(registration, null), status: 'awaiting-ownership', proof: await ownershipRecord(project, id, hostname) };
  }
  const zone = root && registration.CustomPortalRootZoneId
    ? await readRootPortalZone(env, hostname, registration.CustomPortalRootZoneId) : null;
  if (registration.CustomPortalSelfService && zone && !registration.CustomPortalDnsPrepared) {
    const zoneId = registration.CustomPortalRootZoneId;
    const review = { ...domainSetupState(registration, null), status: 'review-dns', nameservers: [] };
    const importing = details.action === 'domain-import';
    if (importing || details.action === 'domain-prepare') {
      if (importing && zone.status !== 'pending') throw domainError('DNS imports are available before nameserver activation.', 409);
      if (Date.parse(registration.CustomPortalDnsBusyUntil) > Date.now()) throw domainError('A DNS update is in progress. Check status again shortly.', 409);
      const hash = importing && await tenantControlSecretHash(details.zoneFile);
      if (!importing || registration.CustomPortalImportHash !== hash) {
        const lock = await patchDocumentFieldsIfCurrent(platform, collection, id, { CustomPortalDnsBusyUntil: new Date(Date.now() + 120000).toISOString() }, registration);
        try {
          if (importing) await importRootRecords(env, zoneId, details.zoneFile);
          else {
            await prepareRootRecords(env, zoneId, hostname, project, zone.status === 'pending');
            await pagesDomain(env, project, hostname, { attach: true });
          }
          await patchDocumentFieldsIfCurrent(platform, collection, id, { CustomPortalDnsBusyUntil: '',
            ...(importing ? { CustomPortalImportHash: hash } : { CustomPortalDnsPrepared: true }) }, lock);
        } catch (error) {
          await patchDocumentFieldsIfCurrent(platform, collection, id, { CustomPortalDnsBusyUntil: '' }, lock).catch(() => {});
          throw error;
        }
      }
      if (!importing) return domainSetupState(registration, null, zone);
    }
    if (importing || details.action === 'domain-review') return { ...review, records: await reviewRootRecords(env, zoneId) };
    if (details.action === 'domain-activate') throw domainError('Review and prepare your DNS records first.', 409);
    return review;
  }
  if (['domain-review','domain-prepare','domain-import'].includes(details.action)) throw domainError('Refresh your DNS setup to continue.', 409);
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
