import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { isSchoolFeeAdvance, SCHOOL_FEES_ADVANCE_TYPE } from '../functions/lib/school-fee-advance.js';
import { paymentIntentReference, paymentIntentType } from '../functions/lib/payment-intent.js';

const source = readFileSync(new URL('../functions/api/verify-payment.js', import.meta.url), 'utf8');
const customOrigin = 'https://portal.example.com';

function fixture({ advance = false, origin = customOrigin } = {}) {
  const reference = 'DOMAIN-CHECK-001';
  let intent = { Reference: reference, Status: 'Pending', Amount: 1000, AccountRef: 'DEMO/001',
    PaymentType: advance ? SCHOOL_FEES_ADVANCE_TYPE : 'SchoolFeesTotal', PortalCheckoutOrigin: origin, __updateTime: 'v1' };
  let response;
  const counts = { receipts: 0, settlements: 0, proofWrites: 0, reads: 0 };
  const handler = vm.runInNewContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '') + '\n;onRequestPost', {
    Response, URL, Date, isSchoolFeeAdvance, paymentIntentReference, paymentIntentType,
    readJsonBody: request => request.json(),
    paystackCredentialFingerprint: async () => 'test:current',
    getDocument: async (_env, collection, id) => {
      assert.equal(collection, 'paymentIntents'); assert.equal(id, reference); counts.reads++;
      return { ...intent };
    },
    patchDocumentFieldsIfCurrent: async (_env, collection, id, patch, prior) => {
      assert.equal(collection, 'paymentIntents'); assert.equal(id, reference);
      assert.equal(prior.__updateTime, intent.__updateTime);
      assert.deepEqual(Object.keys(patch).sort(), ['PortalPaymentCredential', 'PortalReturnVerifiedAt', 'PortalReturnVerifiedOrigin']);
      counts.proofWrites++; intent = { ...intent, ...patch, __updateTime: 'proof-' + counts.proofWrites };
    },
    upsertDocument: async (_env, collection, id, data) => {
      assert.equal(collection, 'paymentIntents'); assert.equal(id, reference);
      intent = { ...data, __updateTime: 'completed' };
    },
    beginIdempotentRequest: async () => response ? { replay: true, response, status: 200 } : { owner: true },
    completeIdempotentRequest: async (_env, _key, value) => { response = value; },
    failIdempotentRequest: async () => {},
    recordManualPayment: async () => { counts.receipts++; return { ok: true, payment: { Reference: reference } }; },
    recordSchoolFeeAdvance: async () => {
      counts.settlements++; counts.receipts++;
      intent = { ...intent, Status: 'Completed', __updateTime: 'settled' };
      return { ok: true, payment: { Reference: reference } };
    },
    fetch: async () => Response.json({ status: true, data: { status: 'success', reference,
      amount: 100000, requested_amount: 100000, fees: 0, currency: 'NGN',
      metadata: { paymentType: intent.PaymentType, accountRef: intent.AccountRef } } })
  });
  return { counts, intent: () => intent, patch: value => { intent = { ...intent, ...value }; },
    run: (headerOrigin = origin) => handler({ env: { PAYSTACK_SECRET_KEY: 'test', FIREBASE_PROJECT_ID: 'test',
      FIREBASE_CLIENT_EMAIL: 'test', FIREBASE_PRIVATE_KEY: 'test' }, request: new Request(origin + '/api/verify-payment', {
      method: 'POST', headers: headerOrigin ? { Origin: headerOrigin } : {}, body: JSON.stringify({ reference })
    }) }) };
}

test('an advance checkout records the custom-domain return on its first successful callback', async () => {
  const f = fixture({ advance: true });
  const result = await f.run();
  assert.equal(result.status, 200, JSON.stringify(await result.json()));
  assert.equal(f.counts.settlements, 1);
  assert.equal(f.intent().PortalReturnVerifiedOrigin, customOrigin);
  assert.equal(f.intent().PortalPaymentCredential, 'test:current');
  assert.ok(Date.parse(f.intent().PortalReturnVerifiedAt) <= Date.now());
  const writes = f.counts.proofWrites;
  await f.run();
  assert.equal(f.counts.receipts, 1);
  assert.equal(f.counts.settlements, 1);
  assert.equal(f.counts.proofWrites, writes);
});

test('a browser return after webhook verification records proof once without another receipt', async () => {
  const f = fixture();
  assert.equal((await f.run(null)).status, 200);
  assert.equal(f.intent().PortalReturnVerifiedOrigin, undefined);
  assert.equal((await f.run()).status, 200);
  assert.equal(f.intent().PortalReturnVerifiedOrigin, customOrigin);
  assert.equal(f.counts.proofWrites, 1);
  await f.run();
  assert.equal(f.counts.proofWrites, 1);
  assert.equal(f.counts.receipts, 1);
});

test('invalid, future, old and rotated-key return proofs can be repaired by a genuine callback', async () => {
  for (const patch of [
    { PortalReturnVerifiedAt: 'invalid' },
    { PortalReturnVerifiedAt: new Date(Date.now() + 3600000).toISOString() },
    { PortalReturnVerifiedAt: new Date(Date.now() - 86400001).toISOString() },
    { PortalPaymentCredential: 'test:old' }
  ]) {
    const f = fixture();
    await f.run(null);
    f.patch({ PortalReturnVerifiedOrigin: customOrigin, PortalPaymentCredential: 'test:current',
      PortalReturnVerifiedAt: new Date().toISOString(), ...patch });
    await f.run();
    assert.equal(f.counts.proofWrites, 1, JSON.stringify(patch));
    assert.ok(Date.parse(f.intent().PortalReturnVerifiedAt) <= Date.now());
    assert.equal(f.intent().PortalPaymentCredential, 'test:current');
    assert.equal(f.counts.receipts, 1);
  }
});

test('cross-origin returns cannot produce proof; pages.dev advances do not add proof reads or writes', async () => {
  const f = fixture({ advance: true });
  await f.run('https://other.example.com');
  assert.equal(f.intent().PortalReturnVerifiedOrigin, undefined);
  assert.equal(f.counts.proofWrites, 0);
  const pages = fixture({ advance: true, origin: 'https://tenant-one.pages.dev' });
  await pages.run();
  assert.equal(pages.counts.reads, 1);
  assert.equal(pages.counts.proofWrites, 0);
});
