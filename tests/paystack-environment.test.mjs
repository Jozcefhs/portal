import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  paystackCredentialFingerprint,
  paystackCredentialMatches,
  paystackEnvironmentIdentity,
  paystackSecretMode
} from '../functions/lib/paystack-environment.js';

test('Paystack secret mode is detected without exposing the key', () => {
  assert.equal(paystackSecretMode('sk_live_example'), 'live');
  assert.equal(paystackSecretMode('sk_test_example'), 'test');
  assert.equal(paystackSecretMode(''), 'not-configured');
  assert.equal(paystackSecretMode('unexpected-format'), 'configured');
});

test('Paystack credential fingerprints separate test, live and rotated credentials', async () => {
  const testFingerprint = await paystackCredentialFingerprint('sk_test_example');
  const liveFingerprint = await paystackCredentialFingerprint('sk_live_example');
  const rotatedFingerprint = await paystackCredentialFingerprint('sk_live_rotated');
  assert.match(testFingerprint, /^test:[a-f0-9]{24}$/);
  assert.match(liveFingerprint, /^live:[a-f0-9]{24}$/);
  assert.notEqual(testFingerprint, liveFingerprint);
  assert.notEqual(liveFingerprint, rotatedFingerprint);
  assert.equal(testFingerprint.includes('example'), false);
  assert.equal(paystackCredentialMatches({ PaystackCredentialFingerprint: liveFingerprint }, { fingerprint: liveFingerprint }), true);
  assert.equal(paystackCredentialMatches({ PaystackCredentialFingerprint: testFingerprint }, { fingerprint: liveFingerprint }), false);
  assert.equal(paystackCredentialMatches({}, { fingerprint: liveFingerprint }), false);
  assert.deepEqual(await paystackEnvironmentIdentity({ PAYSTACK_SECRET_KEY: 'sk_live_example' }), {
    mode: 'live', fingerprint: liveFingerprint
  });
});

test('subscription checkout and plan management invalidate provider artifacts after a key change', async () => {
  const root = new URL('../', import.meta.url);
  const [registration, catalog, payments] = await Promise.all([
    readFile(new URL('functions/api/register-organization.js', root), 'utf8'),
    readFile(new URL('functions/api/plan-catalog.js', root), 'utf8'),
    readFile(new URL('functions/api/platform-payment-settings.js', root), 'utf8')
  ]);
  assert.match(registration, /paystackCredentialMatches\(reusableCredential, paystackIdentity\)/);
  assert.match(registration, /PaystackCredentialFingerprint: paystackIdentity\.fingerprint/);
  assert.match(registration, /paystackCredentialFingerprint: clean\(paystackIdentity\?\.fingerprint\)/);
  assert.match(catalog, /paystackCredentialsChanged/);
  assert.match(catalog, /catalog\.Plans\[name\]\.PaystackMonthlyPlanCode = ''/);
  assert.match(payments, /paystackEnvironment: paystackSecretMode\(env\.PAYSTACK_SECRET_KEY\)/);
});
