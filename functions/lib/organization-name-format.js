import { getDocument } from './firestore.js';
import { personNameFormatProfile } from './person-name-format.js';
import { effectiveBranchProfile } from './branch-profile-settings.js';

export async function loadOrganizationNameProfile(env, branchId = '') {
  const [organizationProfile, legacyProfile] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  const defaults = personNameFormatProfile({ env, organizationProfile, legacyProfile });
  return branchId ? effectiveBranchProfile(env, defaults, branchId) : defaults;
}
