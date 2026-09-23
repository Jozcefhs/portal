import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeHistoricalPaymentImportRow } from '../functions/api/backend.js';

const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');

test('historical payment rows require student category, fee, amount, date and unique reference data', () => {
  assert.deepEqual(normalizeHistoricalPaymentImportRow({
    AccountRef: 'DCA/26/001',
    BillingCategory: 'School Staff Child',
    FeeCode: 'SCHOOL_FEES_TOTAL',
    Amount: '125,000',
    PaidAt: '2026-08-12',
    Reference: 'BANK-001'
  }), {
    RowNumber: 2,
    AccountRef: 'DCA/26/001',
    BillingCategory: 'School Staff Child',
    FeeCode: 'SCHOOL_FEES_TOTAL',
    FeeName: '',
    FeeCategory: '',
    Amount: 125000,
    PaidAt: '2026-08-12T12:00:00.000Z',
    Reference: 'BANK-001',
    Method: 'Bank Transfer',
    AcademicSession: '',
    Term: '',
    ReceiptNo: '',
    Currency: 'NGN',
    Notes: ''
  });
  assert.throws(() => normalizeHistoricalPaymentImportRow({
    AccountRef: 'DCA/26/001', BillingCategory: '', FeeCode: 'ACC', Amount: 100000,
    PaidAt: '2026-08-12', Reference: 'BANK-002'
  }), /BillingCategory/);
  assert.throws(() => normalizeHistoricalPaymentImportRow({
    AccountRef: 'DCA/26/001', BillingCategory: 'Regular', FeeCode: 'ACC', Amount: 100000,
    PaidAt: 'not-a-date', Reference: 'BANK-003'
  }), /PaidAt/);
});

test('historical payment import is role-gated, preflights rows, updates category and suppresses old notifications', () => {
  assert.match(backendSource, /case 'importHistoricalPayments':[\s\S]*?return importHistoricalPayments\(env, body\)/);
  assert.match(backendSource, /requireAccountingRole\(body, \['Super Admin', 'Accounts Officer'\]\)/);
  assert.match(backendSource, /Reference already belongs to a different payment/);
  assert.match(backendSource, /const categoryByStudent = new Map\(\)/);
  assert.match(backendSource, /student\.__scopePath \|\| student\.__id \|\| student\.AdmissionNo/);
  assert.match(backendSource, /BillingCategory: row\.BillingCategory/);
  assert.match(backendSource, /DeferNotifications: true/);
  assert.match(backendSource, /Channel: 'Historical Payment Import'/);
});
