import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructuredQuery } from '../functions/lib/firestore.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const firestoreSource = await readFile(new URL('../functions/lib/firestore.js', import.meta.url), 'utf8');
function databaseContext(response) {
  const context = vm.createContext({TextEncoder,TextDecoder,URLSearchParams,fetch:async()=>response});
  vm.runInContext(firestoreSource.replace(/^export /gm,''),context);
  context.getFirestoreAccessToken = async ()=>'test';
  return context;
}
const testEnv = {FIREBASE_PROJECT_ID:'test',FIREBASE_CLIENT_EMAIL:'test',FIREBASE_PRIVATE_KEY:'test'};

test('IN reference queries preserve long and numeric-looking identifiers exactly like scalar queries', () => {
  const references = ['261022020100617512345678', '12345', '0012345', 'DCA/24/1822', 'SYS-PAY-12345'];
  for (const field of ['Reference', 'GatewayReference', 'SourceId', 'JournalNo', 'AdmissionNo', 'Code']) {
    const scalar = references.map(value => buildStructuredQuery('records', { filters: [{ field, op: '==', value }] }).structuredQuery.where.fieldFilter.value);
    const array = buildStructuredQuery('records', { filters: [{ field, op: 'in', value: references }] }).structuredQuery.where.fieldFilter.value.arrayValue.values;
    assert.deepEqual(array, scalar, field);
    assert.deepEqual(array, references.map(stringValue => ({ stringValue })));
  }
});

test('array-contains-any identifiers remain strings while monetary filter values remain numeric', () => {
  const ids = buildStructuredQuery('memberships', { filters: [{ field: 'SubjectIds', op: 'array-contains-any', value: ['123', '456'] }] });
  assert.deepEqual(ids.structuredQuery.where.fieldFilter.value.arrayValue.values, [{ stringValue: '123' }, { stringValue: '456' }]);
  const amounts = buildStructuredQuery('payments', { filters: [{ field: 'Amount', op: 'in', value: ['125', 12.5, 0] }] });
  assert.deepEqual(amounts.structuredQuery.where.fieldFilter.value.arrayValue.values, [{ integerValue: '125' }, { doubleValue: 12.5 }, { integerValue: '0' }]);
});

test('HTTP error streams retain the actual database reason and normalized retry status', async () => {
  for (const [status, upstream, message, expectedStatus] of [
    [400, 'INVALID_ARGUMENT', 'Invalid integer in reference filter', 400],
    [400, 'RESOURCE_EXHAUSTED', 'Quota exceeded', 429],
    [400, 'ABORTED', 'Concurrent update', 409]
  ]) {
    const context = databaseContext({ ok: false, status, json: async () => [{ error: { status: upstream, message } }] });
    await assert.rejects(context.queryCollection(testEnv, 'payments'), error =>
      error.message === message && error.status === expectedStatus && error.upstreamCode === upstream);
  }
});

test('aggregation counts return zero accurately, carry a snapshot and reject incomplete responses', async () => {
  const readTime = '2026-10-24T10:00:00.000Z';
  for (const value of ['0', '22000']) {
    const context = databaseContext({ ok: true, status: 200, json: async () => [{ result: { aggregateFields: { total: { integerValue: value } } }, readTime }] });
    const result = await context.countCollection(testEnv, 'items');
    assert.equal(result.count, Number(value)); assert.equal(result.readTime, readTime);
  }
  for (const body of [[], {}, [{ readTime }], [{ result: { aggregateFields: { total: { integerValue: '-1' } } }, readTime }],
    [{ result: { aggregateFields: { total: { integerValue: '9007199254740992' } } }, readTime }],
    [{ result: { aggregateFields: { total: { integerValue: '0' } } }, readTime }, { error: { message: 'Unavailable' } }]]) {
    const context = databaseContext({ ok: true, status: 200, json: async () => body });
    await assert.rejects(context.countCollection(testEnv, 'items'), { code: 'FIRESTORE_COUNT_RESPONSE_INVALID' });
  }
});

test('count requests use the correct nested collection endpoint and fixed snapshot', async () => {
  const context = databaseContext({});
  const calls = [];
  context.firestoreRequest = async (_env, endpoint, options) => {
    calls.push({ endpoint, body: JSON.parse(options.body) });
    return [{ result: { aggregateFields: { total: { integerValue: '2' } } }, readTime: '2026-10-24T10:00:00.000Z' }];
  };
  await context.countCollection(testEnv, 'schoolBranches/main/sections/secondary/students', {
    readTime: '2026-10-24T10:00:00.000Z', filters: [{ field: 'BranchId', op: 'in', value: ['main', 'north'] }]
  });
  assert.equal(calls[0].endpoint, 'schoolBranches/main/sections/secondary:runAggregationQuery');
  assert.equal(calls[0].body.readTime, '2026-10-24T10:00:00.000Z');
  assert.equal(calls[0].body.structuredAggregationQuery.structuredQuery.from[0].collectionId, 'students');
  assert.equal(calls[0].body.structuredAggregationQuery.aggregations[0].alias, 'total');
});

test('a successful HTTP response with truncated JSON fails instead of becoming an empty collection',async()=>{
  const context = databaseContext({ok:true,status:200,json:async()=>{throw new SyntaxError('Truncated JSON');}});
  await assert.rejects(context.queryCollection(testEnv,'scores'),{code:'FIRESTORE_RESPONSE_INVALID',status:502});
});

test('invalid query envelopes and inline stream errors cannot become empty or partial records',async()=>{
  for (const body of [{}, {error:{message:'Read failed'}}, [{document:{name:'scores/one',fields:{}}},{error:{status:'RESOURCE_EXHAUSTED',message:'Limit'}}]]) {
    const context = databaseContext({ok:true,status:200,json:async()=>body});
    await assert.rejects(context.queryCollection(testEnv,'scores'),error=>error.status>=400 && error.code.startsWith('FIRESTORE_'));
  }
});

test('a legitimate empty Firestore stream remains an empty collection',async()=>{
  const context = databaseContext({ok:true,status:200,json:async()=>[{readTime:'2026-10-23T10:00:00Z'}]});
  assert.equal((await context.queryCollection(testEnv,'scores')).length,0);
});

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
