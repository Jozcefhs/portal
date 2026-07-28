const clean = (value) => String(value ?? '').trim();

export const ORGANIZATION_EDITIONS = Object.freeze(['school', 'church', 'faith', 'organization']);

export const EDITION_FEATURE_DEFAULTS = Object.freeze({
  school: Object.freeze({
    branches: true,
    branding: true,
    approvals: true,
    executiveOffice: true,
    accounting: true,
    payroll: true,
    admissions: true,
    students: true,
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
    accounting: true,
    payroll: true,
    admissions: false,
    students: false,
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
  church: Object.freeze({
    branches: true,
    branding: true,
    approvals: true,
    executiveOffice: true,
    accounting: true,
    payroll: true,
    admissions: false,
    students: false,
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
    accounting: true,
    payroll: true,
    admissions: false,
    students: false,
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
  if (normalized === 'religious' || normalized === 'religious body') return 'faith';
  if (normalized === 'other') return 'organization';
  return ORGANIZATION_EDITIONS.includes(normalized) ? normalized : 'school';
}

export function featureFlagsForEdition(edition, overrides = {}) {
  const normalizedEdition = normalizeOrganizationEdition(edition);
  const defaults = EDITION_FEATURE_DEFAULTS[normalizedEdition];
  const supplied = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
  return Object.fromEntries(Object.entries(defaults).map(([feature, enabled]) => [
    feature,
    Object.prototype.hasOwnProperty.call(supplied, feature)
      ? booleanValue(supplied[feature], enabled)
      : enabled
  ]));
}

export function resolveOrganizationConfig({ env = {}, organizationProfile = {}, legacyProfile = {} } = {}) {
  const profile = organizationProfile && typeof organizationProfile === 'object' ? organizationProfile : {};
  const legacy = legacyProfile && typeof legacyProfile === 'object' ? legacyProfile : {};
  const edition = normalizeOrganizationEdition(
    profile.Edition || profile.OrganisationEdition || profile.OrganizationEdition
      || legacy.OrganisationEdition || legacy.OrganizationEdition
      || env.ORGANISATION_EDITION || env.ORGANIZATION_EDITION
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
  const overrides = profile.FeatureFlags || profile.Features
    || legacy.FeatureFlags || legacy.Features || {};
  return {
    Edition: edition,
    Name: name,
    Code: code,
    FeatureFlags: featureFlagsForEdition(edition, overrides)
  };
}

export function organizationProfileDocument(config, audit = {}) {
  const resolved = resolveOrganizationConfig({ organizationProfile: config });
  return {
    Edition: resolved.Edition,
    Name: resolved.Name,
    Code: resolved.Code,
    FeatureFlags: resolved.FeatureFlags,
    UpdatedAt: clean(audit.UpdatedAt),
    UpdatedBy: clean(audit.UpdatedBy),
    GoogleDocumentsUrl: clean(config.GoogleDocumentsUrl || config.googleDocumentsUrl),
    Plan: clean(config.Plan || config.plan) || 'Starter',
    UserLimit: Math.max(1, Number(config.UserLimit || config.userLimit || 5) || 5),
    BrandName: clean(config.BrandName || config.brandName) || 'Dynamax',
    BrandLogoUrl: clean(config.BrandLogoUrl || config.brandLogoUrl)
  };
}

const SECTION_FEATURES = Object.freeze({
  executiveOffice: 'executiveOffice',
  admissions: 'admissions',
  formPurchases: 'admissions',
  students: 'students',
  accounts: 'students',
  incomeAnalytics: 'accounting',
  financeRequests: 'accounting',
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
    const feature = SECTION_FEATURES[section];
    return !feature || flags[feature] === true;
  }))];
}
