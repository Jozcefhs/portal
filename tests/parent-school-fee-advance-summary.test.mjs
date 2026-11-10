import test from 'node:test';
import assert from 'node:assert/strict';
import { parentAdvanceCreditSummary } from '../functions/api/parent-dashboard.js';

const child = { SourceType: 'Student', __id: 'pupil-1', AccountRef: 'DCA/26/0356', AdmissionNo: 'DCA/26/0356',
  BranchId: 'area-1-primary', SchoolSection: 'primary', __scopePath: 'schoolBranches/area-1-primary/sections/primary/students' };
const identity = { AccountRef: child.AccountRef, BranchId: child.BranchId, SchoolSection: child.SchoolSection,
  StudentScopePath: child.__scopePath, StudentDocumentId: child.__id };
const advance = { ...identity, FeeCode: 'SCHOOL_FEES_ADVANCE', FeeCategory: 'School Fee', EntryType: 'Payment',
  Credit: 300000, Debit: 0, Status: 'Paid' };
const invoice = (id, amount, due, credit = 0) => ({ ...identity, InvoiceId: id, FeeCode: 'TUITION', FeeCategory: 'School Fee',
  Debit: amount, Credit: credit, Balance: amount - credit, DueDate: due, Status: credit ? 'Part Paid' : 'Unpaid' });

test('parent advance credit clears current due fees and retains future term credit without another read', () => {
  const invoices = [invoice('NOW', 100000, '2026-11-01'), invoice('NEXT', 200000, '2027-01-10')];
  const before = JSON.stringify({ invoices, advance });
  assert.deepEqual(parentAdvanceCreditSummary(child, invoices, [advance], '2026-11-10'),
    { SchoolFeeCreditManaged: true, PendingSchoolFeeCredit: 200000 });
  assert.deepEqual(parentAdvanceCreditSummary(child, invoices, [advance], '2027-01-10'),
    { SchoolFeeCreditManaged: true, PendingSchoolFeeCredit: 0 });
  assert.equal(JSON.stringify({ invoices, advance }), before);
});

test('allocated invoices, wallet funds and receipt corrections never duplicate available fee credit', () => {
  const invoices = [invoice('NOW', 100000, '2026-11-01', 100000)];
  const ledger = [advance, { ...identity, FeeCategory: 'Wallet', EntryType: 'Wallet Top-up', Credit: 90000 },
    { ...identity, FeeCategory: 'Account Credit', EntryType: 'Credit Reversal', Debit: 50000, Credit: 0 }];
  assert.equal(parentAdvanceCreditSummary(child, invoices, ledger, '2026-11-10').PendingSchoolFeeCredit, 150000);
});

test('matching admission numbers in another branch or section cannot enable or contribute parent advance credit', () => {
  const otherBranch = { ...advance, BranchId: 'main' }, otherSection = { ...advance, SchoolSection: 'secondary' };
  assert.deepEqual(parentAdvanceCreditSummary(child, [], [otherBranch, otherSection], '2026-11-10'), {});
  assert.equal(parentAdvanceCreditSummary(child, [invoice('NOW', 50000, '2026-11-01')],
    [advance, otherBranch, otherSection], '2026-11-10').PendingSchoolFeeCredit, 250000);
  assert.deepEqual(parentAdvanceCreditSummary(child, [], [{ ...advance, StudentDocumentId: 'another-child' }]), {});
  assert.deepEqual(parentAdvanceCreditSummary(child, [], [{ ...advance, StudentScopePath: 'students' }]), {});
});

test('legacy receipts, pending requests and applicants do not claim confirmed advance credit', () => {
  assert.deepEqual(parentAdvanceCreditSummary(child, [], [{ ...advance, FeeCode: 'TUITION' }]), {});
  assert.deepEqual(parentAdvanceCreditSummary(child, [], [{ ...advance, Credit: 0, Status: 'Awaiting Verification' }]), {});
  assert.deepEqual(parentAdvanceCreditSummary({ ...child, SourceType: 'Application' }, [], [advance]), {});
});
