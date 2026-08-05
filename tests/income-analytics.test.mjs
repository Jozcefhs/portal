import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildIncomeAnalytics,
  journalMatchesIncomeBranch,
  resolveIncomePeriod
} from '../functions/lib/income-analytics.js';

const chart = [
  { Code: '1010', Name: 'Cash on Hand', Type: 'Asset' },
  { Code: '1020', Name: 'Main Bank Account', Type: 'Asset' },
  { Code: '1030', Name: 'Online Payment Clearing', Type: 'Asset' },
  { Code: '1100', Name: 'Receivables', Type: 'Asset' },
  { Code: '2200', Name: 'Wallet Liability', Type: 'Liability' },
  { Code: '4000', Name: 'School Fee Revenue', Type: 'Revenue' },
  { Code: '4040', Name: 'Store Revenue', Type: 'Revenue' },
  { Code: '4080', Name: 'Donations', Type: 'Revenue' },
  { Code: '4160', Name: 'Tithe Income', Type: 'Revenue' },
  { Code: '4190', Name: 'Seed Income', Type: 'Revenue' },
  { Code: '6060', Name: 'Gateway Charges', Type: 'Expense' }
];

const journals = [
  {
    JournalNo: 'INV-1', Date: '2026-07-02', Status: 'Posted', Source: 'Fee Invoice', Department: 'Accounts',
    Lines: [{ AccountCode: '1100', Debit: 100000 }, { AccountCode: '4000', Credit: 100000 }]
  },
  {
    JournalNo: 'PAY-1', Date: '2026-07-05', Status: 'Posted', Source: 'Fee Payment',
    Lines: [{ AccountCode: '1030', Debit: 100000 }, { AccountCode: '1100', Credit: 100000 }]
  },
  {
    JournalNo: 'WALLET-1', Date: '2026-07-10', Status: 'Posted', Source: 'Wallet Purchase', Department: 'Tuck Shop',
    Lines: [{ AccountCode: '2200', Debit: 2500 }, { AccountCode: '4040', Credit: 2500, Department: 'Tuck Shop' }]
  },
  {
    JournalNo: 'DON-1', Date: '2026-07-12', Status: 'Posted', Source: 'Church Donation', Department: 'Donations',
    Lines: [
      { AccountCode: '1030', Debit: 9700, CostCentre: 'main' },
      { AccountCode: '6060', Debit: 300, CostCentre: 'main' },
      { AccountCode: '4080', Credit: 10000, Department: 'Donations', CostCentre: 'main' }
    ]
  },
  {
    JournalNo: 'DRAFT-1', Date: '2026-07-20', Status: 'Draft', Source: 'Manual Journal',
    Lines: [{ AccountCode: '1010', Debit: 5000 }, { AccountCode: '4080', Credit: 5000 }]
  },
  {
    JournalNo: 'PREVIOUS', Date: '2026-06-15', Status: 'Posted', Source: 'Church Donation',
    Lines: [{ AccountCode: '1010', Debit: 5000 }, { AccountCode: '4080', Credit: 5000 }]
  }
];

test('monthly period resolves with an equal previous comparison window', () => {
  assert.deepEqual(resolveIncomePeriod({ period: 'monthly' }, '2026-07-28'), {
    mode: 'monthly',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    previousDateFrom: '2026-06-01',
    previousDateTo: '2026-06-30',
    bucket: 'day'
  });
});

test('income analytics uses posted revenue lines without counting settlement twice', () => {
  const report = buildIncomeAnalytics(chart, journals, { period: 'monthly' }, '2026-07-28');
  assert.equal(report.summary.totalIncome, 112500);
  assert.equal(report.summary.transactionCount, 3);
  assert.equal(report.summary.averageIncome, 37500);
  assert.equal(report.transactions.length, 3);
  assert.deepEqual(report.sources.map((row) => [row.label, row.value]), [
    ['Fees', 100000],
    ['Donations', 10000],
    ['Wallet Purchases', 2500]
  ]);
  assert.deepEqual(report.channels.map((row) => [row.label, row.value]), [
    ['Receivable', 100000],
    ['Online', 10000],
    ['Wallet', 2500]
  ]);
  assert.equal(report.transactions.some((row) => row.journalNo === 'PAY-1'), false);
  assert.equal(report.transactions.some((row) => row.journalNo === 'DRAFT-1'), false);
});

test('empty new months open the latest month containing posted income', () => {
  const report = buildIncomeAnalytics(chart, journals, { period: 'monthly' }, '2026-08-01');

  assert.equal(report.period.dateFrom, '2026-07-01');
  assert.equal(report.period.dateTo, '2026-07-31');
  assert.equal(report.period.usedLatestAvailable, true);
  assert.equal(report.summary.totalIncome, 112500);
  assert.equal(report.summary.transactionCount, 3);
});

test('an explicitly selected empty period remains empty', () => {
  const report = buildIncomeAnalytics(chart, journals, {
    period: 'custom', dateFrom: '2026-08-01', dateTo: '2026-08-31'
  }, '2026-08-01');

  assert.equal(report.period.dateFrom, '2026-08-01');
  assert.equal(report.period.dateTo, '2026-08-31');
  assert.equal(report.period.usedLatestAvailable, undefined);
  assert.equal(report.summary.totalIncome, 0);
});

test('church income is grouped by its giving type instead of one generic donation source', () => {
  const churchJournals = [
    {
      JournalNo: 'TITHE-1', Date: '2026-07-12', Status: 'Posted', Source: 'Church Donation',
      GivingTypeName: 'Tithe', Lines: [{ AccountCode: '1030', Debit: 7000 }, { AccountCode: '4080', Credit: 7000 }]
    },
    {
      JournalNo: 'SEED-1', Date: '2026-07-13', Status: 'Posted', Source: 'Church Donation',
      GivingTypeName: 'Seed', Lines: [{ AccountCode: '1010', Debit: 3000 }, { AccountCode: '4080', Credit: 3000 }]
    }
  ];
  const report = buildIncomeAnalytics(chart, churchJournals, { period: 'monthly' }, '2026-07-28');
  assert.deepEqual(report.sources.map((row) => [row.label, row.value]), [
    ['Tithe', 7000],
    ['Seed', 3000]
  ]);
  assert.deepEqual(report.transactions.map((row) => row.source).sort(), ['Seed', 'Tithe']);
});

test('legacy church journals infer their giving source from separate revenue accounts', () => {
  const legacyChurchJournals = [
    {
      JournalNo: 'OLD-TITHE', Date: '2026-07-14', Status: 'Posted', Source: 'Church Donation',
      Lines: [{ AccountCode: '1030', Debit: 9000 }, { AccountCode: '4160', Credit: 9000 }]
    },
    {
      JournalNo: 'OLD-SEED', Date: '2026-07-15', Status: 'Posted', Source: 'Church Donation',
      Lines: [{ AccountCode: '1010', Debit: 4000 }, { AccountCode: '4190', Credit: 4000 }]
    }
  ];
  const report = buildIncomeAnalytics(chart, legacyChurchJournals, { period: 'monthly' }, '2026-07-28');
  assert.deepEqual(report.sources.map((row) => [row.label, row.value]), [
    ['Tithe', 9000],
    ['Seed', 4000]
  ]);
});

test('donation settlement routes stay separate for every payment method', () => {
  const methods = ['CASH', 'BANK TRANSFER', 'CHEQUE', 'POS', 'ONLINE', 'CARD', 'MOBILE MONEY'];
  const accountCodes = {
    CASH: '1010',
    'BANK TRANSFER': '1020',
    CHEQUE: '1020',
    POS: '1020',
    ONLINE: '1030',
    CARD: '1020',
    'MOBILE MONEY': '1020'
  };
  const routeJournals = methods.map((method, index) => ({
    JournalNo: `ROUTE-${index + 1}`,
    Date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    Status: 'Posted',
    Source: 'Church Donation',
    GivingTypeName: 'Thanksgiving',
    PaymentMethod: method,
    Lines: [
      { AccountCode: accountCodes[method], Debit: 1000 },
      { AccountCode: '4080', Credit: 1000 }
    ]
  }));
  const report = buildIncomeAnalytics(chart, routeJournals, { period: 'monthly' }, '2026-07-28');
  assert.deepEqual(Object.fromEntries(report.channels.map((row) => [row.label, row.value])), {
    Cash: 1000,
    'Bank Transfer': 1000,
    Cheque: 1000,
    POS: 1000,
    Online: 1000,
    Card: 1000,
    'Mobile Money': 1000
  });
});

test('account, department and payment-route filters affect every report output', () => {
  const store = buildIncomeAnalytics(chart, journals, {
    period: 'monthly', accountCode: '4040', department: 'Tuck Shop', channel: 'Wallet'
  }, '2026-07-28');
  assert.equal(store.summary.totalIncome, 2500);
  assert.equal(store.summary.transactionCount, 1);
  assert.deepEqual(store.timeline.filter((row) => row.value).map(({ key, value }) => ({ key, value })), [{ key: '2026-07-10', value: 2500 }]);
});

test('branch scoping treats legacy records as main and reads donation branch cost centres', () => {
  assert.equal(journalMatchesIncomeBranch(journals[0], 'main'), true);
  assert.equal(journalMatchesIncomeBranch(journals[3], 'main'), true);
  assert.equal(journalMatchesIncomeBranch(journals[3], 'west'), false);
  assert.equal(journalMatchesIncomeBranch({ ...journals[3], BranchId: 'west' }, 'west'), true);
});

test('staff portal exposes the responsive income analytics workspace', async () => {
  const [adminJs, css, roleAccess, config] = await Promise.all([
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../functions/lib/role-module-access.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/lib/organization-config.js', import.meta.url), 'utf8')
  ]);
  assert.match(adminJs, /\['incomeAnalytics', 'Income Analytics'\]/);
  assert.match(adminJs, /\/api\/income-analytics/);
  assert.match(adminJs, /Income by source/);
  assert.match(adminJs, /Settlement route/);
  assert.match(adminJs, /--income-buckets/);
  assert.match(adminJs, /hasIncome \? escapeHtml\(compactMoney\(row\.value\)\) : ''/);
  assert.match(adminJs, /exportIncomeAnalyticsCsv/);
  assert.match(adminJs, /There is no posted income in the current month yet/);
  assert.match(css, /\.income-bar-chart/);
  assert.match(css, /grid-template-columns:repeat\(var\(--income-buckets\),minmax\(0,1fr\)\)/);
  assert.match(css, /\.income-donut/);
  assert.match(css, /@media print/);
  assert.match(roleAccess, /'incomeAnalytics'/);
  assert.match(config, /incomeAnalytics: 'accounting'/);
});
