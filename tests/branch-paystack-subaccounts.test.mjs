import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  normalizePaystackSubaccountCode,
  withPaystackBranchRouting
} from '../functions/lib/direct-bank-transfer.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Paystack subaccount codes are validated without accepting credentials', () => {
  assert.equal(normalizePaystackSubaccountCode(''), '');
  assert.equal(normalizePaystackSubaccountCode(' ACCT_branch123 '), 'ACCT_branch123');
  assert.throws(() => normalizePaystackSubaccountCode('sk_live_secret'));
  assert.throws(() => normalizePaystackSubaccountCode('branch123'));
});

test('branch routing sends settlement to the configured subaccount and makes it bear fees', () => {
  const original = { email: 'parent@example.org', amount: 250000 };
  assert.deepEqual(withPaystackBranchRouting(original, { paystack: { subaccountCode: '' } }), original);
  assert.deepEqual(withPaystackBranchRouting(original, {
    paystack: { subaccountCode: 'ACCT_branch123' }
  }), {
    ...original,
    subaccount: 'ACCT_branch123',
    bearer: 'subaccount'
  });
  assert.deepEqual(original, { email: 'parent@example.org', amount: 250000 });
});

test('every branch-owned Paystack initializer uses the shared server-side routing contract', async () => {
  for (const file of [
    'functions/api/init-form-payment.js',
    'functions/api/init-payment.js',
    'functions/lib/church-payments.js',
    'functions/lib/organization-commerce.js',
    'functions/lib/hotel-services.js'
  ]) {
    const code = await source(file);
    assert.match(code, /branchPaymentConfiguration/);
    assert.match(code, /withPaystackBranchRouting/);
    assert.match(code, /PaystackSubaccountCode/);
    assert.match(code, /PaystackSettlementMode/);
  }
});

test('branch subaccount setup is branch-only and the gateway secret stays server-side', async () => {
  const [settings, backend, setupHtml, setupScript, branchSettings, desktop] = await Promise.all([
    source('functions/api/settings.js'),
    source('functions/api/backend.js'),
    source('setup.html'),
    source('js/setup.js'),
    source('functions/lib/branch-profile-settings.js'),
    readFile(new URL('../../suite/main.py', import.meta.url), 'utf8')
  ]);
  assert.match(settings, /valid Paystack subaccount code beginning with ACCT_/);
  assert.match(setupHtml, /name="PaystackSubaccountCode"/);
  assert.match(setupScript, /paystackSubaccountCode\.disabled = !branchMode/);
  assert.match(branchSettings, /'PaystackSubaccountCode'/);
  assert.match(backend, /normalizePaystackSubaccountCode\(submittedProfile\.PaystackSubaccountCode\)/);
  assert.match(desktop, /payload\["PaystackSubaccountCode"\] = paystack_subaccount_code/);
  assert.match(desktop, /paystack_subaccount_entry\.configure\(state="normal" if locked else "disabled"\)/);
  assert.doesNotMatch(setupHtml, /PAYSTACK_SECRET_KEY|PaystackSecretKey/);
  assert.doesNotMatch(setupScript, /PAYSTACK_SECRET_KEY|PaystackSecretKey/);
  assert.doesNotMatch(branchSettings, /PAYSTACK_SECRET_KEY|PaystackSecretKey/);
});

test('Dynamax subscription checkout is not routed through branch subaccounts', async () => {
  const registration = await source('functions/api/register-organization.js');
  assert.doesNotMatch(registration, /withPaystackBranchRouting|PaystackSubaccountCode/);
});
