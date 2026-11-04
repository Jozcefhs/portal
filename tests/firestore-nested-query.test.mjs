import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructuredQuery } from '../functions/lib/firestore.js';

test('nested OR groups preserve the outer branch AND and typed values', () => {
  const { structuredQuery } = buildStructuredQuery('ledger', { filters: [
    { field: 'BranchId', op: '==', value: 'main' },
    { filterJoin: 'OR', filters: [
      { field: 'FeeCategory', op: 'in', value: ['Wallet', 'wallet'] },
      { field: 'FeeCode', op: '==', value: 'WALLET_TOPUP' },
      { filterJoin: 'AND', filters: [{ field: 'EntryType', op: '==', value: 'Wallet Refund' },
        { field: 'Credit', op: '>', value: 0 }] }
    ] }
  ], orderBy: [{ field: '__name__' }], limit: 500 });
  assert.equal(structuredQuery.where.compositeFilter.op, 'AND');
  assert.deepEqual(structuredQuery.where.compositeFilter.filters[0], {
    fieldFilter: { field: { fieldPath: 'BranchId' }, op: 'EQUAL', value: { stringValue: 'main' } }
  });
  const inner = structuredQuery.where.compositeFilter.filters[1].compositeFilter;
  assert.equal(inner.op, 'OR'); assert.equal(inner.filters[2].compositeFilter.op, 'AND');
  assert.deepEqual(inner.filters[2].compositeFilter.filters[1].fieldFilter.value, { integerValue: '0' });
  assert.equal(structuredQuery.limit, 500);
});

test('invalid filter groups fail instead of accidentally broadening a query', () => {
  for (const group of [{ filters: [] }, { filters: 'Wallet' },
    { filters: [{ field: 'FeeCategory', value: 'Wallet' }], filterJoin: 'XOR' },
    { field: 'BranchId', filters: [{ field: 'FeeCategory', value: 'Wallet' }] },
    { filters: [{ field: '', value: 'Wallet' }] }]) {
    assert.throws(() => buildStructuredQuery('ledger', { filters: [group] }), /database/);
  }
});
