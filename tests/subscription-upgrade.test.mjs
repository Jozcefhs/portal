import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  flexConfigurationChange,
  proratedFlexUpgrade,
  subscriptionChangeDecision
} from '../functions/lib/subscription-upgrade.js';
import {
  createScheduledPaystackSubscription,
  disablePaystackSubscription
} from '../functions/api/verify-subscription-payment.js';

test('self-service subscription changes allow upgrades and billing-cycle changes only', () => {
  assert.equal(subscriptionChangeDecision('Starter', 'monthly', 'Standard', 'monthly').kind, 'upgrade');
  assert.equal(subscriptionChangeDecision('Starter', 'monthly', 'Starter', 'yearly').kind, 'billing-cycle-change');
  assert.equal(subscriptionChangeDecision('Standard', 'monthly', 'Starter', 'monthly').allowed, false);
  assert.equal(subscriptionChangeDecision('Starter', 'monthly', 'Starter', 'monthly').allowed, false);
  assert.equal(subscriptionChangeDecision('Starter', 'monthly', 'Free', 'monthly').allowed, false);
  assert.equal(subscriptionChangeDecision('Standard', 'monthly', 'Flex', 'monthly').kind, 'customize');
  assert.equal(subscriptionChangeDecision('Flex', 'monthly', 'Standard', 'monthly').kind, 'bundle-change');
  assert.equal(subscriptionChangeDecision('Flex', 'monthly', 'Flex', 'monthly', { configurationChanged: true }).kind, 'reconfigure');
  assert.equal(subscriptionChangeDecision('Flex', 'monthly', 'Flex', 'monthly').allowed, false);
});

test('Flex self-service distinguishes increases from support-only reductions', () => {
  const increase = flexConfigurationChange(
    { modules: ['branches', 'students'], userLimit: 7 },
    { modules: ['branches', 'students', 'academics'], userLimit: 10 }
  );
  assert.equal(increase.increased, true);
  assert.equal(increase.reduced, false);
  assert.deepEqual(increase.addedModules, ['academics']);
  assert.equal(increase.addedUsers, 3);

  const reduction = flexConfigurationChange(
    { modules: ['branches', 'students'], userLimit: 7 },
    { modules: ['branches'], userLimit: 6 }
  );
  assert.equal(reduction.reduced, true);
  assert.deepEqual(reduction.removedModules, ['students']);
  assert.equal(reduction.removedUsers, 1);
});

test('Flex upgrade charges only the remaining-period price difference', () => {
  const quote = proratedFlexUpgrade({
    currentAmount: 100000,
    targetAmount: 160000,
    periodStartAt: '2026-08-01T00:00:00.000Z',
    paidThroughAt: '2026-08-31T00:00:00.000Z',
    now: Date.parse('2026-08-16T00:00:00.000Z')
  });
  assert.equal(quote.ChargeAmount, 30000);
  assert.equal(quote.FullCycleAmount, 160000);
  assert.equal(quote.RemainingFraction, 0.5);
  assert.equal(quote.RemainingDays, 15);
  assert.throws(() => proratedFlexUpgrade({
    currentAmount: 100000,
    targetAmount: 90000,
    periodStartAt: '2026-08-01T00:00:00.000Z',
    paidThroughAt: '2026-08-31T00:00:00.000Z',
    now: Date.parse('2026-08-16T00:00:00.000Z')
  }), /higher full-cycle price/i);
});

test('a successful upgrade disables the previous Paystack recurring subscription', async () => {
  const calls = [];
  const result = await disablePaystackSubscription({ PAYSTACK_SECRET_KEY: 'sk_test_example' }, 'SUB_old', async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/SUB_old')) return Response.json({ status: true, data: { email_token: 'token_old' } });
    return Response.json({ status: true, message: 'Subscription disabled' });
  });
  assert.equal(result.disabled, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /subscription\/SUB_old$/);
  assert.match(calls[1].url, /subscription\/disable$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { code: 'SUB_old', token: 'token_old' });
});

test('a prorated card payment schedules the full Flex renewal on the existing renewal date', async () => {
  let request = null;
  const result = await createScheduledPaystackSubscription({ PAYSTACK_SECRET_KEY: 'sk_test_example' }, {
    customerCode: 'CUS_example',
    planCode: 'PLN_new_flex',
    authorizationCode: 'AUTH_reusable',
    startDate: '2026-09-01T00:00:00.000Z'
  }, async (url, options) => {
    request = { url: String(url), options };
    return Response.json({ status: true, data: { subscription_code: 'SUB_new', email_token: 'token_new' } });
  });
  assert.match(request.url, /\/subscription$/);
  assert.deepEqual(JSON.parse(request.options.body), {
    customer: 'CUS_example',
    plan: 'PLN_new_flex',
    authorization: 'AUTH_reusable',
    start_date: '2026-09-01T00:00:00.000Z'
  });
  assert.equal(result.subscriptionCode, 'SUB_new');
  assert.equal(result.startDate, '2026-09-01T00:00:00.000Z');
});

test('Flex proration is enforced by checkout, payment initialization and activation', async () => {
  const [checkout, registration, verification, webhook, policy, methods] = await Promise.all([
    readFile(new URL('../functions/api/subscription-checkout.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/register-organization.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/verify-subscription-payment.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/paystack-subscription-webhook.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/subscription-policy.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/payment-methods.js', import.meta.url), 'utf8')
  ]);
  assert.match(checkout, /if \(flexChange\?\.reduced\)/);
  assert.match(checkout, /paymentAdjustment = proratedFlexUpgrade/);
  assert.match(registration, /adjustment \? \{ channels: \['card'\] \} : \{ plan: planCode \}/);
  assert.match(registration, /Prorated Flex upgrades must be paid online by card/);
  assert.match(verification, /PreservePaidThroughAt/);
  assert.match(verification, /createScheduledPaystackSubscription/);
  assert.match(verification, /start_date:/);
  assert.match(webhook, /row\.PendingPaystackPlanCode/);
  assert.match(webhook, /normalizedEvent === 'invoice\.update'/);
  assert.doesNotMatch(webhook, /\['subscription\.create', 'invoice\.update'\]\.includes\(normalizedEvent\)/);
  assert.match(policy, /LastSuccessfulPaymentAt/);
  assert.match(methods, /options\.allowDirectTransfer !== false/);
});

test('staff account exposes a Super Admin subscription upgrade interface', async () => {
  const [html, client, middleware] = await Promise.all([
    readFile(new URL('../admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="staffSubscriptionButton"/);
  assert.match(html, /id="staffSubscriptionDialog"/);
  assert.match(html, /id="staffProfileSubscriptionOpen"/);
  assert.match(html, /Manage subscription \/ Upgrade plan/);
  assert.match(client, /user\.role !== 'Super Admin'/);
  assert.match(client, /\/api\/staff-subscription/);
  assert.match(client, /data-staff-flex-module/);
  assert.match(client, /flexModules: flexQuote \? flexQuote\.selectedModules/);
  assert.match(client, /prorated due now/);
  assert.match(client, /Contact support to reduce Flex/);
  assert.match(client, /allowDirectTransfer: !flexQuote\?\.prorated/);
  assert.match(middleware, /'\/api\/subscription-checkout'/);
  assert.match(middleware, /'\/api\/staff-subscription'/);
});
