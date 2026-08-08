import { getDocument, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { secureTextEqual } from '../lib/backend-security.js';
import {
  requireAppsScriptWebAppUrl,
  selectDocumentStorageUrl
} from '../lib/document-storage.js';
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
import { getSchoolStructure } from '../lib/school-scope.js';
import {
  assertConfiguredProfileBranch,
  effectiveBranchProfile,
  resetBranchProfileOverrides,
  saveBranchProfileOverrides
} from '../lib/branch-profile-settings.js';
import { refreshOrganizationPlanPolicy } from '../lib/plan-policy-sync.js';
import { readStaffSession } from '../lib/staff-auth.js';

const PROFILE_CACHE_MS = 15000;
let profileCache = null;

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeSchoolCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DCA';
}

async function requireAdmin(env, request, password) {
  const expected = clean(env.ADMIN_WEB_PASSWORD);
  if (expected && secureTextEqual(password, expected)) return;
  const staff = await readStaffSession(env, request).catch(() => null);
  if (staff && clean(staff.role || staff.Role) === 'Super Admin') return;
  if (!expected) {
    const err = new Error('Setup login is not configured. Add ADMIN_WEB_PASSWORD in Cloudflare.');
    err.status = 503;
    throw err;
  }
  const err = new Error('Invalid setup password or Super Administrator session.');
  err.status = 401;
  throw err;
}

function defaultProfile(env) {
  const deployment = requiredDeploymentIdentity(env);
  const organization = resolveOrganizationConfig({
    env: { ...env, ORGANISATION_EDITION: deployment.edition, ORGANIZATION_EDITION: '' }
  });
  const documentStorage = selectDocumentStorageUrl({
    environmentUrl: env.GOOGLE_APPS_SCRIPT_URL,
    alternateEnvironmentUrl: env.GOOGLE_DOCUMENTS_URL,
    edition: deployment.edition
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
    GoogleDocumentsUrl: documentStorage.url,
    SubscriptionPlan: clean(env.SUBSCRIPTION_PLAN) || 'Starter',
    SubscriptionStatus: clean(env.SUBSCRIPTION_STATUS),
    TrialStartedAt: clean(env.TRIAL_STARTED_AT),
    TrialEndsAt: clean(env.TRIAL_ENDS_AT),
    UserLimit: Math.max(1, Number(env.USER_LIMIT || 5) || 5),
    TurnstileSiteKey: clean(env.TURNSTILE_SITE_KEY),
    UpdatedAt: ''
  };
}

function profileEnvironmentKey(env, branchId = '') {
  const deployment = requiredDeploymentIdentity(env);
  return [
    clean(env.FIREBASE_PROJECT_ID),
    deployment.workspaceId,
    deployment.edition,
    clean(env.TURNSTILE_SITE_KEY),
    clean(branchId).toLowerCase()
  ].join('|');
}

function invalidateProfileCache() {
  profileCache = null;
}

async function loadProfile(env, options = {}) {
  const deployment = requiredDeploymentIdentity(env);
  const requestedBranchId = clean(options.branchId || options.BranchId);
  let profile = defaultProfile(env);
  let savedOrganization = null;
  try {
    requireFirestoreEnv(env);
    const [saved, storedOrganization, branding, structure] = await Promise.all([
      getDocument(env, 'settings', 'schoolProfile'),
      getDocument(env, 'settings', 'organisationProfile'),
      getWebBranding(env),
      getSchoolStructure(env)
    ]);
    savedOrganization = storedOrganization
      ? await refreshOrganizationPlanPolicy(env, storedOrganization)
      : storedOrganization;
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
    profile.PlanEntitlements = organization.PlanEntitlements;
    profile.PlanCatalogRevision = clean(savedOrganization?.PlanCatalogRevision);
    profile.SubscriptionPlan = organization.Plan;
    profile.SubscriptionStatus = organization.SubscriptionStatus;
    profile.SubscriptionActive = organization.SubscriptionActive;
    profile.SubscriptionState = organization.SubscriptionState;
    profile.SubscriptionMessage = organization.SubscriptionMessage;
    profile.TrialStartedAt = organization.TrialStartedAt;
    profile.TrialEndsAt = organization.TrialEndsAt;
    profile.TrialDaysRemaining = organization.TrialDaysRemaining;
    if (branding && clean(branding.WebLogoDataUrl)) {
      profile.WebLogoConfigured = true;
      profile.WebLogoUrl = `/api/web-logo?v=${encodeURIComponent(clean(branding.UpdatedAt))}`;
    }
    profile.AvailableBranches = (structure.Branches || []).map((row) => ({
      Id: clean(row.Id),
      Name: clean(row.Name || row.Id)
    }));
    if (requestedBranchId) {
      await assertConfiguredProfileBranch(env, requestedBranchId);
      profile = await effectiveBranchProfile(env, profile, requestedBranchId);
    } else {
      profile = await effectiveBranchProfile(env, profile);
    }
  } catch (error) {
    const errorStatus = Number(error?.status || 0);
    if (requestedBranchId || String(error?.code || '').startsWith('DEPLOYMENT_') || (errorStatus >= 400 && errorStatus < 500)) throw error;
    // Public pages should still load with environment/default values if Firestore is unavailable.
  }
  if (!profile.SettingsScope) profile = await effectiveBranchProfile(env, profile);
  profile.TurnstileSiteKey = clean(env.TURNSTILE_SITE_KEY);
  profile.GoogleDocumentsUrl = selectDocumentStorageUrl({
    environmentUrl: env.GOOGLE_APPS_SCRIPT_URL,
    alternateEnvironmentUrl: env.GOOGLE_DOCUMENTS_URL,
    organizationUrl: savedOrganization?.GoogleDocumentsUrl,
    schoolUrl: profile.GoogleDocumentsUrl,
    edition: deployment.edition
  }).url;
  delete profile.__name;
  delete profile.__id;
  delete profile.__createTime;
  delete profile.__updateTime;
  return profile;
}

async function getProfile(env, options = {}) {
  const branchId = clean(options.branchId || options.BranchId);
  const environmentKey = profileEnvironmentKey(env, branchId);
  if (!options.fresh && profileCache && profileCache.environmentKey === environmentKey && profileCache.expiresAt > Date.now()) {
    return { ...profileCache.profile };
  }
  const profile = await loadProfile(env, { branchId });
  profileCache = { environmentKey, profile, expiresAt: Date.now() + PROFILE_CACHE_MS };
  return { ...profile };
}

function publicProfile(profile = {}) {
  const keys = [
    'WorkspaceId', 'OrganisationEdition', 'OrganisationName', 'OrganisationCode',
    'SchoolName', 'SchoolAddress', 'SchoolPhone', 'SchoolEmail',
    'PortalHeadline', 'PortalSubheading', 'PortalNotice', 'NameFormat',
    'ResultDisplayMode', 'ShowResultsOnline', 'DeclarationStatement',
    'WebLogoUrl', 'WebLogoConfigured', 'TurnstileSiteKey', 'EffectiveBranchId'
  ];
  return Object.fromEntries(keys
    .filter((key) => profile[key] !== undefined)
    .map((key) => [key, profile[key]]));
}

export async function onRequestGet(context) {
  const metric = startRequestMetric(context.request, '/api/settings');
  const url = new URL(context.request.url);
  const branchId = clean(url.searchParams.get('branchId') || url.searchParams.get('branch'));
  const profile = publicProfile(await getProfile(context.env, { branchId }));
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
    await requireAdmin(env, request, body.password);
    const settingsScope = clean(body.SettingsScope || body.settingsScope).toLowerCase();
    const branchId = clean(body.BranchId || body.branchId);
    if (clean(body.action || body.Action) === 'load') {
      action = 'load-private-profile';
      const profile = await getProfile(env, {
        fresh: true,
        branchId: settingsScope === 'branch' ? branchId : ''
      });
      finishRequestMetric(metric, { status: 200, action });
      return Response.json({ ok: true, profile }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (clean(body.action || body.Action) === 'resetBranchOverrides') {
      action = 'reset-branch-profile-overrides';
      requireFirestoreEnv(env);
      const reset = await resetBranchProfileOverrides(env, branchId);
      invalidateProfileCache();
      const profile = await getProfile(env, { fresh: true, branchId: reset.branch.id });
      finishRequestMetric(metric, { status: 200, action });
      return Response.json({
        ok: true,
        message: `${reset.branch.name} now inherits every organisation setting.`,
        profile
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const incoming = body.profile || {};
    if (settingsScope === 'branch') {
      action = 'save-branch-profile-overrides';
      requireFirestoreEnv(env);
      const defaults = await getProfile(env, { fresh: true });
      const saved = await saveBranchProfileOverrides(env, {
        branchId,
        defaultProfile: defaults,
        submittedProfile: incoming,
        updatedBy: incoming.UpdatedBy || 'Setup'
      });
      invalidateProfileCache();
      const profile = await getProfile(env, { fresh: true, branchId: saved.branch.id });
      finishRequestMetric(metric, { status: 200, action });
      return Response.json({
        ok: true,
        message: saved.fields.length
          ? `${saved.branch.name} overrides saved; all other values continue to inherit organisation defaults.`
          : `${saved.branch.name} now inherits every organisation setting.`,
        profile
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
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
        FeatureOverrides: incoming.FeatureOverrides || incoming.FeatureFlags
          || incoming.Features || existing.FeatureOverrides,
        Plan: incoming.SubscriptionPlan || existing.SubscriptionPlan,
        SubscriptionStatus: existing.SubscriptionStatus,
        TrialStartedAt: existing.TrialStartedAt,
        TrialEndsAt: existing.TrialEndsAt,
        PlanEntitlements: existing.PlanEntitlements,
        PlanCatalogRevision: existing.PlanCatalogRevision,
        UserLimit: incoming.UserLimit || existing.UserLimit
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
      FeatureOverrides: organization.FeatureOverrides,
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
      GoogleDocumentsUrl: requireAppsScriptWebAppUrl(incoming.GoogleDocumentsUrl),
      SubscriptionPlan: organization.Plan,
      SubscriptionStatus: organization.SubscriptionStatus,
      SubscriptionActive: organization.SubscriptionActive,
      SubscriptionState: organization.SubscriptionState,
      SubscriptionMessage: organization.SubscriptionMessage,
      TrialStartedAt: organization.TrialStartedAt,
      TrialEndsAt: organization.TrialEndsAt,
      TrialDaysRemaining: organization.TrialDaysRemaining,
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
      PlanEntitlements: existing.PlanEntitlements,
      PlanCatalogRevision: existing.PlanCatalogRevision,
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
