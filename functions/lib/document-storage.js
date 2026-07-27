import { getDocument } from './firestore.js';

const clean = (value) => String(value ?? '').trim();

export async function resolveDocumentStorage(env = {}) {
  const [organization, legacy] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  return {
    url: clean(organization?.GoogleDocumentsUrl || legacy?.GoogleDocumentsUrl
      || env.GOOGLE_DOCUMENTS_URL || env.GOOGLE_APPS_SCRIPT_URL),
    secret: clean(env.GOOGLE_APPS_SCRIPT_SECRET)
  };
}
