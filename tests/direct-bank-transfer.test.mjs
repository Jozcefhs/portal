import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizePublicPaymentMethod } from '../functions/lib/direct-bank-transfer.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public payment method aliases keep Paystack automated and direct transfer manual', () => {
  assert.equal(normalizePublicPaymentMethod('card'), 'paystack');
  assert.equal(normalizePublicPaymentMethod('USSD'), 'paystack');
  assert.equal(normalizePublicPaymentMethod('Pay with Bank'), 'paystack');
  assert.equal(normalizePublicPaymentMethod('direct bank transfer'), 'direct_bank_transfer');
  assert.throws(() => normalizePublicPaymentMethod('cash'));
});

test('all operational public payment pages load the shared payment chooser first', async () => {
  for (const [htmlFile, pageScript] of [
    ['buy-form.html', 'js/buy-form.js'],
    ['payments.html', 'js/payments.js'],
    ['parent-dashboard.html', 'js/parent-dashboard.js'],
    ['give.html', 'js/give.js'],
    ['store.html', 'js/store.js']
  ]) {
    const html = await source(htmlFile);
    assert.match(html, /js\/payment-methods\.js/);
    assert.ok(html.indexOf('js/payment-methods.js') < html.indexOf(pageScript), `${htmlFile} must load the chooser before ${pageScript}`);
  }
});

test('every direct-transfer chooser receives and displays the exact payable amount', async () => {
  const chooser = await source('js/payment-methods.js');
  assert.match(chooser, /Transfer exactly/);
  assert.match(chooser, /style: 'currency'/);
  for (const file of ['js/buy-form.js', 'js/payments.js', 'js/parent-dashboard.js', 'js/give.js', 'js/store.js']) {
    const client = await source(file);
    assert.match(client, /DynamaxPaymentMethods\.choose\(\{[^}]*amount/s, `${file} must supply the amount`);
  }
});

test('shared payment chooser keeps instructions and bank details crisp and legible', async () => {
  const styles = await source('css/payment-methods.css');
  assert.match(styles, /\.payment-method-dialog\{[^}]*text-rendering:optimizeLegibility;[^}]*-webkit-font-smoothing:auto/);
  assert.match(styles, /\.payment-method-option small\{[^}]*font-size:11px;[^}]*font-weight:500/);
  assert.match(styles, /\.direct-transfer-panel dt\{[^}]*font-size:9px;[^}]*font-weight:800/);
  assert.match(styles, /\.direct-transfer-panel input\{[^}]*font-size:13px;[^}]*font-weight:500/);
});

test('direct transfer never posts revenue, inventory or receipts before staff approval', async () => {
  const transfer = await source('functions/lib/direct-bank-transfer.js');
  assert.match(transfer, /Status:\s*'Awaiting Verification'/);
  assert.doesNotMatch(transfer, /accountingJournals|send.*Receipt|recordManualPayment|inventoryWrites/);

  const verifier = await source('functions/api/staff-direct-transfers.js');
  assert.match(verifier, /action !== 'approve'/);
  assert.match(verifier, /recordManualPayment/);
  assert.match(verifier, /recordManualOrganizationCommerceSale/);
  assert.match(verifier, /saveChurchDonation/);
  assert.match(verifier, /sendSchoolFormPurchaseEmail/);
  assert.match(verifier, /sendSchoolPaymentReceiptEmail/);
  assert.match(verifier, /The parent receipt was emailed/);
  assert.match(verifier, /Status:\s*'Verified'/);
  assert.match(verifier, /verifiedBankReferences/);
  assert.match(verifier, /Verification in progress/);
  assert.match(verifier, /ApprovalStage:\s*'record'/);
  assert.match(verifier, /ApprovalStage:\s*'deliver-receipt'/);
  assert.match(verifier, /ApprovalStage:\s*'complete'/);
  assert.match(verifier, /No receipt or accounting entry was created/);
});

test('school transfer approval stays below the Worker request ceiling by scoping and batching work', async () => {
  const verifier = await source('functions/api/staff-direct-transfers.js');
  const backend = await source('functions/api/backend.js');
  const schoolScope = await source('functions/lib/school-scope.js');
  const admin = await source('js/admin.js');
  assert.match(verifier, /continuationResponse/);
  assert.match(verifier, /continueApproval: true/);
  assert.match(verifier, /DeferNotifications: true/);
  assert.match(backend, /filterJoin: 'OR'/);
  assert.match(backend, /invoiceWrites/);
  assert.match(backend, /batchUpsertDocuments\(env, invoiceWrites\)/);
  assert.match(schoolScope, /schoolCollectionPaths\(env, collection, requestedScope = null\)/);
  assert.match(schoolScope, /getSchoolDocumentById\(env, collection, documentId, requestedScope = null\)/);
  assert.match(admin, /for \(let step = 0; step < 4; step \+= 1\)/);
});

test('direct-transfer settings are branch-overridable and enforced by public endpoints', async () => {
  const branchSettings = await source('functions/lib/branch-profile-settings.js');
  for (const field of [
    'OnlinePaymentEnabled',
    'DirectBankTransferEnabled',
    'PaymentBankName',
    'PaymentAccountName',
    'PaymentAccountNumber',
    'PaymentBankCurrency',
    'PaymentTransferInstructions'
  ]) assert.match(branchSettings, new RegExp(`['"]${field}['"]`));

  for (const file of [
    'functions/api/init-form-payment.js',
    'functions/api/init-payment.js',
    'functions/lib/church-payments.js',
    'functions/lib/organization-commerce.js'
  ]) {
    const code = await source(file);
    assert.match(code, /publicPaymentMethods/);
    assert.match(code, /online\.enabled/);
  }
});

test('staff queues exist in each relevant operational module', async () => {
  const admin = await source('js/admin.js');
  for (const context of ['admission-form', 'school-payment', 'church-donation', 'organization-store']) {
    assert.match(admin, new RegExp(`['"]${context}['"]`));
  }
  assert.match(admin, /Transfer verification/);
  assert.match(admin, /Have you confirmed this exact credit/);
});

test('direct-transfer audit and bank-reference claims are included in complete backups', async () => {
  const backend = await source('functions/api/backend.js');
  assert.match(backend, /'directTransferRequests'/);
  assert.match(backend, /'verifiedBankReferences'/);
});
