import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { handleWebManualPayment, webManualPaymentScope, webManualPaymentChoices } from '../functions/lib/web-manual-payments.js';
import { onRequestGet } from '../functions/api/staff-manual-payments.js';
import { securityAuditAction } from '../functions/lib/security-audit.js';

const user = { username: 'accountant', displayName: 'Test Officer', role: 'Accounts Officer', edition: 'school',
  branchId: 'main', schoolSectionAccess: 'secondary', allowedSections: ['accounts'] };
const account = { AccountRef: 'TEST/001', AdmissionNo: 'TEST/001', DisplayName: 'Test Student', BranchId: 'main', SchoolSection: 'secondary',
  ClassName: 'Grade 8', StudentType: 'Boarding Student', BillingCategory: 'Regular', AcademicSession: '2026/2027', Term: 'First Term' };
const fee = { FeeCode: 'TUI', FeeName: 'Tuition', FeeCategory: 'School Fee', Amount: 14000, Active: 'YES',
  ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Currency: 'NGN' };
const invoice = { ...account, ...fee, Debit: 14000, Credit: 4000, Status: 'Part Paid', AcademicSession: '2026/2027', Term: 'First Term' };
const snapshot = { accounts: [account], feeItems: [fee], invoices: [invoice] };
const instruction = { action: 'post', AccountRef: 'TEST/001', ChoiceId: JSON.stringify(['TUI', '2026/2027', 'First Term']),
  Reference: 'WEB-MANUAL-00000000-0000-4000-8000-000000000001', Amount: '10000', Description: 'Tuition',
  Method: 'Bank Transfer', PaymentProof: 'TEST-BANK-001', PaidAt: '2026-10-18' };
const browser = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../js/manual-payments.js', import.meta.url), 'utf8'), browser);
const amountDefault = browser.window.DynamaxManualPayments.amountDefault;

test('the web route is POST-only, authenticated and explicitly labelled in the audit', () => {
  assert.equal(onRequestGet().status, 405);
  const route = fs.readFileSync(new URL('../functions/api/staff-manual-payments.js', import.meta.url), 'utf8');
  assert.match(route, /requireStaffSession\(env, request\)/);
  assert.match(route, /maxBytes: 16 \* 1024/);
  assert.equal(securityAuditAction({ pathname: '/api/staff-manual-payments', method: 'POST', body: { action: 'lookup' } }), 'Look up account and payable fee components');
  assert.equal(securityAuditAction({ pathname: '/api/staff-manual-payments', method: 'POST', body: { action: 'post' } }), 'Record manual payment');
  const frontend = fs.readFileSync(new URL('../js/manual-payments.js', import.meta.url), 'utf8');
  assert.match(frontend, /name="Amount"[^>]*data-finance-input/);
  assert.match(frontend, /if \(instruction && !posted && uncertain\)/);
  assert.match(frontend, /signal\?\.addEventListener\('abort', abort/);
});

test('manual payment autofill prefers outstanding balance, accepts zero, and clears unavailable values', () => {
  for (const [row, expected] of [[{ Balance: 10, Amount: 30 }, '10.00'], [{ Amount: '₦14,000' }, '14000.00'],
    [{ Balance: 0, Amount: 30 }, '30.00'], [{ Amount: 0 }, '0.00'], [{}, ''], [{ Amount: '' }, ''],
    [{ Amount: -1 }, ''], [{ Amount: 'bad' }, ''], [{ Amount: Infinity }, '']]) assert.equal(amountDefault(row), expected);
});
test('only school finance posting roles with Accounts and one branch can enter manual school payments', () => {
  assert.deepEqual(webManualPaymentScope(user), { branchId: 'main', schoolSectionAccess: 'secondary' });
  for (const change of [{ role: 'Principal' }, { role: 'Management' }, { allowedSections: [] }, { branchId: '' },
    { branchId: 'all' }, { edition: 'faith' }, { edition: 'church' }, { edition: 'organization' }]) {
    assert.throws(() => webManualPaymentScope({ ...user, ...change }), error => error.status === 403);
  }
});
test('choices aggregate existing outstanding invoices without creating charges and filter fee applicability', () => {
  const choices = webManualPaymentChoices({ ...snapshot, feeItems: [fee, { ...fee, FeeCode: 'OFF', Active: 'NO' },
    { ...fee, FeeCode: 'OTHER', ClassName: 'Grade 12' }], invoices: [invoice, { ...invoice, Debit: 2000, Credit: 500 }] }, account);
  assert.equal(choices.find(row => row.FeeCode === 'TUI').Balance, 11500);
  assert.equal(choices.find(row => row.FeeCode === 'TUI').Amount, 14000);
  assert.ok(choices.some(row => row.FeeCode === 'WALLET_TOPUP'));
  assert.ok(choices.some(row => row.FeeCode === 'MANUAL_PAYMENT'));
  assert.ok(!choices.some(row => ['OFF', 'OTHER'].includes(row.FeeCode)));
  assert.throws(() => webManualPaymentChoices({ ...snapshot, feeItems: [fee, fee] }, account), /Duplicate fee configuration/);
  assert.throws(() => webManualPaymentChoices({ ...snapshot, invoices: [{ ...invoice, BranchId: 'north' }] }, account), /approved branch/);
});
test('lookup is read only and returns only the verified account and fee choices', async () => {
  let writes = 0;
  const data = await handleWebManualPayment({}, user, { action: 'lookup', AccountRef: 'TEST/001' }, {
    snapshot: async (_, body) => { assert.equal(body.DeviceBranchId, 'main'); return snapshot; }, record: () => writes++ });
  assert.equal(writes, 0); assert.equal(data.account.AccountRef, account.AccountRef);
  assert.equal(data.choices[0].ChoiceId.length > 0, true); assert.equal(data.payments, undefined);
});
test('posting reconstructs authoritative scope and fee data and retains editable amount', async () => {
  let posted;
  const result = await handleWebManualPayment({}, user, { ...instruction, Amount: '3500', UserRole: 'Super Admin',
    BranchId: 'north', Gateway: 'Paystack', FeeCategory: 'Wallet', Currency: 'USD', RecordedBy: 'Impersonator' }, {
    snapshot: async () => snapshot, payment: async () => null,
    record: async (_, body, options) => { posted = body; assert.equal(options.reviewWalletDuplicates, true);
      return { ok: true, payment: { ...body, ReceiptNo: 'TEST-RECEIPT' } }; } });
  assert.equal(posted.BranchId, 'main'); assert.equal(posted.UserRole, 'Accounts Officer');
  assert.equal(posted.FeeCategory, 'School Fee'); assert.equal(posted.Gateway, 'Manual');
  assert.equal(posted.RecordedBy, 'Test Officer'); assert.equal(posted.Currency, 'NGN');
  assert.equal(result.payment.Amount, 3500); assert.equal(result.payment.ReceiptNo, 'TEST-RECEIPT');
});
test('same-reference retries survive changes to the fee list, but altered instructions are rejected', async () => {
  let stored, count = 0;
  const deps = { snapshot: async () => { count++; return snapshot; }, payment: async () => stored,
    record: async (_, body) => { const duplicate = !!stored; stored = { ...body, ReceiptNo: 'UNCHANGED' }; return { ok: true, duplicate, payment: stored }; } };
  await handleWebManualPayment({}, user, instruction, deps);
  const retry = await handleWebManualPayment({}, user, instruction, deps);
  assert.equal(retry.duplicate, true); assert.equal(count, 1); assert.equal(retry.payment.ReceiptNo, 'UNCHANGED');
  for (const change of [{ Amount: 10 }, { PaidAt: '2026-10-17' }, { AccountRef: 'OTHER' }, { PaymentProof: 'OTHER' }]) {
    await assert.rejects(handleWebManualPayment({}, user, { ...instruction, ...change }, deps), /different instruction/);
  }
});
test('invalid or cross-scope inputs cannot reach the recorder', async () => {
  let writes = 0;
  const deps = { payment: async () => null, snapshot: async () => snapshot, record: async () => { writes++; } };
  for (const change of [{ Amount: 'NaN' }, { Amount: '-1' }, { Amount: '1.234' }, { PaidAt: '2026-02-30' },
    { ChoiceId: 'unknown' }, { Reference: '../../receipt' }, { PaymentProof: '' }, { Method: 'hacked' }]) {
    await assert.rejects(handleWebManualPayment({}, user, { ...instruction, ...change }, deps));
  }
  await assert.rejects(handleWebManualPayment({}, user, instruction, { ...deps,
    snapshot: async () => ({ ...snapshot, accounts: [{ ...account, BranchId: 'north' }] }) }), /approved branch/);
  assert.equal(writes, 0);
});
test('wallet duplicate review requires explicit digest confirmation and remains the existing recorder decision', async () => {
  const walletInstruction = { ...instruction, ChoiceId: JSON.stringify(['WALLET_TOPUP', '2026/2027', 'First Term']) };
  const warning = { ok: false, code: 'WALLET_DUPLICATE_REVIEW_REQUIRED', duplicateReview: { ReviewDigest: 'review-live-records' } };
  let acknowledgement;
  const deps = { snapshot: async () => snapshot, payment: async () => null,
    record: async (_, body) => { acknowledgement = body.DuplicateWalletReviewDigest; return warning; } };
  assert.deepEqual(await handleWebManualPayment({}, user, walletInstruction, deps), warning);
  assert.equal(acknowledgement, '');
  await handleWebManualPayment({}, user, { ...walletInstruction, DuplicateWalletReviewDigest: 'review-live-records' }, deps);
  assert.equal(acknowledgement, 'review-live-records');
});
