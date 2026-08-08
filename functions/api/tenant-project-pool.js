import { getDocument } from '../lib/firestore.js';
import { requirePlatformAdmin } from '../lib/platform-admin.js';
import { secureTextEqual } from '../lib/backend-security.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { issueTenantActivation } from '../lib/tenant-activation.js';
import {
  assignWaitingTenantRegistrations,
  claimNextTenantProvisioningRequest,
  ensureTenantPoolCapacity,
  finishTenantProvisioningRequest,
  loadTenantProjectPool,
  registerTenantProjectSlot,
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

const clean = (value) => String(value ?? '').trim();
const PROVISIONER_ACTIONS = new Set([
  'load',
  'register',
  'request',
  'claim-next',
  'finish-request',
  'process-lifecycle',
  'claim-retirement',
  'finish-retirement'
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
