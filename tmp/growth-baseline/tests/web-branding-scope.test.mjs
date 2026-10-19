import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  webBrandingDocumentId,
  webBrandingMatchesDeployment
} from '../functions/lib/web-branding.js';

const faithEnv = {
  DYNAMAX_WORKSPACE_ID: 'faith',
  ORGANISATION_EDITION: 'faith'
};

test('school keeps the legacy branding document while other workspaces use isolated branding', () => {
  assert.equal(webBrandingDocumentId({
    DYNAMAX_WORKSPACE_ID: 'school',
    ORGANISATION_EDITION: 'school'
  }), 'webBranding');
  assert.equal(webBrandingDocumentId(faithEnv), 'webBranding-faith');
  assert.equal(webBrandingDocumentId({
    DYNAMAX_WORKSPACE_ID: 'association-main',
    ORGANISATION_EDITION: 'organization'
  }), 'webBranding-association-main');
});

test('legacy branding without deployment identity is not trusted for official letters', () => {
  assert.equal(webBrandingMatchesDeployment(faithEnv, {
    WebLogoDataUrl: 'data:image/png;base64,CHURCH'
  }), false);
  assert.equal(webBrandingMatchesDeployment(faithEnv, {
    WorkspaceId: 'faith',
    OrganisationEdition: 'faith',
    WebLogoDataUrl: 'data:image/png;base64,CHURCH'
  }), true);
  assert.equal(webBrandingMatchesDeployment({
    DYNAMAX_WORKSPACE_ID: 'school',
    ORGANISATION_EDITION: 'school'
  }, {
    WorkspaceId: 'faith',
    OrganisationEdition: 'faith',
    WebLogoDataUrl: 'data:image/png;base64,CHURCH'
  }), false);
});

test('church receipts and the public logo endpoint load only deployment-scoped branding', async () => {
  const [paymentSource, logoSource, settingsSource, backendSource] = await Promise.all([
    readFile(new URL('../functions/lib/church-payments.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/web-logo.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8')
  ]);

  assert.match(paymentSource, /getWebBranding\(env\)/);
  assert.match(logoSource, /getWebBranding\(context\.env\)/);
  assert.match(settingsSource, /getWebBranding\(env\)/);
  assert.match(settingsSource, /saveWebBranding\(env,/);
  assert.match(backendSource, /getWebBranding\(env\)/);
  assert.match(backendSource, /saveWebBranding\(env,/);
  assert.doesNotMatch(paymentSource, /getDocument\(env, 'settings', 'webBranding'\)/);
});
