import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHOOL_ONLY_ACCOUNT_CODES,
  SCHOOL_ONLY_REVENUE_ACCOUNT_CODES,
  accountingChartForEdition,
  accountingCodeAllowedForEdition,
  accountingJournalsForEdition
} from '../functions/lib/accounting-edition-scope.js';

const chart = [
  { Code: '1100', Name: 'Student Accounts Receivable' },
  { Code: '2200', Name: 'Student Wallet Liability' },
  { Code: '3000', Name: 'Accumulated School Fund' },
  { Code: '4000', Name: 'Tuition and School Fee Revenue' },
  { Code: '4040', Name: 'Books and Uniform Revenue' },
  { Code: '4080', Name: 'Grants and Donations' },
  { Code: '4090', Name: 'Other Income' },
  { Code: '4120', Name: 'Organisation Store Revenue' },
  { Code: '4140', Name: 'Offering Income' }
];

test('church accounting hides school-only accounts but retains general organisation income', () => {
  assert.deepEqual(
    accountingChartForEdition(chart, 'church').map((row) => row.Code),
    ['4080', '4090', '4120', '4140']
  );
  assert.equal(SCHOOL_ONLY_REVENUE_ACCOUNT_CODES.includes('4110'), true);
  assert.equal(SCHOOL_ONLY_ACCOUNT_CODES.includes('1100'), true);
  for (const code of ['2200', '3000', '5000', '5010', '5020', '5030', '6040']) {
    assert.equal(SCHOOL_ONLY_ACCOUNT_CODES.includes(code), true);
    assert.equal(accountingCodeAllowedForEdition(code, 'faith'), false);
  }
  assert.equal(accountingCodeAllowedForEdition('1100', 'faith'), false);
  assert.equal(accountingCodeAllowedForEdition('4000', 'faith'), false);
  assert.equal(accountingCodeAllowedForEdition('4140', 'faith'), true);
});

test('school accounting retains its complete chart', () => {
  assert.deepEqual(accountingChartForEdition(chart, 'school'), chart);
});

test('church report scope removes the complete school journal so balances remain paired', () => {
  const journals = [
    { JournalNo: 'SCHOOL-1', Lines: [
      { AccountCode: '1010', Debit: 100 },
      { AccountCode: '4000', Credit: 100 }
    ] },
    { JournalNo: 'CHURCH-1', Lines: [
      { AccountCode: '1010', Debit: 200 },
      { AccountCode: '4140', Credit: 200 }
    ] }
  ];
  assert.deepEqual(
    accountingJournalsForEdition(journals, 'faith').map((row) => row.JournalNo),
    ['CHURCH-1']
  );
});
