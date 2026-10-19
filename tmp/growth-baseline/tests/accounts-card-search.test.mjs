import assert from 'node:assert/strict';
import test from 'node:test';
import { getAccountsOverview } from '../functions/api/backend.js';

function snapshot(students, accounts = []) {
  return {
    students, accounts, applications: [], payments: [], invoices: [], ledger: [],
    feeItems: [], billingCategories: [], accountSummaries: [],
    schoolProfile: { CurrentAcademicSession: '2026/2027', CurrentTerm: 'First Term' }
  };
}

test('every account keeps its student card when multiple legacy account rows are merged', async () => {
  const students = ['000123', '0371312330', ''].map((WalletCardId, index) => ({
    AdmissionNo: `TEST/26/00${index + 1}`, DisplayName: `Student ${index + 1}`,
    BranchId: 'main', SchoolSection: 'secondary', WalletCardId, WalletCardStatus: 'Blocked'
  }));
  const legacy = students.map((student) => ({ AccountRef: student.AdmissionNo,
    WalletCardId: 'OLD-CARD', walletCardId: 'OLDER-CARD', WalletCardStatus: 'Active'
  }));
  const result = await getAccountsOverview({}, snapshot(students, legacy), { BranchId: 'main' });
  for (const student of students) {
    const account = result.accounts.find((row) => row.AccountRef === student.AdmissionNo);
    assert.equal(account.WalletCardId, student.WalletCardId);
    assert.equal(account.WalletCardStatus, 'Blocked');
    assert.equal(account.walletCardId, undefined);
  }
});

for (const SchoolSection of ['primary', 'secondary']) {
  const student = {
    AdmissionNo: 'TEST/26/001', DisplayName: 'Test Student', BranchId: 'main',
    SchoolSection, ClassName: SchoolSection === 'primary' ? 'Primary 1' : 'Grade 7',
    __scopePath: `schoolBranches/main/sections/${SchoolSection}/students`
  };

  test(`${SchoolSection} Accounts carries the registered card, preserving leading zeros and status`, async () => {
    for (const wallet of [
      { WalletCardId: '0371312330', WalletCardStatus: 'Active' },
      { walletCardId: '000123', walletCardStatus: 'blocked' }
    ]) {
      const inputs = snapshot([{ ...student, ...wallet }]);
      const before = structuredClone(inputs);
      const { accounts } = await getAccountsOverview({}, inputs, { BranchId: 'main' });
      assert.equal(accounts[0].WalletCardId, wallet.WalletCardId || wallet.walletCardId);
      assert.equal(accounts[0].WalletCardStatus, wallet.WalletCardStatus || 'Blocked');
      assert.equal(accounts[0].StudentScopePath, student.__scopePath);
      assert.equal(accounts[0].WalletBalance, 0);
      assert.deepEqual(inputs, before, 'read-only projection must not change saved records');
    }
  });

  test(`${SchoolSection} registered card wins over stale accounting copies, including after removal`, async () => {
    for (const WalletCardId of ['0371312330', '']) {
      const inputs = snapshot([{ ...student, WalletCardId, WalletCardStatus: 'Lost' }], [{
        AccountRef: student.AdmissionNo, BranchId: 'main', SchoolSection,
        WalletCardId: 'OLD-CARD', walletCardId: 'OLDER-CARD',
        WalletCardStatus: 'Active', walletCardStatus: 'Active'
      }]);
      const { accounts } = await getAccountsOverview({}, inputs, { BranchId: 'main' });
      assert.equal(accounts[0].WalletCardId, WalletCardId);
      assert.equal(accounts[0].WalletCardStatus, 'Lost');
      assert.equal(accounts[0].walletCardId, undefined, 'generic search must not match an obsolete alias');
      assert.equal(accounts[0].walletCardStatus, undefined);
      assert.equal(accounts[0].AccountRef, student.AdmissionNo);
    }
  });
}
