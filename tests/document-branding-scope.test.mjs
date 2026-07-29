import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  documentBrandingDocumentId,
  documentBrandingMatchesDeployment
} from '../functions/lib/document-branding.js';

const schoolEnv = {
  DYNAMAX_WORKSPACE_ID: 'school',
  ORGANISATION_EDITION: 'school'
};
const faithEnv = {
  DYNAMAX_WORKSPACE_ID: 'faith',
  ORGANISATION_EDITION: 'faith'
};

test('document branding is isolated by deployment and legacy records fail closed', () => {
  assert.equal(documentBrandingDocumentId(schoolEnv), 'documentBranding');
  assert.equal(documentBrandingDocumentId(faithEnv), 'documentBranding-faith');
  assert.equal(documentBrandingMatchesDeployment(schoolEnv, {
    DocumentLogoDataUrl: 'data:image/png;base64,LEGACY'
  }), false);
  assert.equal(documentBrandingMatchesDeployment(schoolEnv, {
    WorkspaceId: 'school',
    OrganisationEdition: 'school',
    DocumentLogoDataUrl: 'data:image/png;base64,SCHOOL'
  }), true);
  assert.equal(documentBrandingMatchesDeployment(schoolEnv, {
    WorkspaceId: 'faith',
    OrganisationEdition: 'faith',
    DocumentLogoDataUrl: 'data:image/png;base64,CHURCH'
  }), false);
});

test('Executive correspondence and settings use scoped document branding', async () => {
  const [executiveSource, backendSource, endpointSource] = await Promise.all([
    readFile(new URL('../functions/lib/executive-correspondence.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/document-logo.js', import.meta.url), 'utf8')
  ]);

  assert.match(executiveSource, /getDocumentBranding\(env\)/);
  assert.match(executiveSource, /documentBrandingMatchesDeployment\(env, documentBranding\)/);
  assert.match(executiveSource, /webBrandingMatchesDeployment\(env, webBranding\)/);
  assert.match(executiveSource, /documentLogoDataUrl\s*\?\s*'\/api\/document-logo'/);
  assert.doesNotMatch(executiveSource, /getDocument\(env, 'settings', 'documentBranding'\)/);
  assert.match(backendSource, /saveDocumentBranding\(env,/);
  assert.match(endpointSource, /documentBrandingMatchesDeployment\(context\.env, documentBranding\)/);
  assert.match(endpointSource, /webBrandingMatchesDeployment\(context\.env, webBranding\)/);
});
