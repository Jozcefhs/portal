import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildOrganizationCommerceJournal,
  normalizeCommercePaymentMethod,
  shouldEmailOrganizationCommercePaymentLink
} from '../functions/lib/organization-commerce.js';

const portalRoot = new URL('../', import.meta.url);
const [
  commerceSource,
  storeApi,
  departmentApi,
  verifyApi,
  backendApi,
  adminJs,
  portalCss,
  paymentSuccessJs
] = await Promise.all([
  readFile(new URL('functions/lib/organization-commerce.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-stores.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-departments.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/verify-payment.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/backend.js', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('js/payment-success.js', portalRoot), 'utf8')
]);

test('commerce payment method names are normalized without accepting ambiguous methods', () => {
  assert.equal(normalizeCommercePaymentMethod('cash'), 'Cash');
  assert.equal(normalizeCommercePaymentMethod('bank transfer'), 'Bank Transfer');
  assert.equal(normalizeCommercePaymentMethod('POS/Card'), 'POS / Card');
  assert.equal(normalizeCommercePaymentMethod('paystack'), 'Paystack Online');
  assert.throws(() => normalizeCommercePaymentMethod('wallet'), /Choose Cash/);
});

test('payment-link email is reserved for staff-created online store sales', () => {
  assert.equal(shouldEmailOrganizationCommercePaymentLink({ CheckoutSource: 'Staff Point of Sale' }), true);
  assert.equal(shouldEmailOrganizationCommercePaymentLink({ CheckoutSource: 'Public Store' }), false);
  assert.equal(shouldEmailOrganizationCommercePaymentLink({ CheckoutSource: 'public store' }), false);
});

test('organisation store cash sale debits cash and credits dedicated store revenue', () => {
  const journal = buildOrganizationCommerceJournal({
    SaleNo: 'STORE-SALE-1',
    SaleType: 'organizationStore',
    Department: 'Organisation Store',
    CustomerName: 'Walk-in customer',
    PaymentMethod: 'Cash',
    Amount: 12500,
    BranchId: 'main',
    OrganisationEdition: 'faith'
  });
  assert.equal(journal.TotalDebit, 12500);
  assert.equal(journal.TotalCredit, 12500);
  assert.deepEqual(journal.Lines.map((line) => [line.AccountCode, line.Debit, line.Credit]), [
    ['1010', 12500, 0],
    ['4120', 0, 12500]
  ]);
});

test('restaurant Paystack sale records net clearing, fee expense and gross restaurant revenue', () => {
  const journal = buildOrganizationCommerceJournal({
    SaleNo: 'RST-SALE-1',
    SaleType: 'restaurant',
    Department: 'Restaurant',
    CustomerName: 'Guest',
    PaymentMethod: 'Paystack Online',
    Amount: 10000,
    BranchId: 'main',
    OrganisationEdition: 'faith'
  }, {
    GrossAmount: 10000,
    GatewayFee: 250,
    NetAmount: 9750,
    Reference: 'PAYSTACK-1'
  });
  assert.equal(journal.TotalDebit, 10000);
  assert.equal(journal.TotalCredit, 10000);
  assert.deepEqual(journal.Lines.map((line) => [line.AccountCode, line.Debit, line.Credit]), [
    ['1030', 9750, 0],
    ['6060', 250, 0],
    ['4130', 0, 10000]
  ]);
});

test('store and restaurant mutations require staff access, stable idempotency and authoritative inventory', () => {
  assert.match(storeApi, /requireStaffSession\(env, request\)/);
  assert.match(storeApi, /beginIdempotentRequest/);
  assert.match(storeApi, /action === 'recordsale'/);
  assert.match(storeApi, /recordManualOrganizationCommerceSale/);
  assert.match(storeApi, /const itemId = clean\(body\.ItemId/);
  assert.match(storeApi, /const codeChanged = Boolean\(existing\)/);
  assert.match(storeApi, /batchCommitDocuments\(env/);
  assert.match(storeApi, /operation: 'delete'/);
  assert.match(storeApi, /Item code \$\{itemCode\} is already in use/);
  assert.match(departmentApi, /beginIdempotentRequest/);
  assert.match(departmentApi, /action === 'recordsale'/);
  assert.match(departmentApi, /section !== 'restaurant'/);
  assert.match(departmentApi, /Price: section === 'restaurant'/);
  assert.match(commerceSource, /authoritativeCart/);
  assert.match(commerceSource, /requested\.Quantity > available/);
  assert.match(commerceSource, /batchUpsertDocuments/);
  assert.match(commerceSource, /MovementType: 'OUT'/);
});

test('organisation commerce Paystack verification bypasses student fees and finalizes the saved sale intent', () => {
  assert.match(verifyApi, /resolvedPaymentType === 'organizationcommerce'/);
  assert.match(verifyApi, /finalizeOnlineOrganizationCommerceSale/);
  assert.match(verifyApi, /!isChurchDonation && !isOrganizationCommerce/);
  assert.match(verifyApi, /!isOrganizationCommerce && orderItems\.length/);
  assert.match(paymentSuccessJs, /Sale payment verified and posted successfully/);
  assert.match(paymentSuccessJs, /stock movement, and Finance & Accounting entry/);
});

test('commerce accounting and complete backup include the new records', () => {
  assert.match(backendApi, /\['4120', 'Organisation Store Revenue'/);
  assert.match(backendApi, /\['4130', 'Restaurant and Catering Revenue'/);
  assert.match(backendApi, /'restaurantInventory', 'restaurantMovements'/);
  assert.match(backendApi, /'organizationCommerceSales', 'organizationCommerceMovements', 'organizationCommerceEmailDeliveries'/);
});

test('faith store and restaurant expose a compact sale workspace with payment choices and receipts', () => {
  assert.match(adminJs, /recordsale/i);
  assert.match(adminJs, /Paystack Online/);
  assert.match(adminJs, /Bank Transfer/);
  assert.match(adminJs, /POS \/ Card/);
  assert.match(adminJs, /SaleRequestId/);
  assert.match(adminJs, /printOrganizationCommerceReceipt/);
  assert.match(portalCss, /commerce-/);
});
