import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { studentWalletProfile } from '../functions/lib/student-wallet-profile.js';
import { withStudentProfileDefaults } from '../functions/lib/student-profile-defaults.js';

test('wallet profile reflects the existing Active default in both school sections without issuing a card', () => {
  for (const SchoolSection of ['primary', 'secondary']) {
    for (const status of [undefined, '', ' ']) {
      const row = { SchoolSection, WalletCardStatus: status, WalletBalance: 1234 };
      const before = structuredClone(row);
      assert.deepEqual(studentWalletProfile(row), { WalletCardStatus: 'Active', WalletCardId: '' });
      assert.deepEqual(row, before);
    }
  }
});

test('canonical wallet statuses win over stale aliases; blank placeholders retain legacy restrictions', () => {
  for (const status of ['Blocked', 'Lost', 'Replaced', 'Not Issued']) {
    assert.equal(studentWalletProfile({ WalletCardStatus: status, walletCardStatus: 'Active' }).WalletCardStatus, status);
    assert.equal(studentWalletProfile({ WalletCardStatus: '', walletCardStatus: status.toLowerCase() }).WalletCardStatus, status);
  }
  assert.equal(studentWalletProfile({ WalletCardStatus: 'Disabled' }).WalletCardStatus, 'Disabled');
  assert.equal(studentWalletProfile({ WalletCardId: 'CANONICAL', walletCardId: 'OLD' }).WalletCardId, 'CANONICAL');
  assert.deepEqual(studentWalletProfile({ walletCardId: ' CARD-1 ', walletCardStatus: ' active ' }),
    { WalletCardId: 'CARD-1', WalletCardStatus: 'Active' });
});

test('student register, parent portal and wallet operations use the same wallet projection', async () => {
  const clean = (value) => String(value ?? '').trim();
  const pick = (row, fields, fallback = '') => fields.map((key) => row[key]).find((value) => clean(value)) ?? fallback;
  const context = { studentWalletProfile, withStudentProfileDefaults, clean, lower: (value) => clean(value).toLowerCase(), pick,
    studentProfileValue: (row, field, aliases = [], fallback = '') => pick(row, [field, ...aliases], fallback),
    formatPersonName: () => 'Test student', displayNameForProfile: () => 'Test student',
    parentPassportPhotoSource: () => ({}), scopedRecordBranch: () => 'main', scopedRecordSection: (row) => row.SchoolSection,
    studentLoginCode: () => '', asMoneyNumber: (value) => Number(value) || 0, toDisplayDate: (value) => value };
  for (const [file, name] of [['admin', 'studentWithConfiguredName'], ['parent-dashboard', 'normalizeStudent'], ['backend', 'normalizeStudent']]) {
    const source = await readFile(new URL(`../functions/api/${file}.js`, import.meta.url), 'utf8');
    const start = source.indexOf(`function ${name}(`), end = source.indexOf('\nfunction ', start + 1);
    const project = vm.runInNewContext(`(${source.slice(start, end)})`, context);
    for (const SchoolSection of ['primary', 'secondary']) {
      for (const row of [{}, { WalletCardStatus: 'Blocked', walletCardStatus: 'Active' }, { walletCardStatus: 'lost', walletCardId: 'CARD-1' }]) {
        const expected = studentWalletProfile(row), result = project({ ...row, SchoolSection });
        assert.equal(result.WalletCardStatus, expected.WalletCardStatus, file);
        assert.equal(result.WalletCardId, expected.WalletCardId, file);
      }
    }
  }
});

test('profile-save paths preserve existing status when a stale form submits Select', async () => {
  for (const file of ['staff-students', 'backend']) {
    const source = await readFile(new URL(`../functions/api/${file}.js`, import.meta.url), 'utf8');
    const match = source.match(/if \(body.WalletCardStatus !== undefined && !clean\(body.WalletCardStatus\)\) \{\s+updated.WalletCardStatus = studentWalletProfile\(existing\).WalletCardStatus;\s+\}/);
    assert.ok(match, file);
    for (const input of [undefined, '', ' ', 'Active']) {
      const updated = { WalletCardStatus: input ?? 'Blocked' };
      vm.runInNewContext(match[0], { body: { WalletCardStatus: input }, updated,
        existing: { WalletCardStatus: 'Blocked' }, studentWalletProfile, clean: (value) => String(value ?? '').trim() });
      assert.equal(updated.WalletCardStatus, input === 'Active' ? 'Active' : 'Blocked', file);
    }
  }
  const ui = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(ui, /field === 'WalletCardStatus'\) value = pick\(student, \['WalletCardStatus', 'walletCardStatus'\]\) \|\| 'Active'/);
});
