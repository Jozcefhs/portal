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
  const inactiveStatus = /^(cancelled|canceled|expired|inactive|suspended|payment failed|past due|terminated)$/.test(status);
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
        MonthlyAmount: name === 'Free' ? 0 : money(incoming.MonthlyAmount),
        YearlyAmount: name === 'Free' ? 0 : money(incoming.YearlyAmount),
        Active: enabled(incoming.Active, true),
        PaystackMonthlyPlanCode: name === 'Free' ? '' : clean(incoming.PaystackMonthlyPlanCode),
        PaystackYearlyPlanCode: name === 'Free' ? '' : clean(incoming.PaystackYearlyPlanCode)
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
      TrialDays: Number(SUBSCRIPTION_PLAN_DEFINITIONS[name].TrialDays || 0),
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
