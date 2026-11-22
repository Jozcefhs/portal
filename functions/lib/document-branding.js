import { getDocument, patchDocumentFields } from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';

const clean = (value) => String(value ?? '').trim();

function canonicalEdition(value) {
  const edition = clean(value).toLowerCase();
  return edition === 'church' ? 'faith' : edition;
}

export function documentBrandingDocumentId(env = {}) {
  const identity = requiredDeploymentIdentity(env);
  return identity.edition === 'school'
    ? 'documentBranding'
    : `documentBranding-${identity.workspaceId}`;
}

export function documentBrandingMatchesDeployment(env = {}, branding = {}) {
  const identity = requiredDeploymentIdentity(env);
  return clean(branding?.WorkspaceId).toLowerCase() === identity.workspaceId
    && canonicalEdition(
      branding?.OrganisationEdition
      || branding?.OrganizationEdition
      || branding?.Edition
    ) === identity.edition;
}

export async function getDocumentBranding(env = {}) {
  return getDocument(env, 'settings', documentBrandingDocumentId(env));
}

export async function saveDocumentBranding(env = {}, values = {}) {
  const identity = requiredDeploymentIdentity(env);
  const assets = {};
  for (const field of ['DocumentLogoDataUrl', 'DocumentSignatureDataUrl', 'DocumentStampDataUrl']) {
    if (Object.hasOwn(values, field)) assets[field] = clean(values[field]);
  }
  return patchDocumentFields(env, 'settings', documentBrandingDocumentId(env), {
    ...assets,
    UpdatedAt: clean(values.UpdatedAt) || new Date().toISOString(),
    WorkspaceId: identity.workspaceId,
    OrganisationEdition: identity.edition
  });
}
