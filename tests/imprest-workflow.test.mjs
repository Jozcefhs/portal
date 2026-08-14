import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  IMPREST_ADVANCE_ACCOUNT,
  buildImprestIssueJournal,
  buildImprestRetirementJournal,
  imprestReportSummary,
  isOpenImprestStatus,
  validateImprestRetirement
} from '../functions/lib/imprest.js';

const portalRoot = new URL('../', import.meta.url);
const [workflowApi, backendApi, adminJs, adminHtml, portalCss, desktopAccounting] = await Promise.all([
  readFile(new URL('functions/api/finance-workflow.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/backend.js', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('admin.html', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('../../suite/modules/accounting.py', import.meta.url), 'utf8')
]);

const imprest = {
  ImprestNo: 'IMP-001',
  Date: '2026-08-14',
  AmountApproved: 100000,
  AmountIssued: 100000,
  CustodianName: 'Ada Staff',
  Purpose: 'Field supplies',
  Department: 'Operations',
  BranchId: 'main',
  PaymentAccount: '1020'
};

test('imprest issue posts to staff advances instead of an expense', () => {
  const journal = buildImprestIssueJournal(imprest, 'Accounts');
  assert.equal(IMPREST_ADVANCE_ACCOUNT, '1080');
  assert.deepEqual(journal.Lines.map(({ AccountCode, Debit, Credit }) => ({ AccountCode, Debit, Credit })), [
    { AccountCode: '1080', Debit: 100000, Credit: 0 },
    { AccountCode: '1020', Debit: 0, Credit: 100000 }
  ]);
  assert.equal(journal.Lines.reduce((sum, line) => sum + line.Debit, 0), journal.Lines.reduce((sum, line) => sum + line.Credit, 0));
});

test('retirement requires receipts and clears the entire staff advance', () => {
  const retired = {
    ...imprest,
    ReturnReference: 'CASH-RETURN-7',
    RetirementLines: [
      { Date: '2026-08-14', Description: 'Transport', ExpenseAccount: '6030', Amount: 35000, ReceiptUrl: 'https://files.example/transport.jpg' },
      { Date: '2026-08-14', Description: 'Stationery', ExpenseAccount: '6090', Amount: 25000, ReceiptUrl: 'https://files.example/stationery.jpg' }
    ]
  };
  const journal = buildImprestRetirementJournal(retired, 'Accounts');
  assert.equal(journal.ExpenseTotal, 60000);
  assert.equal(journal.ReturnedAmount, 40000);
  assert.deepEqual(journal.Lines.map((line) => [line.AccountCode, line.Debit, line.Credit]), [
    ['6030', 35000, 0],
    ['6090', 25000, 0],
    ['1020', 40000, 0],
    ['1080', 0, 100000]
  ]);
  assert.throws(() => validateImprestRetirement(1000, [
    { Date: '2026-08-14', Description: 'Taxi', ExpenseAccount: '6030', Amount: 1000 }
  ]), /receipt URL/i);
  assert.throws(() => validateImprestRetirement(1000, [
    { Date: '2026-08-14', Description: 'Taxi', ExpenseAccount: '6030', Amount: 1200, ReceiptUrl: 'https://files.example/taxi.jpg' }
  ]), /cannot exceed/i);
  assert.throws(() => validateImprestRetirement(1000, [
    { Date: '2026-02-31', Description: 'Taxi', ExpenseAccount: '6030', Amount: 1000, ReceiptUrl: 'https://files.example/taxi.jpg' }
  ]), /valid date/i);
});

test('open and overdue imprests are reported without treating retired records as outstanding', () => {
  assert.equal(isOpenImprestStatus('Retirement Submitted'), true);
  assert.equal(isOpenImprestStatus('Retired'), false);
  const summary = imprestReportSummary([
    { Status: 'Issued', DueDate: '2026-08-10', AmountIssued: 100000, ExpenseTotal: 0, ReturnedAmount: 0 },
    { Status: 'Retired', DueDate: '2026-08-01', AmountIssued: 50000, ExpenseTotal: 45000, ReturnedAmount: 5000 }
  ], '2026-08-14');
  assert.deepEqual(summary, { total: 2, open: 1, overdue: 1, outstanding: 100000 });
});

test('web and desktop expose the same controlled imprest lifecycle', () => {
  for (const action of ['submitimprest', 'reviewimprest', 'issueimprest', 'submitimprestretirement', 'reviewimprestretirement']) {
    assert.match(workflowApi, new RegExp(`action === '${action}'`));
  }
  for (const action of ['submitAccountingImprest', 'reviewAccountingImprest', 'issueAccountingImprest', 'submitAccountingImprestRetirement', 'verifyAccountingImprestRetirement']) {
    assert.match(backendApi, new RegExp(`case '${action}'`));
    assert.match(desktopAccounting, new RegExp(action));
  }
  assert.match(backendApi, /\['1080', 'Staff Imprest and Cash Advances', 'Asset', 'Current Assets', 'Debit'\]/);
  assert.match(adminJs, /Imprest &amp; Petty Cash/);
  assert.match(adminJs, /Only one open imprest is allowed per staff custodian/);
  assert.match(adminJs, /const imprestRetirementDialog =/);
  assert.match(adminJs, /\$\{submissionDialogs\}[\s\S]*\$\{imprestRetirementDialog\}/);
  assert.match(adminHtml, /financeDecisionExtra/);
  assert.match(portalCss, /\.imprest-retirement-summary/);
  assert.match(desktopAccounting, /\(self\.imprest_tab, "Imprest & Petty Cash"\)/);
  assert.match(workflowApi, /accountingImprestOpenClaims/);
  assert.match(backendApi, /accountingImprestOpenClaims/);
  assert.match(workflowApi, /OPEN_IMPREST_EXISTS/);
  assert.match(backendApi, /OPEN_IMPREST_EXISTS/);
});

test('retirement remains available independently of new-request permission', () => {
  const gatedStart = adminJs.indexOf('const submissionDialogs');
  const retirementStart = adminJs.indexOf('const imprestRetirementDialog');
  assert.ok(gatedStart >= 0 && retirementStart > gatedStart);
  assert.doesNotMatch(adminJs.slice(gatedStart, retirementStart), /id="imprestRetirementDialog"/);
  assert.match(adminJs.slice(retirementStart), /id="imprestRetirementDialog"/);
  assert.match(adminJs, /data-open-imprest-retirement/);
  assert.match(adminJs, /const dialog = form\.closest\('dialog'\)/);
  assert.match(adminJs, /dialog\?\.querySelector\('\[data-imprest-retirement-reference\]'\)/);
  assert.doesNotMatch(adminJs, /form\.querySelector\('\[data-imprest-retirement-reference\]'\)\.textContent/);
  assert.match(desktopAccounting, /selected = tree\.selection\(\)/);
});
