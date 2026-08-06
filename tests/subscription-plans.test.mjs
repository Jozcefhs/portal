import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { paystackPlanPayload } from '../functions/api/plan-catalog.js';
import { validPaystackWebhookSignature } from '../functions/api/paystack-subscription-webhook.js';
import {
  normalizeBillingCycle,
  normalizeSubscriptionPlanCatalog,
  publicSubscriptionPlanCatalog,
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
  assert.equal(catalog.Plans.Standard.MonthlyAmount, 15000);
  assert.equal(catalog.Plans.Standard.YearlyAmount, 150000);
  assert.equal(catalog.Plans.Standard.UserLimit, 20);
  assert.equal(catalog.Plans.Enterprise.UserLimit, 700);
  assert.equal(normalizeBillingCycle('annual'), 'yearly');
});

test('public plan catalogue never exposes Paystack plan codes', () => {
  const internal = normalizeSubscriptionPlanCatalog({
    Plans: { Starter: { PaystackMonthlyPlanCode: 'PLN_secret', MonthlyAmount: 1000 } }
  });
  const publicCatalog = publicSubscriptionPlanCatalog(internal);
  assert.equal(publicCatalog.Plans[0].MonthlyAmount, 1000);
  assert.equal('PaystackMonthlyPlanCode' in publicCatalog.Plans[0], false);
  assert.ok(publicCatalog.Plans[0].FeaturesByEdition.faith.includes('Member records'));
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
  const [registrationHtml, registrationJs, pricingHtml, setupHtml, registrationApi, pricingApi] = await Promise.all([
    readFile(new URL('../register-organization.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/register-organization.js', import.meta.url), 'utf8'),
    readFile(new URL('../plan-management.html', import.meta.url), 'utf8'),
    readFile(new URL('../setup.html', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/register-organization.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/plan-catalog.js', import.meta.url), 'utf8')
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
  assert.match(pricingHtml, /Monthly and yearly pricing/);
  assert.match(pricingHtml, /Apply changed prices to existing Paystack subscribers/);
  assert.match(setupHtml, /href="plan-management\.html"/);
  assert.match(registrationApi, /plan: planCode/);
  assert.match(registrationApi, /PAYSTACK_SECRET_KEY/);
  assert.match(pricingApi, /update_existing_subscriptions/);
  assert.match(pricingApi, /ADMIN_WEB_PASSWORD/);
});
