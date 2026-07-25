import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSchoolFeeInvoiceAccountRefs } from '../functions/api/backend.js';

test('single account reference resolves for legacy payloads', () => {
  assert.deepEqual(
    resolveSchoolFeeInvoiceAccountRefs({ AccountRef: ' DCA/26/001 ' }),
    ['DCA/26/001']
  );
  assert.deepEqual(
    resolveSchoolFeeInvoiceAccountRefs({ accountRef: 'dca/26/002' }),
    ['dca/26/002']
  );
});

test('batch payload resolves unique references and keeps first casing', () => {
  assert.deepEqual(
    resolveSchoolFeeInvoiceAccountRefs({
      AccountRef: ' DCA/26/001 ',
      AccountRefs: ['DCA/26/001', 'dca/26/002', '  ', 'DCA/26/003', 'dca/26/002']
    }),
    ['DCA/26/001', 'dca/26/002', 'DCA/26/003']
  );
});

test('batch payload supports comma separated refs', () => {
  assert.deepEqual(
    resolveSchoolFeeInvoiceAccountRefs({ AccountRefs: 'DCA/26/001, dca/26/004,  ,DCA/26/005' }),
    ['DCA/26/001', 'dca/26/004', 'DCA/26/005']
  );
});
