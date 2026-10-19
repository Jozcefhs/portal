import test from 'node:test';
import assert from 'node:assert/strict';

import { schoolFeeCreditSummary, schoolFeeTotalItem } from '../functions/api/parent-dashboard.js';

test('manual school-fee payments are not reported as acceptance credit', () => {
  const result = schoolFeeCreditSummary([
    { OriginalAmount: 204600, Amount: 100000, SchoolFeesTotalCreditApplied: 104600 }
  ], 100000, 204600);
  assert.equal(result.CreditApplied, 104600);
  assert.equal(result.SchoolFeesTotalCreditApplied, 104600);
  assert.equal(result.AcceptanceCreditApplied, 0);
  assert.equal(result.PreviousFeePaymentApplied, 0);
});

test('mixed credit sources retain their separate labels', () => {
  const result = schoolFeeCreditSummary([
    { AcceptanceCreditApplied: 20000, GeneralFeeCreditApplied: 10000 }
  ], 70000, 100000);
  assert.deepEqual(result, {
    CreditApplied: 30000,
    AcceptanceCreditApplied: 20000,
    SchoolFeesTotalCreditApplied: 0,
    GeneralFeeCreditApplied: 10000,
    PreviousFeePaymentApplied: 0
  });
});

test('fully settled components remain in the school fee breakdown evidence', () => {
  const total = schoolFeeTotalItem([{
    FeeCode: 'TUITION',
    FeeName: 'Tuition',
    FeeCategory: 'School Fee',
    OriginalAmount: 100000,
    Amount: 0,
    PaidAmount: 100000,
    AcceptanceCreditApplied: 100000
  }, {
    FeeCode: 'UNIFORM',
    FeeName: 'School Uniform',
    FeeCategory: 'School Fee',
    OriginalAmount: 192000,
    Amount: 192000
  }]);

  assert.equal(total.OriginalAmount, 292000);
  assert.equal(total.Amount, 192000);
  assert.equal(total.CreditApplied, 100000);
  assert.equal(total.AcceptanceCreditApplied, 100000);
  assert.deepEqual(total.Components.map((row) => row.FeeCode), ['TUITION', 'UNIFORM']);
});
