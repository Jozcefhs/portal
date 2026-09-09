import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { summarizeWalletActivity } from '../functions/api/backend.js';

test('wallet activity is summarized from one ledger projection', () => {
  const today = new Date('2026-09-09T12:00:00.000Z');
  const summary = summarizeWalletActivity([
    { AccountRef: 'DCA/21/1044', FeeCategory: 'Wallet', EntryType: 'Wallet Top-up', Credit: 5000, Debit: 0, Date: '2026-09-08T09:00:00.000Z' },
    { AccountRef: 'DCA/21/1044', FeeCategory: 'Wallet', EntryType: 'Wallet Purchase', Credit: 0, Debit: 750, Date: '2026-09-09T10:00:00.000Z' },
    { AccountRef: 'DCA/21/9999', FeeCategory: 'Wallet', EntryType: 'Wallet Purchase', Credit: 0, Debit: 2000, Date: '2026-09-09T10:00:00.000Z' }
  ], 'DCA/21/1044', today);

  assert.deepEqual(summary, { balance: 4250, spentToday: 750 });
});

test('wallet-card lookup uses bounded field queries rather than scanning every student', async () => {
  const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const lookupSource = backendSource.slice(
    backendSource.indexOf('async function findStudentByWalletCard'),
    backendSource.indexOf('async function findStudentByAccountRef')
  );

  assert.match(lookupSource, /querySchoolCollection/);
  assert.match(lookupSource, /field: 'WalletCardId'/);
  assert.doesNotMatch(lookupSource, /listSchoolCollection/);
});
