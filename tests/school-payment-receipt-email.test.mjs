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

test('direct-transfer approval records first and delivers the receipt in a separate resumable stage', async () => {
  const source = await readFile(new URL('../functions/api/staff-direct-transfers.js', import.meta.url), 'utf8');
  const approvalStart = source.indexOf('async function approveSchoolPayment');
  const approvalEnd = source.indexOf('async function deliverSchoolPaymentReceipt');
  const approval = source.slice(approvalStart, approvalEnd);
  const deliveryStart = source.indexOf('async function deliverSchoolPaymentReceipt');
  const deliveryEnd = source.indexOf('async function approveOrganizationStore');
  const delivery = source.slice(deliveryStart, deliveryEnd);
  assert.match(approval, /recordManualPayment/);
  assert.match(approval, /DeferNotifications: true/);
  assert.match(approval, /ReferenceIsDocumentId: true/);
  assert.match(approval, /createPaidStoreOrder/);
  assert.doesNotMatch(approval, /sendSchoolPaymentReceiptEmail|notifyParentPaymentReceived/);
  assert.match(approval, /return \{ recorded, orders \}/);
  assert.match(delivery, /notifyParentPaymentReceived/);
  assert.match(delivery, /sendSchoolPaymentReceiptEmail/);
  assert.match(source, /ApprovalStage: 'record'/);
  assert.match(source, /ApprovalStage: 'deliver-receipt'/);
  assert.match(source, /ApprovalStage: 'complete'/);
  assert.match(source, /continueApproval: true/);
});
