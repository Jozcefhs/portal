import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [
  storeHtml,
  storeJs,
  storeCss,
  storeCompactCss,
  staffCss,
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
  readFile(new URL('css/store-compact.css', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
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
  assert.match(storeHtml, /Secure payment choices/);
  assert.doesNotMatch(storeHtml, /school/i);
  assert.match(storeJs, /fetch\(`\/api\/public-organization-store\?branch=/);
  assert.match(storeJs, /getTurnstileToken\('organization_store'\)/);
  assert.match(storeJs, /'Idempotency-Key': idempotencyKey/);
  assert.match(storeJs, /Items: \[\.\.\.cart\.entries\(\)\]/);
  assert.match(storeCss, /width:fit-content/);
  assert.doesNotMatch(storeHtml, /<small>Organisation Store<\/small>/);
  assert.match(storeHtml, /store-compact\.css\?v=20260802-compact-sticky-header/);
  assert.match(storeHtml, /id="publicStoreCartShortcut"/);
  assert.match(storeHtml, /class="public-store-header" id="publicStoreHeader"/);
  assert.match(storeHtml, /id="publicStoreCheckout" tabindex="-1"/);
  assert.match(storeHtml, /js\/payment-methods\.js\?v=20260809-direct-transfer/);
  assert.match(storeHtml, /js\/store\.js\?v=20260809-direct-transfer/);
  assert.match(storeCompactCss, /\.public-store-header\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 0;[\s\S]*?z-index: 20;/);
  assert.match(storeCompactCss, /@media \(max-width: 820px\)[\s\S]*?\.public-store-header\s*\{[\s\S]*?gap: 6px;[\s\S]*?padding: 10px 12px;/);
  assert.match(storeCompactCss, /\.public-store-header > div:last-child > span\s*\{\s*display: none;/);
  assert.match(storeCompactCss, /\.public-store-cart-shortcut\s*\{[\s\S]*?position: absolute;[\s\S]*?right: 0;[\s\S]*?bottom: 0;/);
  assert.match(storeCompactCss, /\.public-store-search\s*\{[\s\S]*?position: sticky;[\s\S]*?top: calc\(var\(--public-store-header-height\) \+ 5px\);/);
  assert.match(storeCompactCss, /\.public-store-layout\s*\{\s*overflow: visible;/);
  assert.match(storeJs, /function syncStoreStickyOffset\(\)/);
  assert.match(storeJs, /--public-store-header-height/);
  assert.match(storeJs, /new ResizeObserver\(syncStoreStickyOffset\)/);
  assert.match(storeJs, /storeCartBadge\.textContent = String\(itemCount\)/);
  assert.match(storeJs, /storeCartShortcut\.disabled = !itemCount/);
  assert.match(storeJs, /storeCheckout\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  assert.match(staffCss, /\.commerce-product-list\{[\s\S]*?grid-template-columns:repeat\(auto-fill,minmax\(128px,1fr\)\);[\s\S]*?max-height:358px;/);
  assert.match(staffCss, /\.commerce-product\{[\s\S]*?grid-template-rows:minmax\(0,1fr\) auto;[\s\S]*?min-height:110px;/);
  assert.match(staffCss, /@media\(max-width:680px\)\{[\s\S]*?\.commerce-product-list\{grid-template-columns:repeat\(auto-fill,minmax\(118px,1fr\)\)/);
  assert.match(staffCss, /\.commerce-product:has\(\.commerce-add-button\.is-added\)/);
});

test('public store API is edition-bound, rate limited, replay safe and uses server inventory prices', () => {
  assert.match(publicApi, /requiredDeploymentIdentity\(env\)/);
  assert.match(publicApi, /\['faith', 'organization'\]/);
  assert.match(publicApi, /verifyTurnstile\(env, request, body, 'organization_store'\)/);
  assert.match(publicApi, /consumeRequestAllowance\(env, request/);
  assert.match(publicApi, /beginIdempotentRequest\(env, request, body/);
  assert.match(publicApi, /initializeOnlineOrganizationCommerceSale/);
  assert.match(publicApi, /initializeDirectTransferOrganizationCommerceSale/);
  assert.match(publicApi, /CheckoutSource: 'Public Store'/);
  assert.match(commerce, /export async function listPublicOrganizationStoreItems/);
  assert.match(commerce, /const cart = await authoritativeCart/);
});

test('staff checkout emails a pending link while public QR checkout sends only the paid receipt', () => {
  assert.match(commerce, /sendOrganizationCommercePaymentLinkEmail/);
  assert.match(commerce, /sendOrganizationCommerceReceiptEmail/);
  assert.match(commerce, /function shouldEmailOrganizationCommercePaymentLink/);
  assert.match(commerce, /lower\(sale\.CheckoutSource\) !== 'public store'/);
  assert.match(commerce, /reason: 'public-self-service-checkout'/);
  assert.match(commerce, /scheduleCommercePaymentLinkEmail\(env, updated, options\)/);
  assert.match(commerce, /scheduleCommerceEmail\(env, paidSale, 'receipt'/);
  assert.match(commerce, /scheduleCommerceEmail\(env, sale, 'receipt'/);
  assert.match(commerce, /typeof options\.waitUntil === 'function'/);
  assert.match(commerce, /organizationCommerceEmailDeliveries/);
  assert.match(commerce, /createDocumentIfAbsent\(env, COMMERCE_EMAIL_DELIVERIES/);
  assert.match(commerceEmail, /Complete your organisation store payment/);
  assert.match(commerceEmail, /Organisation store receipt/);
  assert.match(commerceEmail, /sendConfiguredEmail/);
  assert.match(commerceEmail, /Stock is deducted only after payment is confirmed/);
  assert.match(commerceEmail, /function receiptItemsTable/);
  assert.match(commerceEmail, /table-layout:fixed/);
  assert.match(commerceEmail, /vertical-align:middle/);
  assert.match(commerceEmail, /width="28%"/);
  assert.match(commerceEmail, /function totalSummary/);
  assert.doesNotMatch(commerceEmail, /display:flex/);
  assert.doesNotMatch(storeHtml, /payment link and receipt/i);
  assert.match(storeHtml, /Your paid receipt will be sent here/);
  assert.doesNotMatch(storeJs, /Payment link emailed/);
  assert.match(storeJs, /receipt will be emailed after payment/);
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
  assert.match(serviceWorker, /'\/css\/store-compact\.css'/);
});
