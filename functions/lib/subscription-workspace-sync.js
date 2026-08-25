import { getDocument, upsertDocument } from './firestore.js';
import { invalidateDeploymentIdentityCache } from './deployment-identity.js';
import { invalidateStaffAccessCache } from './staff-auth.js';

const clean = (value) => String(value ?? '').trim();
const workspaceKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '');

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

export async function syncRegistrationSubscriptionToWorkspace(env, registration = {}) {
  const registrationWorkspace = workspaceKey(registration.WorkspaceId);
  if (!registrationWorkspace) return false;
  const organizationProfile = await getDocument(env, 'settings', 'organisationProfile').catch(() => null);
  if (!organizationProfile || workspaceKey(organizationProfile.WorkspaceId) !== registrationWorkspace) return false;
  await upsertDocument(env, 'settings', 'organisationProfile', {
    ...withoutFirestoreMetadata(organizationProfile),
    Plan: clean(registration.Plan || organizationProfile.Plan),
    BillingCycle: clean(registration.BillingCycle || organizationProfile.BillingCycle),
    SubscriptionPrice: Number(registration.Price || organizationProfile.SubscriptionPrice || 0),
    SubscriptionCurrency: clean(registration.Currency || organizationProfile.SubscriptionCurrency || 'NGN'),
    SubscriptionPriceSnapshot: registration.PriceSnapshot ?? organizationProfile.SubscriptionPriceSnapshot ?? null,
    PlanEntitlements: registration.FeatureEntitlements ?? organizationProfile.PlanEntitlements ?? null,
    PlanCatalogRevision: clean(registration.PlanCatalogRevision || organizationProfile.PlanCatalogRevision),
    UserLimit: Math.max(1, Number(registration.UserLimit || organizationProfile.UserLimit || 5) || 5),
    SubscriptionStatus: clean(registration.SubscriptionStatus || organizationProfile.SubscriptionStatus),
    TrialStartedAt: clean(registration.TrialStartedAt || organizationProfile.TrialStartedAt),
    TrialEndsAt: clean(registration.TrialEndsAt || organizationProfile.TrialEndsAt),
    LifecycleStage: clean(registration.LifecycleStage),
    PaidThroughAt: clean(registration.PaidThroughAt),
    RenewalDueAt: clean(registration.RenewalDueAt || registration.PaidThroughAt),
    GracePeriodEndsAt: clean(registration.GracePeriodEndsAt),
    DataRetentionEndsAt: clean(registration.DataRetentionEndsAt),
    SubscriptionUpdatedAt: clean(registration.UpdatedAt) || new Date().toISOString()
  });
  invalidateDeploymentIdentityCache();
  invalidateStaffAccessCache();
  return true;
}
