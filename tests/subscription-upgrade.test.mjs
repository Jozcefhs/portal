import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { subscriptionChangeDecision } from '../functions/lib/subscription-upgrade.js';
import { disablePaystackSubscription } from '../functions/api/verify-subscription-payment.js';

test('self-service subscription changes allow upgrades and billing-cycle changes only', () => {
  assert.equal(subscriptionChangeDecision('Starter', 'monthly', 'Standard', 'monthly').kind, 'upgrade');
  assert.equal(subscriptionChangeDecision('Starter', 'monthly', 'Starter', 'yearly').kind, 'billing-cycle-change');
  assert.equal(subscriptionChangeDecision('Standard', 'monthly', 'Starter', 'monthly').allowed, false);
  assert.equal(subscriptionChangeDecision('Starter', 'monthly', 'Starter', 'monthly').allowed, false);
  assert.equal(subscriptionChangeDecision('Starter', 'monthly', 'Free', 'monthly').allowed, false);
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
  assert.match(middleware, /'\/api\/subscription-checkout'/);
  assert.match(middleware, /'\/api\/staff-subscription'/);
});
