import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  idempotencyKeyFrom,
  readJsonBody
} from '../functions/lib/request-security.js';
import { firestoreDocumentToObject } from '../functions/lib/firestore.js';

const portalRoot = new URL('../', import.meta.url);

const [
  routesSource,
  requestSecuritySource,
  firestoreSource,
  applicationSource,
  buyFormSource,
  paymentsSource,
  registrationSource,
  uploadSource,
  verificationSource,
  paymentSuccessSource,
  generalPaymentVerifierSource,
  formPaymentVerifierSource,
  backendSource
] = await Promise.all([
  readFile(new URL('_routes.json', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/request-security.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/firestore.js', portalRoot), 'utf8'),
  readFile(new URL('js/application.js', portalRoot), 'utf8'),
  readFile(new URL('js/buy-form.js', portalRoot), 'utf8'),
  readFile(new URL('js/payments.js', portalRoot), 'utf8'),
  readFile(new URL('js/register-organization.js', portalRoot), 'utf8'),
  readFile(new URL('js/upload-documents.js', portalRoot), 'utf8'),
  readFile(new URL('js/verify.js', portalRoot), 'utf8'),
  readFile(new URL('js/payment-success.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/verify-payment.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/verify-form-payment.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/backend.js', portalRoot), 'utf8')
]);

test('Pages Functions routing invokes only API paths and bypasses static assets', () => {
  const routes = JSON.parse(routesSource);
  assert.equal(routes.version, 1);
  assert.deepEqual(routes.include, ['/api', '/api/*']);
  assert.deepEqual(routes.exclude, []);

  const invokesFunction = (pathname) => pathname === '/api' || pathname.startsWith('/api/');
  assert.equal(invokesFunction('/api/settings'), true);
  assert.equal(invokesFunction('/api/paystack-webhook'), true);
  assert.equal(invokesFunction('/'), false);
  assert.equal(invokesFunction('/index.html'), false);
  assert.equal(invokesFunction('/admin.html'), false);
  assert.equal(invokesFunction('/css/style.css'), false);
  assert.equal(invokesFunction('/js/admin.js'), false);
  assert.equal(invokesFunction('/images/Logo.png'), false);
  assert.equal(invokesFunction('/sw.js'), false);
});

test('bounded JSON accepts valid payloads and rejects oversized or invalid bodies', async () => {
  const valid = await readJsonBody(new Request('https://example.test/api', {
    method: 'POST',
    body: JSON.stringify({ name: 'Dynamax' }),
    headers: { 'content-type': 'application/json' }
  }), { maxBytes: 1024 });
  assert.deepEqual(valid, { name: 'Dynamax' });

  await assert.rejects(
    () => readJsonBody(new Request('https://example.test/api', {
      method: 'POST',
      body: JSON.stringify({ content: 'x'.repeat(2048) }),
      headers: { 'content-type': 'application/json' }
    }), { maxBytes: 1024 }),
    (error) => error?.status === 413 && error?.code === 'REQUEST_TOO_LARGE'
  );

  await assert.rejects(
    () => readJsonBody(new Request('https://example.test/api', {
      method: 'POST',
      body: '{"broken":',
      headers: { 'content-type': 'application/json' }
    }), { maxBytes: 1024 }),
    (error) => error?.status === 400 && error?.code === 'INVALID_JSON'
  );
});

test('idempotency keys prefer the request header and support body fallbacks', () => {
  const headerRequest = new Request('https://example.test/api', {
    headers: { 'Idempotency-Key': 'header-key-1234' }
  });
  assert.equal(idempotencyKeyFrom(headerRequest, { idempotencyKey: 'body-key-1234' }), 'header-key-1234');
  assert.equal(
    idempotencyKeyFrom(new Request('https://example.test/api'), { idempotencyKey: 'body-key-1234' }),
    'body-key-1234'
  );
  assert.equal(
    idempotencyKeyFrom(new Request('https://example.test/api'), { IdempotencyKey: 'legacy-key-1234' }),
    'legacy-key-1234'
  );
});

test('durable idempotency has atomic claims, leases and terminal replay states', () => {
  assert.match(requestSecuritySource, /createDocumentIfAbsent\(env, IDEMPOTENCY_COLLECTION, documentId, initial\)/);
  assert.match(requestSecuritySource, /Status: 'Processing'/);
  assert.match(requestSecuritySource, /LeaseId: leaseId/);
  assert.match(requestSecuritySource, /LeaseExpiresAt: leaseExpiresAt/);
  assert.match(requestSecuritySource, /ExpiresAt: expiresAt/);
  assert.match(requestSecuritySource, /Status: 'Completed'/);
  assert.match(requestSecuritySource, /Status: 'Failed'/);
  assert.match(requestSecuritySource, /Status: 'Uncertain'/);
  assert.match(requestSecuritySource, /IDEMPOTENCY_OUTCOME_UNCERTAIN/);
  assert.match(requestSecuritySource, /IDEMPOTENCY_CONFLICT/);
  assert.match(requestSecuritySource, /IDEMPOTENCY_IN_PROGRESS/);
  assert.match(requestSecuritySource, /patchDocumentFieldsIfCurrent\(env, IDEMPOTENCY_COLLECTION/);
  assert.match(requestSecuritySource, /deleteDocumentIfCurrent\(env, IDEMPOTENCY_COLLECTION/);
});

test('Firestore list helpers expose cursor pages and fail closed when pagination is required', () => {
  assert.match(firestoreSource, /export async function listCollectionPage\(env, collectionPath, options = \{\}\)/);
  assert.match(firestoreSource, /nextPageToken: clean\(data\.nextPageToken\)/);
  assert.match(firestoreSource, /pageSize.*MAX_LIST_PAGE_SIZE/s);
  assert.match(firestoreSource, /for \(let page = 0; page < maxPages; page \+= 1\)/);
  assert.match(firestoreSource, /Use listCollectionPage with nextPageToken/);
  assert.match(firestoreSource, /error\.code = 'FIRESTORE_PAGINATION_REQUIRED'/);
  assert.match(firestoreSource, /error\.nextPageToken = pageToken/);
  assert.match(firestoreSource, /error\.partialCount = documents\.length/);

  const row = firestoreDocumentToObject({
    name: 'projects/demo/databases/(default)/documents/students/DCA-001',
    createTime: '2026-07-28T10:00:00.000Z',
    updateTime: '2026-07-28T11:00:00.000Z',
    fields: { DisplayName: { stringValue: 'Ada Grace' } }
  });
  assert.equal(row.__id, 'DCA-001');
  assert.equal(row.__createTime, '2026-07-28T10:00:00.000Z');
  assert.equal(row.__updateTime, '2026-07-28T11:00:00.000Z');
  assert.equal(row.DisplayName, 'Ada Grace');
});

test('mutation clients retain idempotency keys for retryable and ambiguous outcomes', () => {
  const mutationSources = [
    applicationSource,
    buyFormSource,
    paymentsSource,
    registrationSource,
    uploadSource,
    verificationSource,
    paymentSuccessSource
  ];
  for (const source of mutationSources) {
    assert.match(source, /function shouldReleaseIdempotencyKey\(response, data\)/);
    assert.match(source, /\[408, 425, 429\]\.includes\(status\)/);
    assert.match(source, /status >= 500/);
    assert.match(source, /IDEMPOTENCY_\(IN_PROGRESS\|LOCKED\|OWNERSHIP_LOST\|OUTCOME_UNCERTAIN\)/);
    assert.match(source, /response\.json\(\)\.catch\(\(\) => null\)/);
    assert.doesNotMatch(source, /if \(responseReceived\).*Idempotency/i);
  }
  assert.match(paymentSuccessSource, /sessionStorage\.setItem\(storageKey, key\)/);
  assert.match(paymentSuccessSource, /sessionStorage\.removeItem\(storageKey\)/);
  assert.match(paymentSuccessSource, /'Idempotency-Key': idempotency\.key/);
  assert.match(uploadSource, /uploadIdentity\(upload, email, code, replaceExisting\)/);
});

test('Paystack verifiers are type-separated and dependent payment records are repairable', () => {
  assert.match(generalPaymentVerifierSource, /isAdmissionFormType\(metadataPaymentType\) \|\| isAdmissionFormType\(storedIntentType\)/);
  assert.match(generalPaymentVerifierSource, /must be verified by the admission form payment verifier/);
  assert.match(formPaymentVerifierSource, /!isAdmissionFormType\(metadataPaymentType \|\| storedIntentType\)/);
  assert.match(formPaymentVerifierSource, /transaction metadata does not match its saved payment intent/);
  assert.match(backendSource, /ProcessingStatus: 'Processing'/);
  assert.match(backendSource, /ProcessingStatus: 'Completed'/);
  assert.match(backendSource, /payment\.InvoiceAllocationStatus = 'Completed'/);
  assert.match(backendSource, /completeFormSaleProcessing\(env, sameReceipt/);
  assert.match(backendSource, /Payment was already recorded; its dependent records were checked/);
});
