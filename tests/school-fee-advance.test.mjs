import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { SCHOOL_FEES_ADVANCE_CODE, SCHOOL_FEES_ADVANCE_TYPE, schoolFeeAdvanceAmount, schoolFeeAdvanceItem,
  isSchoolFeeAdvance, requireSchoolFeeAdvanceIntent, settleSchoolFeeAdvance, applyManagedSchoolFeeCredit } from '../functions/lib/school-fee-advance.js';
import * as scopeHelpers from '../functions/lib/school-fee-credit-scope.js';
import { calculateDueSchoolFeeCreditAllocations, calculateAccountFinancialSummary, buildPaymentAccountingJournal,
  buildSchoolInvoiceCreditAutomaticJournal, isSchoolFeeInvoice, normalizeLedger, normalizeInvoice,
  isAvailableSchoolCreditReceipt, managedAdvancePayableInvoices, managedAdvancePriorTermBalance,
  correctedInvoicePaidAmount } from '../functions/api/backend.js';
import { normalizePublicPaymentMethod, withPaystackBranchRouting } from '../functions/lib/direct-bank-transfer.js';

const path = 'schoolBranches/area-1-primary/sections/primary/students';
const student = { __id: 'student-1', __scopePath: path, BranchId: 'area-1-primary', SchoolSection: 'primary',
  AdmissionNo: 'DCA/26/001', ClassName: 'Grade 1', DisplayName: 'Demo Pupil', AcademicSession: '2026/2027', Term: 'First Term' };
const intent = { Reference: 'ADVANCE-DEMO-1', PaymentType: SCHOOL_FEES_ADVANCE_TYPE, FeeCode: SCHOOL_FEES_ADVANCE_CODE,
  StudentScopePath: path, StudentDocumentId: student.__id, BranchId: student.BranchId, SchoolSection: student.SchoolSection,
  AccountRef: student.AdmissionNo, Amount: 120000, Currency: 'NGN', PaymentMethod: 'Paystack', ParentEmail: 'parent@example.org' };
const settled = { Reference: intent.Reference, RequestedAmount: 120000, GrossAmount: 120000, NetAmount: 119000,
  GatewayFee: 1000, Currency: 'NGN', Gateway: 'Paystack', Method: 'Online', PaidAt: '2026-11-10T10:00:00Z' };
const invoice = (id, amount, date = '2026-11-01', changes = {}) => ({ InvoiceId: id, AccountRef: student.AdmissionNo,
  BranchId: student.BranchId, SchoolSection: student.SchoolSection, FeeCode: 'TUITION', FeeName: 'Tuition', FeeCategory: 'School Fee',
  Debit: amount, Amount: amount, Credit: 0, DueDate: date, Date: '2026-11-01', Currency: 'NGN', ...changes });

function fixture(initialInvoices = []) {
  const records = new Map(), reads = [], commits = [];
  let revision = 0, conflict = false;
  function put(collection, id, value) { records.set(`${collection}/${id}`, { ...structuredClone(value), __id: id,
    __name: `${collection}/${id}`, __updateTime: `rev-${++revision}` }); }
  put(path, student.__id, student); put('paymentIntents', intent.Reference, intent);
  for (const row of initialInvoices) put('invoices', row.InvoiceId, row);
  const deps = { ...scopeHelpers, calculateDueSchoolFeeCreditAllocations, calculateAccountFinancialSummary,
    buildPaymentAccountingJournal, buildSchoolInvoiceCreditAutomaticJournal, isSchoolFeeInvoice,
    normalizeLedger, normalizeInvoice, isAvailableSchoolCreditReceipt,
    now: () => '2026-11-10T10:00:00.000Z', accountingPeriodIsClosed: async () => false,
    getDocument: async (_env, collection, id) => { reads.push([collection, id]); return structuredClone(records.get(`${collection}/${id}`) || null); },
    queryCollectionPages: async (_env, collection) => { reads.push([collection, 'query']); return [...records.entries()]
      .filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => structuredClone(row)); },
    batchCommitDocuments: async (_env, writes) => {
      if (conflict) { conflict = false; throw Object.assign(new Error('Concurrent change'), { status: 409 }); }
      for (const write of writes) {
        const current = records.get(`${write.collectionPath}/${write.documentId}`);
        if ((write.exists === false && current) || (write.updateTime && current?.__updateTime !== write.updateTime)) throw Object.assign(new Error('Revision conflict'), { status: 409 });
      }
      commits.push(structuredClone(writes));
      for (const write of writes) {
        const current = records.get(`${write.collectionPath}/${write.documentId}`);
        put(write.collectionPath, write.documentId, write.updateMask ? { ...current, ...write.data } : write.data);
      }
    }
  };
  return { records, reads, commits, deps, put, conflict: () => { conflict = true; },
    savedIntent: () => structuredClone(records.get(`paymentIntents/${intent.Reference}`)),
    settle: (input = settled) => settleSchoolFeeAdvance({}, structuredClone(records.get(`paymentIntents/${intent.Reference}`)), input, deps) };
}

test('advance amount has no invoice-balance cap but rejects invalid cents and unsafe integers', () => {
  for (const amount of ['0.01', '500', '25000000.25']) assert.equal(schoolFeeAdvanceAmount(amount), Number(amount));
  for (const amount of ['', 0, -1, '1.001', 'NaN', '1e3', '1,5', '90071992547410.00']) assert.throws(() => schoolFeeAdvanceAmount(amount));
});

test('verified deposit, oldest due fees and residual credit commit atomically without changing the wallet or future invoice', async () => {
  const f = fixture([invoice('old', 50000), invoice('future', 80000, '2027-01-10'), invoice('foreign', 90000, '2026-01-01', { BranchId: 'main' })]);
  f.put('ledger', 'wallet', { AccountRef: student.AdmissionNo, BranchId: student.BranchId, SchoolSection: 'primary',
    FeeCategory: 'Wallet', FeeCode: 'WALLET_TOPUP', Credit: 5000, Debit: 0 });
  const beforeFuture = structuredClone(f.records.get('invoices/future')), beforeForeign = structuredClone(f.records.get('invoices/foreign'));
  const result = await f.settle();
  assert.equal(result.payment.Amount, 119000); assert.equal(result.creditRemaining, 69000);
  assert.equal(f.commits.length, 1); assert.equal(f.records.get('invoices/old').Credit, 50000);
  assert.deepEqual(f.records.get('invoices/future'), beforeFuture); assert.deepEqual(f.records.get('invoices/foreign'), beforeForeign);
  const summary = [...f.records.values()].find(row => row.SchoolFeeCreditManaged);
  assert.equal(summary.WalletBalance, 5000); assert.equal(summary.PendingSchoolFeeCredit, 69000);
  assert.equal(summary.NextSchoolFeeCreditDueDate, '2027-01-10');
  assert.equal(f.records.get(`accountingJournals/SYS-PAY-${intent.Reference}`).Lines[1].AccountCode, '2310');
  assert.equal(f.commits[0].filter(row => row.collectionPath === 'payments').length, 1);
  const prior = JSON.stringify([...f.records]); f.reads.length = 0;
  assert.equal((await f.settle()).duplicate, true); assert.equal(f.commits.length, 1);
  assert.equal(JSON.stringify([...f.records]), prior); assert.deepEqual(f.reads, [['payments', intent.Reference]]);
});

test('advance before any invoice remains credit and settles future invoices only when due, once', async () => {
  const f = fixture(); await f.settle();
  f.put('invoices', 'future', invoice('future', 80000, '2027-01-10'));
  const currentStudent = () => structuredClone(f.records.get(`${path}/${student.__id}`));
  const early = await applyManagedSchoolFeeCredit({}, currentStudent(), f.deps, { today: '2027-01-09' });
  assert.equal(early.allocations.length, 0); assert.equal(f.records.get('invoices/future').Credit, 0);
  const result = await applyManagedSchoolFeeCredit({}, currentStudent(), f.deps, { today: '2027-01-10' });
  assert.equal(result.allocations.length, 1); assert.equal(result.remaining, 39000);
  const count = f.commits.length, before = JSON.stringify([...f.records]);
  assert.equal((await applyManagedSchoolFeeCredit({}, currentStudent(), f.deps, { today: '2027-01-10' })).allocations.length, 0);
  assert.equal(f.commits.length, count); assert.equal(JSON.stringify([...f.records]), before);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('payments/')).length, 1);
});

test('an atomic conflict creates no receipt, allocation, ledger or partial credit and original reference can retry', async () => {
  const f = fixture([invoice('due', 50000)]), before = JSON.stringify([...f.records]);
  f.conflict(); await assert.rejects(f.settle(), /Concurrent change/);
  assert.equal(JSON.stringify([...f.records]), before); assert.equal(f.commits.length, 0);
  await f.settle(); assert.equal(f.commits.length, 1);
});

test('settlement validates stored reference, amount, currency, route and canonical student ownership', async () => {
  for (const changes of [{ Currency: 'USD' }, { Reference: 'different' }, { RequestedAmount: 119999 },
    { Gateway: 'Direct Bank Transfer' }, { NetAmount: 119001 }]) {
    const f = fixture(); await assert.rejects(f.settle({ ...settled, ...changes })); assert.equal(f.commits.length, 0);
  }
  const f = fixture(); f.put(path, student.__id, { ...student, BranchId: 'main' });
  await assert.rejects(f.settle(), /scope|branch/i); assert.equal(f.commits.length, 0);
  assert.throws(() => requireSchoolFeeAdvanceIntent({ ...intent, StudentScopePath: 'schoolBranches/main/sections/primary/students' }, settled));
});

test('approved direct transfer records exactly its verified amount without gateway deductions', async () => {
  const f = fixture(); f.put('paymentIntents', intent.Reference, { ...intent, PaymentMethod: 'Direct Bank Transfer' });
  const transfer = { ...settled, Gateway: 'Direct Bank Transfer', Method: 'Bank Transfer', NetAmount: 120000, GatewayFee: 0 };
  assert.equal((await f.settle(transfer)).creditRemaining, 120000);
  assert.equal((await f.settle(transfer)).duplicate, true);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('paymentGatewayCharges/')).length, 0);
});

test('checkout accepts advances above all balances through both payment routes and requests identity only', async () => {
  const source = await readFile(new URL('../functions/api/init-payment.js', import.meta.url), 'utf8');
  for (const paymentMethod of ['paystack', 'direct_bank_transfer']) {
    const calls = { intents: [], gateway: [], transfers: [], lookup: [] };
    const account = { ...student, AccountRef: student.AdmissionNo, ApplicationReference: 'LONG-'.repeat(80),
      ScopePath: path, StudentDocumentId: student.__id, BillingSource: 'Students' };
    const handler = vm.runInNewContext(`${source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '')}\n;onRequestPost`, {
      Response, URL, Date, crypto, SCHOOL_FEES_ADVANCE_CODE, SCHOOL_FEES_ADVANCE_TYPE, schoolFeeAdvanceItem,
      SCHOOL_FEES_TOTAL_CODE: 'SCHOOL_FEES_TOTAL', normalizePublicPaymentMethod, withPaystackBranchRouting,
      readJsonBody: request => request.json(), readParentSession: async () => ({ email: 'parent@example.org' }),
      verifyTurnstile: async () => {}, requireFirestoreEnv: () => {},
      getPayableFees: async (_env, body) => { calls.lookup.push(body); return { ok: true, account, fees: [], schoolFeeBreakdown: [] }; },
      beginIdempotentRequest: async () => ({ owner: true }), completeIdempotentRequest: async () => {}, failIdempotentRequest: async () => {},
      getSchoolCode: async () => 'DEMO', branchPaymentConfiguration: async () => ({ online: { enabled: true }, paystack: {} }),
      createDocumentIfAbsent: async (_env, _collection, _id, document) => { calls.intents.push(document); return { created: true }; },
      createDirectTransferRequest: async (_env, payload) => { calls.transfers.push(payload); return { ok: true }; },
      fetch: async (_url, init) => { calls.gateway.push(JSON.parse(init.body)); return Response.json({ status: true, data: { authorization_url: 'https://checkout.example/test' } }); }
    });
    const response = await handler({ env: { PAYSTACK_SECRET_KEY: 'test' }, request: new Request('https://school.example/api/init-payment', {
      method: 'POST', body: JSON.stringify({ feeCode: SCHOOL_FEES_ADVANCE_CODE, amount: 5000000, paymentMethod,
        accountRef: student.AdmissionNo, scopePath: path, sourceType: 'Student', idempotencyKey: 'one-advance' })
    }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(calls.lookup[0].AccountOnly, true); assert.equal(calls.lookup[0].IncludeSchoolFeePaymentPlan, false);
    assert.equal(calls.intents[0].Amount, 5000000); assert.equal(calls.intents[0].StudentScopePath, path);
    assert.equal(calls.intents[0].PaymentType, SCHOOL_FEES_ADVANCE_TYPE);
    assert.match(calls.intents[0].Reference, /^DEMO-SCHOOL_FEES_ADVANCE-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const metadata = paymentMethod === 'paystack' ? calls.gateway[0].metadata : calls.transfers[0].payload;
    assert.equal(metadata.paymentType || metadata.PaymentType, SCHOOL_FEES_ADVANCE_TYPE);
    assert.equal((metadata.feeItems || metadata.FeeItems || []).length, 0);
  }
});

test('Paystack verify handler dispatches saved advance identity to atomic settlement and repeated callback makes no financial writes', async () => {
  const source = await readFile(new URL('../functions/api/verify-payment.js', import.meta.url), 'utf8');
  const f = fixture([invoice('due', 50000)]), settlements = [];
  const handler = vm.runInNewContext(`${source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '')}\n;onRequestPost`, {
    Response, URL, Date, isSchoolFeeAdvance,
    paymentIntentType: row => row?.PaymentType || '', paymentIntentReference: row => row?.Reference || '',
    readJsonBody: request => request.json(), getDocument: f.deps.getDocument,
    beginIdempotentRequest: async () => ({ owner: true }), completeIdempotentRequest: async () => {}, failIdempotentRequest: async () => {},
    recordManualPayment: () => { throw new Error('Advance must not use generic recorder'); },
    recordSchoolFeeAdvance: async (env, stored, proof) => { settlements.push({ stored, proof }); return settleSchoolFeeAdvance(env, stored, proof, f.deps); },
    fetch: async () => Response.json({ status: true, data: { status: 'success', reference: intent.Reference, amount: 12000000,
      requested_amount: 12000000, fees: 100000, currency: 'NGN', paid_at: settled.PaidAt, metadata: {
        paymentType: SCHOOL_FEES_ADVANCE_TYPE, feeCode: SCHOOL_FEES_ADVANCE_CODE, accountRef: intent.AccountRef,
        branchId: 'main', schoolSection: 'secondary', feeItems: [{ FeeCategory: 'Books', FeeCode: 'BOGUS', Amount: 120000 }]
      } } })
  });
  const run = () => handler({ env: { PAYSTACK_SECRET_KEY: 'test', FIREBASE_PROJECT_ID: 'test', FIREBASE_CLIENT_EMAIL: 'test', FIREBASE_PRIVATE_KEY: 'test' },
    request: new Request('https://school.example/api/verify-payment', { method: 'POST', body: JSON.stringify({ reference: intent.Reference }) }) });
  const first = await run(); assert.equal(first.status, 200, JSON.stringify(await first.json()));
  assert.equal(settlements[0].stored.BranchId, 'area-1-primary'); assert.equal(f.commits.length, 1);
  const before = JSON.stringify([...f.records]); assert.equal((await run()).status, 200);
  assert.equal(f.commits.length, 1); assert.equal(JSON.stringify([...f.records]), before);
  assert.ok(![...f.records.keys()].some(key => /Orders/.test(key)));
});

test('direct transfer approval dispatcher uses saved advance intent and never creates generic receipts or store orders', async () => {
  const source = await readFile(new URL('../functions/api/staff-direct-transfers.js', import.meta.url), 'utf8');
  const declaration = source.slice(source.indexOf('async function approveSchoolPayment('), source.indexOf('async function deliverSchoolPaymentReceipt('));
  const f = fixture(); f.put('paymentIntents', intent.Reference, { ...intent, PaymentMethod: 'Direct Bank Transfer' });
  const approve = vm.runInNewContext(`${declaration}\napproveSchoolPayment`, { Date, isSchoolFeeAdvance,
    clean: value => String(value ?? '').trim(), safeId: value => value, getDocument: f.deps.getDocument,
    error: (message, status) => Object.assign(new Error(message), { status }),
    recordSchoolFeeAdvance: (env, stored, proof) => settleSchoolFeeAdvance(env, stored, proof, f.deps),
    recordManualPayment: () => { throw new Error('Advance must not use generic recorder'); }
  });
  const transfer = { Reference: intent.Reference, BranchId: intent.BranchId, Amount: 120000, Currency: 'NGN', BankReference: 'BANK-EXAMPLE',
    Payload: { FeeCode: SCHOOL_FEES_ADVANCE_CODE, AccountRef: 'untrusted-body', StoreCart: [{ Amount: 999 }] } };
  const result = await approve({}, transfer, { username: 'accounts' });
  assert.equal(result.recorded.payment.AccountRef, student.AdmissionNo); assert.equal(result.recorded.payment.Amount, 120000);
  assert.equal(result.orders.length, 0); assert.equal((await approve({}, transfer, { username: 'accounts' })).recorded.duplicate, true);
  assert.equal(f.commits.length, 1);
});

test('a competing student revision prevents allocation using stale credit history', async () => {
  const f = fixture([invoice('due', 50000)]), originalRead = f.deps.queryCollectionPages;
  let changed = false;
  f.deps.queryCollectionPages = async (...args) => {
    const rows = await originalRead(...args);
    if (!changed) { changed = true; f.put(path, student.__id, { ...student, WalletLastPurchaseNo: 'CORRECTION-1' }); }
    return rows;
  };
  await assert.rejects(f.settle(), /Revision conflict/);
  assert.equal(f.commits.length, 0); assert.equal(f.records.get('invoices/due').Credit, 0);
  assert.ok(!f.records.has(`payments/${intent.Reference}`));
});

test('verified customer-fee gross-up credits the settled net once', async () => {
  const f = fixture();
  const result = await f.settle({ ...settled, GrossAmount: 121000, GatewayFee: 1000, NetAmount: 120000 });
  assert.equal(result.creditRemaining, 120000);
  assert.equal(result.payment.GrossAmount, 121000);
  assert.equal(result.payment.Amount, 120000);
});

test('an existing allocation deficit holds new verified money without changing old invoices or recreating payments', async () => {
  const f = fixture([invoice('legacy', 50000, '2026-01-01', { Credit: 50000, Status: 'Paid' }), invoice('due', 25000)]);
  const beforeInvoice = structuredClone(f.records.get('invoices/legacy'));
  const result = await f.settle();
  assert.equal(result.creditAllocationDeferred, true);
  assert.equal(result.allocations, 0);
  assert.deepEqual(f.records.get('invoices/legacy'), beforeInvoice);
  assert.equal(f.records.get('invoices/due').Credit, 0);
  assert.equal(f.records.get(`payments/${intent.Reference}`).Amount, 119000);
  const summary = [...f.records.values()].find(row => row.SchoolFeeCreditManaged);
  assert.equal(summary.SchoolFeeCreditReviewRequired, true);
  const before = JSON.stringify([...f.records]);
  const held = await applyManagedSchoolFeeCredit({}, f.records.get(`${path}/${student.__id}`), f.deps);
  assert.equal(held.held, true); assert.equal(JSON.stringify([...f.records]), before);
});

test('explicit billing review holds both new advances and scheduled allocation until reviewed', async () => {
  const f = fixture([invoice('due', 50000)]);
  f.put(path, student.__id, { ...student, requiresReview: true, reviewWarning: 'Conflicting tuition' });
  const settledResult = await f.settle();
  assert.equal(settledResult.creditAllocationDeferred, true);
  assert.equal(settledResult.creditRemaining, 119000); assert.equal(f.records.get('invoices/due').Credit, 0);
  const firstCount = f.commits.length;
  await applyManagedSchoolFeeCredit({}, f.records.get(`${path}/${student.__id}`), f.deps);
  assert.equal(f.commits.length, firstCount);
  const summary = [...f.records.values()].find(row => row.SchoolFeeCreditManaged);
  f.put(path, student.__id, student);
  f.put('accountSummaries', summary.__id, { ...summary, SchoolFeeCreditReviewRequired: false, SchoolFeeCreditReviewReason: '' });
  const applied = await applyManagedSchoolFeeCredit({}, f.records.get(`${path}/${student.__id}`), f.deps);
  assert.equal(applied.allocations.length, 1); assert.equal(f.records.get('invoices/due').Credit, 50000);
});

test('payable fee components use saved partial invoice allocations without spending future advance credit in the view', async () => {
  const f = fixture([invoice('due', 150000), invoice('future', 80000, '2027-01-10')]);
  await f.settle();
  const invoices = [...f.records.entries()].filter(([key]) => key.startsWith('invoices/')).map(([, row]) => row);
  const ledger = [...f.records.entries()].filter(([key]) => key.startsWith('ledger/')).map(([, row]) => row);
  const payable = managedAdvancePayableInvoices(student, invoices, ledger);
  assert.equal(payable.find(row => row.InvoiceId === 'due').Credit, 119000);
  assert.equal(payable.find(row => row.InvoiceId === 'future').Credit, 0);
  assert.equal(correctedInvoicePaidAmount(payable.filter(row => row.InvoiceId === 'due'), invoices[0]), 119000);
  assert.equal(managedAdvancePayableInvoices({ ...student, __id: 'other' }, invoices, ledger), null);
  assert.equal(managedAdvancePayableInvoices({ ...student, __scopePath: 'schoolBranches/main/sections/primary/students' }, invoices, ledger), null);
});

test('a current-term advance that paid a previous-term invoice does not present that bill again', () => {
  const invoices = [invoice('old-paid', 50000, '2026-09-01', { Credit: 50000, Term: 'First Term', AcademicSession: '2026/2027' }),
    invoice('old-part', 70000, '2026-09-01', { Credit: 40000, Term: 'First Term', AcademicSession: '2026/2027' }),
    invoice('current', 80000, '2027-01-10', { Term: 'Second Term', AcademicSession: '2026/2027' })];
  assert.equal(managedAdvancePriorTermBalance(invoices, { Term: 'Second Term', AcademicSession: '2026/2027' }), 30000);
  assert.equal(managedAdvancePriorTermBalance(invoices, { Term: 'First Term', AcademicSession: '2026/2027' }), 0);
});

test('allocation keeps imported invoice aliases consistent so retries cannot allocate twice', async () => {
  const f = fixture([invoice('imported', 150000, '2026-01-01', { paidAmount: 0, PaidAmount: 0, balanceAmount: 150000,
    BalanceAmount: 150000, status: 'Unpaid' })]);
  await f.settle();
  const saved = f.records.get('invoices/imported');
  assert.equal(saved.Credit, 119000); assert.equal(saved.paidAmount, 119000); assert.equal(saved.PaidAmount, 119000);
  assert.equal(saved.Balance, 31000); assert.equal(saved.balanceAmount, 31000); assert.equal(saved.BalanceAmount, 31000);
  assert.equal(saved.status, 'Part Paid');
  const before = JSON.stringify([...f.records]);
  await applyManagedSchoolFeeCredit({}, f.records.get(`${path}/${student.__id}`), f.deps);
  assert.equal(JSON.stringify([...f.records]), before);
});
