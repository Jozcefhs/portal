import {
  batchCommitDocuments,
  createDocumentIfAbsent,
  deleteDocumentIfCurrent,
  getDocument,
  listCollection,
  patchDocumentFieldsIfCurrent,
  upsertDocument
} from './firestore.js';
import { normalizeOrganizationEdition } from './organization-config.js';
import { issueTenantActivation } from './tenant-activation.js';
import {
  publicTenantRetirementRequest,
  recordTrialUseTombstone,
  TENANT_RETIREMENT_REQUEST_COLLECTION
} from './tenant-trial-lifecycle.js';
import { validTenantControlPublicKey } from './tenant-control-plane.js';

export const TENANT_PROJECT_POOL_COLLECTION = 'tenantProjectPool';
export const TENANT_PROVISIONING_REQUEST_COLLECTION = 'tenantProvisioningRequests';
const POOL_POLICY_COLLECTION = 'settings';
const POOL_POLICY_DOCUMENT = 'tenantPoolPolicy';
const DEFAULT_READY_TARGET = 2;

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export function tenantProjectAssignmentEligibility(registration = {}) {
  if (clean(registration.WorkspaceId)) return { eligible: true, existing: true, reason: '' };
  const ownerDemo = registration.OwnerDemo === true
    && registration.NonBillable === true
    && registration.CardVerificationExempt === true
    && ['owner authorized', 'active'].includes(lower(registration.PaymentStatus || registration.Status));
  if (ownerDemo) return { eligible: true, ownerDemo: true, reason: '' };
  const cardVerified = lower(registration.CardVerificationStatus) === 'verified'
    && Boolean(clean(registration.CardVerifiedAt));
  if (cardVerified) return { eligible: true, cardVerified: true, reason: '' };
  return {
    eligible: false,
    reason: 'A successful Paystack card verification is required before a tenant project can be assigned.'
  };
}

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

function safeKey(value, fallback = '') {
  return lower(value)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || fallback;
}

function positiveInteger(value, fallback = 1, maximum = 100) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(maximum, number) : fallback;
}

function precreatedProjectEntries(value) {
  return (Array.isArray(value)
    ? value
    : clean(value).split(/[\r\n,]+/))
    .map((entry) => lower(entry))
    .filter(Boolean);
}

function precreatedProjectIds(value) {
  return [...new Set(precreatedProjectEntries(value)
    .filter((entry) => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(entry)))]
    .slice(0, 100);
}

function poolEdition(value) {
  return normalizeOrganizationEdition(value);
}

export function publicTenantProjectSlot(slot = {}) {
  return {
    Id: clean(slot.Id || slot.__id),
    Edition: poolEdition(slot.Edition),
    Status: clean(slot.Status || 'Provisioning'),
    FirebaseProjectId: clean(slot.FirebaseProjectId),
    CloudflareProject: clean(slot.CloudflareProject),
    WorkspaceId: clean(slot.WorkspaceId),
    PortalUrl: clean(slot.PortalUrl),
    Region: clean(slot.Region),
    AssignedRegistrationReference: clean(slot.AssignedRegistrationReference),
    AssignedOrganisationName: clean(slot.AssignedOrganisationName),
    ReservedAt: clean(slot.ReservedAt),
    ReadyAt: clean(slot.ReadyAt),
    MaintenanceAt: clean(slot.MaintenanceAt),
    MaintenanceReason: clean(slot.MaintenanceReason),
    SanitizedAt: clean(slot.SanitizedAt),
    LastError: clean(slot.LastError),
    ProvisioningBatchId: clean(slot.ProvisioningBatchId),
    TenantControlKeyConfigured: validTenantControlPublicKey(slot.TenantControlPublicKey),
    PaystackDeploymentPending: slot.PaystackDeploymentPending === true,
    PaystackDeploymentRequestedAt: clean(slot.PaystackDeploymentRequestedAt),
    EmailDeploymentPending: slot.EmailDeploymentPending === true,
    EmailDeploymentRequestedAt: clean(slot.EmailDeploymentRequestedAt),
    EmailDeploymentProvider: clean(slot.EmailDeploymentProvider).toLowerCase(),
    UpdatedAt: clean(slot.UpdatedAt || slot.__updateTime || slot.CreatedAt)
  };
}

export function tenantProjectAssignmentMatches(slot = {}, expected = {}) {
  const registrationReference = clean(expected.registrationReference);
  const workspaceId = lower(expected.workspaceId);
  return Boolean(
    registrationReference
    && workspaceId
    && lower(slot.Status) === 'assigned'
    && clean(slot.AssignedRegistrationReference) === registrationReference
    && lower(slot.WorkspaceId) === workspaceId
  );
}

export function normalizeTenantPoolPolicy(value = {}) {
  const targets = value.TargetReadyPerEdition || {};
  return {
    TargetReadyPerEdition: {
      school: positiveInteger(targets.school, DEFAULT_READY_TARGET, 20),
      faith: positiveInteger(targets.faith, DEFAULT_READY_TARGET, 20),
      organization: positiveInteger(targets.organization, DEFAULT_READY_TARGET, 20)
    },
    DefaultRegion: clean(value.DefaultRegion || 'africa-south1'),
    ProjectPrefix: safeKey(value.ProjectPrefix, 'dynamax-tenant').slice(0, 18),
    PrecreatedProjectIds: precreatedProjectIds(value.PrecreatedProjectIds),
    UpdatedAt: clean(value.UpdatedAt)
  };
}

export async function loadTenantPoolPolicy(platformEnv) {
  return normalizeTenantPoolPolicy(
    await getDocument(platformEnv, POOL_POLICY_COLLECTION, POOL_POLICY_DOCUMENT).catch(() => null) || {}
  );
}

export async function saveTenantPoolPolicy(platformEnv, value = {}) {
  const invalidProjectIds = precreatedProjectEntries(value.PrecreatedProjectIds)
    .filter((entry) => !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(entry));
  if (invalidProjectIds.length) {
    const error = new Error(`Invalid pre-created Google Cloud project ID: ${invalidProjectIds[0]}. Use one project ID per line.`);
    error.status = 400;
    throw error;
  }
  const policy = {
    ...normalizeTenantPoolPolicy(value),
    UpdatedAt: new Date().toISOString(),
    UpdatedBy: 'Dynamax administration'
  };
  await upsertDocument(platformEnv, POOL_POLICY_COLLECTION, POOL_POLICY_DOCUMENT, policy);
  return policy;
}

function poolSummary(slots, policy) {
  const editions = ['school', 'faith', 'organization'];
  const summary = Object.fromEntries(editions.map((edition) => {
    const editionSlots = slots.filter((slot) => slot.Edition === edition);
    const ready = editionSlots.filter((slot) => lower(slot.Status) === 'ready').length;
    const target = policy.TargetReadyPerEdition[edition];
    return [edition, {
      Total: editionSlots.length,
      Ready: ready,
      Reserved: editionSlots.filter((slot) => lower(slot.Status) === 'reserved').length,
      Assigned: editionSlots.filter((slot) => lower(slot.Status) === 'assigned').length,
      Provisioning: editionSlots.filter((slot) => lower(slot.Status) === 'provisioning').length,
      Failed: editionSlots.filter((slot) => lower(slot.Status) === 'failed').length,
      Target: target,
      Shortfall: Math.max(0, target - ready)
    }];
  }));
  return summary;
}

export function annotateProvisioningRequests(requestRows = [], slotRows = [], policyValue = {}, nowMs = Date.now()) {
  const policy = normalizeTenantPoolPolicy(policyValue);
  const registeredByRequest = new Map();
  for (const slot of slotRows) {
    const reference = clean(slot.ProvisioningBatchId);
    if (reference && ['ready', 'assigned', 'reserved'].includes(lower(slot.Status))) {
      registeredByRequest.set(reference, (registeredByRequest.get(reference) || 0) + 1);
    }
  }
  const remainingByEdition = Object.fromEntries(['school', 'faith', 'organization'].map((edition) => {
    const ready = slotRows.filter((slot) => poolEdition(slot.Edition) === edition && lower(slot.Status) === 'ready').length;
    return [edition, Math.max(0, policy.TargetReadyPerEdition[edition] - ready)];
  }));
  const staleBefore = nowMs - (90 * 60 * 1000);
  const requests = requestRows
    .map(publicProvisioningRequest)
    .sort((left, right) => left.RequestedAt.localeCompare(right.RequestedAt));

  // A running request already covers part of the target. Do not start another
  // request for the same capacity while the first runner still owns it.
  for (const request of requests) {
    if (request.Mode !== 'pool' || lower(request.Status) !== 'provisioning') continue;
    if (!Number.isFinite(Date.parse(request.StartedAt)) || Date.parse(request.StartedAt) < staleBefore) continue;
    const outstanding = Math.max(0, request.Count - (registeredByRequest.get(request.Reference) || 0));
    remainingByEdition[request.Edition] = Math.max(0, remainingByEdition[request.Edition] - outstanding);
  }

  return requests.map((request) => {
    const status = lower(request.Status);
    const retryable = status === 'pending'
      || (status === 'provisioning' && Date.parse(request.StartedAt) < staleBefore);
    if (!retryable) return { ...request, ActionRequired: false, EffectiveCount: 0 };
    const retryDue = !Number.isFinite(Date.parse(request.NextAttemptAt))
      || Date.parse(request.NextAttemptAt) <= nowMs;
    const outstanding = Math.max(0, request.Count - (registeredByRequest.get(request.Reference) || 0));
    if (outstanding === 0) {
      return { ...request, ActionRequired: retryDue, EffectiveCount: 0 };
    }
    if (request.Mode === 'branded') {
      return { ...request, ActionRequired: retryDue && outstanding > 0, EffectiveCount: outstanding };
    }
    const effectiveCount = Math.min(outstanding, remainingByEdition[request.Edition]);
    remainingByEdition[request.Edition] = Math.max(0, remainingByEdition[request.Edition] - effectiveCount);
    return { ...request, ActionRequired: retryDue && effectiveCount > 0, EffectiveCount: effectiveCount };
  });
}

export async function loadTenantProjectPool(platformEnv) {
  const [slotRows, requestRows, retirementRows, policy] = await Promise.all([
    listCollection(platformEnv, TENANT_PROJECT_POOL_COLLECTION, { pageSize: 1000, maxPages: 10 }).catch(() => []),
    listCollection(platformEnv, TENANT_PROVISIONING_REQUEST_COLLECTION, { pageSize: 500, maxPages: 10 }).catch(() => []),
    listCollection(platformEnv, TENANT_RETIREMENT_REQUEST_COLLECTION, { pageSize: 500, maxPages: 10 }).catch(() => []),
    loadTenantPoolPolicy(platformEnv)
  ]);
  const slots = slotRows.map(publicTenantProjectSlot).sort((left, right) => (
    left.Edition.localeCompare(right.Edition)
      || left.Status.localeCompare(right.Status)
      || left.Id.localeCompare(right.Id)
  ));
  const requests = annotateProvisioningRequests(requestRows, slotRows, policy)
    .sort((left, right) => right.RequestedAt.localeCompare(left.RequestedAt));
  const retirements = retirementRows
    .map(publicTenantRetirementRequest)
    .sort((left, right) => right.RequestedAt.localeCompare(left.RequestedAt));
  return { slots, requests, retirements, policy, summary: poolSummary(slots, policy) };
}

export async function registerTenantProjectSlot(platformEnv, value = {}) {
  const firebaseProjectId = safeKey(value.FirebaseProjectId);
  const cloudflareProject = safeKey(value.CloudflareProject || firebaseProjectId);
  const workspaceId = safeKey(value.WorkspaceId || firebaseProjectId);
  const edition = poolEdition(value.Edition);
  if (!firebaseProjectId || !cloudflareProject || !workspaceId) {
    const error = new Error('Firebase project, Cloudflare project and workspace ID are required.');
    error.status = 400;
    throw error;
  }
  const id = safeKey(value.Id || workspaceId || firebaseProjectId);
  const current = await getDocument(platformEnv, TENANT_PROJECT_POOL_COLLECTION, id);
  if (current && ['reserved', 'assigned'].includes(lower(current.Status))) {
    const error = new Error(lower(current.Status) === 'assigned'
      ? 'An assigned tenant project cannot be replaced or reused. Retire it through the secure deletion lifecycle.'
      : 'A reserved project cannot be replaced. Release the unused reservation first.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const tenantControlPublicKey = clean(value.TenantControlPublicKey || current?.TenantControlPublicKey);
  if (tenantControlPublicKey && !validTenantControlPublicKey(tenantControlPublicKey)) {
    const error = new Error('The tenant control-plane public key is invalid.');
    error.status = 400;
    throw error;
  }
  const slot = {
    ...(current ? withoutFirestoreMetadata(current) : {}),
    Id: id,
    Edition: edition,
    Status: clean(value.Status || 'Ready'),
    FirebaseProjectId: firebaseProjectId,
    CloudflareProject: cloudflareProject,
    WorkspaceId: workspaceId,
    PortalUrl: clean(value.PortalUrl || `https://${cloudflareProject}.pages.dev`),
    Region: clean(value.Region),
    ProvisioningBatchId: clean(value.ProvisioningBatchId),
    TenantControlPublicKey: tenantControlPublicKey,
    SanitizedAt: clean(value.SanitizedAt || current?.SanitizedAt),
    MaintenanceAt: lower(value.Status || 'Ready') === 'maintenance' ? clean(value.MaintenanceAt || current?.MaintenanceAt || now) : '',
    MaintenanceReason: lower(value.Status || 'Ready') === 'maintenance' ? clean(value.MaintenanceReason || current?.MaintenanceReason) : '',
    LastError: clean(value.LastError),
    ReadyAt: lower(value.Status || 'Ready') === 'ready' ? clean(current?.ReadyAt || now) : clean(current?.ReadyAt),
    CreatedAt: clean(current?.CreatedAt || now),
    UpdatedAt: now
  };
  await upsertDocument(platformEnv, TENANT_PROJECT_POOL_COLLECTION, id, slot);
  return publicTenantProjectSlot(slot);
}

export async function quarantineTenantProjectSlot(platformEnv, projectId, reason = '') {
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot) {
    const error = new Error('The tenant project was not found in the managed pool.');
    error.status = 404;
    throw error;
  }
  if (clean(slot.AssignedRegistrationReference) || !['ready', 'maintenance'].includes(lower(slot.Status))) {
    const error = new Error('Only an unassigned Ready or Maintenance project can enter maintenance.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const documentId = clean(slot.__id || slot.Id);
  const maintenance = {
    ...withoutFirestoreMetadata(slot),
    Status: 'Maintenance',
    MaintenanceAt: clean(slot.MaintenanceAt || now),
    MaintenanceReason: clean(reason || 'Tenant data sanitation'),
    PaystackDeploymentPending: false,
    EmailDeploymentPending: false,
    UpdatedAt: now
  };
  await patchDocumentFieldsIfCurrent(platformEnv, TENANT_PROJECT_POOL_COLLECTION, documentId, maintenance, slot);
  return publicTenantProjectSlot(maintenance);
}

export async function removeQuarantinedTenantProjectSlot(platformEnv, projectId) {
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot) return { removed: false, projectId: safeKey(projectId) };
  if (lower(slot.Status) !== 'maintenance' || clean(slot.AssignedRegistrationReference)) {
    const error = new Error('Only an unassigned Maintenance project can be removed from the pool.');
    error.status = 409;
    throw error;
  }
  const normalizedProjectId = safeKey(slot.FirebaseProjectId || projectId);
  const policy = await loadTenantPoolPolicy(platformEnv);
  if (policy.PrecreatedProjectIds.includes(normalizedProjectId)) {
    await saveTenantPoolPolicy(platformEnv, {
      ...policy,
      PrecreatedProjectIds: policy.PrecreatedProjectIds.filter((entry) => entry !== normalizedProjectId)
    });
  }
  await deleteDocumentIfCurrent(
    platformEnv,
    TENANT_PROJECT_POOL_COLLECTION,
    clean(slot.__id || slot.Id),
    slot
  );
  return { removed: true, projectId: normalizedProjectId };
}

async function tenantPoolSlotByProject(platformEnv, projectId) {
  const id = safeKey(projectId);
  if (!id) return null;
  let slot = await getDocument(platformEnv, TENANT_PROJECT_POOL_COLLECTION, id);
  if (!slot || safeKey(slot.CloudflareProject) !== id) {
    const slots = await listCollection(platformEnv, TENANT_PROJECT_POOL_COLLECTION, {
      pageSize: 1000,
      maxPages: 10
    });
    slot = slots.find((candidate) => safeKey(candidate.CloudflareProject) === id) || null;
  }
  return slot && safeKey(slot.CloudflareProject) === id ? slot : null;
}

export async function assertTenantProjectAssignment(platformEnv, projectId, expected = {}) {
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot || !tenantProjectAssignmentMatches(slot, expected)) {
    const error = new Error('The tenant project assignment changed before the provider update could be applied.');
    error.status = 409;
    error.code = 'TENANT_PROJECT_ASSIGNMENT_CHANGED';
    throw error;
  }
  return publicTenantProjectSlot(slot);
}

export async function assertTenantEmailDeploymentCurrent(platformEnv, projectId, expected = {}) {
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot
      || !tenantProjectAssignmentMatches(slot, expected)
      || slot.EmailDeploymentPending !== true
      || clean(slot.EmailDeploymentRequestedAt) !== clean(expected.requestedAt)
      || lower(slot.EmailDeploymentProvider) !== lower(expected.provider)) {
    const error = new Error('This email-provider transition was superseded before its credentials could be staged.');
    error.status = 409;
    error.code = 'EMAIL_PROVIDER_TRANSITION_SUPERSEDED';
    throw error;
  }
  return publicTenantProjectSlot(slot);
}

export async function saveTenantControlPublicKey(platformEnv, projectId, publicKey) {
  const tenantControlPublicKey = clean(publicKey);
  if (!safeKey(projectId) || !validTenantControlPublicKey(tenantControlPublicKey)) {
    const error = new Error('A valid tenant project and control-plane public key are required.');
    error.status = 400;
    throw error;
  }
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot) {
    const error = new Error('The tenant project was not found in the managed pool.');
    error.status = 404;
    throw error;
  }
  const slotDocumentId = clean(slot.__id || slot.Id);
  const now = new Date().toISOString();
  await upsertDocument(platformEnv, TENANT_PROJECT_POOL_COLLECTION, slotDocumentId, {
    ...withoutFirestoreMetadata(slot),
    TenantControlPublicKey: tenantControlPublicKey,
    TenantControlKeyUpdatedAt: now,
    UpdatedAt: now
  });
  const registrationReference = clean(slot.AssignedRegistrationReference);
  if (registrationReference) {
    const registration = await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
    if (!registration) {
      const error = new Error('The assigned tenant registration was not found.');
      error.status = 409;
      throw error;
    }
    await patchDocumentFieldsIfCurrent(platformEnv, 'tenantRegistrations', registrationReference, {
      TenantControlPublicKey: tenantControlPublicKey,
      TenantControlKeyUpdatedAt: now,
      UpdatedAt: now
    }, registration);
  }
  return publicTenantProjectSlot({ ...slot, TenantControlPublicKey: tenantControlPublicKey, UpdatedAt: now });
}

export async function queueTenantPaystackDeployment(platformEnv, projectId, requestedAt = new Date().toISOString()) {
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot) {
    const error = new Error('The tenant project was not found in the managed pool.');
    error.status = 404;
    throw error;
  }
  const slotDocumentId = clean(slot.__id || slot.Id);
  const timestamp = clean(requestedAt) || new Date().toISOString();
  await patchDocumentFieldsIfCurrent(platformEnv, TENANT_PROJECT_POOL_COLLECTION, slotDocumentId, {
    PaystackDeploymentPending: true,
    PaystackDeploymentRequestedAt: timestamp,
    UpdatedAt: timestamp
  }, slot);
  return publicTenantProjectSlot({
    ...slot,
    PaystackDeploymentPending: true,
    PaystackDeploymentRequestedAt: timestamp,
    UpdatedAt: timestamp
  });
}

export async function completeTenantPaystackDeployment(platformEnv, projectId, requestedAt) {
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot) {
    const error = new Error('The tenant project was not found in the managed pool.');
    error.status = 404;
    throw error;
  }
  const expectedRequest = clean(requestedAt);
  if (!expectedRequest || clean(slot.PaystackDeploymentRequestedAt) !== expectedRequest) {
    return { completed: false, slot: publicTenantProjectSlot(slot) };
  }
  const slotDocumentId = clean(slot.__id || slot.Id);
  const completedAt = new Date().toISOString();
  try {
    await patchDocumentFieldsIfCurrent(platformEnv, TENANT_PROJECT_POOL_COLLECTION, slotDocumentId, {
      PaystackDeploymentPending: false,
      PaystackDeploymentCompletedAt: completedAt,
      UpdatedAt: completedAt
    }, slot);
  } catch (error) {
    if (error?.code !== 'FIRESTORE_WRITE_CONFLICT') throw error;
    const latest = await tenantPoolSlotByProject(platformEnv, projectId);
    if (!latest || clean(latest.PaystackDeploymentRequestedAt) !== expectedRequest) {
      return { completed: false, slot: publicTenantProjectSlot(latest || {}) };
    }
    await patchDocumentFieldsIfCurrent(platformEnv, TENANT_PROJECT_POOL_COLLECTION, clean(latest.__id || latest.Id), {
      PaystackDeploymentPending: false,
      PaystackDeploymentCompletedAt: completedAt,
      UpdatedAt: completedAt
    }, latest);
  }
  const registrationReference = clean(slot.AssignedRegistrationReference);
  if (registrationReference) {
    const registration = await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
    if (registration && clean(registration.PaystackDeploymentRequestedAt) === expectedRequest) {
      await patchDocumentFieldsIfCurrent(platformEnv, 'tenantRegistrations', registrationReference, {
        PaystackDeploymentQueued: false,
        PaystackDeploymentCompletedAt: completedAt,
        UpdatedAt: completedAt
      }, registration);
    }
  }
  return {
    completed: true,
    slot: publicTenantProjectSlot({ ...slot, PaystackDeploymentPending: false, UpdatedAt: completedAt })
  };
}

export async function queueTenantEmailDeployment(
  platformEnv,
  projectId,
  requestedAt = new Date().toISOString(),
  provider = '',
  expectedAssignment = {}
) {
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot) {
    const error = new Error('The tenant project was not found in the managed pool.');
    error.status = 404;
    throw error;
  }
  const slotDocumentId = clean(slot.__id || slot.Id);
  const timestamp = clean(requestedAt) || new Date().toISOString();
  const targetProvider = ['brevo', 'gmail'].includes(lower(provider)) ? lower(provider) : '';
  if (!targetProvider) {
    const error = new Error('A valid target email provider is required for deployment.');
    error.status = 400;
    throw error;
  }
  if (!tenantProjectAssignmentMatches(slot, expectedAssignment)) {
    const error = new Error('The tenant project assignment changed before its email deployment could be queued.');
    error.status = 409;
    error.code = 'TENANT_PROJECT_ASSIGNMENT_CHANGED';
    throw error;
  }
  if (slot.EmailDeploymentPending === true) {
    const sameTransition = clean(slot.EmailDeploymentRequestedAt) === timestamp
      && lower(slot.EmailDeploymentProvider) === targetProvider;
    if (sameTransition) return publicTenantProjectSlot(slot);
    const error = new Error('Another email-provider transition is still being deployed. Wait for it to finish before starting another.');
    error.status = 409;
    error.code = 'EMAIL_PROVIDER_TRANSITION_IN_PROGRESS';
    throw error;
  }
  await patchDocumentFieldsIfCurrent(platformEnv, TENANT_PROJECT_POOL_COLLECTION, slotDocumentId, {
    EmailDeploymentPending: true,
    EmailDeploymentRequestedAt: timestamp,
    EmailDeploymentProvider: targetProvider,
    UpdatedAt: timestamp
  }, slot);
  return publicTenantProjectSlot({
    ...slot,
    EmailDeploymentPending: true,
    EmailDeploymentRequestedAt: timestamp,
    EmailDeploymentProvider: targetProvider,
    UpdatedAt: timestamp
  });
}

function tenantEmailTransitionSupersededError() {
  const error = new Error('This email-provider transition was superseded before it could be cancelled.');
  error.status = 409;
  error.code = 'EMAIL_PROVIDER_TRANSITION_SUPERSEDED';
  return error;
}

function cancelledTenantEmailQueueFields(requestedAt, provider, cancelledAt) {
  return {
    EmailDeploymentPending: false,
    EmailDeploymentRequestedAt: '',
    EmailDeploymentProvider: '',
    EmailDeploymentCancelledRequestedAt: requestedAt,
    EmailDeploymentCancelledProvider: provider,
    EmailDeploymentCancelledAt: cancelledAt,
    UpdatedAt: cancelledAt
  };
}

function cancelledTenantEmailMetadataFields(requestedAt, provider, cancelledAt) {
  return {
    EmailProviderPending: '',
    GmailConnectedEmailPending: '',
    EmailProviderConnectedByPending: '',
    EmailProviderTransitionStatus: 'Cancelled',
    EmailDeploymentQueued: false,
    EmailDeploymentRequestedAt: '',
    EmailDeploymentCancelledRequestedAt: requestedAt,
    EmailDeploymentCancelledProvider: provider,
    EmailDeploymentCancelledAt: cancelledAt,
    UpdatedAt: cancelledAt
  };
}

export async function cancelTenantEmailDeployment(
  platformEnv,
  projectId,
  requestedAt,
  provider = '',
  expectedAssignment = {}
) {
  const expectedRequest = clean(requestedAt);
  const expectedProvider = lower(provider);
  if (!expectedRequest || !['brevo', 'gmail'].includes(expectedProvider)) {
    const error = new Error('A valid email-provider transition is required for cancellation.');
    error.status = 400;
    throw error;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const slot = await tenantPoolSlotByProject(platformEnv, projectId);
    if (!slot) {
      const error = new Error('The tenant project was not found in the managed pool.');
      error.status = 404;
      throw error;
    }
    if (!tenantProjectAssignmentMatches(slot, expectedAssignment)) {
      const error = new Error('The tenant project assignment changed before its email deployment could be cancelled.');
      error.status = 409;
      error.code = 'TENANT_PROJECT_ASSIGNMENT_CHANGED';
      throw error;
    }

    if (slot.EmailDeploymentPending !== true) {
      const alreadyCancelled = clean(slot.EmailDeploymentCancelledRequestedAt) === expectedRequest
        && lower(slot.EmailDeploymentCancelledProvider) === expectedProvider;
      return { cancelled: false, alreadyCancelled, slot: publicTenantProjectSlot(slot) };
    }

    if (clean(slot.EmailDeploymentRequestedAt) !== expectedRequest
        || lower(slot.EmailDeploymentProvider) !== expectedProvider) {
      throw tenantEmailTransitionSupersededError();
    }

    const registrationReference = clean(expectedAssignment.registrationReference);
    const workspaceId = lower(expectedAssignment.workspaceId);
    const registration = await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
    const actualRegistrationReference = clean(registration?.__id || registration?.Reference || registration?.Id);
    if (!registration
        || actualRegistrationReference !== registrationReference
        || lower(registration.WorkspaceId) !== workspaceId) {
      const error = new Error('The tenant project assignment changed before its email deployment could be cancelled.');
      error.status = 409;
      error.code = 'TENANT_PROJECT_ASSIGNMENT_CHANGED';
      throw error;
    }

    const registrationProvider = lower(registration.EmailProviderPending);
    const registrationRequest = clean(registration.EmailDeploymentRequestedAt);
    const matchingRegistrationMetadata = registrationProvider === expectedProvider
      && registrationRequest === expectedRequest;
    if (registration.EmailDeploymentQueued === true && !matchingRegistrationMetadata) {
      throw tenantEmailTransitionSupersededError();
    }

    const cancelledAt = new Date().toISOString();
    const slotFields = cancelledTenantEmailQueueFields(expectedRequest, expectedProvider, cancelledAt);
    const writes = [{
      collectionPath: TENANT_PROJECT_POOL_COLLECTION,
      documentId: clean(slot.__id || slot.Id),
      data: { ...withoutFirestoreMetadata(slot), ...slotFields },
      updateTime: slot.__updateTime
    }];
    if (matchingRegistrationMetadata) {
      writes.push({
        collectionPath: 'tenantRegistrations',
        documentId: registrationReference,
        data: {
          ...withoutFirestoreMetadata(registration),
          ...cancelledTenantEmailMetadataFields(expectedRequest, expectedProvider, cancelledAt)
        },
        updateTime: registration.__updateTime
      });
    }

    try {
      await batchCommitDocuments(platformEnv, writes);
      return {
        cancelled: true,
        alreadyCancelled: false,
        registrationMetadataCleared: matchingRegistrationMetadata,
        slot: publicTenantProjectSlot({ ...slot, ...slotFields })
      };
    } catch (error) {
      if (error?.code !== 'FIRESTORE_WRITE_CONFLICT' || attempt > 0) throw error;
    }
  }

  throw tenantEmailTransitionSupersededError();
}

export async function completeTenantEmailDeployment(platformEnv, projectId, requestedAt, provider = '') {
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot) {
    const error = new Error('The tenant project was not found in the managed pool.');
    error.status = 404;
    throw error;
  }
  const expectedRequest = clean(requestedAt);
  const expectedProvider = lower(provider);
  if (!['brevo', 'gmail'].includes(expectedProvider)) {
    const error = new Error('The deployed email provider must be confirmed before completing the queue.');
    error.status = 400;
    throw error;
  }
  if (!expectedRequest || clean(slot.EmailDeploymentRequestedAt) !== expectedRequest
      || lower(slot.EmailDeploymentProvider) !== expectedProvider) {
    return { completed: false, slot: publicTenantProjectSlot(slot) };
  }
  const slotDocumentId = clean(slot.__id || slot.Id);
  const completedAt = new Date().toISOString();
  const registrationReference = clean(slot.AssignedRegistrationReference);
  if (!registrationReference) {
    const error = new Error('The queued tenant email deployment has no assigned registration.');
    error.status = 409;
    error.code = 'TENANT_PROJECT_ASSIGNMENT_CHANGED';
    throw error;
  }
  let registration = await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
  if (!registration || clean(registration.EmailDeploymentRequestedAt) !== expectedRequest) {
    return { completed: false, slot: publicTenantProjectSlot(slot) };
  }
  let registrationComplete = registration.EmailDeploymentQueued === false
    && lower(registration.EmailProvider) === expectedProvider
    && Boolean(clean(registration.EmailDeploymentCompletedAt));
  if (!registrationComplete) {
    const registrationFields = {
      EmailProvider: expectedProvider,
      GmailConnectedEmail: expectedProvider === 'gmail' ? clean(registration.GmailConnectedEmailPending) : '',
      EmailProviderConnectedAt: completedAt,
      EmailProviderConnectedBy: clean(registration.EmailProviderConnectedByPending || 'Tenant Super Administrator'),
      EmailProviderPending: '',
      GmailConnectedEmailPending: '',
      EmailProviderConnectedByPending: '',
      EmailProviderTransitionStatus: 'Connected',
      EmailProviderFailureCode: '',
      EmailDeploymentQueued: false,
      EmailDeploymentCompletedAt: completedAt,
      UpdatedAt: completedAt
    };
    try {
      await patchDocumentFieldsIfCurrent(
        platformEnv,
        'tenantRegistrations',
        registrationReference,
        registrationFields,
        registration
      );
      registrationComplete = true;
    } catch (error) {
      if (error?.code !== 'FIRESTORE_WRITE_CONFLICT') throw error;
      registration = await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
      if (!registration || clean(registration.EmailDeploymentRequestedAt) !== expectedRequest) {
        return { completed: false, slot: publicTenantProjectSlot(slot) };
      }
      registrationComplete = registration.EmailDeploymentQueued === false
        && lower(registration.EmailProvider) === expectedProvider
        && Boolean(clean(registration.EmailDeploymentCompletedAt));
      if (!registrationComplete) {
        await patchDocumentFieldsIfCurrent(platformEnv, 'tenantRegistrations', registrationReference, {
          ...registrationFields,
          GmailConnectedEmail: expectedProvider === 'gmail' ? clean(registration.GmailConnectedEmailPending) : '',
          EmailProviderConnectedBy: clean(registration.EmailProviderConnectedByPending || 'Tenant Super Administrator')
        }, registration);
      }
    }
  }

  // Registration is finalized first. A slot CAS failure leaves the pending
  // job visible so the deployment scheduler can safely retry idempotently.
  try {
    await patchDocumentFieldsIfCurrent(platformEnv, TENANT_PROJECT_POOL_COLLECTION, slotDocumentId, {
      EmailDeploymentPending: false,
      EmailDeploymentCompletedAt: completedAt,
      UpdatedAt: completedAt
    }, slot);
  } catch (error) {
    if (error?.code !== 'FIRESTORE_WRITE_CONFLICT') throw error;
    const latest = await tenantPoolSlotByProject(platformEnv, projectId);
    if (!latest || clean(latest.EmailDeploymentRequestedAt) !== expectedRequest
        || lower(latest.EmailDeploymentProvider) !== expectedProvider) {
      return { completed: false, slot: publicTenantProjectSlot(latest || {}) };
    }
    await patchDocumentFieldsIfCurrent(platformEnv, TENANT_PROJECT_POOL_COLLECTION, clean(latest.__id || latest.Id), {
      EmailDeploymentPending: false,
      EmailDeploymentCompletedAt: completedAt,
      UpdatedAt: completedAt
    }, latest);
  }
  return {
    completed: true,
    slot: publicTenantProjectSlot({ ...slot, EmailDeploymentPending: false, UpdatedAt: completedAt })
  };
}

export async function resetTenantPaystackConnection(platformEnv, projectId, requestedAt = new Date().toISOString()) {
  const slot = await tenantPoolSlotByProject(platformEnv, projectId);
  if (!slot) {
    const error = new Error('The tenant project was not found in the managed pool.');
    error.status = 404;
    throw error;
  }
  const timestamp = clean(requestedAt) || new Date().toISOString();
  const slotDocumentId = clean(slot.__id || slot.Id);
  await patchDocumentFieldsIfCurrent(platformEnv, TENANT_PROJECT_POOL_COLLECTION, slotDocumentId, {
    PaystackDeploymentPending: true,
    PaystackDeploymentRequestedAt: timestamp,
    UpdatedAt: timestamp
  }, slot);
  const registrationReference = clean(slot.AssignedRegistrationReference);
  if (registrationReference) {
    const registration = await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
    if (registration) {
      await patchDocumentFieldsIfCurrent(platformEnv, 'tenantRegistrations', registrationReference, {
        PaystackConnected: false,
        PaystackMode: 'not-configured',
        PaystackConnectedAt: '',
        PaystackConnectedBy: '',
        PaystackDeploymentQueued: true,
        PaystackDeploymentRequestedAt: timestamp,
        UpdatedAt: timestamp
      }, registration);
    }
  }
  return publicTenantProjectSlot({
    ...slot,
    PaystackDeploymentPending: true,
    PaystackDeploymentRequestedAt: timestamp,
    UpdatedAt: timestamp
  });
}

export async function requestTenantProjectProvisioning(platformEnv, value = {}) {
  const edition = poolEdition(value.Edition);
  const mode = lower(value.Mode) === 'branded' ? 'branded' : 'pool';
  const count = mode === 'branded' ? 1 : positiveInteger(value.Count, 1, 20);
  const requestedProjectId = mode === 'branded' ? safeKey(value.RequestedProjectId) : '';
  if (mode === 'branded' && !requestedProjectId) {
    const error = new Error('Enter the requested branded Firebase project ID.');
    error.status = 400;
    throw error;
  }
  const reference = `POOL-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const request = {
    Reference: reference,
    Edition: edition,
    Mode: mode,
    Count: count,
    RequestedProjectId: requestedProjectId,
    Status: 'Pending',
    RequestedBy: clean(value.RequestedBy || 'Dynamax administration'),
    RequestedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString()
  };
  const created = await createDocumentIfAbsent(platformEnv, TENANT_PROVISIONING_REQUEST_COLLECTION, reference, request);
  if (!created.created) {
    const error = new Error('Could not reserve a unique provisioning request. Try again.');
    error.status = 409;
    throw error;
  }
  return request;
}

function publicProvisioningRequest(request = {}) {
  return {
    Reference: clean(request.Reference || request.__id),
    Edition: poolEdition(request.Edition),
    Mode: lower(request.Mode) === 'branded' ? 'branded' : 'pool',
    Count: positiveInteger(request.Count, 1, 20),
    RequestedProjectId: clean(request.RequestedProjectId),
    RegistrationReference: clean(request.RegistrationReference),
    OrganisationName: clean(request.OrganisationName),
    Status: clean(request.Status || 'Pending'),
    RequestedAt: clean(request.RequestedAt || request.CreatedAt),
    RequestedBy: clean(request.RequestedBy),
    RunnerId: clean(request.RunnerId),
    StartedAt: clean(request.StartedAt),
    CompletedAt: clean(request.CompletedAt),
    LastError: clean(request.LastError),
    NextAttemptAt: clean(request.NextAttemptAt),
    Attempts: Math.max(0, Number(request.Attempts) || 0),
    ProvisioningBatchId: clean(request.ProvisioningBatchId),
    EffectiveCount: Math.max(0, Number(request.EffectiveCount) || 0)
  };
}

export async function claimNextTenantProvisioningRequest(platformEnv, runnerId = '', requestedReference = '') {
  const staleBefore = Date.now() - (90 * 60 * 1000);
  const targetReference = clean(requestedReference);
  const [requestRows, slotRows, policy] = await Promise.all([
    listCollection(platformEnv, TENANT_PROVISIONING_REQUEST_COLLECTION, { pageSize: 250, maxPages: 4 }),
    listCollection(platformEnv, TENANT_PROJECT_POOL_COLLECTION, { pageSize: 1000, maxPages: 10 }),
    loadTenantPoolPolicy(platformEnv)
  ]);
  const queueState = new Map(annotateProvisioningRequests(requestRows, slotRows, policy)
    .map((request) => [request.Reference, request]));
  const requests = requestRows
    .filter((request) => (!targetReference || clean(request.Reference || request.__id) === targetReference)
      && (lower(request.Status) === 'pending'
        || (lower(request.Status) === 'provisioning'
          && Date.parse(clean(request.StartedAt)) < staleBefore))
      && queueState.get(clean(request.Reference || request.__id))?.ActionRequired)
    .sort((left, right) => clean(left.RequestedAt || left.CreatedAt).localeCompare(clean(right.RequestedAt || right.CreatedAt)));

  for (const request of requests) {
    const now = new Date().toISOString();
    const requestState = queueState.get(clean(request.Reference || request.__id));
    const claimed = {
      ...withoutFirestoreMetadata(request),
      EffectiveCount: requestState?.EffectiveCount ?? positiveInteger(request.Count, 1, 20),
      Status: 'Provisioning',
      RunnerId: clean(runnerId || `runner-${crypto.randomUUID()}`),
      StartedAt: now,
      Attempts: Math.max(0, Number(request.Attempts) || 0) + 1,
      NextAttemptAt: '',
      LastError: '',
      UpdatedAt: now
    };
    try {
      await patchDocumentFieldsIfCurrent(
        platformEnv,
        TENANT_PROVISIONING_REQUEST_COLLECTION,
        clean(request.__id || request.Reference),
        claimed,
        request
      );
      return publicProvisioningRequest(claimed);
    } catch (error) {
      if (error?.code === 'FIRESTORE_WRITE_CONFLICT' || [409, 412].includes(Number(error?.status))) continue;
      throw error;
    }
  }
  return null;
}

export async function finishTenantProvisioningRequest(platformEnv, value = {}) {
  const reference = clean(value.Reference || value.reference);
  if (!reference) {
    const error = new Error('The provisioning request reference is required.');
    error.status = 400;
    throw error;
  }
  const request = await getDocument(platformEnv, TENANT_PROVISIONING_REQUEST_COLLECTION, reference);
  if (!request) {
    const error = new Error('The provisioning request was not found.');
    error.status = 404;
    throw error;
  }
  const requestedStatus = lower(value.Status);
  const status = requestedStatus === 'completed' ? 'Completed' : requestedStatus === 'pending' ? 'Pending' : 'Failed';
  const now = new Date().toISOString();
  const completed = {
    ...withoutFirestoreMetadata(request),
    Status: status,
    CompletedAt: status === 'Pending' ? '' : now,
    NextAttemptAt: status === 'Pending' && Number.isFinite(Date.parse(value.NextAttemptAt))
      ? new Date(value.NextAttemptAt).toISOString()
      : '',
    LastError: status === 'Completed' ? '' : clean(value.LastError || value.error || 'Provisioning failed.'),
    ProvisionedProjectIds: Array.isArray(value.ProvisionedProjectIds)
      ? value.ProvisionedProjectIds.map(clean).filter(Boolean).slice(0, 20)
      : [],
    UpdatedAt: now
  };
  await patchDocumentFieldsIfCurrent(
    platformEnv,
    TENANT_PROVISIONING_REQUEST_COLLECTION,
    reference,
    completed,
    request
  );
  return publicProvisioningRequest(completed);
}

export async function ensureTenantPoolCapacity(platformEnv, selectedEdition = '') {
  const policy = await loadTenantPoolPolicy(platformEnv);
  const [slotRows, requestRows] = await Promise.all([
    listCollection(platformEnv, TENANT_PROJECT_POOL_COLLECTION, { pageSize: 1000, maxPages: 10 }).catch(() => []),
    listCollection(platformEnv, TENANT_PROVISIONING_REQUEST_COLLECTION, { pageSize: 500, maxPages: 10 }).catch(() => [])
  ]);
  const editions = selectedEdition ? [poolEdition(selectedEdition)] : ['school', 'faith', 'organization'];
  const registeredByRequest = new Map();
  for (const slot of slotRows) {
    const reference = clean(slot.ProvisioningBatchId);
    if (reference && ['ready', 'assigned', 'reserved'].includes(lower(slot.Status))) {
      registeredByRequest.set(reference, (registeredByRequest.get(reference) || 0) + 1);
    }
  }
  const queued = [];
  for (const edition of editions) {
    const ready = slotRows.filter((slot) => poolEdition(slot.Edition) === edition && lower(slot.Status) === 'ready').length;
    const inFlight = requestRows
      .filter((request) => poolEdition(request.Edition) === edition && ['pending', 'provisioning'].includes(lower(request.Status)))
      .reduce((total, request) => total + Math.max(0,
        positiveInteger(request.Count, 1, 20) - (registeredByRequest.get(clean(request.Reference || request.__id)) || 0)
      ), 0);
    const shortfall = Math.max(0, policy.TargetReadyPerEdition[edition] - ready - inFlight);
    if (!shortfall) continue;
    queued.push(await requestTenantProjectProvisioning(platformEnv, {
      Edition: edition,
      Mode: 'pool',
      Count: shortfall,
      RequestedBy: 'Automatic ready-pool replenishment'
    }));
  }
  return queued;
}

async function queueCapacityRequest(platformEnv, registration) {
  const reference = `REG-${safeKey(registration.Reference || registration.__id, crypto.randomUUID())}`;
  await createDocumentIfAbsent(platformEnv, TENANT_PROVISIONING_REQUEST_COLLECTION, reference, {
    Reference: reference,
    RegistrationReference: clean(registration.Reference || registration.__id),
    OrganisationName: clean(registration.OrganisationName),
    Edition: poolEdition(registration.Edition),
    Mode: 'pool',
    Count: 1,
    Status: 'Pending',
    RequestedBy: 'Automatic subscriber onboarding',
    RequestedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString()
  });
}

export async function reserveTenantProjectSlot(platformEnv, currentRegistration = {}) {
  if (clean(currentRegistration.WorkspaceId)) {
    return { assigned: true, registration: currentRegistration, slot: null, existing: true };
  }
  const registrationReference = clean(currentRegistration.Reference || currentRegistration.__id);
  if (!registrationReference) {
    const error = new Error('A saved organisation registration is required before a project can be assigned.');
    error.status = 400;
    throw error;
  }
  const registration = currentRegistration.__updateTime
    ? currentRegistration
    : await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
  if (!registration) {
    const error = new Error('The organisation registration was not found.');
    error.status = 404;
    throw error;
  }
  if (clean(registration.WorkspaceId)) return { assigned: true, registration, slot: null, existing: true };
  const eligibility = tenantProjectAssignmentEligibility(registration);
  if (!eligibility.eligible) {
    const error = new Error(eligibility.reason);
    error.status = 409;
    error.code = 'TENANT_CARD_VERIFICATION_REQUIRED';
    throw error;
  }
  const edition = poolEdition(registration.Edition);
  const candidates = (await listCollection(platformEnv, TENANT_PROJECT_POOL_COLLECTION, { pageSize: 250, maxPages: 4 }))
    .filter((slot) => poolEdition(slot.Edition) === edition && lower(slot.Status) === 'ready')
    .sort((left, right) => clean(left.ReadyAt || left.CreatedAt).localeCompare(clean(right.ReadyAt || right.CreatedAt)));

  for (const candidate of candidates) {
    const now = new Date().toISOString();
    const updatedSlot = {
      ...withoutFirestoreMetadata(candidate),
      Status: 'Assigned',
      AssignedRegistrationReference: registrationReference,
      AssignedOrganisationName: clean(registration.OrganisationName),
      ReservedAt: now,
      AssignedAt: now,
      UpdatedAt: now
    };
    const updatedRegistration = {
      ...withoutFirestoreMetadata(registration),
      WorkspaceId: clean(candidate.WorkspaceId),
      ProjectSlotId: clean(candidate.Id || candidate.__id),
      FirebaseProjectId: clean(candidate.FirebaseProjectId),
      CloudflareProject: clean(candidate.CloudflareProject),
      PortalUrl: clean(candidate.PortalUrl),
      TenantControlPublicKey: clean(candidate.TenantControlPublicKey),
      ProvisioningStatus: 'Ready',
      ProjectAssignedAt: now,
      UpdatedAt: now
    };
    try {
      await batchCommitDocuments(platformEnv, [
        {
          collectionPath: TENANT_PROJECT_POOL_COLLECTION,
          documentId: clean(candidate.__id || candidate.Id),
          data: updatedSlot,
          updateTime: candidate.__updateTime
        },
        {
          collectionPath: 'tenantRegistrations',
          documentId: registrationReference,
          data: updatedRegistration,
          updateTime: registration.__updateTime
        }
      ]);
      await ensureTenantPoolCapacity(platformEnv, edition).catch(() => null);
      return { assigned: true, registration: updatedRegistration, slot: publicTenantProjectSlot(updatedSlot) };
    } catch (error) {
      if (error?.code === 'FIRESTORE_WRITE_CONFLICT' || [409, 412].includes(Number(error?.status))) continue;
      throw error;
    }
  }

  const now = new Date().toISOString();
  await patchDocumentFieldsIfCurrent(platformEnv, 'tenantRegistrations', registrationReference, {
    ProvisioningStatus: 'Waiting for ready project',
    ProvisioningRequestedAt: now,
    UpdatedAt: now
  }, registration).catch((error) => {
    if (error?.code !== 'FIRESTORE_WRITE_CONFLICT') throw error;
  });
  await queueCapacityRequest(platformEnv, registration);
  return {
    assigned: false,
    registration: {
      ...withoutFirestoreMetadata(registration),
      ProvisioningStatus: 'Waiting for ready project',
      ProvisioningRequestedAt: now,
      UpdatedAt: now
    },
    slot: null
  };
}

function waitingRegistration(registration = {}) {
  if (clean(registration.WorkspaceId)) return false;
  if (!tenantProjectAssignmentEligibility(registration).eligible) return false;
  const values = [
    registration.ProvisioningStatus,
    registration.Status,
    registration.PaymentStatus,
    registration.SubscriptionStatus
  ].map(lower);
  return values.some((status) => [
    'waiting for ready project',
    'pending trial activation',
    'paid',
    'active',
    'payment confirmed'
  ].includes(status));
}

function waitingPriority(registration = {}) {
  const values = [registration.Status, registration.PaymentStatus, registration.SubscriptionStatus].map(lower);
  return values.some((status) => ['paid', 'active', 'payment confirmed'].includes(status)) ? 0 : 1;
}

export async function assignWaitingTenantRegistrations(platformEnv, selectedEdition, options = {}) {
  const edition = poolEdition(selectedEdition);
  const preferredReference = clean(options.registrationReference);
  const maximum = positiveInteger(options.maximum, 1, 20);
  let registrations = [];
  if (preferredReference) {
    const preferred = await getDocument(platformEnv, 'tenantRegistrations', preferredReference);
    if (preferred) registrations.push(preferred);
  }
  const listed = await listCollection(platformEnv, 'tenantRegistrations', { pageSize: 1000, maxPages: 10 }).catch(() => []);
  registrations = [...registrations, ...listed]
    .filter((registration, index, rows) => rows.findIndex((row) => clean(row.__id) === clean(registration.__id)) === index)
    .filter((registration) => poolEdition(registration.Edition) === edition && waitingRegistration(registration))
    .sort((left, right) => (
      waitingPriority(left) - waitingPriority(right)
      || clean(left.ProvisioningRequestedAt || left.CreatedAt).localeCompare(clean(right.ProvisioningRequestedAt || right.CreatedAt))
    ));

  const assignments = [];
  for (const registration of registrations.slice(0, maximum)) {
    const assignment = await reserveTenantProjectSlot(platformEnv, registration);
    if (!assignment.assigned) break;
    let assignedRegistration = assignment.registration;
    if (lower(assignedRegistration.Plan) === 'free'
      && [lower(assignedRegistration.Status), lower(assignedRegistration.SubscriptionStatus)].includes('pending trial activation')) {
      const current = await getDocument(platformEnv, 'tenantRegistrations', clean(assignedRegistration.Reference || assignedRegistration.__id));
      if (current && lower(current.Plan) === 'free'
        && [lower(current.Status), lower(current.SubscriptionStatus)].includes('pending trial activation')) {
        const startedAt = new Date();
        const endsAt = new Date(startedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        const trialUpdate = {
          PaymentStatus: 'Free Trial',
          SubscriptionStatus: 'Trialing',
          Status: 'Trial Active',
          TrialStartedAt: startedAt.toISOString(),
          TrialEndsAt: endsAt.toISOString(),
          ProvisioningStatus: 'Ready',
          UpdatedAt: startedAt.toISOString()
        };
        await patchDocumentFieldsIfCurrent(
          platformEnv,
          'tenantRegistrations',
          clean(current.__id || current.Reference),
          trialUpdate,
          current
        );
        assignedRegistration = { ...assignedRegistration, ...trialUpdate };
        await recordTrialUseTombstone(platformEnv, assignedRegistration).catch(() => null);
      }
    }
    let activationIssued = false;
    let activationEmailSent = false;
    try {
      const activation = await issueTenantActivation(platformEnv, assignedRegistration, platformEnv);
      activationIssued = Boolean(activation.issued);
      activationEmailSent = Boolean(activation.emailSent);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'tenant_activation_issue_failed',
        registrationReference: clean(assignedRegistration.Reference || assignedRegistration.__id),
        message: clean(error.message || error).slice(0, 300)
      }));
    }
    assignments.push({
      registrationReference: clean(assignedRegistration.Reference || assignedRegistration.__id),
      workspaceId: clean(assignedRegistration.WorkspaceId),
      portalUrl: clean(assignedRegistration.PortalUrl),
      activationIssued,
      activationEmailSent
    });
  }
  return assignments;
}

export async function releaseTenantProjectSlot(platformEnv, slotId) {
  const id = safeKey(slotId);
  const slot = await getDocument(platformEnv, TENANT_PROJECT_POOL_COLLECTION, id);
  if (!slot) {
    const error = new Error('The project-pool record was not found.');
    error.status = 404;
    throw error;
  }
  const registrationReference = clean(slot.AssignedRegistrationReference);
  if (registrationReference || lower(slot.Status) === 'assigned') {
    const error = new Error('An assigned tenant project cannot return to the ready pool. Retire and delete it so subscriber data is never exposed to another organisation.');
    error.status = 409;
    error.code = 'ASSIGNED_TENANT_REQUIRES_RETIREMENT';
    throw error;
  }
  const now = new Date().toISOString();
  const releasedSlot = {
    ...withoutFirestoreMetadata(slot),
    Status: 'Ready',
    AssignedRegistrationReference: '',
    AssignedOrganisationName: '',
    ReservedAt: '',
    AssignedAt: '',
    LastError: '',
    ReadyAt: now,
    UpdatedAt: now
  };
  const writes = [{
    collectionPath: TENANT_PROJECT_POOL_COLLECTION,
    documentId: id,
    data: releasedSlot,
    updateTime: slot.__updateTime
  }];
  await batchCommitDocuments(platformEnv, writes);
  return publicTenantProjectSlot(releasedSlot);
}
