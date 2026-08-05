const clean = (value) => String(value ?? '').trim();

export const SUBSCRIPTION_PLAN_NAMES = Object.freeze([
  'Starter',
  'Standard',
  'Professional',
  'Enterprise'
]);

const FULL_ACCESS = '*';

export const SUBSCRIPTION_PLAN_DEFINITIONS = Object.freeze({
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
      organization: Object.freeze(['People records', 'Departments', 'Records Desk', 'Branches and branding'])
    })
  }),
  Standard: Object.freeze({
    UserLimit: 20,
    Summary: 'Finance, people and approval workflows',
    Entitlements: Object.freeze({
      school: Object.freeze([
        'branches', 'branding', 'admissions', 'students', 'parentPortal',
        'approvals', 'executiveOffice', 'humanResources', 'accounting'
      ]),
      faith: Object.freeze([
        'branches', 'branding', 'members', 'services', 'departments', 'programs',
        'approvals', 'executiveOffice', 'humanResources', 'accounting', 'funds', 'offerings', 'donations'
      ]),
      organization: Object.freeze([
        'branches', 'branding', 'members', 'departments', 'programs',
        'approvals', 'executiveOffice', 'humanResources', 'accounting'
      ])
    }),
    Features: Object.freeze({
      school: Object.freeze(['Everything in Starter', 'Finance and income analytics', 'Bills, requisitions and approvals', 'Human Resources', 'Executive Office']),
      faith: Object.freeze(['Everything in Starter', 'Funds, offerings and donations', 'Finance and income analytics', 'Bills, requisitions and approvals', 'Human Resources and Executive Office']),
      organization: Object.freeze(['Everything in Starter', 'Finance and income analytics', 'Bills, requisitions and approvals', 'Human Resources', 'Programs and Executive Office'])
    })
  }),
  Professional: Object.freeze({
    UserLimit: 50,
    Summary: 'Full operations for a growing organisation',
    Entitlements: Object.freeze({ school: FULL_ACCESS, faith: FULL_ACCESS, organization: FULL_ACCESS }),
    Features: Object.freeze({
      school: Object.freeze(['Everything in Standard', 'Payroll', 'Student conduct and clinic', 'Kitchen and school stores', 'All school operation modules']),
      faith: Object.freeze(['Everything in Standard', 'Payroll', 'Organisation store and restaurant', 'Programs and all church operation modules']),
      organization: Object.freeze(['Everything in Standard', 'Payroll', 'Organisation store and restaurant', 'All organisation operation modules'])
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

export function subscriptionPlanEntitlements(plan, edition) {
  const normalizedEdition = ['faith', 'organization'].includes(clean(edition).toLowerCase())
    ? clean(edition).toLowerCase()
    : 'school';
  const entitlements = subscriptionPlanDefinition(plan).Entitlements[normalizedEdition];
  return entitlements === FULL_ACCESS ? FULL_ACCESS : [...entitlements];
}

export function subscriptionPlanFeatures(plan, edition) {
  const normalizedEdition = ['faith', 'organization'].includes(clean(edition).toLowerCase())
    ? clean(edition).toLowerCase()
    : 'school';
  return [...subscriptionPlanDefinition(plan).Features[normalizedEdition]];
}

export function subscriptionPlanUserLimit(plan) {
  return subscriptionPlanDefinition(plan).UserLimit;
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

export function defaultSubscriptionPlanCatalog() {
  return {
    Currency: 'NGN',
    Plans: Object.fromEntries(SUBSCRIPTION_PLAN_NAMES.map((name) => {
      const definition = SUBSCRIPTION_PLAN_DEFINITIONS[name];
      return [name, {
        Name: name,
        Summary: definition.Summary,
        UserLimit: definition.UserLimit,
        MonthlyAmount: 0,
        YearlyAmount: 0,
        Active: true,
        PaystackMonthlyPlanCode: '',
        PaystackYearlyPlanCode: ''
      }];
    })),
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
  return {
    Currency: clean(source.Currency || defaults.Currency).toUpperCase() || 'NGN',
    Plans: Object.fromEntries(SUBSCRIPTION_PLAN_NAMES.map((name) => {
      const incoming = sourcePlans[name] && typeof sourcePlans[name] === 'object' ? sourcePlans[name] : {};
      const definition = SUBSCRIPTION_PLAN_DEFINITIONS[name];
      const configuredLimit = Math.max(1, Math.floor(Number(incoming.UserLimit || definition.UserLimit) || definition.UserLimit));
      return [name, {
        Name: name,
        Summary: definition.Summary,
        UserLimit: name === 'Enterprise' ? configuredLimit : definition.UserLimit,
        MonthlyAmount: money(incoming.MonthlyAmount),
        YearlyAmount: money(incoming.YearlyAmount),
        Active: enabled(incoming.Active, true),
        PaystackMonthlyPlanCode: clean(incoming.PaystackMonthlyPlanCode),
        PaystackYearlyPlanCode: clean(incoming.PaystackYearlyPlanCode)
      }];
    })),
    UpdatedAt: clean(source.UpdatedAt),
    UpdatedBy: clean(source.UpdatedBy)
  };
}

export function publicSubscriptionPlanCatalog(value = {}) {
  const catalog = normalizeSubscriptionPlanCatalog(value);
  return {
    Currency: catalog.Currency,
    Plans: SUBSCRIPTION_PLAN_NAMES.map((name) => ({
      Name: name,
      Summary: catalog.Plans[name].Summary,
      UserLimit: catalog.Plans[name].UserLimit,
      MonthlyAmount: catalog.Plans[name].MonthlyAmount,
      YearlyAmount: catalog.Plans[name].YearlyAmount,
      Active: catalog.Plans[name].Active,
      FeaturesByEdition: {
        school: subscriptionPlanFeatures(name, 'school'),
        faith: subscriptionPlanFeatures(name, 'faith'),
        organization: subscriptionPlanFeatures(name, 'organization')
      }
    })),
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
