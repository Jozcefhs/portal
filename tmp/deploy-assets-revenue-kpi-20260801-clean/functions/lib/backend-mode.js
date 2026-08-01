import { normalizeAppsScriptWebAppUrl } from './document-storage.js';

function clean(value) {
  return String(value ?? '').trim().toLowerCase();
}

// Operational records belong to Firestore. Google Apps Script is retained only
// as the private file/document transport unless an explicit legacy migration
// mode is deliberately enabled.
export function legacyGoogleDataEnabled(env = {}) {
  return ['google', 'google-legacy', 'apps-script', 'legacy'].includes(clean(env.DATA_BACKEND_MODE));
}

export function googleDocumentStorageConfigured(env = {}) {
  return Boolean(
    normalizeAppsScriptWebAppUrl(env.GOOGLE_APPS_SCRIPT_URL || env.GOOGLE_DOCUMENTS_URL)
    && String(env.GOOGLE_APPS_SCRIPT_SECRET || '').trim()
  );
}
