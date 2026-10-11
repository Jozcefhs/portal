import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as guards from '../functions/lib/accounting-mutation-guards.js';
import * as branch from '../functions/lib/accounting-branch-scope.js';
import { accountingChartForEdition } from '../functions/lib/accounting-edition-scope.js';
import { planRevenueSyncRow } from '../functions/api/backend.js';

const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const names = ['asMoneyNumber', 'accountingLines', 'normalizedJournal', 'accountingRoleAllowed', 'requireAccountingRole',
  'accountingDepartment', 'isDepartmentAccountingUser', 'enforceDepartmentSubmission', 'accountingPeriodIsClosed',
  'saveAccountingJournal', 'saveAccountingOpeningBalance', 'saveAccountingSupplierBill', 'payAccountingSupplierBill',
  'saveAccountingAsset', 'postAccountingDepreciation', 'importAccountingBankStatement', 'matchAccountingBankStatement',
  'requireAccountingApprovalLimit', 'saveAccountingApprovalLimit'];
const declarations = [...source.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)];
const code = names.map(name => {
  const index = declarations.findIndex(match => match[1] === name);
  assert.ok(index >= 0, name);
  return source.slice(declarations[index].index, declarations[index + 1]?.index ?? source.length).replace(/^export /m, '');
}).join('\n');

const officer = { UserRole: 'Accounts Officer', UserBranchId: 'main', BranchId: 'main', UserUsername: 'accounts', RecordedBy: 'Accounts' };
const lines = amount => [{ AccountCode: '1020', Debit: amount, Credit: 0 }, { AccountCode: '2000', Debit: 0, Credit: amount }];
function fixture(edition = 'school') {
  const documents = new Map(); let version = 0; let audit = 0;
  const commits = []; const hooks = {};
  const put = (collection, id, data) => documents.set(`${collection}/${id}`, { ...structuredClone(data), __id: id, __updateTime: `v${++version}` });
  const get = (collection, id) => structuredClone(documents.get(`${collection}/${id}`) || null);
  const rows = collection => [...documents].filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => structuredClone(row));
  const ctx = { ...guards, ...branch, accountingChartForEdition,
    clean: value => String(value ?? '').trim(), lower: value => String(value ?? '').trim().toLowerCase(),
    sameText: (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase(),
    yesNo: value => ['yes', 'true', '1'].includes(String(value).toLowerCase()) ? 'YES' : 'NO',
    nowIso: () => '2026-10-11T12:00:00.000Z', safeDocumentId: value => String(value).replaceAll('/', '-'), ledgerDocumentId: prefix => `${prefix}-${++audit}`,
    DEPARTMENT_ACCOUNTING_ROLES: ['Department User', 'Tuck Shop User', 'Clinic User', 'Kitchen User'],
    accountingEditionForRequest: () => edition,
    getAccountingChartRows: async () => ['1020', '1080', '1100', '1110', '1500', '1600', '2000', '3000', '4000', '4090', '6000', '6070', '6090'].map(Code => ({ Code, Active: 'YES' })),
    seedAccountingChart: async () => {},
    getDocument: async (_env, collection, id) => get(collection, id),
    getDocumentByIdOrField: async (_env, collection, id, field) => get(collection, id) || rows(collection).find(row => row[field] === id) || null,
    listCollection: async (_env, collection) => rows(collection),
    queryCollection: async (_env, collection, options) => rows(collection).filter(row => (options.filters || []).every(filter => {
      if (filter.op === '>=') return row[filter.field] >= filter.value;
      if (filter.op === '<=') return row[filter.field] <= filter.value;
      if (filter.op === 'in') return filter.value.includes(row[filter.field]);
      return row[filter.field] === filter.value;
    })).slice(0, options.limit || 1000),
    accountingAuditWrite: (action, entityType, entityId, body, details) => ({ collectionPath: 'accountingAudit', documentId: `AUD-${++audit}`, exists: false,
      data: { Action: action, EntityType: entityType, EntityId: entityId, BranchId: branch.accountingWriteBranch(body), Details: details } }),
    writeAccountingAudit: async (_env, action, entityType, entityId) => put('accountingAudit', `AUD-${++audit}`, { Action: action, EntityType: entityType, EntityId: entityId }),
    upsertDocument: async (_env, collection, id, data) => put(collection, id, data),
    batchCommitLiteralDocuments: async (_env, writes) => {
      if (hooks.beforeCommit) await hooks.beforeCommit(writes);
      if (hooks.fail) throw new Error('Simulated commit failure');
      for (const write of writes) {
        const prior = get(write.collectionPath, write.documentId);
        if ((write.exists === false && prior) || (write.updateTime && prior?.__updateTime !== write.updateTime)) throw guards.financeFailure('Concurrent write', 409, 'FINANCE_WRITE_CONFLICT');
      }
      for (const write of writes) put(write.collectionPath, write.documentId, write.updateMask ? { ...get(write.collectionPath, write.documentId), ...write.data } : write.data);
      commits.push(structuredClone(writes));
    }
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, put, get, rows, commits, hooks };
}

test('strict financial inputs reject silent numeric conversion and invalid dates', () => {
  for (const value of ['1e3', 'oops', 'NaN', Infinity, -1, '1,00', '10.001', true]) assert.throws(() => guards.financeMoney(value));
  assert.equal(guards.financeMoney('₦1,000.50'), 1000.5);
  assert.equal(guards.financeMoney(0), 0);
  assert.equal(guards.financeMoney(0.1 + 0.2), 0.3);
  assert.throws(() => guards.financeMoney(0.301));
  assert.throws(() => guards.financeDate('2026-02-30'));
  assert.throws(() => guards.financeDate('11/10/2026'));
  assert.equal(guards.financeDate('2026-10-11'), '2026-10-11');
  assert.throws(() => guards.financeDate('2026-10-11T12:00:00Z'));
  assert.equal(guards.financeDate('2026-10-11T23:30:00-01:00', 'Date', { allowTimestamp: true }), '2026-10-11');
  assert.throws(() => guards.financeDate('2026-02-30T12:00:00Z', 'Date', { allowTimestamp: true }));
  assert.throws(() => guards.financeDate('2026-10-11T99:00:00Z', 'Date', { allowTimestamp: true }));
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: revenue synchronization prepares ISO-dated invoice journals through the real journal validator`, async () => {
    const f = fixture(edition);
    f.put('invoices', 'INV1', { InvoiceId: 'INV1', Amount: 100, BranchId: 'main', CreatedAt: '2026-10-11T15:20:30.123Z', FeeCategory: 'Tuition', FeeName: 'Invoice' });
    const plan = await planRevenueSyncRow({}, { stage: 'invoices', collection: 'invoices' }, f.get('invoices', 'INV1'), { edition, branchId: 'main' }, new Map(), {
      getDocument: f.ctx.getDocument, listCollection: f.ctx.listCollection, queryCollection: f.ctx.queryCollection, prepareJournal: f.ctx.saveAccountingJournal
    });
    const journal = plan.writes.find(write => write.collectionPath === 'accountingJournals').data;
    assert.equal(journal.Date, '2026-10-11'); assert.equal(journal.TotalDebit, 100); assert.equal(journal.TotalCredit, 100);
    assert.equal(journal.Lines[0].AccountCode, edition === 'school' ? '1100' : '1110');
    assert.equal(f.commits.length, 0);
  });
  test(`${edition}: system timestamp postings preserve their source day and computed cent arithmetic`, async () => {
    const f = fixture(edition);
    const body = { ...officer, JournalNo: 'SYS-ISO', Date: '2026-10-11T23:30:00-01:00', Status: 'Posted', Source: 'Student Invoice', SourceId: 'INV1', Lines: lines(0.1 + 0.2) };
    const journal = await f.ctx.saveAccountingJournal({}, body, true);
    assert.equal(journal.Date, '2026-10-11'); assert.equal(journal.TotalDebit, 0.3);
    await f.ctx.saveAccountingJournal({}, body, true);
    assert.equal(f.commits.length, 1);
    await assert.rejects(f.ctx.saveAccountingJournal({}, { ...body, JournalNo: 'MANUAL-ISO' }), /YYYY-MM-DD/);
    await assert.rejects(f.ctx.saveAccountingJournal({}, { ...body, JournalNo: 'INVALID-ISO', Date: '2026-02-30T12:00:00Z' }, true), /YYYY-MM-DD/);
  });
  test(`${edition}: concurrent stale journal save cannot overwrite a posted journal`, async () => {
    const f = fixture(edition); f.put('accountingJournals', 'J1', { JournalNo: 'J1', Status: 'Draft', BranchId: 'main', Date: '2026-10-11', Lines: lines(100) });
    let release; const gate = new Promise(resolve => { release = resolve; });
    let ready; const held = new Promise(resolve => { ready = resolve; });
    f.hooks.beforeCommit = async writes => { if (writes[0].data.Status === 'Draft') { ready(); await gate; } };
    const edit = f.ctx.saveAccountingJournal({}, { ...officer, JournalNo: 'J1', Date: '2026-10-11', Status: 'Draft', Lines: lines(100) });
    await held;
    await f.ctx.saveAccountingJournal({}, { ...officer, JournalNo: 'J1', Date: '2026-10-11', Status: 'Posted', Lines: lines(100) });
    release(); await assert.rejects(edit, error => error.code === 'FINANCE_WRITE_CONFLICT');
    assert.equal(f.get('accountingJournals', 'J1').Status, 'Posted');
    assert.equal(f.rows('accountingAudit').length, 1);
  });

  test(`${edition}: opening reference is idempotent and conflicting reuse fails`, async () => {
    const f = fixture(edition); const body = { ...officer, Date: '2026-10-11', Reference: 'OPEN-2026', Lines: lines(100) };
    await f.ctx.saveAccountingOpeningBalance({}, body); await f.ctx.saveAccountingOpeningBalance({}, body);
    assert.equal(f.rows('accountingJournals').length, 1);
    await assert.rejects(f.ctx.saveAccountingOpeningBalance({}, { ...body, Lines: lines(200) }), /immutable/);
    assert.equal(f.rows('accountingJournals')[0].TotalDebit, 100);
  });

  test(`${edition}: reversal uses original facts, only posts once, and preserves original`, async () => {
    const f = fixture(edition); const original = { ...officer, JournalNo: 'J1', Date: '2026-10-11', Status: 'Posted', Lines: lines(100) };
    await f.ctx.saveAccountingJournal({}, original);
    const request = { ...officer, ReversalOf: 'J1', JournalNo: 'caller-id', Date: '2026-10-11', Lines: lines(999) };
    const reversal = await f.ctx.saveAccountingJournal({}, request); await f.ctx.saveAccountingJournal({}, request);
    assert.equal(reversal.TotalDebit, 100); assert.equal(reversal.Lines[0].Credit, 100);
    assert.equal(f.rows('accountingJournals').length, 2); assert.equal(f.get('accountingJournals', 'J1').Status, 'Posted');
  });

  test(`${edition}: posted system journals replay exactly but reject changed facts and invalid new postings`, async () => {
    const f = fixture(edition); const body = { ...officer, JournalNo: 'SYS-1', Date: '2026-10-11', Status: 'Posted', Source: 'Test', Lines: lines(100) };
    await f.ctx.saveAccountingJournal({}, body, true);
    f.put('accountingPeriods', 'OCT', { Status: 'Closed', StartDate: '2026-10-01', EndDate: '2026-10-31' });
    await f.ctx.saveAccountingJournal({}, body, true);
    await assert.rejects(f.ctx.saveAccountingJournal({}, { ...body, Lines: lines(101) }, true), /immutable/);
    await assert.rejects(f.ctx.saveAccountingJournal({}, { ...body, JournalNo: 'SYS-2' }, true), /period is closed/);
    assert.equal(f.commits.length, 1);
    await assert.rejects(f.ctx.saveAccountingJournal({}, { ...body, JournalNo: 'SYS-3', Date: '2026-11-01', Lines: lines('1e3') }, true), /valid amount/);
    await assert.rejects(f.ctx.saveAccountingJournal({}, { ...body, JournalNo: 'SYS-4', Date: '2026-11-01', Lines: [{ AccountCode: '9999', Debit: 100 }, { AccountCode: '1020', Credit: 100 }] }, true), /does not exist or is inactive/);
    assert.equal(f.rows('accountingJournals').length, 1);
  });

  test(`${edition}: legacy random-ID reversals prevent a second canonical reversal`, async () => {
    for (const identity of [{ Reference: 'REV-J1' }, { ReversalOf: 'J1' }, { SourceId: 'J1' }]) {
      const f = fixture(edition);
      await f.ctx.saveAccountingJournal({}, { ...officer, JournalNo: 'J1', Date: '2026-10-11', Status: 'Posted', Lines: lines(100) });
      f.put('accountingJournals', 'JRN-LEGACY', { JournalNo: 'JRN-LEGACY', BranchId: 'main', Source: 'Journal Reversal', Status: 'Posted', ...identity });
      await assert.rejects(f.ctx.saveAccountingJournal({}, { ...officer, ReversalOf: 'J1', Date: '2026-10-11' }), /already reversed by JRN-LEGACY/);
      assert.equal(f.rows('accountingJournals').length, 2); assert.equal(f.commits.length, 1);
    }
  });

  test(`${edition}: supplier bill, invoice uniqueness claim and journal commit together and replay safely`, async () => {
    const f = fixture(edition); const body = { ...officer, UserRole: 'Super Admin', BillNo: 'B1', VendorId: 'V1', VendorName: 'Supplier', Amount: 100, Date: '2026-10-11', Description: 'Supplies', InvoiceReference: 'INV1', AccountCode: '6090', Status: 'Posted' };
    f.hooks.fail = true; await assert.rejects(f.ctx.saveAccountingSupplierBill({}, body), /commit failure/);
    assert.equal(f.rows('accountingSupplierBills').length, 0); assert.equal(f.rows('accountingJournals').length, 0); assert.equal(f.rows('accountingSupplierInvoiceClaims').length, 0);
    f.hooks.fail = false; await f.ctx.saveAccountingSupplierBill({}, body); await f.ctx.saveAccountingSupplierBill({}, body);
    assert.equal(f.commits.length, 1); assert.equal(f.rows('accountingJournals').length, 1); assert.equal(f.rows('accountingSupplierInvoiceClaims').length, 1);
    await assert.rejects(f.ctx.saveAccountingSupplierBill({}, { ...body, Amount: 200 }), /immutable/);
    await assert.rejects(f.ctx.saveAccountingSupplierBill({}, { ...body, BillNo: 'B2' }), /already been recorded/);
    assert.equal(f.get('accountingSupplierBills', 'B1').Amount, 100);
  });

  test(`${edition}: concurrent duplicate supplier invoices cannot create two liabilities`, async () => {
    const f = fixture(edition); const body = { ...officer, UserRole: 'Super Admin', VendorId: 'V1', Amount: 100, Date: '2026-10-11', Description: 'Supplies', InvoiceReference: 'INV1', AccountCode: '6090', Status: 'Posted' };
    const results = await Promise.allSettled(['B1', 'B2'].map(BillNo => f.ctx.saveAccountingSupplierBill({}, { ...body, BillNo })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(f.rows('accountingSupplierBills').length, 1); assert.equal(f.rows('accountingJournals').length, 1); assert.equal(f.rows('accountingSupplierInvoiceClaims').length, 1);
  });

  test(`${edition}: supplier payment replay, failure and overpayment remain consistent`, async () => {
    const f = fixture(edition); f.put('accountingSupplierBills', 'B1', { BillNo: 'B1', BranchId: 'main', Status: 'Posted', Amount: 1000, PaidAmount: 0, VendorName: 'Supplier' });
    const body = { ...officer, BillNo: 'B1', PaymentNo: 'P1', Amount: 100, Date: '2026-10-11' };
    f.hooks.fail = true; await assert.rejects(f.ctx.payAccountingSupplierBill({}, body), /commit failure/);
    assert.equal(f.rows('accountingJournals').length, 0); assert.equal(f.get('accountingSupplierBills', 'B1').PaidAmount, 0);
    f.hooks.fail = false; await f.ctx.payAccountingSupplierBill({}, body); await f.ctx.payAccountingSupplierBill({}, body);
    assert.equal(f.get('accountingSupplierBills', 'B1').PaidAmount, 100); assert.equal(f.rows('accountingSupplierPayments').length, 1);
    assert.equal(f.rows('accountingJournals')[0].TotalDebit, 100);
    await assert.rejects(f.ctx.payAccountingSupplierBill({}, { ...body, Amount: 200 }), /different details/);
    await assert.rejects(f.ctx.payAccountingSupplierBill({}, { ...body, PaymentNo: 'P2', Amount: 901 }), /exceed/);
    await assert.rejects(f.ctx.payAccountingSupplierBill({}, { ...body, UserBranchId: 'secondary', BranchId: 'secondary' }), /another branch/);
  });

  test(`${edition}: concurrent supplier payments cannot lose balances or overpay`, async () => {
    const f = fixture(edition); f.put('accountingSupplierBills', 'B1', { BillNo: 'B1', BranchId: 'main', Status: 'Posted', Amount: 100, PaidAmount: 0 });
    const results = await Promise.allSettled(['P1', 'P2'].map(PaymentNo => f.ctx.payAccountingSupplierBill({}, { ...officer, BillNo: 'B1', PaymentNo, Amount: 100, Date: '2026-10-11' })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(f.get('accountingSupplierBills', 'B1').PaidAmount, 100); assert.equal(f.rows('accountingSupplierPayments').length, 1);
    assert.equal(f.rows('accountingJournals').length, 1);
  });

  test(`${edition}: asset acquisition/depreciation commit atomically and financial edits are locked`, async () => {
    const f = fixture(edition); const asset = { ...officer, AssetId: 'A1', Name: 'Printer', Cost: 1000, ResidualValue: 0, UsefulLifeMonths: 10, AcquisitionDate: '2026-10-01', PostAcquisition: 'YES' };
    f.hooks.fail = true; await assert.rejects(f.ctx.saveAccountingAsset({}, asset), /commit failure/);
    assert.equal(f.rows('accountingAssets').length, 0); assert.equal(f.rows('accountingJournals').length, 0);
    f.hooks.fail = false;
    await f.ctx.saveAccountingAsset({}, asset);
    await assert.rejects(f.ctx.saveAccountingAsset({}, { ...asset, Cost: 5000 }), /accounting adjustment/);
    assert.equal(f.get('accountingAssets', 'A1').Cost, 1000); assert.equal(f.get('accountingJournals', 'SYS-AST-A1').TotalDebit, 1000);
    const request = { ...officer, AssetId: 'A1', Date: '2026-10-11' };
    f.hooks.fail = true; await assert.rejects(f.ctx.postAccountingDepreciation({}, request), /commit failure/);
    assert.equal(f.get('accountingAssets', 'A1').AccumulatedDepreciation, 0); assert.equal(f.get('accountingJournals', 'SYS-DEP-A1-202610'), null);
    f.hooks.fail = false; await f.ctx.postAccountingDepreciation({}, request); await f.ctx.postAccountingDepreciation({}, request);
    assert.equal(f.get('accountingAssets', 'A1').AccumulatedDepreciation, 100); assert.equal(f.get('accountingJournals', 'SYS-DEP-A1-202610').TotalDebit, 100);
  });

  test(`${edition}: concurrent depreciation periods preserve the asset balance and excessive explicit amounts fail`, async () => {
    const f = fixture(edition);
    await f.ctx.saveAccountingAsset({}, { ...officer, AssetId: 'A1', Name: 'Printer', Cost: 100, ResidualValue: 0, UsefulLifeMonths: 2, AcquisitionDate: '2026-10-01' });
    await assert.rejects(f.ctx.postAccountingDepreciation({}, { ...officer, AssetId: 'A1', Date: '2026-10-11', Amount: 101 }), /remaining depreciable value/);
    const results = await Promise.allSettled(['2026-10-11', '2026-11-11'].map(Date => f.ctx.postAccountingDepreciation({}, { ...officer, AssetId: 'A1', Date })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(f.get('accountingAssets', 'A1').AccumulatedDepreciation, 50); assert.equal(f.rows('accountingJournals').length, 1);
    const failed = results.findIndex(result => result.status === 'rejected');
    await f.ctx.postAccountingDepreciation({}, { ...officer, AssetId: 'A1', Date: ['2026-10-11', '2026-11-11'][failed] });
    assert.equal(f.get('accountingAssets', 'A1').AccumulatedDepreciation, 100); assert.equal(f.get('accountingAssets', 'A1').NetBookValue, 0);
  });
}

test('visible role limits and individual grants both constrain approvals', async () => {
  const f = fixture(); f.put('staffUsers', 'manager', { Username: 'manager', ApprovalEnabled: 'YES', ApprovalMaxAmount: 1000000, ApprovalAccounts: ['6090'] });
  await f.ctx.saveAccountingApprovalLimit({}, { ...officer, UserRole: 'Super Admin', Role: 'Management', TransactionType: 'Supplier Bill', MaxAmount: 100, Active: 'YES' });
  const actor = { UserRole: 'Management', UserUsername: 'manager', AccountCode: '6090' };
  await assert.rejects(f.ctx.requireAccountingApprovalLimit({}, actor, 'Supplier Bill', 500000), /configured approval limit/);
  await f.ctx.requireAccountingApprovalLimit({}, actor, 'Supplier Bill', 100);
  await assert.rejects(f.ctx.requireAccountingApprovalLimit({}, { ...actor, AccountCode: '6000' }, 'Supplier Bill', 100), /administrator-granted/);
});

test('explicit saved role limits supersede seeded defaults and disabled policies still deny Super Admin', () => {
  const legacy = { Role: 'Management', TransactionType: 'Supplier Bill', MaxAmount: 100, Active: 'YES', __id: 'management|supplier_bill' };
  const explicit = { ...legacy, __id: 'Management-Supplier_Bill', MaxAmount: 500, PolicyVersion: 2 };
  assert.doesNotThrow(() => guards.assertFinanceRoleLimit([legacy, explicit], 'Management', 'Supplier Bill', 500));
  assert.throws(() => guards.assertFinanceRoleLimit([legacy, explicit], 'Management', 'Supplier Bill', 501), /configured approval limit/);
  assert.throws(() => guards.assertFinanceRoleLimit([{ Role: 'Super Admin', TransactionType: 'Expense', Active: 'NO', MaxAmount: 1000 }], 'Super Admin', 'Expense', 1), /configured approval limit/);
});

test('bank import does not assign one cash movement to two rows; continuation and replay are safe', async () => {
  const f = fixture(); f.put('accountingBanks', 'BANK', { BankId: 'BANK', BranchId: 'main', AccountCode: '1020' });
  f.put('accountingJournals', 'J1', { JournalNo: 'J1', BranchId: 'main', Status: 'Posted', Date: '2026-10-11', Lines: lines(100) });
  const body = { ...officer, BankId: 'BANK', Rows: Array.from({ length: 16 }, () => ({ Date: '2026-10-11', Credit: 100 })) };
  const first = await f.ctx.importAccountingBankStatement({}, body); assert.equal(first.imported, 10); assert.equal(first.matched, 0); assert.equal(first.progress.nextCursor, 10);
  const final = await f.ctx.importAccountingBankStatement({}, { ...body, Cursor: 10 }); assert.equal(final.imported, 6); assert.equal(final.progress.complete, true);
  const retry = await f.ctx.importAccountingBankStatement({}, body); assert.equal(retry.imported, 0); assert.equal(retry.skipped, 10);
  assert.equal(f.rows('accountingBankStatementItems').length, 16);
});

test('manual matching requires a posted journal and exclusively claims its cash movement', async () => {
  const f = fixture(); for (const id of ['S1', 'S2']) f.put('accountingBankStatementItems', id, { StatementItemId: id, BranchId: 'main', AccountCode: '1020', Amount: 100 });
  f.put('accountingJournals', 'J1', { JournalNo: 'J1', BranchId: 'main', Status: 'Draft', Lines: lines(100) });
  const body = { ...officer, StatementItemId: 'S1', JournalNo: 'J1' };
  await assert.rejects(f.ctx.matchAccountingBankStatement({}, body), /Only a posted journal/);
  f.put('accountingJournals', 'J1', { ...f.get('accountingJournals', 'J1'), Status: 'Posted' });
  const results = await Promise.allSettled(['S1', 'S2'].map(StatementItemId => f.ctx.matchAccountingBankStatement({}, { ...body, StatementItemId })));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(f.rows('accountingBankStatementItems').filter(row => row.Status === 'Matched').length, 1);
  assert.equal(f.rows('accountingBankMatchClaims').length, 1);
});

test('unique automatic match is committed together with its bank item and audit', async () => {
  const f = fixture(); f.put('accountingBanks', 'BANK', { BankId: 'BANK', BranchId: 'main', AccountCode: '1020' });
  f.put('accountingJournals', 'J1', { JournalNo: 'J1', BranchId: 'main', Status: 'Posted', Date: '2026-10-11', Reference: 'BANKREF', Lines: lines(100) });
  const body = { ...officer, BankId: 'BANK', Rows: [{ Date: '2026-10-11', Reference: 'BANKREF', Credit: 100 }] };
  f.hooks.fail = true; await assert.rejects(f.ctx.importAccountingBankStatement({}, body), /commit failure/);
  assert.equal(f.rows('accountingBankMatchClaims').length, 0); assert.equal(f.rows('accountingBankStatementItems').length, 0);
  f.hooks.fail = false; const result = await f.ctx.importAccountingBankStatement({}, body); assert.equal(result.matched, 1);
  assert.equal(f.rows('accountingBankMatchClaims').length, 1);
});

test('bank matching preserves legacy unique matches and rejects wrong-branch or mismatched amounts', async () => {
  const f = fixture();
  f.put('accountingJournals', 'J1', { JournalNo: 'J1', BranchId: 'main', Status: 'Posted', Date: '2026-10-11', Lines: lines(100) });
  f.put('accountingBankStatementItems', 'OLD', { StatementItemId: 'OLD', BranchId: 'main', AccountCode: '1020', Amount: 100, Status: 'Matched', MatchedJournalNo: 'J1' });
  f.put('accountingBankStatementItems', 'NEW', { StatementItemId: 'NEW', BranchId: 'main', AccountCode: '1020', Amount: 100 });
  const body = { ...officer, StatementItemId: 'NEW', JournalNo: 'J1' };
  await assert.rejects(f.ctx.matchAccountingBankStatement({}, body), /already matched/);
  await assert.rejects(f.ctx.matchAccountingBankStatement({}, { ...body, UserBranchId: 'other', BranchId: 'other' }), /another branch/);
  f.put('accountingBankStatementItems', 'NEW', { ...f.get('accountingBankStatementItems', 'NEW'), Amount: 99 });
  await assert.rejects(f.ctx.matchAccountingBankStatement({}, body), /does not match/);
  assert.equal(f.commits.length, 0); assert.equal(f.get('accountingBankStatementItems', 'OLD').MatchedJournalNo, 'J1');
});
