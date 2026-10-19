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
  return Boolean(String(env.GOOGLE_APPS_SCRIPT_URL || '').trim() && String(env.GOOGLE_APPS_SCRIPT_SECRET || '').trim());
}
