import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectCollectionPages } from '../functions/lib/firestore.js';

test('finance collection reads every cursor page beyond the ordinary five-page limit', async () => {
  const tokens = [];
  const rows = await collectCollectionPages(async (pageToken) => {
    tokens.push(pageToken);
    const page = tokens.length;
    return {
      documents: Array.from({ length: 1000 }, (_, index) => ({ __id: `${page}-${index}` })),
      nextPageToken: page < 7 ? `page-${page + 1}` : ''
    };
  }, 'invoices');
  assert.equal(rows.length, 7000);
  assert.deepEqual(tokens, ['', 'page-2', 'page-3', 'page-4', 'page-5', 'page-6', 'page-7']);
});

test('finance collection never returns incomplete totals on a repeated cursor or safety limit', async () => {
  await assert.rejects(
    collectCollectionPages(async () => ({ documents: [{ __id: '1' }], nextPageToken: 'repeat' }), 'invoices'),
    /repeated page token/
  );
  await assert.rejects(
    collectCollectionPages(async () => ({ documents: [{ __id: '1' }], nextPageToken: 'more' }), 'invoices', { maxPages: 1 }),
    (error) => error.code === 'FIRESTORE_REPORT_LIMIT' && error.status === 413
  );
});

test('finance screens avoid unbounded dashboard and income collection scans', async () => {
  for (const file of ['admin.js', 'backend.js', 'income-analytics.js', 'staff-records.js']) {
    const source = await readFile(new URL(`../functions/api/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /listCollection\(env, '(?:invoices|payments|ledger|accountingJournals)'\)/);
  }
  const admin = await readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
  const income = await readFile(new URL('../functions/api/income-analytics.js', import.meta.url), 'utf8');
  assert.match(admin, /currentSessionFinanceRows\(env, 'invoices', financeSession\)/);
  assert.match(admin, /queryCollectionPages\(env, collection/);
  assert.match(income, /journalsForPeriod\(env, period\)/);
  assert.match(income, /queryCollectionPages\(env, 'accountingJournals'/);
  assert.doesNotMatch(income, /listCollectionForReport\(env, 'accountingJournals'\)/);
});
