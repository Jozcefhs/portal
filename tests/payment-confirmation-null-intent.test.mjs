import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  paymentIntentReference,
  paymentIntentType
} from '../functions/lib/payment-intent.js';

const portalRoot = new URL('../', import.meta.url);
const [generalVerifier, formVerifier, confirmationClient, confirmationHtml] = await Promise.all([
  readFile(new URL('functions/api/verify-payment.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/verify-form-payment.js', portalRoot), 'utf8'),
  readFile(new URL('js/payment-success.js', portalRoot), 'utf8'),
  readFile(new URL('payment-success.html', portalRoot), 'utf8')
]);

test('missing and malformed payment intents are handled as empty records', () => {
  [null, undefined, '', 0, [], false].forEach((value) => {
    assert.equal(paymentIntentType(value), '');
    assert.equal(paymentIntentReference(value), '');
  });
});

test('payment intent helpers support current and legacy field names', () => {
  assert.equal(paymentIntentType({ PaymentType: 'SchoolFeesTotal' }), 'SchoolFeesTotal');
  assert.equal(paymentIntentType({ paymentType: 'ChurchDonation' }), 'ChurchDonation');
  assert.equal(paymentIntentType({ IntentType: 'OrganizationCommerce' }), 'OrganizationCommerce');
  assert.equal(paymentIntentReference({ Reference: 'PAY-001' }), 'PAY-001');
  assert.equal(paymentIntentReference({ paymentReference: 'PAY-002' }), 'PAY-002');
});

test('both Paystack verifiers use the null-safe shared payment-intent helpers', () => {
  [generalVerifier, formVerifier].forEach((source) => {
    assert.match(source, /paymentIntentReference, paymentIntentType/);
    assert.match(source, /const storedIntentType = paymentIntentType\(intent\)/);
    assert.match(source, /const savedReference = paymentIntentReference\(intent\)/);
    assert.doesNotMatch(source, /intent\.PaymentType/);
  });
});

test('confirmation page hides duplicate-payment action for internal verification failures', () => {
  assert.match(confirmationClient, /If you were charged, do not pay again/);
  assert.match(confirmationClient, /Number\(error\?\.status \|\| 0\) >= 500/);
  assert.match(confirmationClient, /anotherPaymentRow/);
  assert.match(confirmationClient, /anotherLink\.hidden = true/);
  assert.match(confirmationHtml, /payment-success\.js\?v=20260802-public-store-return/);
});
