import test from 'node:test';
import assert from 'node:assert/strict';
import { getAccountsOverview, calculateAccountFinancialSummary } from '../functions/api/backend.js';

const scope = { AccountRef: 'TEST/23/1353', AdmissionNo: 'TEST/23/1353', BranchId: 'main',
  SchoolSection: 'secondary', AcademicSession: '2026/2027', Term: 'First Term' };
function snapshot() {
  return { schoolProfile: {}, accounts: [], applications: [], billingCategories: [], accountSummaries: [],
    students: [{ ...scope, DisplayName: 'Synthetic Student', ClassName: 'Grade 10', Status: 'Enrolled', Enrolled: 'YES' }],
    feeItems: [{ ...scope, FeeCode: 'TUITION', FeeCategory: 'School Fee', Amount: 586660, Active: 'YES', ClassName: 'Grade 10' }],
    invoices: [{ ...scope, InvoiceId: 'INV1', Amount: 586660, Credit: 128000, FeeCategory: 'School Fee', FeeCode: 'TUITION' }],
    payments: [{ ...scope, Reference: 'PAY1', Amount: 128000, FeeCategory: 'School Fee', FeeCode: 'SCHOOL_FEES_TOTAL', Status: 'Paid' }],
    ledger: [{ ...scope, LedgerNo: 'LED-PAY1', Reference: 'PAY1', Credit: 128000, Debit: 0,
      FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee', EntryType: 'Payment' }] };
}
async function totals(data) {
  const before = structuredClone(data);
  const result = await getAccountsOverview({}, data, { BranchId: 'main' });
  assert.deepEqual(data, before, 'reads never mutate or reconstruct financial records');
  return result.accounts.find(row => row.AccountRef === scope.AccountRef);
}
function debit(data, amount, FeeCode = 'PAYMENT_CORRECTION') {
  data.ledger.push({ ...scope, LedgerNo: `OUT-${FeeCode}`, Reference: `ACTION-${FeeCode}`, Debit: amount, Credit: 0,
    FeeCategory: 'Account Credit', FeeCode,
    Source: FeeCode === 'PAYMENT_CORRECTION' ? 'Manual Payment Correction' : 'Accounts Credit Action' });
}

test('realistic fees and net payments remain stable across repeated refresh after a payment reduction', async () => {
  const data = snapshot();
  data.payments[0].CorrectionTotal = data.ledger[0].CorrectionTotal = 28000;
  data.invoices[0].Credit = 100000;
  debit(data, 28000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await totals(data);
    assert.equal(row.TotalDebit, 586660);
    assert.equal(row.TotalCredit, 100000);
    assert.equal(row.TotalReceipts, 100000);
    assert.equal(row.GrossReceipts, 128000);
    assert.equal(row.Balance, 486660);
    assert.equal(row.SchoolFeeOutstanding, 486660);
    assert.equal(calculateAccountFinancialSummary(data.invoices, data.ledger).OutstandingBalance, row.OutstandingBalance);
  }
});

for (const FeeCode of ['CREDIT_ADJUSTMENT_DEBIT', 'CREDIT_REFUND', 'CREDIT_TO_WALLET', 'CREDIT_TRANSFER_OUT']) {
  test(`${FeeCode} reduces available credit without increasing billed fees or generating a receipt`, async () => {
    const data = snapshot();
    data.payments[0].Amount = data.ledger[0].Credit = 600000;
    data.invoices[0].Credit = 586660;
    debit(data, 10000, FeeCode);
    const row = await totals(data);
    assert.equal(row.TotalDebit, 586660);
    assert.equal(row.TotalCredit, 590000);
    assert.equal(row.Balance, -3340);
    assert.equal(row.ExcessCredit, 3340);
    assert.equal(row.TotalReceipts, 600000, 'historical receipts remain visible for transfers/refunds');
    assert.equal(data.payments.length, 1);
    assert.equal(data.invoices.length, 1);
  });
}

test('fee-setup fallback never hides a reduction when the invoice has not been created', async () => {
  const data = snapshot(); data.invoices = [];
  debit(data, 28000);
  const row = await totals(data);
  assert.equal(row.TotalDebit, 586660);
  assert.equal(row.TotalCredit, 100000);
  assert.equal(row.OutstandingBalance, 486660);
  assert.equal(data.invoices.length, 0, 'reading totals must not recreate a deleted invoice');
});

test('corrections are scoped to the account and academic period and do not deduct wallet or optional receipts', async () => {
  const data = snapshot();
  data.ledger.push({ ...scope, LedgerNo: 'WALLET', FeeCategory: 'Wallet', Credit: 10000, Debit: 0 },
    { ...scope, LedgerNo: 'WALLET-OUT', FeeCategory: 'Wallet', FeeCode: 'PAYMENT_CORRECTION', Debit: 2000 },
    { ...scope, LedgerNo: 'CLUB', FeeCategory: 'Club', FeeCode: 'CLUB_CHESS', Credit: 5000 },
    { ...scope, LedgerNo: 'OTHER-OUT', AccountRef: 'OTHER', AdmissionNo: 'OTHER', FeeCategory: 'Account Credit', Debit: 5000 },
    { ...scope, LedgerNo: 'OLD-OUT', AcademicSession: '2025/2026', FeeCategory: 'Account Credit', Debit: 5000 },
    { ...scope, LedgerNo: 'FUTURE-OUT', Term: 'Second Term', FeeCategory: 'Account Credit', Debit: 5000 });
  const row = await totals(data);
  assert.equal(row.TotalDebit, 586660);
  assert.equal(row.TotalCredit, 128000);
  assert.equal(row.TotalReceipts, 133000);
  assert.equal(row.WalletBalance, 8000);
});
