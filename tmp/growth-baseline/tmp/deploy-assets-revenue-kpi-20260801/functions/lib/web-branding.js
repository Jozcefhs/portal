import { getDocument, upsertDocument } from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';

const clean = (value) => String(value ?? '').trim();

function canonicalEdition(value) {
  const edition = clean(value).toLowerCase();
  return edition === 'church' ? 'faith' : edition;
}

export function webBrandingDocumentId(env = {}) {
  const identity = requiredDeploymentIdentity(env);
  return identity.edition === 'school'
    ? 'webBranding'
    : `webBranding-${identity.workspaceId}`;
}

export function webBrandingMatchesDeployment(env = {}, branding = {}) {
  const identity = requiredDeploymentIdentity(env);
  return clean(branding?.WorkspaceId).toLowerCase() === identity.workspaceId
    && canonicalEdition(
      branding?.OrganisationEdition
      || branding?.OrganizationEdition
      || branding?.Edition
    ) === identity.edition;
}

export async function getWebBranding(env = {}) {
  return getDocument(env, 'settings', webBrandingDocumentId(env));
}

export async function saveWebBranding(env = {}, values = {}) {
  const identity = requiredDeploymentIdentity(env);
  return upsertDocument(env, 'settings', webBrandingDocumentId(env), {
    WebLogoDataUrl: clean(values.WebLogoDataUrl),
    UpdatedAt: clean(values.UpdatedAt) || new Date().toISOString(),
    WorkspaceId: identity.workspaceId,
    OrganisationEdition: identity.edition
  });
}
