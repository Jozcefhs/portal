import { getDocument, requireFirestoreEnv } from '../lib/firestore.js';
import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import { getWebBranding } from '../lib/web-branding.js';

const clean = (value) => String(value ?? '').trim();

function manifestName(identity = {}, schoolProfile = {}, organizationProfile = {}) {
  if (identity.edition === 'school') {
    return clean(schoolProfile.SchoolName || organizationProfile.Name || identity.organisationName) || 'Dynamax School';
  }
  return clean(organizationProfile.Name || identity.organisationName || schoolProfile.OrganisationName) || 'Dynamax';
}

export async function onRequestGet(context) {
  let name = clean(
    context.env.ORGANISATION_NAME
    || context.env.ORGANIZATION_NAME
    || context.env.SCHOOL_NAME
  ) || 'Dynamax';
  let icon = '/images/Logo.png?v=20260801-transparent-app-logo';
  try {
    requireFirestoreEnv(context.env);
    const identity = requiredDeploymentIdentity(context.env);
    const [schoolProfile, organizationProfile, branding] = await Promise.all([
      getDocument(context.env, 'settings', 'schoolProfile').catch(() => null),
      getDocument(context.env, 'settings', 'organisationProfile').catch(() => null),
      getWebBranding(context.env).catch(() => null)
    ]);
    name = manifestName(identity, schoolProfile || {}, organizationProfile || {});
    if (branding && clean(branding.WebLogoDataUrl)) {
      icon = `/api/web-logo?v=${encodeURIComponent(clean(branding.UpdatedAt) || 'brand')}`;
    }
  } catch {
    // Preserve the static Dynamax identity if tenant branding is unavailable.
  }
  return Response.json({
    name,
    short_name: name.length > 24 ? `${name.slice(0, 23).trim()}…` : name,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#071b38',
    theme_color: '#0b4bc8',
    description: `${name} management portal`,
    icons: [{ src: icon, sizes: 'any', purpose: 'any' }]
  }, {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
