import {
  getDocument,
  patchDocumentFields,
  queryCollection
} from './firestore.js';
import { patchPagesProductionSecrets } from './cloudflare-pages-secrets.js';
import { revokeGoogleRefreshToken } from './google-email-oauth.js';
import {
  cancelManagedOrganisationEmailDeployment,
  findManagedOrganisationForTenant,
  MANAGED_ORGANISATION_COLLECTION,
  queueManagedOrganisationEmailDeployment
} from './managed-organisations.js';
import { subscriptionAccessState } from './subscription-plans.js';
import {
  assertTenantEmailDeploymentCurrent,
  assertTenantProjectAssignment,
  cancelTenantEmailDeployment,
  queueTenantEmailDeployment
} from './tenant-project-pool.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function portalHost(value) {
  try { return new URL(clean(value)).hostname.toLowerCase(); } catch (_error) { return ''; }
}

export function activeTenantControlRecord(record = {}, now = Date.now()) {
  const states = [record.Status, record.SubscriptionStatus, record.PaymentStatus, record.LifecycleStage].map(lower);
  const blockedStates = new Set([
    'suspended',
    'inactive',
    'expired',
    'trial expired',
    'rejected',
    'cancelled',
    'canceled',
    'retiring',
    'retired',
    'retirement queued',
    'retirement due',
    'terminated',
    'deleted',
    'revoked',
    'failed',
    'provisioning',
    'reserved',
    'requested',
    'payment failed',
    'past due',
    'payment grace',
    'pending',
    'pending activation',
    'pending trial activation'
  ]);
  if (states.some((state) => blockedStates.has(state))) return false;
  const explicitlyActive = states.some((state) => [
    'active',
    'paid',
    'payment confirmed',
    'trial active',
    'trialing',
    'free trial',
    'non-renewing'
  ].includes(state));
  if (!explicitlyActive) return false;
  const access = subscriptionAccessState(record, { now });
  return access.SubscriptionActive === true && access.SubscriptionReadOnly !== true;
}

export async function findTenantEmailControlRegistration(platformEnv, details = {}) {
  const workspaceId = clean(details.workspaceId);
  const host = lower(details.portalHost);
  const rows = await queryCollection(platformEnv, 'tenantRegistrations', {
    filters: [{ field: 'WorkspaceId', op: '==', value: workspaceId }],
    limit: 20
  });
  const registration = rows
    .filter(activeTenantControlRecord)
    .filter((row) => portalHost(row.PortalUrl) === host)
    .sort((left, right) => clean(right.UpdatedAt || right.CreatedAt).localeCompare(clean(left.UpdatedAt || left.CreatedAt)))[0];
  if (registration) {
    return {
      ...registration,
      __controlCollection: 'tenantRegistrations',
      __managedOrganisation: false
    };
  }
  const managed = await findManagedOrganisationForTenant(platformEnv, workspaceId, host);
  if (managed) {
    return {
      ...managed,
      __controlCollection: MANAGED_ORGANISATION_COLLECTION,
      __managedOrganisation: true
    };
  }
  if (!rows.filter(activeTenantControlRecord).length) {
    const error = new Error('This tenant is not attached to an active Dynamax subscription.');
    error.status = 404;
    error.code = 'TENANT_REGISTRATION_NOT_FOUND';
    throw error;
  }
  const error = new Error('The tenant portal does not match the registered workspace.');
  error.status = 409;
  error.code = 'TENANT_PORTAL_MISMATCH';
  throw error;
}

export async function loadStoredTenantEmailRegistration(platformEnv, collection, documentId) {
  if (!['tenantRegistrations', MANAGED_ORGANISATION_COLLECTION].includes(clean(collection))) {
    const error = new Error('The Google connection request has an invalid tenant scope.');
    error.status = 409;
    error.code = 'GOOGLE_EMAIL_OAUTH_TENANT_INVALID';
    throw error;
  }
  const registration = await getDocument(platformEnv, clean(collection), clean(documentId));
  if (!registration || !activeTenantControlRecord(registration)) {
    const error = new Error('The tenant is no longer active.');
    error.status = 409;
    error.code = 'TENANT_REGISTRATION_INACTIVE';
    throw error;
  }
  return {
    ...registration,
    __controlCollection: clean(collection),
    __managedOrganisation: clean(collection) === MANAGED_ORGANISATION_COLLECTION
  };
}

export async function queueTenantEmailProviderDeployment(platformEnv, registration, requestedAt, provider) {
  const project = clean(registration.CloudflareProject);
  if (registration.__managedOrganisation === true) {
    return queueManagedOrganisationEmailDeployment(platformEnv, project, requestedAt, provider);
  }
  return queueTenantEmailDeployment(platformEnv, project, requestedAt, provider, {
    registrationReference: clean(registration.__id || registration.Reference || registration.Id),
    workspaceId: clean(registration.WorkspaceId)
  });
}

export async function updateTenantEmailProviderMetadata(platformEnv, registration, values = {}) {
  const collection = clean(registration.__controlCollection || 'tenantRegistrations');
  const documentId = clean(registration.__id || registration.Reference || registration.Id);
  if (!documentId) {
    const error = new Error('The tenant email-provider registration is invalid.');
    error.status = 409;
    throw error;
  }
  await patchDocumentFields(platformEnv, collection, documentId, values);
}

export async function cancelTenantEmailProviderTransition(
  platformEnv,
  registration,
  requestedAt,
  provider
) {
  const timestamp = clean(requestedAt);
  const targetProvider = lower(provider);
  if (!timestamp || !['brevo', 'gmail'].includes(targetProvider)) return { cancelled: false };
  const project = clean(registration.CloudflareProject);
  if (registration.__managedOrganisation === true) {
    return cancelManagedOrganisationEmailDeployment(
      platformEnv,
      project,
      timestamp,
      targetProvider
    );
  }
  const registrationId = clean(registration.__id || registration.Reference || registration.Id);
  return cancelTenantEmailDeployment(
    platformEnv,
    project,
    timestamp,
    targetProvider,
    {
      registrationReference: registrationId,
      workspaceId: clean(registration.WorkspaceId)
    }
  );
}

export async function assertTenantEmailProjectAssignment(platformEnv, registration) {
  const registrationId = clean(registration.__id || registration.Reference || registration.Id);
  const collection = clean(registration.__controlCollection || 'tenantRegistrations');
  const current = registrationId ? await getDocument(platformEnv, collection, registrationId) : null;
  if (!current || !activeTenantControlRecord(current)) {
    const error = new Error('The tenant subscription is no longer active for provider changes.');
    error.status = 403;
    error.code = 'TENANT_EMAIL_PROVIDER_SUBSCRIPTION_INACTIVE';
    throw error;
  }
  if (clean(current.CloudflareProject) !== clean(registration.CloudflareProject)
      || lower(current.WorkspaceId) !== lower(registration.WorkspaceId)
      || portalHost(current.PortalUrl) !== portalHost(registration.PortalUrl)) {
    const error = new Error('The tenant assignment changed before the provider update could be applied.');
    error.status = 409;
    error.code = 'TENANT_PROJECT_ASSIGNMENT_CHANGED';
    throw error;
  }
  if (registration.__managedOrganisation === true) return true;
  await assertTenantProjectAssignment(platformEnv, clean(registration.CloudflareProject), {
    registrationReference: registrationId,
    workspaceId: clean(registration.WorkspaceId)
  });
  return true;
}

export async function assertTenantEmailTransitionCurrent(
  platformEnv,
  registration,
  requestedAt,
  provider
) {
  await assertTenantEmailProjectAssignment(platformEnv, registration);
  const registrationId = clean(registration.__id || registration.Reference || registration.Id);
  const collection = clean(registration.__controlCollection || 'tenantRegistrations');
  const current = await getDocument(platformEnv, collection, registrationId);
  if (!current
      || clean(current.EmailDeploymentRequestedAt) !== clean(requestedAt)
      || lower(current.EmailProviderPending) !== lower(provider)) {
    const error = new Error('This email-provider transition was superseded before its credentials could be staged.');
    error.status = 409;
    error.code = 'EMAIL_PROVIDER_TRANSITION_SUPERSEDED';
    throw error;
  }
  if (registration.__managedOrganisation === true) {
    if (current.EmailDeploymentPending !== true
        || lower(current.EmailDeploymentProvider) !== lower(provider)) {
      const error = new Error('This email-provider transition was superseded before its credentials could be staged.');
      error.status = 409;
      error.code = 'EMAIL_PROVIDER_TRANSITION_SUPERSEDED';
      throw error;
    }
    return true;
  }
  await assertTenantEmailDeploymentCurrent(platformEnv, clean(registration.CloudflareProject), {
    registrationReference: registrationId,
    workspaceId: clean(registration.WorkspaceId),
    requestedAt: clean(requestedAt),
    provider: lower(provider)
  });
  return true;
}

function brevoSecretValues(requestedAt) {
  return {
    EMAIL_PROVIDER: 'brevo',
    EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT: clean(requestedAt),
    GMAIL_OAUTH_CLIENT_ID: null,
    GMAIL_OAUTH_CLIENT_SECRET: null,
    GMAIL_REFRESH_TOKEN: null,
    GMAIL_CONNECTED_EMAIL: null
  };
}

async function retryTransitionWrite(action, maximum = 3) {
  let failure = null;
  for (let attempt = 0; attempt < maximum; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
  return false;
}

export async function stageBrevoEmailProviderTransition(
  platformEnv,
  env,
  _details,
  registration,
  options = {}
) {
  const patchSecrets = options.patchSecrets || patchPagesProductionSecrets;
  const queueDeployment = options.queueDeployment || queueTenantEmailProviderDeployment;
  const updateMetadata = options.updateMetadata || updateTenantEmailProviderMetadata;
  const cancelDeployment = options.cancelDeployment || cancelTenantEmailProviderTransition;
  const assertAssignment = options.assertAssignment || assertTenantEmailProjectAssignment;
  const assertTransition = options.assertTransition || assertTenantEmailTransitionCurrent;
  const requestedAt = clean(options.requestedAt) || new Date().toISOString();
  let deploymentQueued = false;

  // Persist a deployment outbox before changing the Pages configuration. If a
  // later operation fails, the currently deployed Gmail runtime and its Google
  // grant remain usable and the timestamp mismatch prevents false completion.
  try {
    await assertAssignment(platformEnv, registration);
    await queueDeployment(platformEnv, registration, requestedAt, 'brevo');
    deploymentQueued = true;
    await updateMetadata(platformEnv, registration, {
      EmailProviderPending: 'brevo',
      GmailConnectedEmailPending: '',
      EmailProviderConnectedByPending: 'Tenant Super Administrator',
      EmailProviderTransitionStatus: 'Queued',
      EmailDeploymentQueued: true,
      EmailDeploymentRequestedAt: requestedAt,
      UpdatedAt: requestedAt
    });
    await assertTransition(platformEnv, registration, requestedAt, 'brevo');
  } catch (cause) {
    if (deploymentQueued) {
      await retryTransitionWrite(() => cancelDeployment(
        platformEnv,
        registration,
        requestedAt,
        'brevo'
      )).catch(() => null);
    }
    throw cause;
  }
  try {
    await patchSecrets(env, clean(registration.CloudflareProject), brevoSecretValues(requestedAt));
  } catch (cause) {
    if (cause?.patchOutcomeUncertain === false) {
      await retryTransitionWrite(() => cancelDeployment(
        platformEnv,
        registration,
        requestedAt,
        'brevo'
      )).catch(() => null);
      throw cause;
    }
    return {
      requestedAt,
      provider: 'brevo',
      deploymentQueued: true,
      stagingUnconfirmed: true
    };
  }

  // Do not revoke the live Google grant here: the old production deployment
  // may still need it until the verified Brevo deployment is live. The Gmail
  // credential is removed from Dynamax's staged secrets; an administrator may
  // revoke the remaining Google account grant manually after readiness passes.
  return { requestedAt, provider: 'brevo', deploymentQueued: true };
}

export async function stageGoogleEmailProviderTransition(
  platformEnv,
  env,
  registration,
  connection,
  options = {}
) {
  const patchSecrets = options.patchSecrets || patchPagesProductionSecrets;
  const queueDeployment = options.queueDeployment || queueTenantEmailProviderDeployment;
  const updateMetadata = options.updateMetadata || updateTenantEmailProviderMetadata;
  const cancelDeployment = options.cancelDeployment || cancelTenantEmailProviderTransition;
  const revokeRefreshToken = options.revokeRefreshToken || revokeGoogleRefreshToken;
  const assertAssignment = options.assertAssignment || assertTenantEmailProjectAssignment;
  const assertTransition = options.assertTransition || assertTenantEmailTransitionCurrent;
  const markConnected = options.markConnected || (async () => {});
  const markFailed = options.markFailed || (async () => {});
  const markPending = options.markPending || (async () => {});
  const connectedAt = clean(options.connectedAt) || new Date().toISOString();
  const project = clean(registration.CloudflareProject);
  let pagesPatchAttempted = false;
  let deploymentQueued = false;

  try {
    // The queue and non-secret pending metadata form a durable outbox. They are
    // written before the credential patch, so no failure after a successful
    // Pages update can strand credentials without a deployable transition.
    await assertAssignment(platformEnv, registration);
    await retryTransitionWrite(() => queueDeployment(platformEnv, registration, connectedAt, 'gmail'));
    deploymentQueued = true;
    await retryTransitionWrite(() => updateMetadata(platformEnv, registration, {
      EmailProviderPending: 'gmail',
      GmailConnectedEmailPending: clean(connection.connectedEmail),
      EmailProviderConnectedByPending: 'Tenant Super Administrator',
      EmailProviderTransitionStatus: 'Queued',
      EmailDeploymentQueued: true,
      EmailDeploymentRequestedAt: connectedAt,
      UpdatedAt: connectedAt
    }));
    await assertTransition(platformEnv, registration, connectedAt, 'gmail');
    pagesPatchAttempted = true;
    await patchSecrets(env, project, {
      EMAIL_PROVIDER: 'gmail',
      EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT: connectedAt,
      GMAIL_OAUTH_CLIENT_ID: clean(connection.clientId),
      GMAIL_OAUTH_CLIENT_SECRET: clean(connection.clientSecret),
      GMAIL_REFRESH_TOKEN: clean(connection.refreshToken),
      GMAIL_CONNECTED_EMAIL: clean(connection.connectedEmail)
    });
  } catch (cause) {
    // Before dispatch, or after an authoritative Cloudflare rejection, the new
    // grant cannot be in a tenant deployment and is safe to revoke. A network
    // exception after dispatch is ambiguous, so never revoke or roll back then.
    if (pagesPatchAttempted && cause?.patchOutcomeUncertain !== false) {
      const pendingCode = 'GOOGLE_EMAIL_SECRET_STAGING_UNCONFIRMED';
      let pendingStatePersisted = false;
      try {
        await retryTransitionWrite(() => markPending(pendingCode));
        pendingStatePersisted = true;
      } catch (_stateError) {
        // Processing already claimed the one-use code. The durable outbox and
        // timestamp still keep any eventual deployment safe and verifiable.
      }
      return {
        connectedAt,
        provider: 'gmail',
        deploymentQueued: true,
        stagingUnconfirmed: true,
        oauthStateFinalizationPending: !pendingStatePersisted
      };
    }

    if (deploymentQueued) {
      await retryTransitionWrite(() => cancelDeployment(
        platformEnv,
        registration,
        connectedAt,
        'gmail'
      )).catch(() => null);
    }
    await revokeRefreshToken(connection.refreshToken);
    const failureCode = pagesPatchAttempted
      ? 'GOOGLE_EMAIL_SECRET_STAGING_REJECTED'
      : 'GOOGLE_EMAIL_CONNECTION_OUTBOX_FAILED';
    let failureStatePersisted = false;
    try {
      await markFailed(failureCode);
      failureStatePersisted = true;
    } catch (_stateError) {
      // The callback retries this fixed failure-state write once outside the
      // transition helper. Never persist raw provider errors or credentials.
    }
    const error = new Error(pagesPatchAttempted
      ? 'Cloudflare rejected the Google email credential update. The existing provider was preserved.'
      : 'Google email could not be queued. The existing provider was preserved.');
    error.status = 503;
    error.code = failureCode;
    error.failureStatePersisted = failureStatePersisted;
    error.refreshTokenHandled = true;
    error.cause = cause;
    throw error;
  }

  let oauthStateFinalizationPending = false;
  try {
    await retryTransitionWrite(() => markConnected(connectedAt));
  } catch (_stateError) {
    // Processing already claimed the one-use code, and the durable deployment
    // outbox is complete. Report success rather than inviting a duplicate OAuth
    // exchange while the queued deployment can safely finish.
    oauthStateFinalizationPending = true;
  }
  return {
    connectedAt,
    provider: 'gmail',
    deploymentQueued: true,
    oauthStateFinalizationPending
  };
}
