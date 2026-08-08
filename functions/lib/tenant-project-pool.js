import {
  batchCommitDocuments,
  createDocumentIfAbsent,
  getDocument,
  listCollection,
  patchDocumentFieldsIfCurrent,
  upsertDocument
} from './firestore.js';
import { normalizeOrganizationEdition } from './organization-config.js';
import { issueTenantActivation } from './tenant-activation.js';

export const TENANT_PROJECT_POOL_COLLECTION = 'tenantProjectPool';
export const TENANT_PROVISIONING_REQUEST_COLLECTION = 'tenantProvisioningRequests';
const POOL_POLICY_COLLECTION = 'settings';
const POOL_POLICY_DOCUMENT = 'tenantPoolPolicy';
const DEFAULT_READY_TARGET = 2;

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

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

function poolEdition(value) {
  return normalizeOrganizationEdition(value);
}

function activeRegistration(registration = {}) {
  const statuses = [
    registration.Status,
    registration.PaymentStatus,
    registration.SubscriptionStatus
  ].map(lower);
  return statuses.some((status) => [
    'active', 'paid', 'payment confirmed', 'trial active', 'trialing'
  ].includes(status));
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
    LastError: clean(slot.LastError),
    ProvisioningBatchId: clean(slot.ProvisioningBatchId),
    UpdatedAt: clean(slot.UpdatedAt || slot.__updateTime || slot.CreatedAt)
  };
}

export function normalizeTenantPoolPolicy(value = {}) {
  const targets = value.TargetReadyPerEdition || {};
  return {
    TargetReadyPerEdition: {
      school: positiveInteger(targets.school, DEFAULT_READY_TARGET, 20),
      faith: positiveInteger(targets.faith, DEFAULT_READY_TARGET, 20),
      organization: positiveInteger(targets.organization, DEFAULT_READY_TARGET, 20)
    },
    DefaultRegion: clean(value.DefaultRegion || 'eur3'),
    ProjectPrefix: safeKey(value.ProjectPrefix, 'dynamax-tenant').slice(0, 18),
    UpdatedAt: clean(value.UpdatedAt)
  };
}

export async function loadTenantPoolPolicy(platformEnv) {
  return normalizeTenantPoolPolicy(
    await getDocument(platformEnv, POOL_POLICY_COLLECTION, POOL_POLICY_DOCUMENT).catch(() => null) || {}
  );
}

export async function saveTenantPoolPolicy(platformEnv, value = {}) {
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

export async function loadTenantProjectPool(platformEnv) {
  const [slotRows, requestRows, policy] = await Promise.all([
    listCollection(platformEnv, TENANT_PROJECT_POOL_COLLECTION, { pageSize: 1000, maxPages: 10 }).catch(() => []),
    listCollection(platformEnv, TENANT_PROVISIONING_REQUEST_COLLECTION, { pageSize: 500, maxPages: 10 }).catch(() => []),
    loadTenantPoolPolicy(platformEnv)
  ]);
  const slots = slotRows.map(publicTenantProjectSlot).sort((left, right) => (
    left.Edition.localeCompare(right.Edition)
      || left.Status.localeCompare(right.Status)
      || left.Id.localeCompare(right.Id)
  ));
  const requests = requestRows.map((request) => ({
    Reference: clean(request.Reference || request.__id),
    Edition: poolEdition(request.Edition),
    Mode: lower(request.Mode) === 'branded' ? 'branded' : 'pool',
    Count: positiveInteger(request.Count, 1, 20),
    RequestedProjectId: clean(request.RequestedProjectId),
    Status: clean(request.Status || 'Pending'),
    RequestedAt: clean(request.RequestedAt || request.CreatedAt),
    RequestedBy: clean(request.RequestedBy),
    LastError: clean(request.LastError)
  })).sort((left, right) => right.RequestedAt.localeCompare(left.RequestedAt));
  return { slots, requests, policy, summary: poolSummary(slots, policy) };
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
    const error = new Error('An assigned or reserved project cannot be replaced. Release it first.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
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
    LastError: clean(value.LastError),
    ReadyAt: lower(value.Status || 'Ready') === 'ready' ? clean(current?.ReadyAt || now) : clean(current?.ReadyAt),
    CreatedAt: clean(current?.CreatedAt || now),
    UpdatedAt: now
  };
  await upsertDocument(platformEnv, TENANT_PROJECT_POOL_COLLECTION, id, slot);
  return publicTenantProjectSlot(slot);
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
    LastError: clean(request.LastError)
  };
}

export async function claimNextTenantProvisioningRequest(platformEnv, runnerId = '') {
  const staleBefore = Date.now() - (90 * 60 * 1000);
  const requests = (await listCollection(platformEnv, TENANT_PROVISIONING_REQUEST_COLLECTION, {
    pageSize: 250,
    maxPages: 4
  }))
    .filter((request) => lower(request.Status) === 'pending'
      || (lower(request.Status) === 'provisioning'
        && Date.parse(clean(request.StartedAt)) < staleBefore))
    .sort((left, right) => clean(left.RequestedAt || left.CreatedAt).localeCompare(clean(right.RequestedAt || right.CreatedAt)));

  for (const request of requests) {
    const now = new Date().toISOString();
    const claimed = {
      ...withoutFirestoreMetadata(request),
      Status: 'Provisioning',
      RunnerId: clean(runnerId || `runner-${crypto.randomUUID()}`),
      StartedAt: now,
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
  const status = lower(value.Status) === 'completed' ? 'Completed' : 'Failed';
  const now = new Date().toISOString();
  const completed = {
    ...withoutFirestoreMetadata(request),
    Status: status,
    CompletedAt: now,
    LastError: status === 'Failed' ? clean(value.LastError || value.error || 'Provisioning failed.') : '',
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
  const queued = [];
  for (const edition of editions) {
    const ready = slotRows.filter((slot) => poolEdition(slot.Edition) === edition && lower(slot.Status) === 'ready').length;
    const inFlight = requestRows
      .filter((request) => poolEdition(request.Edition) === edition && ['pending', 'provisioning'].includes(lower(request.Status)))
      .reduce((total, request) => total + positiveInteger(request.Count, 1, 20), 0);
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
  const registration = registrationReference
    ? await getDocument(platformEnv, 'tenantRegistrations', registrationReference)
    : null;
  if (registration && activeRegistration(registration)) {
    const error = new Error('This project belongs to an active or paid subscriber and cannot be released.');
    error.status = 409;
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
  if (registration) {
    writes.push({
      collectionPath: 'tenantRegistrations',
      documentId: registrationReference,
      data: {
        ...withoutFirestoreMetadata(registration),
        WorkspaceId: '',
        ProjectSlotId: '',
        FirebaseProjectId: '',
        CloudflareProject: '',
        PortalUrl: '',
        ProvisioningStatus: 'Project released',
        UpdatedAt: now
      },
      updateTime: registration.__updateTime
    });
  }
  await batchCommitDocuments(platformEnv, writes);
  return publicTenantProjectSlot(releasedSlot);
}
