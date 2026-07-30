import test from 'node:test';
import assert from 'node:assert/strict';

import { googleDocumentStorageConfigured, legacyGoogleDataEnabled } from '../functions/lib/backend-mode.js';

test('Google credentials do not enable legacy operational data by default', () => {
  const env = {
    GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/deployment/exec',
    GOOGLE_APPS_SCRIPT_SECRET: 'secret'
  };
  assert.equal(legacyGoogleDataEnabled(env), false);
  assert.equal(googleDocumentStorageConfigured(env), true);
});

test('legacy Google operational data requires an explicit migration mode', () => {
  assert.equal(legacyGoogleDataEnabled({ DATA_BACKEND_MODE: 'google-legacy' }), true);
  assert.equal(legacyGoogleDataEnabled({ DATA_BACKEND_MODE: 'firestore' }), false);
});

test('document storage requires both Google URL and secret', () => {
  assert.equal(googleDocumentStorageConfigured({
    GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/deployment/exec'
  }), false);
  assert.equal(googleDocumentStorageConfigured({ GOOGLE_APPS_SCRIPT_SECRET: 'secret' }), false);
  assert.equal(googleDocumentStorageConfigured({
    GOOGLE_APPS_SCRIPT_URL: 'https://drive.google.com/drive/folders/example',
    GOOGLE_APPS_SCRIPT_SECRET: 'secret'
  }), false);
});
