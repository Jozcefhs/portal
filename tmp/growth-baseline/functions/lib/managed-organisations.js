import {
  getDocument,
  listCollection,
  patchDocumentFieldsIfCurrent,
  upsertDocument
} from './firestore.js';
import { normalizeOrganizationEdition } from './organization-config.js';
import { validTenantControlPublicKey } from './tenant-control-plane.js';

export const MANAGED_ORGANISATION_COLLECTION = 'managedOrganisations';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function safeProject(value) {
  const project = lower(value);
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(project) ? project : '';
}

function safeWorkspace(value) {
  const workspace = lower(value);
  return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(workspace) ? workspace : '';
}

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

function requiredPortalUrl(value, project) {
  let url;
  try { url = new URL(clean(value)); } catch (_error) { url = null; }
  if (!url || url.protocol !== 'https:' || !url.hostname) {
    const error = new Error('A valid HTTPS managed-organisation portal URL is required.');
    error.status = 400;
    throw error;
  }
  if (url.hostname.toLowerCase() !== `${project}.pages.dev`) {
    const error = new Error('The managed-organisation portal must match its Cloudflare Pages project.');
    error.status = 409;
    throw error;
  }
  return url.origin;
}

function publicManagedOrganisation(row = {}) {
  return {
    Id: clean(row.Id || row.__id),
    OrganisationName: clean(row.OrganisationName),
    Edition: normalizeOrganizationEdition(row.Edition),
    WorkspaceId: clean(row.WorkspaceId),
    CloudflareProject: clean(row.CloudflareProject),
    PortalUrl: clean(row.PortalUrl),
    Status: clean(row.Status || 'Active'),
    TenantControlKeyConfigured: validTenantControlPublicKey(row.TenantControlPublicKey),
    PaystackConnected: row.PaystackConnected === true,
    PaystackMode: clean(row.PaystackMode || 'not-configured'),
    PaystackDeploymentPending: row.PaystackDeploymentPending === true,
    PaystackDeploymentRequestedAt: clean(row.PaystackDeploymentRequestedAt),
    EmailDeploymentPending: row.EmailDeploymentPending === true,
    EmailDeploymentRequestedAt: clean(row.EmailDeploymentRequestedAt),
    EmailDeploymentProvider: clean(row.EmailDeploymentProvider).toLowerCase(),
    UpdatedAt: clean(row.UpdatedAt || row.__updateTime || row.CreatedAt)
  };
}

async function managedOrganisationByProject(platformEnv, projectId) {
  const project = safeProject(projectId);
  if (!project) return null;
  const direct = await getDocument(platformEnv, MANAGED_ORGANISATION_COLLECTION, project);
  if (direct && safeProject(direct.CloudflareProject || direct.Id || direct.__id) === project) return direct;
  const rows = await listCollection(platformEnv, MANAGED_ORGANISATION_COLLECTION, { pageSize: 250, maxPages: 4 });
  return rows.find((row) => safeProject(row.CloudflareProject) === project) || null;
}

export async function loadManagedOrganisations(platformEnv) {
  const rows = await listCollection(platformEnv, MANAGED_ORGANISATION_COLLECTION, {
    pageSize: 250,
    maxPages: 4
  }).catch(() => []);
  return rows.map(publicManagedOrganisation).sort((left, right) => (
    left.OrganisationName.localeCompare(right.OrganisationName) || left.CloudflareProject.localeCompare(right.CloudflareProject)
  ));
}

export async function saveManagedOrganisationControlIdentity(platformEnv, value = {}) {
  const project = safeProject(value.CloudflareProject || value.projectId);
  const workspaceId = safeWorkspace(value.WorkspaceId);
  if (!project || !workspaceId) {
    const error = new Error('A valid managed Cloudflare project and workspace ID are required.');
    error.status = 400;
    throw error;
  }
  const current = await managedOrganisationByProject(platformEnv, project);
  const tenantControlPublicKey = clean(value.TenantControlPublicKey || current?.TenantControlPublicKey);
  if (!validTenantControlPublicKey(tenantControlPublicKey)) {
    const error = new Error('A valid managed-organisation control-plane public key is required.');
    error.status = 400;
    throw error;
  }
  const portalUrl = requiredPortalUrl(value.PortalUrl || current?.PortalUrl || `https://${project}.pages.dev`, project);
  const requestedAt = clean(value.requestedAt) || new Date().toISOString();
  const markDeploymentPending = value.markDeploymentPending === true || value.resetPaystackConnection === true;
  const document = {
    ...(current ? withoutFirestoreMetadata(current) : {}),
    Id: project,
    OrganisationName: clean(value.OrganisationName || current?.OrganisationName || project),
    Edition: normalizeOrganizationEdition(value.Edition || current?.Edition),
    WorkspaceId: workspaceId,
    CloudflareProject: project,
    PortalUrl: portalUrl,
    Status: 'Active',
    TenantControlPublicKey: tenantControlPublicKey,
    TenantControlKeyUpdatedAt: requestedAt,
    UpdatedAt: requestedAt,
    CreatedAt: clean(current?.CreatedAt || requestedAt)
  };
  if (markDeploymentPending) {
    document.PaystackDeploymentPending = true;
    document.PaystackDeploymentRequestedAt = requestedAt;
  }
  if (value.resetPaystackConnection === true) {
    document.PaystackConnected = false;
    document.PaystackMode = 'not-configured';
    document.PaystackConnectedAt = '';
    document.PaystackConnectedBy = '';
  }
  await upsertDocument(platformEnv, MANAGED_ORGANISATION_COLLECTION, project, document);
  return publicManagedOrganisation(document);
}

export async function findManagedOrganisationForTenant(platformEnv, workspaceId, portalHost) {
  const workspace = safeWorkspace(workspaceId);
  const host = lower(portalHost);
  if (!workspace || !host) return null;
  const rows = await listCollection(platformEnv, MANAGED_ORGANISATION_COLLECTION, {
    pageSize: 250,
    maxPages: 4
  }).catch(() => []);
  return rows
    .filter((row) => lower(row.Status || 'active') === 'active')
    .filter((row) => safeWorkspace(row.WorkspaceId) === workspace)
    .filter((row) => {
      try { return new URL(clean(row.PortalUrl)).hostname.toLowerCase() === host; } catch (_error) { return false; }
    })
    .sort((left, right) => clean(right.UpdatedAt || right.CreatedAt).localeCompare(clean(left.UpdatedAt || left.CreatedAt)))[0] || null;
}

export async function queueManagedOrganisationPaystackDeployment(platformEnv, projectId, requestedAt = new Date().toISOString()) {
  const current = await managedOrganisationByProject(platformEnv, projectId);
  if (!current) {
    const error = new Error('The managed organisation was not found.');
    error.status = 404;
    throw error;
  }
  const timestamp = clean(requestedAt) || new Date().toISOString();
  await patchDocumentFieldsIfCurrent(platformEnv, MANAGED_ORGANISATION_COLLECTION, clean(current.__id || current.Id), {
    PaystackDeploymentPending: true,
    PaystackDeploymentRequestedAt: timestamp,
    UpdatedAt: timestamp
  }, current);
  return publicManagedOrganisation({
    ...current,
    PaystackDeploymentPending: true,
    PaystackDeploymentRequestedAt: timestamp,
    UpdatedAt: timestamp
  });
}

export async function completeManagedOrganisationPaystackDeployment(platformEnv, projectId, requestedAt) {
  const current = await managedOrganisationByProject(platformEnv, projectId);
  if (!current) {
    const error = new Error('The managed organisation was not found.');
    error.status = 404;
    throw error;
  }
  const expectedRequest = clean(requestedAt);
  if (!expectedRequest || clean(current.PaystackDeploymentRequestedAt) !== expectedRequest) {
    return { completed: false, organisation: publicManagedOrganisation(current) };
  }
  const completedAt = new Date().toISOString();
  try {
    await patchDocumentFieldsIfCurrent(platformEnv, MANAGED_ORGANISATION_COLLECTION, clean(current.__id || current.Id), {
      PaystackDeploymentPending: false,
      PaystackDeploymentCompletedAt: completedAt,
      UpdatedAt: completedAt
    }, current);
  } catch (error) {
    if (error?.code !== 'FIRESTORE_WRITE_CONFLICT') throw error;
    const latest = await managedOrganisationByProject(platformEnv, projectId);
    if (!latest || clean(latest.PaystackDeploymentRequestedAt) !== expectedRequest) {
      return { completed: false, organisation: publicManagedOrganisation(latest || {}) };
    }
    await patchDocumentFieldsIfCurrent(platformEnv, MANAGED_ORGANISATION_COLLECTION, clean(latest.__id || latest.Id), {
      PaystackDeploymentPending: false,
      PaystackDeploymentCompletedAt: completedAt,
      UpdatedAt: completedAt
    }, latest);
  }
  return {
    completed: true,
    organisation: publicManagedOrganisation({ ...current, PaystackDeploymentPending: false, UpdatedAt: completedAt })
  };
}

export async function queueManagedOrganisationEmailDeployment(platformEnv, projectId, requestedAt = new Date().toISOString(), provider = '') {
  const current = await managedOrganisationByProject(platformEnv, projectId);
  if (!current) {
    const error = new Error('The managed organisation was not found.');
    error.status = 404;
    throw error;
  }
  const timestamp = clean(requestedAt) || new Date().toISOString();
  const targetProvider = ['brevo', 'gmail'].includes(lower(provider)) ? lower(provider) : '';
  if (!targetProvider) {
    const error = new Error('A valid target email provider is required for deployment.');
    error.status = 400;
    throw error;
  }
  if (current.EmailDeploymentPending === true) {
    const sameTransition = clean(current.EmailDeploymentRequestedAt) === timestamp
      && lower(current.EmailDeploymentProvider) === targetProvider;
    if (sameTransition) return publicManagedOrganisation(current);
    const error = new Error('Another email-provider transition is still being deployed. Wait for it to finish before starting another.');
    error.status = 409;
    error.code = 'EMAIL_PROVIDER_TRANSITION_IN_PROGRESS';
    throw error;
  }
  await patchDocumentFieldsIfCurrent(platformEnv, MANAGED_ORGANISATION_COLLECTION, clean(current.__id || current.Id), {
    EmailDeploymentPending: true,
    EmailDeploymentRequestedAt: timestamp,
    EmailDeploymentProvider: targetProvider,
    UpdatedAt: timestamp
  }, current);
  return publicManagedOrganisation({
    ...current,
    EmailDeploymentPending: true,
    EmailDeploymentRequestedAt: timestamp,
    EmailDeploymentProvider: targetProvider,
    UpdatedAt: timestamp
  });
}

function cancelledEmailProviderFields(requestedAt, provider, cancelledAt) {
  return {
    EmailDeploymentPending: false,
    EmailDeploymentQueued: false,
    EmailDeploymentRequestedAt: '',
    EmailDeploymentProvider: '',
    EmailProviderPending: '',
    GmailConnectedEmailPending: '',
    EmailProviderConnectedByPending: '',
    EmailProviderTransitionStatus: 'Cancelled',
    EmailDeploymentCancelledRequestedAt: requestedAt,
    EmailDeploymentCancelledProvider: provider,
    EmailDeploymentCancelledAt: cancelledAt,
    UpdatedAt: cancelledAt
  };
}

function emailTransitionSupersededError() {
  const error = new Error('This email-provider transition was superseded before it could be cancelled.');
  error.status = 409;
  error.code = 'EMAIL_PROVIDER_TRANSITION_SUPERSEDED';
  return error;
}

export async function cancelManagedOrganisationEmailDeployment(
  platformEnv,
  projectId,
  requestedAt,
  provider = ''
) {
  const expectedRequest = clean(requestedAt);
  const expectedProvider = lower(provider);
  if (!expectedRequest || !['brevo', 'gmail'].includes(expectedProvider)) {
    const error = new Error('A valid email-provider transition is required for cancellation.');
    error.status = 400;
    throw error;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await managedOrganisationByProject(platformEnv, projectId);
    if (!current) {
      const error = new Error('The managed organisation was not found.');
      error.status = 404;
      throw error;
    }

    if (current.EmailDeploymentPending !== true) {
      const alreadyCancelled = clean(current.EmailDeploymentCancelledRequestedAt) === expectedRequest
        && lower(current.EmailDeploymentCancelledProvider) === expectedProvider;
      return {
        cancelled: false,
        alreadyCancelled,
        organisation: publicManagedOrganisation(current)
      };
    }

    if (clean(current.EmailDeploymentRequestedAt) !== expectedRequest
        || lower(current.EmailDeploymentProvider) !== expectedProvider) {
      throw emailTransitionSupersededError();
    }

    // A queue write intentionally happens before the provider metadata write.
    // An empty pending provider is therefore safe to cancel; a different one
    // indicates a mismatched active transition and must never be cleared.
    const pendingProvider = lower(current.EmailProviderPending);
    if (pendingProvider && pendingProvider !== expectedProvider) {
      throw emailTransitionSupersededError();
    }

    const cancelledAt = new Date().toISOString();
    const fields = cancelledEmailProviderFields(expectedRequest, expectedProvider, cancelledAt);
    try {
      await patchDocumentFieldsIfCurrent(
        platformEnv,
        MANAGED_ORGANISATION_COLLECTION,
        clean(current.__id || current.Id),
        fields,
        current
      );
      return {
        cancelled: true,
        alreadyCancelled: false,
        organisation: publicManagedOrganisation({ ...current, ...fields })
      };
    } catch (error) {
      if (error?.code !== 'FIRESTORE_WRITE_CONFLICT' || attempt > 0) throw error;
    }
  }

  throw emailTransitionSupersededError();
}

function completedEmailProviderFields(record, provider, completedAt) {
  return {
    EmailProvider: provider,
    GmailConnectedEmail: provider === 'gmail' ? clean(record.GmailConnectedEmailPending) : '',
    EmailProviderConnectedAt: completedAt,
    EmailProviderConnectedBy: clean(record.EmailProviderConnectedByPending || 'Tenant Super Administrator'),
    EmailProviderPending: '',
    GmailConnectedEmailPending: '',
    EmailProviderConnectedByPending: '',
    EmailProviderTransitionStatus: 'Connected',
    EmailProviderFailureCode: '',
    EmailDeploymentPending: false,
    EmailDeploymentQueued: false,
    EmailDeploymentCompletedAt: completedAt,
    UpdatedAt: completedAt
  };
}

export async function completeManagedOrganisationEmailDeployment(platformEnv, projectId, requestedAt, provider = '') {
  const current = await managedOrganisationByProject(platformEnv, projectId);
  if (!current) {
    const error = new Error('The managed organisation was not found.');
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
  if (!expectedRequest || clean(current.EmailDeploymentRequestedAt) !== expectedRequest
      || lower(current.EmailDeploymentProvider) !== expectedProvider) {
    return { completed: false, organisation: publicManagedOrganisation(current) };
  }
  const completedAt = new Date().toISOString();
  try {
    await patchDocumentFieldsIfCurrent(
      platformEnv,
      MANAGED_ORGANISATION_COLLECTION,
      clean(current.__id || current.Id),
      completedEmailProviderFields(current, expectedProvider, completedAt),
      current
    );
  } catch (error) {
    if (error?.code !== 'FIRESTORE_WRITE_CONFLICT') throw error;
    const latest = await managedOrganisationByProject(platformEnv, projectId);
    if (!latest || clean(latest.EmailDeploymentRequestedAt) !== expectedRequest
        || lower(latest.EmailDeploymentProvider) !== expectedProvider) {
      return { completed: false, organisation: publicManagedOrganisation(latest || {}) };
    }
    await patchDocumentFieldsIfCurrent(
      platformEnv,
      MANAGED_ORGANISATION_COLLECTION,
      clean(latest.__id || latest.Id),
      completedEmailProviderFields(latest, expectedProvider, completedAt),
      latest
    );
  }
  return {
    completed: true,
    organisation: publicManagedOrganisation({
      ...current,
      ...completedEmailProviderFields(current, expectedProvider, completedAt),
      EmailDeploymentPending: false,
      EmailDeploymentQueued: false,
      UpdatedAt: completedAt
    })
  };
}
