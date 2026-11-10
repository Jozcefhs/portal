import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { renderParentCredit } from './helpers/billing-credit-review.mjs';
const source = await readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../parent-dashboard.html', import.meta.url), 'utf8');
const functions = ['schoolFeeAdvanceAmount', 'schoolFeeAdvanceDraft', 'paySchoolFeeAdvance']
  .map(name => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0]).join('\n');
const child = { AccountRef: 'DEMO/1', SourceType: 'Student', BranchId: 'branch-a', __scopePath: 'schoolBranches/branch-a/sections/primary/students' };
const identity = row => `${row.__scopePath}|${row.AccountRef}`;
function harness(overrides = {}) {
  const calls = [], choices = [], redirects = [], drafts = new Map(); let key = 0;
  const context = vm.createContext({ schoolFeeAdvanceDrafts: drafts, childIdentity: identity,
    selectedChildKey: identity(child), renderSchoolFeeAdvance() {}, newIdempotencyKey: () => `request-${++key}`,
    authPayload: () => ({ email: 'synthetic@example.test' }),
    fetch: async (url, options) => { calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, directTransfer: true, reference: 'synthetic-transfer' }) }; },
    window: { DynamaxPaymentMethods: { choose: async options => { choices.push(options); return { paymentMethod: 'direct_bank_transfer', bankReference: 'BANK-DEMO' }; },
      directTransferMessage: data => `Transfer submitted: ${data.reference}` }, location: { assign: url => redirects.push(url) } }, ...overrides });
  vm.runInContext(functions, context);
  const draft = context.schoolFeeAdvanceDraft(child); draft.amount = '2500000.50';
  return { context, calls, choices, redirects, draft };
}

test('advance amount is uncapped by current debt and accepts only positive exact cents', () => {
  const { context } = harness();
  for (const [input, expected] of [['2,500,000.50', 2500000.5], ['0.01', .01], ['25000000', 25000000]]) assert.equal(context.schoolFeeAdvanceAmount(input), expected);
  for (const input of ['', '0', '-1', 'Infinity', '1e6', '1.001', '9007199254740992', '<script>', 'abc']) assert.equal(context.schoolFeeAdvanceAmount(input), null);
});

test('advance checkout carries exact child scope and pending transfer cannot be submitted twice', async () => {
  const { context, calls, choices, draft } = harness();
  await context.paySchoolFeeAdvance(child); await context.paySchoolFeeAdvance(child);
  assert.equal(calls.length, 1); assert.equal(choices.length, 1);
  assert.equal(calls[0].body.feeCode, 'SCHOOL_FEES_ADVANCE'); assert.equal(calls[0].body.amount, 2500000.5);
  assert.equal(calls[0].body.accountRef, child.AccountRef); assert.equal(calls[0].body.scopePath, child.__scopePath);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[0].body.idempotencyKey);
  assert.equal(draft.completed, true); assert.match(draft.message, /after the Accounts Office confirms/);
});

test('busy guard covers the payment-method dialog and cancel sends no payment request', async () => {
  const h = harness(); let finish;
  h.context.window.DynamaxPaymentMethods.choose = () => new Promise(resolve => { finish = resolve; });
  const first = h.context.paySchoolFeeAdvance(child);
  await h.context.paySchoolFeeAdvance(child); assert.equal(h.calls.length, 0); assert.equal(h.draft.busy, true);
  finish(null); await first; assert.equal(h.draft.busy, false); assert.equal(h.calls.length, 0);
});

test('uncertain network failure retries the exact amount, bank details and idempotency key', async () => {
  const h = harness(); let count = 0;
  h.context.fetch = async (url, options) => { h.calls.push(JSON.parse(options.body));
    if (++count === 1) throw new Error('Network interrupted');
    return { ok: true, status: 200, json: async () => ({ ok: true, directTransfer: true }) }; };
  await h.context.paySchoolFeeAdvance(child);
  assert.equal(h.draft.requestStarted, true); assert.match(h.draft.message, /Retry payment request/);
  await h.context.paySchoolFeeAdvance(child);
  assert.equal(h.choices.length, 1); assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[0], h.calls[1]);
  assert.equal(h.draft.completed, true);
});

test('definite validation rejection unlocks editing, while gateway checkout never credits locally', async () => {
  const h = harness(); h.context.fetch = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, message: 'Invalid amount' }) });
  await h.context.paySchoolFeeAdvance(child);
  assert.equal(h.draft.requestStarted, false); assert.equal(h.draft.choice, undefined); assert.equal(h.draft.idempotencyKey, undefined);
  h.context.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, authorizationUrl: 'https://checkout.example.test/session' }) });
  await h.context.paySchoolFeeAdvance(child);
  assert.deepEqual(h.redirects, ['https://checkout.example.test/session']); assert.equal(h.draft.completed, false);
  assert.match(h.draft.message, /only after successful payment/);
});

test('applicants and changed selected children cannot initiate advance checkout', async () => {
  const h = harness(); await h.context.paySchoolFeeAdvance({ ...child, SourceType: 'Applicant' });
  h.context.window.DynamaxPaymentMethods.choose = async () => { h.context.selectedChildKey = 'other-child'; return { paymentMethod: 'paystack' }; };
  await h.context.paySchoolFeeAdvance(child);
  assert.equal(h.calls.length, 0); assert.equal(h.draft.choice, undefined); assert.equal(h.draft.busy, false);
});

test('advance card is in Payments, has no balance maximum, and clears drafts on parent sign-out', () => {
  assert.match(html, /data-dashboard-view="payments"[^]*?id="schoolFeeAdvance"/);
  const render = source.match(/function renderSchoolFeeAdvance\([^]*?\n}/)[0];
  assert.match(render, /separate from the spending wallet/); assert.match(render, /Make another advance payment/);
  assert.doesNotMatch(render, /\bmax=/); assert.doesNotMatch(render, /fetch\(/);
  assert.match(source, /parentDocumentIdempotencyKeys\.clear\(\);\s*schoolFeeAdvanceDrafts\.clear\(\)/);
});

test('verified unapplied credit is separate from net invoice credit and retains billing-review notices', async () => {
  const summary = { TotalDebit: 1000, TotalCredit: 500, CreditBalance: 0, SchoolFeeCreditManaged: true, PendingSchoolFeeCredit: 500 };
  const html = await renderParentCredit(summary);
  assert.match(html, /School-fee credit available/); assert.match(html, /unapplied balance from confirmed school-fee payments/);
  assert.match(html, /500/); assert.match(html, /Recorded Fee Credit/);
  const provisional = await renderParentCredit({ ...summary, CreditBalance: 100, BillingReview: { status: 'blocked', message: 'Please review the posted bill.' } });
  assert.match(provisional, /Provisional Fee Credit/); assert.match(provisional, /Please review the posted bill/);
  assert.match(provisional, /School-fee credit available/);
  for (const invalid of [{ PendingSchoolFeeCredit: 500 }, { SchoolFeeCreditManaged: true }, { SchoolFeeCreditManaged: true, PendingSchoolFeeCredit: -1 }])
    assert.doesNotMatch(await renderParentCredit(invalid), /School-fee credit available/);
});
