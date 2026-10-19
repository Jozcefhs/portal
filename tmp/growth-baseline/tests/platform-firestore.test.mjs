import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  hasPlatformFirestoreConfiguration,
  requirePlatformFirestoreEnv
} from '../functions/lib/platform-firestore.js';

test('the subscriber database requires an explicit Dynamax platform credential set', () => {
  assert.equal(hasPlatformFirestoreConfiguration({}), false);
  assert.equal(hasPlatformFirestoreConfiguration({ DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID: 'dynamax-platform' }), true);
  assert.throws(
    () => requirePlatformFirestoreEnv({ FIREBASE_PROJECT_ID: 'subscriber-school' }),
    (error) => error?.status === 503
      && error?.code === 'DYNAMAX_PLATFORM_DATABASE_NOT_CONFIGURED'
      && /DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID/.test(error.message)
  );
});

test('platform credentials are mapped for Firestore without changing the tenant environment', () => {
  const original = {
    FIREBASE_PROJECT_ID: 'subscriber-school',
    FIREBASE_CLIENT_EMAIL: 'tenant@example.test',
    FIREBASE_PRIVATE_KEY: 'tenant-key',
    DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID: 'dynamax-platform',
    DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL: 'platform@example.test',
    DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY: 'platform-key'
  };
  const platform = requirePlatformFirestoreEnv(original);
  assert.equal(platform.FIREBASE_PROJECT_ID, 'dynamax-platform');
  assert.equal(platform.FIREBASE_CLIENT_EMAIL, 'platform@example.test');
  assert.equal(platform.FIREBASE_PRIVATE_KEY, 'platform-key');
  assert.equal(original.FIREBASE_PROJECT_ID, 'subscriber-school');
});

test('Dynamax and an organisation cannot share the same Firestore project', () => {
  assert.throws(
    () => requirePlatformFirestoreEnv({
      FIREBASE_PROJECT_ID: 'digc-suite',
      DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID: 'DIGC-SUITE',
      DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL: 'platform@example.test',
      DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY: 'platform-key'
    }),
    (error) => error?.status === 503
      && error?.code === 'DYNAMAX_PLATFORM_DATABASE_TENANT_CONFLICT'
  );
});

test('all commercial APIs select the central Firestore environment', async () => {
  const files = [
    '../functions/api/register-organization.js',
    '../functions/api/plan-catalog.js',
    '../functions/api/pricing-book-pdf.js',
    '../functions/api/verify-subscription-payment.js',
    '../functions/api/paystack-subscription-webhook.js',
    '../functions/api/tenant-activation.js'
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /requirePlatformFirestoreEnv/, file);
  }
});
