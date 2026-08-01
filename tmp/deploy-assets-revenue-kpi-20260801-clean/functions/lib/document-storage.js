import { getDocument } from './firestore.js';

const clean = (value) => String(value ?? '').trim();

export function normalizeAppsScriptWebAppUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '');
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== 'script.google.com'
      || !/^\/macros\/s\/[^/]+\/exec$/i.test(path)
    ) {
      return '';
    }
    return `${url.origin}${path}`;
  } catch {
    return '';
  }
}

export function requireAppsScriptWebAppUrl(value, label = 'Google Apps Script Web App URL') {
  const raw = clean(value);
  if (!raw) return '';
  const normalized = normalizeAppsScriptWebAppUrl(raw);
  if (normalized) return normalized;
  const error = new Error(
    `${label} must be the deployed Google Apps Script Web App URL ending in /exec. `
    + 'A Google Drive folder link cannot receive document uploads.'
  );
  error.status = 400;
  error.code = 'INVALID_DOCUMENT_STORAGE_URL';
  throw error;
}

export function selectDocumentStorageUrl({
  environmentUrl = '',
  alternateEnvironmentUrl = '',
  organizationUrl = '',
  schoolUrl = '',
  edition = ''
} = {}) {
  const normalizedEdition = clean(edition).toLowerCase();
  const storedCandidates = ['faith', 'church', 'organization', 'organisation', 'other'].includes(normalizedEdition)
    ? [['organisation profile', organizationUrl], ['school profile', schoolUrl]]
    : [['school profile', schoolUrl], ['organisation profile', organizationUrl]];
  const candidates = [
    ['server environment', environmentUrl],
    ['server environment alias', alternateEnvironmentUrl],
    ...storedCandidates
  ];
  for (const [source, candidate] of candidates) {
    const url = normalizeAppsScriptWebAppUrl(candidate);
    if (url) return { url, source };
  }
  return { url: '', source: '' };
}

export async function resolveDocumentStorage(env = {}, options = {}) {
  const readDocument = options.getDocument || getDocument;
  const [organization, legacy] = await Promise.all([
    readDocument(env, 'settings', 'organisationProfile').catch(() => null),
    readDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  const selected = selectDocumentStorageUrl({
    environmentUrl: env.GOOGLE_APPS_SCRIPT_URL,
    alternateEnvironmentUrl: env.GOOGLE_DOCUMENTS_URL,
    organizationUrl: organization?.GoogleDocumentsUrl,
    schoolUrl: legacy?.GoogleDocumentsUrl,
    edition: env.ORGANISATION_EDITION || env.ORGANIZATION_EDITION
  });
  return {
    ...selected,
    secret: clean(env.GOOGLE_APPS_SCRIPT_SECRET),
    configured: Boolean(selected.url && clean(env.GOOGLE_APPS_SCRIPT_SECRET))
  };
}
