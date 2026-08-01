import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [
  givingHtml,
  givingJs,
  publicApi,
  payments,
  staffApi,
  adminJs,
  paymentSuccess,
  requestSecurity,
  paymentVerification
] = await Promise.all([
  readFile(new URL('give.html', portalRoot), 'utf8'),
  readFile(new URL('js/give.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/public-church-payment.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/church-payments.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-church-payments.js', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('js/payment-success.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/request-security.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/verify-payment.js', portalRoot), 'utf8')
]);

test('public giving page collects donor details before opening Paystack', () => {
  assert.match(givingHtml, /id="publicGivingForm"/);
  assert.match(givingHtml, /name="DonorName"/);
  assert.match(givingHtml, /name="DonorEmail"/);
  assert.match(givingHtml, /name="PaymentType"/);
  assert.match(givingHtml, /name="Currency"/);
  assert.match(givingHtml, /name="Amount"/);
  assert.match(givingHtml, /name="CompanyWebsite"/);
  assert.match(givingHtml, /js\/give\.js\?v=20260801-currency-conversion/);
  assert.match(givingJs, /getTurnstileToken\('church_giving'\)/);
  assert.match(givingJs, /fetch\('\/api\/public-church-payment'/);
  assert.match(givingJs, /'Idempotency-Key': idempotencyKey/);
  assert.match(givingJs, /window\.location\.assign\(paymentUrl\)/);
});

test('public giving API is bounded, rate limited and replay safe', () => {
  assert.match(publicApi, /readJsonBody\(request, \{ maxBytes: 32 \* 1024 \}\)/);
  assert.match(publicApi, /verifyTurnstile\(env, request, body, 'church_giving'\)/);
  assert.match(publicApi, /consumeRequestAllowance\(env, request/);
  assert.match(publicApi, /scope: 'public-church-giving'/);
  assert.match(publicApi, /beginIdempotentRequest\(env, request, body/);
  assert.match(publicApi, /initPublicChurchDonationPayment\(env, body/);
  assert.match(requestSecurity, /export async function consumeRequestAllowance/);
  assert.match(requestSecurity, /REQUEST_ALLOWANCE_COLLECTION = 'requestRateLimits'/);
});

test('public gifts are branch checked and restricted to recognised gift types', () => {
  assert.match(payments, /ensureGivingTypes\(env, branchId\)/);
  assert.match(payments, /resolveGivingType\(givingTypes/);
  assert.match(payments, /export async function getPublicChurchGivingTypes/);
  assert.match(publicApi, /export async function onRequestGet/);
  assert.match(payments, /export async function initPublicChurchDonationPayment/);
  assert.match(payments, /await getSchoolStructure\(env\)/);
  assert.match(payments, /Choose a valid giving branch\./);
  assert.match(payments, /Choose a valid online gift type\./);
  assert.match(payments, /PublicGiving: 'yes'/);
  assert.match(payments, /source=public-giving&branch=/);
});

test('self-service giving skips the redundant payment-link email', () => {
  assert.match(payments, /const shouldSendPaymentLinkEmail = !publicGiving/);
  assert.match(payments, /const paymentLinkDelivery = shouldSendPaymentLinkEmail\s*\?\s*await sendChurchDonationReceipt/);
  assert.match(payments, /!shouldSendPaymentLinkEmail\s*\?\s*'Secure donation payment page created\.'/);
  assert.match(payments, /receipt: paymentLinkDelivery/);
  assert.match(paymentVerification, /sendChurchDonationReceipt\(env, donation,[\s\S]*?paymentLink: ''/);
});

test('staff can print a reusable branch-scoped generic giving QR', () => {
  assert.match(payments, /export async function buildChurchGenericGivingQr/);
  assert.match(payments, /\/give\.html\?workspace=faith&branch=/);
  assert.match(staffApi, /action === 'genericqr'/);
  assert.match(adminJs, /id="genericChurchGivingQr"/);
  assert.match(adminJs, /churchDonationRequest\('genericqr'\)/);
  assert.match(adminJs, /Reusable self-service giving/);
});

test('public giving confirmation returns donors to the giving page', () => {
  assert.match(paymentSuccess, /isPublicGiving/);
  assert.match(paymentSuccess, /Make another donation/);
  assert.match(paymentSuccess, /Your gift has been confirmed\./);
  assert.match(paymentSuccess, /An official receipt will be sent to your email\./);
});
