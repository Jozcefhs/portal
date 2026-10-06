import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { accountingFinanceReportRows } from '../functions/api/backend.js';
import { accountingRequestBranch, accountingRowsForBranch } from '../functions/lib/accounting-branch-scope.js';

const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const clean = value => String(value ?? '').trim();
function pageHandler(overrides = {}) {
  const validation = source.slice(source.indexOf('function validateAccountingReportPage('),
    source.indexOf('async function getAccountingJournalPage('));
  const handler = source.slice(source.indexOf('export async function getAccountingFinancePage('),
    source.indexOf('function assignedStaffBranchId(')).replace('export ', '');
  const calls = [];
  const context = vm.createContext({ clean, isDepartmentAccountingUser: body => body.UserRole === 'Department Head',
    requireAccountingRole: body => { if (!['Super Admin', 'Accounts Officer', 'Management'].includes(body.UserRole)) {
      const error = new Error('Not authorized'); error.status = 403; throw error;
    } }, accountingRequestBranch, accountingRowsForBranch, accountingFinanceReportRows,
    accountingFilter: () => ({}), listCollectionPage: async (_env, collection, options) => {
      calls.push({ collection, options });
      return { documents: [{ __id: 'west', BranchId: 'west', Amount: 50 },
        { __id: 'main', BranchId: 'main', Amount: 70 }], nextPageToken: 'next' };
    }, ...overrides });
  vm.runInContext(validation, context);
  return { calls, handler: vm.runInContext(`(${handler})`, context) };
}
const request = () => ({ UserRole: 'Accounts Officer', UserBranchId: 'main', BranchId: 'main',
  ReadTime: new Date(Date.now() - 2000).toISOString(), Collection: 'invoices', PageToken: '' });

for (const edition of ['school', 'church', 'organization', 'hotel']) {
  test(`shared ${edition} finance page reads one bounded snapshot page and filters branch before returning`, async () => {
    const { handler, calls } = pageHandler();
    const body = { ...request(), Edition: edition };
    const result = await handler({}, body);
    assert.deepEqual(result.rows.map(row => row.__id), ['main']);
    assert.equal(result.nextPageToken, 'next');
    assert.equal(result.readTime, body.ReadTime);
    assert.equal(result.scanned, 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.pageSize, 500);
    assert.equal(calls[0].options.query, `readTime=${encodeURIComponent(body.ReadTime)}`);
  });
}

test('wrong collection, expired snapshot, role and branch escalation fail before reads', async () => {
  for (const change of [{ Collection: 'staffUsers' }, { ReadTime: '2020-01-01T00:00:00.000Z' },
    { UserRole: 'Teacher' }, { UserRole: 'Department Head' }, { BranchId: 'west' }, { PageToken: 'x'.repeat(8193) }]) {
    const { handler, calls } = pageHandler();
    await assert.rejects(handler({}, { ...request(), ...change }));
    assert.equal(calls.length, 0);
  }
});

test('empty authorized branch page retains cursor so later authorized records are still read', async () => {
  const { handler } = pageHandler({ listCollectionPage: async () => ({
    documents: [{ BranchId: 'west', Amount: 1 }], nextPageToken: 'still-more' }) });
  const result = await handler({}, request());
  assert.equal(result.rows.length, 0);
  assert.equal(result.nextPageToken, 'still-more');
});

test('server report facts preserve reversals, deposits, gateway credits and wallet/store exclusions', () => {
  const rows = accountingFinanceReportRows('payments', [
    { AccountRef: 'TEST/26/053', FeeCode: 'ACC_BOA', FeeName: 'Acceptance fee', FeeCategory: 'Admission', Amount: 150000 },
    { AccountRef: 'TEST/26/053', FeeCode: 'OTHER', Amount: 10000, GrossAmount: 10000, GatewayFee: 150, NetAmount: 9850 },
    { AccountRef: 'TEST/26/053', FeeCode: 'WALLET_TOPUP', Amount: 500 },
    { AccountRef: 'TEST/26/053', FeeCode: 'STORE_CART', Amount: 500 }
  ]);
  assert.equal(rows[0].ReportGeneralSchoolCredit, true);
  assert.equal(rows[0].ReportCredit, 150000);
  assert.equal(rows[1].ReportCredit, 9850);
  assert.equal(rows[2].ReportExcludedFromAgeing, true);
  assert.equal(rows[3].ReportExcludedFromAgeing, true);
  const invoice = accountingFinanceReportRows('invoices', [{ InvoiceId: 'REVERSED', Amount: 60000,
    Credit: 60000, FeeChargeReversed: 'YES', FeeChargeReversalId: 'R1', FeeChargeReversalAmount: 60000,
    FeeChargeReleasedCredit: 60000, Date: '2026-09-01' }])[0];
  assert.equal(invoice.Debit, 0);
  assert.equal(invoice.Credit, 0);
  assert.equal(invoice.GrossInvoiceAmount, 60000);
});

test('paged overview skips entire invoice/payment scans and withholds incomplete reports in every edition', async () => {
  const handlerSource = source.slice(source.indexOf('async function getAccountingOverview('),
    source.indexOf('async function getAccountingRequisitionDocument('));
  for (const edition of ['school', 'church', 'organization', 'hotel']) {
    const calls = [];
    const handler = vm.runInNewContext(`(${handlerSource})`, { clean, lower: v => clean(v).toLowerCase(),
      accountingEditionForRequest: () => edition, accountingRequestBranch: () => 'main', accountingRowsForBranch,
      isDepartmentAccountingUser: () => false, listCollection: async (_env, collection) => { calls.push(collection); return []; },
      listCollectionForReport: async (_env, collection) => { throw new Error(`Unbounded ${collection}`); },
      listChurchDonationsForAccounting: async () => [], accountingFilter: () => ({}),
      accountingChartForEdition: rows => rows, accountingJournalsForEdition: rows => rows,
      PAYROLL_TAX_COLLECTIONS: {}, buildAccountingReport: () => ({ dashboard: {} }),
      buildReceivablesAgeing: () => [], buildAgeing: () => [], nowIso: () => new Date().toISOString(),
      buildGatewayCollectionsReport: () => ({ summary: {}, onlineTransactions: [] }),
      canEditRequisitions: () => false, accountingRequisitionActor: () => ({}) });
    const result = await handler({}, { FinancePagination: 'paged' });
    assert.equal(result.reports, null);
    assert.equal(result.gatewayReport, null);
    assert.equal(result.financePagination.collections.join(','), 'journals,invoices,payments');
    assert.equal(result.financePagination.readTime, result.journalPagination.readTime);
    assert.equal(calls.includes('invoices'), false);
    assert.equal(calls.includes('payments'), false);
    assert.equal(calls.includes('accountingJournals'), false);
  }
});
