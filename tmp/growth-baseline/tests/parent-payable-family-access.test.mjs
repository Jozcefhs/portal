import test from 'node:test';
import assert from 'node:assert/strict';

import { parentIdentityLookupFilters } from '../functions/api/backend.js';

test('payable lookup loads the whole application family as well as the login-code record', () => {
  assert.deepEqual(
    parentIdentityLookupFilters(
      'applications',
      'parent@example.com',
      'FIRST1',
      ['VerificationCode']
    ),
    [
      { field: 'VerificationEmail', value: 'parent@example.com' },
      { field: 'VerificationCode', value: 'FIRST1' }
    ]
  );
});

test('student payable lookup includes parent email and every supported login code field', () => {
  assert.deepEqual(
    parentIdentityLookupFilters(
      'students',
      'parent@example.com',
      'FAMILY1',
      ['ParentLoginCode', 'VerificationCode', 'LoginCode']
    ),
    [
      { field: 'ParentEmail', value: 'parent@example.com' },
      { field: 'ParentLoginCode', value: 'FAMILY1' },
      { field: 'VerificationCode', value: 'FAMILY1' },
      { field: 'LoginCode', value: 'FAMILY1' }
    ]
  );
});
