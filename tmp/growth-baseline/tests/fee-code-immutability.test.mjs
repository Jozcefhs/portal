import test from 'node:test';
import assert from 'node:assert/strict';

import { feeCodeRenameAllowed } from '../functions/api/backend.js';

test('new fees may use any non-conflicting code', () => {
  assert.equal(feeCodeRenameAllowed('', 'DEVELOPMENT_FEE'), true);
});

test('existing fee codes remain stable while other fee fields are edited', () => {
  assert.equal(feeCodeRenameAllowed('TUITION', 'TUITION'), true);
  assert.equal(feeCodeRenameAllowed('tuition', 'TUITION'), true);
  assert.equal(feeCodeRenameAllowed('TUITION', 'NEW_TUITION'), false);
});
