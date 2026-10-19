import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEntranceResultUpdates,
  buildProbationResitUpdates
} from '../functions/api/backend.js';

const timestamp = '2026-09-23T10:00:00.000Z';

test('an entrance result can place an applicant on probation', () => {
  const updates = buildEntranceResultUpdates({}, {
    ResultStatus: 'Probation',
    ResultPercentage: '61',
    ResultNextStep: 'Prepare for the probation re-sit.'
  }, timestamp);

  assert.equal(updates.ResultStatus, 'Probation');
  assert.equal(updates.Status, 'Probation');
  assert.equal(updates.ProbationResult, 'Pending');
  assert.equal(updates.ResultSent, 'NO');
  assert.equal(updates.OfferSent, 'NO');
});

test('editing an existing probation result preserves its re-sit record', () => {
  const updates = buildEntranceResultUpdates({
    ResultStatus: 'Probation',
    ProbationResult: 'Failed',
    ProbationResitStatus: 'Completed',
    ProbationResitDate: '2026-09-20'
  }, {
    ResultStatus: 'Probation'
  }, timestamp);

  assert.equal(updates.ProbationResult, 'Failed');
  assert.equal(updates.ProbationResitStatus, 'Completed');
  assert.equal(Object.hasOwn(updates, 'ProbationResitDate'), false);
});

test('a passed probation re-sit promotes the applicant and restarts document delivery', () => {
  const updates = buildProbationResitUpdates({
    ResultStatus: 'Probation',
    Status: 'Probation',
    ResultSent: 'YES',
    OfferSent: 'YES',
    EntranceResultPdfUrl: 'r2://old-result.pdf'
  }, {
    ProbationResitDate: '2026-09-23',
    ProbationResitScore: '149',
    ProbationResitPercentage: '74.5',
    ProbationResult: 'Passed',
    ProbationResultUpdatedBy: 'Admissions Officer'
  }, timestamp);

  assert.equal(updates.ProbationResult, 'Passed');
  assert.equal(updates.ResultStatus, 'Admitted');
  assert.equal(updates.Status, 'Accepted');
  assert.equal(updates.EnrollmentCategory, 'New Intake');
  assert.equal(updates.ResultSent, 'NO');
  assert.equal(updates.OfferSent, 'NO');
  assert.equal(updates.EntranceResultPdfUrl, '');
});

test('a failed probation re-sit keeps the applicant on probation', () => {
  const updates = buildProbationResitUpdates({ ResultStatus: 'Probation' }, {
    ProbationResitPercentage: '48',
    ProbationResult: 'Failed'
  }, timestamp);

  assert.equal(updates.ProbationResult, 'Failed');
  assert.equal(updates.ResultStatus, 'Probation');
  assert.equal(updates.Status, 'Probation');
});

test('probation promotion rejects missing scores and non-probation applicants', () => {
  assert.throws(
    () => buildProbationResitUpdates({ ResultStatus: 'Probation' }, { ProbationResult: 'Passed' }, timestamp),
    /valid probation re-sit percentage/i
  );
  assert.throws(
    () => buildProbationResitUpdates({ ResultStatus: 'Pending' }, { ProbationResult: 'Passed', ProbationResitPercentage: '80' }, timestamp),
    /currently on Probation/i
  );
});
