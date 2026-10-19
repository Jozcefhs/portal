import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function merger() {
  const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const start = source.indexOf('function combineIncomeAnalyticsPages(pages) {');
  const end = source.indexOf('\nasync function loadIncomeAnalytics(', start);
  assert.ok(start >= 0 && end > start, 'income pagination merger exists');
  return runInNewContext(`${source.slice(start, end)}\ncombineIncomeAnalyticsPages`, {});
}

test('income report combines every page before displaying totals and retains all CSV transactions', async () => {
  const merge = await merger();
  const base = {
    period: { mode: 'monthly', dateFrom: '2026-09-01', dateTo: '2026-09-30' },
    filter: { period: 'monthly', branchId: 'main' },
    summary: { totalIncome: 100, previousTotal: 50, transactionCount: 1, excludedUnconvertedTransactions: 1 },
    timeline: [{ key: '2026-09-01', label: '1 Sep', value: 100 }],
    sources: [{ label: 'Fees', value: 100 }],
    channels: [{ label: 'Bank Transfer', value: 100 }],
    transactions: [{ journalNo: 'first', date: '2026-09-01', amount: 100 }],
    options: { accounts: [{ code: '4000', name: 'Fees' }], departments: ['School'], channels: ['Bank Transfer'], sources: ['Fees'], branches: ['main'] }
  };
  const second = {
    ...base,
    summary: { totalIncome: 200, previousTotal: 25, transactionCount: 1, excludedUnconvertedTransactions: 2 },
    timeline: [{ key: '2026-09-01', label: '1 Sep', value: 200 }],
    sources: [{ label: 'Fees', value: 200 }],
    channels: [{ label: 'Cash', value: 200 }],
    transactions: [{ journalNo: 'second', date: '2026-09-02', amount: 200 }],
    options: { accounts: [{ code: '4001', name: 'Other' }], departments: ['Other'], channels: ['Cash'], sources: ['Fees'], branches: ['main'] }
  };
  const result = merge([base, second]);
  assert.equal(result.summary.totalIncome, 300);
  assert.equal(result.summary.previousTotal, 75);
  assert.equal(result.summary.transactionCount, 2);
  assert.equal(result.summary.averageIncome, 150);
  assert.equal(result.summary.comparisonPercent, 300);
  assert.equal(result.summary.excludedUnconvertedTransactions, 3);
  assert.equal(result.timeline[0].value, 300);
  assert.equal(result.sources[0].value, 300);
  assert.equal(result.channels.length, 2);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].journalNo, 'second');
  assert.equal(result.options.accounts.length, 2);
  assert.deepEqual(Array.from(result.options.channels), ['Bank Transfer', 'Cash']);
  assert.equal(base.summary.totalIncome, 100, 'input pages are not modified');
});

test('income report never renders a partial page and bounds on-screen transaction rows', async () => {
  const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(source, /while \(cursor\);\s*const report = combineIncomeAnalyticsPages\(pages\)/);
  assert.match(source, /if \(requestId === incomeAnalyticsRequest\) renderIncomeAnalytics\(report\)/);
  assert.match(source, /const displayedTransactions = \(data\.transactions \|\| \[\]\)\.slice\(0, 500\)/);
  assert.match(source, /const rows = incomeAnalyticsData\?\.transactions \|\| \[\]/);
});

test('income report counts a journal number only once if matching records span pages', async () => {
  const merge = await merger();
  const page = (amount) => ({
    summary: { totalIncome: amount, previousTotal: 0, excludedUnconvertedTransactions: 0 },
    timeline: [], sources: [], channels: [],
    transactions: [{ journalNo: 'same', date: '2026-09-01', amount, accounts: '4000 - Fees', department: 'School' }],
    options: { accounts: [], departments: [], channels: [], sources: [], branches: [] }
  });
  const result = merge([page(100), page(200)]);
  assert.equal(result.summary.totalIncome, 300);
  assert.equal(result.summary.transactionCount, 1);
  assert.equal(result.transactions[0].amount, 300);
});
