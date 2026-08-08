import {
  normalizeSubscriptionPlan,
  subscriptionAccessState,
  subscriptionPlanEntitlements,
  subscriptionPlanUserLimit
} from './subscription-plans.js';

const clean = (value) => String(value ?? '').trim();

export const ORGANIZATION_EDITIONS = Object.freeze(['school', 'faith', 'organization']);

export const SCHOOL_ONLY_SECTION_KEYS = Object.freeze([
  'admissions', 'formPurchases', 'students', 'studentConduct', 'accounts',
  'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore'
]);

export const SCHOOL_ONLY_STAFF_ROLES = Object.freeze([
  'Principal', 'Admissions Officer', 'Student Welfare Officer',
  'Tuck Shop User', 'Clinic User', 'Kitchen User'
]);

export const FAITH_ONLY_STAFF_ROLES = Object.freeze([
  'Senior Pastor', 'Head Minister', 'Pastor', 'Church Administrator',
  'Membership Officer'
]);

export const ORGANIZATION_ONLY_STAFF_ROLES = Object.freeze([
  'Executive Director', 'Organisation Administrator', 'Operations Manager',
  'Procurement Officer', 'Records Officer'
]);

export const SHARED_STAFF_ROLES = Object.freeze([
  'Super Admin', 'Accounts Officer', 'Management', 'Department User',
  'Front Desk', 'HR Director', 'HR Manager', 'HR Business Partner',
  'HR Officer', 'HR Assistant', 'Recruitment Officer',
  'Learning & Development Officer', 'Employee Relations Officer',
  'Performance Management Officer', 'Compensation & Benefits Officer',
  'Payroll Officer', 'Health & Safety Officer', 'Line Manager'
]);

export const NON_SCHOOL_OPERATION_ROLES = Object.freeze([
  'Store User', 'Restaurant User', 'Treasurer', 'Auditor'
]);

const EDITION_STAFF_ROLE_SETS = Object.freeze({
  school: new Set([...SHARED_STAFF_ROLES, ...SCHOOL_ONLY_STAFF_ROLES]),
  faith: new Set([...SHARED_STAFF_ROLES, ...FAITH_ONLY_STAFF_ROLES, ...NON_SCHOOL_OPERATION_ROLES]),
  organization: new Set([
    ...SHARED_STAFF_ROLES,
    ...ORGANIZATION_ONLY_STAFF_ROLES,
    ...NON_SCHOOL_OPERATION_ROLES
  ])
});

const NON_SCHOOL_DISABLED_FEATURES = new Set([
  'admissions', 'students', 'studentConduct', 'parentPortal',
  'stores', 'clinic', 'kitchen'
]);

export const EDITION_FEATURE_DEFAULTS = Object.freeze({
  school: Object.freeze({
    branches: true,
    branding: true,
    approvals: true,
    executiveOffice: true,
    humanResources: true,
    staffAttendance: true,
    accounting: true,
    payroll: true,
    admissions: true,
    students: true,
    studentConduct: true,
    parentPortal: true,
    stores: true,
    clinic: true,
    kitchen: true,
    members: false,
    services: false,
    funds: false,
    offerings: false
  }),
  faith: Object.freeze({
    branches: true,
    branding: true,
    approvals: true,
    executiveOffice: true,
    humanResources: true,
    staffAttendance: true,
    accounting: true,
    payroll: true,
    admissions: false,
    students: false,
    studentConduct: false,
    parentPortal: false,
    stores: false,
    clinic: false,
    kitchen: false,
    members: true,
    services: true,
    funds: true,
    offerings: true,
    donations: true,
    departments: true,
    programs: true,
    retail: true,
    restaurant: true
  }),
  organization: Object.freeze({
    branches: true,
    branding: true,
    approvals: true,
    executiveOffice: true,
    humanResources: true,
    staffAttendance: true,
    accounting: true,
    payroll: true,
    admissions: false,
    students: false,
    studentConduct: false,
    parentPortal: false,
    stores: false,
    clinic: false,
    kitchen: false,
    members: true,
    services: true,
    funds: true,
    offerings: true,
    donations: true,
    departments: true,
    programs: true
  })
});

function booleanValue(value, fallback) {
  if (typeof value === 'boolean') return value;
  const normalized = clean(value).toLowerCase();
  if (['yes', 'true', '1', 'on', 'enabled'].includes(normalized)) return true;
  if (['no', 'false', '0', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

export function normalizeOrganizationEdition(value) {
  const normalized = clean(value).toLowerCase();
  if (['church', 'religious', 'religious body', 'religious organisation', 'religious organization'].includes(normalized)) return 'faith';
  if (normalized === 'other') return 'organization';
  return ORGANIZATION_EDITIONS.includes(normalized) ? normalized : 'school';
}

export function staffRoleAllowedForEdition(role, edition) {
  return EDITION_STAFF_ROLE_SETS[normalizeOrganizationEdition(edition)].has(clean(role));
}

function explicitOrganizationEdition(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return '';
  if (['church', 'religious', 'religious body', 'religious organisation', 'religious organization'].includes(normalized)) return 'faith';
  if (normalized === 'other') return 'organization';
  return ORGANIZATION_EDITIONS.includes(normalized) ? normalized : '';
}

export function featureFlagsForEdition(edition, overrides = {}) {
  const normalizedEdition = normalizeOrganizationEdition(edition);
  const defaults = EDITION_FEATURE_DEFAULTS[normalizedEdition];
  const supplied = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
  return Object.fromEntries(Object.entries(defaults).map(([feature, enabled]) => [
    feature,
    normalizedEdition !== 'school' && NON_SCHOOL_DISABLED_FEATURES.has(feature)
      ? false
      : Object.prototype.hasOwnProperty.call(supplied, feature)
      ? booleanValue(supplied[feature], enabled)
      : enabled
  ]));
}

export function featureFlagsForPlan(edition, plan, overrides = {}, configuredEntitlements = null) {
  const normalizedPlan = normalizeSubscriptionPlan(plan);
  const editionFlags = featureFlagsForEdition(edition, overrides);
  const entitlements = Array.isArray(configuredEntitlements) || configuredEntitlements === '*'
    ? configuredEntitlements
    : subscriptionPlanEntitlements(normalizedPlan, normalizeOrganizationEdition(edition));
  if (entitlements === '*') return editionFlags;
  const allowed = new Set(entitlements);
  return Object.fromEntries(Object.entries(editionFlags).map(([feature, enabled]) => [
    feature,
    enabled === true && allowed.has(feature)
  ]));
}

export function resolveOrganizationConfig({ env = {}, organizationProfile = {}, legacyProfile = {} } = {}) {
  const profile = organizationProfile && typeof organizationProfile === 'object' ? organizationProfile : {};
  const legacy = legacyProfile && typeof legacyProfile === 'object' ? legacyProfile : {};
  const britishEnvironmentEdition = clean(env.ORGANISATION_EDITION);
  const americanEnvironmentEdition = clean(env.ORGANIZATION_EDITION);
  const environmentEdition = britishEnvironmentEdition || americanEnvironmentEdition;
  const configuredEdition = explicitOrganizationEdition(environmentEdition);
  if (environmentEdition && !configuredEdition) {
    const error = new Error('The deployment organisation edition is invalid.');
    error.status = 503;
    error.code = 'DEPLOYMENT_EDITION_INVALID';
    throw error;
  }
  if (britishEnvironmentEdition && americanEnvironmentEdition
    && explicitOrganizationEdition(britishEnvironmentEdition) !== explicitOrganizationEdition(americanEnvironmentEdition)) {
    const error = new Error('ORGANISATION_EDITION and ORGANIZATION_EDITION identify different deployments.');
    error.status = 503;
    error.code = 'DEPLOYMENT_EDITION_CONFLICT';
    throw error;
  }
  const profileEdition = clean(profile.Edition || profile.OrganisationEdition || profile.OrganizationEdition);
  if (environmentEdition && profileEdition) {
    const storedEdition = explicitOrganizationEdition(profileEdition);
    if (!storedEdition || (configuredEdition && storedEdition !== configuredEdition)) {
      const error = new Error('The database organisation profile conflicts with this deployment edition.');
      error.status = 503;
      error.code = storedEdition
        ? 'DEPLOYMENT_PROFILE_EDITION_CONFLICT'
        : 'DEPLOYMENT_PROFILE_EDITION_INVALID';
      throw error;
    }
  }
  const edition = normalizeOrganizationEdition(
    environmentEdition
      || profileEdition
      || legacy.OrganisationEdition || legacy.OrganizationEdition
  );
  const fallbackName = edition === 'school' ? 'Your School Name' : 'Your Organisation Name';
  const name = clean(
    profile.Name || profile.OrganisationName || profile.OrganizationName
      || legacy.OrganisationName || legacy.OrganizationName || legacy.SchoolName
      || env.ORGANISATION_NAME || env.ORGANIZATION_NAME || env.SCHOOL_NAME
  ) || fallbackName;
  const code = clean(
    profile.Code || profile.OrganisationCode || profile.OrganizationCode
      || legacy.OrganisationCode || legacy.OrganizationCode || legacy.SchoolCode
      || env.ORGANISATION_CODE || env.ORGANIZATION_CODE || env.SCHOOL_CODE
  ).toUpperCase().replace(/[^A-Z0-9]/g, '') || (edition === 'school' ? 'DCA' : 'ORG');
  // FeatureFlags is the calculated output saved by older releases. Treating
  // that output as an override made a later plan upgrade remain artificially
  // locked. Only the explicit override field is authoritative.
  const overrides = profile.FeatureOverrides
    || legacy.FeatureOverrides || {};
  const planEntitlements = profile.PlanEntitlements ?? profile.FeatureEntitlements
    ?? legacy.PlanEntitlements ?? legacy.FeatureEntitlements ?? null;
  const configuredPlan = clean(
    profile.Plan || profile.SubscriptionPlan
      || legacy.Plan || legacy.SubscriptionPlan
      || env.SUBSCRIPTION_PLAN
  );
  // Profiles created before subscription plans existed retain full operations
  // until an explicit plan is selected. New profiles are written with Starter.
  const plan = normalizeSubscriptionPlan(configuredPlan || 'Professional');
  const defaultLimit = subscriptionPlanUserLimit(plan);
  const subscription = subscriptionAccessState({
    Plan: plan,
    SubscriptionStatus: profile.SubscriptionStatus || legacy.SubscriptionStatus || env.SUBSCRIPTION_STATUS,
    TrialStartedAt: profile.TrialStartedAt || legacy.TrialStartedAt || env.TRIAL_STARTED_AT,
    TrialEndsAt: profile.TrialEndsAt || legacy.TrialEndsAt || env.TRIAL_ENDS_AT,
    LifecycleStage: profile.LifecycleStage || legacy.LifecycleStage,
    PaidThroughAt: profile.PaidThroughAt || legacy.PaidThroughAt,
    RenewalDueAt: profile.RenewalDueAt || legacy.RenewalDueAt,
    GracePeriodEndsAt: profile.GracePeriodEndsAt || legacy.GracePeriodEndsAt,
    DataRetentionEndsAt: profile.DataRetentionEndsAt || legacy.DataRetentionEndsAt
  });
  const planFlags = featureFlagsForPlan(edition, plan, overrides, planEntitlements);
  return {
    Edition: edition,
    Name: name,
    Code: code,
    Plan: plan,
    UserLimit: Math.max(1, Number(profile.UserLimit || legacy.UserLimit || env.USER_LIMIT || defaultLimit) || defaultLimit),
    FeatureOverrides: overrides,
    PlanEntitlements: planEntitlements,
    FeatureFlags: subscription.SubscriptionActive
      ? planFlags
      : Object.fromEntries(Object.keys(planFlags).map((feature) => [feature, false])),
    ...subscription
  };
}

export function organizationProfileDocument(config, audit = {}) {
  const resolved = resolveOrganizationConfig({ organizationProfile: config });
  return {
    WorkspaceId: clean(config.WorkspaceId || config.workspaceId),
    Edition: resolved.Edition,
    Name: resolved.Name,
    Code: resolved.Code,
    FeatureOverrides: config.FeatureOverrides || config.featureOverrides || resolved.FeatureOverrides || {},
    PlanEntitlements: config.PlanEntitlements ?? config.FeatureEntitlements ?? resolved.PlanEntitlements ?? null,
    PlanCatalogRevision: clean(config.PlanCatalogRevision || config.planCatalogRevision),
    FeatureFlags: resolved.FeatureFlags,
    UpdatedAt: clean(audit.UpdatedAt),
    UpdatedBy: clean(audit.UpdatedBy),
    GoogleDocumentsUrl: clean(config.GoogleDocumentsUrl || config.googleDocumentsUrl),
    Plan: normalizeSubscriptionPlan(config.Plan || config.plan || resolved.Plan || 'Starter'),
    UserLimit: Math.max(1, Number(config.UserLimit || config.userLimit || resolved.UserLimit || 5) || 5),
    SubscriptionStatus: clean(config.SubscriptionStatus || config.subscriptionStatus || resolved.SubscriptionStatus),
    TrialStartedAt: clean(config.TrialStartedAt || config.trialStartedAt || resolved.TrialStartedAt),
    TrialEndsAt: clean(config.TrialEndsAt || config.trialEndsAt || resolved.TrialEndsAt),
    LifecycleStage: clean(config.LifecycleStage || config.lifecycleStage),
    PaidThroughAt: clean(config.PaidThroughAt || config.paidThroughAt || resolved.PaidThroughAt),
    RenewalDueAt: clean(config.RenewalDueAt || config.renewalDueAt || resolved.RenewalDueAt),
    GracePeriodEndsAt: clean(config.GracePeriodEndsAt || config.gracePeriodEndsAt || resolved.GracePeriodEndsAt),
    DataRetentionEndsAt: clean(config.DataRetentionEndsAt || config.dataRetentionEndsAt || resolved.DataRetentionEndsAt),
    BrandName: clean(config.BrandName || config.brandName) || 'Dynamax',
    BrandLogoUrl: clean(config.BrandLogoUrl || config.brandLogoUrl)
  };
}

const SECTION_FEATURES = Object.freeze({
  executiveOffice: 'executiveOffice',
  humanResources: 'humanResources',
  admissions: 'admissions',
  formPurchases: 'admissions',
  students: 'students',
  studentConduct: 'studentConduct',
  accounts: Object.freeze(['students', 'accounting']),
  incomeAnalytics: 'accounting',
  financeRequests: 'approvals',
  payroll: 'payroll',
  clinic: 'clinic',
  kitchen: 'kitchen',
  tuckShop: 'stores',
  bookstore: 'stores',
  uniformStore: 'stores',
  organizationStore: 'retail',
  restaurant: 'restaurant',
  members: 'members',
  services: 'services',
  staffAttendance: 'staffAttendance',
  funds: 'funds',
  offerings: 'offerings',
  donations: 'donations',
  departments: 'departments',
  programs: 'programs'
});

export function filterSectionsForFeatures(sections, featureFlags) {
  const flags = featureFlags && typeof featureFlags === 'object' ? featureFlags : null;
  if (!flags) return [...new Set((sections || []).map(clean).filter(Boolean))];
  return [...new Set((sections || []).map(clean).filter((section) => {
    const requirements = SECTION_FEATURES[section];
    if (!requirements) return true;
    const features = Array.isArray(requirements) ? requirements : [requirements];
    return features.every((feature) => flags[feature] === true);
  }))];
}
