import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { historyDateRange, historyQueryOptions, loadDatedHistory } from '../functions/lib/history-date-range.js';
import { buildStructuredQuery } from '../functions/lib/firestore.js';

test('opening a date-mode history does not read documents; malformed dates never fall back to all records', async () => {
  const noRead = async () => assert.fail('Unexpected database read');
  const db = { listCollection: noRead, listBranchCollection: noRead, queryCollectionPages: noRead };
  assert.deepEqual(await loadDatedHistory({}, 'payments', { HistoryDateRange: {} }, 'Date', 'main', db), []);
  for (const dates of [{ fromDate: '2026-02-30', toDate: '2026-03-01' },
    { fromDate: '2026-10-25', toDate: '2026-10-01' }, { fromDate: '2026-10-01' }]) {
    await assert.rejects(loadDatedHistory({}, 'payments', { HistoryDateRange: dates }, 'Date', 'main', db), /valid/);
  }
});

test('each edition uses date bounds in the database query and keeps the branch restriction', async () => {
  for (const edition of ['school', 'faith', 'organisation']) {
    let calls = 0;
    const records = [{ PaymentNo: 'kept', Date: '2026-10-25', Amount: 400 }];
    const before = structuredClone(records);
    const rows = await loadDatedHistory({ ORGANISATION_EDITION: edition }, 'payments',
      { HistoryDateRange: { fromDate: '2026-10-23', toDate: '2026-10-25' } }, 'Date', 'east', {
        listBranchCollection: async (_env, collection, branch, options) => {
          calls++; assert.equal(collection, 'payments'); assert.equal(branch, 'east');
          buildStructuredQuery(collection, options);
          assert.deepEqual(options.filters.map(x => [x.field, x.op, x.value]),
            [['Date', '>=', '2026-10-23'], ['Date', '<=', '2026-10-25\uf8ff']]);
          assert.equal(options.cursorField, 'Date');
          return records;
        }
      });
    assert.equal(calls, 1); assert.deepEqual(rows, before); assert.deepEqual(records, before);
  }
});

test('legacy/internal read contracts remain unchanged and query failures are never reported as empty history', async () => {
  let reads = 0;
  assert.deepEqual(await loadDatedHistory({}, 'history', {}, 'Date', undefined, {
    listCollection: async () => { reads++; return [{ id: 1 }]; }
  }), [{ id: 1 }]);
  assert.equal(reads, 1);
  await assert.rejects(loadDatedHistory({}, 'history', { HistoryDateRange: { fromDate: '2026-10-23', toDate: '2026-10-25' } }, 'Timestamp', undefined,
    { queryCollectionPages: async () => { throw new Error('Index unavailable'); } }), /Index unavailable/);
});

test('date bounds accept leap days and include the last day without changing financial records', () => {
  assert.deepEqual(historyDateRange({ fromDate: '2024-02-29', toDate: '2024-03-01' }), { fromDate: '2024-02-29', toDate: '2024-03-01' });
  const options = historyQueryOptions({ fromDate: '2026-10-23', toDate: '2026-10-25' }, 'Timestamp');
  for (const date of ['2026-10-25', '2026-10-25T23:59:59.999Z']) {
    assert.ok(date >= options.filters[0].value && date <= options.filters[1].value);
  }
  assert.ok('2026-10-26' > options.filters[1].value);
});

test('web request decoration changes only supported history requests, retaining mutation payloads and identifiers', () => {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../js/history-date-range.js', import.meta.url), 'utf8'), context);
  const api = context.window.DynamaxHistoryDates;
  const input = JSON.stringify({ action: 'list', Amount: 150, OfferingId: 'unchanged' });
  const result = JSON.parse(api.datedHistoryBody('/api/staff-offerings', input, { fromDate: '2026-10-01', toDate: '2026-10-25' }));
  assert.equal(api.datedHistoryBody('/api/staff-offerings', '{"action":"saveoffering","Amount":150}', {}), '{"action":"saveoffering","Amount":150}');
  assert.equal(result.Amount, 150); assert.equal(result.OfferingId, 'unchanged');
  assert.equal(result.HistoryDateRange.toDate, '2026-10-25');
  assert.equal(api.datedHistoryBody('/api/staff-students', input, {}), input);
  assert.equal(api.datedHistoryBody('/api/admin', '{"section":"students"}', {}), '{"section":"students"}');
  assert.equal(api.validHistoryDates({ fromDate: '2026-02-30', toDate: '2026-03-01' }), false);
});
