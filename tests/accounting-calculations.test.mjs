import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountingDestinationForPayment,
  accountingDestinationForWalletPurchase,
  applyBillingCategoryOverrides,
  buildAccountingReport,
  buildBudgetVsActual,
  buildChurchDonationAccountingJournal,
  buildGatewayCollectionsReport,
  buildReceivablesAgeing,
  buildWalletPurchaseAccountingJournal,
  calculateAccountFinancialSummary,
  calculateInvoiceCreditAllocations,
  financialRowMatchesAccount,
  financialRowMatchesLinkedApplication,
  formSaleFinancialAmounts,
  isNewIntakeApplication,
  isSchoolInvoiceCredit,
  isSchoolFeesTotalCode,
  isStandaloneAcceptanceInvoiceForPayment,
  paymentCreditedAmount,
  reconciliationDifference,
  sameFinancialPeriod,
  shouldResolveStudentForPayable
} from '../functions/api/backend.js';

test('admitted applications without an explicit intake category are new intake', () => {
  assert.equal(isNewIntakeApplication({ ResultStatus: 'Admitted', Status: 'Accepted' }), true);
  assert.equal(isNewIntakeApplication({ ResultStatus: 'Admitted', EnrollmentCategory: 'Returning' }), false);
  assert.equal(isNewIntakeApplication({ Status: 'Active' }), false);
  assert.equal(isNewIntakeApplication({ Status: 'Active', EnrollmentCategory: 'Imported' }), false);
});

test('acceptance-fee applicants do not trigger an enrolled-student collection search', () => {
  assert.equal(shouldResolveStudentForPayable({ Status: 'Admitted', Enrolled: 'NO' }, 'Application'), false);
  assert.equal(shouldResolveStudentForPayable({ Status: 'Enrolled', Enrolled: 'YES' }, 'Application'), true);
  assert.equal(shouldResolveStudentForPayable({ Status: 'Active' }, 'Student'), true);
});

test('school-fees-total code is shared by payment initialization and recording', () => {
  assert.equal(isSchoolFeesTotalCode('SCHOOL_FEES_TOTAL'), true);
  assert.equal(isSchoolFeesTotalCode('school fees total'), true);
  assert.equal(isSchoolFeesTotalCode('ACCEPTANCE_FEE'), false);
});

test('acceptance deposit and remaining school fee settle one school invoice without excess credit', () => {
  assert.equal(isSchoolInvoiceCredit({
    FeeCode: 'ACCEPT_DAY_JSS1',
    FeeName: 'Acceptance fee',
    FeeCategory: 'Admission',
    Credit: 100000
  }), true);
  assert.equal(isSchoolInvoiceCredit({
    FeeCode: 'SCHOOL_FEES_TOTAL',
    FeeCategory: 'School Fee',
    Credit: 194600
  }), true);
  const summary = calculateAccountFinancialSummary(
    [{ AccountRef: 'DCA/26/001', FeeCode: 'TUITION', Debit: 294600, Amount: 294600 }],
    [
      { AccountRef: 'DCA/26/000001', FeeCode: 'ACCEPT_DAY_JSS1', FeeName: 'Acceptance fee', FeeCategory: 'Admission', Credit: 100000 },
      { AccountRef: 'DCA/26/001', FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee', Credit: 194600 }
    ],
    'DCA/26/001'
  );
  assert.equal(summary.TotalDebit, 294600);
  assert.equal(summary.TotalCredit, 294600);
  assert.equal(summary.OutstandingBalance, 0);
  assert.equal(summary.CreditBalance, 0);
});

test('acceptance deposit is not duplicated as a standalone invoice', () => {
  const payment = {
    AccountRef: 'DCA/26/000002',
    ApplicationReference: 'DCA/26/000002',
    FeeCode: 'ACCEPT_B_JSS1_TO_SS1_FIRST_TERM',
    AcademicSession: '2026/2027',
    Term: 'First Term'
  };
  assert.equal(isStandaloneAcceptanceInvoiceForPayment({
    ApplicationReference: 'DCA/26/000002',
    FeeCode: 'LEGACY_ACCEPTANCE',
    FeeName: 'Acceptance fee',
    FeeCategory: 'Admission',
    AcademicSession: '',
    Term: '',
    Debit: 150000
  }, payment), true);
  assert.equal(isStandaloneAcceptanceInvoiceForPayment({
    AccountRef: 'DCA/26/000002',
    FeeCode: 'TUITION',
    FeeName: 'Tuition',
    FeeCategory: 'School Fee',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Debit: 294600
  }, payment), false);
});

test('finance reports expose gross collections, Paystack charges, and net form revenue separately', () => {
  const report = buildGatewayCollectionsReport([{
    ReceiptNo: 'FORM-1',
    ApplicantName: 'Test Applicant',
    PaymentDate: '2026-07-23',
    PaymentMethod: 'Online',
    PaymentReference: 'PS-FORM-1',
    FormAmount: 10000,
    AmountPaid: 10000,
    GrossAmount: 10300,
    GatewayFee: 300,
    NetAmount: 10000
  }], [{
    ChargeId: 'PAYSTACK-FORM-FEE-PS-FORM-1',
    Date: '2026-07-23',
    Reference: 'PS-FORM-1',
    Source: 'Paystack Admission Form',
    GrossCollection: 10300,
    Amount: 300,
    NetSettlement: 10000,
    Treatment: 'DeductedBeforeRevenueRecognition',
    Status: 'Recorded'
  }]);

  assert.equal(report.summary.FormSalesGross, 10300);
  assert.equal(report.summary.FormSalesCharges, 300);
  assert.equal(report.summary.FormSalesNet, 10000);
  assert.equal(report.summary.PaystackCharges, 300);
  assert.deepEqual(
    report.formSales.map((row) => [row.GrossCollection, row.PaystackCharge, row.NetRevenue]),
    [[10300, 300, 10000]]
  );
  assert.deepEqual(
    report.onlineTransactions.map((row) => [row.ApplicantName, row.Reference, row.GrossCollection]),
    [['Test Applicant', 'PS-FORM-1', 10300]]
  );
});

test('online collections register includes fee payments and church donations behind the totals', () => {
  const report = buildGatewayCollectionsReport([], [{
    ChargeId: 'PAYSTACK-FEE-PS-DON-1',
    Date: '2026-07-27',
    Reference: 'PS-DON-1',
    Source: 'Church Donation / Paystack',
    GrossCollection: 30000,
    Amount: 450,
    NetSettlement: 29550,
    Status: 'Recorded'
  }, {
    ChargeId: 'PAYSTACK-FEE-PS-FEE-1',
    Date: '2026-07-28',
    Reference: 'PS-FEE-1',
    Source: 'Paystack',
    GrossCollection: 750000,
    Amount: 7500,
    NetSettlement: 742500,
    Status: 'Recorded'
  }], {}, [{
    PaymentId: 'PAY-1',
    ReceiptNo: 'RCT-FEE-1',
    DisplayName: 'Example Student',
    PaidAt: '2026-07-28T09:00:00.000Z',
    Gateway: 'Paystack',
    Reference: 'PS-FEE-1',
    GrossAmount: 750000,
    GatewayFee: 7500,
    NetAmount: 742500,
    Currency: 'NGN'
  }], [{
    DonationId: 'DON-1',
    ReceiptNo: 'CHURCH/DON/2026/1',
    DonorName: 'Example Donor',
    PaidAt: '2026-07-27T09:00:00.000Z',
    PaymentMethod: 'ONLINE',
    Gateway: 'Paystack',
    Reference: 'PS-DON-1',
    Status: 'Paid',
    GrossAmount: 30000,
    GatewayFee: 450,
    NetAmount: 29550,
    Currency: 'NGN'
  }]);

  assert.equal(report.summary.GrossCollections, 780000);
  assert.deepEqual(
    report.onlineTransactions.map((row) => [
      row.ReceiptNo, row.ApplicantName, row.Reference, row.GrossCollection, row.PaystackCharge, row.NetRevenue
    ]),
    [
      ['RCT-FEE-1', 'Example Student', 'PS-FEE-1', 750000, 7500, 742500],
      ['CHURCH/DON/2026/1', 'Example Donor', 'PS-DON-1', 30000, 450, 29550]
    ]
  );
  assert.deepEqual(report.formSales, report.onlineTransactions);
  assert.deepEqual(report.admissionFormSales, []);
});

test('paid church donations post gross income, net clearing and gateway charges once', () => {
  const journal = buildChurchDonationAccountingJournal({
    DonationId: 'DON-1',
    DonorName: 'Example Donor',
    PaymentType: 'Thanksgiving',
    PaymentMethod: 'ONLINE',
    Gateway: 'Paystack',
    Reference: 'PS-DON-1',
    Status: 'Paid',
    BranchId: 'main',
    PaidAt: '2026-07-27T10:00:00.000Z',
    Amount: 100000,
    GrossAmount: 100000,
    GatewayFee: 1500,
    NetAmount: 98500
  });

  assert.equal(journal.JournalNo, 'SYS-DON-PS-DON-1');
  assert.equal(journal.Source, 'Church Donation');
  assert.equal(journal.TotalDebit, 100000);
  assert.equal(journal.TotalCredit, 100000);
  assert.deepEqual(
    journal.Lines.map((line) => [line.AccountCode, line.Debit, line.Credit]),
    [['1030', 98500, 0], ['6060', 1500, 0], ['4080', 0, 100000]]
  );
});

test('pending donations do not enter accounting and paid cash donations remain balanced', () => {
  assert.equal(buildChurchDonationAccountingJournal({
    DonationId: 'DON-PENDING', Status: 'Pending', Amount: 5000
  }), null);

  const journal = buildChurchDonationAccountingJournal({
    DonationId: 'DON-CASH', Status: 'Paid', PaymentMethod: 'CASH',
    Amount: 5000, DonorName: 'Cash Donor'
  });
  assert.deepEqual(
    journal.Lines.map((line) => [line.AccountCode, line.Debit, line.Credit]),
    [['1010', 5000, 0], ['4080', 0, 5000]]
  );
});

test('a giving type posts to its assigned individual income account', () => {
  const journal = buildChurchDonationAccountingJournal({
    DonationId: 'DON-TITHE',
    Status: 'Paid',
    PaymentMethod: 'BANK TRANSFER',
    PaymentType: 'Tithe',
    Amount: 25000
  }, {}, {
    GivingTypeId: 'TITHE',
    Name: 'Tithe',
    RevenueAccountCode: '4160'
  });
  assert.equal(journal.GivingTypeId, 'TITHE');
  assert.equal(journal.RevenueAccountCode, '4160');
  assert.deepEqual(
    journal.Lines.map((line) => [line.AccountCode, line.Debit, line.Credit]),
    [['1020', 25000, 0], ['4160', 0, 25000]]
  );
});

test('a padded account reference cannot receive another student payment', () => {
  const payment = { AccountRef: 'DCA/26/001', Credit: 92843.92 };
  assert.equal(financialRowMatchesAccount(payment, {
    AccountRef: 'DCA/26/001', AdmissionNo: 'DCA/26/001'
  }), true);
  assert.equal(financialRowMatchesAccount(payment, {
    AccountRef: 'DCA/26/000001', AdmissionNo: 'DCA/26/001'
  }), false);
});

test('identity matching does not cross AccountRef and AdmissionNo fields', () => {
  assert.equal(financialRowMatchesAccount(
    { AccountRef: 'A-100' },
    { AccountRef: 'B-200', AdmissionNo: 'A-100' }
  ), false);
});

test('pre-enrollment payments follow the exact application reference into the enrolled account', () => {
  const payment = {
    AccountRef: 'DCA/26/000002',
    ApplicationReference: 'DCA/26/000002',
    Credit: 150000
  };
  const enrolledAccount = {
    AccountRef: 'DCA/26/002',
    AdmissionNo: 'DCA/26/002',
    ApplicationReference: 'DCA/26/000002'
  };
  assert.equal(financialRowMatchesAccount(payment, enrolledAccount), false);
  assert.equal(financialRowMatchesLinkedApplication(payment, enrolledAccount), true);
  assert.equal(financialRowMatchesLinkedApplication(payment, {
    AccountRef: 'DCA/26/002',
    ApplicationReference: 'DCA/26/000003'
  }), false);
});

test('Paystack credits the student with the net amount requested by policy', () => {
  assert.equal(paymentCreditedAmount({
    Amount: 100000, GrossAmount: 100000, GatewayFee: 1500, NetAmount: 98500
  }), 98500);
  assert.equal(paymentCreditedAmount({ Amount: 100000, GatewayFee: 0 }), 100000);
});

test('admission form sales exclude Paystack charges from recognized revenue', () => {
  assert.deepEqual(formSaleFinancialAmounts({
    FormAmount: 10000,
    GrossAmount: 10300,
    GatewayFee: 300,
    NetAmount: 10000,
    AmountPaid: 10300
  }), {
    FormAmount: 10000,
    GrossAmount: 10300,
    GatewayFee: 300,
    NetAmount: 10000,
    RecognizedAmount: 10000
  });
});

test('legacy admission form currency strings are normalized without losing Paystack charges', () => {
  assert.deepEqual(formSaleFinancialAmounts({
    AmountPaid: 'â¦15,329.95'
  }, 15000), {
    FormAmount: 15000,
    GrossAmount: 15329.95,
    GatewayFee: 329.95,
    NetAmount: 15000,
    RecognizedAmount: 15000
  });
  assert.deepEqual(formSaleFinancialAmounts({
    AmountPaid: 'â¦15,000'
  }, 15000), {
    FormAmount: 15000,
    GrossAmount: 15000,
    GatewayFee: 0,
    NetAmount: 15000,
    RecognizedAmount: 15000
  });
});

test('payment accounting routes wallets, stores, receivables, and direct revenue correctly', () => {
  assert.equal(accountingDestinationForPayment({ FeeCode: 'WALLET_TOPUP' }), '2200');
  assert.equal(accountingDestinationForPayment({ FeeCode: 'STORE_CART' }), '4040');
  assert.equal(accountingDestinationForPayment({
    Department: 'Uniform Store',
    FeeCode: 'UNIFORM_ACCESSORY',
    FeeName: 'School Belt'
  }), '4040');
  assert.equal(accountingDestinationForPayment({
    FeeCode: 'OTHER_ACCESSORY',
    FeeName: 'Sports Bag',
    FeeCategory: 'General',
    Metadata: JSON.stringify({
      metadata: {
        storeCart: [{ StoreType: 'Uniform Store', ItemName: 'Sports Bag', Amount: 2500 }]
      }
    })
  }), '4040');
  assert.equal(accountingDestinationForPayment({ FeeCode: 'TUITION', FeeCategory: 'School Fee' }, true), '1100');
  assert.equal(accountingDestinationForPayment({ FeeCode: 'TUITION', FeeCategory: 'School Fee' }, false), '4000');
  assert.equal(accountingDestinationForPayment({ FeeCode: 'ACCEPTANCE_FEE', FeeCategory: 'Admission' }, false), '4110');
});

test('wallet purchase destination follows department context and defaults to Other Income when unknown', () => {
  assert.equal(accountingDestinationForWalletPurchase({ Department: 'Bookstore' }), '4040');
  assert.equal(accountingDestinationForWalletPurchase({
    Metadata: JSON.stringify({
      metadata: {
        storeType: 'Uniform Store'
      }
    })
  }), '4040');
  assert.equal(accountingDestinationForWalletPurchase({
    Department: 'Tuck Shop',
    FeeCategory: 'Store',
    FeeCode: 'BOOK_ORDER'
  }), '4040');
  assert.equal(accountingDestinationForWalletPurchase({
    FeeCategory: 'Wallet',
    EntryType: 'Wallet Purchase',
    Metadata: JSON.stringify({ department: 'Tuck Shop' })
  }), '4040');
  assert.equal(accountingDestinationForWalletPurchase({ Department: 'Finance', FeeCategory: 'Admission', FeeCode: 'TUITION' }), '4110');
  assert.equal(accountingDestinationForWalletPurchase({ FeeCategory: 'Unknown', FeeCode: 'X' }), '4090');
});

test('wallet purchase builds a balanced deterministic accounting journal', () => {
  const purchase = {
    LedgerNo: 'WALLET-20260726-001',
    Date: '2026-07-26T10:30:00.000Z',
    EntryType: 'Wallet Purchase',
    FeeCategory: 'Wallet',
    AccountRef: 'DIGC-001',
    DisplayName: 'Test Student',
    Description: 'Lunch',
    Debit: 2500,
    Reference: 'POS-001',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Metadata: JSON.stringify({ department: 'Tuck Shop' })
  };
  const journal = buildWalletPurchaseAccountingJournal(purchase);
  assert.equal(journal.JournalNo, 'SYS-WALLET-WALLET-20260726-001');
  assert.equal(journal.Source, 'Wallet Purchase');
  assert.equal(journal.SourceId, purchase.LedgerNo);
  assert.equal(journal.Reference, 'POS-001');
  assert.equal(journal.Status, 'Posted');
  assert.equal(journal.Department, 'Tuck Shop');
  assert.deepEqual(journal.Lines.map((line) => [line.AccountCode, line.Debit, line.Credit]), [
    ['2200', 2500, 0],
    ['4040', 0, 2500]
  ]);
  assert.equal(journal.TotalDebit, journal.TotalCredit);
  assert.equal(buildWalletPurchaseAccountingJournal(purchase).JournalNo, journal.JournalNo);
});

test('wallet accounting builder ignores top-ups and invalid purchase rows', () => {
  assert.equal(buildWalletPurchaseAccountingJournal({
    LedgerNo: 'WALLET-TOPUP-001',
    EntryType: 'Wallet Top-up',
    FeeCode: 'WALLET_TOPUP',
    Credit: 5000
  }), null);
  assert.equal(buildWalletPurchaseAccountingJournal({
    LedgerNo: 'WALLET-PURCHASE-EMPTY',
    EntryType: 'Wallet Purchase',
    Debit: 0
  }), null);
});

test('financial periods require the same session and term', () => {
  assert.equal(sameFinancialPeriod({ AcademicSession: '2026/2027', Term: 'First Term' }, '2026/2027', 'First Term'), true);
  assert.equal(sameFinancialPeriod({ AcademicSession: '2025/2026', Term: 'First Term' }, '2026/2027', 'First Term'), false);
  assert.equal(sameFinancialPeriod({ AcademicSession: '2026/2027', Term: 'Second Term' }, '2026/2027', 'First Term'), false);
});

test('legacy ledger rows with blank session/term still report as revenue in period filters', () => {
  const chart = [{ Code: '4040', Name: 'Books and Uniform Revenue', Type: 'Revenue', Group: 'Operating Revenue', Direction: 'Credit' }];
  const journals = [{
    Date: '2026-07-23',
    Status: 'Posted',
    AcademicSession: '',
    Term: '',
    Lines: [
      { AccountCode: '2200', Debit: 10000, Credit: 0 },
      { AccountCode: '4040', Debit: 0, Credit: 10000 }
    ]
  }];
  const report = buildAccountingReport(chart, journals, [], [], {
    AcademicSession: '2026/2027',
    Term: 'First Term',
    DateFrom: '2026-07-01',
    DateTo: '2026-07-31',
    FinancialYear: '2026'
  });
  assert.equal(report.dashboard.GrossRevenue, 10000);
  assert.equal(report.dashboard.NetRevenue, 10000);

  const reportForDifferentPeriod = buildAccountingReport(chart, journals, [], [], {
    AcademicSession: '2025/2026',
    Term: 'First Term',
    DateFrom: '2025-07-01',
    DateTo: '2025-07-31',
    FinancialYear: '2025'
  });
  assert.equal(reportForDifferentPeriod.dashboard.GrossRevenue, 0);
});

test('cash position includes all cash-and-bank accounts, not only default codes', () => {
  const chart = [
    { Code: '1010', Name: 'Cash on Hand', Type: 'Asset', Group: 'Cash and Bank', Direction: 'Debit' },
    { Code: '1040', Name: 'School Safe', Type: 'Asset', Group: 'Cash and Bank', Direction: 'Debit' },
    { Code: '1200', Name: 'Inventory', Type: 'Asset', Group: 'Current Assets', Direction: 'Debit' },
    { Code: '4000', Name: 'School Fees Revenue', Type: 'Revenue', Group: 'Operating Revenue', Direction: 'Credit' }
  ];
  const report = buildAccountingReport(chart, [{
    Date: '2026-09-01',
    Status: 'Posted',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Lines: [
      { AccountCode: '1040', Debit: 30000, Credit: 0 },
      { AccountCode: '1200', Debit: 2000, Credit: 0 },
      { AccountCode: '4000', Debit: 0, Credit: 30000 }
    ]
  }], [], [], {
    DateFrom: '2026-09-01',
    DateTo: '2026-09-30',
    FinancialYear: '2026',
    AcademicSession: '2026/2027',
    Term: 'First Term'
  });
  assert.equal(report.dashboard.CashPosition, 30000);
  assert.equal(report.dashboard.Assets, 32000);
});

test('budget remaining remains negative when budget has been overspent', () => {
  const chart = [
    { Code: '6010', Name: 'Utilities', Type: 'Expense', Group: 'Operating Expense', Direction: 'Debit' }
  ];
  const report = buildAccountingReport(chart, [{
    Date: '2026-09-05',
    Status: 'Posted',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Lines: [{ AccountCode: '6010', Debit: 3000, Credit: 0 }]
  }], [], [{
    FinancialYear: '2026',
    Department: '',
    AccountCode: '6010',
    Amount: 2000,
    AcademicSession: '2026/2027',
    Term: 'First Term'
  }], {
    DateFrom: '2026-09-01',
    DateTo: '2026-09-30',
    FinancialYear: '2026',
    AcademicSession: '2026/2027',
    Term: 'First Term'
  });
  assert.equal(report.dashboard.BudgetRemaining, -1000);
});

test('receivables card can use outstanding invoices when journals are not yet synchronized', () => {
  const report = buildAccountingReport([], [], [], [], {
    DateFrom: '2026-01-01',
    DateTo: '2026-12-31',
    FinancialYear: '2026'
  }, [{
    InvoiceId: 'INV-1',
    AccountRef: 'DCA/26/001',
    FeeCode: 'TUITION',
    FeeCategory: 'School Fee',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Date: '2026-09-01',
    Debit: 100000,
    Credit: 30000,
    Balance: 70000
  }, {
    InvoiceId: 'INV-2',
    AccountRef: 'DCA/26/002',
    FeeCode: 'UNIFORM',
    FeeCategory: 'Other',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Date: '2026-09-10',
    Debit: 5000,
    Credit: 7000,
    Balance: 0
  }]);

  assert.equal(report.dashboard.Receivables, 70000);
});

test('receivables card is non-negative after overcollected journal activity', () => {
  const report = buildAccountingReport([], [{
    JournalNo: 'J-REV',
    Status: 'Posted',
    Date: '2026-09-12',
    Lines: [
      { AccountCode: '1100', Debit: 0, Credit: 30000, Description: 'Receivables overcredit reversal' },
      { AccountCode: '4000', Debit: 30000, Credit: 0, Description: 'Offsetting tuition credit' }
    ]
  }], [], [], {
    DateFrom: '2026-01-01',
    DateTo: '2026-12-31',
    FinancialYear: '2026'
  }, []);
  assert.equal(report.dashboard.Receivables, 0);
});

test('overpayment beyond invoice balance moves to overpayment liability not negative AR', () => {
  const report = buildAccountingReport([
    { Code: '1010', Name: 'Cash on Hand', Type: 'Asset', Group: 'Cash and Bank', Direction: 'Debit' },
    { Code: '1100', Name: 'Student Accounts Receivable', Type: 'Asset', Group: 'Receivables', Direction: 'Debit' },
    { Code: '2310', Name: 'Student Overpayment Liability', Type: 'Liability', Group: 'Student Overpayments', Direction: 'Credit' },
    { Code: '4000', Name: 'Tuition and School Fee Revenue', Type: 'Revenue', Group: 'Operating Revenue', Direction: 'Credit' }
  ], [{
    JournalNo: 'J-RECEIPT',
    Status: 'Posted',
    Date: '2026-10-01',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Lines: [
      { AccountCode: '1020', Debit: 120000, Credit: 0 },
      { AccountCode: '1100', Debit: 0, Credit: 100000 },
      { AccountCode: '2310', Debit: 0, Credit: 20000 }
    ]
  }], [], [], {
    DateFrom: '2026-01-01',
    DateTo: '2026-12-31',
    FinancialYear: '2026'
  }, [{
    InvoiceId: 'INV-1',
    AccountRef: 'DCA/26/001',
    FeeCode: 'TUITION',
    FeeCategory: 'School Fee',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Date: '2026-09-01',
    Debit: 100000,
    Credit: 100000,
    Balance: 0
  }]);
  assert.equal(report.dashboard.Receivables, 0);
  assert.equal(report.dashboard.Liabilities, 20000);
});

test('receivables card uses outstanding invoices when receivables ledger has no positive balance', () => {
  const report = buildAccountingReport([], [{
    JournalNo: 'J-NEG',
    Status: 'Posted',
    Date: '2026-09-15',
    Lines: [
      { AccountCode: '1100', Debit: 0, Credit: 12000, Description: 'Receivables overcredit reversal' }
    ]
  }], [], [], {
    DateFrom: '2026-01-01',
    DateTo: '2026-12-31',
    FinancialYear: '2026'
  }, [{
    InvoiceId: 'INV-1',
    AccountRef: 'DCA/26/001',
    FeeCode: 'TUITION',
    FeeCategory: 'School Fee',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Date: '2026-09-10',
    Debit: 25000,
    Credit: 10000,
    Balance: 15000
  }]);
  assert.equal(report.dashboard.Receivables, 15000);
});

test('specific billing category replaces the All-category fee', () => {
  const fees = [
    { FeeCode: 'TUITION-ALL', FeeName: 'Tuition', FeeCategory: 'School Fee', BillingCategory: 'All', ClassName: 'JSS 1', Term: 'First Term', Amount: 100000 },
    { FeeCode: 'TUITION-STAFF', FeeName: 'Tuition', FeeCategory: 'School Fee', BillingCategory: 'Staff Child', ClassName: 'JSS 1', Term: 'First Term', Amount: 50000 }
  ];
  const selected = applyBillingCategoryOverrides(fees, { BillingCategory: 'Staff Child' });
  assert.deepEqual(selected.map((row) => row.FeeCode), ['TUITION-STAFF']);
});

test('budget actuals remain scoped to department and latest financial year', () => {
  const rows = buildBudgetVsActual([
    { FinancialYear: '2025', Department: 'Accounts', AccountCode: '6090', Amount: 1000 },
    { FinancialYear: '2026', Department: 'Accounts', AccountCode: '6090', Amount: 5000 },
    { FinancialYear: '2026', Department: 'Academic', AccountCode: '6090', Amount: 7000 }
  ], [{
    Date: '2026-06-01', Status: 'Posted', Lines: [
      { AccountCode: '6090', Department: 'Accounts', Debit: 1200, Credit: 0 },
      { AccountCode: '6090', Department: 'Academic', Debit: 2300, Credit: 0 },
      { AccountCode: '1020', Credit: 3500, Debit: 0 }
    ]
  }]);
  assert.deepEqual(rows.map((row) => [row.FinancialYear, row.Department, row.Actual, row.Variance]), [
    ['2026', 'Accounts', 1200, 3800],
    ['2026', 'Academic', 2300, 4700]
  ]);
});

test('school-fees-total payment is allocated FIFO across component invoices in the same period', () => {
  const ageing = buildReceivablesAgeing([
    { InvoiceId: 'INV-1', AccountRef: 'STU-1', FeeCode: 'TUITION', FeeCategory: 'School Fee', AcademicSession: '2026/2027', Term: 'First Term', Amount: 60000, Date: '2026-09-01' },
    { InvoiceId: 'INV-2', AccountRef: 'STU-1', FeeCode: 'DEVELOPMENT', FeeCategory: 'School Fee', AcademicSession: '2026/2027', Term: 'First Term', Amount: 40000, Date: '2026-09-02' }
  ], [{
    AccountRef: 'STU-1', FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee', AcademicSession: '2026/2027', Term: 'First Term', Amount: 70000, Status: 'Paid'
  }], '2026-09-30');
  assert.equal(ageing.length, 1);
  assert.equal(ageing[0].Reference, 'INV-2');
  assert.equal(ageing[0].PaidAmount, 10000);
  assert.equal(ageing[0].Balance, 30000);
});

test('receivables ageing applies acceptance deposits and remaining payments to enrolled invoices', () => {
  const ageing = buildReceivablesAgeing([{
    InvoiceId: 'INV-SCHOOL-1',
    AccountRef: 'DCA/26/002',
    ApplicationReference: 'DCA/26/000002',
    FeeCode: 'TUITION',
    FeeCategory: 'School Fee',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Amount: 294600
  }], [{
    AccountRef: 'DCA/26/000002',
    ApplicationReference: 'DCA/26/000002',
    FeeCode: 'ACCEPT_B_JSS1',
    FeeName: 'Acceptance',
    FeeCategory: 'Admission',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Amount: 150000,
    Status: 'Paid'
  }, {
    AccountRef: 'DCA/26/002',
    ApplicationReference: 'DCA/26/000002',
    FeeCode: 'SCHOOL_FEES_TOTAL',
    FeeCategory: 'School Fee',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    Amount: 144600,
    Status: 'Paid'
  }], '2026-07-23');
  assert.deepEqual(ageing, []);
});

test('part payment updates multiple component invoices without over-crediting', () => {
  const result = calculateInvoiceCreditAllocations([
    { InvoiceId: 'INV-1', Debit: 60000, Credit: 10000 },
    { InvoiceId: 'INV-2', Debit: 40000, Credit: 0 }
  ], 70000);
  assert.deepEqual(result.allocations.map((row) => [row.invoice.InvoiceId, row.AppliedCredit, row.Credit, row.Balance, row.Status]), [
    ['INV-1', 50000, 60000, 0, 'Paid'],
    ['INV-2', 20000, 20000, 20000, 'Part Paid']
  ]);
  assert.equal(result.remaining, 0);
});

test('bank reconciliation includes deposits, unpresented payments, and charges', () => {
  assert.equal(reconciliationDifference(100000, 94000, 5000, 8000, 1000), 4000);
});
