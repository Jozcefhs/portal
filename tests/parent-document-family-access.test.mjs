import test from 'node:test';
import assert from 'node:assert/strict';

import {
  accountSummaryForKeys,
  findParentOwnedApplication,
  parentOwnsApplication
} from '../functions/api/parent-dashboard.js';

test('parent account summary does not double-count invoice allocation and payment credit', () => {
  const summary = accountSummaryForKeys([], ['DCA/26/002', 'DCA/26/000002'], [{
    AccountRef: 'DCA/26/000002',
    ApplicationReference: 'DCA/26/000002',
    FeeCategory: 'Admission',
    Credit: 150000
  }, {
    AccountRef: 'DCA/26/002',
    ApplicationReference: 'DCA/26/000002',
    FeeCategory: 'School Fee',
    Credit: 144600
  }], [{
    AccountRef: 'DCA/26/002',
    ApplicationReference: 'DCA/26/000002',
    FeeCategory: 'School Fee',
    Debit: 294600,
    Credit: 294600
  }]);

  assert.deepEqual(summary, {
    TotalDebit: 294600,
    TotalCredit: 294600,
    AccountCreditDebits: 0,
    OutstandingBalance: 0,
    CreditBalance: 0
  });
});

test('paid acceptance deposit is not presented as available account credit before school invoicing', () => {
  const summary = accountSummaryForKeys([], ['DCA/26/000005'], [{
    AccountRef: 'DCA/26/000005',
    FeeCode: 'ACC',
    FeeName: 'Acceptance fee',
    FeeCategory: 'Admission',
    Credit: 100000
  }]);

  assert.deepEqual(summary, {
    TotalDebit: 100000,
    TotalCredit: 100000,
    AccountCreditDebits: 0,
    OutstandingBalance: 0,
    CreditBalance: 0
  });
});

test('a parent may select a second sibling application after family authentication', () => {
  const applications = [
    {
      ApplicationReference: 'DCA/26/000001',
      VerificationEmail: 'parent@example.com',
      VerificationCode: 'FIRST1'
    },
    {
      ApplicationReference: 'DCA/26/000002',
      VerificationEmail: 'parent@example.com',
      VerificationCode: 'SECOND2'
    }
  ];

  const selected = findParentOwnedApplication(
    applications,
    'DCA/26/000002',
    'PARENT@EXAMPLE.COM'
  );

  assert.equal(selected, applications[1]);
});

test('a matching application reference is rejected when the parent email differs', () => {
  const application = {
    ApplicationReference: 'DCA/26/000002',
    VerificationEmail: 'another-parent@example.com'
  };

  assert.equal(parentOwnsApplication(application, 'parent@example.com'), false);
  assert.equal(
    findParentOwnedApplication([application], 'DCA/26/000002', 'parent@example.com'),
    null
  );
});
