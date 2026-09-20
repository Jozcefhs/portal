import { getDocument } from './firestore.js';
import { personNameFormatProfile } from './person-name-format.js';

export async function loadOrganizationNameProfile(env) {
  const [organizationProfile, legacyProfile] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  return personNameFormatProfile({ env, organizationProfile, legacyProfile });
}
