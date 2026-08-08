const clean = (value) => String(value ?? '').trim();

export const SUBSCRIPTION_PLAN_NAMES = Object.freeze([
  'Free',
  'Starter',
  'Standard',
  'Professional',
  'Enterprise'
]);

const FULL_ACCESS = '*';
export const FREE_TRIAL_DAYS = 7;
export const SUBSCRIPTION_MODULE_CATALOG_VERSION = 2;
export const SUBSCRIPTION_CURRENCIES = Object.freeze(['NGN', 'USD']);

export const SUBSCRIPTION_MODULE_CATALOG = Object.freeze([
  Object.freeze({ Key: 'branches', Editions: Object.freeze(['school', 'faith', 'organization']), Labels: Object.freeze({ school: 'Branches & campuses', faith: 'Branches & assemblies', organization: 'Branches & offices' }), Description: 'Branch switching and branch-isolated records.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'branding', Editions: Object.freeze(['school', 'faith', 'organization']), Labels: Object.freeze({ school: 'Branding & document identity', faith: 'Branding & document identity', organization: 'Branding & document identity' }), Description: 'Organisation identity, logos and document presentation.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'approvals', Editions: Object.freeze(['school', 'faith', 'organization']), Labels: Object.freeze({ school: 'Bills, requisitions & approvals', faith: 'Bills, requisitions & approvals', organization: 'Bills, requisitions & approvals' }), Description: 'Request, review, approval and posting workflows.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'executiveOffice', Editions: Object.freeze(['school', 'faith', 'organization']), Labels: Object.freeze({ school: 'Executive Office', faith: 'Executive Office', organization: 'Executive Office' }), Description: 'Official correspondence, templates and executive records.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'humanResources', Editions: Object.freeze(['school', 'faith', 'organization']), Labels: Object.freeze({ school: 'Human Resources', faith: 'Human Resources', organization: 'Human Resources' }), Description: 'Employee journey, records, leave, welfare and performance.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'staffAttendance', Editions: Object.freeze(['school', 'faith', 'organization']), Labels: Object.freeze({ school: 'Staff attendance & clocking', faith: 'Staff attendance & clocking', organization: 'Staff attendance & clocking' }), Description: 'Clock-in/out, schedules, lateness, absence, overtime and presence checks.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'accounting', Editions: Object.freeze(['school', 'faith', 'organization']), Labels: Object.freeze({ school: 'Finance, accounting & income analytics', faith: 'Finance, accounting & income analytics', organization: 'Finance, accounting & revenue analytics' }), Description: 'Accounts, journals, expenses, analytics and finance registers.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'payroll', Editions: Object.freeze(['school', 'faith', 'organization']), Labels: Object.freeze({ school: 'Payroll', faith: 'Payroll', organization: 'Payroll' }), Description: 'Payroll profiles, calculations, approvals and payments.', Requires: Object.freeze(['accounting', 'humanResources']) }),
  Object.freeze({ Key: 'admissions', Editions: Object.freeze(['school']), Labels: Object.freeze({ school: 'Admissions & form purchases' }), Description: 'Application intake, form sales and admission processing.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'students', Editions: Object.freeze(['school']), Labels: Object.freeze({ school: 'Student records & accounts' }), Description: 'Student directory, accounts and academic identity.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'studentConduct', Editions: Object.freeze(['school']), Labels: Object.freeze({ school: 'Student conduct & discipline' }), Description: 'Conduct cases, decisions and controlled case history.', Requires: Object.freeze(['students']) }),
  Object.freeze({ Key: 'parentPortal', Editions: Object.freeze(['school']), Labels: Object.freeze({ school: 'Parent portal' }), Description: 'Parent access to payments, records, documents and notifications.', Requires: Object.freeze(['students']) }),
  Object.freeze({ Key: 'stores', Editions: Object.freeze(['school']), Labels: Object.freeze({ school: 'School stores' }), Description: 'Tuck shop, books and supplies, clothing and uniform stores.', Requires: Object.freeze(['students']) }),
  Object.freeze({ Key: 'clinic', Editions: Object.freeze(['school']), Labels: Object.freeze({ school: 'Clinic' }), Description: 'Student clinic visits, treatments and parent reports.', Requires: Object.freeze(['students']) }),
  Object.freeze({ Key: 'kitchen', Editions: Object.freeze(['school']), Labels: Object.freeze({ school: 'Kitchen' }), Description: 'Kitchen inventory, issues and purchasing operations.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'members', Editions: Object.freeze(['faith', 'organization']), Labels: Object.freeze({ faith: 'Members & households', organization: 'Personnel & records' }), Description: 'People directory, profiles and household or personnel records.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'services', Editions: Object.freeze(['faith', 'organization']), Labels: Object.freeze({ faith: 'Services & attendance', organization: 'Meetings & attendance' }), Description: 'Scheduled occurrences and attendance analysis.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'departments', Editions: Object.freeze(['faith', 'organization']), Labels: Object.freeze({ faith: 'Departments & assignments', organization: 'Departments & assignments' }), Description: 'Department records and batch people assignment.', Requires: Object.freeze(['members']) }),
  Object.freeze({ Key: 'programs', Editions: Object.freeze(['faith', 'organization']), Labels: Object.freeze({ faith: 'Programs & activities', organization: 'Programmes & activities' }), Description: 'Programme planning and operational activities.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'funds', Editions: Object.freeze(['faith', 'organization']), Labels: Object.freeze({ faith: 'Funds & mappings', organization: 'Budgets & account mappings' }), Description: 'Fund controls and accounting mappings.', Requires: Object.freeze(['accounting']) }),
  Object.freeze({ Key: 'offerings', Editions: Object.freeze(['faith', 'organization']), Labels: Object.freeze({ faith: 'Offerings', organization: 'Income & receipts' }), Description: 'Batch collection, reconciliation and posting.', Requires: Object.freeze(['accounting']) }),
  Object.freeze({ Key: 'donations', Editions: Object.freeze(['faith', 'organization']), Labels: Object.freeze({ faith: 'Donations & donor management', organization: 'Grants & contributions' }), Description: 'Donor records, currencies, conversion and giving analytics.', Requires: Object.freeze(['accounting']) }),
  Object.freeze({ Key: 'retail', Editions: Object.freeze(['faith']), Labels: Object.freeze({ faith: 'Organisation store' }), Description: 'Inventory, sales, checkout and receipts.', Requires: Object.freeze(['accounting']) }),
  Object.freeze({ Key: 'restaurant', Editions: Object.freeze(['faith']), Labels: Object.freeze({ faith: 'Restaurant' }), Description: 'Restaurant stock, ordering and sales operations.', Requires: Object.freeze(['accounting']) })
]);

const MODULE_BY_KEY = new Map(SUBSCRIPTION_MODULE_CATALOG.map((module) => [module.Key, module]));

export function subscriptionModulesForEdition(edition) {
  const normalizedEdition = ['faith', 'organization'].includes(clean(edition).toLowerCase())
    ? clean(edition).toLowerCase()
    : 'school';
  return SUBSCRIPTION_MODULE_CATALOG
    .filter((module) => module.Editions.includes(normalizedEdition))
    .map((module) => ({
      Key: module.Key,
      Label: clean(module.Labels[normalizedEdition] || module.Labels.school || module.Key),
      Description: module.Description,
      Requires: module.Requires.filter((key) => MODULE_BY_KEY.get(key)?.Editions.includes(normalizedEdition))
    }));
}

function normalizeConfiguredEntitlements(edition, value, fallback) {
  const modules = subscriptionModulesForEdition(edition);
  const allowed = new Set(modules.map((module) => module.Key));
  const supplied = value === FULL_ACCESS
    ? [...allowed]
    : Array.isArray(value)
      ? value.map(clean).filter((key) => allowed.has(key))
      : Array.isArray(fallback)
        ? fallback.map(clean).filter((key) => allowed.has(key))
        : fallback === FULL_ACCESS
          ? [...allowed]
          : [];
  const selected = new Set(supplied);
  let changed = true;
  while (changed) {
    changed = false;
    modules.forEach((module) => {
      if (!selected.has(module.Key)) return;
      module.Requires.forEach((required) => {
        if (!selected.has(required)) {
          selected.add(required);
          changed = true;
        }
      });
    });
  }
  return modules.map((module) => module.Key).filter((key) => selected.has(key));
}

export const SUBSCRIPTION_PLAN_DEFINITIONS = Object.freeze({
  Free: Object.freeze({
    UserLimit: 5,
    TrialDays: FREE_TRIAL_DAYS,
    Summary: 'Seven-day full-access trial',
    Entitlements: Object.freeze({ school: FULL_ACCESS, faith: FULL_ACCESS, organization: FULL_ACCESS }),
    Features: Object.freeze({
      school: Object.freeze(['Full access to every school module for 7 days', 'Up to 5 active users during the trial', 'Paid subscription required after the trial']),
      faith: Object.freeze(['Full access to every church module for 7 days', 'Up to 5 active users during the trial', 'Paid subscription required after the trial']),
      organization: Object.freeze(['Full access to every organisation module for 7 days', 'Up to 5 active users during the trial', 'Paid subscription required after the trial'])
    })
  }),
  Starter: Object.freeze({
    UserLimit: 5,
    Summary: 'Core records for a small team',
    Entitlements: Object.freeze({
      school: Object.freeze(['branches', 'branding', 'admissions', 'students', 'parentPortal']),
      faith: Object.freeze(['branches', 'branding', 'members', 'services', 'departments']),
      organization: Object.freeze(['branches', 'branding', 'members', 'departments'])
    }),
    Features: Object.freeze({
      school: Object.freeze(['Student and admission records', 'Parent portal', 'Records Desk', 'Branches and branding']),
      faith: Object.freeze(['Member records', 'Services and attendance', 'Departments', 'Records Desk', 'Branches and branding']),
      organization: Object.freeze(['Personnel records', 'Departments', 'Records Centre', 'Branches and branding'])
    })
  }),
  Standard: Object.freeze({
    UserLimit: 20,
    Summary: 'Finance, people and approval workflows',
    Entitlements: Object.freeze({
      school: Object.freeze([
        'branches', 'branding', 'admissions', 'students', 'parentPortal',
        'approvals', 'executiveOffice', 'humanResources', 'staffAttendance', 'accounting'
      ]),
      faith: Object.freeze([
        'branches', 'branding', 'members', 'services', 'departments', 'programs',
        'approvals', 'executiveOffice', 'humanResources', 'staffAttendance', 'accounting', 'funds', 'offerings', 'donations'
      ]),
      organization: Object.freeze([
        'branches', 'branding', 'members', 'departments', 'programs',
        'approvals', 'executiveOffice', 'humanResources', 'staffAttendance', 'accounting'
      ])
    }),
    Features: Object.freeze({
      school: Object.freeze(['Everything in Starter', 'Finance and income analytics', 'Bills, requisitions and approvals', 'Human Resources', 'Executive Office']),
      faith: Object.freeze(['Everything in Starter', 'Funds, offerings and donations', 'Finance and income analytics', 'Bills, requisitions and approvals', 'Human Resources and Executive Office']),
      organization: Object.freeze(['Everything in Starter', 'Finance and revenue analytics', 'Bills, requisitions and approvals', 'Human Resources', 'Programmes and Executive Office'])
    })
  }),
  Professional: Object.freeze({
    UserLimit: 50,
    Summary: 'Full operations for a growing organisation',
    Entitlements: Object.freeze({ school: FULL_ACCESS, faith: FULL_ACCESS, organization: FULL_ACCESS }),
    Features: Object.freeze({
      school: Object.freeze(['Everything in Standard', 'Payroll', 'Student conduct and clinic', 'Kitchen and school stores', 'All school operation modules']),
      faith: Object.freeze(['Everything in Standard', 'Payroll', 'Organisation store and restaurant', 'Programs and all church operation modules']),
      organization: Object.freeze(['Everything in Standard', 'Payroll', 'Inventory, sales and catering', 'All organisation operation modules'])
    })
  }),
  Enterprise: Object.freeze({
    UserLimit: 250,
    Summary: 'Custom users, modules and onboarding',
    Entitlements: Object.freeze({ school: FULL_ACCESS, faith: FULL_ACCESS, organization: FULL_ACCESS }),
    Features: Object.freeze({
      school: Object.freeze(['Everything in Professional', 'Custom active-user allowance', 'Custom module policy', 'Priority onboarding and deployment support']),
      faith: Object.freeze(['Everything in Professional', 'Custom active-user allowance', 'Custom module policy', 'Priority onboarding and deployment support']),
      organization: Object.freeze(['Everything in Professional', 'Custom active-user allowance', 'Custom module policy', 'Priority onboarding and deployment support'])
    })
  })
});

export function normalizeSubscriptionPlan(value, fallback = 'Starter') {
  const wanted = clean(value).toLowerCase();
  return SUBSCRIPTION_PLAN_NAMES.find((name) => name.toLowerCase() === wanted)
    || SUBSCRIPTION_PLAN_NAMES.find((name) => name.toLowerCase() === clean(fallback).toLowerCase())
    || 'Starter';
}

export function normalizeBillingCycle(value, fallback = 'monthly') {
  const cycle = clean(value).toLowerCase();
  if (['year', 'yearly', 'annual', 'annually'].includes(cycle)) return 'yearly';
  if (['month', 'monthly'].includes(cycle)) return 'monthly';
  return clean(fallback).toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
}

export function subscriptionPlanDefinition(value) {
  return SUBSCRIPTION_PLAN_DEFINITIONS[normalizeSubscriptionPlan(value)];
}

export function subscriptionPlanEntitlements(plan, edition, catalog = null) {
  const normalizedEdition = ['faith', 'organization'].includes(clean(edition).toLowerCase())
    ? clean(edition).toLowerCase()
    : 'school';
  if (catalog && typeof catalog === 'object') {
    const normalizedCatalog = normalizeSubscriptionPlanCatalog(catalog);
    return [...normalizedCatalog.Plans[normalizeSubscriptionPlan(plan)].EntitlementsByEdition[normalizedEdition]];
  }
  const entitlements = subscriptionPlanDefinition(plan).Entitlements[normalizedEdition];
  return entitlements === FULL_ACCESS ? FULL_ACCESS : [...entitlements];
}

export function subscriptionPlanFeatures(plan, edition, catalog = null) {
  const normalizedEdition = ['faith', 'organization'].includes(clean(edition).toLowerCase())
    ? clean(edition).toLowerCase()
    : 'school';
  if (catalog && typeof catalog === 'object') {
    const enabledKeys = new Set(subscriptionPlanEntitlements(plan, normalizedEdition, catalog));
    return subscriptionModulesForEdition(normalizedEdition)
      .filter((module) => enabledKeys.has(module.Key))
      .map((module) => module.Label);
  }
  return [...subscriptionPlanDefinition(plan).Features[normalizedEdition]];
}

export function subscriptionPlanUserLimit(plan) {
  return subscriptionPlanDefinition(plan).UserLimit;
}

function timestampMilliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 100000000000 ? value * 1000 : value;
  }
  if (value && typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds)) return (seconds * 1000) + Math.floor(Number(value.nanoseconds ?? value._nanoseconds ?? 0) / 1000000);
  }
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function freeTrialWindow(startedAt = new Date()) {
  const startMs = timestampMilliseconds(startedAt);
  const safeStart = Number.isFinite(startMs) ? startMs : Date.now();
  return {
    TrialStartedAt: new Date(safeStart).toISOString(),
    TrialEndsAt: new Date(safeStart + (FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000)).toISOString()
  };
}

export function subscriptionAccessState(value = {}, options = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const plan = normalizeSubscriptionPlan(source.Plan || source.SubscriptionPlan || source.plan || 'Professional', 'Professional');
  const status = clean(source.SubscriptionStatus || source.Status || source.subscriptionStatus).toLowerCase();
  const inactiveStatus = /^(cancelled|canceled|expired|inactive|suspended|payment failed|past due|terminated|retired|revoked|deleted)$/.test(status);
  const nowMs = timestampMilliseconds(options.now ?? Date.now());
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const trialStartedMs = timestampMilliseconds(source.TrialStartedAt || source.trialStartedAt);
  const trialEndsMs = timestampMilliseconds(source.TrialEndsAt || source.trialEndsAt);
  const isTrial = plan === 'Free';
  const active = isTrial
    ? !inactiveStatus && Number.isFinite(trialEndsMs) && trialEndsMs > safeNow
    : !inactiveStatus;
  const state = isTrial
    ? active ? 'trialing' : 'trial_expired'
    : active ? 'active' : 'inactive';
  const daysRemaining = active && isTrial
    ? Math.max(1, Math.ceil((trialEndsMs - safeNow) / (24 * 60 * 60 * 1000)))
    : 0;
  return {
    Plan: plan,
    SubscriptionActive: active,
    SubscriptionState: state,
    SubscriptionStatus: isTrial ? (active ? 'Trialing' : 'Trial Expired') : (clean(source.SubscriptionStatus || source.Status) || (active ? 'Active' : 'Inactive')),
    TrialStartedAt: Number.isFinite(trialStartedMs) ? new Date(trialStartedMs).toISOString() : '',
    TrialEndsAt: Number.isFinite(trialEndsMs) ? new Date(trialEndsMs).toISOString() : '',
    TrialDaysRemaining: daysRemaining,
    SubscriptionMessage: isTrial
      ? active
        ? `Your full-access trial has ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining.`
        : 'Your 7-day full-access trial has ended. Choose a paid subscription to continue.'
      : active
        ? ''
        : 'This subscription is not active. Choose a paid subscription to continue.'
  };
}

function money(value) {
  const amount = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
}

function enabled(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  const normalized = clean(value).toLowerCase();
  if (['no', 'false', '0', 'off', 'disabled'].includes(normalized)) return false;
  if (['yes', 'true', '1', 'on', 'enabled'].includes(normalized)) return true;
  return fallback;
}

function subscriptionCurrency(value) {
  const currency = clean(value).toUpperCase();
  return SUBSCRIPTION_CURRENCIES.includes(currency) ? currency : 'NGN';
}

export function defaultSubscriptionPlanCatalog() {
  return {
    Currency: 'NGN',
    ModuleCatalogVersion: SUBSCRIPTION_MODULE_CATALOG_VERSION,
    Plans: Object.fromEntries(SUBSCRIPTION_PLAN_NAMES.map((name) => {
      const definition = SUBSCRIPTION_PLAN_DEFINITIONS[name];
      return [name, {
        Name: name,
        Summary: definition.Summary,
        UserLimit: definition.UserLimit,
        MonthlyAmount: 0,
        YearlyAmount: 0,
        Active: true,
        EntitlementsByEdition: Object.fromEntries(['school', 'faith', 'organization'].map((edition) => [
          edition,
          normalizeConfiguredEntitlements(edition, definition.Entitlements[edition], [])
        ])),
        PaystackMonthlyPlanCode: '',
        PaystackYearlyPlanCode: ''
      }];
    })),
    PolicyRevision: '',
    UpdatedAt: '',
    UpdatedBy: ''
  };
}

export function normalizeSubscriptionPlanCatalog(value = {}) {
  const defaults = defaultSubscriptionPlanCatalog();
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sourcePlans = source.Plans && typeof source.Plans === 'object' && !Array.isArray(source.Plans)
    ? source.Plans
    : {};
  const sourceModuleCatalogVersion = Math.max(0, Math.floor(Number(source.ModuleCatalogVersion) || 0));
  return {
    Currency: subscriptionCurrency(source.Currency || defaults.Currency),
    ModuleCatalogVersion: SUBSCRIPTION_MODULE_CATALOG_VERSION,
    Plans: Object.fromEntries(SUBSCRIPTION_PLAN_NAMES.map((name) => {
      const incoming = sourcePlans[name] && typeof sourcePlans[name] === 'object' ? sourcePlans[name] : {};
      const definition = SUBSCRIPTION_PLAN_DEFINITIONS[name];
      const configuredLimit = Math.max(1, Math.floor(Number(incoming.UserLimit || definition.UserLimit) || definition.UserLimit));
      const configuredEntitlements = incoming.EntitlementsByEdition && typeof incoming.EntitlementsByEdition === 'object'
        ? incoming.EntitlementsByEdition
        : incoming.ModulesByEdition && typeof incoming.ModulesByEdition === 'object'
          ? incoming.ModulesByEdition
          : {};
      return [name, {
        Name: name,
        Summary: definition.Summary,
        UserLimit: name === 'Enterprise' ? configuredLimit : definition.UserLimit,
        MonthlyAmount: name === 'Free' ? 0 : money(incoming.MonthlyAmount),
        YearlyAmount: name === 'Free' ? 0 : money(incoming.YearlyAmount),
        Active: enabled(incoming.Active, true),
        EntitlementsByEdition: Object.fromEntries(['school', 'faith', 'organization'].map((edition) => {
          const normalizedEntitlements = normalizeConfiguredEntitlements(
            edition,
            Object.prototype.hasOwnProperty.call(configuredEntitlements, edition)
              ? configuredEntitlements[edition]
              : undefined,
            defaults.Plans[name].EntitlementsByEdition[edition]
          );
          const migratedEntitlements = sourceModuleCatalogVersion < 2 && normalizedEntitlements.includes('humanResources')
            ? normalizeConfiguredEntitlements(edition, [...normalizedEntitlements, 'staffAttendance'], [])
            : normalizedEntitlements;
          return [edition, migratedEntitlements];
        })),
        PaystackMonthlyPlanCode: name === 'Free' ? '' : clean(incoming.PaystackMonthlyPlanCode),
        PaystackYearlyPlanCode: name === 'Free' ? '' : clean(incoming.PaystackYearlyPlanCode)
      }];
    })),
    PolicyRevision: clean(source.PolicyRevision),
    UpdatedAt: clean(source.UpdatedAt),
    UpdatedBy: clean(source.UpdatedBy)
  };
}

export function publicSubscriptionPlanCatalog(value = {}) {
  const catalog = normalizeSubscriptionPlanCatalog(value);
  return {
    Currency: catalog.Currency,
    ModuleCatalogVersion: catalog.ModuleCatalogVersion,
    ModuleCatalog: Object.fromEntries(['school', 'faith', 'organization'].map((edition) => [
      edition,
      subscriptionModulesForEdition(edition)
    ])),
    Plans: SUBSCRIPTION_PLAN_NAMES.map((name) => ({
      Name: name,
      Summary: catalog.Plans[name].Summary,
      UserLimit: catalog.Plans[name].UserLimit,
      MonthlyAmount: catalog.Plans[name].MonthlyAmount,
      YearlyAmount: catalog.Plans[name].YearlyAmount,
      Active: catalog.Plans[name].Active,
      TrialDays: Number(SUBSCRIPTION_PLAN_DEFINITIONS[name].TrialDays || 0),
      EntitlementsByEdition: Object.fromEntries(['school', 'faith', 'organization'].map((edition) => [
        edition,
        [...catalog.Plans[name].EntitlementsByEdition[edition]]
      ])),
      FeaturesByEdition: {
        school: subscriptionPlanFeatures(name, 'school', catalog),
        faith: subscriptionPlanFeatures(name, 'faith', catalog),
        organization: subscriptionPlanFeatures(name, 'organization', catalog)
      }
    })),
    PolicyRevision: catalog.PolicyRevision,
    UpdatedAt: catalog.UpdatedAt
  };
}

export function subscriptionPlanPrice(catalog, plan, billingCycle) {
  const normalized = normalizeSubscriptionPlanCatalog(catalog);
  const entry = normalized.Plans[normalizeSubscriptionPlan(plan)];
  return normalizeBillingCycle(billingCycle) === 'yearly' ? entry.YearlyAmount : entry.MonthlyAmount;
}

export function subscriptionPaystackPlanCode(catalog, plan, billingCycle) {
  const normalized = normalizeSubscriptionPlanCatalog(catalog);
  const entry = normalized.Plans[normalizeSubscriptionPlan(plan)];
  return normalizeBillingCycle(billingCycle) === 'yearly'
    ? entry.PaystackYearlyPlanCode
    : entry.PaystackMonthlyPlanCode;
}
