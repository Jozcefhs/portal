import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructuredQuery } from '../functions/lib/firestore.js';

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
