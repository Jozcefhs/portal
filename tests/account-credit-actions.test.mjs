import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCreditActionAccountingJournal } from '../functions/api/backend.js';

const base = {
  actionId: 'DCA-26-001-CREDIT-100',
  amount: 900000,
  accountRef: 'DCA/26/001',
  branchId: 'main',
  date: '2026-09-24T10:00:00.000Z',
  reference: 'PARENT-REQUEST-100',
  recordedBy: 'Accounts Officer',
  notes: 'Parent instruction recorded'
};

function assertBalanced(journal, expected) {
  assert.equal(journal.Status, 'Posted');
  assert.equal(journal.JournalNo, 'SYS-CREDIT-DCA-26-001-CREDIT-100');
  assert.equal(journal.BranchId, 'main');
  assert.equal(journal.TotalDebit, 900000);
  assert.equal(journal.TotalCredit, 900000);
  assert.deepEqual(journal.Lines.map(({ AccountCode, Debit, Credit }) => ({ AccountCode, Debit, Credit })), expected);
  assert.equal(journal.Lines.reduce((sum, line) => sum + line.Debit - line.Credit, 0), 0);
}

test('a parent refund relieves the advance liability and credits the actual bank account', () => {
  assertBalanced(buildCreditActionAccountingJournal({ ...base, action: 'Refund to Parent', paymentAccount: '1020' }), [
    { AccountCode: '2310', Debit: 900000, Credit: 0 },
    { AccountCode: '1020', Debit: 0, Credit: 900000 }
  ]);
});

test('a transfer to wallet moves the obligation without recording another receipt or revenue', () => {
  assertBalanced(buildCreditActionAccountingJournal({ ...base, action: 'Transfer to Wallet' }), [
    { AccountCode: '2310', Debit: 900000, Credit: 0 },
    { AccountCode: '2200', Debit: 0, Credit: 900000 }
  ]);
});

test('a sibling transfer keeps the total parent liability unchanged and identifies both accounts', () => {
  const journal = buildCreditActionAccountingJournal({ ...base, action: 'Transfer to Sibling', targetAccountRef: 'DCA/26/002' });
  assertBalanced(journal, [
    { AccountCode: '2310', Debit: 900000, Credit: 0 },
    { AccountCode: '2310', Debit: 0, Credit: 900000 }
  ]);
  assert.match(journal.Lines[0].Description, /DCA\/26\/001/);
  assert.match(journal.Lines[1].Description, /DCA\/26\/002/);
});

test('manual credit and debit adjustments require and use an explicit offset account', () => {
  assertBalanced(buildCreditActionAccountingJournal({ ...base, action: 'Manual Credit Adjustment', offsetAccount: '4910' }), [
    { AccountCode: '4910', Debit: 900000, Credit: 0 },
    { AccountCode: '2310', Debit: 0, Credit: 900000 }
  ]);
  assertBalanced(buildCreditActionAccountingJournal({ ...base, action: 'Manual Debit Adjustment', offsetAccount: '4910' }), [
    { AccountCode: '2310', Debit: 900000, Credit: 0 },
    { AccountCode: '4910', Debit: 0, Credit: 900000 }
  ]);
  assert.throws(() => buildCreditActionAccountingJournal({ ...base, action: 'Manual Credit Adjustment' }), /offset/i);
  assert.throws(() => buildCreditActionAccountingJournal({ ...base, action: 'Manual Credit Adjustment', offsetAccount: '2310' }), /offset/i);
  assert.throws(() => buildCreditActionAccountingJournal({ ...base, action: 'Refund to Parent' }), /cash or bank/i);
});

test('credit-action subledger, liability journal and idempotency marker commit together', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const action = source.split('async function recordCreditAction(env, body) {', 2)[1]
    .split('async function ', 1)[0];
  assert.match(action, /accountingEditionForRequest\(env\) !== 'school'/);
  assert.match(action, /accountingWriteBranch\(body, account\)/);
  assert.match(action, /const sourceReconciliation = await syncSchoolAccountCreditJournals/);
  assert.match(action, /sourceReconciliation\.unreconciledLegacyActions/);
  assert.match(action, /await batchUpsertDocuments\(env, \[/);
  assert.match(action, /collectionPath: 'creditActions'.*exists: false/s);
  assert.match(action, /collectionPath: 'accountingJournals'.*exists: false/s);
});

test('payment reconciliation runs before a new receipt is saved, and global sync checks receipts before invoice-credit baselines', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const payment = source.split('export async function recordManualPayment(env, body) {', 2)[1]
    .split('export async function ', 1)[0];
  const firstPaymentCreate = payment.indexOf("createDocumentIfAbsent(env, 'payments'");
  const paymentPreflight = payment.indexOf('syncSchoolAccountCreditJournals(env, accountRef', payment.indexOf('if (!payment) {'));
  assert.ok(firstPaymentCreate > 0);
  assert.ok(paymentPreflight > 0 && paymentPreflight < firstPaymentCreate);
  const globalSync = source.split('async function syncRevenueToAccounting(env) {', 2)[1]
    .split('async function ', 1)[0];
  const receiptPass = globalSync.indexOf('for (const row of payments)');
  const creditPass = globalSync.indexOf('const gap = schoolInvoiceCreditJournalGap(row, journals)');
  assert.ok(receiptPass > 0 && creditPass > receiptPass);
});
