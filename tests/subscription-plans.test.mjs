import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { paystackPlanNeedsSync, paystackPlanPayload } from '../functions/api/plan-catalog.js';
import { validPaystackWebhookSignature } from '../functions/api/paystack-subscription-webhook.js';
import { syncRegistrationSubscriptionToWorkspace } from '../functions/lib/subscription-workspace-sync.js';
import {
  normalizeBillingCycle,
  normalizeSubscriptionPlanCatalog,
  publicSubscriptionPlanCatalog,
  subscriptionModulesForEdition,
  subscriptionAccessState,
  subscriptionPaystackPlanCode,
  subscriptionPlanEntitlements,
  subscriptionPlanPrice
} from '../functions/lib/subscription-plans.js';

test('plan catalogue normalizes pricing, billing cycles and enterprise custom seats', () => {
  const catalog = normalizeSubscriptionPlanCatalog({
    Currency: 'ngn',
    Plans: {
      Standard: { MonthlyAmount: '15,000', YearlyAmount: '150,000', UserLimit: 999 },
      Enterprise: { MonthlyAmount: 250000, UserLimit: 700 }
    }
  });
  assert.equal(catalog.Currency, 'NGN');
  assert.equal(catalog.Plans.Free.MonthlyAmount, 0);
  assert.equal(catalog.Plans.Free.YearlyAmount, 0);
  assert.equal(catalog.Plans.Standard.MonthlyAmount, 15000);
  assert.equal(catalog.Plans.Standard.YearlyAmount, 150000);
  assert.equal(catalog.Plans.Standard.UserLimit, 20);
  assert.equal(catalog.Plans.Enterprise.UserLimit, 700);
  assert.equal(normalizeBillingCycle('annual'), 'yearly');
  assert.equal(normalizeSubscriptionPlanCatalog({ Currency: 'usd' }).Currency, 'USD');
  assert.equal(normalizeSubscriptionPlanCatalog({ Currency: 'eur' }).Currency, 'NGN');
});

test('public plan catalogue never exposes Paystack plan codes', () => {
  const internal = normalizeSubscriptionPlanCatalog({
    Plans: { Starter: { PaystackMonthlyPlanCode: 'PLN_secret', MonthlyAmount: 1000 } }
  });
  const publicCatalog = publicSubscriptionPlanCatalog(internal);
  const starter = publicCatalog.Plans.find((plan) => plan.Name === 'Starter');
  const free = publicCatalog.Plans.find((plan) => plan.Name === 'Free');
  assert.equal(starter.MonthlyAmount, 1000);
  assert.equal('PaystackMonthlyPlanCode' in starter, false);
  assert.equal(free.TrialDays, 7);
  assert.ok(free.FeaturesByEdition.faith.includes('Payroll'));
  assert.ok(publicCatalog.ModuleCatalog.faith.some((module) => module.Key === 'offerings'));
});

test('saved plan-module selections replace defaults and enforce dependencies', () => {
  const catalog = normalizeSubscriptionPlanCatalog({
    Plans: {
      Starter: {
        EntitlementsByEdition: {
          school: ['payroll'],
          faith: [],
          organization: ['departments']
        }
      }
    }
  });
  assert.deepEqual(
    catalog.Plans.Starter.EntitlementsByEdition.school,
    ['humanResources', 'staffAttendance', 'accounting', 'payroll']
  );
  assert.deepEqual(catalog.Plans.Starter.EntitlementsByEdition.faith, []);
  assert.deepEqual(
    catalog.Plans.Starter.EntitlementsByEdition.organization,
    ['members', 'departments']
  );
  assert.deepEqual(
    subscriptionPlanEntitlements('Starter', 'school', catalog),
    ['humanResources', 'staffAttendance', 'accounting', 'payroll']
  );
  assert.ok(subscriptionModulesForEdition('school').every((module) => !/church|offering/i.test(module.Label)));
  assert.ok(subscriptionModulesForEdition('faith').some((module) => module.Key === 'staffAttendance' && module.Label === 'Staff attendance & clocking'));
  assert.ok(subscriptionModulesForEdition('faith').some((module) => module.Key === 'humanResources' && module.Label === 'Human Resources'));

  const explicitlySeparated = normalizeSubscriptionPlanCatalog({
    ModuleCatalogVersion: 2,
    Plans: { Starter: { EntitlementsByEdition: { faith: ['humanResources'] } } }
  });
  assert.deepEqual(explicitlySeparated.Plans.Starter.EntitlementsByEdition.faith, ['humanResources']);
});

test('free access expires at the stored server-issued boundary and cannot become permanent', () => {
  const active = subscriptionAccessState({
    Plan: 'Free',
    SubscriptionStatus: 'Trialing',
    TrialStartedAt: '2099-01-01T00:00:00.000Z',
    TrialEndsAt: '2099-01-08T00:00:00.000Z'
  }, { now: '2099-01-04T00:00:00.000Z' });
  assert.equal(active.SubscriptionActive, true);
  assert.equal(active.SubscriptionState, 'trialing');
  assert.equal(active.TrialDaysRemaining, 4);

  const expired = subscriptionAccessState({
    Plan: 'Free',
    SubscriptionStatus: 'Trialing',
    TrialStartedAt: '2099-01-01T00:00:00.000Z',
    TrialEndsAt: '2099-01-08T00:00:00.000Z'
  }, { now: '2099-01-08T00:00:00.000Z' });
  assert.equal(expired.SubscriptionActive, false);
  assert.equal(expired.SubscriptionState, 'trial_expired');
  assert.match(expired.SubscriptionMessage, /paid subscription/i);
  assert.equal(subscriptionAccessState({ Plan: 'Free' }).SubscriptionActive, false);
  assert.equal(subscriptionAccessState({ Plan: 'Starter' }).SubscriptionActive, true);
  assert.equal(subscriptionAccessState({ Plan: 'Starter', SubscriptionStatus: 'Retired' }).SubscriptionActive, false);
  assert.equal(subscriptionAccessState({ Plan: 'Professional', SubscriptionStatus: 'Revoked' }).SubscriptionActive, false);
});

test('subscription activation cannot target a workspace without a server-bound workspace id', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('An unbound registration must not access a tenant profile.');
  };
  try {
    assert.equal(await syncRegistrationSubscriptionToWorkspace({}, {
      OrganisationName: 'Forged Organisation',
      Plan: 'Enterprise',
      SubscriptionStatus: 'Active'
    }), false);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pricing and Paystack codes resolve for the selected billing cycle', () => {
  const catalog = normalizeSubscriptionPlanCatalog({
    Plans: {
      Professional: {
        MonthlyAmount: 25000,
        YearlyAmount: 250000,
        PaystackMonthlyPlanCode: 'PLN_month',
        PaystackYearlyPlanCode: 'PLN_year'
      }
    }
  });
  assert.equal(subscriptionPlanPrice(catalog, 'Professional', 'monthly'), 25000);
  assert.equal(subscriptionPlanPrice(catalog, 'Professional', 'yearly'), 250000);
  assert.equal(subscriptionPaystackPlanCode(catalog, 'Professional', 'annual'), 'PLN_year');
  assert.equal(subscriptionPlanEntitlements('Professional', 'faith'), '*');
});

test('Paystack recurring plan payload uses subunits and supported intervals', () => {
  assert.deepEqual(paystackPlanPayload('Standard', 'monthly', 12500, 'NGN'), {
    name: 'Dynamax Standard - Monthly',
    amount: 1250000,
    interval: 'monthly',
    currency: 'NGN',
    description: 'Standard subscription billed monthly',
    send_invoices: true,
    send_sms: false,
    update_existing_subscriptions: false
  });
  assert.equal(paystackPlanPayload('Standard', 'yearly', 120000, 'NGN').interval, 'annually');
});

test('module-only plan saves do not call Paystack price synchronization', () => {
  const existing = {
    MonthlyAmount: 60000,
    YearlyAmount: 600000,
    PaystackMonthlyPlanCode: 'PLN_monthly',
    PaystackYearlyPlanCode: 'PLN_yearly'
  };
  const moduleOnlyUpdate = { ...existing };
  assert.equal(paystackPlanNeedsSync(existing, moduleOnlyUpdate, 'monthly'), false);
  assert.equal(paystackPlanNeedsSync(existing, moduleOnlyUpdate, 'yearly'), false);
  assert.equal(paystackPlanNeedsSync(existing, { ...moduleOnlyUpdate, MonthlyAmount: 65000 }, 'monthly'), true);
  assert.equal(paystackPlanNeedsSync(existing, moduleOnlyUpdate, 'monthly', true), true);
  assert.equal(paystackPlanNeedsSync(existing, { ...moduleOnlyUpdate, PaystackMonthlyPlanCode: '' }, 'monthly'), true);
});

test('Paystack webhook signatures are checked with HMAC SHA-512', async () => {
  const secret = 'test-secret';
  const bytes = new TextEncoder().encode('{"event":"subscription.create"}');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  assert.equal(await validPaystackWebhookSignature(secret, bytes, signature), true);
  assert.equal(await validPaystackWebhookSignature(secret, bytes, 'bad'), false);
});

test('registration and pricing interfaces expose feature details and recurring checkout', async () => {
  const [registrationHtml, registrationJs, pricingHtml, pricingJs, setupHtml, registrationApi, pricingApi, verificationApi, webhookApi] = await Promise.all([
    readFile(new URL('../register-organization.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/register-organization.js', import.meta.url), 'utf8'),
    readFile(new URL('../plan-management.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/plan-management.js', import.meta.url), 'utf8'),
    readFile(new URL('../setup.html', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/register-organization.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/plan-catalog.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/verify-subscription-payment.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/paystack-subscription-webhook.js', import.meta.url), 'utf8')
  ]);
  assert.match(registrationHtml, /name="BillingCycle" value="monthly"/);
  assert.match(registrationHtml, /name="BillingCycle" value="yearly"/);
  assert.match(registrationHtml, /<summary>Open all plan feature chapters<\/summary>/);
  assert.match(registrationJs, /planComparisonGrid\.innerHTML = plans\.map/);
  assert.doesNotMatch(registrationJs, /<summary>View features<\/summary>/);
  assert.match(registrationJs, /\/api\/pricing-book-pdf/);
  assert.match(registrationJs, /anchor\.download = `Dynamax_Pricing_Book_/);
  assert.doesNotMatch(registrationJs, /window\.open\('', '_blank'/);
  assert.match(registrationJs, /window\.location\.assign\(data\.authorizationUrl\)/);
  assert.match(registrationJs, /data\.activationUrl \|\| data\.loginUrl \|\| data\.onboardingUrl/);
  assert.match(pricingHtml, /Monthly and yearly pricing/);
  assert.match(pricingHtml, /id="planEntitlementMatrix"/);
  assert.match(pricingHtml, /<select id="planPricingCurrency"><option value="NGN">NGN<\/option><option value="USD">USD<\/option><\/select>/);
  assert.match(pricingHtml, /plan-management\.js\?v=20260809-platform-direct-transfer/);
  assert.match(pricingHtml, /id="tenantPoolSummary"/);
  assert.match(pricingHtml, /Other organisation/);
  assert.match(pricingHtml, /Save plans &amp; pricing/);
  assert.match(pricingHtml, /Apply changed prices to existing Paystack subscribers/);
  assert.match(pricingJs, /aria-label="\$\{accessibleLabel\}"/);
  assert.match(pricingJs, /data-price-currency/);
  assert.match(pricingJs, /<span>Monthly price \(<span data-price-currency>\$\{currency\}<\/span>\)<\/span>/);
  assert.match(pricingJs, /<span>Yearly price \(<span data-price-currency>\$\{currency\}<\/span>\)<\/span>/);
  assert.match(pricingJs, /existing subscribers remain on their current Paystack plans/);
  assert.doesNotMatch(pricingJs, /class="sr-only"/);
  assert.doesNotMatch(setupHtml, /href="plan-management\.html"/);
  assert.match(setupHtml, /<option>Free<\/option>/);
  assert.match(registrationApi, /plan: planCode/);
  assert.match(registrationApi, /PAYSTACK_SECRET_KEY/);
  assert.match(registrationApi, /freeTrialWindow/);
  assert.match(registrationApi, /already used its 7-day free trial/);
  assert.match(registrationApi, /authenticatedWorkspaceBinding/);
  assert.match(registrationApi, /requireStaffSession/);
  assert.match(registrationApi, /Pending Trial Activation/);
  assert.match(registrationApi, /requirePlatformFirestoreEnv/);
  assert.match(registrationApi, /reserveTenantProjectSlot/);
  assert.match(registrationApi, /7-day clock will begin when your workspace is activated/);
  assert.match(pricingApi, /update_existing_subscriptions/);
  assert.match(pricingApi, /requirePlatformAdmin/);
  assert.match(pricingApi, /requirePlatformFirestoreEnv/);
  assert.match(verificationApi, /requirePlatformFirestoreEnv/);
  assert.match(webhookApi, /requirePlatformFirestoreEnv/);
  assert.match(verificationApi, /syncRegistrationSubscriptionToWorkspace/);
  assert.match(webhookApi, /syncRegistrationSubscriptionToWorkspace/);
});
