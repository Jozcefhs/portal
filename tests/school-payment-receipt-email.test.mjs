import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { schoolPaymentReceiptDetails } from '../functions/lib/school-payment-email.js';

test('school payment receipt resolves imported-student parent identity and financial details', () => {
  const details = schoolPaymentReceiptDetails({
    DisplayName: 'Ada Example',
    ParentEmails: ['parent@example.test'],
    GrossAmount: 125000,
    Currency: 'NGN',
    FeeName: 'Second Term School Fees',
    ReceiptNo: 'PAY-001',
    GatewayReference: 'BANK-4455',
    Method: 'Bank Transfer',
    PaidAt: '2026-08-09T12:30:00.000Z',
    BranchId: 'main'
  });
  assert.equal(details.toEmail, 'parent@example.test');
  assert.equal(details.studentName, 'Ada Example');
  assert.match(details.amount, /125,000\.00/);
  assert.equal(details.receiptNo, 'PAY-001');
  assert.equal(details.reference, 'BANK-4455');
});

test('direct-transfer approval sends the receipt only after payment and store records are finalized', async () => {
  const source = await readFile(new URL('../functions/api/staff-direct-transfers.js', import.meta.url), 'utf8');
  const approvalStart = source.indexOf('async function approveSchoolPayment');
  const approvalEnd = source.indexOf('async function approveOrganizationStore');
  const approval = source.slice(approvalStart, approvalEnd);
  assert.ok(approval.indexOf('recordManualPayment') < approval.indexOf('sendSchoolPaymentReceiptEmail'));
  assert.ok(approval.indexOf('createPaidStoreOrder') < approval.indexOf('sendSchoolPaymentReceiptEmail'));
  assert.match(approval, /return \{ recorded, orders, email \}/);
});
