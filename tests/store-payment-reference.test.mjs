import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { applyBranchProfileOverrides } from '../functions/lib/branch-profile-settings.js';
import { normalizeClassKey } from '../functions/lib/class-names.js';
import { normalizePublicPaymentMethod, withPaystackBranchRouting } from '../functions/lib/direct-bank-transfer.js';
import { ORGANIZATION_EDITIONS, resolveOrganizationConfig } from '../functions/lib/organization-config.js';
import { safeScopeId } from '../functions/lib/school-scope.js';

const readSource = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [backend, initializer, branchSettings, confirmation] = await Promise.all([
  readSource('functions/api/backend.js'), readSource('functions/api/init-payment.js'),
  readSource('functions/lib/branch-profile-settings.js'), readSource('js/payment-success.js')
]);
const clean = value => String(value ?? '').trim();
const declaration = (source, name) => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`));
  assert.ok(match, `Find ${name}`);
  return `(${match[0]})`;
};
const normalizeSchoolCode = vm.runInNewContext(declaration(backend, 'normalizeSchoolCode'), { clean });

function codeResolver() {
  const reads = [];
  const getDocument = async (env, collection, id) => {
    reads.push({ collection, id });
    if (env.failedReads?.includes(`${collection}/${id}`)) throw new Error('Test read unavailable');
    return env.documents?.[`${collection}/${id}`] || null;
  };
  const effectiveBranchProfile = vm.runInNewContext(declaration(branchSettings, 'effectiveBranchProfile'), {
    clean, safeScopeId, applyBranchProfileOverrides,
    loadBranchProfileOverride: (env, branchId) => getDocument(env, 'branchProfileOverrides', branchId).catch(() => null)
  });
  const getSchoolCode = vm.runInNewContext(declaration(backend, 'getSchoolCode'), {
    normalizeSchoolCode, resolveOrganizationConfig, effectiveBranchProfile, getDocument,
    requireFirestoreEnv: env => { if (env.unavailable) throw new Error('Test database unavailable'); }
  });
  return { getSchoolCode, reads };
}

const demoDocuments = {
  'settings/schoolProfile': { SchoolCode: 'DCA' },
  'settings/organisationProfile': { Code: 'DNX' }
};

test('canonical organisation code replaces a stale legacy prefix in every edition', async () => {
  for (const edition of ORGANIZATION_EDITIONS) {
    const { getSchoolCode, reads } = codeResolver();
    assert.equal(await getSchoolCode({
      ORGANISATION_EDITION: edition, SCHOOL_CODE: 'DCA',
      documents: {
        ...demoDocuments,
        'settings/organisationProfile': { Code: 'dn-x', Edition: edition }
      }
    }, 'main'), 'DNX', edition);
    assert.deepEqual(reads.map(row => `${row.collection}/${row.id}`).sort(), [
      'branchProfileOverrides/main', 'settings/organisationProfile', 'settings/schoolProfile'
    ]);
  }
});

test('only an explicit code override for the requested branch supersedes the canonical code', async () => {
  const { getSchoolCode } = codeResolver();
  const env = { documents: {
    ...demoDocuments,
    'branchProfileOverrides/demo-campus': {
      OverrideFields: ['SchoolCode'], Values: { SchoolCode: 'dn-x2' }
    },
    'branchProfileOverrides/other-campus': {
      OverrideFields: ['SchoolCode'], Values: { SchoolCode: 'OTHER' }
    },
    'branchProfileOverrides/undeclared': {
      OverrideFields: ['SchoolName'], Values: { SchoolName: 'Demo', SchoolCode: 'DCA' }
    },
    'branchProfileOverrides/blank': { OverrideFields: ['SchoolCode'], Values: { SchoolCode: '' } }
  } };
  assert.equal(await getSchoolCode(env, 'Demo Campus'), 'DNX2');
  assert.equal(await getSchoolCode(env, 'other-campus'), 'OTHER');
  assert.equal(await getSchoolCode(env, 'undeclared'), 'DNX');
  assert.equal(await getSchoolCode(env, 'blank'), 'DNX');
  assert.equal(await getSchoolCode(env, 'main'), 'DNX');
  assert.equal(await getSchoolCode(env), 'DNX');
});

test('configured legacy codes and genuinely configured DCA remain valid, with neutral missing-code fallback', async () => {
  const { getSchoolCode } = codeResolver();
  assert.equal(await getSchoolCode({ documents: { 'settings/schoolProfile': { SchoolCode: 'BPS' } } }), 'BPS');
  assert.equal(await getSchoolCode({ documents: { 'settings/organisationProfile': { Code: 'DCA' } } }), 'DCA');
  assert.equal(await getSchoolCode({ ORGANISATION_CODE: 'DNX' }), 'DNX');
  assert.equal(await getSchoolCode({ ORGANIZATION_CODE: 'ABC' }), 'ABC');
  assert.equal(await getSchoolCode({ SCHOOL_CODE: 'BPS' }), 'BPS');
  assert.equal(await getSchoolCode({}), 'ORG');
});

test('unavailable optional profiles do not replace a readable organisation code with a stale default', async () => {
  const { getSchoolCode } = codeResolver();
  assert.equal(await getSchoolCode({
    documents: demoDocuments, SCHOOL_CODE: 'DCA',
    failedReads: ['settings/schoolProfile', 'branchProfileOverrides/main']
  }, 'main'), 'DNX');
  assert.equal(await getSchoolCode({ unavailable: true, ORGANISATION_CODE: 'DNX', SCHOOL_CODE: 'DCA' }), 'DNX');
  assert.equal(await getSchoolCode({ unavailable: true }), 'ORG');
});

test('the shared resolver neither caches another tenant code nor bypasses deployment edition checks', async () => {
  const { getSchoolCode } = codeResolver();
  assert.deepEqual(await Promise.all([
    getSchoolCode({ documents: demoDocuments }, 'main'),
    getSchoolCode({ documents: { 'settings/organisationProfile': { Code: 'OTHER' } } }, 'main'),
    getSchoolCode({ documents: demoDocuments }, 'main')
  ]), ['DNX', 'OTHER', 'DNX']);
  await assert.rejects(() => getSchoolCode({
    ORGANISATION_EDITION: 'school',
    documents: { 'settings/organisationProfile': { Code: 'OTHER', Edition: 'faith' } }
  }), error => error.code === 'DEPLOYMENT_PROFILE_EDITION_CONFLICT');
});

function checkoutHarness({ paymentMethod = 'paystack', replay = null, documents = demoDocuments, branchId = 'demo-campus' } = {}) {
  const calls = { code: [], intents: [], paystack: [], transfers: [], completed: [], failed: [] };
  const resolver = codeResolver();
  const env = { PAYSTACK_SECRET_KEY: 'test-only', ORGANISATION_EDITION: 'school', documents };
  const body = {
    feeCode: 'STORE_CART', accountRef: 'DNX-26-004', paymentMethod,
    // Submitted branding and branch must not override the authenticated account.
    SchoolCode: 'DCA', branchId: 'other-campus',
    storeCart: [{ itemCode: 'BOOK1', storeType: 'Bookstore', quantity: 1, price: 1 }]
  };
  const account = { AccountRef: 'DNX-26-004', BranchId: branchId, DisplayName: 'Demo child', ClassName: 'Grade 7' };
  const moduleSource = initializer.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '');
  const handler = vm.runInNewContext(`${moduleSource}\n;onRequestPost`, {
    Response, URL, Date, normalizeClassKey, normalizePublicPaymentMethod, withPaystackBranchRouting,
    SCHOOL_FEES_TOTAL_CODE: 'SCHOOL_FEES_TOTAL',
    readJsonBody: request => request.json(),
    readParentSession: async () => ({ email: 'parent@example.org' }),
    verifyTurnstile: async () => {}, requireFirestoreEnv: () => {},
    getPayableFees: async () => ({ ok: true, account, fees: [] }),
    getSchoolCode: async (configuration, requestedBranch) => {
      calls.code.push(requestedBranch);
      return resolver.getSchoolCode(configuration, requestedBranch);
    },
    getDocument: async (_env, collection, id) => {
      assert.equal(collection, 'storeItems');
      assert.equal(id, 'Bookstore-BOOK1');
      return { ItemCode: 'BOOK1', ItemName: 'Demo book', StoreType: 'Bookstore', BranchId: branchId, Price: 5500, Quantity: 10, Active: 'YES' };
    },
    findOneByField: async () => { throw new Error('Unexpected fallback lookup'); },
    beginIdempotentRequest: async () => replay
      ? { replay: true, response: replay, status: 200 }
      : { owner: true },
    completeIdempotentRequest: async (_env, _claim, result) => { calls.completed.push(result); },
    failIdempotentRequest: async (_env, _claim, error) => { calls.failed.push(error.message); },
    branchPaymentConfiguration: async () => ({ online: { enabled: true }, paystack: { subaccountCode: '' } }),
    createDocumentIfAbsent: async (_env, collection, id, document) => {
      calls.intents.push({ collection, id, document });
      return { created: true, document };
    },
    createDirectTransferRequest: async (_env, input) => {
      calls.transfers.push(input);
      return { ok: true, reference: input.reference, paymentMethod: 'direct_bank_transfer' };
    },
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.paystack.co/transaction/initialize');
      const input = JSON.parse(options.body);
      calls.paystack.push(input);
      return Response.json({ status: true, data: { authorization_url: 'https://checkout.example/test', reference: input.reference } });
    }
  });
  return {
    calls, resolver,
    async run() {
      const response = await handler({ env, request: new Request('https://demo.example/api/init-payment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }) });
      assert.equal(response.status, 200, JSON.stringify(calls.failed));
      return { response, data: await response.json() };
    }
  };
}

for (const paymentMethod of ['paystack', 'direct_bank_transfer']) {
  test(`${paymentMethod} store checkout uses the canonical code and preserves the server-calculated amount`, async () => {
    const { run, calls } = checkoutHarness({ paymentMethod });
    const { data } = await run();
    assert.match(data.reference, /^DNX-STORE_CART-DNX-26-004-\d+$/);
    assert.deepEqual(calls.code, ['demo-campus']);
    assert.equal(calls.intents.length, 1);
    assert.equal(calls.intents[0].document.Reference, data.reference);
    assert.equal(calls.intents[0].document.BranchId, 'demo-campus');
    assert.equal(calls.intents[0].document.Amount, 5500);
    if (paymentMethod === 'paystack') {
      assert.equal(calls.paystack.length, 1);
      assert.equal(calls.paystack[0].reference, data.reference);
      assert.equal(calls.paystack[0].amount, 550000);
      assert.equal(new URL(calls.paystack[0].callback_url).searchParams.get('reference'), data.reference);
      assert.equal(calls.paystack[0].metadata.branchId, 'demo-campus');
      assert.equal(calls.transfers.length, 0);
    } else {
      assert.equal(calls.transfers.length, 1);
      assert.equal(calls.transfers[0].reference, data.reference);
      assert.equal(calls.transfers[0].branchId, 'demo-campus');
      assert.equal(calls.transfers[0].payload.StoreCart[0].UnitPrice, 5500);
      assert.equal(calls.paystack.length, 0);
    }
    assert.equal(calls.completed[0].reference, data.reference);
    assert.deepEqual(calls.failed, []);
  });
}

test('checkout applies the authenticated branch code instead of branding supplied by the client', async () => {
  const { run } = checkoutHarness({ documents: {
    ...demoDocuments,
    'branchProfileOverrides/demo-campus': { OverrideFields: ['SchoolCode'], Values: { SchoolCode: 'DNX2' } },
    'branchProfileOverrides/other-campus': { OverrideFields: ['SchoolCode'], Values: { SchoolCode: 'DCA' } }
  } });
  assert.match((await run()).data.reference, /^DNX2-STORE_CART-DNX-26-004-/);
});

test('existing checkout replay retains its exact original reference without creating another transaction', async () => {
  const replay = {
    ok: true, reference: 'DCA-STORE_CART-DNX-26-004-1791460962787',
    authorizationUrl: 'https://checkout.example/original'
  };
  const { run, calls, resolver } = checkoutHarness({ replay });
  const { response, data } = await run();
  assert.deepEqual(data, replay);
  assert.equal(response.headers.get('Idempotency-Replayed'), 'true');
  for (const rows of Object.values(calls)) assert.equal(rows.length, 0);
  assert.equal(resolver.reads.length, 0);
});

test('confirmation still verifies and displays a historical reference verbatim', async () => {
  const reference = 'DCA-STORE_CART-DNX-26-004-1791460962787';
  const displayed = [];
  const node = () => ({ append() {}, appendChild() {}, setAttribute() {} });
  const elements = new Map();
  const verify = vm.runInNewContext(`${confirmation.replace(/\r?\nverifyPayment\(\);\s*$/, '')}\n;verifyPayment`, {
    URLSearchParams, Intl,
    window: { location: { search: `?reference=${encodeURIComponent(reference)}` } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
      createElement: node,
      createTextNode(value) { displayed.push(value); return { textContent: value }; }
    },
    fetch: async (url, options) => {
      assert.equal(url, '/api/verify-payment');
      assert.equal(JSON.parse(options.body).reference, reference);
      return Response.json({ ok: true, feeName: 'School Store Purchase', amount: 5500, currency: 'NGN', reference });
    }
  });
  await verify();
  assert.ok(displayed.includes(reference));
  assert.equal(elements.get('confirmationStatus').className, 'status ok');
});
