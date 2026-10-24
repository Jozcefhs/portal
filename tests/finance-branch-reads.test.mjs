import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadBranchFinanceRows, loadBranchFinancePage } from '../functions/lib/finance-branch-reads.js';

const noScan = async () => { throw new Error('Unexpected cross-branch collection scan'); };
const blockedScans = { listCollection: noScan, listCollectionForReport: noScan, listCollectionPage: noScan };

test('other branches query only their indexed records, including session-specific student finance', async () => {
  const requests = [];
  const db = { ...blockedScans, queryCollectionPages: async (_env, collection, options) => {
    requests.push({ collection, options });
    assert.ok(options.filters.some(filter => ['BranchId', 'branchId'].includes(filter.field) && filter.value === 'north'));
    return [{ __id: 'north', BranchId: 'north' }];
  } };
  for (const collection of ['feeItems', 'accounts', 'accountingExpenses', 'payrollItems']) {
    assert.equal((await loadBranchFinanceRows({}, collection, 'north', {}, db)).length, 1);
  }
  const result = await loadBranchFinanceRows({}, 'payments', 'north', {
    filters: [{ field: 'AcademicSession', op: 'in', value: ['2026/2027', '', 'All'] }], readTime: 'snapshot'
  }, db);
  assert.equal(result.length, 1); // Upper/lower field queries are deduplicated.
  for (const request of requests.filter(row => row.collection === 'payments')) {
    assert.equal(request.options.filterJoin, 'AND');
    assert.equal(request.options.filters[1].field, 'AcademicSession');
    assert.equal(request.options.readTime, 'snapshot');
  }
  await assert.rejects(loadBranchFinanceRows({}, 'payments', 'north', {}, {
    ...blockedScans, queryCollectionPages: async () => { throw new Error('index unavailable'); }
  }), /index unavailable/);
});

test('main retains untagged legacy records, while all-branch reports remain available', async () => {
  const rows = [{ __id: 'old' }, { __id: 'main', BranchId: 'main' }, { __id: 'north', BranchId: 'north' }];
  const db = { listCollection: async () => rows, listBranchCollection: async () => rows, queryCollectionPages: noScan };
  assert.deepEqual((await loadBranchFinanceRows({}, 'payments', 'main', {}, db)).map(row => row.__id), ['old', 'main']);
  assert.equal((await loadBranchFinanceRows({}, 'payments', 'all', {}, db)).length, 3);
});

test('journal and payment pagination is branch-filtered and bound to its snapshot', async () => {
  const rows = [1, 2, 3].map(number => ({ __name: `projects/p/databases/(default)/documents/payments/${number}`, BranchId: 'north' }));
  const requests = [];
  const db = { ...blockedScans, queryCollection: async (_env, collection, options) => {
    assert.equal(collection, 'payments'); requests.push(options);
    assert.ok(options.filters.every(filter => filter.value === 'north'));
    assert.equal(options.readTime, 'snapshot');
    return options.startAfterName ? rows.slice(2) : rows;
  } };
  const first = await loadBranchFinancePage({}, 'payments', 'north', { readTime: 'snapshot', pageSize: 2 }, db);
  assert.equal(first.documents.length, 2); assert.ok(first.nextPageToken);
  const second = await loadBranchFinancePage({}, 'payments', 'north', { readTime: 'snapshot', pageSize: 2, pageToken: first.nextPageToken }, db);
  assert.equal(second.documents.length, 1); assert.equal(second.nextPageToken, '');
  assert.equal(requests[1].startAfterName, rows[1].__name);
  for (const [collection, branch, readTime] of [['payments', 'south', 'snapshot'], ['invoices', 'north', 'snapshot'], ['payments', 'north', 'other']]) {
    await assert.rejects(loadBranchFinancePage({}, collection, branch, { readTime, pageToken: first.nextPageToken }, db), error => error.status === 400);
  }
});

test('desktop overview and report routes use branch readers, not unfiltered operational scans', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const overview = source.slice(source.indexOf('async function getAccountingOverview('), source.indexOf('async function getAccountingOverview(') + 11000);
  assert.match(overview, /loadBranchFinanceRows\(env, collection, branchId/);
  assert.match(overview, /reportSnapshot\('invoices'\)/);
  assert.match(overview, /listChurchDonationsForAccounting\(env, \{ readTime: reportReadTime, branchId \}\)/);
  assert.match(source, /loadBranchFinancePage\(env, 'accountingJournals', branchId/);
  assert.match(source, /loadBranchFinancePage\(env, collection, branchId/);
  const shared = overview.slice(overview.indexOf('const sharedCollections'), overview.indexOf('const listSnapshot'));
  assert.match(shared, /chartOfAccounts/);
  assert.doesNotMatch(shared, /accountingExpenses|payrollItems|payments|invoices/);
});
