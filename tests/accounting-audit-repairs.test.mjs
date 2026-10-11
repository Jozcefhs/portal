import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildAccountingReport, buildReceivablesAgeing, buildPayablesAgeing, accountingFinanceReportRows } from '../functions/api/backend.js';
import { resolveAuthoritativeDesktopActor, applyAuthoritativeActor } from '../functions/lib/backend-security.js';

const source = readFileSync(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const extract = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const clean = value => String(value ?? '').trim();
const invoice = { InvoiceId: 'I1', AccountRef: 'S1', FeeCode: 'TUITION', Date: '2025-01-01', Amount: 100, Credit: 0 };
const payment = { AccountRef: 'S1', FeeCode: 'TUITION', Date: '2025-02-01', Amount: 100, Status: 'Paid' };

test('non-finance authoritative roles cannot read overview or journals before any data lookup', async () => {
  const context = vm.createContext({ clean });
  vm.runInContext(extract('function accountingRoleAllowed(', 'function enforceDepartmentSubmission('), context);
  vm.runInContext(extract('async function getAccountingOverview(', 'async function getAccountingRequisitionDocument('), context);
  vm.runInContext(extract('function validateAccountingReportPage(', 'async function getAccountingJournalPage('), context);
  vm.runInContext(extract('async function getAccountingJournalPage(', '// Normalize financial facts'), context);
  for (const edition of ['school','faith','organization']) for (const Role of ['Teacher','Front Desk','Vendor User','Payroll Officer']) {
    const body = { UserUsername: 'staff', UserRole: 'Super Admin', OrganisationEdition: edition };
    const trusted = applyAuthoritativeActor(body, resolveAuthoritativeDesktopActor(body, [{ Username: 'staff', Role, Active: true }]));
    await assert.rejects(context.getAccountingOverview({}, trusted), error => error.status === 403);
    await assert.rejects(context.getAccountingJournalPage({}, trusted), error => error.status === 403);
  }
});

test('historical ageing excludes later receipts, future invoices and later stored credits', () => {
  assert.equal(buildReceivablesAgeing([invoice], [payment], '2025-01-31')[0].Balance, 100);
  assert.deepEqual(buildReceivablesAgeing([{ ...invoice, Date: '2025-02-01' }], [], '2025-01-31'), []);
  const result = buildReceivablesAgeing([{ ...invoice, Credit: 100, UpdatedAt: '2025-02-01' }], [payment], '2025-01-31');
  assert.equal(result[0].Balance, 100); assert.match(result[0].AgeingWarning, /dated receipts/);
  assert.deepEqual(buildReceivablesAgeing([invoice], [payment], '2025-02-28'), []);
});

test('historical ageing accepts date aliases and flags rather than allocates undated receipts', () => {
  assert.equal(buildReceivablesAgeing([invoice], [{ ...payment, Date: '', paidAt: '2025-02-01' }], '2025-01-31')[0].Balance, 100);
  const result = buildReceivablesAgeing([invoice], [{ ...payment, Date: '' }], '2025-01-31');
  assert.equal(result[0].Balance, 100); assert.match(result[0].AgeingWarning, /without a payment date/);
});

test('a later charge reversal does not erase the earlier historical invoice balance', () => {
  const reversed = { ...invoice, FeeChargeReversed: 'YES', FeeChargeReversalId: 'R1',
    FeeChargeReversalAmount: 100, FeeChargeReleasedCredit: 0, FeeChargeReversedAt: '2025-02-01' };
  assert.equal(buildReceivablesAgeing([reversed], [], '2025-01-31')[0].Balance, 100);
  assert.deepEqual(buildReceivablesAgeing([reversed], [], '2025-02-28'), []);
  assert.equal(accountingFinanceReportRows('invoices', [reversed], { DateTo: '2025-01-31' })[0].Debit, 100);
});

test('all-branch ageing never spends a receipt on another branch sharing the same reference', () => {
  const result = buildReceivablesAgeing([{ ...invoice, BranchId: 'west' }, { ...invoice, InvoiceId: 'I2', BranchId: 'main' }],
    [{ ...payment, BranchId: 'main', Date: '2025-01-20' }], '2025-01-31');
  assert.equal(result.length, 1); assert.equal(result[0].Reference, 'I1'); assert.equal(result[0].Balance, 100);
});

test('dated old stored credit remains represented once; later allocations do not alter paid figures', () => {
  const result = buildReceivablesAgeing([{ ...invoice, Credit: 20, UpdatedAt: '2025-01-04' }],
    [{ ...payment, Amount: 50, Date: '2025-01-20' }], '2025-01-31');
  assert.equal(result[0].PaidAmount, 50); assert.equal(result[0].Balance, 50);
});

test('supplier ageing excludes future bills/payments and unapproved drafts', () => {
  const bill = { BillNo: 'B1', BranchId: 'main', Date: '2025-01-01', Status: 'Paid', Amount: 100, PaidAmount: 100, UpdatedAt: '2025-02-01' };
  const paid = { BillNo: 'B1', BranchId: 'main', Date: '2025-02-01', Amount: 100 };
  assert.equal(buildPayablesAgeing([bill], [paid], '2025-01-31')[0].Balance, 100);
  assert.deepEqual(buildPayablesAgeing([bill], [paid], '2025-02-28'), []);
  assert.deepEqual(buildPayablesAgeing([{ ...bill, Date: '2025-03-01' }, { ...bill, Status: 'Draft' }], [], '2025-01-31'), []);
});

test('ageing applies academic and department scopes after allocation without hiding overdue or not-yet-due debt', () => {
  const invoices = [
    { ...invoice, InvoiceId: 'OLD', Date: '2024-12-01', Department: 'Kitchen', AcademicSession: '2024/2025', Term: 'First' },
    { ...invoice, InvoiceId: 'CLINIC', Department: 'Clinic', DueDate: '2025-03-01', AcademicSession: '2024/2025', Term: 'First' },
    { ...invoice, InvoiceId: 'OTHER-TERM', Department: 'Clinic', Term: 'Second' }
  ];
  const filter = { DateFrom: '2025-01-20', DateTo: '2025-01-31', FinancialYear: '2025',
    Department: 'Clinic', AcademicSession: '2024/2025', Term: 'First' };
  const paid = { ...payment, Date: '2025-01-05', AcademicSession: '2024/2025', Term: 'First' };
  const rows = buildReceivablesAgeing(invoices, [paid], '2025-01-31', filter);
  assert.equal(rows.length, 1); assert.equal(rows[0].Reference, 'CLINIC'); assert.equal(rows[0].Balance, 100);
  assert.equal(rows[0].Bucket, 'Current');
  assert.equal(buildAccountingReport([], [], [], [], filter, invoices, [paid]).dashboard.Receivables, 100);
  const bills = invoices.map(row => ({ ...row, BillNo: row.InvoiceId, Status: 'Posted', PaidAmount: 0 }));
  assert.deepEqual(buildPayablesAgeing(bills, [], '2025-01-31', filter).map(row => row.Reference), ['CLINIC']);
});

test('mixed-department journal totals contain only selected department lines', () => {
  const report = buildAccountingReport([{ Code: '6000', Type: 'Expense' }, { Code: '1020', Type: 'Asset', Group: 'Cash and Bank' }],
    [{ Status: 'Posted', Date: '2025-01-01', Lines: [
      { AccountCode: '6000', Department: 'Clinic', Debit: 100 },
      { AccountCode: '6000', Department: 'Kitchen', Debit: 900 },
      { AccountCode: '1020', Credit: 1000 }
    ] }], [], [], { Department: 'Clinic' });
  assert.equal(report.dashboard.TotalExpenditure, 100);
  assert.equal(report.dashboard.CashPosition, 0);
  assert.match(report.scopeNotice, /not a complete organisation balance sheet/);
});

test('paged server facts retain historical dates and credit cutoff for desktop parity', () => {
  const [fact] = accountingFinanceReportRows('invoices', [{ ...invoice, Credit: 100, UpdatedAt: '2025-02-01' }], { DateTo: '2025-01-31' });
  assert.equal(fact.ReportStoredCreditAsOf, 0);
  assert.equal(accountingFinanceReportRows('payments', [payment])[0].ReportPaymentDate, '2025-02-01');
  assert.equal(buildAccountingReport([], [], [], [], { DateTo: '2025-01-31' }, [invoice], [payment]).dashboard.Receivables, 100);
});
