import { getDocument } from './firestore.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { refreshOrganizationPlanPolicy } from './plan-policy-sync.js';

const clean = (value) => String(value ?? '').trim();
const ALLOWED_DEPLOYMENT_EDITIONS = new Set(['school', 'faith', 'organization']);
const EDITION_ALIASES = new Map([
  ['church', 'faith']
]);

let cachedIdentity = null;

function identityError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function canonicalDeploymentEdition(value, { required = true, label = 'ORGANISATION_EDITION' } = {}) {
  const raw = clean(value).toLowerCase();
  if (!raw) {
    if (!required) return '';
    throw identityError(
      `Deployment identity is not configured. Add ${label} in Cloudflare.`,
      503,
      'DEPLOYMENT_EDITION_NOT_CONFIGURED'
    );
  }
  const canonical = EDITION_ALIASES.get(raw) || raw;
  if (!ALLOWED_DEPLOYMENT_EDITIONS.has(canonical)) {
    throw identityError(
      `${label} must be school, faith, organization, or the church alias.`,
      503,
      'DEPLOYMENT_EDITION_INVALID'
    );
  }
  return canonical;
}

export function normalizeWorkspaceId(value) {
  return clean(value).toLowerCase();
}

function requiredWorkspaceId(value, label = 'DYNAMAX_WORKSPACE_ID') {
  const workspaceId = normalizeWorkspaceId(value);
  if (!workspaceId) {
    throw identityError(
      `Deployment identity is not configured. Add ${label} in Cloudflare.`,
      503,
      'DEPLOYMENT_WORKSPACE_NOT_CONFIGURED'
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(workspaceId)) {
    throw identityError(
      `${label} must use only lowercase letters, numbers, dots, underscores, or hyphens.`,
      503,
      'DEPLOYMENT_WORKSPACE_INVALID'
    );
  }
  return workspaceId;
}

export function requiredDeploymentIdentity(env = {}) {
  const britishEdition = clean(env.ORGANISATION_EDITION);
  const americanEdition = clean(env.ORGANIZATION_EDITION);
  if (britishEdition && americanEdition
    && canonicalDeploymentEdition(britishEdition) !== canonicalDeploymentEdition(americanEdition)) {
    throw identityError(
      'ORGANISATION_EDITION and ORGANIZATION_EDITION identify different deployments.',
      503,
      'DEPLOYMENT_EDITION_CONFLICT'
    );
  }
  return Object.freeze({
    workspaceId: requiredWorkspaceId(env.DYNAMAX_WORKSPACE_ID),
    edition: canonicalDeploymentEdition(britishEdition || americanEdition)
  });
}

function expectedValue(source, names) {
  for (const name of names) {
    const value = clean(source?.[name]);
    if (value) return value;
  }
  return '';
}

export function assertExpectedDeploymentIdentity(env = {}, expected = {}) {
  const identity = requiredDeploymentIdentity(env);
  const expectedWorkspaceId = expectedValue(expected, ['ExpectedWorkspaceId', 'expectedWorkspaceId']);
  const expectedEdition = expectedValue(expected, [
    'ExpectedOrganisationEdition',
    'expectedOrganisationEdition',
    'ExpectedOrganizationEdition',
    'expectedOrganizationEdition'
  ]);
  if (!expectedWorkspaceId) {
    throw identityError(
      'ExpectedWorkspaceId is required for desktop backend requests.',
      400,
      'EXPECTED_WORKSPACE_REQUIRED'
    );
  }
  if (!expectedEdition) {
    throw identityError(
      'ExpectedOrganisationEdition is required for desktop backend requests.',
      400,
      'EXPECTED_EDITION_REQUIRED'
    );
  }
  if (normalizeWorkspaceId(expectedWorkspaceId) !== identity.workspaceId) {
    throw identityError(
      'This desktop workspace is connected to a different backend workspace.',
      409,
      'DEPLOYMENT_WORKSPACE_MISMATCH'
    );
  }
  const canonicalExpectedEdition = canonicalDeploymentEdition(expectedEdition, {
    label: 'ExpectedOrganisationEdition'
  });
  if (canonicalExpectedEdition !== identity.edition) {
    throw identityError(
      'This desktop workspace is connected to a different organisation edition.',
      409,
      'DEPLOYMENT_EDITION_MISMATCH'
    );
  }
  return identity;
}

export function assertDeploymentEditionSelection(identity, requestedEdition) {
  const requested = clean(requestedEdition);
  if (!requested) return identity.edition;
  const canonical = canonicalDeploymentEdition(requested, {
    label: 'OrganisationEdition'
  });
  if (canonical !== identity.edition) {
    throw identityError(
      `This deployment is permanently bound to the ${identity.edition} edition.`,
      409,
      'DEPLOYMENT_EDITION_BOUND'
    );
  }
  return identity.edition;
}

export function deploymentIdentityDetails({
  env = {},
  identity = requiredDeploymentIdentity(env),
  organizationProfile = {}
} = {}) {
  const profile = organizationProfile && typeof organizationProfile === 'object'
    ? organizationProfile
    : {};
  const storedWorkspaceId = expectedValue(profile, ['WorkspaceId', 'workspaceId', 'DeploymentWorkspaceId']);
  if (storedWorkspaceId && normalizeWorkspaceId(storedWorkspaceId) !== identity.workspaceId) {
    throw identityError(
      'The database organisation profile belongs to a different workspace.',
      503,
      'DEPLOYMENT_PROFILE_WORKSPACE_CONFLICT'
    );
  }
  const storedEdition = expectedValue(profile, ['Edition', 'OrganisationEdition', 'OrganizationEdition']);
  if (storedEdition) {
    let canonicalStoredEdition = '';
    try {
      canonicalStoredEdition = canonicalDeploymentEdition(storedEdition, {
        label: 'settings/organisationProfile.Edition'
      });
    } catch (_error) {
      throw identityError(
        'The database organisation profile has an invalid edition.',
        503,
        'DEPLOYMENT_PROFILE_EDITION_INVALID'
      );
    }
    if (canonicalStoredEdition !== identity.edition) {
      throw identityError(
        'The database organisation profile conflicts with this deployment edition.',
        503,
        'DEPLOYMENT_PROFILE_EDITION_CONFLICT'
      );
    }
  }
  const organization = resolveOrganizationConfig({
    env: {
      ...env,
      ORGANISATION_EDITION: identity.edition,
      ORGANIZATION_EDITION: ''
    },
    organizationProfile: profile
  });
  return Object.freeze({
    workspaceId: identity.workspaceId,
    edition: identity.edition,
    organisationName: organization.Name,
    organisationCode: organization.Code,
    subscriptionPlan: organization.Plan,
    subscriptionActive: organization.SubscriptionActive,
    subscriptionReadOnly: organization.SubscriptionReadOnly,
    subscriptionState: organization.SubscriptionState,
    subscriptionStatus: organization.SubscriptionStatus,
    trialStartedAt: organization.TrialStartedAt,
    trialEndsAt: organization.TrialEndsAt,
    trialDaysRemaining: organization.TrialDaysRemaining,
    paidThroughAt: organization.PaidThroughAt,
    renewalDueAt: organization.RenewalDueAt,
    gracePeriodEndsAt: organization.GracePeriodEndsAt,
    dataRetentionEndsAt: organization.DataRetentionEndsAt,
    subscriptionMessage: organization.SubscriptionMessage
  });
}

function identityCacheKey(env, identity) {
  return [
    clean(env.FIREBASE_PROJECT_ID),
    identity.workspaceId,
    identity.edition,
    clean(env.ORGANISATION_NAME || env.ORGANIZATION_NAME || env.SCHOOL_NAME),
    clean(env.ORGANISATION_CODE || env.ORGANIZATION_CODE || env.SCHOOL_CODE)
  ].join('|');
}

export function invalidateDeploymentIdentityCache() {
  cachedIdentity = null;
}

export async function loadDeploymentIdentity(env = {}, options = {}) {
  const identity = options.identity || requiredDeploymentIdentity(env);
  const key = identityCacheKey(env, identity);
  const now = Date.now();
  if (!options.fresh && cachedIdentity?.key === key && cachedIdentity.expiresAt > now) {
    return cachedIdentity.value;
  }
  const savedProfile = await getDocument(env, 'settings', 'organisationProfile');
  const organizationProfile = await refreshOrganizationPlanPolicy(env, savedProfile || {});
  const value = deploymentIdentityDetails({ env, identity, organizationProfile });
  cachedIdentity = {
    key,
    value,
    expiresAt: now + 15000
  };
  return value;
}
