import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { initializeSubscriptionCheckout } from '../functions/api/register-organization.js';
import { onRequestPost } from '../functions/api/platform-payment-settings.js';
import { normalizeSubscriptionPlanCatalog } from '../functions/lib/subscription-plans.js';
import { objectToFirestoreFields, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { tenantProjectAssignmentEligibility } from '../functions/lib/tenant-project-pool.js';

test('new subscriber transfer stays pending, reuses its request, and activates only once after admin approval', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = {
    DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID: 'bank-flow-test',
    DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL: 'test@example.invalid',
    DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    ADMIN_WEB_PASSWORD: 'synthetic-test-password'
  };
  const platformEnv = { FIREBASE_PROJECT_ID: env.DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: env.DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: env.DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY };
  const prefix = 'projects/bank-flow-test/databases/(default)/documents/';
  const records = new Map(); const writes = []; let revision = 0;
  const put = (key, data) => records.set(key, { name: prefix + key,
    fields: objectToFirestoreFields(data), updateTime: `2026-11-17T10:00:00.${String(++revision).padStart(9, '0')}Z` });
  const read = key => firestoreDocumentToObject(records.get(key));
  const failure = (status, code) => Response.json({ error: { status: code, message: code } }, { status });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.href === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic', expires_in: 3600 });
    assert.equal(url.hostname, 'firestore.googleapis.com', 'No payment provider or real email calls');
    const key = decodeURIComponent(url.pathname.split('/documents/')[1] || '');
    const method = options.method || 'GET';
    if (method === 'GET') {
      if (records.has(key)) return Response.json(records.get(key));
      if (!key.includes('/')) return Response.json({ documents: [] });
      return failure(404, 'NOT_FOUND');
    }
    const body = JSON.parse(options.body || '{}');
    if (method === 'POST' && url.searchParams.has('documentId')) {
      const id = key + '/' + url.searchParams.get('documentId');
      if (records.has(id)) return failure(409, 'ALREADY_EXISTS');
      put(id, firestoreDocumentToObject({ fields: body.fields })); writes.push(id);
      return Response.json(records.get(id));
    }
    if (method === 'PATCH') {
      const previous = records.get(key);
      const expected = url.searchParams.get('currentDocument.updateTime');
      if (expected && expected !== previous?.updateTime) return failure(409, 'FAILED_PRECONDITION');
      const fields = url.searchParams.has('updateMask.fieldPaths')
        ? { ...(previous?.fields || {}), ...body.fields } : body.fields;
      put(key, firestoreDocumentToObject({ fields })); writes.push(key);
      return Response.json(records.get(key));
    }
    assert.fail(`Unexpected mock request: ${method} ${url.pathname}`);
  };
  try {
    put('settings/dynamaxPaymentSettings', { DirectBankTransferEnabled: 'YES',
      PaymentBankName: 'Test bank', PaymentAccountName: 'Test platform', PaymentAccountNumber: '0123456789' });
    put('tenantRegistrations/REG-test', { Reference: 'REG-test', OrganisationName: 'Synthetic Academy',
      Edition: 'school', ContactEmail: '', Plan: 'Starter', PaymentStatus: 'Pending' });
    const catalog = normalizeSubscriptionPlanCatalog({ Plans: { Starter: { Active: true, MonthlyAmount: 60000 } } });
    const initialize = () => initializeSubscriptionCheckout({ env, platformEnv,
      registration: read('tenantRegistrations/REG-test'), catalog, plan: 'Starter', billingCycle: 'monthly',
      paymentMethod: 'direct_bank_transfer', paymentEvidence: { bankReference: 'synthetic-bank-credit-1' } });
    const pending = await initialize();
    assert.equal(pending.status, 'Awaiting Verification');
    assert.equal(pending.amount, 60000);
    const reference = pending.paymentReference;
    assert.equal(tenantProjectAssignmentEligibility(read('tenantRegistrations/REG-test')).eligible, false);
    const beforeRetry = writes.length;
    assert.equal((await initialize()).paymentReference, reference);
    assert.equal(writes.length, beforeRetry, 'Repeated initialization makes no writes');
    const decision = password => onRequestPost({ env, request: new Request('https://example.invalid/api/platform-payment-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'decision', decision: 'approve', reference, password })
    }) });
    assert.equal((await decision('wrong')).status, 401);
    assert.equal(writes.length, beforeRetry, 'Unauthorized approval makes no writes');
    const approved = await decision(env.ADMIN_WEB_PASSWORD);
    const result = await approved.json();
    assert.equal(approved.status, 200, JSON.stringify(result));
    assert.equal(read(`subscriptionPayments/${reference}`).Status, 'Paid');
    const registration = read('tenantRegistrations/REG-test');
    assert.equal(registration.PaymentStatus, 'Paid');
    assert.equal(registration.AutoRenewalEnabled, false);
    assert.equal(tenantProjectAssignmentEligibility(registration).bankTransferVerified, true);
    assert.equal(registration.CardVerificationStatus, undefined);
    assert.equal(registration.ProvisioningStatus, 'Waiting for ready project');
    const paidThrough = registration.PaidThroughAt;
    assert.equal((await decision(env.ADMIN_WEB_PASSWORD)).status, 200);
    assert.equal(read('tenantRegistrations/REG-test').PaidThroughAt, paidThrough, 'Retry does not extend paid period');
    for (const collection of ['subscriptionPayments/', 'subscriptionReceipts/', 'verifiedSubscriptionBankReferences/', 'tenantProvisioningRequests/']) {
      assert.equal([...records.keys()].filter(key => key.startsWith(collection)).length, 1, collection);
    }
    // A different subscriber cannot reuse the same bank credit.
    put('tenantRegistrations/REG-second', { Reference: 'REG-second', Edition: 'school', DirectTransferReference: 'DMX-second' });
    put('subscriptionPayments/DMX-second', { ...read(`subscriptionPayments/${reference}`), Reference: 'DMX-second',
      RegistrationReference: 'REG-second', Status: 'Awaiting Verification' });
    const duplicate = await onRequestPost({ env, request: new Request('https://example.invalid/api/platform-payment-settings', {
      method: 'POST', body: JSON.stringify({ action: 'decision', decision: 'approve', reference: 'DMX-second', password: env.ADMIN_WEB_PASSWORD })
    }) });
    assert.equal(duplicate.status, 409);
    assert.equal(tenantProjectAssignmentEligibility(read('tenantRegistrations/REG-second')).eligible, false);
  } finally { globalThis.fetch = originalFetch; }
});
