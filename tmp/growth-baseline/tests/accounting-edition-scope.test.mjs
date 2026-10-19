import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHOOL_ONLY_ACCOUNT_CODES,
  SCHOOL_ONLY_REVENUE_ACCOUNT_CODES,
  accountingChartForEdition,
  accountingChartChoicesForEdition,
  accountingCodeAllowedForEdition,
  accountingJournalsForEdition
} from '../functions/lib/accounting-edition-scope.js';
import { accountingDestinationForWalletPurchase, buildAccountingReport } from '../functions/api/backend.js';

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

test('school account choices hide church accounts and clarify the standard Tuck Shop label without editing the chart', () => {
  const source = structuredClone(chart);
  const choices = accountingChartChoicesForEdition(chart, 'school');
  assert.ok(!choices.some(row => row.Code === '4140'));
  assert.equal(choices.find(row => row.Code === '4040').Name, 'Books, Uniforms and Tuck Shop Revenue');
  assert.equal(choices.find(row => row.Code === '4120').Name, 'Organisation Store Revenue');
  assert.deepEqual(chart, source);
  assert.deepEqual(accountingChartForEdition(chart, 'school'), source);
});

test('church-group choices are filtered without hiding reused hotel/refund codes or general donations', () => {
  const mixed = [
    { Code: 4140, Name: 'Offering Income' },
    { __id: 'CHURCH-CUSTOM', Name: 'Custom giving', Group: ' Church Revenue ' },
    { Code: '4160', Name: 'Tithe Income', Group: 'Giving Income' },
    { Code: '4150', Name: 'Hotel Services Revenue', Group: 'Operating Revenue' },
    { Code: '4160', Name: 'Revenue Reductions and Refunds', Group: 'Contra Revenue' },
    { Code: '4080', Name: 'Grants and Donations', Group: 'Other Income' }
  ];
  assert.deepEqual(accountingChartChoicesForEdition(mixed, 'school').map(row => row.Name),
    ['Hotel Services Revenue', 'Revenue Reductions and Refunds', 'Grants and Donations']);
});

test('account choice labels retain custom school names, numeric identifiers and other editions', () => {
  const custom = [{ Code: 4040, Name: 'Our shop income' }, { __id: '4040', Name: 'Books and Uniform Revenue' }];
  const choices = accountingChartChoicesForEdition(custom, 'school');
  assert.equal(choices[0].Name, 'Our shop income');
  assert.equal(choices[0].Code, 4040);
  assert.equal(choices[1].__id, '4040');
  assert.equal(choices[1].Name, 'Books, Uniforms and Tuck Shop Revenue');
  for (const edition of ['church', 'faith', 'organization']) {
    assert.deepEqual(accountingChartChoicesForEdition(chart, edition), accountingChartForEdition(chart, edition));
    assert.ok(accountingChartChoicesForEdition(chart, edition).some(row => row.Code === '4140'));
  }
});

test('school history and financial totals retain old church-account postings after choices are filtered', () => {
  const reportChart = [
    { Code: '1010', Name: 'Cash', Type: 'Asset' },
    { Code: '4040', Name: 'Books and Uniform Revenue', Type: 'Revenue', Group: 'Operating Revenue' },
    { Code: '4140', Name: 'Offering Income', Type: 'Revenue', Group: 'Church Revenue' }
  ];
  const journals = [
    { JournalNo: 'OLD', Date: '2026-10-01', Status: 'Posted', Lines: [
      { AccountCode: '1010', Debit: 700, Credit: 0 }, { AccountCode: '4140', Debit: 0, Credit: 700 }
    ] },
    { JournalNo: 'SHOP', Date: '2026-10-02', Status: 'Posted', Lines: [
      { AccountCode: '1010', Debit: 2000, Credit: 0 }, { AccountCode: '4040', Debit: 0, Credit: 2000 }
    ] }
  ];
  const before = buildAccountingReport(reportChart, journals, [], []);
  accountingChartChoicesForEdition(reportChart, 'school');
  const after = buildAccountingReport(accountingChartForEdition(reportChart, 'school'),
    accountingJournalsForEdition(journals, 'school'), [], []);
  assert.deepEqual(after, before);
  assert.equal(after.dashboard.TotalIncome, 2700);
  assert.equal(after.trialBalance.find(row => row.AccountCode === '4140').Credit, 700);
  assert.equal(accountingDestinationForWalletPurchase({ Department: 'Tuck Shop' }), '4040');
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
