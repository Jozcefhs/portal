import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { studentBillingReconciliationPlan, buildStudentBillingPreview,
  buildSchoolInvoiceChargeAccountingJournal, calculateAccountFinancialSummary } from '../functions/api/backend.js';
import { parentCreditReview } from '../functions/lib/student-billing-diagnostics.js';
import { reviewAllStudentBilling } from '../js/student-maintenance.js';
import { student, billingFixture, renderBillingReport } from './helpers/billing-credit-review.mjs';

const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const posting = source.slice(source.indexOf('export async function reconcileStudentBilling'),
  source.indexOf('// A narrowly scoped, reviewed correction for BOW')).replace(/^export /, '');
const copy = (value) => structuredClone(value);
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const amount = (value) => Math.round(Number(value || 0) * 100) / 100;

// Execute the production posting function with an in-memory, atomic,
// revision-checked database. No live financial services are contacted.
function harness({ configure = () => {}, closed = false, refreshFails = false, beforeCommit } = {}) {
  const profile = { ...student, __id: 'student', __updateTime: 'v1' };
  const data = billingFixture();
  for (const [collection, rows] of Object.entries(data)) if (Array.isArray(rows)) {
    rows.forEach((row, index) => Object.assign(row, { __id: row.__id || `${collection}-${index}`, __updateTime: 'v1' }));
  }
  configure(data);
  const originals = copy(data), db = new Map(), commits = [];
  db.set(`${profile.__scopePath}/${profile.__id}`, copy(profile));
  for (const collection of ['feeItems', 'invoices', 'payments', 'ledger', 'accountSummaries']) {
    for (const row of data[collection]) db.set(`${collection}/${row.__id}`, copy(row));
  }
  const calls = { preflight: 0, allocate: 0, refresh: 0 };
  let revision = 1;
  const read = () => ({ schoolProfile: {}, ...Object.fromEntries(['feeItems', 'invoices', 'payments', 'ledger', 'accountSummaries']
    .map((collection) => [collection, [...db.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => copy(row))])) });
  const apply = vm.runInNewContext(`${posting}; reconcileStudentBilling`, {
    crypto: webcrypto, TextEncoder, clean, lower, asMoneyNumber: amount,
    normalizeReferenceText: (value) => lower(value).replace(/[^a-z0-9]/g, ''),
    sameText: (a, b) => lower(a) === lower(b), accountRefsFrom: (row) => [row.AccountRef],
    safeDocumentId: (id) => id.replaceAll('/', '_'), feeDueDate: (date) => date || '',
    nowIso: () => '2026-10-16T12:00:00.000Z',
    getStudentBillingData: async () => read(), studentBillingReconciliationPlan,
    studentMissingChargeFees: (input, _profile, code) => input.feeItems.filter((fee) => lower(fee.FeeCode) === lower(code)),
    accountingPeriodIsClosed: async () => closed,
    syncSchoolAccountCreditJournals: async () => { calls.preflight++; return {}; },
    applyDueSchoolFeeCreditsForAccount: async () => { calls.allocate++; },
    refreshAccountFinancialSummary: async (_env, reference, _linked, scope) => {
      calls.refresh++;
      assert.equal(scope.branchId, 'main'); assert.equal(scope.schoolSectionAccess, 'secondary');
      if (refreshFails) throw new Error('Summary changed concurrently');
      const current = read();
      const summary = calculateAccountFinancialSummary(current.invoices, current.ledger, reference, '2026-10-16');
      Object.assign(db.get('accountSummaries/accountSummaries-0'), summary);
    },
    buildSchoolInvoiceChargeAccountingJournal,
    accountingAuditWrite: (_action, _type, _reference, actor, message) => ({
      collectionPath: 'accountingAudit', documentId: `audit-${revision}`, exists: false, data: { actor, message }
    }),
    batchCommitDocuments: async (_env, writes) => {
      if (beforeCommit) await beforeCommit(db, writes);
      for (const write of writes) {
        const prior = db.get(`${write.collectionPath}/${write.documentId}`);
        if ((write.exists === false && prior) || (write.updateTime && prior?.__updateTime !== write.updateTime)) {
          throw new Error('Atomic precondition failed — refresh preview');
        }
      }
      revision++;
      for (const write of writes) {
        const key = `${write.collectionPath}/${write.documentId}`, prior = db.get(key);
        db.set(key, { ...(write.updateMask ? prior : {}), ...copy(write.data), __id: write.documentId, __updateTime: `v${revision}` });
      }
      commits.push(copy(writes));
    },
    getStudentBillingPreview: async () => buildStudentBillingPreview(profile, read())
  });
  return { profile, originals, db, calls, commits, read,
    plan: () => studentBillingReconciliationPlan(profile, read()),
    apply: (token) => apply({}, profile, token, { role: 'Super Admin', username: 'tester', displayName: 'Test approver' }) };
}

test('mixed intake bill posts the gross valid missing amount, preserving all prior invoices, receipts and allocations', async () => {
  const h = harness(), plan = await h.plan();
  assert.equal(plan.difference, 480035);
  assert.equal(plan.postingTotal, 608065);
  const result = await h.apply(plan.previewToken);
  assert.equal(result.created, 4); assert.equal(result.added, 608065);
  assert.equal(result.creditAllocationDeferred, true); assert.equal(result.requiresReview, true);
  assert.equal(h.calls.preflight, 0); assert.equal(h.calls.allocate, 0); assert.equal(h.calls.refresh, 1);
  const current = h.read();
  for (const collection of ['invoices', 'payments', 'ledger', 'feeItems']) for (const row of h.originals[collection]) {
    const actual = current[collection].find((item) => item.__id === row.__id);
    assert.deepEqual({ ...actual, __updateTime: row.__updateTime }, row, `${collection} content preserved`);
  }
  assert.equal(current.invoices.filter((row) => row.FeeCode === 'TAB').length, 1);
  assert.equal(result.after.billingReview.conflictCount, 2);
  assert.equal(result.after.billingReview.missingCount, 0);
  assert.equal(parentCreditReview(result.after).status, 'needs_review');
  assert.equal(current.accountSummaries[0].TotalCredit, 1502885);
  const audit = h.commits[0].find((row) => row.collectionPath === 'accountingAudit').data;
  assert.match(audit.message, /608065/); assert.equal(audit.RemainingConflicts.length, 2);
  assert.equal(audit.CreatedInvoiceIds.length, 4);
  assert.equal(h.commits[0].filter((row) => row.collectionPath === 'accountingJournals').length, 4);
});

test('replaying a saved request or reviewing again cannot duplicate its charges', async () => {
  const h = harness(), plan = await h.plan();
  await h.apply(plan.previewToken);
  await assert.rejects(h.apply(plan.previewToken), /changed since preview/);
  const after = await h.plan();
  assert.equal(after.ready, false); assert.equal(after.postingTotal, 0); assert.equal(after.requiresReview, true);
  await assert.rejects(h.apply(after.previewToken), /No valid missing charges/);
  assert.equal(h.commits.length, 1); assert.equal(h.read().invoices.length, 7);
});

test('concurrent submissions share deterministic invoice IDs and only one atomic commit succeeds', async () => {
  let release, reached = 0;
  const barrier = new Promise((resolve) => { release = resolve; });
  const h = harness({ beforeCommit: async () => { if (++reached === 2) release(); await barrier; } });
  const plan = await h.plan();
  const results = await Promise.allSettled([h.apply(plan.previewToken), h.apply(plan.previewToken)]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(h.commits.length, 1); assert.equal(h.read().invoices.length, 7);
});

test('changed fees, missing revisions, closed periods and concurrent invoice edits prevent partial posting', async () => {
  const changed = harness(), plan = await changed.plan();
  changed.db.get('feeItems/feeItems-4').Amount += 1;
  await assert.rejects(changed.apply(plan.previewToken), /changed since preview/);
  const closed = harness({ closed: true });
  await assert.rejects(closed.apply((await closed.plan()).previewToken), /closed accounting period/);
  const stale = harness({ beforeCommit: (db) => { db.get('invoices/invoice-1').__updateTime = 'concurrent-edit'; } });
  await assert.rejects(stale.apply((await stale.plan()).previewToken), /Atomic precondition/);
  const unversioned = harness();
  delete unversioned.db.get('invoices/invoice-1').__updateTime;
  await assert.rejects(unversioned.apply((await unversioned.plan()).previewToken), /lacks its database revision/);
  for (const h of [changed, closed, stale, unversioned]) { assert.equal(h.commits.length, 0); assert.equal(h.read().invoices.length, 3); }
});

test('cancelled and ambiguous missing components stay blocked while an independent tablet charge can post', async () => {
  const h = harness({ configure: (data) => {
    data.invoices.push({ ...data.invoices[0], __id: 'cancelled-bow', InvoiceId: 'CANCELLED-BOW', FeeCode: 'BOW', Status: 'Cancelled' });
    data.feeItems.push({ ...data.feeItems[5], __id: 'ambiguous-textbooks' });
  } });
  const plan = await h.plan();
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.eligibleMissing.map((row) => row.code).sort(), ['TAB', 'UNI']);
  assert.deepEqual(plan.blockedMissing.map((row) => row.code).sort(), ['BOW', 'TXT_NEW']);
  assert.equal(plan.postingTotal, 428000);
  await h.apply(plan.previewToken);
  assert.equal(h.read().invoices.filter((row) => row.FeeCode === 'BOW').length, 1);
  assert.equal(h.read().invoices.filter((row) => row.FeeCode === 'TXT_NEW').length, 0);
});

test('profile edits after review and immediately before commit still block posting without any financial writes', async () => {
  const changed = harness(), plan = await changed.plan();
  changed.profile.__updateTime = 'edited-after-review';
  changed.profile.ClassName = 'Grade 9';
  await assert.rejects(changed.apply(plan.previewToken), /changed since preview/);
  const concurrent = harness({ beforeCommit: (db) => {
    db.get(`${student.__scopePath}/student`).__updateTime = 'concurrent-profile-edit';
  } });
  await assert.rejects(concurrent.apply((await concurrent.plan()).previewToken), /Atomic precondition/);
  for (const h of [changed, concurrent]) {
    assert.equal(h.commits.length, 0);
    assert.equal(h.read().invoices.length, 3);
    assert.deepEqual(h.read().payments, h.originals.payments);
    assert.deepEqual(h.read().ledger, h.originals.ledger);
  }
});

test('summary refresh failure reports committed charges and does not permit a duplicate retry', async () => {
  const h = harness({ refreshFails: true }), plan = await h.plan();
  const result = await h.apply(plan.previewToken);
  assert.match(result.creditWarning, /Charges posted.*Summary changed concurrently/);
  assert.equal(result.created, 4);
  await assert.rejects(h.apply(plan.previewToken), /changed since preview/);
  assert.equal(h.commits.length, 1);
});

test('legacy cancelled invoices with an unknown period cannot be silently rebilled; a different term remains separate', async () => {
  for (const [period, blocked] of [[{}, true], [{ AcademicSession: '2026/2027', Term: 'Second Term' }, false]]) {
    const data = billingFixture();
    data.invoices.push({ InvoiceId: 'LEGACY-TAB', AccountRef: student.AccountRef, FeeCode: 'TAB',
      FeeCategory: 'School Fee', Amount: 250000, Status: 'Cancelled', ...period });
    const plan = await studentBillingReconciliationPlan(student, data);
    assert.equal(plan.blockedMissing.some((row) => row.code === 'TAB'), blocked);
    assert.equal(plan.eligibleMissing.some((row) => row.code === 'TAB'), !blocked);
  }
});

test('an existing zero-value or duplicate tablet invoice is preserved, never treated as an absent tablet charge', async () => {
  for (const amounts of [[0], [100000, 150000]]) {
    const data = billingFixture();
    for (const [index, value] of amounts.entries()) data.invoices.push({ ...data.invoices[0],
      InvoiceId: `TAB-${index}`, FeeCode: 'TAB', Debit: value, Amount: value, Credit: 0, Status: 'Unpaid' });
    const plan = await studentBillingReconciliationPlan(student, data);
    assert.equal(plan.ready, true);
    assert.equal(plan.eligibleMissing.some((row) => row.code === 'TAB'), false);
    assert.equal(plan.conflicts.some((row) => row.code === 'TAB'), true);
  }
});

test('clean bills retain the existing credit preflight and allocation workflow', async () => {
  const h = harness({ configure: (data) => { data.invoices = data.invoices.slice(0, 1); } });
  const result = await h.apply((await h.plan()).previewToken);
  assert.equal(result.requiresReview, false);
  assert.equal(h.calls.preflight, 1); assert.equal(h.calls.allocate, 1); assert.equal(h.calls.refresh, 0);
});

test('a partially postable account counts as both eligible and needing review, using the gross posting total', async () => {
  const h = harness(), plan = await h.plan();
  const report = await reviewAllStudentBilling(async (_url, body) => body.action === 'previewAll'
    ? { total: 1, incomplete: 0, matched: 0, rows: [], pendingProfiles: [{ AccountRef: student.AccountRef, revision: 'v1' }] }
    : { checked: 1, matched: 0, rows: [plan] });
  assert.equal(report.ready, 1); assert.equal(report.review, 1); assert.equal(report.readyWithReview, 1);
  assert.equal(report.blockedMissingAccounts, 0);
  const html = await renderBillingReport(report);
  assert.match(html, /other components still need review/);
  assert.match(html, /Post valid missing charges for 1 reviewed accounts \(₦608,065.00\)/);
  assert.doesNotMatch(html, /Conflicting accounts stay blocked/);
});

test('cached posting clients must refresh and acknowledge the new missing-only mode', async () => {
  const route = await readFile(new URL('../functions/api/student-billing-reconciliation.js', import.meta.url), 'utf8');
  assert.match(route, /body.action === 'apply' && body.PostingMode !== 'missing-only-v2'/);
  assert.match(route, /Refresh Students and review the valid missing-charge total/);
});

test('preview tokens tolerate read ordering and shared-fee guard revisions, but not changed due dates', async () => {
  const data = billingFixture(), first = await studentBillingReconciliationPlan(student, data);
  data.feeItems.reverse(); data.invoices.reverse();
  for (const fee of data.feeItems) fee.__updateTime = 'advanced-by-another-student';
  assert.equal((await studentBillingReconciliationPlan(student, data)).previewToken, first.previewToken);
  data.feeItems.find((fee) => fee.FeeCode === 'TAB').DueDate = '2026-12-01';
  assert.notEqual((await studentBillingReconciliationPlan(student, data)).previewToken, first.previewToken);
});
