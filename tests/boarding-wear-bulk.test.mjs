import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareBoardingWearBulk, postBoardingWearBulk, reviewedBoardingWearPlan } from '../js/boarding-wear-bulk.js';

const candidate = (ref) => ({ profile: { AccountRef: ref }, ready: true, candidateOnly: true, amount: 60000 });
const verified = (ref) => ({ ...candidate(ref), readOnly: true, candidateOnly: false, previewToken: 'a'.repeat(64),
  releasedCredit: 60000, outstandingRemoved: 0 });

test('one read-only preparation checks every candidate with bounded requests and reports blocked accounts', async () => {
  const requests = [], progress = [];
  const plans = await prepareBoardingWearBulk([candidate('A'), candidate('B'), candidate('C')], async (payload) => {
    requests.push(payload);
    if (payload.AccountRef === 'B') return { ...verified('B'), ready: false, reason: 'Missing receipts' };
    if (payload.AccountRef === 'C') throw new Error('Network failure');
    return verified('A');
  }, (...args) => progress.push(args));
  assert.equal(requests.length, 3);
  assert.ok(requests.every((row) => row.action === 'previewReversal'));
  assert.equal(plans.filter(reviewedBoardingWearPlan).length, 1);
  assert.equal(plans[1].reason, 'Missing receipts');
  assert.equal(plans[2].reason, 'Network failure');
  assert.equal(progress.length, 3);
});

test('candidate-only, mismatched identity, invalid amounts/tokens and duplicate accounts cannot enter bulk posting', async () => {
  for (const row of [candidate('A'), { ...verified('A'), previewToken: '' }, { ...verified('A'), amount: NaN },
    { ...verified('A'), releasedCredit: 70000 }, { ...verified('A'), readOnly: false }, { ...verified('A'), profile: {} }]) {
    assert.equal(reviewedBoardingWearPlan(row), false);
  }
  const duplicate = await prepareBoardingWearBulk([candidate('A'), candidate('a')], () => { throw new Error('must not call'); });
  assert.ok(duplicate.every((row) => !row.ready));
  const mismatch = await prepareBoardingWearBulk([candidate('A')], async () => verified('B'));
  assert.equal(mismatch[0].ready, false);
  await assert.rejects(postBoardingWearBulk([verified('A'), verified('a')], 'Intake rule correction', () => {}), /Duplicate/);
});

test('one reason posts all verified accounts once; blocked accounts are excluded and failures do not retry', async () => {
  const payloads = [];
  const outcomes = await postBoardingWearBulk([verified('A'), { ...verified('B'), ready: false }, verified('C')], ' New Intake only ', async (payload) => {
    payloads.push(payload);
    if (payload.AccountRef === 'A') throw new Error('Stale preview');
    return { ok: true, summary: { CreditBalance: 60000 } };
  });
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads.map((row) => row.AccountRef), ['A', 'C']);
  assert.ok(payloads.every((row) => row.action === 'applyReversal' && row.Reason === 'New Intake only' && row.PreviewToken === 'a'.repeat(64)));
  assert.equal(outcomes[0].error, 'Stale preview');
  assert.equal(outcomes[1].result.ok, true);
  await assert.rejects(postBoardingWearBulk([verified('A')], '', () => {}), /reason/);
  await assert.rejects(postBoardingWearBulk([verified('A')], 'x'.repeat(501), () => {}), /reason/);
  await assert.rejects(postBoardingWearBulk([candidate('A')], 'Reason', () => {}), /No verified/);
});

test('bulk UI displays aggregate effects and requires one explicit financial approval before posting', async () => {
  const ui = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(ui, /data-prepare-boardwear-bulk/);
  assert.match(ui, /data-bulk-reversal-reason/);
  assert.match(ui, /confirmText: 'Approve and post all'/);
  assert.match(ui, /postBoardingWearBulk\(eligible, reason/);
  assert.match(ui, /finally \{\s+postButton.disabled = true;/);
  assert.match(ui, /Bulk Boarding Wear correction — results/);
  assert.match(ui, /data-refresh-boardwear-review>Run a fresh review/);
  assert.match(ui, /Finished — no corrections confirmed/);
});
