import { getDocument, queryCollection, upsertDocument } from './firestore.js';
import { hasPlatformFirestoreConfiguration, requirePlatformFirestoreEnv } from './platform-firestore.js';
import {
  normalizeSubscriptionPlanCatalog,
  normalizeSubscriptionPlan,
  subscriptionPlanEntitlements
} from './subscription-plans.js';

const clean = (value) => String(value ?? '').trim();
const CACHE_MS = 60000;
const policyCache = new Map();

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase());
}

export async function loadCanonicalPlanCatalog(env = {}, fetchImpl = fetch) {
  const scope = clean(env.CANONICAL_API_PROXY_SCOPE).toLowerCase();
  const configuredOrigin = clean(env.CANONICAL_PORTAL_URL);
  let origin;
  try { origin = new URL(configuredOrigin); } catch (_error) { origin = null; }
  if (!enabled(env.ALLOW_CANONICAL_API_PROXY) || scope !== 'platform-subscriptions'
      || !origin || origin.protocol !== 'https:') {
    const error = new Error('The central Dynamax plan-policy bridge is not configured.');
    error.status = 503;
    error.code = 'DYNAMAX_PLAN_POLICY_BRIDGE_NOT_CONFIGURED';
    throw error;
  }
  const target = new URL('/api/plan-catalog', origin.origin);
  const response = await fetchImpl(target, {
    headers: {
      Accept: 'application/json',
      'X-Dynamax-Workspace': clean(env.DYNAMAX_WORKSPACE_ID)
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok || !data.catalog) {
    const error = new Error(data?.message || 'The central Dynamax plan catalogue could not be loaded.');
    error.status = response.status || 503;
    error.code = 'DYNAMAX_PLAN_POLICY_BRIDGE_FAILED';
    throw error;
  }
  const publicCatalog = data.catalog;
  const plans = Array.isArray(publicCatalog.Plans)
    ? Object.fromEntries(publicCatalog.Plans
      .filter((plan) => plan && typeof plan === 'object' && clean(plan.Name))
      .map((plan) => [clean(plan.Name), plan]))
    : publicCatalog.Plans;
  return normalizeSubscriptionPlanCatalog({ ...publicCatalog, Plans: plans });
}

export async function loadCanonicalSubscriptionPolicy(env = {}, workspaceId, fetchImpl = fetch) {
  const scope = clean(env.CANONICAL_API_PROXY_SCOPE).toLowerCase();
  let origin;
  try { origin = new URL(clean(env.CANONICAL_PORTAL_URL)); } catch (_error) { origin = null; }
  if (!enabled(env.ALLOW_CANONICAL_API_PROXY) || scope !== 'platform-subscriptions' || !origin || origin.protocol !== 'https:') {
    const error = new Error('The central Dynamax subscription-policy bridge is not configured.');
    error.status = 503;
    throw error;
  }
  const response = await fetchImpl(new URL('/api/subscription-policy', origin.origin), {
    headers: { Accept: 'application/json', 'X-Dynamax-Workspace': clean(workspaceId) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok || !data.policy) {
    const error = new Error(data?.message || 'The central Dynamax subscription policy could not be loaded.');
    error.status = response.status || 503;
    throw error;
  }
  return data.policy;
}

function workspaceKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '');
}

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

function comparableEntitlements(value) {
  if (value === '*') return '*';
  return JSON.stringify(Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))].sort() : []);
}

async function loadCentralPolicy(env, workspaceId) {
  const directPlatformAccess = hasPlatformFirestoreConfiguration(env);
  const platformEnv = directPlatformAccess ? requirePlatformFirestoreEnv(env) : null;
  const policySource = directPlatformAccess
    ? clean(platformEnv.FIREBASE_PROJECT_ID)
    : clean(env.CANONICAL_PORTAL_URL).toLowerCase();
  const key = `${policySource}|${workspaceKey(workspaceId)}`;
  const cached = policyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (!directPlatformAccess) {
    const [catalog, registration] = await Promise.all([
      loadCanonicalPlanCatalog(env),
      loadCanonicalSubscriptionPolicy(env, workspaceId).catch(() => null)
    ]);
    const value = {
      catalog,
      registration
    };
    policyCache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  }
  const [savedCatalog, registrations] = await Promise.all([
    getDocument(platformEnv, 'settings', 'dynamaxPlanCatalog').catch(() => null),
    queryCollection(platformEnv, 'tenantRegistrations', {
      filters: [{ field: 'WorkspaceId', op: '==', value: workspaceId }],
      limit: 20
    }).catch(() => [])
  ]);
  const registration = registrations
    .filter((row) => !['rejected', 'cancelled'].includes(clean(row.Status).toLowerCase()))
    .sort((left, right) => clean(right.UpdatedAt || right.CreatedAt).localeCompare(clean(left.UpdatedAt || left.CreatedAt)))[0] || null;
  const value = { catalog: normalizeSubscriptionPlanCatalog(savedCatalog || {}), registration };
  policyCache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

export function invalidatePlanPolicyCache() {
  policyCache.clear();
}

export async function refreshOrganizationPlanPolicy(env, organizationProfile = {}) {
  const workspaceId = clean(organizationProfile.WorkspaceId);
  if (!workspaceId) return organizationProfile;
  let central;
  try {
    central = await loadCentralPolicy(env, workspaceId);
  } catch (_error) {
    // Existing tenant snapshots remain authoritative while the control-plane
    // database is unavailable or has not yet been configured.
    return organizationProfile;
  }
  const registration = central.registration || {};
  const plan = normalizeSubscriptionPlan(registration.Plan || organizationProfile.Plan || 'Starter');
  const edition = clean(organizationProfile.Edition || registration.Edition) || 'school';
  const entitlements = subscriptionPlanEntitlements(plan, edition, central.catalog);
  const revision = clean(central.catalog.PolicyRevision || central.catalog.UpdatedAt);
  const enriched = {
    ...withoutFirestoreMetadata(organizationProfile),
    Plan: plan,
    PlanEntitlements: entitlements,
    PlanCatalogRevision: revision,
    UserLimit: Math.max(1, Number(registration.UserLimit || organizationProfile.UserLimit || central.catalog.Plans[plan]?.UserLimit || 5) || 5),
    SubscriptionStatus: clean(registration.SubscriptionStatus || organizationProfile.SubscriptionStatus),
    TrialStartedAt: clean(registration.TrialStartedAt || organizationProfile.TrialStartedAt),
    TrialEndsAt: clean(registration.TrialEndsAt || organizationProfile.TrialEndsAt)
  };
  const changed = clean(organizationProfile.Plan) !== clean(enriched.Plan)
    || clean(organizationProfile.PlanCatalogRevision) !== revision
    || comparableEntitlements(organizationProfile.PlanEntitlements) !== comparableEntitlements(entitlements)
    || Number(organizationProfile.UserLimit || 0) !== Number(enriched.UserLimit || 0)
    || clean(organizationProfile.SubscriptionStatus) !== clean(enriched.SubscriptionStatus)
    || clean(organizationProfile.TrialStartedAt) !== clean(enriched.TrialStartedAt)
    || clean(organizationProfile.TrialEndsAt) !== clean(enriched.TrialEndsAt);
  if (changed) {
    await upsertDocument(env, 'settings', 'organisationProfile', {
      ...enriched,
      SubscriptionUpdatedAt: new Date().toISOString()
    }).catch(() => null);
  }
  return enriched;
}
