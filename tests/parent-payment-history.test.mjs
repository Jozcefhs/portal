import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentHistoryForChild } from '../functions/api/parent-dashboard.js';

const child = {
  SourceType: 'Student',
  Status: 'Active',
  AccountRef: 'DCA/26/001',
  AdmissionNo: 'DCA/26/001'
};

test('parent payment history restores paid payment documents without duplicating their ledger credit', () => {
  const records = paymentHistoryForChild(child, [{
    Date: '2026-08-09',
    AccountRef: 'DCA/26/001',
    FeeName: 'School fees',
    FeeCategory: 'School Fee',
    Amount: 36000,
    Status: 'Paid',
    Reference: 'DCA-PAY-001'
  }], [{
    Date: '2026-08-09',
    AccountRef: 'DCA/26/001',
    FeeName: 'School fees',
    FeeCategory: 'School Fee',
    Credit: 36000,
    Status: 'Paid',
    Reference: 'DCA-PAY-001'
  }]);

  assert.equal(records.length, 1);
  assert.equal(records[0].Amount, 36000);
  assert.equal(records[0].RecordType, 'Payment');
  assert.equal(records[0].Description, 'School fees');
});

test('parent payment history retains legacy ledger-only payments and excludes pending or wallet records', () => {
  const records = paymentHistoryForChild(child, [{
    Date: '2026-08-09',
    AccountRef: 'DCA/26/001',
    FeeName: 'Pending fee',
    Amount: 12000,
    Status: 'Pending',
    Reference: 'DCA-PENDING-001'
  }, {
    Date: '2026-08-09',
    AccountRef: 'DCA/26/001',
    FeeName: 'Wallet top-up',
    FeeCategory: 'Wallet',
    Amount: 5000,
    Status: 'Paid',
    Reference: 'DCA-WALLET-001'
  }], [{
    Date: '2026-08-08',
    AccountRef: 'DCA/26/001',
    FeeCategory: 'Tuition',
    Description: 'Legacy school fee',
    Credit: 25000,
    Status: 'Paid',
    Reference: 'DCA-LEGACY-001'
  }]);

  assert.equal(records.length, 1);
  assert.equal(records[0].Amount, 25000);
  assert.equal(records[0].Description, 'Tuition');
});
