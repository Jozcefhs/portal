import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildAccountingReport,
  buildAccountingAdjustmentJournal
} from '../functions/api/backend.js';
import {
  accountingCodeAllowedForEdition,
  accountingJournalsForEdition
} from '../functions/lib/accounting-edition-scope.js';

const chart = [
  { Code: '1020', Name: 'Bank', Type: 'Asset', Group: 'Cash and Bank' },
  { Code: '3000', Name: 'Accumulated Fund', Type: 'Equity', Group: 'School Fund' },
  { Code: '4000', Name: 'Fees', Type: 'Revenue', Group: 'Operating Revenue' },
  { Code: '6030', Name: 'Administration', Type: 'Expense', Group: 'Operating Expense' }
];

function posted(date, lines) {
  return { Date: date, Status: 'Posted', Lines: lines };
}

test('balance sheet includes cumulative unclosed earnings while income statement remains period-scoped', () => {
  const report = buildAccountingReport(chart, [
    posted('2025-06-01', [
      { AccountCode: '1020', Debit: 100, Credit: 0 },
      { AccountCode: '4000', Debit: 0, Credit: 100 }
    ]),
    posted('2026-04-01', [
      { AccountCode: '6030', Debit: 20, Credit: 0 },
      { AccountCode: '1020', Debit: 0, Credit: 20 }
    ])
  ], [], [], { DateFrom: '2026-01-01', DateTo: '2026-12-31' });

  assert.equal(report.dashboard.NetSurplus, -20);
  assert.equal(report.dashboard.Assets, 80);
  assert.equal(report.dashboard.Liabilities, 0);
  assert.equal(report.dashboard.UnclosedEarnings, 80);
  assert.equal(report.dashboard.Equity, 80);
  assert.deepEqual(report.balanceSheet.equity.map((row) => [row.AccountCode, row.Credit, row.Debit]), [
    ['UN-CLOSED-EARNINGS', 80, 0]
  ]);
  assert.equal(report.dashboard.Assets, report.dashboard.Liabilities + report.dashboard.Equity);
});

test('a posted closing journal replaces, rather than duplicates, unclosed earnings', () => {
  const report = buildAccountingReport(chart, [
    posted('2026-04-01', [
      { AccountCode: '1020', Debit: 100, Credit: 0 },
      { AccountCode: '4000', Debit: 0, Credit: 100 }
    ]),
    posted('2026-12-31', [
      { AccountCode: '4000', Debit: 100, Credit: 0 },
      { AccountCode: '3000', Debit: 0, Credit: 100 }
    ])
  ], [], [], { DateTo: '2026-12-31' });

  assert.equal(report.dashboard.UnclosedEarnings, 0);
  assert.equal(report.dashboard.Equity, 100);
  assert.deepEqual(report.balanceSheet.equity.map((row) => row.AccountCode), ['3000']);
});

test('non-school concessions and refunds use general receivable and contra-revenue accounts', () => {
  const base = { AdjustmentNo: 'ADJ-1', Date: '2026-09-24', BranchId: 'main',
    AccountRef: 'CUSTOMER-1', Amount: 500, Reason: 'Approved correction', PaymentAccount: '1020' };
  for (const edition of ['church', 'faith', 'other', 'organization']) {
    const waiver = buildAccountingAdjustmentJournal({ ...base, Type: 'Waiver' }, edition);
    const refund = buildAccountingAdjustmentJournal({ ...base, Type: 'Refund' }, edition);
    assert.deepEqual(waiver.Lines.map(({ AccountCode, Debit, Credit }) => [AccountCode, Debit, Credit]), [
      ['4160', 500, 0], ['1110', 0, 500]
    ]);
    assert.deepEqual(refund.Lines.map(({ AccountCode, Debit, Credit }) => [AccountCode, Debit, Credit]), [
      ['4160', 500, 0], ['1020', 0, 500]
    ]);
    assert.equal(accountingCodeAllowedForEdition('1110', edition), true);
    assert.equal(accountingCodeAllowedForEdition('4160', edition), true);
    assert.equal(accountingCodeAllowedForEdition('2310', edition), false);
    assert.deepEqual(accountingJournalsForEdition([waiver, refund], edition), [waiver, refund]);
  }
});

test('school adjustment mappings remain unchanged', () => {
  const base = { AdjustmentNo: 'ADJ-S', Date: '2026-09-24', BranchId: 'main',
    AccountRef: 'STUDENT-1', Amount: 750, Reason: 'Approved correction', PaymentAccount: '1020' };
  assert.deepEqual(buildAccountingAdjustmentJournal({ ...base, Type: 'Discount' }, 'school').Lines
    .map((row) => row.AccountCode), ['4100', '1100']);
  assert.deepEqual(buildAccountingAdjustmentJournal({ ...base, Type: 'Refund' }, 'school').Lines
    .map((row) => row.AccountCode), ['4100', '1020']);
});

test('non-school contra revenue and general receivables are included in finance dashboard', () => {
  const nonSchoolChart = [
    { Code: '1110', Name: 'Trade and Other Receivables', Type: 'Asset', Group: 'Receivables' },
    { Code: '4140', Name: 'Offerings', Type: 'Revenue', Group: 'Church Revenue' },
    { Code: '4160', Name: 'Revenue Reductions and Refunds', Type: 'Revenue', Group: 'Contra Revenue' }
  ];
  const report = buildAccountingReport(nonSchoolChart, [
    posted('2026-08-01', [
      { AccountCode: '1110', Debit: 1000, Credit: 0 },
      { AccountCode: '4140', Debit: 0, Credit: 1000 }
    ]),
    posted('2026-08-02', buildAccountingAdjustmentJournal({
      AdjustmentNo: 'W-1', Date: '2026-08-02', BranchId: 'main', Type: 'Waiver',
      Reason: 'Approved concession', AccountRef: 'MEMBER-1', Amount: 100
    }, 'faith').Lines)
  ], [], [], { DateTo: '2026-08-31' });
  assert.equal(report.dashboard.GrossRevenue, 1000);
  assert.equal(report.dashboard.Concessions, 100);
  assert.equal(report.dashboard.NetRevenue, 900);
  assert.equal(report.dashboard.Receivables, 900);
  assert.equal(report.dashboard.Equity, 900);
});

test('new cross-edition accounts are in the seeded chart', async () => {
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.match(backend, /\['1110', 'Trade and Other Receivables', 'Asset', 'Receivables', 'Debit'\]/);
  assert.match(backend, /\['4160', 'Revenue Reductions and Refunds', 'Revenue', 'Contra Revenue', 'Debit'\]/);
});
