import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as mutationGuards from '../functions/lib/accounting-mutation-guards.js';
import { continueRevenueSync, revenueSyncWrite, revenueSyncReader } from '../functions/lib/accounting-revenue-sync.js';
import { accountingSyncRelated, planRevenueSyncRow, prepareRevenueSyncPage } from '../functions/api/backend.js';
import { buildStructuredQuery } from '../functions/lib/firestore.js';

const scope = { actor: 'accounts', edition: 'school', branchId: 'main' };
const target = { stage: 'invoices', collection: 'invoices' };
const source = (id, data = {}) => ({ __id: id, __name: `projects/test/databases/(default)/documents/invoices/${id}`,
  __updateTime: `v-${id}`, InvoiceId: id, Amount: 100, BranchId: 'main', ...data });
function store(count = 1, hooks = {}) {
  const documents = new Map();
  const commits = [], queries = [];
  let version = 0;
  const db = {
    getDocument: async (_env, collection, id) => structuredClone(documents.get(`${collection}/${id}`) || null),
    createDocumentIfAbsent: async (_env, collection, id, data) => {
      const key = `${collection}/${id}`;
      if (!documents.has(key)) documents.set(key, { ...structuredClone(data), __updateTime: `v${++version}` });
    },
    queryCollection: async (_env, collection, options) => {
      queries.push({ collection, options });
      const start = options.startAfterName ? Number(options.startAfterName.split('/').at(-1)) + 1 : 0;
      return Array.from({ length: Math.min(options.limit, Math.max(0, count - start)) }, (_, index) => source(String(start + index).padStart(6, '0')));
    },
    batchCommitLiteralDocuments: async (_env, writes) => {
      for (const write of writes) {
        const current = documents.get(`${write.collectionPath}/${write.documentId}`);
        if (write.exists === false && current || write.updateTime && current?.__updateTime !== write.updateTime) throw Object.assign(new Error('Concurrent write'), { status: 409 });
      }
      for (const write of writes) documents.set(`${write.collectionPath}/${write.documentId}`, { ...structuredClone(write.data), __updateTime: `v${++version}` });
      commits.push(structuredClone(writes));
    }
  };
  const handlers = { prepare: async () => [target], planRow: async () => ({ writes: [] }), ...hooks };
  const call = body => continueRevenueSync({}, { SyncVersion: 1, ...body }, scope, handlers, db);
  return { db, documents, commits, queries, handlers, call };
}

test('more than forty thousand invoice rows complete through bounded requests, not a forty-page full scan', async () => {
  const fixture = store(40_051);
  let state = await fixture.call({});
  assert.equal(state.complete, false);
  while (!state.complete) state = await fixture.call({ RunId: state.runId, Step: state.step });
  assert.equal(state.processed, 40_051);
  assert.equal(state.created, 0);
  assert.ok(fixture.queries.length > 40);
  assert.ok(fixture.queries.every(row => row.options.limit <= 50 && row.options.orderBy[0].field === '__name__'));
});

test('financial posting and cursor commit together; replay after a lost response does not repost', async () => {
  const fixture = store(2, { planRow: async (_target, row) => ({ changes: 1, expensive: true,
    writes: [revenueSyncWrite('accountingJournals', `J-${row.__id}`, { Status: 'Posted' })] }) });
  const start = await fixture.call({});
  const payload = { RunId: start.runId, Step: start.step };
  const next = await fixture.call(payload);
  assert.equal(next.created, 1);
  assert.deepEqual(fixture.commits[0].map(row => row.collectionPath), ['accountingJournals', 'accountingRevenueSyncRuns']);
  assert.deepEqual(await fixture.call(payload), next);
  assert.equal(fixture.commits.length, 1);
  assert.equal((await fixture.call({})).runId, start.runId, 'starting again resumes unfinished work');
});

test('failed or racing atomic commits leave both financial record and checkpoint unchanged', async () => {
  const fixture = store(1, { planRow: async () => ({ changes: 1, writes: [revenueSyncWrite('accountingJournals', 'J1', {})] }) });
  const start = await fixture.call({});
  const commit = fixture.db.batchCommitLiteralDocuments;
  fixture.db.batchCommitLiteralDocuments = async () => { throw new Error('Network unavailable'); };
  await assert.rejects(fixture.call({ RunId: start.runId, Step: 0 }), /Network unavailable/);
  assert.equal((await fixture.call({})).step, 0);
  assert.equal(fixture.documents.has('accountingJournals/J1'), false);
  fixture.db.batchCommitLiteralDocuments = commit;
  const results = await Promise.allSettled([fixture.call({ RunId: start.runId, Step: 0 }), fixture.call({ RunId: start.runId, Step: 0 })]);
  assert.equal(fixture.commits.length, 1);
  assert.ok(results.some(row => row.status === 'fulfilled'));
  assert.equal((await fixture.call({ RunId: start.runId, Step: 0 })).created, 1);
});

test('old clients, invalid future checkpoints, run IDs and owners fail closed', async () => {
  const fixture = store();
  await assert.rejects(continueRevenueSync({}, {}, scope, fixture.handlers, fixture.db), { status: 426 });
  const start = await fixture.call({});
  for (const bad of [{ RunId: 'other', Step: 0 }, { RunId: start.runId, Step: 99 }, { RunId: start.runId, Step: -1 }]) await assert.rejects(fixture.call(bad));
  await assert.rejects(continueRevenueSync({}, { SyncVersion: 1 }, { ...scope, actor: '' }, fixture.handlers, fixture.db), { status: 403 });
  assert.equal(fixture.commits.length, 0);
});

for (const edition of ['school', 'church', 'organization', 'hotel']) {
  test(`${edition} synchronization ignores other branches and binds continuations to the original scope`, async () => {
    let plans = 0;
    const fixture = store(1, { planRow: async () => { plans++; return { writes: [] }; } });
    fixture.db.queryCollection = async () => [source('1', { BranchId: 'west' })];
    const start = await continueRevenueSync({}, { SyncVersion: 1 }, { ...scope, edition }, fixture.handlers, fixture.db);
    await continueRevenueSync({}, { SyncVersion: 1, RunId: start.runId, Step: 0 }, { ...scope, edition }, fixture.handlers, fixture.db);
    assert.equal(plans, 0);
    await assert.rejects(continueRevenueSync({}, { SyncVersion: 1, RunId: start.runId, Step: 1 }, { ...scope, edition, branchId: 'west' }, fixture.handlers, fixture.db));
  });
}

test('a stalled source cursor and unguarded financial writes do not advance the run', async () => {
  for (const bad of [{ __id: 'x' }, source('x', { __name: '' })]) {
    const fixture = store();
    fixture.db.queryCollection = async () => [bad];
    const start = await fixture.call({});
    await assert.rejects(fixture.call({ RunId: start.runId, Step: 0 }), /cursor stalled/);
    assert.equal(fixture.commits.length, 0);
  }
  const fixture = store(1, { planRow: async () => ({ writes: [{ collectionPath: 'accountingJournals', documentId: 'unsafe' }] }) });
  const start = await fixture.call({});
  await assert.rejects(fixture.call({ RunId: start.runId, Step: 0 }), /concurrency precondition/);
});

function plannerData(initial) {
  const rows = new Map(initial.map(([collection, row]) => [`${collection}/${row.__id}`, structuredClone(row)]));
  const reads = [];
  const options = {
    getDocument: async (_env, collection, id) => { reads.push({ collection, id }); return structuredClone(rows.get(`${collection}/${id}`) || null); },
    listCollection: async (_env, collection) => [...rows.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => structuredClone(row)),
    queryCollection: async (_env, collection, query) => {
      reads.push({ collection, query });
      const filters = query.filters.map(filter => {
        const encoded = buildStructuredQuery(collection, { filters: [filter] }).structuredQuery.where.fieldFilter.value;
        return { field: filter.field, values: encoded.arrayValue.values.map(value => value.stringValue ?? Number(value.integerValue ?? value.doubleValue)) };
      });
      return [...rows.entries()].filter(([key, row]) => key.startsWith(`${collection}/`) && filters.every(filter => filter.values.includes(row[filter.field])))
        .map(([, row]) => structuredClone(row)).slice(0, query.limit);
    },
    prepareJournal: async (_env, journal) => {
      const existing = rows.get(`accountingJournals/${journal.JournalNo}`) || {};
      return { payload: journal, existing };
    }
  };
  return { rows, reads, options };
}

test('long numeric bank references reconcile exactly and recognize existing posted revenue on retry', async () => {
  for (const edition of ['school', 'faith', 'organization']) {
    const reference = '261022020100617512345678';
    const payment = source('P1', { PaymentId: 'P1', Reference: reference, GatewayReference: reference,
      AccountRef: 'TEST/001', FeeCode: 'OTHER', FeeCategory: 'Other', Amount: 100,
      Method: 'Bank Transfer', Status: 'Paid', PaidAt: '2026-10-22T10:00:00Z' });
    const fixture = plannerData([['payments', payment]]);
    const before = structuredClone(payment);
    const target = { stage: 'payments', collection: 'payments' };
    const first = await planRevenueSyncRow({}, target, payment, { ...scope, edition }, new Map(), fixture.options);
    const journal = first.writes.find(write => write.collectionPath === 'accountingJournals');
    assert.ok(journal, 'The unposted receipt has a planned revenue journal');
    assert.equal(journal.data.Reference, reference);
    assert.equal(journal.exists, false);
    assert.equal(journal.data.TotalDebit ?? journal.data.Lines.reduce((sum, line) => sum + line.Debit, 0), 100);
    fixture.rows.set(`accountingJournals/${journal.documentId}`, source(journal.documentId, { ...journal.data, Status: 'Posted' }));
    const saved = JSON.stringify([...fixture.rows]);
    const retry = await planRevenueSyncRow({}, target, payment, { ...scope, edition }, new Map(), fixture.options);
    assert.deepEqual(retry.writes, [], 'The existing exact-reference posting is not duplicated or overwritten');
    assert.equal(JSON.stringify([...fixture.rows]), saved);
    assert.deepEqual(payment, before);
  }
});

test('a failed reference lookup resumes the same checkpoint and commits a posting only once', async () => {
  let failure = true;
  const fixture = store(1, { planRow: async (_target, row) => {
    if (failure) throw Object.assign(new Error('Invalid integer in reference filter'), { status: 400 });
    return { changes: 1, writes: [revenueSyncWrite('accountingJournals', `J-${row.__id}`, { Reference: '261022020100617512345678' })] };
  } });
  const initial = await fixture.call({});
  const request = { RunId: initial.runId, Step: initial.step };
  await assert.rejects(fixture.call(request), /checkpoint was not advanced/);
  const resumed = await fixture.call({});
  assert.equal(resumed.runId, initial.runId);
  assert.equal(resumed.step, initial.step);
  assert.equal(fixture.commits.length, 0);
  failure = false;
  const complete = await fixture.call(request);
  assert.equal(complete.complete, true);
  assert.equal(complete.created, 1);
  assert.deepEqual(await fixture.call(request), complete);
  assert.equal(fixture.commits.length, 1);
});

test('missing invoice journals are planned with balanced lines and an atomic source-version fence', async () => {
  for (const edition of ['school', 'church', 'organization', 'hotel']) {
    const row = source('I1');
    const fixture = plannerData([['invoices', row]]);
    const plan = await planRevenueSyncRow({}, target, row, { ...scope, edition }, new Map(), fixture.options);
    const journal = plan.writes.find(row => row.collectionPath === 'accountingJournals');
    assert.equal(journal.documentId, 'SYS-INV-I1');
    assert.equal(journal.exists, false);
    assert.equal(journal.data.BranchId, 'main');
    assert.equal(journal.data.Lines.reduce((sum, line) => sum + line.Debit - line.Credit, 0), 0);
    const fence = plan.writes.find(row => row.collectionPath === 'invoices');
    assert.equal(fence.updateTime, 'v-I1');
    assert.deepEqual(fence.updateMask, ['AccountingSyncCheckedAt']);
    assert.equal(fence.data.Amount, undefined);
    assert.equal(fixture.rows.get('invoices/I1').Amount, 100);
  }
});

test('posted invoice fast path is read-only; conflicting amount or branch is not silently accepted', async () => {
  const row = source('I1');
  const prior = { JournalNo: 'SYS-INV-I1', SourceId: 'I1', Status: 'Posted', TotalDebit: 100, BranchId: 'main' };
  assert.deepEqual(await planRevenueSyncRow({}, target, row, scope, new Map([[prior.JournalNo, prior]])), { writes: [] });
  for (const bad of [{ TotalDebit: 101 }, { BranchId: 'west' }, { Status: 'Draft' }]) {
    await assert.rejects(planRevenueSyncRow({}, target, row, scope, new Map([[prior.JournalNo, { ...prior, ...bad }]])), /conflicting journal/);
  }
});

test('payment reconciliation loads related invoices without posting those invoices a second time', async () => {
  const payment = source('P1', { PaymentId: 'P1', Reference: 'BANK-1', AccountRef: 'STD/1', FeeCode: 'CLUB', FeeCategory: 'Club', Amount: 100, Method: 'Bank Transfer', Status: 'Paid', AcademicSession: '2026/2027', Term: 'First Term' });
  const invoice = source('I1', { AccountRef: 'STD/1', FeeCode: 'CLUB', FeeCategory: 'Club', AcademicSession: '2026/2027', Term: 'First Term' });
  const fixture = plannerData([['payments', payment], ['invoices', invoice]]);
  const plan = await planRevenueSyncRow({}, { stage: 'payments', collection: 'payments' }, payment, scope, new Map(), fixture.options);
  const journals = plan.writes.filter(row => row.collectionPath === 'accountingJournals');
  assert.equal(journals.length, 1);
  assert.equal(journals[0].documentId, 'SYS-PAY-BANK-1');
  assert.equal(journals[0].data.Lines[1].AccountCode, '1100');
  assert.ok(fixture.reads.filter(row => row.query).every(row => row.query.limit === 201));
  assert.ok(plan.writes.some(row => row.collectionPath === 'payments' && row.updateTime === payment.__updateTime));
});

test('posted receipt conflicts and duplicate posted receipts stop before any writes are committed', async () => {
  const payment = source('P1', { PaymentId: 'P1', Reference: 'BANK-1', Amount: 100, FeeCode: 'CLUB', Method: 'Cash', Status: 'Paid' });
  for (const number of ['SYS-PAY-BANK-1', 'DUPLICATE']) {
    const prior = source(number, { JournalNo: number, Source: 'Fee Payment', SourceId: 'BANK-1', Reference: 'BANK-1', Status: 'Posted', Lines: [{ AccountCode: '1010', Debit: 200 }, { AccountCode: '4070', Credit: 200 }] });
    const fixture = plannerData([['payments', payment], ['accountingJournals', prior]]);
    await assert.rejects(planRevenueSyncRow({}, { stage: 'payments', collection: 'payments' }, payment, scope, new Map(), fixture.options), /finance review/i);
  }
});

test('source branch changes and dependency truncation fail closed before producing a plan', async () => {
  const row = source('I1', { BranchId: 'west' });
  const fixture = plannerData([['invoices', row]]);
  await assert.rejects(planRevenueSyncRow({}, target, row, scope, new Map(), fixture.options), /another branch/);
  await assert.rejects(accountingSyncRelated({}, 'invoices', ['AccountRef'], ['STD/1'], async () => Array.from({ length: 201 }, (_, i) => ({ __id: String(i) }))), /No partial reconciliation/);
  await assert.rejects(accountingSyncRelated({}, 'invoices', ['AccountRef'], ['STD/1'], async () => { throw new Error('Read failed'); }), /Read failed/);
});

test('every stage must finish before the run is complete', async () => {
  const fixture = store(0, { prepare: async () => ['invoices', 'payments', 'invoiceCredits', 'ledger', 'forms', 'donations']
    .map(stage => ({ stage, collection: stage })) });
  let state = await fixture.call({});
  for (let index = 0; index < 6; index++) {
    assert.equal(state.complete, false);
    state = await fixture.call({ RunId: state.runId, Step: state.step });
  }
  assert.equal(state.complete, true);
  assert.equal(state.stage, 'complete');
  assert.equal(fixture.queries.length, 6);
});

test('wallet purchase reconciliation plans a liability journal without changing wallet balances', async () => {
  const row = source('L1', { LedgerNo: 'L1', EntryType: 'Wallet Purchase', Debit: 100, Credit: 0, Reference: 'POS-1', Department: 'Tuck Shop' });
  const fixture = plannerData([['ledger', row]]);
  const plan = await planRevenueSyncRow({}, { stage: 'ledger', collection: 'ledger' }, row, scope, new Map(), fixture.options);
  const journal = plan.writes.find(row => row.collectionPath === 'accountingJournals');
  assert.equal(journal.documentId, 'SYS-WALLET-L1');
  assert.deepEqual(journal.data.Lines.map(line => [line.AccountCode, line.Debit, line.Credit]), [['2200', 100, 0], ['4040', 0, 100]]);
  assert.ok(plan.writes.every(row => row.collectionPath === 'accountingJournals' || row.updateMask?.[0] === 'AccountingSyncCheckedAt'));
  const prior = source(journal.documentId, { ...journal.data, Status: 'Posted' });
  fixture.rows.set(`accountingJournals/${prior.__id}`, prior);
  assert.deepEqual((await planRevenueSyncRow({}, { stage: 'ledger', collection: 'ledger' }, row, scope, new Map(), fixture.options)).writes, []);
});

test('legacy gateway repairs remain bounded and do not post dependent wallet rows', async () => {
  const payment = source('P1', { PaymentId: 'P1', Reference: 'BANK-1', AccountRef: 'STD/1', FeeCode: 'CLUB', FeeCategory: 'Club',
    Amount: 10300, GrossAmount: 10300, NetAmount: 10000, GatewayFee: 300, Method: 'Online', Gateway: 'Paystack', Status: 'Paid', Term: 'First Term' });
  const ledger = source('L1', { LedgerNo: 'L1', Reference: 'BANK-1', Credit: 10300, Term: 'Second Term' });
  const wallet = source('L2', { LedgerNo: 'L2', Reference: 'BANK-1', EntryType: 'Wallet Purchase', Debit: 500 });
  const expense = source('E1', { ExpenseNo: 'E1', Reference: 'BANK-1', Source: 'Paystack', Status: 'Posted' });
  const fixture = plannerData([['payments', payment], ['ledger', ledger], ['ledger', wallet], ['accountingExpenses', expense]]);
  const plan = await planRevenueSyncRow({}, { stage: 'payments', collection: 'payments' }, payment, scope, new Map(), fixture.options);
  assert.equal(plan.writes.find(row => row.collectionPath === 'ledger').data.Credit, 10000);
  assert.equal(plan.writes.find(row => row.collectionPath === 'ledger').updateTime, ledger.__updateTime);
  assert.equal(plan.writes.find(row => row.collectionPath === 'accountingExpenses').data.Status, 'Reclassified');
  assert.equal(plan.writes.find(row => row.collectionPath === 'paymentGatewayCharges').data.NetSettlement, 10000);
  assert.equal(plan.writes.filter(row => row.collectionPath === 'accountingJournals').length, 1);
  assert.equal(fixture.rows.get('ledger/L1').Credit, 10300, 'planning has no side effects');
});

test('legacy receipt reclassification is planned separately, never overwriting its posted receipt', async () => {
  const payment = source('P1', { PaymentId: 'P1', Reference: 'BANK-1', AccountRef: 'STD/1', FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee',
    Amount: 100, Method: 'Bank Transfer', Status: 'Paid', PaymentDate: '2025-09-01' });
  const prior = source('SYS-PAY-BANK-1', { JournalNo: 'SYS-PAY-BANK-1', Source: 'Fee Payment', SourceId: 'BANK-1', Reference: 'BANK-1',
    Status: 'Posted', Date: '2025-09-01', Lines: [{ AccountCode: '1020', Debit: 100, Credit: 0 }, { AccountCode: '1100', Debit: 0, Credit: 100 }] });
  const fixture = plannerData([['payments', payment], ['accountingJournals', prior]]);
  fixture.options.createReclassification = async (_env, journal, _scope, options) => { await options.prepareWrite(journal); return true; };
  const plan = await planRevenueSyncRow({}, { stage: 'payments', collection: 'payments' }, payment, scope, new Map(), fixture.options);
  const journal = plan.writes.find(row => row.collectionPath === 'accountingJournals');
  assert.notEqual(journal.documentId, prior.__id);
  assert.equal(journal.exists, false);
  assert.deepEqual(journal.data.Lines.map(line => [line.AccountCode, line.Debit, line.Credit]), [['1100', 100, 0], ['2310', 0, 100]]);
  assert.equal(fixture.rows.get(`accountingJournals/${prior.__id}`).Lines[1].AccountCode, '1100');
});

test('invoice credit baselines post only the missing amount and reject an existing inconsistent baseline', async () => {
  const row = source('I1', { FeeCategory: 'School Fee', FeeCode: 'SCHOOL_FEES_TOTAL', Credit: 75 });
  const fixture = plannerData([['invoices', row]]);
  const target = { stage: 'invoiceCredits', collection: 'invoices' };
  const plan = await planRevenueSyncRow({}, target, row, scope, new Map(), fixture.options);
  const journal = plan.writes.find(row => row.collectionPath === 'accountingJournals');
  assert.equal(journal.documentId, 'SYS-INVCREDIT-LEGACY-I1');
  assert.deepEqual(journal.data.Lines.map(line => [line.AccountCode, line.Debit, line.Credit]), [['2310', 75, 0], ['1100', 0, 75]]);
  fixture.rows.set(`accountingJournals/${journal.documentId}`, source(journal.documentId, journal.data));
  assert.deepEqual((await planRevenueSyncRow({}, target, row, scope, new Map(), fixture.options)).writes, []);
  fixture.rows.get(`invoices/I1`).Credit = 100;
  await assert.rejects(planRevenueSyncRow({}, target, row, scope, new Map(), fixture.options), /unreconciled parent-credit/);
});

test('form sales plan the existing net-revenue treatment and version-fenced normalization', async () => {
  const row = source('F1', { ReceiptNo: 'F1', PaymentReference: 'FORM-1', AmountPaid: 10300, FormAmount: 10000,
    GrossAmount: 10300, GatewayFee: 300, NetAmount: 10000, PaymentMethod: 'Online', Gateway: 'Paystack' });
  const fixture = plannerData([['formSales', row]]);
  const plan = await planRevenueSyncRow({}, { stage: 'forms', collection: 'formSales' }, row, scope, new Map(), fixture.options);
  const journal = plan.writes.find(row => row.collectionPath === 'accountingJournals');
  assert.equal(journal.documentId, 'SYS-FORM-F1');
  assert.deepEqual(journal.data.Lines.map(line => [line.AccountCode, line.Debit, line.Credit]), [['1030', 10000, 0], ['4010', 0, 10000]]);
  assert.equal(plan.writes.find(row => row.collectionPath === 'paymentGatewayCharges').data.Amount, 300);
});

test('church donation reconciliation uses the configured giving account and preserves original currency amounts', async () => {
  const collection = 'organisationBranches/main/churchDonations';
  const row = source('D1', { DonationId: 'D1', Reference: 'DON-1', Status: 'Paid', PaymentMethod: 'Online', Gateway: 'Paystack',
    Amount: 10000, GrossAmount: 10000, GatewayFee: 100, NetAmount: 9900, GivingTypeId: 'TITHE', Currency: 'NGN' });
  const givingType = source('TITHE', { GivingTypeId: 'TITHE', Name: 'Tithe', RevenueAccountCode: '4140' });
  const fixture = plannerData([[collection, row], ['organisationBranches/main/churchGivingTypes', givingType]]);
  const plan = await planRevenueSyncRow({}, { stage: 'donations', collection, branchId: 'main' }, row, { ...scope, edition: 'church' }, new Map(), fixture.options);
  const journal = plan.writes.find(row => row.collectionPath === 'accountingJournals');
  assert.equal(journal.documentId, 'SYS-DON-DON-1');
  assert.equal(journal.data.Lines.at(-1).AccountCode, '4140');
  assert.equal(journal.data.OriginalGrossAmount, 10000);
  assert.equal(journal.data.TotalDebit, journal.data.TotalCredit);
});

test('prepare-only journal saving retains balance, active-account and closed-period validation without posting', async () => {
  const code = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const body = code.slice(code.indexOf('export async function saveAccountingJournal('), code.indexOf('async function syncRevenueToAccounting(')).replace('export ', '');
  let closed = false;
  const writes = [];
  const save = vm.runInNewContext(`(${body})`, {
    ...mutationGuards,
    clean: value => String(value ?? '').trim(), lower: value => String(value ?? '').trim().toLowerCase(),
    asMoneyNumber: value => Number(value || 0), nowIso: () => '2026-10-11',
    getDocumentByIdOrField: async () => null, accountingWriteBranch: () => 'main',
    accountingPeriodIsClosed: async () => closed, normalizedJournal: value => value,
    getAccountingChartRows: async () => [{ Code: '1010', Active: 'YES' }, { Code: '4000', Active: 'YES' }, { Code: '4010', Active: 'NO' }],
    accountingEditionForRequest: () => 'school', accountingChartForEdition: rows => rows,
    yesNo: value => value, upsertDocument: async (...args) => writes.push(args), writeAccountingAudit: async () => writes.push('audit')
  });
  const journal = { JournalNo: 'TEST', Status: 'Posted', Lines: [{ AccountCode: '1010', Debit: 100, Credit: 0 }, { AccountCode: '4000', Debit: 0, Credit: 100 }] };
  assert.equal((await save({}, journal, true, { prepareOnly: true })).payload.TotalDebit, 100);
  await assert.rejects(save({}, { ...journal, Lines: [{ AccountCode: '1010', Debit: 100, Credit: 0 }, { AccountCode: '4000', Debit: 0, Credit: 90 }] }, true, { prepareOnly: true }), /not balanced/);
  await assert.rejects(save({}, { ...journal, Lines: [{ AccountCode: '1010', Debit: 100, Credit: 0 }, { AccountCode: '4010', Debit: 0, Credit: 100 }] }, true, { prepareOnly: true }), /inactive/);
  closed = true;
  await assert.rejects(save({}, journal, true, { prepareOnly: true }), /period is closed/);
  assert.deepEqual(writes, []);
});

test('sync routes are explicitly authorized, do not collect entire financial histories, and keep receipts before credit baselines', async () => {
  const code = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const sync = code.slice(code.indexOf('async function syncRevenueToAccounting('), code.indexOf('async function saveChartAccount('));
  assert.match(sync, /requireAccountingRole\(body, \['Super Admin', 'Accounts Officer'\]\)/);
  assert.match(sync, /accountingRequestBranch\(body\)/);
  assert.doesNotMatch(sync, /listCollectionForReport|listChurchDonationsForAccounting\(env\)/);
  assert.ok(sync.indexOf("stage: 'payments'") < sync.indexOf("stage: 'invoiceCredits'"));
  assert.match(code, /if \(options.prepareOnly\) return \{ payload, existing \}/);
  assert.match(code, /if \(options.prepareWrite\)/);
});

test('a source changing after planning aborts both its posting and checkpoint', async () => {
  const row = source('000000');
  const data = plannerData([['invoices', row]]);
  const fixture = store(1, { planRow: async (target, raw) => {
    const plan = await planRevenueSyncRow({}, target, raw, scope, new Map(), data.options);
    fixture.documents.set('invoices/000000', { ...row, __updateTime: 'changed-by-another-officer' });
    return plan;
  } });
  fixture.documents.set('invoices/000000', row);
  const start = await fixture.call({});
  await assert.rejects(fixture.call({ RunId: start.runId, Step: 0 }), /Concurrent write/);
  assert.equal(fixture.documents.has('accountingJournals/SYS-INV-000000'), false);
  assert.equal((await fixture.call({})).step, 0);
});

test('legacy lowercase branch fields cannot bypass source or dependency isolation', async () => {
  const fixture = store(1, { planRow: async () => { throw new Error('Must not plan another branch'); } });
  fixture.db.queryCollection = async () => [source('1', { BranchId: '', branchId: 'west' })];
  const start = await fixture.call({});
  await fixture.call({ RunId: start.runId, Step: 0 });
  const row = source('I1', { BranchId: '', branchId: 'west' });
  const data = plannerData([['invoices', row]]);
  await assert.rejects(planRevenueSyncRow({}, target, row, scope, new Map(), data.options), /another branch/);
  const payment = source('P1', { PaymentId: 'P1', Reference: 'BANK-1', Amount: 100, FeeCode: 'CLUB', GatewayFee: 1, Method: 'Online' });
  const charge = source('PAYSTACK-FEE-BANK-1', { ChargeId: 'PAYSTACK-FEE-BANK-1', branchId: 'west', BranchId: '' });
  const dependencies = plannerData([['payments', payment], ['paymentGatewayCharges', charge]]);
  await assert.rejects(planRevenueSyncRow({}, { stage: 'payments', collection: 'payments' }, payment, scope, new Map(), dependencies.options), /another branch/);
});

test('a posted canonical journal with missing business metadata cannot be overwritten', async () => {
  const row = source('I1');
  const fixture = plannerData([['invoices', row]]);
  fixture.options.prepareJournal = async (_env, payload) => ({ payload, existing: { __id: 'SYS-INV-I1', __updateTime: 'v1', Status: 'Posted' } });
  await assert.rejects(planRevenueSyncRow({}, target, row, scope, new Map(), fixture.options), /not an overwrite/);
});

test('related slices deduplicate across fields but stop if their combined result exceeds the bound', async () => {
  const shared = source('shared');
  assert.equal((await accountingSyncRelated({}, 'invoices', ['AccountRef', 'AdmissionNo'], ['S1'], async () => [shared])).length, 1);
  await assert.rejects(accountingSyncRelated({}, 'invoices', ['AccountRef', 'AdmissionNo'], ['S1'], async (_env, _collection, query) =>
    Array.from({ length: 101 }, (_, index) => source(`${query.filters[0].field}-${index}`))), /No partial reconciliation/);
});

test('request-local reader reuses dependencies and caps concurrent database work', async () => {
  let active = 0, peak = 0, calls = 0;
  const database = { getDocument: async (_env, collection, id) => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return { collection, id };
  } };
  const reader = revenueSyncReader(database);
  const reads = Array.from({ length: 30 }, (_, i) => reader.db.getDocument({}, 'invoices', String(i % 15)));
  const results = await Promise.all(reads);
  assert.equal(calls, 15);
  assert.equal(reader.reads, 15);
  assert.equal(peak, 5);
  assert.deepEqual(results[0], results[15]);
  await revenueSyncReader(database).db.getDocument({}, 'invoices', '0');
  assert.equal(calls, 16, 'another request never reuses stale financial data');
});

test('reader releases queued slots after errors and never masks a failed dependency', async () => {
  const reader = revenueSyncReader({ getDocument: async (_env, _collection, id) => {
    if (id === 'bad') throw new Error('Dependency read failed');
    return id;
  } }, 1);
  const results = await Promise.allSettled(['bad', 'ok', 'later'].map(id => reader.db.getDocument({}, 'invoices', id)));
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].value, 'ok');
  assert.equal(results[2].value, 'later');
});

test('unfinished old one-record runs resume in batches without restarting or skipping', async () => {
  const fixture = store(120);
  const start = await fixture.call({});
  const [key, run] = [...fixture.documents.entries()][0];
  fixture.documents.set(key, { ...run, PageSize: 1, Cursor: source('000009').__name, Processed: 10 });
  const next = await fixture.call({ RunId: start.runId, Step: 0 });
  assert.equal(next.runId, start.runId);
  assert.equal(next.processed, 60);
  assert.equal(fixture.queries[0].options.startAfterName, source('000009').__name);
});

test('expensive read-only records share bounded batches; changing records commit before later plans', async () => {
  const fixture = store(10, { prepare: async () => [{ stage: 'payments', collection: 'payments' }],
    planRow: async () => ({ writes: [], expensive: true }) });
  let state = await fixture.call({});
  state = await fixture.call({ RunId: state.runId, Step: state.step });
  assert.equal(state.processed, 2);
  let planned = 0;
  fixture.handlers.planRow = async (_target, row) => { planned++; return {
    writes: [revenueSyncWrite('accountingJournals', row.__id, {})], changes: 1
  }; };
  state = await fixture.call({ RunId: state.runId, Step: state.step });
  assert.equal(planned, 1);
  assert.equal(state.processed, 3);
});

test('planner errors identify the exact stage and record without advancing saved progress', async () => {
  const fixture = store(5, { planRow: async () => { throw Object.assign(new Error('Finance review required'), { status: 409 }); } });
  const start = await fixture.call({});
  await assert.rejects(fixture.call({ RunId: start.runId, Step: 0 }), error =>
    error.status === 409 && /invoices record 000000/.test(error.message) && /checkpoint was not advanced/.test(error.message));
  assert.equal(fixture.commits.length, 0);
  assert.equal((await fixture.call({})).processed, 0);
});

test('fifty reconciled invoice credits need five bounded queries and no per-record lookups', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => source(`I${i}`, {
    FeeCategory: 'School Fee', FeeCode: 'SCHOOL_FEES_TOTAL', Credit: 0
  }));
  const fixture = plannerData(rows.map(row => ['invoices', row]));
  const target = { stage: 'invoiceCredits', collection: 'invoices' };
  const prepared = await prepareRevenueSyncPage({}, target, rows, fixture.options);
  for (const row of rows) assert.deepEqual(await planRevenueSyncRow({}, target, row, scope, prepared), { writes: [] });
  assert.equal(fixture.reads.length, 5);
  assert.ok(fixture.reads.every(read => read.query.filters[0].field === 'SourceId'));
});

test('credit prefetch detects conflicting baselines and falls back on a full dependency page', async () => {
  const row = source('I1', { FeeCategory: 'School Fee', FeeCode: 'SCHOOL_FEES_TOTAL', Credit: 0 });
  const journal = source('J1', { SourceId: 'I1', Source: 'Student Invoice Credit', Status: 'Posted', Lines: [
    { AccountCode: '2310', Debit: 100 }, { AccountCode: '1100', Credit: 100 }
  ] });
  const target = { stage: 'invoiceCredits', collection: 'invoices' };
  const fixture = plannerData([['invoices', row], ['accountingJournals', journal]]);
  const prepared = await prepareRevenueSyncPage({}, target, [row], fixture.options);
  await assert.rejects(planRevenueSyncRow({}, target, row, scope, prepared), /finance review/);
  const full = await prepareRevenueSyncPage({}, target, [row], {
    queryCollection: async () => Array.from({ length: 201 }, () => journal)
  });
  assert.equal(full.creditJournals.has('I1'), false, 'truncated dependencies cannot prove reconciliation');
});

test('irrelevant ledger and credit sources do not make point reads', async () => {
  const options = { getDocument: async () => { throw new Error('Unnecessary lookup'); } };
  assert.deepEqual(await planRevenueSyncRow({}, { stage: 'ledger' }, source('L', { EntryType: 'Payment', Credit: 100 }), scope, new Map(), options), { writes: [] });
  assert.deepEqual(await planRevenueSyncRow({}, { stage: 'invoiceCredits' }, source('I', { FeeCategory: 'Club' }), scope, new Map(), options), { writes: [] });
});


test('one logical revenue run records start and completion atomically, never each batch or replay', async () => {
  const fixture=store(121,{auditWrite:(run,phase)=>({collectionPath:'accountingAudit',documentId:`${run.RunId}-${phase}`,
    exists:false,data:{Phase:phase,Processed:run.Processed}})});
  let state=await fixture.call({});
  const start=state;
  assert.equal([...fixture.documents.keys()].filter(key=>key.startsWith('accountingAudit/')).length,1);
  assert.equal((await fixture.call({})).runId,start.runId);
  while(!state.complete) {
    const payload={RunId:state.runId,Step:state.step};
    state=await fixture.call(payload);
    const commits=fixture.commits.length;
    assert.deepEqual(await fixture.call(payload),state);
    assert.equal(fixture.commits.length,commits);
  }
  const audit=[...fixture.documents].filter(([key])=>key.startsWith('accountingAudit/')).map(([,row])=>row);
  assert.deepEqual(audit.map(row=>row.Phase),['Started','Completed']);
  assert.equal(audit[1].Processed,121);
  assert.ok(fixture.commits.at(-1).some(row=>row.collectionPath==='accountingRevenueSyncRuns' && row.data.Status==='Complete'));
});
