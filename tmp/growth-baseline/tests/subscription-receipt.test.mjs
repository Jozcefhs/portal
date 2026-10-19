import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildSubscriptionReceipt,
  publicSubscriptionReceipt,
  subscriptionReceiptHtml,
  subscriptionReceiptNumber,
  subscriptionReceiptUrl
} from '../functions/lib/subscription-receipt.js';

test('subscription receipts have a deterministic payment-based number', () => {
  const first = subscriptionReceiptNumber('DMX-SUB-1234-abcDEF987654', '2026-09-18T10:30:00.000Z');
  const second = subscriptionReceiptNumber('DMX-SUB-1234-abcDEF987654', '2026-09-18T10:30:00.000Z');
  assert.equal(first, second);
  assert.match(first, /^DMX-RCT-20260918-/);
});

test('receipt records the verified charge and subscriber plan', () => {
  const receipt = buildSubscriptionReceipt({
    Reference: 'DMX-SUB-ONE',
    RegistrationReference: 'REG-ONE',
    Plan: 'Professional',
    BillingCycle: 'Monthly',
    Amount: 240000,
    FullCycleAmount: 240000,
    Currency: 'NGN',
    UserLimit: 50,
    Email: 'owner@example.com'
  }, {
    Reference: 'REG-ONE',
    OrganisationName: 'Example Organisation',
    ContactName: 'Ada Owner',
    Email: 'owner@example.com'
  }, {
    reference: 'DMX-SUB-ONE',
    provider: 'Paystack',
    paidAt: '2026-09-18T10:30:00.000Z',
    providerFields: { PaystackTransactionId: '98765' }
  });
  assert.equal(receipt.Status, 'Paid');
  assert.equal(receipt.Amount, 240000);
  assert.equal(receipt.OrganisationName, 'Example Organisation');
  assert.equal(receipt.Plan, 'Professional');
  assert.equal(receipt.UserLimit, 50);
  assert.equal(receipt.ProviderTransactionId, '98765');
});

test('public receipt omits the subscriber email', () => {
  const receipt = publicSubscriptionReceipt({
    ReceiptNo: 'DMX-RCT-1',
    Status: 'Paid',
    Email: 'private@example.com',
    UserLimit: 5
  });
  assert.equal('email' in receipt, false);
  assert.equal(JSON.stringify(receipt).includes('private@example.com'), false);
});

test('receipt links use the configured central portal and bind both references', () => {
  const url = new URL(subscriptionReceiptUrl({ CANONICAL_PORTAL_URL: 'https://dynamax.example/path' }, {
    PaymentReference: 'PAY-1',
    RegistrationReference: 'REG-1'
  }));
  assert.equal(url.origin, 'https://dynamax.example');
  assert.equal(url.pathname, '/subscription-receipt.html');
  assert.equal(url.searchParams.get('reference'), 'PAY-1');
  assert.equal(url.searchParams.get('registration'), 'REG-1');
});

test('receipt email HTML escapes subscriber-controlled values', () => {
  const html = subscriptionReceiptHtml({
    ReceiptNo: 'R-1',
    Status: 'Paid',
    OrganisationName: '<img src=x onerror=alert(1)>',
    ContactName: '<script>alert(1)</script>',
    Plan: 'Starter',
    BillingCycle: 'Monthly',
    UserLimit: 5,
    Amount: 60000,
    Currency: 'NGN',
    PaymentMethod: 'Paystack',
    PaymentReference: 'PAY-1',
    PaidAt: '2026-09-18T10:30:00.000Z'
  }, 'https://dynamax.example/receipt');
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /PAID/);
});

test('all successful subscription methods use the shared receipt activation path', async () => {
  const verify = await readFile(new URL('../functions/api/verify-subscription-payment.js', import.meta.url), 'utf8');
  const directTransfer = await readFile(new URL('../functions/api/platform-payment-settings.js', import.meta.url), 'utf8');
  const webhook = await readFile(new URL('../functions/api/paystack-subscription-webhook.js', import.meta.url), 'utf8').catch(() => '');
  const callback = await readFile(new URL('../js/subscription-payment.js', import.meta.url), 'utf8');
  const receiptApi = await readFile(new URL('../functions/api/subscription-receipt.js', import.meta.url), 'utf8');
  assert.match(verify, /upsertDocument\(platformEnv, 'subscriptionReceipts'/);
  assert.match(verify, /deliverSubscriptionReceiptEmail/);
  assert.match(directTransfer, /activateSavedSubscriptionPayment/);
  assert.match(verify, /recordVerifiedSubscriptionPayment/);
  if (webhook) assert.match(webhook, /recordVerifiedSubscriptionPayment/);
  assert.match(callback, /View \/ print payment receipt/);
  assert.match(receiptApi, /registrationReference/);
});
