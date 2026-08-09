import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  normalizePlatformPaymentSettings,
  platformBankReferenceHash,
  platformTransferEvidence,
  publicPlatformTransferRecord,
  validatePlatformPaymentSettings
} from '../functions/lib/platform-direct-bank-transfer.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Dynamax direct-transfer settings remain separate from tenant bank settings', () => {
  const settings = normalizePlatformPaymentSettings({
    OnlinePaymentEnabled: 'NO',
    DirectBankTransferEnabled: 'YES',
    PaymentBankName: 'Dynamax Bank',
    PaymentAccountName: 'Dynamax Platform Limited',
    PaymentAccountNumber: ' 0123 456 789 ',
    PaymentBankCurrency: 'ngn'
  });
  assert.equal(settings.OnlinePaymentEnabled, 'NO');
  assert.equal(settings.DirectBankTransferReady, true);
  assert.equal(settings.PaymentAccountNumber, '0123456789');
  assert.equal(settings.PaymentBankCurrency, 'NGN');
  assert.throws(() => validatePlatformPaymentSettings({ DirectBankTransferEnabled: 'YES' }), /bank name/i);
});

test('subscription bank evidence is bounded and reusable references normalize identically', async () => {
  const evidence = platformTransferEvidence({ bankReference: ' TRF 001 ', proofFileName: '../receipt.pdf' });
  assert.equal(evidence.BankReference, 'TRF 001');
  assert.equal(evidence.ProofFileName, '..receipt.pdf');
  assert.equal(await platformBankReferenceHash(' TRF 001 '), await platformBankReferenceHash('trf001'));
  assert.throws(() => platformTransferEvidence({}), /transaction reference/i);
  assert.throws(() => platformTransferEvidence({ bankReference: 'x', proofDataUrl: 'data:text/html;base64,AAA=' }), /PNG, JPG/i);
});

test('the public verification queue excludes proof payloads', () => {
  const record = publicPlatformTransferRecord({
    Reference: 'DMX-TRF-1', PaymentMethod: 'Direct Bank Transfer', ProofDataUrl: 'data:application/pdf;base64,AAAA', Amount: 60000
  });
  assert.equal(record.HasProof, true);
  assert.equal(record.Amount, 60000);
  assert.equal('ProofDataUrl' in record, false);
});

test('Dynamax registration and upgrades use the central payment chooser', async () => {
  const [registrationHtml, registrationClient, adminHtml, adminClient, middleware] = await Promise.all([
    source('register-organization.html'),
    source('js/register-organization.js'),
    source('admin.html'),
    source('js/admin.js'),
    source('functions/_middleware.js')
  ]);
  assert.match(registrationHtml, /js\/payment-methods\.js/);
  assert.ok(registrationHtml.indexOf('js/payment-methods.js') < registrationHtml.indexOf('js/register-organization.js'));
  assert.match(registrationClient, /methodsUrl:\s*'\/api\/platform-payment-methods'/);
  assert.match(registrationClient, /PaymentMethod:\s*paymentChoice\.paymentMethod/);
  assert.match(adminHtml, /js\/payment-methods\.js/);
  assert.ok(adminHtml.indexOf('js/payment-methods.js') < adminHtml.indexOf('js/admin.js'));
  assert.match(adminClient, /methodsUrl:\s*'\/api\/platform-payment-methods'/);
  assert.match(adminClient, /current plan remains active until Dynamax approves it/);
  assert.match(middleware, /'\/api\/platform-payment-methods'/);
  assert.match(middleware, /'\/api\/platform-payment-settings'/);
});

test('manual subscription approval is server-controlled and duplicate-reference protected', async () => {
  const [registrationApi, settingsApi, verifier, statusApi, planApi, managementHtml] = await Promise.all([
    source('functions/api/register-organization.js'),
    source('functions/api/platform-payment-settings.js'),
    source('functions/api/verify-subscription-payment.js'),
    source('functions/api/registration-status.js'),
    source('functions/api/plan-catalog.js'),
    source('plan-management.html')
  ]);
  assert.match(registrationApi, /Status:\s*'Awaiting Verification'/);
  assert.match(registrationApi, /PreserveActivePlan:\s*Boolean\(preserveActivePlan\)/);
  assert.match(registrationApi, /PendingDirectTransferReference/);
  assert.match(settingsApi, /requirePlatformAdmin/);
  assert.match(settingsApi, /verifiedSubscriptionBankReferences/);
  assert.match(settingsApi, /activateSavedSubscriptionPayment/);
  assert.match(settingsApi, /No plan was activated/);
  assert.match(settingsApi, /provider:\s*'Direct Bank Transfer'/);
  assert.match(verifier, /AutoRenewalEnabled:\s*paystack/);
  assert.match(statusApi, /awaiting Dynamax verification/i);
  assert.match(planApi, /OnlinePaymentEnabled !== 'NO'/);
  assert.match(managementHtml, /id="platformTransferRows"/);
  assert.match(managementHtml, /Save payment settings/);
});
