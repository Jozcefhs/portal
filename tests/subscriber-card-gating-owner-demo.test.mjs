import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { paystackCardVerificationAmount } from '../functions/api/register-organization.js';
import {
  requestPaystackCardVerificationRefund,
  verifiedPaystackCardFields
} from '../functions/api/verify-subscription-payment.js';
import { tenantProjectAssignmentEligibility } from '../functions/lib/tenant-project-pool.js';
import { subscriptionAccessState } from '../functions/lib/subscription-plans.js';

const registrationSource = await readFile(new URL('../functions/api/register-organization.js', import.meta.url), 'utf8');
const verificationSource = await readFile(new URL('../functions/api/verify-subscription-payment.js', import.meta.url), 'utf8');
const poolApiSource = await readFile(new URL('../functions/api/tenant-project-pool.js', import.meta.url), 'utf8');
const poolUiSource = await readFile(new URL('../plan-management.html', import.meta.url), 'utf8');
const poolClientSource = await readFile(new URL('../js/plan-management.js', import.meta.url), 'utf8');

test('tenant projects require verified-card evidence except for the explicit owner demo', () => {
  assert.equal(tenantProjectAssignmentEligibility({ PaymentStatus: 'Paid' }).eligible, false);
  assert.equal(tenantProjectAssignmentEligibility({
    CardVerificationStatus: 'Verified',
    CardVerifiedAt: '2026-09-23T10:00:00.000Z'
  }).eligible, true);
  assert.equal(tenantProjectAssignmentEligibility({ OwnerDemo: true, PaymentStatus: 'Owner Authorized' }).eligible, false);
  assert.equal(tenantProjectAssignmentEligibility({
    OwnerDemo: true,
    NonBillable: true,
    CardVerificationExempt: true,
    PaymentStatus: 'Owner Authorized'
  }).eligible, true);
});

test('free trial uses the supported minimum verification amount and Paystack card-only checkout', () => {
  assert.equal(paystackCardVerificationAmount('NGN'), 50);
  assert.equal(paystackCardVerificationAmount('USD'), 2);
  assert.equal(paystackCardVerificationAmount('NGN', '75.5'), 75.5);
  assert.match(registrationSource, /paymentType: 'dynamaxCardVerification'/);
  assert.match(registrationSource, /channels: \['card'\]/);
  assert.match(registrationSource, /RefundRequired: true/);
  assert.match(registrationSource, /Pending Card Verification/);
  assert.doesNotMatch(registrationSource, /plan === 'Free'\s*\? await reserveTenantProjectSlot/);
});

test('only a verified Paystack card transaction creates reusable allocation evidence', () => {
  assert.throws(() => verifiedPaystackCardFields({
    channel: 'bank',
    authorization: { authorization_code: 'AUTH_bank' }
  }), /bank-card transaction/i);
  const fields = verifiedPaystackCardFields({
    channel: 'card',
    authorization: {
      authorization_code: 'AUTH_card',
      signature: 'SIG_masked',
      brand: 'visa',
      last4: '4081',
      exp_month: '12',
      exp_year: '2030',
      reusable: true
    }
  }, '2026-09-23T10:00:00.000Z');
  assert.equal(fields.CardVerificationStatus, 'Verified');
  assert.equal(fields.CardVerificationLast4, '4081');
  assert.equal(fields.CardVerificationReusable, true);
  assert.equal('authorization_code' in fields, false);
});

test('verification charge is refunded through the server-side Paystack refund endpoint', async () => {
  let request = null;
  const result = await requestPaystackCardVerificationRefund(
    { PAYSTACK_SECRET_KEY: 'sk_test_example' },
    'DMX-CARD-1',
    50,
    'NGN',
    async (url, options) => {
      request = { url: String(url), options };
      return Response.json({ status: true, data: { id: 77, status: 'pending' } });
    }
  );
  assert.equal(request.url, 'https://api.paystack.co/refund');
  assert.deepEqual(JSON.parse(request.options.body), {
    transaction: 'DMX-CARD-1', amount: 5000, currency: 'NGN'
  });
  assert.equal(result.status, 'pending');
  assert.match(verificationSource, /recordVerifiedCardVerification/);
});

test('Owner Demo is an internal, isolated, non-billable full-access plan', () => {
  const access = subscriptionAccessState({
    Plan: 'Owner Demo', OwnerDemo: true, SubscriptionStatus: 'Active'
  });
  assert.equal(access.Plan, 'Owner Demo');
  assert.equal(access.SubscriptionActive, true);
  assert.match(access.SubscriptionMessage, /synthetic demonstration records/i);
  assert.match(poolApiSource, /action === 'create-owner-demo'/);
  assert.match(poolApiSource, /NonBillable: true/);
  assert.match(poolApiSource, /SyntheticDataOnly: true/);
  assert.match(poolApiSource, /subscriptionPlanEntitlements\('Enterprise'/);
  assert.match(poolUiSource, /data-tenant-pool-tab="owner-demo"/);
  assert.match(poolUiSource, /never copy live subscriber data/i);
  assert.match(poolClientSource, /action: 'create-owner-demo'/);
});
