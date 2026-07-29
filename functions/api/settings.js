import { getDocument, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { secureTextEqual } from '../lib/backend-security.js';
import { organizationProfileDocument, resolveOrganizationConfig } from '../lib/organization-config.js';
import {
  assertDeploymentEditionSelection,
  deploymentIdentityDetails,
  invalidateDeploymentIdentityCache,
  requiredDeploymentIdentity
} from '../lib/deployment-identity.js';
import { finishRequestMetric, startRequestMetric } from '../lib/request-metrics.js';
import { readJsonBody } from '../lib/request-security.js';
import { getWebBranding, saveWebBranding } from '../lib/web-branding.js';

const PROFILE_CACHE_MS = 15000;
let profileCache = null;

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeSchoolCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DCA';
}

function requireAdmin(env, password) {
  const expected = clean(env.ADMIN_WEB_PASSWORD);
  if (!expected) {
    const err = new Error('Setup login is not configured. Add ADMIN_WEB_PASSWORD in Cloudflare.');
    err.status = 503;
    throw err;
  }
  if (!secureTextEqual(password, expected)) {
    const err = new Error('Invalid setup password.');
    err.status = 401;
    throw err;
  }
}

function defaultProfile(env) {
  const deployment = requiredDeploymentIdentity(env);
  const organization = resolveOrganizationConfig({
    env: { ...env, ORGANISATION_EDITION: deployment.edition, ORGANIZATION_EDITION: '' }
  });
  return {
    WorkspaceId: deployment.workspaceId,
    OrganisationEdition: organization.Edition,
    OrganisationName: organization.Name,
    OrganisationCode: organization.Code,
    FeatureFlags: organization.FeatureFlags,
    SchoolName: clean(env.SCHOOL_NAME) || 'Dynamax',
    SchoolCode: normalizeSchoolCode(env.SCHOOL_CODE),
    SchoolAddress: clean(env.SCHOOL_ADDRESS) || '',
    SchoolPhone: clean(env.SCHOOL_PHONE) || '',
    SchoolEmail: clean(env.SCHOOL_EMAIL) || '',
    SchoolSignatoryName: clean(env.SCHOOL_SIGNATORY_NAME) || '',
    SchoolSignatoryTitle: clean(env.SCHOOL_SIGNATORY_TITLE) || '',
    ResultSignatoryName: clean(env.RESULT_SIGNATORY_NAME) || '',
    ResultSignatoryTitle: clean(env.RESULT_SIGNATORY_TITLE) || '',
    OfferSignatoryName: clean(env.OFFER_SIGNATORY_NAME) || '',
    OfferSignatoryTitle: clean(env.OFFER_SIGNATORY_TITLE) || '',
    AdmissionSignatoryName: clean(env.ADMISSION_SIGNATORY_NAME) || '',
    AdmissionSignatoryTitle: clean(env.ADMISSION_SIGNATORY_TITLE) || '',
    EmailGreetingTemplate: clean(env.EMAIL_GREETING_TEMPLATE) || 'Dear Parent/Guardian,',
    NameFormat: clean(env.NAME_FORMAT) || 'Surname, first name, middle name',
    PortalHeadline: clean(env.PORTAL_HEADLINE) || 'Admissions and parent services in one place',
    PortalSubheading: clean(env.PORTAL_SUBHEADING) || 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.',
    PortalNotice: clean(env.PORTAL_NOTICE) || '',
    WebLogoUrl: '/images/Logo.png',
    WebLogoConfigured: false,
    ResultDisplayMode: clean(env.RESULT_DISPLAY_MODE) || 'subjects',
    ShowResultsOnline: clean(env.SHOW_RESULTS_ONLINE) || 'NO',
    CurrentAcademicSession: clean(env.CURRENT_ACADEMIC_SESSION) || '',
    CurrentTerm: clean(env.CURRENT_TERM) || 'First Term',
    DeclarationStatement: clean(env.DECLARATION_STATEMENT) || 'I declare that the information supplied in this application is complete and correct.',
    ProductKeyMode: clean(env.PRODUCT_KEY_MODE) || 'off',
    GoogleDocumentsUrl: clean(env.GOOGLE_DOCUMENTS_URL) || '',
    SubscriptionPlan: clean(env.SUBSCRIPTION_PLAN) || 'Starter',
    UserLimit: Math.max(1, Number(env.USER_LIMIT || 5) || 5),
    TurnstileSiteKey: clean(env.TURNSTILE_SITE_KEY),
    UpdatedAt: ''
  };
}

function profileEnvironmentKey(env) {
  const deployment = requiredDeploymentIdentity(env);
  return [
    clean(env.FIREBASE_PROJECT_ID),
    deployment.workspaceId,
    deployment.edition,
    clean(env.TURNSTILE_SITE_KEY)
  ].join('|');
}

function invalidateProfileCache() {
  profileCache = null;
}

async function loadProfile(env) {
  const deployment = requiredDeploymentIdentity(env);
  let profile = defaultProfile(env);
  try {
    requireFirestoreEnv(env);
    const [saved, savedOrganization, branding] = await Promise.all([
      getDocument(env, 'settings', 'schoolProfile'),
      getDocument(env, 'settings', 'organisationProfile'),
      getWebBranding(env)
    ]);
    if (saved) {
      Object.keys(profile).forEach((key) => {
        if (saved[key] !== undefined) profile[key] = saved[key];
      });
    }
    const identity = deploymentIdentityDetails({
      env,
      identity: deployment,
      organizationProfile: savedOrganization
    });
    const organization = resolveOrganizationConfig({
      env: { ...env, ORGANISATION_EDITION: identity.edition, ORGANIZATION_EDITION: '' },
      organizationProfile: savedOrganization,
      legacyProfile: profile
    });
    profile.WorkspaceId = identity.workspaceId;
    profile.OrganisationEdition = identity.edition;
    profile.OrganisationName = identity.organisationName;
    profile.OrganisationCode = identity.organisationCode;
    profile.FeatureFlags = organization.FeatureFlags;
    if (branding && clean(branding.WebLogoDataUrl)) {
      profile.WebLogoConfigured = true;
      profile.WebLogoUrl = `/api/web-logo?v=${encodeURIComponent(clean(branding.UpdatedAt))}`;
    }
  } catch (error) {
    if (String(error?.code || '').startsWith('DEPLOYMENT_')) throw error;
    // Public pages should still load with environment/default values if Firestore is unavailable.
  }
  profile.TurnstileSiteKey = clean(env.TURNSTILE_SITE_KEY);
  delete profile.__name;
  delete profile.__id;
  delete profile.__createTime;
  delete profile.__updateTime;
  return profile;
}

async function getProfile(env, options = {}) {
  const environmentKey = profileEnvironmentKey(env);
  if (!options.fresh && profileCache && profileCache.environmentKey === environmentKey && profileCache.expiresAt > Date.now()) {
    return { ...profileCache.profile };
  }
  const profile = await loadProfile(env);
  profileCache = { environmentKey, profile, expiresAt: Date.now() + PROFILE_CACHE_MS };
  return { ...profile };
}

function publicProfile(profile = {}) {
  const keys = [
    'WorkspaceId', 'OrganisationEdition', 'OrganisationName', 'OrganisationCode',
    'SchoolName', 'SchoolAddress', 'SchoolPhone', 'SchoolEmail',
    'PortalHeadline', 'PortalSubheading', 'PortalNotice', 'NameFormat',
    'ResultDisplayMode', 'ShowResultsOnline', 'DeclarationStatement',
    'WebLogoUrl', 'WebLogoConfigured', 'TurnstileSiteKey'
  ];
  return Object.fromEntries(keys
    .filter((key) => profile[key] !== undefined)
    .map((key) => [key, profile[key]]));
}

export async function onRequestGet(context) {
  const metric = startRequestMetric(context.request, '/api/settings');
  const profile = publicProfile(await getProfile(context.env));
  finishRequestMetric(metric, { status: 200, action: 'load-public-profile' });
  return Response.json({ ok: true, profile }, {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      Vary: 'Accept-Encoding'
    }
  });
}

export async function onRequestPost(context) {
  const metric = startRequestMetric(context.request, '/api/settings');
  let action = 'save';
  try {
    const { request, env } = context;
    const deployment = requiredDeploymentIdentity(env);
    const body = await readJsonBody(request, { maxBytes: 1024 * 1024 });
    requireAdmin(env, body.password);
    if (clean(body.action || body.Action) === 'load') {
      action = 'load-private-profile';
      const profile = await getProfile(env, { fresh: true });
      finishRequestMetric(metric, { status: 200, action });
      return Response.json({ ok: true, profile }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const incoming = body.profile || {};
    assertDeploymentEditionSelection(
      deployment,
      incoming.OrganisationEdition || incoming.OrganizationEdition
    );
    requireFirestoreEnv(env);
    const existing = await getProfile(env, { fresh: true });
    const organization = resolveOrganizationConfig({
      env,
      organizationProfile: {
        Edition: deployment.edition,
        Name: incoming.OrganisationName || incoming.OrganizationName || incoming.SchoolName || existing.OrganisationName,
        Code: incoming.OrganisationCode || incoming.OrganizationCode || incoming.SchoolCode || existing.OrganisationCode,
        FeatureFlags: incoming.FeatureFlags || incoming.Features || existing.FeatureFlags
      },
      legacyProfile: { ...existing, ...incoming }
    });
    const profile = {
      ...defaultProfile(env),
      ...existing,
      WorkspaceId: deployment.workspaceId,
      OrganisationEdition: organization.Edition,
      OrganisationName: organization.Name,
      OrganisationCode: organization.Code,
      FeatureFlags: organization.FeatureFlags,
      SchoolName: clean(incoming.SchoolName) || 'Dynamax',
      SchoolCode: normalizeSchoolCode(incoming.SchoolCode),
      SchoolAddress: clean(incoming.SchoolAddress),
      SchoolPhone: clean(incoming.SchoolPhone),
      SchoolEmail: clean(incoming.SchoolEmail),
      SchoolSignatoryName: clean(incoming.SchoolSignatoryName),
      SchoolSignatoryTitle: clean(incoming.SchoolSignatoryTitle),
      ResultSignatoryName: clean(incoming.ResultSignatoryName),
      ResultSignatoryTitle: clean(incoming.ResultSignatoryTitle),
      OfferSignatoryName: clean(incoming.OfferSignatoryName),
      OfferSignatoryTitle: clean(incoming.OfferSignatoryTitle),
      AdmissionSignatoryName: clean(incoming.AdmissionSignatoryName),
      AdmissionSignatoryTitle: clean(incoming.AdmissionSignatoryTitle),
      EmailGreetingTemplate: clean(incoming.EmailGreetingTemplate) || 'Dear Parent/Guardian,',
      NameFormat: clean(incoming.NameFormat) || 'Surname, first name, middle name',
      PortalHeadline: clean(incoming.PortalHeadline),
      PortalSubheading: clean(incoming.PortalSubheading),
      PortalNotice: clean(incoming.PortalNotice),
      ResultDisplayMode: ['subjects', 'percentage'].includes(clean(incoming.ResultDisplayMode)) ? clean(incoming.ResultDisplayMode) : 'subjects',
      ShowResultsOnline: ['YES', 'NO'].includes(clean(incoming.ShowResultsOnline).toUpperCase()) ? clean(incoming.ShowResultsOnline).toUpperCase() : 'NO',
      CurrentAcademicSession: clean(incoming.CurrentAcademicSession),
      CurrentTerm: clean(incoming.CurrentTerm) || 'First Term',
      DeclarationStatement: clean(incoming.DeclarationStatement) || 'I declare that the information supplied in this application is complete and correct.',
      ProductKeyMode: ['off', 'required'].includes(clean(incoming.ProductKeyMode)) ? clean(incoming.ProductKeyMode) : 'off',
      GoogleDocumentsUrl: clean(incoming.GoogleDocumentsUrl),
      SubscriptionPlan: clean(incoming.SubscriptionPlan) || 'Starter',
      UserLimit: Math.max(1, Number(incoming.UserLimit || existing.UserLimit || 5) || 5),
      UpdatedAt: new Date().toISOString()
    };
    if (incoming.WebLogoDataUrl !== undefined) {
      const webLogo = clean(incoming.WebLogoDataUrl);
      if (webLogo && (!/^data:image\/(png|jpeg|webp);base64,/i.test(webLogo) || webLogo.length > 750000)) {
        const error = new Error('The web logo must be a resized PNG, JPG, or WebP image below the allowed size.');
        error.status = 400;
        throw error;
      }
      await saveWebBranding(env, { WebLogoDataUrl: webLogo, UpdatedAt: new Date().toISOString() });
    }
    delete profile.WebLogoUrl;
    delete profile.WebLogoConfigured;
    delete profile.TurnstileSiteKey;
    await upsertDocument(env, 'settings', 'organisationProfile', organizationProfileDocument({
      ...organization,
      WorkspaceId: deployment.workspaceId,
      GoogleDocumentsUrl: profile.GoogleDocumentsUrl,
      Plan: profile.SubscriptionPlan,
      UserLimit: profile.UserLimit,
      BrandName: 'Dynamax',
      BrandLogoUrl: '/images/Logo.png'
    }, {
      UpdatedAt: profile.UpdatedAt, UpdatedBy: 'Setup'
    }));
    await upsertDocument(env, 'settings', 'schoolProfile', profile);
    invalidateProfileCache();
    invalidateDeploymentIdentityCache();
    const savedProfile = await getProfile(env, { fresh: true });
    finishRequestMetric(metric, { status: 200, action });
    return Response.json({ ok: true, message: 'Organisation setup saved.', profile: savedProfile }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    const status = err.status || 500;
    finishRequestMetric(metric, { status, action, outcome: err.code || 'error' });
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
