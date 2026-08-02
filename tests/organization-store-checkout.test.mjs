import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [
  storeHtml,
  storeJs,
  storeCss,
  publicApi,
  commerce,
  commerceEmail,
  staffApi,
  adminJs,
  paymentSuccess,
  serviceWorker
] = await Promise.all([
  readFile(new URL('store.html', portalRoot), 'utf8'),
  readFile(new URL('js/store.js', portalRoot), 'utf8'),
  readFile(new URL('css/store.css', portalRoot), 'utf8'),
  readFile(new URL('functions/api/public-organization-store.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/organization-commerce.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/organization-commerce-email.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-stores.js', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('js/payment-success.js', portalRoot), 'utf8'),
  readFile(new URL('sw.js', portalRoot), 'utf8')
]);

test('public organisation store exposes a compact searchable catalogue and authoritative cart checkout', () => {
  assert.match(storeHtml, /id="publicStoreProducts"/);
  assert.match(storeHtml, /id="publicStoreCart"/);
  assert.match(storeHtml, /name="CustomerEmail"[^>]*required/);
  assert.match(storeHtml, /name="CompanyWebsite"/);
  assert.match(storeHtml, /Secure Paystack payment/);
  assert.doesNotMatch(storeHtml, /school/i);
  assert.match(storeJs, /fetch\(`\/api\/public-organization-store\?branch=/);
  assert.match(storeJs, /getTurnstileToken\('organization_store'\)/);
  assert.match(storeJs, /'Idempotency-Key': idempotencyKey/);
  assert.match(storeJs, /Items: \[\.\.\.cart\.entries\(\)\]/);
  assert.match(storeCss, /width:fit-content/);
});

test('public store API is edition-bound, rate limited, replay safe and uses server inventory prices', () => {
  assert.match(publicApi, /requiredDeploymentIdentity\(env\)/);
  assert.match(publicApi, /\['faith', 'organization'\]/);
  assert.match(publicApi, /verifyTurnstile\(env, request, body, 'organization_store'\)/);
  assert.match(publicApi, /consumeRequestAllowance\(env, request/);
  assert.match(publicApi, /beginIdempotentRequest\(env, request, body/);
  assert.match(publicApi, /initializeOnlineOrganizationCommerceSale/);
  assert.match(publicApi, /CheckoutSource: 'Public Store'/);
  assert.match(commerce, /export async function listPublicOrganizationStoreItems/);
  assert.match(commerce, /const cart = await authoritativeCart/);
});

test('store checkout emails a payment link while pending and a receipt only after payment', () => {
  assert.match(commerce, /sendOrganizationCommercePaymentLinkEmail/);
  assert.match(commerce, /sendOrganizationCommerceReceiptEmail/);
  assert.match(commerce, /scheduleCommerceEmail\(env, updated, 'payment-link'/);
  assert.match(commerce, /scheduleCommerceEmail\(env, paidSale, 'receipt'/);
  assert.match(commerce, /scheduleCommerceEmail\(env, sale, 'receipt'/);
  assert.match(commerce, /typeof options\.waitUntil === 'function'/);
  assert.match(commerce, /organizationCommerceEmailDeliveries/);
  assert.match(commerce, /createDocumentIfAbsent\(env, COMMERCE_EMAIL_DELIVERIES/);
  assert.match(commerceEmail, /Complete your organisation store payment/);
  assert.match(commerceEmail, /Organisation store receipt/);
  assert.match(commerceEmail, /sendConfiguredEmail/);
  assert.match(commerceEmail, /Stock is deducted only after payment is confirmed/);
});

test('staff can print a reusable branch-scoped public store QR and email online links without leaving the POS', () => {
  assert.match(staffApi, /action === 'genericqr'/);
  assert.match(staffApi, /\/store\.html\?branch=/);
  assert.match(staffApi, /storeQrSvg\(storeUrl\)/);
  assert.match(adminJs, /id="organizationStoreQrButton"/);
  assert.match(adminJs, /Reusable self-service store/);
  assert.match(adminJs, /Payment link sent/);
  assert.match(adminJs, /Send payment link/);
  assert.match(adminJs, /data-commerce-open-payment/);
});

test('public store payment confirmation returns customers to the store and queues their receipt', () => {
  assert.match(commerce, /source', 'public-store'/);
  assert.match(paymentSuccess, /const isPublicStore = isCommerce/);
  assert.match(paymentSuccess, /Return to the store/);
  assert.match(paymentSuccess, /receipt will be sent to your email/);
  assert.match(serviceWorker, /'\/store\.html'/);
  assert.match(serviceWorker, /'\/js\/store\.js'/);
  assert.match(serviceWorker, /'\/css\/store\.css'/);
});
