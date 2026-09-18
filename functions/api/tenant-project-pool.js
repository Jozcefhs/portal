import { getDocument } from '../lib/firestore.js';
import { requirePlatformAdmin } from '../lib/platform-admin.js';
import { secureTextEqual } from '../lib/backend-security.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { issueTenantActivation } from '../lib/tenant-activation.js';
import {
  completeManagedOrganisationEmailDeployment,
  completeManagedOrganisationPaystackDeployment,
  loadManagedOrganisations,
  saveManagedOrganisationControlIdentity
} from '../lib/managed-organisations.js';
import {
  assignWaitingTenantRegistrations,
  claimNextTenantProvisioningRequest,
  ensureTenantPoolCapacity,
  finishTenantProvisioningRequest,
  completeTenantEmailDeployment,
  completeTenantPaystackDeployment,
  loadTenantProjectPool,
  quarantineTenantProjectSlot,
  registerTenantProjectSlot,
  removeQuarantinedTenantProjectSlot,
  resetTenantPaystackConnection,
  saveTenantControlPublicKey,
  releaseTenantProjectSlot,
  requestTenantProjectProvisioning,
  reserveTenantProjectSlot,
  saveTenantPoolPolicy
} from '../lib/tenant-project-pool.js';
import {
  claimNextTenantRetirementRequest,
  finishTenantRetirementRequest,
  processTenantSubscriptionLifecycle,
  queueTenantRetirementRequest
} from '../lib/tenant-trial-lifecycle.js';
import {
  completeNonCoreSubscriberCleanup,
  previewNonCoreSubscriberCleanup
} from '../lib/tenant-subscriber-cleanup.js';

const clean = (value) => String(value ?? '').trim();
const PROVISIONER_ACTIONS = new Set([
  'load',
  'load-managed-organisations',
  'register-managed-organisation',
  'complete-managed-paystack-deployment',
  'complete-managed-email-deployment',
  'register',
  'quarantine',
  'remove-quarantined-slot',
  'reset-paystack-connection',
  'set-control-key',
  'request',
  'claim-next',
  'complete-paystack-deployment',
  'complete-email-deployment',
  'finish-request',
  'process-lifecycle',
  'claim-retirement',
  'finish-retirement',
  'preview-noncore-subscriber-cleanup',
  'complete-noncore-subscriber-cleanup'
]);

function requireTenantPoolAccess(env, password, action) {
  const provisionerSecret = clean(env.TENANT_PROVISIONER_SECRET);
  if (PROVISIONER_ACTIONS.has(action)
      && provisionerSecret
      && secureTextEqual(password, provisionerSecret)) return;
  requirePlatformAdmin(env, password);
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request, { maxBytes: 96 * 1024 });
    const action = clean(body.action || 'load').toLowerCase();
    requireTenantPoolAccess(env, body.password, action);
    const platformEnv = requirePlatformFirestoreEnv(env);
    if (action === 'load') {
      return Response.json({ ok: true, ...(await loadTenantProjectPool(platformEnv)) }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'load-managed-organisations') {
      return Response.json({ ok: true, organisations: await loadManagedOrganisations(platformEnv) }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'preview-noncore-subscriber-cleanup') {
      return Response.json({ ok: true, plan: await previewNonCoreSubscriberCleanup(platformEnv) }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'complete-noncore-subscriber-cleanup') {
      const plan = await completeNonCoreSubscriberCleanup(platformEnv, body);
      return Response.json({
        ok: true,
        message: 'Non-core subscriber records were permanently removed.',
        plan
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'register-managed-organisation') {
      const organisation = await saveManagedOrganisationControlIdentity(platformEnv, body.organisation || body);
      return Response.json({
        ok: true,
        message: 'Managed organisation control-plane identity registered.',
        organisation
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'complete-managed-paystack-deployment') {
      const result = await completeManagedOrganisationPaystackDeployment(platformEnv, body.projectId, body.requestedAt);
      return Response.json({
        ok: true,
        message: result.completed
          ? 'Managed organisation Paystack deployment marked complete.'
          : 'A newer managed-organisation Paystack deployment remains queued.',
        ...result
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'complete-managed-email-deployment') {
      const result = await completeManagedOrganisationEmailDeployment(
        platformEnv,
        body.projectId,
        body.requestedAt,
        body.provider
      );
      return Response.json({
        ok: true,
        message: result.completed
          ? 'Managed organisation email-provider deployment marked complete.'
          : 'A newer managed-organisation email-provider deployment remains queued.',
        ...result
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'register') {
      const slot = await registerTenantProjectSlot(platformEnv, body.slot || body);
      const provisioningRequest = slot.ProvisioningBatchId
        ? await getDocument(platformEnv, 'tenantProvisioningRequests', slot.ProvisioningBatchId)
        : null;
      const assignments = await assignWaitingTenantRegistrations(platformEnv, slot.Edition, {
        registrationReference: provisioningRequest?.RegistrationReference,
        maximum: 1
      });
      const currentSlot = await getDocument(platformEnv, 'tenantProjectPool', slot.Id);
      return Response.json({
        ok: true,
        message: assignments.length ? 'Project created and assigned to the waiting subscriber.' : 'Ready project added to the tenant pool.',
        slot: currentSlot ? { ...slot, Status: currentSlot.Status, AssignedOrganisationName: currentSlot.AssignedOrganisationName } : slot,
        assignments
      }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'quarantine') {
      const slot = await quarantineTenantProjectSlot(platformEnv, body.projectId, body.reason);
      return Response.json({
        ok: true,
        message: 'Unassigned tenant project quarantined from automatic assignment.',
        slot
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'remove-quarantined-slot') {
      const result = await removeQuarantinedTenantProjectSlot(platformEnv, body.projectId);
      return Response.json({
        ok: true,
        message: result.removed ? 'Quarantined tenant project removed from the central pool.' : 'Tenant project was already absent from the central pool.',
        ...result
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'set-control-key') {
      const slot = await saveTenantControlPublicKey(platformEnv, body.projectId, body.publicKey);
      return Response.json({ ok: true, message: 'Tenant control-plane key registered.', slot }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'reset-paystack-connection') {
      const slot = await resetTenantPaystackConnection(platformEnv, body.projectId, body.requestedAt);
      return Response.json({
        ok: true,
        message: 'Tenant Paystack connection metadata reset and deployment queued.',
        slot
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'complete-paystack-deployment') {
      const result = await completeTenantPaystackDeployment(platformEnv, body.projectId, body.requestedAt);
      return Response.json({
        ok: true,
        message: result.completed
          ? 'Tenant Paystack deployment marked complete.'
          : 'A newer Paystack deployment request remains queued.',
        ...result
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'complete-email-deployment') {
      const result = await completeTenantEmailDeployment(platformEnv, body.projectId, body.requestedAt, body.provider);
      return Response.json({
        ok: true,
        message: result.completed
          ? 'Tenant email-provider deployment marked complete.'
          : 'A newer email-provider deployment request remains queued.',
        ...result
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'release') {
      const slot = await releaseTenantProjectSlot(platformEnv, body.slotId);
      return Response.json({ ok: true, message: 'Unassigned project returned to the ready pool.', slot }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'process-lifecycle') {
      const summary = await processTenantSubscriptionLifecycle(platformEnv, env, {
        dryRun: body.dryRun === true,
        maximum: body.maximum,
        now: body.dryRun === true ? body.now : undefined
      });
      return Response.json({
        ok: true,
        message: body.dryRun === true ? 'Subscription lifecycle preview completed.' : 'Subscription lifecycle processed.',
        summary
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'queue-retirement') {
      const registration = await getDocument(platformEnv, 'tenantRegistrations', clean(body.registrationReference));
      if (!registration) {
        const error = new Error('The subscriber registration was not found.');
        error.status = 404;
        throw error;
      }
      const retirement = await queueTenantRetirementRequest(platformEnv, registration);
      return Response.json({ ok: true, message: 'Tenant project retirement queued.', retirement }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'claim-retirement') {
      const retirement = await claimNextTenantRetirementRequest(platformEnv, body.runnerId);
      return Response.json({ ok: true, retirement }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'finish-retirement') {
      const retirement = await finishTenantRetirementRequest(platformEnv, body.retirement || body);
      await ensureTenantPoolCapacity(platformEnv, retirement.Edition).catch(() => null);
      return Response.json({
        ok: true,
        message: `Tenant retirement marked ${clean(retirement.Status).toLowerCase()}.`,
        retirement
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'request') {
      const provisioningRequest = await requestTenantProjectProvisioning(platformEnv, body.request || body);
      return Response.json({ ok: true, message: 'Provisioning request queued.', request: provisioningRequest }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'claim-next') {
      const provisioningRequest = await claimNextTenantProvisioningRequest(platformEnv, body.runnerId, body.reference);
      return Response.json({ ok: true, request: provisioningRequest }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'finish-request') {
      const provisioningRequest = await finishTenantProvisioningRequest(platformEnv, body.request || body);
      await ensureTenantPoolCapacity(platformEnv, provisioningRequest.Edition).catch(() => null);
      return Response.json({ ok: true, message: `Provisioning request marked ${provisioningRequest.Status.toLowerCase()}.`, request: provisioningRequest }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'ensure-capacity') {
      const requests = await ensureTenantPoolCapacity(platformEnv, body.edition);
      return Response.json({ ok: true, message: requests.length ? `${requests.length} replenishment request(s) queued.` : 'Ready capacity already meets the saved targets.', requests }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'save-policy') {
      const policy = await saveTenantPoolPolicy(platformEnv, body.policy || {});
      const requests = await ensureTenantPoolCapacity(platformEnv).catch(() => []);
      return Response.json({
        ok: true,
        message: requests.length
          ? `Tenant-pool targets saved; ${requests.length} replenishment request(s) queued.`
          : 'Tenant-pool targets saved.',
        policy,
        requests
      }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'assign') {
      const reference = clean(body.registrationReference);
      const registration = await getDocument(platformEnv, 'tenantRegistrations', reference);
      if (!registration) {
        const error = new Error('The subscriber registration was not found.');
        error.status = 404;
        throw error;
      }
      const assignment = await reserveTenantProjectSlot(platformEnv, registration);
      const activation = assignment.assigned
        ? await issueTenantActivation(platformEnv, assignment.registration, env).catch(() => ({ issued: false }))
        : { issued: false };
      return Response.json({
        ok: true,
        message: assignment.assigned ? 'A ready project was assigned.' : 'No ready project is available; replenishment was queued.',
        assigned: assignment.assigned,
        workspaceId: clean(assignment.registration?.WorkspaceId),
        portalUrl: clean(assignment.registration?.PortalUrl),
        activationIssued: Boolean(activation.issued),
        activationEmailSent: Boolean(activation.emailSent),
        activationUrl: clean(activation.activationUrl)
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const error = new Error('Unsupported tenant-pool action.');
    error.status = 400;
    throw error;
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
