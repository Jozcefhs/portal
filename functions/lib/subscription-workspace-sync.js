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
    UserLimit: Math.max(1, Number(registration.UserLimit || organizationProfile.UserLimit || 5) || 5),
    SubscriptionStatus: clean(registration.SubscriptionStatus || organizationProfile.SubscriptionStatus),
    TrialStartedAt: clean(registration.TrialStartedAt || organizationProfile.TrialStartedAt),
    TrialEndsAt: clean(registration.TrialEndsAt || organizationProfile.TrialEndsAt),
    SubscriptionUpdatedAt: clean(registration.UpdatedAt) || new Date().toISOString()
  });
  invalidateDeploymentIdentityCache();
  invalidateStaffAccessCache();
  return true;
}
