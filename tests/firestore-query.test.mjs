import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructuredQuery } from '../functions/lib/firestore.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('targeted root query uses Firestore runQuery with filters and a limit', () => {
  const result = buildStructuredQuery('payments', {
    filters: [{ field: 'Reference', op: '==', value: 'PAY-001' }],
    limit: 1
  });
  assert.equal(result.endpoint, ':runQuery');
  assert.equal(result.structuredQuery.from[0].collectionId, 'payments');
  assert.equal(result.structuredQuery.where.fieldFilter.field.fieldPath, 'Reference');
  assert.equal(result.structuredQuery.where.fieldFilter.value.stringValue, 'PAY-001');
  assert.equal(result.structuredQuery.limit, 1);
});

test('targeted scoped query keeps the parent path and supports IN filters', () => {
  const result = buildStructuredQuery('schoolBranches/main/sections/secondary/students', {
    filters: [{ field: 'AdmissionNo', op: 'in', value: ['DCA/1', 'DCA/2'] }]
  });
  assert.equal(result.endpoint, 'schoolBranches/main/sections/secondary:runQuery');
  assert.equal(result.structuredQuery.from[0].collectionId, 'students');
  assert.deepEqual(
    result.structuredQuery.where.fieldFilter.value.arrayValue.values.map((row) => row.stringValue),
    ['DCA/1', 'DCA/2']
  );
});

test('focused query projects only requested fields for lightweight counts', () => {
  const result = buildStructuredQuery('academicStudentMemberships', {
    filters: [{ field: 'BranchId', op: '==', value: 'main' }],
    select: ['BranchId', 'SchoolSection', 'Status']
  });
  assert.deepEqual(result.structuredQuery.select, {
    fields: [
      { fieldPath: 'BranchId' },
      { fieldPath: 'SchoolSection' },
      { fieldPath: 'Status' }
    ]
  });
  assert.equal(result.structuredQuery.where.fieldFilter.value.stringValue, 'main');
});

test('date-range query cursor continues after the last date and document name', () => {
  const result = buildStructuredQuery('accountingJournals', {
    filters: [
      { field: 'Date', op: '>=', value: '2026-09-01' },
      { field: 'Date', op: '<', value: '2026-10-01' }
    ],
    orderBy: [{ field: 'Date' }, { field: '__name__' }],
    startAfterFieldValue: '2026-09-20',
    startAfterName: 'projects/test/databases/(default)/documents/accountingJournals/J-1',
    limit: 500
  });
  assert.deepEqual(result.structuredQuery.startAt, {
    values: [
      { stringValue: '2026-09-20' },
      { referenceValue: 'projects/test/databases/(default)/documents/accountingJournals/J-1' }
    ],
    before: false
  });
  assert.equal(result.structuredQuery.limit, 500);
});

test('complete financial query keeps the same snapshot while paging and fails rather than returning partial rows', async () => {
  const source = await readFile(new URL('../functions/lib/firestore.js', import.meta.url), 'utf8');
  const section = source.slice(source.indexOf('export async function queryCollectionPages'), source.indexOf('export async function findOneByField')).replace('export ', '');
  const calls = [];
  const rows = Array.from({ length: 5 }, (_, index) => ({ __name: `documents/${index}`, Date: '2026-09-01' }));
  const query = vm.runInNewContext(`(${section})`, { queryCollection: async (_env, _collection, options) => {
    calls.push(options);
    const start = options.startAfterName ? Number(options.startAfterName.split('/').at(-1)) + 1 : 0;
    return rows.slice(start, start + options.limit);
  } });
  const options = { readTime: '2026-10-01T00:00:00.000Z', pageSize: 2, maxRows: 5, cursorField: 'Date' };
  assert.equal((await query({}, 'accountingJournals', options)).length, 5);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.readTime === options.readTime));
  assert.equal(calls[1].startAfterName, 'documents/1');
  assert.equal(calls[1].startAfterFieldValue, '2026-09-01');
  await assert.rejects(() => query({}, 'accountingJournals', { ...options, maxRows: 4 }), error => error.status === 413);
  assert.match(source, /JSON\.stringify\(\{ structuredQuery, \.\.\.\(options\.readTime \? \{ readTime: options\.readTime \}/);
});
