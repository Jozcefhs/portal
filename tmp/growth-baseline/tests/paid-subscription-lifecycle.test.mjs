import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PAID_DATA_RETENTION_DAYS,
  PAID_SUBSCRIPTION_GRACE_DAYS,
  paidLifecycleWindow,
  paidSubscriptionPeriodEnd,
  paidSubscriptionRecoveryFields
} from '../functions/lib/paid-subscription-lifecycle.js';
import { subscriptionAccessState } from '../functions/lib/subscription-plans.js';
import { subscriptionChangeDecision } from '../functions/lib/subscription-upgrade.js';

const middlewareSource = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const webhookSource = await readFile(new URL('../functions/api/paystack-subscription-webhook.js', import.meta.url), 'utf8');
const verificationSource = await readFile(new URL('../functions/api/verify-subscription-payment.js', import.meta.url), 'utf8');
const lifecycleSource = await readFile(new URL('../functions/lib/tenant-trial-lifecycle.js', import.meta.url), 'utf8');
const workflowSource = await readFile(new URL('../.github/workflows/retire-expired-trials.yml', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');

test('paid billing periods use calendar months and years without date overflow', () => {
  assert.equal(paidSubscriptionPeriodEnd({
    paidAt: '2026-01-31T10:15:00.000Z', billingCycle: 'monthly'
  }), '2026-02-28T10:15:00.000Z');
  assert.equal(paidSubscriptionPeriodEnd({
    paidAt: '2024-02-29T10:15:00.000Z', billingCycle: 'yearly'
  }), '2025-02-28T10:15:00.000Z');
  assert.equal(paidSubscriptionPeriodEnd({
    paidAt: '2026-01-01T00:00:00.000Z',
    billingCycle: 'monthly',
    providerPaidThroughAt: '2026-03-01T00:00:00.000Z'
  }), '2026-03-01T00:00:00.000Z');
});

test('paid subscriptions move through active, read-only grace, suspension and retirement', () => {
  const registration = { Plan: 'Starter', PaidThroughAt: '2026-01-31T00:00:00.000Z' };
  assert.equal(PAID_SUBSCRIPTION_GRACE_DAYS, 7);
  assert.equal(PAID_DATA_RETENTION_DAYS, 90);
  assert.equal(paidLifecycleWindow(registration, '2026-01-30T00:00:00.000Z').stage, 'active');
  const grace = paidLifecycleWindow(registration, '2026-02-02T00:00:00.000Z');
  assert.equal(grace.stage, 'payment_grace');
  assert.equal(grace.graceEndsAt, '2026-02-07T00:00:00.000Z');
  const suspended = paidLifecycleWindow(registration, '2026-02-08T00:00:00.000Z');
  assert.equal(suspended.stage, 'suspended');
  assert.equal(suspended.retentionEndsAt, '2026-05-08T00:00:00.000Z');
  assert.equal(paidLifecycleWindow(registration, '2026-05-08T00:00:00.000Z').stage, 'retirement_due');
});

test('existing paid records derive their first renewal boundary from the saved payment date', () => {
  const lifecycle = paidLifecycleWindow({
    Plan: 'Starter',
    BillingCycle: 'monthly',
    PaidAt: '2026-01-31T10:15:00.000Z'
  }, '2026-02-27T00:00:00.000Z');
  assert.equal(lifecycle.applicable, true);
  assert.equal(lifecycle.stage, 'active');
  assert.equal(lifecycle.paidThroughAt, '2026-02-28T10:15:00.000Z');
});

test('payment grace is readable but server writes require renewal', () => {
  const grace = subscriptionAccessState({
    Plan: 'Standard',
    SubscriptionStatus: 'Payment Grace',
    PaidThroughAt: '2026-01-31T00:00:00.000Z'
  }, { now: '2026-02-02T00:00:00.000Z' });
  assert.equal(grace.SubscriptionActive, true);
  assert.equal(grace.SubscriptionReadOnly, true);
  assert.equal(grace.SubscriptionState, 'payment_grace');
  assert.match(grace.SubscriptionMessage, /read-only/i);

  const suspended = subscriptionAccessState({
    Plan: 'Standard',
    SubscriptionStatus: 'Suspended',
    PaidThroughAt: '2026-01-31T00:00:00.000Z'
  }, { now: '2026-02-08T00:00:00.000Z' });
  assert.equal(suspended.SubscriptionActive, false);
  assert.equal(suspended.SubscriptionReadOnly, false);
  assert.equal(suspended.SubscriptionState, 'suspended');
  assert.match(middlewareSource, /SUBSCRIPTION_READ_ONLY/);
  assert.match(middlewareSource, /READ_ONLY_POST_ACTIONS/);
  assert.match(middlewareSource, /subscriptionReadOnlyRequestAllowed/);
});

test('confirmed payment restores access and clears every stale retirement boundary', () => {
  const fields = paidSubscriptionRecoveryFields({
    paidAt: '2026-02-04T09:00:00.000Z', billingCycle: 'monthly'
  });
  assert.equal(fields.SubscriptionStatus, 'Active');
  assert.equal(fields.PaidThroughAt, '2026-03-04T09:00:00.000Z');
  assert.equal(fields.GracePeriodEndsAt, '');
  assert.equal(fields.DataRetentionEndsAt, '');
  assert.equal(fields.RetirementRequestReference, '');
  assert.match(verificationSource, /paidSubscriptionRecoveryFields/);
  assert.match(webhookSource, /paidSubscriptionRecoveryFields/);
});

test('an overdue subscriber can renew the same plan and billing cycle', () => {
  assert.equal(subscriptionChangeDecision('Starter', 'monthly', 'Starter', 'monthly').allowed, false);
  const renewal = subscriptionChangeDecision('Starter', 'monthly', 'Starter', 'monthly', { allowRenewal: true });
  assert.equal(renewal.allowed, true);
  assert.equal(renewal.kind, 'renewal');
  assert.match(adminSource, /Renew \$\{plan\.Name\}/);
});

test('the daily lifecycle covers reminders, paid retention and secure retirement', () => {
  assert.match(lifecycleSource, /paid-renewal-7-day/);
  assert.match(lifecycleSource, /paid-renewal-3-day/);
  assert.match(lifecycleSource, /paid-renewal-1-day/);
  assert.match(lifecycleSource, /paid-deletion-30-day/);
  assert.match(lifecycleSource, /processTenantSubscriptionLifecycle/);
  assert.match(workflowSource, /Manage expired Dynamax subscriptions/);
  assert.match(workflowSource, /cron: '23 2 \* \* \*'/);
});
