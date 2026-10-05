const reference = (row) => String(row?.profile?.AccountRef || '').trim();
const key = (row) => reference(row).toLowerCase();

export function reviewedBoardingWearPlan(row) {
  return row?.ready === true && row?.readOnly === true && row?.candidateOnly === false &&
    /^[a-f0-9]{64}$/.test(row.previewToken || '') && !!reference(row) &&
    Number.isFinite(row.amount) && row.amount > 0 && Number.isFinite(row.releasedCredit) &&
    Number.isFinite(row.outstandingRemoved) && row.releasedCredit >= 0 && row.outstandingRemoved >= 0 &&
    Math.abs(row.amount - row.releasedCredit - row.outstandingRemoved) < 0.005;
}

// Bounded individual requests keep large school reviews off a single Worker
// request. No posting occurs until the user approves the combined preview.
export async function prepareBoardingWearBulk(candidates, request, progress = () => {}) {
  const counts = new Map();
  for (const row of candidates) counts.set(key(row), (counts.get(key(row)) || 0) + 1);
  const plans = [];
  for (const row of candidates) {
    progress(plans.length + 1, candidates.length, reference(row));
    if (!reference(row) || counts.get(key(row)) !== 1 || row.reason) {
      plans.push({ ...row, ready: false, reason: row.reason || 'Missing or duplicate student identity; finance review required.' });
      continue;
    }
    try {
      const plan = await request({ action: 'previewReversal', AccountRef: reference(row) });
      if (key(plan) !== key(row)) throw new Error('Preview identity differs from the selected account.');
      if (plan.ready && !reviewedBoardingWearPlan(plan)) throw new Error('A complete individual financial preview is required.');
      plans.push(plan);
    } catch (error) {
      plans.push({ ...row, ready: false, reason: error.message || 'Financial evidence could not be checked.' });
    }
  }
  return plans;
}

// Each account commits atomically through the existing authenticated endpoint.
// Partial progress is explicit; failed/unconfirmed submissions are never retried.
export async function postBoardingWearBulk(plans, reason, request, progress = () => {}) {
  reason = String(reason || '').trim();
  if (!reason || reason.length > 500) throw new Error('Enter one approval reason, up to 500 characters.');
  const ready = plans.filter(reviewedBoardingWearPlan);
  if (!ready.length) throw new Error('No verified reversals are ready to post.');
  if (new Set(ready.map(key)).size !== ready.length) throw new Error('Duplicate accounts cannot be posted in a bulk correction.');
  const outcomes = [];
  for (const plan of ready) {
    progress(outcomes.length + 1, ready.length, reference(plan));
    try {
      const result = await request({ action: 'applyReversal', AccountRef: reference(plan), PreviewToken: plan.previewToken, Reason: reason });
      if (result?.ok !== true) throw new Error('Posting was not confirmed.');
      outcomes.push({ reference: reference(plan), result });
    } catch (error) {
      outcomes.push({ reference: reference(plan), error: error.message || 'Posting was not confirmed; run a fresh review.' });
    }
  }
  return outcomes;
}
