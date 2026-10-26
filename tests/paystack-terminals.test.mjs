import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTerminalPayments, verifyTerminalPayment, terminalPaymentWebhook, terminalIncomeAccounts } from '../functions/lib/paystack-terminals.js';
import { terminalPaystackRequest } from '../functions/lib/paystack-terminal-client.js';
import { readFile } from 'node:fs/promises';

const user = { username: 'admin', role: 'Super Admin', branchId: 'main', branchAccess: 'all', allowedSections: ['incomeAnalytics'] };
const reference = 'TERM-12345678-1234-4234-8234-123456789012';
const input = { action: 'create', requestId: reference, payerName: 'Test payer', email: 'payer@example.test',
  description: 'General income', amount: '1000', accountCode: '4090' };

test('release gate disables card payments in every edition even with previously enabled branch settings', async () => {
  for (const edition of ['school', 'faith', 'organization']) {
    const f = fixture({ edition, enabled: true });
    const settings = await handleTerminalPayments({}, user, { action: 'settings' }, f.overrides);
    assert.equal(settings.available, false);
    assert.equal(settings.settings.enabled, false);
    assert.match(settings.disabledMessage, /disabled for now/);
    for (const body of [input, { action: 'send', requestId: reference }, { action: 'save-settings', enabled: true }]) {
      await assert.rejects(handleTerminalPayments({}, user, body, f.overrides), /disabled for now/);
    }
    assert.equal(f.calls.length, 0, 'no provider requests while release is disabled');
    assert.equal(f.writes.length, 0, 'no payment or settings writes from blocked actions');
  }
});

test('disabled rollout still permits verification of a payment previously collected', async () => {
  const f = fixture();
  await f.run(input); f.paid();
  const result = await handleTerminalPayments({}, user, { action: 'verify', requestId: reference }, f.overrides);
  assert.equal(result.payment.Status, 'Paid');
});
function fixture({ edition = 'school', mode = 'live', enabled = true } = {}) {
  const db = new Map(), calls = [], writes = [], reads = [];
  let version = 0, failInvoice = false, failCommit = false, currentFingerprint = 'merchant-original';
  const identity = () => ({ mode, fingerprint: currentFingerprint });
  const put = (collection, key, row) => db.set(`${collection}/${key}`, { ...structuredClone(row), __id: key, __updateTime: `v${++version}` });
  const get = (collection, key) => structuredClone(db.get(`${collection}/${key}`) || null);
  put('paymentTerminalSettings', 'main', { BranchId: 'main', TerminalId: 'DEVICE1', Label: 'Front desk', Enabled: enabled, PaystackCredentialFingerprint: currentFingerprint });
  const invoice = { id: 1234, request_code: 'PRQ_original123', offline_reference: '5551234', amount: 100000, currency: 'NGN',
    domain: mode, customer: 42, metadata: { dynamaxTerminalRequest: reference }, status: 'pending', paid: false, transactions: [] };
  const transaction = { id: 77, reference: 'pos_original123', amount: 100000, fees: 500, currency: 'NGN', domain: mode,
    customer: { id: 42, customer_code: 'CUS_original123' }, status: 'success', paid_at: '2026-10-25T10:00:00Z' };
  const overrides = {
    config: async () => ({ Edition: edition, FeatureFlags: { accounting: true } }), identity: async () => identity(),
    routing: async () => ({ paystack: { subaccountCode: '' } }),
    chart: async () => [{ Code: '4090', Name: 'Other income', Type: 'Revenue', Active: 'YES', Group: 'Other Income' }],
    get: async (_env, collection, key) => { reads.push([collection, key]); return get(collection, key); },
    query: async (_env, collection, options) => { reads.push([collection, options]); return [...db.entries()].filter(([key, row]) => key.startsWith(collection + '/')
      && row.BranchDate >= options.filters[0].value && (options.filters[1].op === '<' ? row.BranchDate < options.filters[1].value : row.BranchDate <= options.filters[1].value))
      .map(([, row]) => structuredClone(row)).sort((a, b) => b.BranchDate.localeCompare(a.BranchDate)).slice(0, options.limit); },
    commit: async (_env, batch) => {
      if (failCommit) throw Object.assign(new Error('Simulated unavailable database'), { status: 503 });
      for (const item of batch) {
        const current = get(item.collectionPath, item.documentId);
        if (item.exists === false && current || item.updateTime && item.updateTime !== current?.__updateTime) throw Object.assign(new Error('Conflict'), { status: 412 });
      }
      writes.push(structuredClone(batch));
      for (const item of batch) {
        if (item.delete) db.delete(`${item.collectionPath}/${item.documentId}`);
        else put(item.collectionPath, item.documentId, item.data);
      }
    },
    provider: async (_env, path, body) => {
      calls.push([path, structuredClone(body)]);
      if (path === '/customer') return { id: 42, customer_code: 'CUS_original123' };
      if (path === '/paymentrequest') {
        if (failInvoice) throw Object.assign(new Error('Simulated lost invoice response'), { status: 502 });
        invoice.metadata = JSON.parse(body.metadata); return structuredClone(invoice);
      }
      if (path.startsWith('/paymentrequest/')) return structuredClone(invoice);
      if (path.startsWith('/transaction/')) return structuredClone(transaction);
      if (path.endsWith('/presence')) return { online: true, available: true };
      if (path.endsWith('/event')) return { id: 'EVENT1' };
      if (path.startsWith('/terminal/')) return { terminal_id: path.split('/')[2], status: 'active', domain: mode, integration: 555 };
      throw new Error(`Unexpected provider call ${path}`);
    },
    journal: async (_env, body) => ({ payload: structuredClone(body), existing: get('accountingJournals', body.JournalNo) || {} })
  };
  return { db, calls, writes, reads, put, get, invoice, transaction, overrides,
    run: (body, actor = user) => handleTerminalPayments({ CARD_TERMINAL_PAYMENTS_ENABLED: 'true' }, actor, body, overrides),
    verify: () => verifyTerminalPayment({}, reference, overrides),
    paid() { invoice.status = 'success'; invoice.paid = true; invoice.transactions = [{ id: transaction.id, reference: transaction.reference }]; },
    set failInvoice(value) { failInvoice = value; }, set failCommit(value) { failCommit = value; },
    set fingerprint(value) { currentFingerprint = value; }
  };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: create/send are pending; verified payment commits a balanced receipt and journal once`, async () => {
    const f = fixture({ edition });
    await f.run(input);
    assert.equal(f.get('terminalPaymentRequests', reference).Status, 'Pending');
    assert.equal(f.calls.filter(([path]) => path === '/paymentrequest')[0][1].send_notification, false);
    await f.run({ action: 'send', requestId: reference });
    assert.equal(f.get('terminalPaymentRequests', reference).Status, 'Sent');
    assert.equal(f.get('terminalPaymentReceipts', reference), null);
    assert.match((await f.verify()).message, /not confirmed/);
    f.paid();
    const result = await f.verify();
    assert.equal(result.payment.Status, 'Paid');
    const journal = f.get('accountingJournals', result.payment.JournalNo);
    assert.equal(journal.OrganisationEdition, edition);
    assert.equal(journal.Lines.reduce((sum, row) => sum + row.Debit, 0), 1000);
    assert.equal(journal.Lines.reduce((sum, row) => sum + row.Credit, 0), 1000);
    assert.equal(journal.Lines.find(row => row.AccountCode === '1030').Debit, 995);
    assert.equal(journal.Lines.find(row => row.AccountCode === '6060').Debit, 5);
    const before = structuredClone([...f.db]), writeCount = f.writes.length, providerCalls = f.calls.length;
    await f.verify(); await f.run(input); await f.run({ action: 'send', requestId: reference });
    assert.deepEqual([...f.db], before); assert.equal(f.writes.length, writeCount); assert.equal(f.calls.length, providerCalls);
  });
}

test('default-disabled setup, no provider calls or history scan on open', async () => {
  const f = fixture({ enabled: false });
  const result = await f.run({ action: 'settings' });
  assert.equal(result.settings.enabled, false); assert.equal(f.calls.length, 0);
  assert.deepEqual(f.reads, [['paymentTerminalSettings', 'main']]);
  await assert.rejects(f.run(input), /Enable and verify/);
  assert.equal(f.writes.length, 0);
});
test('test payments never create live receipts or journals', async () => {
  const f = fixture({ mode: 'test' }); await f.run(input); f.paid();
  assert.equal((await f.verify()).payment.Status, 'TestPaid');
  assert.equal([...f.db.keys()].some(key => /accountingJournals|terminalPaymentReceipts|accountingAudit/.test(key)), false);
});
test('lost invoice response is not recreated; recovery requires its exact saved identity', async () => {
  const f = fixture(); f.failInvoice = true;
  await assert.rejects(f.run(input), /lost invoice/);
  assert.equal((await f.run(input)).payment.Status, 'Creating');
  assert.equal(f.calls.filter(([path]) => path === '/paymentrequest').length, 1);
  f.invoice.metadata.dynamaxTerminalRequest = 'TERM-00000000-0000-4000-8000-000000000000';
  await assert.rejects(f.run({ action: 'recover', requestId: reference, requestCode: f.invoice.request_code }), /does not match/);
  f.invoice.metadata.dynamaxTerminalRequest = reference;
  assert.equal((await f.run({ action: 'recover', requestId: reference, requestCode: f.invoice.request_code })).payment.Status, 'Pending');
  assert.equal(f.calls.filter(([path]) => path === '/paymentrequest').length, 1);
});
test('concurrent create only creates one provider invoice', async () => {
  const f = fixture(); const results = await Promise.allSettled([f.run(input), f.run(input)]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal(f.calls.filter(([path]) => path === '/paymentrequest').length, 1);
});
test('concurrent webhook and manual check commit once', async () => {
  const f = fixture(); await f.run(input); f.paid();
  const results = await Promise.all([f.verify(), terminalPaymentWebhook({}, { event: 'paymentrequest.success', data: f.invoice }, f.overrides)]);
  assert.ok(results.every(result => result.payment.Status === 'Paid'));
  assert.equal([...f.db.keys()].filter(key => key.startsWith('accountingJournals/')).length, 1);
  assert.equal(f.writes.filter(batch => batch.some(item => item.collectionPath === 'terminalPaymentReceipts')).length, 1);
});
for (const [label, mutate] of [
  ['wrong amount', f => f.invoice.amount++], ['wrong currency', f => f.invoice.currency = 'USD'],
  ['wrong request', f => f.invoice.metadata.dynamaxTerminalRequest = 'another'], ['wrong customer', f => f.invoice.customer = 999],
  ['wrong merchant key', f => f.fingerprint = 'another-merchant'], ['wrong mode', f => f.transaction.domain = 'test'],
  ['failed transaction', f => f.transaction.status = 'failed'], ['missing linked transaction', f => f.invoice.transactions = []],
  ['unconfirmed fees', f => f.transaction.fees = null]
]) test(`${label} cannot produce a receipt`, async () => {
  const f = fixture(); await f.run(input); f.paid(); mutate(f);
  await assert.rejects(f.verify());
  assert.equal(f.get('terminalPaymentReceipts', reference), null);
  assert.equal([...f.db.keys()].some(key => key.startsWith('accountingJournals/')), false);
});
test('failed database commit cannot leave an orphan journal or receipt; retry completes', async () => {
  const f = fixture(); await f.run(input); f.paid(); f.failCommit = true;
  await assert.rejects(f.verify());
  assert.equal(f.get('terminalPaymentReceipts', reference), null);
  assert.equal([...f.db.keys()].some(key => key.startsWith('accountingJournals/')), false);
  f.failCommit = false; assert.equal((await f.verify()).payment.Status, 'Paid');
});
test('branch, user and subscription access fail before provider reads', async () => {
  const f = fixture(); await f.run(input); const calls = f.calls.length;
  for (const actor of [
    { ...user, role: 'Teacher' }, { ...user, branchId: 'all' }, { ...user, subscriptionReadOnly: true },
    { ...user, branchAccess: 'selected', assignedBranchIds: [] }, { ...user, branchId: 'other' }
  ]) await assert.rejects(f.run({ action: 'get', requestId: reference }, actor), error => error.status === 403);
  assert.equal(f.calls.length, calls);
});
test('cannot change amount, payer or account while replaying a request', async () => {
  const f = fixture(); await f.run(input);
  for (const changed of [{ amount: 2000 }, { payerName: 'Other' }, { accountCode: '4080' }]) {
    await assert.rejects(f.run({ ...input, ...changed }), /another payment/);
  }
});
test('disabling a terminal blocks dispatch but permits settlement of already paid invoice', async () => {
  const f = fixture(); await f.run(input);
  f.put('paymentTerminalSettings', 'main', { Enabled: false });
  await assert.rejects(f.run({ action: 'send', requestId: reference }), /disabled/);
  f.paid(); assert.equal((await f.verify()).payment.Status, 'Paid');
});
test('only administrator can enable; device ownership, mode and branch claim are checked', async () => {
  const f = fixture({ enabled: false });
  const settings = (await f.run({ action: 'settings' })).settings;
  const save = { action: 'save-settings', terminalId: 'DEVICE1', label: 'Front desk', splitId: '', enabled: true, version: settings.version };
  await assert.rejects(f.run(save, { ...user, role: 'Accounts Officer' }), /administrator/);
  f.put('paymentTerminalClaims', 'DEVICE1', { BranchId: 'other' });
  await assert.rejects(f.run(save), /current branch/);
  f.db.delete('paymentTerminalClaims/DEVICE1');
  assert.equal((await f.run(save)).settings.enabled, true);
  const now = (await f.run({ action: 'settings' })).settings;
  await f.run({ ...save, enabled: false, version: now.version });
  assert.equal(f.get('paymentTerminalClaims', 'DEVICE1'), null);
});
test('history always requires bounded dates and queries only the selected branch', async () => {
  const f = fixture();
  await assert.rejects(f.run({ action: 'history' }), /valid/);
  await assert.rejects(f.run({ action: 'history', dateFrom: '2026-01-01', dateTo: '2026-12-31' }), /31 days/);
  await f.run({ action: 'history', dateFrom: '2026-10-01', dateTo: '2026-10-25' });
  const query = f.reads.at(-1)[1];
  assert.equal(query.limit, 101); assert.equal(query.filters[0].value, 'main|2026-10-01');
  assert.equal(query.filters[1].value, 'main|2026-10-25~');
});
test('unbound POS webhook never enters the generic school payment path', async () => {
  const f = fixture();
  assert.deepEqual(await terminalPaymentWebhook({}, { event: 'charge.success', data: { channel: 'pos' } }, f.overrides), { ok: true, pendingInvoiceVerification: true });
  assert.equal(f.writes.length, 0);
  const source = await readFile(new URL('../functions/api/paystack-webhook.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('if (!await validPaystackSignature') < source.indexOf('const terminalResult = await terminalPaymentWebhook'));
});
test('provider errors do not expose secret/card details and requests use fixed origin', async () => {
  let captured;
  const fetcher = async (...args) => { captured = args; return { ok: false, json: async () => ({ status: false, message: 'secret card number' }) }; };
  await assert.rejects(terminalPaystackRequest({ PAYSTACK_SECRET_KEY: 'sk_test_private' }, '/terminal/ONE', undefined, fetcher), error => {
    assert.doesNotMatch(error.message, /secret card|sk_test/); return error.status === 502;
  });
  assert.equal(captured[0], 'https://api.paystack.co/terminal/ONE');
  assert.ok(captured[1].signal);
  await assert.rejects(terminalPaystackRequest({ PAYSTACK_SECRET_KEY: 'sk_test_private' }, 'https://example.test/', {}, fetcher));
});
test('general-income choices exclude invoiced school fees, stores and contra-revenue', () => {
  const rows = [{ Code: '4000', Type: 'Revenue' }, { Code: '4120', Type: 'Revenue' }, { Code: '4160', Type: 'Revenue', Group: 'Contra Revenue' },
    { Code: '4090', Type: 'Revenue', Name: 'Other income' }, { Code: '4210', Type: 'Revenue', Group: 'Church Revenue', Name: 'Building fund' }];
  assert.deepEqual(terminalIncomeAccounts(rows, 'school').map(row => row.code), ['4090']);
  assert.deepEqual(terminalIncomeAccounts(rows, 'faith').map(row => row.code), ['4090', '4210']);
});

test('closed period is checked before invoice creation and paid records stay recoverable if closed later', async () => {
  const f = fixture();
  const original = f.overrides.journal;
  f.overrides.journal = async () => { throw Object.assign(new Error('Accounting period is closed'), { status: 409 }); };
  await assert.rejects(f.run(input), /closed/);
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
  f.overrides.journal = original; await f.run(input); f.paid();
  f.overrides.journal = async () => { throw Object.assign(new Error('Accounting period is closed'), { status: 409 }); };
  await assert.rejects(f.verify(), /closed/);
  assert.equal(f.get('terminalPaymentRequests', reference).Status, 'Pending');
  f.overrides.journal = original; assert.equal((await f.verify()).payment.Status, 'Paid');
});
test('a recent dispatch lease prevents a second invoice reaching the same terminal', async () => {
  const f = fixture(); await f.run(input);
  f.put('terminalDispatchLocks', 'DEVICE1', { RequestId: 'another', ExpiresAt: Date.now() + 60000 });
  await assert.rejects(f.run({ action: 'send', requestId: reference }), /just sent/);
  assert.equal(f.calls.some(([path]) => path.endsWith('/event')), false);
});
test('historical pages do not repeat records and cannot use another branch cursor', async () => {
  const f = fixture();
  for (let n = 0; n < 205; n++) {
    const suffix = String(n).padStart(4, '0');
    f.put('terminalPaymentRequests', suffix, { RequestId: suffix, BranchId: 'main', BranchDate: 'main|2026-10-25T11:00:00+01:00|' + suffix });
  }
  const body = { action: 'history', dateFrom: '2026-10-25', dateTo: '2026-10-25' };
  const page1 = await f.run(body), page2 = await f.run({ ...body, cursor: page1.nextCursor }), page3 = await f.run({ ...body, cursor: page2.nextCursor });
  assert.equal(page1.payments.length, 100); assert.equal(page2.payments.length, 100); assert.equal(page3.payments.length, 5);
  assert.equal(new Set([...page1.payments, ...page2.payments, ...page3.payments].map(row => row.RequestId)).size, 205);
  assert.equal(page3.nextCursor, '');
  await assert.rejects(f.run({ ...body, cursor: 'other|2026-10-25T11:00:00+01:00|0001' }), /this branch/);
});
test('changed branch settlement configuration stops new invoice creation', async () => {
  const f = fixture(); f.overrides.routing = async () => ({ paystack: { subaccountCode: 'ACCT_new' } });
  await assert.rejects(f.run(input), /settlement changed/);
  assert.equal(f.calls.length, 0);
});
