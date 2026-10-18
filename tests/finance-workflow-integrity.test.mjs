import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as guards from '../functions/lib/accounting-mutation-guards.js';
import * as imprest from '../functions/lib/imprest.js';
import * as branches from '../functions/lib/accounting-branch-scope.js';
import { validateRequisitionPosting } from '../functions/lib/requisition-posting.js';
import { resolveOrganizationConfig } from '../functions/lib/organization-config.js';
import * as runGuards from '../functions/lib/payroll/payroll-run-guards.js';
import { calculateLegacyPayroll } from '../functions/lib/payroll/payroll-calculation-service.js';
import { buildPayrollJournalLines } from '../functions/lib/payroll/payroll-ledger-service.js';

const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../functions/api/finance-workflow.js', import.meta.url), 'utf8');
function declaration(source, name) {
  const match = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, name);
  const rest = source.slice(match.index);
  const next = /\r?\n(?:export )?(?:async )?function /g.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).replace(/^export /, '');
}
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const actor = { UserRole: 'Accounts Officer', UserUsername: 'accounts', RecordedBy: 'Accounts',
  UserBranchId: 'main', BranchId: 'main', UserSchoolSectionAccess: 'All' };
const chart = ['1080', '1020', '1010', '2300', '2315', '6000', '6090', '4000', '1100', '1110', '4100', '4160']
  .map(Code => ({ Code, Active: 'YES' }));

function fixture(edition = 'school', overrides = {}, realApproval = false) {
  const store = new Map(); let version = 0, serial = 0, failCommit = false, beforeCommit = null;
  const commits = [];
  const put = (collection, id, data) => store.set(`${collection}/${id}`,
    { ...structuredClone(data), __id: id, __updateTime: `v${++version}` });
  const get = (collection, id) => structuredClone(store.get(`${collection}/${id}`) || null);
  const lookup = async (_env, collection, id, field) => get(collection, id)
    || structuredClone([...store.entries()].find(([key, value]) => key.startsWith(`${collection}/`) && value[field] === id)?.[1] || null);
  put('payrollRuns', 'R1', { RunId: 'R1', BranchId: 'main', Status: 'Posted', TotalNet: 100, PaidAmount: 0,
    LedgerMappingSnapshot: [{ MappingType: 'NET_SALARY', CreditAccountId: '2315' }] });
  put('payrollItems', 'I1', { ItemId: 'I1', RunId: 'R1', BranchId: 'main', EmployeeId: 'E1',
    DisplayName: 'Example', NetPay: 100, PaidAmount: 0, CalculationMode: 'LEGACY_FLAT_RATE' });
  put('accountingImprests', 'IMP1', { ImprestNo: 'IMP1', BranchId: 'main', SchoolSection: 'Secondary',
    CustodianUsername: 'custodian', Status: 'Approved', AmountRequested: 100, AmountApproved: 100,
    AmountIssued: 0, Date: '2026-10-11', PaymentAccount: '1020' });
  put('accountingImprestOpenClaims', 'main-custodian', { ImprestNo: 'IMP1', BranchId: 'main', CustodianUsername: 'custodian' });
  const commit = async (_env, writes) => {
    if (beforeCommit) { const hook = beforeCommit; beforeCommit = null; hook(); }
    if (failCommit) throw Object.assign(new Error('Simulated commit failure'), { status: 503 });
    assert.equal(new Set(writes.map(w => `${w.collectionPath}/${w.documentId}`)).size, writes.length);
    for (const w of writes) {
      const current = get(w.collectionPath, w.documentId);
      if ((w.exists === false && current) || (w.updateTime && current?.__updateTime !== w.updateTime)) {
        throw Object.assign(new Error('Version conflict'), { status: 409, code: 'FIRESTORE_WRITE_CONFLICT' });
      }
    }
    commits.push(structuredClone(writes));
    for (const w of writes) {
      if (w.operation === 'delete') store.delete(`${w.collectionPath}/${w.documentId}`);
      else put(w.collectionPath, w.documentId, w.data);
    }
  };
  const context = {
    withStaffEmployment: async (_env, rows) => rows, employmentPayrollProfile: row => row,
    ...guards, ...imprest, ...branches, ...runGuards, clean, lower,
    calculateLegacyPayroll, buildPayrollJournalLines, PAYROLL_GENERATION_PROFILE_LIMIT: 250,
    PAYROLL_TAX_COLLECTIONS: { mappings: 'payrollLedgerMappings', overrides: 'payrollTaxOverrides' },
    yesNo: value => ['yes', 'true', '1'].includes(lower(value)) ? 'YES' : 'NO',
    ledgerDocumentId: prefix => `${prefix}-${++serial}`,
    listCollection: async (_env, collection) => structuredClone([...store.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => value)),
    sameText: (left, right) => lower(left) === lower(right), safeDocumentId: clean,
    nowIso: () => '2026-10-11T10:00:00.000Z',
    getDocumentByIdOrField: lookup, getDocument: async (_env, c, id) => get(c, id),
    requireAccountingRole: (body, roles) => { if (!roles.includes(body.UserRole)) throw Object.assign(new Error('Role denied'), { status: 403 }); },
    requireDesktopImprestApproval: async () => {}, seedAccountingChart: async () => {},
    requireAccountingApprovalLimit: async () => {}, accountingEditionForRequest: () => edition,
    DEPARTMENT_ACCOUNTING_ROLES: ['Department User'],
    accountingAuditWrite: (action, type, id) => ({ collectionPath: 'accountingAudit', documentId: `AUD-${++serial}`,
      exists: false, data: { Action: action, EntityType: type, EntityId: id } }),
    batchCommitLiteralDocuments: commit,
    saveAccountingJournal: async (_env, journal, system, options) => {
      assert.equal(system, true); assert.equal(options?.prepareOnly, true, 'Journal must not post ahead of its source');
      validateRequisitionPosting(journal, chart, [], edition);
      return { payload: structuredClone(journal), existing: get('accountingJournals', journal.JournalNo) || {} };
    },
    ...overrides
  };
  const names = ['payPayrollItem', 'payrollSavedMoney', 'accountingImprestRecord', 'accountingImprestOpenClaimId', 'accountingImprestClaimRelease',
    'prepareImprestJournal', 'commitAccountingImprest', 'reviewAccountingImprest', 'issueAccountingImprest',
    'submitAccountingImprestRetirement', 'verifyAccountingImprestRetirement', 'validImprestDate', 'asMoneyNumber',
    'generatePayrollRun', 'savePayrollRunStatus', 'payrollAuditWrite', 'commitPayrollMutation',
    'requestPayrollTaxOverride', 'approvePayrollTaxOverride', 'accountingAdjustmentSignature',
    'saveAccountingAdjustment', 'buildAccountingAdjustmentJournal', ...(realApproval ? ['requireAccountingApprovalLimit'] : [])];
  const handlers = vm.runInNewContext(`${names.map(name => declaration(backend, name)).join('\n')}\n({${names.join(',')}})`, context);
  const pay = (body = {}) => handlers.payPayrollItem({}, { ...actor, ItemId: 'I1', PaymentNo: 'P1', Amount: 30,
    Date: '2026-10-11', Reference: 'BANK1', ...body });
  const run = (name, body = {}) => handlers[name]({}, { ...actor, ImprestNo: 'IMP1', ...body });
  return { store, get, put, pay, run, commits,
    fail: () => { failCommit = true; }, before: hook => { beforeCommit = hook; } };
}

function lifecycleFixture(edition = 'school', status = 'Draft') {
  const f = fixture(edition);
  f.put('payrollRuns', 'R1', { RunId: 'R1', BranchId: 'main', Status: status, EmployeeCount: 1,
    TotalNet: 100, TotalGross: 100, PaidAmount: 0, PayDate: '2026-10-28', Description: 'October payroll', RequiresRecalculation: 'NO' });
  f.put('payrollItems', 'I1', { ...f.get('payrollItems', 'I1'), GrossPay: 100, TotalDeductions: 0 });
  f.put('payrollProfiles', 'E1', { EmployeeId: 'E1', Username: 'employee', DisplayName: 'Example', BranchId: 'main', BasicSalary: 100, Active: 'YES' });
  return f;
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: payroll generation failure or stale approval/posting cannot replace the register`, async () => {
    const failed = lifecycleFixture(edition); failed.fail();
    await assert.rejects(failed.run('generatePayrollRun', { RunId: 'R1', Month: '2026-10' }), /commit failure/);
    assert.ok(failed.get('payrollItems', 'I1'));
    assert.equal(failed.get('payrollItems', 'R1-E1'), null);
    assert.equal(failed.get('payrollRuns', 'R1').Status, 'Draft');
    for (const Status of ['Submitted', 'Approved', 'Posted']) {
      const f = lifecycleFixture(edition);
      f.before(() => f.put('payrollRuns', 'R1', { ...f.get('payrollRuns', 'R1'), Status }));
      await assert.rejects(f.run('generatePayrollRun', { RunId: 'R1', Month: '2026-10' }), /changed during processing/);
      assert.ok(f.get('payrollItems', 'I1'));
      assert.equal(f.get('payrollItems', 'R1-E1'), null);
      assert.equal(f.get('payrollRuns', 'R1').Status, Status);
      assert.equal(f.commits.length, 0);
    }
    const success = lifecycleFixture(edition);
    await success.run('generatePayrollRun', { RunId: 'R1', Month: '2026-10' });
    assert.equal(success.get('payrollItems', 'I1'), null);
    assert.equal(success.get('payrollItems', 'R1-E1').NetPay, 100);
    assert.equal(success.commits.length, 1);
    assert.ok(success.commits[0].some(write => write.collectionPath === 'payrollAudit'));
  });

  test(`${edition}: run approval locks and payroll accrual commit with their run state`, async () => {
    const approval = lifecycleFixture(edition, 'Submitted'); approval.fail();
    await assert.rejects(approval.run('savePayrollRunStatus', { RunId: 'R1', Status: 'Approved', UserRole: 'Management' }), /commit failure/);
    assert.equal(approval.get('payrollItems', 'I1').LockedAt, undefined);
    assert.equal(approval.get('payrollRuns', 'R1').Status, 'Submitted');
    const posting = lifecycleFixture(edition, 'Approved'); posting.fail();
    await assert.rejects(posting.run('savePayrollRunStatus', { RunId: 'R1', Status: 'Posted' }), /commit failure/);
    assert.equal(posting.get('accountingJournals', 'SYS-PR-R1'), null);
    assert.equal(posting.get('payrollRuns', 'R1').Status, 'Approved');
    const f = lifecycleFixture(edition, 'Submitted');
    await f.run('savePayrollRunStatus', { RunId: 'R1', Status: 'Approved', UserRole: 'Management' });
    assert.ok(f.get('payrollItems', 'I1').LockedAt);
    const result = await Promise.allSettled([f.run('savePayrollRunStatus', { RunId: 'R1', Status: 'Posted' }),
      f.run('savePayrollRunStatus', { RunId: 'R1', Status: 'Posted' })]);
    assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(f.get('payrollRuns', 'R1').Status, 'Posted');
    assert.equal(f.get('accountingJournals', 'SYS-PR-R1').Lines[0].Debit, 100);
    assert.equal(f.commits.length, 2);
  });
}

test('stale run submission or approval cannot overwrite regeneration or a later decision', async () => {
  for (const [original, requested, changed] of [['Draft', 'Submitted', 'Draft'], ['Submitted', 'Approved', 'Rejected']]) {
    const f = lifecycleFixture('school', original);
    f.before(() => f.put('payrollRuns', 'R1', { ...f.get('payrollRuns', 'R1'), Status: changed, Description: 'Newer version' }));
    await assert.rejects(f.run('savePayrollRunStatus', { RunId: 'R1', Status: requested, UserRole: 'Super Admin' }), /changed during processing/);
    assert.equal(f.get('payrollRuns', 'R1').Description, 'Newer version');
    assert.equal(f.get('payrollItems', 'I1').LockedAt, undefined);
  }
});

test('payroll regeneration exceeding one atomic batch is rejected before deleting old items', async () => {
  const f = lifecycleFixture();
  for (let index = 0; index < 499; index++) f.put('payrollItems', `OLD-${index}`, { ...f.get('payrollItems', 'I1'), ItemId: `OLD-${index}` });
  await assert.rejects(f.run('generatePayrollRun', { RunId: 'R1', Month: '2026-10' }), /safe atomic batch size/);
  assert.equal(f.commits.length, 0);
  assert.ok(f.get('payrollItems', 'OLD-0'));
});

test('payroll tax override decisions cannot reset submitted runs and fail atomically', async () => {
  for (const mode of ['failure', 'stale', 'success']) {
    const f = lifecycleFixture();
    f.put('payrollTaxOverrides', 'OVR1', { OverrideId: 'OVR1', BranchId: 'main', RunId: 'R1', EmployeeId: 'E1',
      Status: 'Pending', RequestedBy: 'Another user', RequestedByUsername: 'requester', OverridePaye: 5 });
    if (mode === 'failure') f.fail();
    if (mode === 'stale') f.before(() => f.put('payrollRuns', 'R1', { ...f.get('payrollRuns', 'R1'), Status: 'Posted' }));
    const request = f.run('approvePayrollTaxOverride', { OverrideId: 'OVR1', Decision: 'Approved', UserRole: 'Management' });
    if (mode === 'success') {
      await request;
      assert.equal(f.get('payrollRuns', 'R1').RequiresRecalculation, 'YES');
      assert.equal(f.get('payrollTaxOverrides', 'OVR1').Status, 'Approved');
      assert.equal(f.commits.length, 1);
    } else {
      await assert.rejects(request, mode === 'failure' ? /commit failure/ : /changed during processing/);
      assert.equal(f.get('payrollTaxOverrides', 'OVR1').Status, 'Pending');
      assert.equal(f.get('payrollRuns', 'R1').RequiresRecalculation, 'NO');
    }
  }
});

test('posting snapshots the actual configurable payable account used by later salary payments', async () => {
  const f = lifecycleFixture('school', 'Approved');
  f.put('payrollItems', 'I1', { ...f.get('payrollItems', 'I1'), CalculationMode: 'CONFIGURABLE_PAYE', CalculationStatus: 'VALID' });
  f.put('payrollLedgerMappings', 'GROSS', { MappingType: 'GROSS_SALARY', DebitAccountId: '6000', Active: 'YES' });
  f.put('payrollLedgerMappings', 'NET', { MappingType: 'NET_SALARY', CreditAccountId: '2315', Active: 'YES' });
  await f.run('savePayrollRunStatus', { RunId: 'R1', Status: 'Posted' });
  assert.ok(f.get('accountingJournals', 'SYS-PR-R1').Lines.some(line => line.AccountCode === '2315' && line.Credit === 100));
  f.put('payrollLedgerMappings', 'NET', { MappingType: 'NET_SALARY', CreditAccountId: '2300', Active: 'YES' });
  await f.pay();
  assert.equal(f.get('accountingJournals', 'SYS-SALPAY-P1').Lines[0].AccountCode, '2315');
});

test('a supported 250-profile payroll is generated in one complete atomic batch', async () => {
  const f = lifecycleFixture();
  for (let index = 2; index <= 250; index++) f.put('payrollProfiles', `E${index}`, { ...f.get('payrollProfiles', 'E1'), EmployeeId: `E${index}`, Username: `employee${index}` });
  await f.run('generatePayrollRun', { RunId: 'R1', Month: '2026-10' });
  assert.equal(f.commits.length, 1);
  assert.equal(f.get('payrollRuns', 'R1').EmployeeCount, 250);
  assert.equal(f.get('payrollRuns', 'R1').TotalNet, 25000);
  assert.equal(f.get('payrollItems', 'R1-E250').NetPay, 100);
});

test('generated payroll totals are rounded to cents and old floating-point noise does not block payment', async () => {
  const f = lifecycleFixture();
  f.put('payrollProfiles', 'E1', { ...f.get('payrollProfiles', 'E1'), BasicSalary: 0.1 });
  f.put('payrollProfiles', 'E2', { ...f.get('payrollProfiles', 'E1'), EmployeeId: 'E2', BasicSalary: 0.2 });
  await f.run('generatePayrollRun', { RunId: 'R1', Month: '2026-10' });
  assert.equal(f.get('payrollRuns', 'R1').TotalNet, 0.3);
  const previous = fixture();
  previous.put('payrollRuns', 'R1', { ...previous.get('payrollRuns', 'R1'), TotalNet: 100.00000000000001 });
  await previous.pay({ Amount: 100 });
  assert.equal(previous.get('payrollRuns', 'R1').Status, 'Paid');
  const invalid = fixture();
  invalid.put('payrollRuns', 'R1', { ...invalid.get('payrollRuns', 'R1'), TotalNet: 100.001 });
  await assert.rejects(invalid.pay(), /two decimal places/);
});

test('tax override request is bound to its item and cannot slip past run submission', async () => {
  const f = lifecycleFixture();
  f.put('payrollItems', 'I1', { ...f.get('payrollItems', 'I1'), CalculationMode: 'CONFIGURABLE_PAYE' });
  f.before(() => f.put('payrollRuns', 'R1', { ...f.get('payrollRuns', 'R1'), Status: 'Submitted' }));
  await assert.rejects(f.run('requestPayrollTaxOverride', { RunId: 'R1', EmployeeId: 'E1', OverrideId: 'OVR1', OverridePaye: 5, Reason: 'Correction' }), /changed during processing/);
  assert.equal(f.get('payrollTaxOverrides', 'OVR1'), null);
  assert.equal(f.get('payrollRuns', 'R1').Status, 'Submitted');
  f.put('payrollRuns', 'R1', { ...f.get('payrollRuns', 'R1'), Status: 'Draft' });
  f.put('payrollTaxOverrides', 'OVR1', { OverrideId: 'OVR1', BranchId: 'main', RunId: 'OTHER-RUN', EmployeeId: 'E1', Status: 'Pending' });
  await assert.rejects(f.run('requestPayrollTaxOverride', { RunId: 'R1', EmployeeId: 'E1', OverrideId: 'OVR1', OverridePaye: 5, Reason: 'Correction' }), /another payroll item/);
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: repeated salary payment is counted once and changed references are rejected`, async () => {
    const f = fixture(edition);
    await f.pay(); assert.equal((await f.pay()).replayed, true);
    assert.equal(f.get('payrollItems', 'I1').PaidAmount, 30);
    assert.equal(f.get('payrollRuns', 'R1').PaidAmount, 30);
    assert.equal(f.commits.length, 1);
    assert.equal(f.get('accountingJournals', 'SYS-SALPAY-P1').Lines[0].Debit, 30);
    await assert.rejects(f.pay({ Amount: 20 }), /already used/);
    await assert.rejects(f.pay({ ItemId: 'other' }), /already used/);
  });

  test(`${edition}: concurrent salary payments cannot overpay or lose totals`, async () => {
    const f = fixture(edition);
    const results = await Promise.allSettled([f.pay({ PaymentNo: 'P1', Amount: 100 }), f.pay({ PaymentNo: 'P2', Amount: 100 })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(f.commits.length, 1);
    assert.equal(f.get('payrollItems', 'I1').PaidAmount, 100);
    assert.equal(f.get('payrollRuns', 'R1').PaidAmount, 100);
    assert.equal([...f.store.keys()].filter(key => key.startsWith('payrollPayments/')).length, 1);
  });

  test(`${edition}: salary commit failure writes no journal, payment or balances`, async () => {
    const f = fixture(edition); f.fail();
    await assert.rejects(f.pay(), /commit failure/);
    assert.equal(f.get('accountingJournals', 'SYS-SALPAY-P1'), null);
    assert.equal(f.get('payrollPayments', 'P1'), null);
    assert.equal(f.get('payrollItems', 'I1').PaidAmount, 0);
    assert.equal(f.get('payrollRuns', 'R1').PaidAmount, 0);
  });

  test(`${edition}: configurable salary clears the historical mapping, legacy salary clears 2300`, async () => {
    const f = fixture(edition);
    f.put('payrollItems', 'I1', { ...f.get('payrollItems', 'I1'), CalculationMode: 'CONFIGURABLE_PAYE' });
    await f.pay();
    assert.equal(f.get('accountingJournals', 'SYS-SALPAY-P1').Lines[0].AccountCode, '2315');
    const legacy = fixture(edition); await legacy.pay();
    assert.equal(legacy.get('accountingJournals', 'SYS-SALPAY-P1').Lines[0].AccountCode, '2300');
  });

  test(`${edition}: desktop imprest journal and state commit together`, async () => {
    const failed = fixture(edition); failed.fail();
    await assert.rejects(failed.run('issueAccountingImprest', { DisbursementReference: 'BANK1' }), /commit failure/);
    assert.equal(failed.get('accountingJournals', 'SYS-IMPREST-ISSUE-IMP1'), null);
    assert.equal(failed.get('accountingImprests', 'IMP1').Status, 'Approved');
    const f = fixture(edition);
    const results = await Promise.allSettled([f.run('issueAccountingImprest', { DisbursementReference: 'BANK1' }),
      f.run('issueAccountingImprest', { DisbursementReference: 'BANK2' })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(f.commits.length, 1);
    assert.equal(f.get('accountingImprests', 'IMP1').Status, 'Issued');
    assert.equal(f.get('accountingJournals', 'SYS-IMPREST-ISSUE-IMP1').Lines[0].Debit, 100);
  });
}

test('simultaneous retries of the same salary payment return its saved result', async () => {
  const f = fixture();
  const results = await Promise.all([f.pay(), f.pay()]);
  assert.equal(results.filter(result => result.replayed).length, 1);
  assert.equal(f.commits.length, 1);
});

test('concurrent payments to different employees retain the run total on retry', async () => {
  const f = fixture(); f.put('payrollRuns', 'R1', { ...f.get('payrollRuns', 'R1'), TotalNet: 200 });
  f.put('payrollItems', 'I2', { ...f.get('payrollItems', 'I1'), ItemId: 'I2', EmployeeId: 'E2' });
  const requests = [{ ItemId: 'I1', PaymentNo: 'P1', Amount: 100 }, { ItemId: 'I2', PaymentNo: 'P2', Amount: 100 }];
  const results = await Promise.allSettled(requests.map(body => f.pay(body)));
  const retry = results.findIndex(result => result.status === 'rejected');
  assert.ok(retry >= 0); await f.pay(requests[retry]);
  assert.equal(f.get('payrollRuns', 'R1').PaidAmount, 200);
  assert.equal(f.get('payrollRuns', 'R1').Status, 'Paid');
});

test('salary rejects invalid money, missing request key, other branches and orphaned journals', async () => {
  for (const Amount of [0, -1, '1e3', '30.001', 'NaN']) await assert.rejects(fixture().pay({ Amount }));
  await assert.rejects(fixture().pay({ PaymentNo: '' }), /stable payment reference/);
  await assert.rejects(fixture().pay({ UserBranchId: 'other', BranchId: 'other' }), /branch/i);
  const f = fixture(); f.put('accountingJournals', 'SYS-SALPAY-P1', { JournalNo: 'SYS-SALPAY-P1', Status: 'Posted' });
  await assert.rejects(f.pay(), /reconcile/); assert.equal(f.commits.length, 0);
});

test('configurable salary refuses a missing or ambiguous historical mapping', async () => {
  for (const LedgerMappingSnapshot of [[], [{ MappingType: 'NET_SALARY', CreditAccountId: '2315' }, { MappingType: 'NET_SALARY', CreditAccountId: '2300' }]]) {
    const f = fixture(); f.put('payrollItems', 'I1', { ...f.get('payrollItems', 'I1'), CalculationMode: 'CONFIGURABLE_PAYE' });
    f.put('payrollRuns', 'R1', { ...f.get('payrollRuns', 'R1'), LedgerMappingSnapshot });
    await assert.rejects(f.pay(), /account snapshot/); assert.equal(f.commits.length, 0);
  }
});

test('stale imprest rejection cannot remove the custodian claim or overwrite an approval', async () => {
  const f = fixture(); f.put('accountingImprests', 'IMP1', { ...f.get('accountingImprests', 'IMP1'), Status: 'Submitted' });
  f.before(() => f.put('accountingImprests', 'IMP1', { ...f.get('accountingImprests', 'IMP1'), Status: 'Approved' }));
  await assert.rejects(f.run('reviewAccountingImprest', { Decision: 'Rejected' }), /changed during review/);
  assert.equal(f.get('accountingImprests', 'IMP1').Status, 'Approved');
  assert.equal(f.get('accountingImprestOpenClaims', 'main-custodian').ImprestNo, 'IMP1');
});

test('imprest rejection cannot delete a replaced open claim', async () => {
  const f = fixture(); f.put('accountingImprests', 'IMP1', { ...f.get('accountingImprests', 'IMP1'), Status: 'Submitted' });
  f.before(() => f.put('accountingImprestOpenClaims', 'main-custodian', { ImprestNo: 'IMP2' }));
  await assert.rejects(f.run('reviewAccountingImprest', { Decision: 'Rejected' }), /changed during review/);
  assert.equal(f.get('accountingImprestOpenClaims', 'main-custodian').ImprestNo, 'IMP2');
  assert.equal(f.get('accountingImprests', 'IMP1').Status, 'Submitted');
});

const retirementLines = [{ Date: '2026-10-11', Description: 'Supplies', ExpenseAccount: '6090', Amount: 60, ReceiptUrl: 'https://example.test/receipt' }];
test('web and desktop imprest submissions do not overlook older open requests after twenty retired records', async () => {
  const records = [...Array.from({ length: 20 }, (_, index) => ({ ImprestNo: `CLOSED-${index}`, BranchId: 'main', Status: 'Retired' })),
    { ImprestNo: 'STILL-OPEN', BranchId: 'main', Status: 'Issued' }];
  const context = { ...guards, ...imprest, ...branches, clean, lower, nowIso: () => '2026-10-11T10:00:00Z',
    sameText: (a, b) => lower(a) === lower(b), same: (a, b) => lower(a) === lower(b),
    safeDocumentId: clean, safeId: clean, amount: Number,
    requireAccountingRole: () => {}, accountingDepartment: () => 'Administration',
    requireSubmitter: () => 'Administration', DEPARTMENT_ACCOUNTING_ROLES: [],
    validImprestDate: value => value, validIsoDate: value => value,
    getDocument: async () => null,
    queryCollection: async () => records.slice(0, 20),
    queryCollectionPages: async (_env, collection, options) => {
      assert.equal(collection, 'accountingImprests');
      assert.equal(options.filters[0].value, 'custodian');
      assert.equal(options.limit, undefined);
      return records;
    }
  };
  const desktop = vm.runInNewContext(`${declaration(backend, 'accountingImprestOpenClaimId')}\n(${declaration(backend, 'submitAccountingImprest')})`, context);
  const web = vm.runInNewContext(`${declaration(workflow, 'imprestOpenClaimId')}\n(${declaration(workflow, 'submitImprest')})`, context);
  const body = { ...actor, UserUsername: 'custodian', AmountRequested: 100, Purpose: 'Supplies', Date: '2026-10-11', DueDate: '2026-10-20' };
  await assert.rejects(desktop({}, body), /STILL-OPEN/);
  await assert.rejects(web({}, { username: 'custodian', branchId: 'main' }, body), /STILL-OPEN/);
  context.queryCollectionPages = async () => { throw new Error('History read failed'); };
  await assert.rejects(desktop({}, body), /History read failed/);
  await assert.rejects(web({}, { username: 'custodian', branchId: 'main' }, body), /History read failed/);
});

test('retirement stays outstanding until atomic verification; failures leave claim and journal unchanged', async () => {
  const f = fixture(); await f.run('issueAccountingImprest', { DisbursementReference: 'BANK1' });
  await f.run('submitAccountingImprestRetirement', { RetirementLines: retirementLines, ReturnReference: 'RETURN1' });
  assert.equal(imprest.imprestReportSummary([f.get('accountingImprests', 'IMP1')]).outstanding, 100);
  f.before(() => f.put('accountingImprests', 'IMP1', { ...f.get('accountingImprests', 'IMP1'), RetirementNotes: 'Updated concurrently' }));
  await assert.rejects(f.run('verifyAccountingImprestRetirement'), /changed during review/);
  assert.equal(f.get('accountingJournals', 'SYS-IMPREST-RETIRE-IMP1'), null);
  assert.ok(f.get('accountingImprestOpenClaims', 'main-custodian'));
  await f.run('verifyAccountingImprestRetirement');
  assert.equal(f.get('accountingImprests', 'IMP1').Status, 'Retired');
  assert.equal(f.get('accountingImprestOpenClaims', 'main-custodian'), null);
  assert.equal(imprest.imprestReportSummary([f.get('accountingImprests', 'IMP1')]).outstanding, 0);
});

test('retirement returned for correction remains fully outstanding', async () => {
  const f = fixture(); await f.run('issueAccountingImprest', { DisbursementReference: 'BANK1' });
  await f.run('submitAccountingImprestRetirement', { RetirementLines: retirementLines, ReturnReference: 'RETURN1' });
  await f.run('verifyAccountingImprestRetirement', { Decision: 'Returned for Correction', Notes: 'Receipt unclear' });
  assert.equal(f.get('accountingImprests', 'IMP1').Status, 'Issued');
  assert.equal(imprest.imprestReportSummary([f.get('accountingImprests', 'IMP1')]).outstanding, 100);
});

function webContext(extra = {}) {
  return { clean, lower, amount: value => Number(value || 0),
    validateRequisitionPosting, resolveOrganizationConfig,
    capabilities: () => ({ canApprove: true, canAccountsReview: true, canViewAll: true }),
    safeId: clean, same: (a, b) => lower(a) === lower(b), ...extra };
}
test('desktop and web approvals apply transaction role caps before personal or Super Admin grants', async () => {
  for (const role of ['Accounts Officer', 'Super Admin']) {
    const limit = { Role: role, TransactionType: 'Imprest', MaxAmount: 50, Active: 'YES' };
    const context = { clean, ...guards, listCollection: async () => [limit],
      getDocumentByIdOrField: async () => ({ ApprovalEnabled: 'YES', ApprovalMaxAmount: 1000 }),
      yesNo: value => value, asMoneyNumber: Number };
    const desktop = vm.runInNewContext(`(${declaration(backend, 'requireDesktopImprestApproval')})`, context);
    const web = vm.runInNewContext(`(${declaration(workflow, 'approvalLimitAllows')})`, { ...context, amount: Number });
    const user = { role, approvalEnabled: true, approvalMaxAmount: 1000 };
    await assert.rejects(desktop({}, { UserRole: role, UserUsername: 'approver' }, 51), /configured approval limit/);
    await assert.rejects(web({}, user, 'Imprest', 51), /configured approval limit/);
    await desktop({}, { UserRole: role, UserUsername: 'approver' }, 50);
    assert.equal(await web({}, user, 'Imprest', 50), true);
    limit.Active = 'NO';
    await assert.rejects(desktop({}, { UserRole: role, UserUsername: 'approver' }, 1), /configured approval limit/);
    await assert.rejects(web({}, user, 'Imprest', 1), /configured approval limit/);
  }
});

test('approval limit lookup errors fail closed and personal approval limits still apply', async () => {
  const context = { clean, ...guards,
    listCollection: async () => { throw new Error('Limit read failed'); },
    getDocumentByIdOrField: async () => ({ ApprovalEnabled: 'YES', ApprovalMaxAmount: 50 }),
    yesNo: value => value, asMoneyNumber: Number, amount: Number };
  const desktop = vm.runInNewContext(`(${declaration(backend, 'requireDesktopImprestApproval')})`, context);
  const web = vm.runInNewContext(`(${declaration(workflow, 'approvalLimitAllows')})`, context);
  await assert.rejects(desktop({}, { UserRole: 'Super Admin' }, 1), /Limit read failed/);
  await assert.rejects(web({}, { role: 'Super Admin' }, 'Imprest', 1), /Limit read failed/);
  context.listCollection = async () => [];
  await assert.rejects(desktop({}, { UserRole: 'Accounts Officer' }, 51), /administrator-granted/);
  assert.equal(await web({}, { role: 'Accounts Officer', approvalEnabled: true, approvalMaxAmount: 50 }, 'Imprest', 51), false);
});

test('web imprest fails closed on a failed period read and uses edition-active accounts', async () => {
  const source = `(${declaration(workflow, 'validateImprestPosting')})`;
  const journal = imprest.buildImprestIssueJournal({ ImprestNo: 'IMP1', AmountApproved: 100, Date: '2026-10-11' });
  const failed = vm.runInNewContext(source, webContext({ listCollection: async () => { throw new Error('Period read failed'); }, getAccountingChartRows: async () => chart }));
  await assert.rejects(failed({}, journal), /Period read failed/);
  for (const edition of ['school', 'faith', 'organization']) {
    const closed = vm.runInNewContext(source, webContext({ listCollection: async () => [{ StartDate: '2026-10-01', EndDate: '2026-10-31', Status: 'Closed' }], getAccountingChartRows: async () => chart }));
    await assert.rejects(closed({ ORGANIZATION_EDITION: edition }, journal), /closed/);
    const disabled = vm.runInNewContext(source, webContext({ listCollection: async () => [], getAccountingChartRows: async () => chart.map(row => ({ ...row, Active: row.Code === '1080' ? 'disabled' : 'YES' })) }));
    await assert.rejects(disabled({ ORGANIZATION_EDITION: edition }, journal), /inactive/);
  }
  for (const edition of ['faith', 'organization']) {
    const validate = vm.runInNewContext(source, webContext({ listCollection: async () => [], getAccountingChartRows: async () => chart }));
    await assert.rejects(validate({ ORGANIZATION_EDITION: edition }, { ...journal, Lines: journal.Lines.map(line => line.AccountCode === '1080' ? { ...line, AccountCode: '4000' } : line) }), /unavailable in this edition/);
  }
});

for (const handler of ['reviewRecord', 'accountsReview']) {
  test(`web ${handler} rejects another branch or school section before authorization or writes`, async () => {
    for (const record of [{ BranchId: 'other', SchoolSection: 'Secondary' }, { BranchId: 'main', SchoolSection: 'Primary' }]) {
      let authorized = false, written = false;
      const context = webContext({ getDocument: async () => ({ ...record, BillNo: 'B1', Status: 'Approved' }),
        requireDecisionAuthorization: async () => { authorized = true; },
        commitFinanceDecision: async () => { written = true; } });
      const run = vm.runInNewContext(`${declaration(workflow, 'scopedRows')}\n(${declaration(workflow, handler)})`, context);
      await assert.rejects(run({}, { role: 'Super Admin', branchId: 'main', schoolSectionAccess: 'Secondary' },
        { recordId: 'B1', recordType: 'bill', decision: 'Approved' }, {}), /not found/);
      assert.equal(authorized, false); assert.equal(written, false);
    }
  });
}

function adjustmentFixture(edition = 'school', type = 'Discount', realApproval = false) {
  const f = fixture(edition, {}, realApproval);
  const request = { AdjustmentNo: 'ADJ1', Date: '2026-10-11', BranchId: 'main', Type: type, AccountRef: 'S1',
    DisplayName: 'Example', Amount: 100, Reason: 'Reviewed correction', Reference: 'ADJREF1', PaymentAccount: '1020', Status: 'Posted' };
  f.put('accountingAdjustments', 'ADJ1', { ...request, Status: 'Approved' });
  return { ...f, request, post: body => f.run('saveAccountingAdjustment', { ...request, ...body }) };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: actual concession account determines staff approval rights, not caller account fields`, async () => {
    const actualAccount = edition === 'school' ? '4100' : '4160';
    for (const role of ['Accounts Officer', 'Management']) {
      for (const type of ['Discount', 'Refund']) {
        const f = adjustmentFixture(edition, type, true);
        f.put('staffUsers', 'accounts', { Username: 'accounts', ApprovalEnabled: 'YES', ApprovalMaxAmount: 1000, ApprovalAccounts: [actualAccount] });
        f.put('accountingAdjustments', 'ADJ1', { ...f.get('accountingAdjustments', 'ADJ1'), Status: 'Submitted' });
        await f.post({ Status: 'Approved', UserRole: role });
        await f.post({ UserRole: role });
        assert.equal(f.get('accountingJournals', 'SYS-ADJ-ADJ1').Lines[0].AccountCode, actualAccount);
        const forged = adjustmentFixture(edition, type, true);
        forged.put('staffUsers', 'accounts', { Username: 'accounts', ApprovalEnabled: 'YES', ApprovalMaxAmount: 1000, ApprovalAccounts: ['6090'] });
        for (const Status of ['Approved', 'Posted', 'Rejected']) {
          forged.put('accountingAdjustments', 'ADJ1', { ...forged.get('accountingAdjustments', 'ADJ1'), Status: Status === 'Approved' ? 'Submitted' : 'Approved' });
          await assert.rejects(forged.post({ Status, UserRole: role, AccountCode: '6090', accountCode: '6090', ExpenseAccount: '6090' }), /administrator-granted approval rights/);
        }
        assert.equal(forged.commits.length, 0);
        assert.equal(forged.get('accountingJournals', 'SYS-ADJ-ADJ1'), null);
      }
    }
  });

  test(`${edition}: concession/refund journal, adjustment and audit post atomically and replay once`, async () => {
    for (const type of ['Discount', 'Refund']) {
      const failed = adjustmentFixture(edition, type); failed.fail();
      await assert.rejects(failed.post(), /commit failure/);
      assert.equal(failed.get('accountingAdjustments', 'ADJ1').Status, 'Approved');
      assert.equal(failed.get('accountingJournals', 'SYS-ADJ-ADJ1'), null);
      const f = adjustmentFixture(edition, type);
      const results = await Promise.all([f.post(), f.post()]);
      assert.equal(results.filter(result => result.replayed).length, 1);
      assert.equal(f.commits.length, 1);
      assert.equal(f.get('accountingAdjustments', 'ADJ1').Status, 'Posted');
      const journal = f.get('accountingJournals', 'SYS-ADJ-ADJ1');
      assert.equal(journal.Lines[0].Debit, 100);
      assert.equal(journal.Lines[0].AccountCode, edition === 'school' ? '4100' : '4160');
      assert.equal(journal.Lines[1].AccountCode, type === 'Refund' ? '1020' : edition === 'school' ? '1100' : '1110');
      assert.equal((await f.post()).replayed, true);
      await assert.rejects(f.post({ Amount: 101 }), /immutable/);
      await assert.rejects(f.post({ Status: 'Draft' }), /immutable/);
      assert.equal(f.commits.length, 1);
    }
  });
}

test('stale adjustment posting cannot overwrite rejection or leave an orphan journal', async () => {
  const f = adjustmentFixture();
  f.before(() => f.put('accountingAdjustments', 'ADJ1', { ...f.get('accountingAdjustments', 'ADJ1'), Status: 'Rejected' }));
  await assert.rejects(f.post(), /changed during processing/);
  assert.equal(f.get('accountingAdjustments', 'ADJ1').Status, 'Rejected');
  assert.equal(f.get('accountingJournals', 'SYS-ADJ-ADJ1'), null);
  assert.equal(f.commits.length, 0);
});

test('adjustments require prior approval, unchanged approved details and a complete previous posting', async () => {
  const f = adjustmentFixture();
  await assert.rejects(f.post({ Amount: 101 }), /Approved adjustment details cannot change/);
  f.put('accountingAdjustments', 'ADJ1', { ...f.get('accountingAdjustments', 'ADJ1'), Status: 'Submitted' });
  await assert.rejects(f.post(), /Submit and approve/);
  const orphan = adjustmentFixture();
  orphan.put('accountingJournals', 'SYS-ADJ-ADJ1', { JournalNo: 'SYS-ADJ-ADJ1', Status: 'Posted' });
  await assert.rejects(orphan.post(), /reconcile/);
  assert.equal(orphan.commits.length, 0);
  const incomplete = adjustmentFixture();
  incomplete.put('accountingAdjustments', 'ADJ1', { ...incomplete.get('accountingAdjustments', 'ADJ1'), Status: 'Posted', JournalNo: 'SYS-ADJ-ADJ1' });
  await assert.rejects(incomplete.post(), /matching posted journal/);
});
