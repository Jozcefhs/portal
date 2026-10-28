import test from 'node:test';
import assert from 'node:assert/strict';
import { planFormerArmScoreRestoration as plan, planRestoredScoreReviews } from '../scripts/lib/restore-academic-score-cells.mjs';
import { academicComponentReviews } from '../functions/lib/academic-component-review.js';
import { academicAssessmentScheme, calculateAcademicStudentScore } from '../functions/lib/academic-scorebook.js';

function fixture() {
  const scope = { BranchId: 'main', SchoolSection: 'secondary', SessionId: 'session', TermId: 'term', ClassId: 'grade8', StudentRef: 'ST/1', SubjectId: 'maths' };
  const sheet = { ...scope, SheetId: 'current', ArmId: 'radiance', Status: 'Draft', AssessmentRevisionId: 'rev',
    AssessmentComponents: [{ Id: 'ca1', Name: 'CA1', MaximumScore: 100, WeightPercentage: 30, Required: true },
      { Id: 'exam', Name: 'Exam', MaximumScore: 100, WeightPercentage: 70, Required: true }],
    GradeBands: [{ Grade: 'A', MinimumPercentage: 50, MaximumPercentage: 100 }, { Grade: 'F', MinimumPercentage: 0, MaximumPercentage: 49.99 }] };
  const scheme = academicAssessmentScheme({ Assessment: { Components: sheet.AssessmentComponents, GradeBands: sheet.GradeBands } });
  const record = (id, arm, ca1, exam) => ({ ...scope, ScoreId: id, SheetId: id === 'old' ? 'former' : 'current', ArmId: arm,
    __updateTime: 'revision', ...calculateAcademicStudentScore(scheme, [{ ComponentId: 'ca1', State: 'Numeric', RawScore: ca1 }, { ComponentId: 'exam', State: 'Numeric', RawScore: exam }]) });
  return { source: record('old', 'reserved', 65, 55), target: record('new', 'radiance', 75, 90),
    membership: { ...scope, ArmId: 'radiance', Status: 'Active' }, sheet, cellIds: ['ca1'],
    actor: { repairId: 'restore-1', timestamp: '2026-10-28T12:00:00Z', reason: 'Owner chose the earlier marks', name: 'Authorised restoration', username: 'system:repair' } };
}

test('restore only the requested earlier mark, recompute totals and preserve later history and other tests', () => {
  const input = fixture(); input.target.ManualScoreCorrections = [{ CellId: 'ca1', Reason: 'Previous correction' }];
  const before = structuredClone(input), result = plan(input);
  assert.equal(result.data.ComponentScores[0].RawScore, 65);
  assert.equal(result.data.ComponentScores[1].RawScore, 90);
  assert.equal(result.data.Percentage, 82.5);
  assert.deepEqual(result.data.ManualScoreCorrections[0], before.target.ManualScoreCorrections[0]);
  assert.equal(result.data.ScoreRestorationHistory[0].Cells[0].Before.RawScore, 75);
  assert.equal(result.data.ScoreRestorationHistory[0].Cells[0].After.RawScore, 65);
  for (const field of ['ArmId', 'SheetId', 'ScoreId', 'Status']) assert.equal(Object.hasOwn(result.data, field), false);
  assert.deepEqual(input, before);
});

test('restoration retry is a no-op and cannot overwrite a subsequent authorised correction', () => {
  const input = fixture(), result = plan(input);
  input.target = { ...input.target, ...result.data };
  assert.equal(plan(input), null);
  input.target.ComponentScores[0].RawScore = 80;
  assert.throws(() => plan(input), /already applied/);
});

test('matching cells require no write or additional history', () => {
  const input = fixture(); input.target.ComponentScores[0].RawScore = 65;
  assert.equal(plan(input), null);
});

test('scope, placement, scale, missing source, duplicate cells, published sheet and revision mismatches stop the plan', () => {
  const mutations = [
    i => { i.source.TermId = 'older'; }, i => { i.source.StudentRef = 'ST/2'; },
    i => { i.source.BranchId = 'another'; }, i => { i.source.SubjectId = 'english'; },
    i => { i.membership.ArmId = 'other'; }, i => { i.membership.Status = 'Archived'; },
    i => { i.source.ArmId = i.target.ArmId; }, i => { i.target.__updateTime = ''; },
    i => { i.sheet.Status = 'Approved'; }, i => { i.sheet.ClassId = 'other'; },
    i => { i.source.ComponentScores[0].MaximumScore = 50; },
    i => { i.source.ComponentScores[0].State = 'Missing'; },
    i => { i.source.ComponentScores.push({ ...i.source.ComponentScores[0] }); },
    i => { i.cellIds.push('ca1'); }, i => { i.actor.reason = ''; }
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => plan(input)); }
});

test('zero, absence and exemption retain their meaning', () => {
  for (const patch of [{ State: 'Numeric', RawScore: 0 }, { State: 'Absent', RawScore: null }, { State: 'Exempt', RawScore: null }]) {
    const input = fixture(); Object.assign(input.source.ComponentScores[0], patch);
    const result = plan(input);
    assert.equal(result.data.ComponentScores[0].State, patch.State);
    assert.equal(result.data.ComponentScores[0].RawScore, patch.RawScore);
  }
});

test('scheme differences cannot silently change an unrelated maximum or lose another test', () => {
  const input = fixture(); input.sheet.AssessmentComponents[1].MaximumScore = 120;
  assert.throws(() => plan(input), /preserve/);
});

test('other students keep valid approvals while only restored marks await review', async () => {
  const input = fixture(), restored = plan(input);
  const peer = { ...input.target, StudentRef: 'ST/2', ScoreId: 'peer' };
  const roster = [input.membership, { ...input.membership, StudentRef: 'ST/2' }], before = [input.target, peer];
  const initial = await academicComponentReviews(input.sheet, roster, before);
  input.sheet.ComponentReviews = Object.fromEntries(initial.map(row => [row.ComponentId, {
    ComponentId: row.ComponentId, Status: 'Approved', ScoreDigest: row.ScoreDigest, ApprovedBy: 'Reviewer', PendingStudentRefs: []
  }]));
  const after = [{ ...input.target, ...restored.data }, peer];
  const reviews = await planRestoredScoreReviews(input.sheet, roster, before, after, [{ StudentRef: 'ST/1', changes: restored.changes }]);
  assert.equal(reviews.ca1.Status, 'Approved');
  assert.deepEqual(reviews.ca1.PendingStudentRefs, ['st/1']);
  assert.deepEqual(reviews.exam, input.sheet.ComponentReviews.exam);
  const verified = await academicComponentReviews({ ...input.sheet, ComponentReviews: reviews }, roster, after);
  assert.equal(verified[0].Stale, false);
  assert.equal(verified[0].Status, 'Approved');
  assert.equal(verified[0].PendingStudentCount, 1);
  input.sheet.ComponentReviews.ca1.ScoreDigest = 'stale-before-repair';
  const stale = await planRestoredScoreReviews(input.sheet, roster, before, after, [{ StudentRef: 'ST/1', changes: restored.changes }]);
  assert.deepEqual(stale.ca1, input.sheet.ComponentReviews.ca1);
});
