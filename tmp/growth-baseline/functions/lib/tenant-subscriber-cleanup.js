import { batchCommitDocuments, listCollection } from './firestore.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const compactKey = (value) => lower(value).replace(/[^a-z0-9]/g, '');

export const TENANT_SUBSCRIBER_CLEANUP_CONFIRMATION = 'DELETE ALL NONCORE SUBSCRIBERS';
export const CORE_TENANT_PROJECTS = Object.freeze(['destinychristianacademy', 'digc-suite']);

const CORE_WORKSPACES = new Set([...CORE_TENANT_PROJECTS, 'school', 'faith']);
const CORE_ORGANISATIONS = new Set([
  'destinychristianacademy',
  'dunamisinternationalgospelcentre'
]);

const CLEANUP_COLLECTIONS = Object.freeze([
  'tenantRegistrations',
  'tenantProjectPool',
  'tenantActivations',
  'subscriptionPayments',
  'tenantRetirementRequests',
  'tenantLifecycleEmailDeliveries',
  'tenantProvisioningRequests',
  'tenantTrialTombstones'
]);

function documentId(value = {}) {
  return clean(value.__id || value.Reference || value.Id || value.DeliveryId || value.ActivationId);
}

function isCoreRegistration(registration = {}) {
  const identifiers = [
    registration.WorkspaceId,
    registration.FirebaseProjectId,
    registration.CloudflareProject
  ].map(lower).filter(Boolean);
  return identifiers.some((value) => CORE_WORKSPACES.has(value))
    || CORE_ORGANISATIONS.has(compactKey(registration.OrganisationName));
}

function safeExternalTenantProject(value) {
  const project = lower(value);
  return /^dynamax-tenant-[a-z0-9-]{1,64}$/.test(project) ? project : '';
}

function referencesRegistration(row = {}, registrationReferences = new Set()) {
  return [
    row.RegistrationReference,
    row.AssignedRegistrationReference
  ].map(clean).some((value) => value && registrationReferences.has(value));
}

function referencesProject(row = {}, projects = new Set()) {
  return [
    row.WorkspaceId,
    row.FirebaseProjectId,
    row.CloudflareProject,
    row.RequestedProjectId
  ].map(lower).some((value) => value && projects.has(value));
}

function publicRegistration(registration = {}) {
  return {
    Reference: clean(registration.Reference || registration.__id),
    OrganisationName: clean(registration.OrganisationName),
    Plan: clean(registration.Plan),
    Status: clean(registration.SubscriptionStatus || registration.Status),
    WorkspaceId: clean(registration.WorkspaceId),
    FirebaseProjectId: clean(registration.FirebaseProjectId),
    CloudflareProject: clean(registration.CloudflareProject)
  };
}

function publicProject(slot = {}, project = '') {
  return {
    ProjectSlotId: documentId(slot),
    FirebaseProjectId: clean(slot.FirebaseProjectId || project),
    CloudflareProject: clean(slot.CloudflareProject || project),
    RegistrationReference: clean(slot.AssignedRegistrationReference),
    OrganisationName: clean(slot.AssignedOrganisationName),
    Status: clean(slot.Status)
  };
}

export function buildNonCoreSubscriberCleanupPlan(inventory = {}) {
  const registrations = Array.isArray(inventory.tenantRegistrations) ? inventory.tenantRegistrations : [];
  const slots = Array.isArray(inventory.tenantProjectPool) ? inventory.tenantProjectPool : [];
  const targets = registrations.filter((registration) => !isCoreRegistration(registration));
  const registrationReferences = new Set(targets.map(documentId).filter(Boolean));
  const registrationFingerprints = new Set(targets.map((row) => clean(row.TrialFingerprint)).filter(Boolean));
  const registrationProjects = new Set(targets.flatMap((row) => [
    safeExternalTenantProject(row.WorkspaceId),
    safeExternalTenantProject(row.FirebaseProjectId),
    safeExternalTenantProject(row.CloudflareProject)
  ]).filter(Boolean));
  const targetSlots = slots.filter((slot) => {
    if (CORE_WORKSPACES.has(lower(slot.FirebaseProjectId)) || CORE_WORKSPACES.has(lower(slot.CloudflareProject))) return false;
    return referencesRegistration(slot, registrationReferences)
      || registrationProjects.has(lower(slot.FirebaseProjectId))
      || registrationProjects.has(lower(slot.CloudflareProject));
  });
  targetSlots.forEach((slot) => {
    const firebaseProject = safeExternalTenantProject(slot.FirebaseProjectId);
    const cloudflareProject = safeExternalTenantProject(slot.CloudflareProject);
    if (firebaseProject) registrationProjects.add(firebaseProject);
    if (cloudflareProject) registrationProjects.add(cloudflareProject);
  });

  const writes = [];
  targets.forEach((row) => writes.push({ collectionPath: 'tenantRegistrations', documentId: documentId(row), operation: 'delete' }));
  targetSlots.forEach((row) => writes.push({ collectionPath: 'tenantProjectPool', documentId: documentId(row), operation: 'delete' }));

  const dependentCollections = [
    'tenantActivations',
    'subscriptionPayments',
    'tenantRetirementRequests',
    'tenantLifecycleEmailDeliveries',
    'tenantProvisioningRequests'
  ];
  dependentCollections.forEach((collectionPath) => {
    const rows = Array.isArray(inventory[collectionPath]) ? inventory[collectionPath] : [];
    rows.filter((row) => (
      referencesRegistration(row, registrationReferences)
      || referencesProject(row, registrationProjects)
    )).forEach((row) => writes.push({ collectionPath, documentId: documentId(row), operation: 'delete' }));
  });
  (Array.isArray(inventory.tenantTrialTombstones) ? inventory.tenantTrialTombstones : [])
    .filter((row) => registrationFingerprints.has(clean(row.TrialFingerprint || row.__id)))
    .forEach((row) => writes.push({ collectionPath: 'tenantTrialTombstones', documentId: documentId(row), operation: 'delete' }));

  const uniqueWrites = [...new Map(writes
    .filter((row) => row.collectionPath && row.documentId)
    .map((row) => [`${row.collectionPath}/${row.documentId}`, row])).values()];
  const externalProjects = [...registrationProjects].sort((left, right) => left.localeCompare(right));
  const projectRows = externalProjects.map((project) => {
    const slot = targetSlots.find((row) => (
      lower(row.FirebaseProjectId) === project || lower(row.CloudflareProject) === project
    ));
    return publicProject(slot || {}, project);
  });
  return {
    PreservedProjects: [...CORE_TENANT_PROJECTS],
    Registrations: targets.map(publicRegistration),
    ExternalProjects: projectRows,
    DeleteCounts: Object.fromEntries(CLEANUP_COLLECTIONS.map((collectionPath) => [
      collectionPath,
      uniqueWrites.filter((row) => row.collectionPath === collectionPath).length
    ])),
    writes: uniqueWrites
  };
}

async function loadCollection(platformEnv, collectionPath) {
  return listCollection(platformEnv, collectionPath, { pageSize: 1000, maxPages: 25 }).catch((error) => {
    if (Number(error?.status) === 404) return [];
    throw error;
  });
}

export async function loadNonCoreSubscriberCleanupPlan(platformEnv) {
  const rows = await Promise.all(CLEANUP_COLLECTIONS.map(async (collectionPath) => [
    collectionPath,
    await loadCollection(platformEnv, collectionPath)
  ]));
  return buildNonCoreSubscriberCleanupPlan(Object.fromEntries(rows));
}

function publicCleanupPlan(plan = {}) {
  const { writes: _writes, ...result } = plan;
  return result;
}

export async function previewNonCoreSubscriberCleanup(platformEnv) {
  return publicCleanupPlan(await loadNonCoreSubscriberCleanupPlan(platformEnv));
}

export async function completeNonCoreSubscriberCleanup(platformEnv, request = {}) {
  if (clean(request.confirmation) !== TENANT_SUBSCRIBER_CLEANUP_CONFIRMATION) {
    const error = new Error(`Enter ${TENANT_SUBSCRIBER_CLEANUP_CONFIRMATION} to confirm this cleanup.`);
    error.status = 400;
    throw error;
  }
  const plan = await loadNonCoreSubscriberCleanupPlan(platformEnv);
  const expectedProjects = Array.isArray(request.externalProjects)
    ? request.externalProjects.map(lower).filter(Boolean).sort((left, right) => left.localeCompare(right))
    : [];
  const plannedProjects = plan.ExternalProjects.map((row) => lower(row.FirebaseProjectId || row.CloudflareProject))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(expectedProjects) !== JSON.stringify(plannedProjects)) {
    const error = new Error('The live tenant cleanup plan changed. Run the preview again before deleting anything.');
    error.status = 409;
    throw error;
  }
  for (let index = 0; index < plan.writes.length; index += 450) {
    await batchCommitDocuments(platformEnv, plan.writes.slice(index, index + 450));
  }
  return publicCleanupPlan(plan);
}
