import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalPaymentReference, resolveHistoricalPaymentReference } from '../functions/lib/historical-payment-reference.js';
const area1 = { BranchId: 'area-1-primary', SchoolSection: 'primary' };
const row = { Reference: 'Invoice01' };
const payment = { Reference: 'Invoice01', __id: 'Invoice01', BranchId: "the-lord-s-garden-primary",
  SchoolSection: 'primary', Channel: 'Historical Payment Import', Gateway: 'Manual' };

test('branch-local import references separate branches and sections and normalize retry spelling', async () => {
  const first = await historicalPaymentReference('Invoice01', area1);
  assert.equal(first, await historicalPaymentReference(' invoice-01 ', area1));
  assert.notEqual(first, await historicalPaymentReference('Invoice01', payment));
  assert.notEqual(first, await historicalPaymentReference('Invoice01', { ...area1, SchoolSection: 'secondary' }));
  assert.notEqual(first, await historicalPaymentReference('Invoice02', area1));
});
test('a foreign historical import does not block Area 1; scoped retries reuse one identity', async () => {
  const store = new Map([['Invoice01', payment]]);
  const find = async key => store.get(key) || null;
  const resolved = await resolveHistoricalPaymentReference(row, area1, find, () => true);
  assert.equal(resolved.existing, null);
  assert.notEqual(resolved.reference, row.Reference);
  const saved = { ...payment, ...area1, Reference: resolved.reference, __id: resolved.reference };
  store.set(resolved.reference, saved);
  assert.equal((await resolveHistoricalPaymentReference(row, area1, find, () => true)).existing, saved);
  assert.equal(store.get('Invoice01'), payment);
  await assert.rejects(resolveHistoricalPaymentReference(row, area1, find, () => false), /different payment/);
});
test('legacy same-branch receipts retain their original reference and mismatches fail closed', async () => {
  const legacy = { ...payment, ...area1 };
  const find = async key => key === row.Reference ? legacy : null;
  assert.equal((await resolveHistoricalPaymentReference(row, area1, find, () => true)).reference, row.Reference);
  await assert.rejects(resolveHistoricalPaymentReference(row, area1, find, () => false), /different payment/);
});
test('provider references and failed database reads cannot become additional import receipts', async () => {
  for (const patch of [{ Gateway: 'Paystack' }, { Channel: 'Manual payment' }]) {
    await assert.rejects(resolveHistoricalPaymentReference(row, area1,
      async key => key === row.Reference ? { ...payment, ...patch } : null, () => true), /different payment/);
  }
  await assert.rejects(resolveHistoricalPaymentReference(row, area1, async () => { throw Error('read unavailable'); }, () => true), /unavailable/);
});
