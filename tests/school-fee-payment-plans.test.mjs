import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeSchoolFeePaymentPlan, schoolFeePaymentPlansId, schoolFeePaymentPlanRuleId,
  loadSchoolFeePaymentPlans, selectSchoolFeePaymentPlan, quoteSchoolFeePaymentPlan,
  handleSchoolFeePaymentPlans } from '../functions/lib/school-fee-payment-plans.js';

const user = { username: 'accounts', role: 'Accounts Officer', edition: 'school', allowedSections: ['accounts'], branchId: 'main' };
const base = { Name: 'All', AcademicSession: 'All', Term: 'All', Mode: 'Existing fee-item rules' };
const account = { BranchId: 'main', BillingCategory: 'Regular', AcademicSession: '2026/2027', Term: 'First Term' };
const rule = (Mode, extra = {}) => ({ ...base, Mode, ...extra });
const quote = (Mode, extra = {}, totals = {}) => quoteSchoolFeePaymentPlan({
  rule: rule(Mode, extra), originalTotal: 1000, balance: 1000, ...totals
});

test('normalization defaults to unchanged fee-item rules and clears dormant controls', () => {
  assert.deepEqual(normalizeSchoolFeePaymentPlan({ Name: ' All ', Value: 123, InstallmentCount: 3 }), {
    ...base, Value: 0, PercentageBasis: 'Total school fees', InstallmentCount: 0, DueDates: []
  });
  assert.equal(normalizeSchoolFeePaymentPlan(rule('Percentage', { Value: '12.50' })).Value, 12.5);
  assert.equal(normalizeSchoolFeePaymentPlan(rule('Equal installments', { InstallmentCount: '12' })).InstallmentCount, 12);
});

for (const [name, input] of [
  ['missing category', { ...base, Name: '' }], ['invalid mode', rule('Unknown')],
  ['zero percent', rule('Percentage', { Value: 0 })], ['excess percentage', rule('Percentage', { Value: 100.01 })],
  ['zero fixed amount', rule('Fixed minimum', { Value: 0 })], ['fractional cent', rule('Fixed minimum', { Value: 1.001 })],
  ['nonfinite value', rule('Percentage', { Value: Infinity })], ['wrong basis', rule('Percentage', { Value: 50, PercentageBasis: 'Receipts' })],
  ['fractional count', rule('Equal installments', { InstallmentCount: 2.5 })], ['too many portions', rule('Equal installments', { InstallmentCount: 13 })],
  ['one portion', rule('Equal installments', { InstallmentCount: 1 })], ['mixed period', { ...base, Term: 'First Term' }],
  ['dates without period', rule('Equal installments', { InstallmentCount: 2, DueDates: ['2026-10-01', '2026-11-01'] })],
  ['dates with other mode', rule('Full payment', { DueDates: ['2026-10-01'] })],
  ['missing date', rule('Equal installments', { ...account, InstallmentCount: 2, DueDates: ['2026-10-01'] })],
  ['invalid date', rule('Equal installments', { ...account, InstallmentCount: 2, DueDates: ['2026-02-30', '2026-11-01'] })],
  ['duplicate date', rule('Equal installments', { ...account, InstallmentCount: 2, DueDates: ['2026-10-01', '2026-10-01'] })],
  ['descending dates', rule('Equal installments', { ...account, InstallmentCount: 2, DueDates: ['2026-11-01', '2026-10-01'] })]
]) test(`invalid plan fails closed: ${name}`, () => assert.throws(() => normalizeSchoolFeePaymentPlan(input), { status: 400 }));

test('legacy totals use only Total/Both items, largest minimum and the existing one-naira fallback', () => {
  const components = [
    { Amount: 300, AllowInstallment: 'YES', PartPaymentMode: 'Total', MinAmount: 60 },
    { Amount: 400, AllowInstallment: 'YES', PartPaymentMode: 'Both', MinAmount: 100 },
    { Amount: 300, AllowInstallment: 'YES', PartPaymentMode: 'Item', MinAmount: 900 }
  ];
  assert.equal(quoteSchoolFeePaymentPlan({ components }).minAmount, 100);
  assert.equal(quoteSchoolFeePaymentPlan({ components }).planMode, 'Existing fee-item rules');
  assert.equal(quoteSchoolFeePaymentPlan({ components: [{ Amount: 10, AllowInstallment: 'YES', PartPaymentMode: 'Total' }] }).minAmount, 1);
  assert.equal(quoteSchoolFeePaymentPlan({ components: [{ Amount: 10, AllowInstallment: 'YES' }] }).minAmount, 10);
  assert.equal(quoteSchoolFeePaymentPlan({ components, originalTotal: 1000, balance: 0.5 }).minAmount, 0.5);
});

test('percentage uses the explicit base, rounds up cents, and caps the final residual', () => {
  assert.equal(quote('Percentage', { Value: 40 }, { balance: 600 }).minAmount, 400);
  assert.equal(quote('Percentage', { Value: 40, PercentageBasis: 'Outstanding balance' }, { balance: 600 }).minAmount, 240);
  assert.equal(quote('Percentage', { Value: 33.33 }, { originalTotal: 0.01, balance: 0.01 }).minAmount, 0.01);
  assert.equal(quote('Percentage', { Value: 50 }, { balance: 17.13 }).minAmount, 17.13);
  assert.equal(quote('Percentage', { Value: 100 }).allowInstallment, false);
});

test('full, fixed minimum, empty and fully paid bills never manufacture debt', () => {
  assert.equal(quote('Full payment', {}, { balance: 200 }).minAmount, 200);
  assert.equal(quote('Fixed minimum', { Value: 300 }, { balance: 200 }).minAmount, 200);
  assert.equal(quote('Fixed minimum', { Value: 300 }, { balance: 900 }).minAmount, 300);
  for (const Mode of ['Full payment', 'Percentage', 'Fixed minimum', 'Equal installments']) {
    const paid = quote(Mode, { Value: 50, InstallmentCount: 3 }, { balance: 0 });
    assert.equal(paid.minAmount, 0); assert.equal(paid.maxAmount, 0); assert.equal(paid.allowInstallment, false);
    assert.equal(paid.creditedAmount, 1000);
  }
  assert.equal(quoteSchoolFeePaymentPlan().minAmount, 0);
  assert.equal(quote('Equal installments', { InstallmentCount: 3 }, { originalTotal: 0, balance: 0 }).schedule.length, 3);
  for (const totals of [{ balance: -1 }, { originalTotal: 20, balance: 21 }, { originalTotal: NaN }, { balance: 0.001 }]) {
    assert.throws(() => quote('Full payment', {}, totals));
  }
});

test('installments retain the original principal, final cents and exact credit progress', () => {
  const first = quote('Equal installments', { InstallmentCount: 3 }, { originalTotal: 100, balance: 100 });
  assert.deepEqual(first.schedule.map(item => item.amount), [33.33, 33.33, 33.34]);
  assert.equal(first.minAmount, 33.33);
  const next = quote('Equal installments', { InstallmentCount: 3 }, { originalTotal: 100, balance: 66.67 });
  assert.equal(next.minAmount, 33.33); assert.equal(next.nextInstallment.number, 2);
  assert.deepEqual(next.schedule.map(item => item.remainingAmount), [0, 33.33, 33.34]);
  assert.equal(quote('Equal installments', { InstallmentCount: 3 }, { originalTotal: 100, balance: 50 }).minAmount, 16.66);
  assert.equal(quote('Equal installments', { InstallmentCount: 3 }, { originalTotal: 100, balance: 0.01 }).minAmount, 0.01);
  const tiny = quote('Equal installments', { InstallmentCount: 12 }, { originalTotal: 0.01, balance: 0.01 });
  assert.equal(tiny.minAmount, 0.01); assert.equal(tiny.nextInstallment.number, 12);
});

test('dated installments catch up overdue portions, while allowing advance and full payment', () => {
  const dated = { ...account, InstallmentCount: 3, DueDates: ['2026-10-01', '2026-11-01', '2026-12-01'] };
  for (const [now, balance, minimum, next] of [
    ['2026-09-01', 1000, 333.33, 1], ['2026-11-01', 1000, 666.66, 2],
    ['2026-11-02', 800, 466.66, 2], ['2026-10-01', 500, 166.66, 2], ['2027-01-01', 100, 100, 3]
  ]) {
    const output = quote('Equal installments', dated, { now, balance });
    assert.equal(output.minAmount, minimum); assert.equal(output.nextInstallment.number, next);
    assert.equal(output.nextInstallment.requiredAmount, minimum); assert.equal(output.maxAmount, balance);
  }
});

test('selection prioritizes period then category and never crosses branches or terms', () => {
  const all = rule('Full payment'), category = rule('Percentage', { Name: 'Regular', Value: 20 });
  const term = rule('Fixed minimum', { AcademicSession: account.AcademicSession, Term: account.Term, Value: 50 });
  const specific = { ...term, Name: 'Regular', Value: 80 };
  const settings = { branchId: 'main', rules: [specific, category, term, all], recordVersion: 'settings-v7' };
  assert.equal(selectSchoolFeePaymentPlan(settings, account).Value, 80);
  assert.equal(selectSchoolFeePaymentPlan({ ...settings, rules: [category, term, all] }, account).Value, 50);
  assert.equal(selectSchoolFeePaymentPlan(settings, { ...account, Term: 'Second Term' }).Value, 20);
  assert.equal(selectSchoolFeePaymentPlan(settings, { ...account, BillingCategory: 'Sibling Discount' }).Value, 50);
  assert.equal(selectSchoolFeePaymentPlan(settings, { ...account, BranchId: 'other' }), null);
  assert.equal(selectSchoolFeePaymentPlan({ ...settings, rules: [] }, account), null);
  assert.equal(selectSchoolFeePaymentPlan(settings, account).policyVersion, 'settings-v7');
  assert.throws(() => selectSchoolFeePaymentPlan({ ...settings, rules: [all, { ...all }] }, account), { status: 409 });
  const explicitLegacy = { ...specific, Mode: 'Existing fee-item rules', Value: 0 };
  assert.equal(selectSchoolFeePaymentPlan({ ...settings, rules: [explicitLegacy, category, term] }, account).Mode, 'Existing fee-item rules');
});

function database() {
  const docs = new Map(), reads = [], commits = [];
  let revision = 0, beforeCommit = null;
  const io = {
    getDocument: async (_env, collection, id) => { reads.push({ collection, id }); return structuredClone(docs.get(`${collection}/${id}`) || null); },
    listCollection: async (_env, collection) => { reads.push({ collection }); assert.equal(collection, 'billingCategories'); return [{ Name: 'Special Family' }]; },
    batchCommitLiteralDocuments: async (_env, writes) => {
      beforeCommit?.(writes);
      for (const write of writes) {
        const current = docs.get(`${write.collectionPath}/${write.documentId}`);
        if (write.exists === false && current || write.updateTime && current?.__updateTime !== write.updateTime) throw Object.assign(new Error('Concurrent change'), { status: 409 });
      }
      commits.push(structuredClone(writes));
      const updateTime = `version-${++revision}`;
      for (const write of writes) docs.set(`${write.collectionPath}/${write.documentId}`, { ...structuredClone(write.data), __updateTime: updateTime });
      return { writeResults: writes.map(() => ({ updateTime })) };
    }
  };
  return { docs, reads, commits, io, race: callback => { beforeCommit = callback; },
    save: input => handleSchoolFeePaymentPlans({}, user, { action: 'save', BranchId: 'main', ...input }, io) };
}

test('one deterministic branch read serves any number of fee components and quote never mutates data', async () => {
  const db = database(), input = rule('Percentage', { Value: 40 });
  assert.equal(await schoolFeePaymentPlansId('MAIN'), await schoolFeePaymentPlansId('main'));
  assert.equal(await schoolFeePaymentPlanRuleId('main', input), await schoolFeePaymentPlanRuleId('main', { ...input, Name: 'ALL' }));
  assert.notEqual(await schoolFeePaymentPlansId('main'), await schoolFeePaymentPlansId('other'));
  await db.save(input); db.reads.length = 0;
  const settings = await loadSchoolFeePaymentPlans({}, 'main', db.io);
  assert.equal(db.reads.length, 1); assert.equal(db.reads[0].collection, 'schoolFeePaymentPlans');
  const selected = selectSchoolFeePaymentPlan(settings, account), before = structuredClone(selected);
  const components = Array.from({ length: 150 }, () => ({ Amount: 1, OriginalAmount: 1 }));
  const original = structuredClone(components);
  for (let index = 0; index < 3; index++) assert.equal(quoteSchoolFeePaymentPlan({ rule: selected, components }).minAmount, 60);
  const output = quoteSchoolFeePaymentPlan({ rule: selected, components });
  assert.equal(output.ruleId, selected.RuleId); assert.equal(output.policyVersion, settings.recordVersion);
  assert.deepEqual(output.ruleSnapshot, normalizeSchoolFeePaymentPlan(selected));
  output.ruleSnapshot.DueDates.push('2099-01-01');
  assert.deepEqual(selected, before); assert.deepEqual(components, original); assert.equal(db.reads.length, 1);
  assert.equal(db.commits.length, 1);
});

test('settings create, update and no-op retry write only settings and one audit', async () => {
  const db = database(), input = rule('Fixed minimum', { Value: 200 });
  const first = await db.save(input);
  assert.equal(first.changed, true); assert.equal(first.recordVersion, 'version-1');
  assert.deepEqual(db.commits[0].map(write => write.collectionPath), ['schoolFeePaymentPlans', 'accountingAudit']);
  assert.equal(db.commits[0][0].exists, false);
  const replay = await db.save(input);
  assert.equal(replay.changed, false); assert.equal(db.commits.length, 1);
  await assert.rejects(db.save({ ...input, Value: 300, recordVersion: '' }), { status: 409 });
  const next = await db.save({ ...input, Value: 300, recordVersion: first.recordVersion });
  assert.equal(next.changed, true); assert.equal(db.commits[1][0].updateTime, first.recordVersion);
  assert.equal(db.commits[1][0].data.Rules.length, 1);
  assert.equal(db.commits[1][1].data.Before.Value, 200); assert.equal(db.commits[1][1].data.After.Value, 300);
  const listing = await handleSchoolFeePaymentPlans({}, user, { action: 'list', BranchId: 'main' }, db.io);
  assert.equal(listing.rules.length, 1); assert.ok(listing.categories.includes('All')); assert.ok(listing.categories.includes('Special Family'));
  assert.equal(listing.recordVersion, next.recordVersion);
});

test('concurrent branch settings change aborts audit and rule writes atomically', async () => {
  const db = database(), first = await db.save(rule('Full payment'));
  const id = await schoolFeePaymentPlansId('main');
  db.race(() => { db.docs.get(`schoolFeePaymentPlans/${id}`).__updateTime = 'concurrent-version'; });
  await assert.rejects(db.save({ ...rule('Percentage', { Value: 50 }), recordVersion: first.recordVersion }), { status: 409 });
  assert.equal(db.commits.length, 1);
  assert.equal(db.docs.get(`schoolFeePaymentPlans/${id}`).Rules[0].Mode, 'Full payment');
});

test('wrong actor, branch, edition and read-only subscription cannot write settings', async () => {
  for (const [actor, body] of [
    [{ ...user, role: 'Teacher' }, {}], [{ ...user, allowedSections: [] }, {}], [{ ...user, edition: 'church' }, {}],
    [user, { BranchId: 'other' }], [user, { BranchId: 'all' }], [{ ...user, subscriptionReadOnly: true }, {}],
    [{ ...user, subscriptionActive: false }, {}], [{ ...user, branchAccess: 'selected', assignedBranchIds: [] }, {}]
  ]) {
    const db = database();
    await assert.rejects(handleSchoolFeePaymentPlans({}, actor, { action: 'save', ...rule('Full payment'), ...body }, db.io));
    assert.equal(db.reads.length, 0); assert.equal(db.commits.length, 0);
  }
});

test('stored settings fail closed on wrong branch, missing revision, duplicate identity and rule limit', async () => {
  const db = database(), id = await schoolFeePaymentPlansId('main');
  const normalized = normalizeSchoolFeePaymentPlan(rule('Full payment'));
  const savedRule = { ...normalized, RuleId: await schoolFeePaymentPlanRuleId('main', normalized) };
  for (const fields of [{ BranchId: 'other' }, { __updateTime: '' }, { Rules: [savedRule, savedRule] },
    { Rules: [{ ...savedRule, RuleId: 'forged' }] }, { Rules: Array.from({ length: 201 }, () => savedRule) }]) {
    db.docs.set(`schoolFeePaymentPlans/${id}`, { BranchId: 'main', __updateTime: 'v1', Rules: [savedRule], ...fields });
    await assert.rejects(loadSchoolFeePaymentPlans({}, 'main', db.io));
  }
  assert.equal(db.commits.length, 0);
});

test('200-rule limit blocks additions while an existing rule remains editable', async () => {
  const db = database(), id = await schoolFeePaymentPlansId('main');
  const Rules = await Promise.all(Array.from({ length: 200 }, async (_value, index) => {
    const normalized = normalizeSchoolFeePaymentPlan(rule('Full payment', { Name: `Category ${index}` }));
    return { ...normalized, RuleId: await schoolFeePaymentPlanRuleId('main', normalized) };
  }));
  db.docs.set(`schoolFeePaymentPlans/${id}`, { BranchId: 'main', __updateTime: 'v1', Rules });
  await assert.rejects(db.save({ ...rule('Full payment', { Name: 'Additional category' }), recordVersion: 'v1' }), { status: 409 });
  assert.equal(db.commits.length, 0);
  await db.save({ ...rule('Fixed minimum', { Name: 'Category 0', Value: 50 }), recordVersion: 'v1' });
  assert.equal(db.commits[0][0].data.Rules.length, 200);
});

test('simultaneous first saves cannot create duplicate settings or audit records', async () => {
  const db = database(), input = rule('Percentage', { Value: 35 });
  const outcomes = await Promise.allSettled([db.save(input), db.save(input)]);
  assert.ok(outcomes.some(item => item.status === 'fulfilled'));
  assert.equal(db.commits.length, 1);
  assert.equal((await db.save(input)).changed, false);
  assert.equal(db.commits.length, 1);
});

test('route authenticates, suppresses no-op audit and does not expose internal failures', async () => {
  const source = (await readFile(new URL('../functions/api/part-payment-plans.js', import.meta.url), 'utf8')).replace(/^import.*;\r?\n/gm, '').replace('export async function', 'async function');
  for (const result of [{ ok: true, changed: true }, { ok: true, changed: false }, new Error('private backend secret')]) {
    let actorSeen;
    const context = { env: {}, request: {}, data: {} };
    const api = vm.runInNewContext(`${source};onRequestPost`, { Response,
      requireStaffSession: async () => user, readJsonBody: async () => ({ action: 'save', ...base }),
      handleSchoolFeePaymentPlans: async (_env, actor) => { actorSeen = actor; if (result instanceof Error) throw result; return result; } });
    const response = await api(context), data = await response.json();
    assert.equal(actorSeen, user); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    if (result instanceof Error) {
      assert.equal(response.status, 500); assert.doesNotMatch(data.message, /private backend secret/);
      assert.equal(context.data.securityAuditHandled, undefined);
    }
    else {
      assert.equal(context.data.securityAuditNoChange === true, result.changed === false);
      assert.equal(context.data.securityAuditHandled, true);
    }
  }
});
