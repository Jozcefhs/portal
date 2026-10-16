import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildStudentBillingPreview, studentBillingReconciliationPlan } from '../functions/api/backend.js';
import { billingComponentDiagnostics, parentCreditReview } from '../functions/lib/student-billing-diagnostics.js';
import { reviewParentFeeCredit, queryParentFinancialRows } from '../functions/lib/parent-fee-credit-review.js';
import { accountSummaryForKeys } from '../functions/api/parent-dashboard.js';
import { reviewAllStudentBilling } from '../js/student-maintenance.js';
import { student, billingFixture, renderBillingReport, renderParentCredit } from './helpers/billing-credit-review.mjs';
import { assertServiceWorkerCacheVersion } from './helpers/service-worker-cache-version.mjs';

test('intake review exposes missing fees and obsolete charges together without calling them duplicate payments', async () => {
  const data = billingFixture(), before = JSON.stringify(data);
  const plan = await studentBillingReconciliationPlan(student, data);
  assert.equal(plan.ready, true);
  assert.equal(plan.missing.length, 4);
  assert.equal(plan.conflicts.length, 2);
  assert.equal(plan.billingReview.missingTotal, 608065);
  assert.equal(plan.expectedTotal, 1488885);
  assert.equal(plan.invoicedTotal, 1008850);
  assert.equal(plan.difference, 480035);
  assert.equal(plan.postingTotal, 608065);
  assert.equal(plan.requiresReview, true);
  assert.match(plan.reviewWarning, /TXT_OLD: Posted charge does not apply/);
  assert.match(plan.reviewWarning, /LEG: Posted charge does not apply/);
  assert.doesNotMatch(plan.reviewWarning, /duplicat/i);
  assert.equal(plan.recordedCredit, 494035);
  assert.equal(plan.recordedCreditSource, 'saved_summary');
  assert.equal(JSON.stringify(data), before, 'no fee, invoice, payment or summary mutation');
});

test('zero net difference cannot hide offsetting missing and obsolete components', async () => {
  const data = billingFixture();
  data.feeItems = [{ ...data.feeItems[0], FeeCode: 'REPLACEMENT', Amount: 1008850 }];
  const plan = await studentBillingReconciliationPlan(student, data);
  assert.equal(plan.difference, 0);
  assert.equal(plan.ready, true);
  assert.equal(plan.postingTotal, 1008850);
  assert.equal(plan.billingReview.status, 'needs_review');
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.conflicts.length, 3);
});

test('multiple invoices, altered amounts and zero-value existing invoices have precise blocking findings', () => {
  for (const row of [
    { expected: 100, invoiced: 100, difference: 0, invoiceIds: ['A', 'B'] },
    { expected: 100, invoiced: 50, difference: 50, invoiceIds: ['A'] },
    { expected: 100, invoiced: 0, difference: 100, invoiceIds: ['A'] }
  ]) assert.equal(billingComponentDiagnostics(row).conflict, true);
  assert.match(billingComponentDiagnostics({ expected: 100, invoiced: 100, difference: 0, invoiceIds: ['A', 'B'] }).review,
    /2 invoices use this component/);
});

test('school-wide counts distinguish missing from ready-to-post, including blocked accounts with missing fees', async () => {
  const blocked = await studentBillingReconciliationPlan({ ...student, ProfileCompletionStatus: '' }, billingFixture());
  const data = billingFixture();
  data.invoices = data.invoices.slice(0, 1);
  const ready = await studentBillingReconciliationPlan({ ...student, DisplayName: '<unsafe>' }, data);
  ready.profile.AccountRef = 'TEST/26/002';
  const report = await reviewAllStudentBilling(async (_url, body) => {
    assert.match(body.action, /^preview/);
    return body.action === 'previewAll'
      ? { total: 2, incomplete: 0, matched: 0, rows: [], pendingProfiles: [student.AccountRef, ready.profile.AccountRef].map(AccountRef => ({ AccountRef, revision: 'v1' })) }
      : { checked: 2, matched: 0, rows: [blocked, ready] };
  });
  assert.equal(report.missingAccounts, 2);
  assert.equal(report.blockedMissingAccounts, 1);
  assert.equal(report.ready, 1);
  assert.equal(report.review, 1);
  const html = await renderBillingReport(report);
  assert.match(html, /2 accounts have missing components: 1 eligible/);
  assert.match(html, /1 blocked pending finance review/);
  assert.match(html, /View 4 missing \/ 2 conflicting components/);
  assert.match(html, /494,035.00 — unverified/);
  assert.match(html, /Invoice\(s\): INV-1/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /Post valid missing charges for 1 reviewed accounts/);
});

test('blocked-only report has no posting button and no misleading zero-missing claim', async () => {
  const plan = await studentBillingReconciliationPlan({ ...student, ProfileCompletionStatus: '' }, billingFixture());
  const html = await renderBillingReport({ total: 1, matched: 0, incomplete: 0, missingAccounts: 1,
    ready: 0, blockedMissingAccounts: 1, review: 1, rows: [plan] });
  assert.match(html, /1 accounts have missing components: 0 eligible/);
  assert.doesNotMatch(html, /data-apply-billing-plans/);
});

test('credit is flagged provisional, never zeroed or mixed with wallet/club receipts', async () => {
  const data = billingFixture();
  data.ledger.push({ AccountRef: student.AccountRef, FeeCategory: 'Wallet', Credit: 93600 },
    { AccountRef: student.AccountRef, FeeCategory: 'Club', Credit: 90000 });
  const summary = accountSummaryForKeys([], [student.AccountRef], data.ledger, data.invoices);
  assert.equal(summary.TotalCredit, 1502885);
  assert.equal(summary.CreditBalance, 494035);
  const before = JSON.stringify({ data, summary, student });
  const review = await reviewParentFeeCredit({}, student, summary, data, {
    loadBranchFinanceRows: async (_env, collection, branch, options) => {
      assert.equal(collection, 'feeItems'); assert.equal(branch, 'main'); assert.equal(options.report, true);
      return data.feeItems;
    }
  });
  assert.equal(review.status, 'needs_review');
  assert.equal(review.missingCount, 4);
  assert.equal(review.conflictCount, 2);
  assert.match(review.message, /not confirmed excess money/);
  assert.equal(JSON.stringify({ data, summary, student }), before);
  assert.doesNotMatch(JSON.stringify(review), /INV-|TEST\/26/);
  const html = await renderParentCredit({ ...summary, BillingReview: review });
  assert.match(html, /494,035.00/);
  assert.match(html, /Provisional Fee Credit — Review Needed/);
  assert.match(html, /credit-review-needed/);
  assert.doesNotMatch(html, /class="credit-good"|This excess credit remains available/);
});

test('unknown, failed or incomplete checks do not imply verified credit; zero credit avoids extra catalogue reads', async () => {
  const data = billingFixture();
  const noRead = { loadBranchFinanceRows: async () => { throw new Error('Cannot read fee catalogue'); } };
  assert.equal(await reviewParentFeeCredit({}, student, { CreditBalance: 0 }, data, noRead), null);
  assert.equal((await reviewParentFeeCredit({}, student, { CreditBalance: 10 }, data, noRead)).status, 'unverified');
  for (const changes of [{ ProfileCompletionStatus: '' }, { AcademicSession: '', Term: '' }]) {
    const review = await reviewParentFeeCredit({}, { ...student, ...changes }, { CreditBalance: 10 }, data, {
      loadBranchFinanceRows: async () => { assert.fail('Incomplete profiles must not be verified against inferred periods'); }
    });
    assert.equal(review.status, 'unverified');
  }
  assert.match(await renderParentCredit({ CreditBalance: 10 }), /Provisional Fee Credit/);
  assert.doesNotMatch(await renderParentCredit({ CreditBalance: 0 }), /Provisional Fee Credit|credit-review-needed/);
  assert.equal(parentCreditReview({ profile: student, rows: [{}], billingReview: { status: 'unknown' } }).status, 'unverified');
});

test('matched bills preserve a genuine remaining credit but do not promise an approved refund', async () => {
  const data = billingFixture();
  data.feeItems = data.feeItems.filter((row) => row.EnrollmentCategory !== 'Returning');
  data.invoices = data.feeItems.map((row, index) => ({ ...row, InvoiceId: `NEW-${index}`, AccountRef: student.AccountRef, Debit: row.Amount }));
  const summary = accountSummaryForKeys([], [student.AccountRef], data.ledger, data.invoices);
  assert.equal(summary.CreditBalance, 14000);
  const review = parentCreditReview(await buildStudentBillingPreview(student, data));
  assert.equal(review.status, 'matched');
  const html = await renderParentCredit({ ...summary, BillingReview: review });
  assert.match(html, /14,000.00/);
  assert.match(html, /Recorded Fee Credit/);
  assert.match(html, /Accounts Office must confirm/);
  assert.doesNotMatch(html, /Provisional Fee Credit/);
});

test('another branch fee catalogue cannot turn a matching bill into a conflict', async () => {
  const data = billingFixture();
  data.feeItems = [data.feeItems[0]];
  data.invoices = [data.invoices[0]];
  const review = await reviewParentFeeCredit({}, student, { CreditBalance: 500 }, data, {
    loadBranchFinanceRows: async () => [...data.feeItems, { ...data.feeItems[0], BranchId: 'annex', Amount: 999999 }]
  });
  assert.equal(review.status, 'matched');
});

test('parent financial history reads every page using bounded identity queries and deduplicates aliases', async () => {
  const entries = Array.from({ length: 350 }, (_, index) => ({ __id: `row-${index}`, AccountRef: student.AccountRef }));
  let calls = 0;
  const rows = await queryParentFinancialRows({}, 'invoices', [student.AccountRef], { queryCollectionPages: async (_env, collection, options) => {
    calls++;
    assert.equal(collection, 'invoices');
    assert.deepEqual(options.filters[0].value, [student.AccountRef]);
    assert.equal(options.pageSize, 250); assert.equal(options.maxRows, 2000);
    return entries;
  } });
  assert.equal(calls, 6);
  assert.equal(rows.length, 350);
  await assert.rejects(queryParentFinancialRows({}, 'ledger', [student.AccountRef], {
    queryCollectionPages: async () => { throw new Error('Incomplete history'); }
  }), /Incomplete history/);
  await assert.rejects(queryParentFinancialRows({}, 'payments', Array.from({ length: 31 }, (_, index) => String(index))), /could not be verified/);
});

test('selected-child route reviews only scoped rows and cache updates reach web/PWA clients', async () => {
  const source = await readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8');
  assert.match(source, /queryParentFinancialRows\(env, 'invoices', keys\)/);
  assert.match(source, /reviewParentFeeCredit\(env, child, accountSummary, \{\s*schoolProfile, invoices: scopedInvoiceRows, ledger: scopedLedgerRows,\s*payments: scopedPaymentRows, accountSummaries: scopedSummaryRows/);
  assertServiceWorkerCacheVersion(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), 404);
  for (const file of ['admin.html', 'parent-dashboard.html']) {
    assert.match(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /billing-credit-review/);
  }
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /#accountCreditSummary \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.match(css, /#studentBillingPreviewDialog \.admin-table :is\(th,td\) \{ white-space: normal/);
});
