import { getDocument } from './firestore.js';
import { hasPlatformFirestoreConfiguration, requirePlatformFirestoreEnv } from './platform-firestore.js';
import { canonicalSubscriptionBridgeConfigured } from './plan-policy-sync.js';
import { normalizeTutorialLinks, normalizeYouTubeTutorialUrl } from './tutorial-links.js';

export const TUTORIAL_CATALOG_DOCUMENT_ID = 'dynamaxTutorialCatalog';
export const TUTORIAL_EDITIONS = Object.freeze(['school', 'faith', 'organization']);

const clean = (value) => String(value ?? '').trim();

export function normalizeTutorialCatalog(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ChannelUrl: normalizeYouTubeTutorialUrl(source.ChannelUrl || ''),
    Editions: Object.fromEntries(TUTORIAL_EDITIONS.map((edition) => [
      edition,
      { Links: normalizeTutorialLinks(source.Editions?.[edition]?.Links || {}) }
    ])),
    UpdatedAt: clean(source.UpdatedAt)
  };
}

export function tutorialsForEdition(catalog, edition) {
  const normalized = normalizeTutorialCatalog(catalog);
  const key = TUTORIAL_EDITIONS.includes(clean(edition).toLowerCase()) ? clean(edition).toLowerCase() : 'school';
  return {
    links: normalized.Editions[key].Links,
    channelUrl: normalized.ChannelUrl
  };
}

export async function loadPublishedTutorials(env, edition, legacyProfile = {}, fetchImpl = fetch) {
  const legacy = {
    links: normalizeTutorialLinks(legacyProfile.TutorialLinks || {}),
    channelUrl: normalizeYouTubeTutorialUrl(legacyProfile.TutorialChannelUrl || '')
  };
  try {
    let saved = null;
    let directReadFailed = false;
    const hasDirectAccess = hasPlatformFirestoreConfiguration(env);
    if (hasDirectAccess) {
      try {
        saved = await getDocument(requirePlatformFirestoreEnv(env), 'settings', TUTORIAL_CATALOG_DOCUMENT_ID);
      } catch (_error) {
        directReadFailed = true;
      }
    }
    if ((directReadFailed || !hasDirectAccess) && canonicalSubscriptionBridgeConfigured(env)) {
      const target = new URL('/api/tutorial-catalog', clean(env.CANONICAL_PORTAL_URL));
      const response = await fetchImpl(target, { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error('The owner tutorial catalogue could not be loaded.');
      if (data.published) saved = data.catalog;
    }
    return saved ? tutorialsForEdition(saved, edition) : legacy;
  } catch (_error) {
    // Existing subscriber links remain readable while the owner catalogue is unavailable.
    return legacy;
  }
}
