import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeAppsScriptWebAppUrl,
  requireAppsScriptWebAppUrl,
  resolveDocumentStorage,
  selectDocumentStorageUrl
} from '../functions/lib/document-storage.js';

const SCHOOL_SCRIPT = 'https://script.google.com/macros/s/SCHOOL-DEPLOYMENT/exec';
const PROFILE_SCRIPT = 'https://script.google.com/macros/s/PROFILE-DEPLOYMENT/exec';

test('document storage accepts only a deployed Apps Script /exec URL', () => {
  assert.equal(normalizeAppsScriptWebAppUrl(`${SCHOOL_SCRIPT}/?ignored=yes`), SCHOOL_SCRIPT);
  assert.equal(normalizeAppsScriptWebAppUrl('https://drive.google.com/drive/folders/example'), '');
  assert.equal(normalizeAppsScriptWebAppUrl('https://example.com/macros/s/id/exec'), '');
  assert.throws(
    () => requireAppsScriptWebAppUrl('https://drive.google.com/drive/folders/example'),
    /Drive folder link/
  );
});

test('school profile Apps Script endpoint takes priority over server fallbacks', () => {
  assert.deepEqual(selectDocumentStorageUrl({
    environmentUrl: SCHOOL_SCRIPT,
    organizationUrl: PROFILE_SCRIPT,
    schoolUrl: PROFILE_SCRIPT,
    edition: 'school'
  }), {
    url: PROFILE_SCRIPT,
    source: 'school profile'
  });
});

test('faith workspaces prefer their organisation profile endpoint', () => {
  assert.deepEqual(selectDocumentStorageUrl({
    environmentUrl: SCHOOL_SCRIPT,
    organizationUrl: PROFILE_SCRIPT,
    schoolUrl: SCHOOL_SCRIPT,
    edition: 'faith'
  }), {
    url: PROFILE_SCRIPT,
    source: 'organisation profile'
  });
});

test('invalid saved Drive URL is ignored in favour of the valid server endpoint', async () => {
  const records = {
    organisationProfile: { GoogleDocumentsUrl: 'https://drive.google.com/drive/folders/example' },
    schoolProfile: { GoogleDocumentsUrl: 'not a web app URL' }
  };
  const storage = await resolveDocumentStorage({
    GOOGLE_APPS_SCRIPT_URL: SCHOOL_SCRIPT,
    GOOGLE_APPS_SCRIPT_SECRET: 'secret',
    ORGANISATION_EDITION: 'school'
  }, {
    getDocument: async (_env, _collection, id) => records[id]
  });
  assert.equal(storage.url, SCHOOL_SCRIPT);
  assert.equal(storage.source, 'server environment');
  assert.equal(storage.configured, true);
});

test('invalid saved Apps Script values do not shadow the server fallback', () => {
  assert.deepEqual(selectDocumentStorageUrl({
    environmentUrl: SCHOOL_SCRIPT,
    organizationUrl: 'https://drive.google.com/drive/folders/example',
    schoolUrl: 'not a web app URL',
    edition: 'school'
  }), {
    url: SCHOOL_SCRIPT,
    source: 'server environment'
  });
});

test('a valid profile endpoint remains a fallback when no server URL is configured', async () => {
  const records = {
    organisationProfile: { GoogleDocumentsUrl: '' },
    schoolProfile: { GoogleDocumentsUrl: PROFILE_SCRIPT }
  };
  const storage = await resolveDocumentStorage({
    GOOGLE_APPS_SCRIPT_SECRET: 'secret',
    ORGANISATION_EDITION: 'school'
  }, {
    getDocument: async (_env, _collection, id) => records[id]
  });
  assert.equal(storage.url, PROFILE_SCRIPT);
  assert.equal(storage.source, 'school profile');
});
