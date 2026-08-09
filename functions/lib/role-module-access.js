import {
  filterSectionsForFeatures,
  normalizeOrganizationEdition,
  staffRoleAllowedForEdition
} from './organization-config.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export const WEB_SECTION_CATALOG = Object.freeze([
  Object.freeze({ key: 'recordsDesk', label: 'Records Desk' }),
  Object.freeze({ key: 'executiveOffice', label: 'Executive Office' }),
  Object.freeze({ key: 'admissions', label: 'Admissions' }),
  Object.freeze({ key: 'formPurchases', label: 'Form Purchases' }),
  Object.freeze({ key: 'students', label: 'Students' }),
  Object.freeze({ key: 'studentConduct', label: 'Student Conduct & Discipline' }),
  Object.freeze({ key: 'humanResources', label: 'Human Resources' }),
  Object.freeze({ key: 'members', label: 'Departments & Members' }),
  Object.freeze({ key: 'services', label: 'Services & Attendance' }),
  Object.freeze({ key: 'staffAttendance', label: 'Staff Attendance' }),
  Object.freeze({ key: 'funds', label: 'Funds & Mappings' }),
  Object.freeze({ key: 'offerings', label: 'Offerings' }),
  Object.freeze({ key: 'donations', label: 'Donations' }),
  Object.freeze({ key: 'accounts', label: 'Accounts' }),
  Object.freeze({ key: 'incomeAnalytics', label: 'Income Analytics' }),
  Object.freeze({ key: 'financeRequests', label: 'Bills & Requisitions' }),
  Object.freeze({ key: 'payroll', label: 'My Payroll' }),
  Object.freeze({ key: 'clinic', label: 'Clinic' }),
  Object.freeze({ key: 'kitchen', label: 'Kitchen' }),
  Object.freeze({ key: 'tuckShop', label: 'Tuck Shop' }),
  Object.freeze({ key: 'bookstore', label: 'Books & Supplies' }),
  Object.freeze({ key: 'uniformStore', label: 'Clothing & Supplies' }),
  Object.freeze({ key: 'organizationStore', label: 'Organisation Store' }),
  Object.freeze({ key: 'restaurant', label: 'Restaurant' }),
  Object.freeze({ key: 'dataBackup', label: 'Backup & Restore' }),
  Object.freeze({ key: 'securityAudit', label: 'Security Audit Log' }),
  Object.freeze({ key: 'staffUsers', label: 'Staff & Permissions' })
]);

export const WEB_SECTION_KEYS = Object.freeze(WEB_SECTION_CATALOG.map(({ key }) => key));
const WEB_SECTION_KEY_SET = new Set(WEB_SECTION_KEYS);

export const ORGANIZATION_SECTION_LABELS = Object.freeze({
  recordsDesk: 'Records Centre',
  members: 'Departments & Personnel',
  services: 'Meetings & Attendance',
  funds: 'Budgets & Account Mappings',
  offerings: 'Income & Receipts',
  donations: 'Grants & Contributions',
  incomeAnalytics: 'Revenue Analytics',
  organizationStore: 'Inventory & Sales',
  restaurant: 'Catering Operations',
  dataBackup: 'Backup & Restore',
  securityAudit: 'Security Audit Log',
  staffUsers: 'Users & Permissions'
});

export const STAFF_ROLE_OPTIONS = Object.freeze([
  'Super Admin', 'Principal', 'Senior Pastor', 'Head Minister',
  'Admissions Officer', 'Student Welfare Officer', 'Accounts Officer',
  'Management', 'Department User', 'Tuck Shop User', 'Clinic User',
  'Kitchen User', 'Store User', 'Restaurant User', 'Front Desk', 'Pastor',
  'Church Administrator', 'Membership Officer', 'Treasurer', 'Auditor',
  'HR Director', 'HR Manager', 'HR Business Partner', 'HR Officer',
  'HR Assistant', 'Recruitment Officer', 'Learning & Development Officer',
  'Employee Relations Officer', 'Performance Management Officer',
  'Compensation & Benefits Officer', 'Payroll Officer',
  'Health & Safety Officer', 'Line Manager',
  'Executive Director', 'Organisation Administrator', 'Operations Manager',
  'Procurement Officer', 'Records Officer'
]);

const LEGACY_ROLE_DEFAULTS = Object.freeze({
  'Super Admin': ['recordsDesk', 'executiveOffice', 'admissions', 'formPurchases', 'students', 'studentConduct', 'accounts', 'incomeAnalytics', 'members', 'services', 'funds', 'offerings', 'donations', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore', 'organizationStore', 'restaurant', 'dataBackup', 'securityAudit', 'staffUsers'],
  Principal: ['recordsDesk', 'executiveOffice', 'studentConduct'],
  'Admissions Officer': ['recordsDesk', 'admissions', 'formPurchases', 'students', 'studentConduct', 'financeRequests', 'payroll'],
  'Accounts Officer': ['recordsDesk', 'students', 'accounts', 'incomeAnalytics', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore'],
  Management: ['recordsDesk', 'admissions', 'formPurchases', 'students', 'studentConduct', 'accounts', 'incomeAnalytics', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore'],
  'Student Welfare Officer': ['recordsDesk', 'students', 'studentConduct'],
  'Tuck Shop User': ['recordsDesk', 'tuckShop', 'financeRequests', 'payroll'],
  'Clinic User': ['recordsDesk', 'clinic', 'financeRequests', 'payroll'],
  'Kitchen User': ['kitchen', 'financeRequests', 'payroll'],
  'Store User': ['organizationStore', 'financeRequests', 'payroll'],
  'Restaurant User': ['restaurant', 'financeRequests', 'payroll'],
  'Front Desk': ['recordsDesk', 'admissions', 'formPurchases', 'students', 'financeRequests', 'payroll'],
  Pastor: ['recordsDesk', 'members', 'services', 'funds', 'offerings', 'donations'],
  'Senior Pastor': ['recordsDesk', 'executiveOffice'],
  'Head Minister': ['recordsDesk', 'executiveOffice'],
  'Church Administrator': ['recordsDesk', 'members', 'services', 'funds', 'offerings', 'donations', 'organizationStore', 'restaurant', 'financeRequests', 'payroll'],
  'Membership Officer': ['recordsDesk', 'members', 'services'],
  Treasurer: ['recordsDesk', 'funds', 'offerings', 'donations', 'incomeAnalytics', 'financeRequests', 'payroll'],
  Auditor: ['recordsDesk', 'funds', 'offerings', 'donations', 'incomeAnalytics', 'financeRequests', 'securityAudit'],
  'HR Director': ['recordsDesk', 'humanResources', 'payroll'],
  'HR Manager': ['recordsDesk', 'humanResources', 'payroll'],
  'HR Business Partner': ['recordsDesk', 'humanResources', 'payroll'],
  'HR Officer': ['recordsDesk', 'humanResources', 'payroll'],
  'HR Assistant': ['recordsDesk', 'humanResources', 'payroll'],
  'Recruitment Officer': ['humanResources', 'payroll'],
  'Learning & Development Officer': ['humanResources', 'payroll'],
  'Employee Relations Officer': ['humanResources', 'payroll'],
  'Performance Management Officer': ['humanResources', 'payroll'],
  'Compensation & Benefits Officer': ['recordsDesk', 'humanResources', 'payroll'],
  'Payroll Officer': ['recordsDesk', 'humanResources', 'financeRequests', 'payroll'],
  'Health & Safety Officer': ['humanResources', 'payroll'],
  'Line Manager': ['humanResources', 'payroll'],
  'Executive Director': ['recordsDesk', 'executiveOffice', 'humanResources', 'members', 'services', 'funds', 'offerings', 'donations', 'incomeAnalytics', 'financeRequests', 'payroll'],
  'Organisation Administrator': ['recordsDesk', 'executiveOffice', 'humanResources', 'members', 'services', 'funds', 'offerings', 'donations', 'incomeAnalytics', 'financeRequests', 'payroll', 'organizationStore', 'restaurant'],
  'Operations Manager': ['recordsDesk', 'humanResources', 'members', 'services', 'financeRequests', 'organizationStore', 'restaurant', 'payroll'],
  'Procurement Officer': ['recordsDesk', 'financeRequests', 'organizationStore', 'payroll'],
  'Records Officer': ['recordsDesk', 'members', 'services', 'payroll']
});

export function moduleLabelForEdition(key, label, edition) {
  return normalizeOrganizationEdition(edition) === 'organization'
    ? (ORGANIZATION_SECTION_LABELS[key] || label)
    : label;
}

export function rolesForEdition(edition) {
  return STAFF_ROLE_OPTIONS.filter((role) => staffRoleAllowedForEdition(role, edition));
}

export function modulesForEdition(edition, featureFlags = null) {
  const allowed = new Set(filterSectionsForFeatures(WEB_SECTION_KEYS, featureFlags));
  if (normalizeOrganizationEdition(edition) !== 'school') {
    ['admissions', 'formPurchases', 'students', 'studentConduct', 'accounts', 'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore']
      .forEach((key) => allowed.delete(key));
  }
  return WEB_SECTION_CATALOG
    .filter(({ key }) => allowed.has(key))
    .map(({ key, label }) => ({ key, label: moduleLabelForEdition(key, label, edition) }));
}

export function normalizeModuleList(value, edition, featureFlags = null) {
  const supplied = Array.isArray(value)
    ? value
    : clean(value).split(/[;,]/);
  const editionKeys = new Set(modulesForEdition(edition, featureFlags).map(({ key }) => key));
  return [...new Set(supplied.map(clean).filter((key) => WEB_SECTION_KEY_SET.has(key) && editionKeys.has(key)))];
}

function departmentUserDefaults(department) {
  const normalized = lower(department);
  if (normalized.includes('clinic')) return ['recordsDesk', 'clinic', 'humanResources', 'financeRequests', 'payroll'];
  if (normalized.includes('kitchen')) return ['kitchen', 'humanResources', 'financeRequests', 'payroll'];
  if (normalized.includes('restaurant') || normalized.includes('catering')) return ['restaurant', 'humanResources', 'financeRequests', 'payroll'];
  if (normalized.includes('store') || normalized.includes('retail') || normalized.includes('bookshop')) return ['organizationStore', 'humanResources', 'financeRequests', 'payroll'];
  if (normalized.includes('tuck')) return ['recordsDesk', 'tuckShop', 'humanResources', 'financeRequests', 'payroll'];
  if (normalized.includes('account') || normalized.includes('finance')) return ['recordsDesk', 'accounts', 'incomeAnalytics', 'humanResources', 'financeRequests', 'payroll'];
  return ['humanResources', 'financeRequests', 'payroll'];
}

export function defaultModulesForRole(role, { edition = 'school', featureFlags = null, department = '' } = {}) {
  const name = clean(role);
  const base = name === 'Department User'
    ? departmentUserDefaults(department)
    : [...(LEGACY_ROLE_DEFAULTS[name] || []), ...(name ? ['humanResources'] : [])];
  if (name) base.push('staffAttendance');
  if (name === 'Super Admin') base.push('dataBackup', 'securityAudit', 'staffUsers');
  return normalizeModuleList(base, edition, featureFlags);
}

export function roleAccessScope(user = {}) {
  return lower(user.branchId || user.BranchId) || 'global';
}

function withRequiredRoleModules(role, modules = []) {
  const normalized = [...modules];
  if (role === 'Super Admin') {
    if (!normalized.includes('dataBackup')) normalized.push('dataBackup');
    if (!normalized.includes('securityAudit')) normalized.push('securityAudit');
    if (!normalized.includes('staffUsers')) normalized.push('staffUsers');
  }
  return normalized;
}

function roleMapForScope(document, scope) {
  const scopes = document?.Scopes && typeof document.Scopes === 'object' && !Array.isArray(document.Scopes)
    ? document.Scopes
    : {};
  const value = scopes[scope];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function configuredModulesForUser(document, user = {}, role = clean(user.role || user.Role), edition = 'school', featureFlags = null) {
  const scope = roleAccessScope(user);
  const local = roleMapForScope(document, scope);
  const global = roleMapForScope(document, 'global');
  if (Object.prototype.hasOwnProperty.call(local, role)) {
    return normalizeModuleList(local[role], edition, featureFlags);
  }
  if (scope !== 'global' && Object.prototype.hasOwnProperty.call(global, role)) {
    return normalizeModuleList(global[role], edition, featureFlags);
  }
  return null;
}

export function roleAccessView(document, user = {}, edition = 'school', featureFlags = null) {
  const scope = roleAccessScope(user);
  const local = roleMapForScope(document, scope);
  const global = roleMapForScope(document, 'global');
  const roles = Object.fromEntries(rolesForEdition(edition).map((role) => {
    const localConfigured = Object.prototype.hasOwnProperty.call(local, role);
    const globalConfigured = scope !== 'global' && Object.prototype.hasOwnProperty.call(global, role);
    const modules = withRequiredRoleModules(role, localConfigured
      ? normalizeModuleList(local[role], edition, featureFlags)
      : globalConfigured
        ? normalizeModuleList(global[role], edition, featureFlags)
        : defaultModulesForRole(role, { edition, featureFlags }));
    return [role, {
      modules,
      source: localConfigured ? scope : globalConfigured ? 'global' : 'default',
      locallyConfigured: localConfigured
    }];
  }));
  return {
    scope,
    branchId: scope === 'global' ? '' : scope,
    roles,
    modules: modulesForEdition(edition, featureFlags)
  };
}

export function withRoleModules(document, scope, role, modules, edition, featureFlags = null) {
  const scopes = document?.Scopes && typeof document.Scopes === 'object' && !Array.isArray(document.Scopes)
    ? { ...document.Scopes }
    : {};
  const current = { ...roleMapForScope(document, scope) };
  const normalized = withRequiredRoleModules(role, normalizeModuleList(modules, edition, featureFlags));
  current[role] = normalized;
  scopes[scope] = current;
  return scopes;
}

export function withoutRoleModules(document, scope, role) {
  const scopes = document?.Scopes && typeof document.Scopes === 'object' && !Array.isArray(document.Scopes)
    ? { ...document.Scopes }
    : {};
  const current = { ...roleMapForScope(document, scope) };
  delete current[role];
  if (Object.keys(current).length) scopes[scope] = current;
  else delete scopes[scope];
  return scopes;
}
