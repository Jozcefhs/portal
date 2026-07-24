import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountingDestinationForPayment,
  accountingDestinationForWalletPurchase,
  applyBillingCategoryOverrides,
  buildBudgetVsActual,
  buildGatewayCollectionsReport,
  buildReceivablesAgeing,
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
  assert.equal(accountingDestinationForWalletPurchase({ Department: 'Finance', FeeCategory: 'Admission', FeeCode: 'TUITION' }), '4110');
  assert.equal(accountingDestinationForWalletPurchase({ FeeCategory: 'Unknown', FeeCode: 'X' }), '4090');
});

test('financial periods require the same session and term', () => {
  assert.equal(sameFinancialPeriod({ AcademicSession: '2026/2027', Term: 'First Term' }, '2026/2027', 'First Term'), true);
  assert.equal(sameFinancialPeriod({ AcademicSession: '2025/2026', Term: 'First Term' }, '2026/2027', 'First Term'), false);
  assert.equal(sameFinancialPeriod({ AcademicSession: '2026/2027', Term: 'Second Term' }, '2026/2027', 'First Term'), false);
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
