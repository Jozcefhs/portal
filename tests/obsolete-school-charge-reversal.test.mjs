import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { billingPreviewStudent } from '../functions/api/student-billing-preview.js';
import { obsoleteSchoolChargeReversalPlan, reverseObsoleteSchoolCharges, getObsoleteSchoolChargeReversalData } from '../functions/lib/obsolete-school-charge-reversal.js';
import { normalizeInvoice, buildSchoolInvoiceChargeAccountingJournal, buildSchoolInvoiceCreditAccountingJournal,
  buildPaymentAccountingJournal, calculateAccountFinancialSummary, safeDocumentId, schoolInvoiceCreditJournalGap,
  calculateDueSchoolFeeCreditAllocations } from '../functions/api/backend.js';
import { effectiveInvoiceAfterReversal } from '../functions/lib/invoice-charge-reversal.js';
import { accountSummaryForKeys } from '../functions/api/parent-dashboard.js';
import { student, billingFixture } from './helpers/billing-credit-review.mjs';
import { reviewObsoleteChargeAccounts, prepareObsoleteCharges, postObsoleteCharges, obsoleteChargeTable } from '../js/obsolete-charge-review.js';

const actor = { role: 'Super Admin', username: 'approver', edition: 'school', branchId: 'main',
  schoolSectionAccess: 'All', allowedSections: ['accounts', 'students'] };
const copy = value => structuredClone(value);
const withoutRevision = ({ __updateTime, ...row }) => row;
function fixture(credit = 128030) {
  const data = billingFixture();
  data.invoices.push(...data.feeItems.slice(3).map((fee, i) => ({ ...fee, InvoiceId: `NEW-${i}`,
    AccountRef: student.AccountRef, Debit: fee.Amount, Credit: 0, Status: 'Unpaid' })));
  data.invoices[1].Credit = Math.min(credit, 118030); data.invoices[2].Credit = Math.max(0, credit - 118030);
  for (const [collection, rows] of Object.entries(data)) if (Array.isArray(rows)) rows.forEach((row, index) => Object.assign(row, {
    __id: row.__id || `${collection}-${index}`, __updateTime: 'v1', Date: '2026-10-01', CreatedAt: '2026-10-01', BranchId: 'main', SchoolSection: 'secondary'
  }));
  Object.assign(data.payments[0], { Method: 'Cash', AcademicSession: student.AcademicSession, Term: student.Term });
  data.journals = data.invoices.flatMap(invoice => [buildSchoolInvoiceChargeAccountingJournal(invoice),
    ...(invoice.Credit ? [buildSchoolInvoiceCreditAccountingJournal(invoice)] : [])]);
  data.journals.push(buildPaymentAccountingJournal(data.payments[0]));
  data.journals = data.journals.map((row, i) => ({ ...row, __id: safeDocumentId(row.JournalNo), __updateTime: `j${i}` }));
  data.accountSummaries = [];
  return data;
}
function harness({ configure = () => {}, beforeCommit, closed = () => false, lostResponse = false } = {}) {
  const profile = { ...student, __id: 'student', __updateTime: 'v1' };
  const data = fixture(); configure(data, profile);
  const db = new Map(), commits = [];
  db.set(`${profile.__scopePath}/${profile.__id}`, copy(profile));
  for (const [key, rows] of Object.entries(data)) if (Array.isArray(rows)) for (const row of rows) db.set(`${key === 'journals' ? 'accountingJournals' : key}/${row.__id}`, copy(row));
  const read = () => ({ schoolProfile: {}, ...Object.fromEntries(['feeItems', 'invoices', 'ledger', 'payments', 'accountSummaries', 'journals'].map(key =>
    [key, [...db.entries()].filter(([path]) => path.startsWith(`${key === 'journals' ? 'accountingJournals' : key}/`)).map(([, row]) => copy(row))])) });
  const deps = {
    getStudentBillingData: async (_env, _student, options) => { assert.equal(options.section, 'secondary'); return read(); },
    queryCollectionPages: async (_env, collection, options) => read().journals.filter(row => row.SourceId === options.filters[0].value),
    getDocument: async (_env, path, id) => copy(db.get(`${path}/${id}`) || null),
    accountingPeriodIsClosed: async (_env, date) => closed(date),
    batchCommitDocuments: async (_env, writes, options) => {
      assert.equal(options?.literalDocumentIds, true, 'preserve literal legacy source IDs');
      if (beforeCommit) await beforeCommit(db, writes);
      assert.equal(new Set(writes.map(row => `${row.collectionPath}/${row.documentId}`)).size, writes.length, 'no duplicate document writes');
      for (const write of writes) {
        const old = db.get(`${write.collectionPath}/${write.documentId}`);
        if ((write.exists === false && old) || (write.updateTime && old?.__updateTime !== write.updateTime)) throw new Error('Atomic revision conflict');
      }
      for (const write of writes) {
        const path = `${write.collectionPath}/${write.documentId}`, old = db.get(path);
        db.set(path, { ...(write.updateMask ? old : {}), ...copy(write.data), __id: write.documentId, __updateTime: `after-${commits.length + 1}` });
      }
      commits.push(copy(writes));
      if (lostResponse) throw new Error('Response lost after commit');
    }
  };
  return { profile, data, db, read, commits, deps,
    plan: async () => obsoleteSchoolChargeReversalPlan(profile, await getObsoleteSchoolChargeReversalData({}, profile, deps)),
    post: (token, who = actor, reason = 'Returning-only fees were posted before intake classification was corrected.') => reverseObsoleteSchoolCharges({}, profile, token, who, reason, deps) };
}

test('the reported Grade 8 bill previews exactly 128030 obsolete charges; boys and girls retain correct fees', async () => {
  for (const gender of ['Male', 'Female']) {
    const data = fixture();
    if (gender === 'Female') { data.feeItems.find(row => row.FeeCode === 'UNI').Amount += 14000; data.invoices.find(row => row.FeeCode === 'UNI').Amount += 14000; }
    const before = JSON.stringify(data), plan = await obsoleteSchoolChargeReversalPlan({ ...student, Gender: gender }, data);
    assert.equal(plan.ready, true, plan.reason); assert.equal(plan.amount, 128030);
    assert.equal(plan.postedTotal, gender === 'Male' ? 1616915 : 1630915);
    assert.equal(plan.afterPostedTotal, gender === 'Male' ? 1488885 : 1502885);
    assert.equal(plan.afterPostedTotal, plan.expectedTotal);
    assert.deepEqual(plan.charges.map(row => row.code), ['TXT_OLD', 'LEG']); assert.equal(JSON.stringify(data), before);
  }
});

test('unpaid, partly allocated and paid invoices release only existing allocations', async () => {
  for (const credit of [0, 35000, 128030]) {
    const plan = await obsoleteSchoolChargeReversalPlan(student, fixture(credit));
    assert.equal(plan.ready, true, plan.reason); assert.equal(plan.releasedCredit, credit); assert.equal(plan.outstandingRemoved, 128030 - credit);
  }
});

test('all classes and sections are eligible by saved fee rules; unrelated profile completion is not required', async () => {
  for (const [name, section, admission] of [['Grade 5', 'primary', 'TEST/26/002'], ['Grade 8', 'secondary', 'TEST/26/001'], ['Grade 11', 'secondary', 'TEST/26/003']]) {
    const profile = { ...student, ClassName: name, SchoolSection: section, AdmissionNo: admission, AccountRef: admission,
      __scopePath: `schoolBranches/main/sections/${section}/students`, ProfileCompletionStatus: 'Needs completion' };
    const data = fixture();
    for (const rows of [data.invoices, data.payments, data.ledger]) rows.forEach(row => { row.AccountRef = admission; row.SchoolSection = section; });
    const plan = await obsoleteSchoolChargeReversalPlan(profile, data, { candidateOnly: true });
    assert.equal(plan.ready, true, plan.reason); assert.equal(plan.previewToken, ''); assert.equal(plan.amount, 128030);
  }
});

test('legitimate charges, unrelated fees and old periods are never reversed', async () => {
  const data = fixture();
  data.feeItems.find(row => row.FeeCode === 'LEG').EnrollmentCategory = 'All';
  data.invoices.push({ ...data.invoices[1], InvoiceId: 'OLD-TERM', Term: 'Second Term' },
    { ...data.invoices[1], InvoiceId: 'OTHER-FEE', FeeCode: 'OTHER', FeeName: 'Unrelated charge' });
  const plan = await obsoleteSchoolChargeReversalPlan(student, data);
  assert.equal(plan.ready, true, plan.reason); assert.equal(plan.charges.length, 1); assert.equal(plan.charges[0].code, 'TXT_OLD');
  const returning = await obsoleteSchoolChargeReversalPlan({ ...student, AccountRef: 'TEST/25/001', AdmissionNo: 'TEST/25/001', EnrollmentCategory: 'Returning' }, fixture());
  assert.equal(returning.ready, false);
});

test('duplicates, unknown rules, mismatched currency/amount/scope/classifications and receipt gaps block approval', async () => {
  for (const change of [
    d => d.invoices.push({ ...d.invoices[1], __id: 'duplicate', InvoiceId: 'DUP' }),
    d => { d.feeItems = d.feeItems.filter(row => row.FeeCode !== 'TXT_OLD'); },
    d => { d.invoices[1].Currency = 'USD'; }, d => { d.invoices[1].Amount += 1; },
    d => { d.invoices[1].SchoolSection = 'primary'; }, d => { d.invoices[1].BranchId = 'other'; },
    d => { d.ledger = []; }, d => { d.payments = []; }, d => { d.invoices[1].Credit = 999999; },
    d => { d.invoices[1].Credit = 'invalid'; }, d => { d.payments[0].Amount = '1502885x'; },
    d => { d.journals.find(row => row.SourceId === 'INV-1').Lines[0].Debit = 1; }
  ]) { const data = fixture(); change(data); assert.equal((await obsoleteSchoolChargeReversalPlan(student, data)).ready, false, String(change)); }
  assert.equal((await obsoleteSchoolChargeReversalPlan({ ...student, ClassName: '' }, fixture())).ready, false);
});

test('atomic correction preserves gross invoices, payments, receipt journals and wallet; both portal totals agree', async () => {
  const h = harness(), before = h.read(), plan = await h.plan(), result = await h.post(plan.previewToken);
  assert.equal(result.reversed, 2); assert.equal(result.summary.TotalDebit, 1488885); assert.equal(result.summary.CreditBalance, 14000);
  const after = h.read();
  for (const key of ['payments', 'ledger', 'feeItems']) assert.deepEqual(after[key].map(withoutRevision), before[key].map(withoutRevision));
  for (const row of before.invoices) {
    const actual = after.invoices.find(item => item.__id === row.__id);
    for (const key of ['Amount', 'Debit', 'Credit', 'Status', 'Balance']) assert.equal(actual[key], row[key]);
  }
  for (const row of before.journals) assert.deepEqual(withoutRevision(after.journals.find(item => item.__id === row.__id)), withoutRevision(row));
  const journals = h.commits[0].filter(row => row.collectionPath === 'accountingJournals' && row.exists === false);
  assert.equal(journals.length, 4);
  for (const { data } of journals) { assert.equal(data.Lines.reduce((n, row) => n + row.Debit, 0), data.TotalDebit); assert.equal(data.TotalDebit, data.TotalCredit); }
  for (const invoice of after.invoices.filter(row => row.FeeChargeReversed === 'YES')) assert.equal(schoolInvoiceCreditJournalGap(invoice, after.journals).missing, 0);
  assert.equal(h.commits[0].filter(row => row.collectionPath === 'accountingAdjustments').length, 2);
  assert.equal(h.commits[0].filter(row => row.collectionPath === 'accountingAudit').length, 2);
  const parent = accountSummaryForKeys(after.accountSummaries, [student.AccountRef], after.ledger, after.invoices.map(effectiveInvoiceAfterReversal));
  assert.equal(parent.TotalDebit, 1488885); assert.equal(parent.TotalCredit, 1502885); assert.equal(parent.CreditBalance, 14000);
  assert.ok(calculateDueSchoolFeeCreditAllocations(after.invoices, after.ledger).allocations.every(row => !['INV-1', 'INV-2'].includes(row.InvoiceId)));
});

test('repeat approval, fresh review and lost-response retry never duplicate reversals or credits', async () => {
  for (const lostResponse of [false, true]) {
    const h = harness({ lostResponse }), plan = await h.plan();
    if (lostResponse) await assert.rejects(h.post(plan.previewToken), /lost/); else await h.post(plan.previewToken);
    await assert.rejects(h.post(plan.previewToken), /No eligible/); assert.equal((await h.plan()).ready, false);
    assert.equal(h.commits.length, 1); assert.equal(h.read().invoices.filter(row => row.FeeChargeReversed === 'YES').length, 2);
  }
});

test('wallet and earmarked club funds never become school credit and their original records stay intact', async () => {
  const h = harness({ configure: d => {
    for (const [id, category, code, amount] of [['wallet', 'Wallet', 'WALLET', 93600], ['club', 'Club', 'CLUB_CHESS', 90000]]) {
      const row = { AccountRef: student.AccountRef, FeeCategory: category, FeeCode: code, BranchId: 'main', SchoolSection: 'secondary', Date: '2026-10-01', __updateTime: 'v1' };
      d.ledger.push({ ...row, __id: `ledger-${id}`, Credit: amount, Debit: 0 });
      d.payments.push({ ...row, __id: `payment-${id}`, PaymentId: `PAY-${id}`, Amount: amount, Status: 'Paid', Method: 'Cash' });
    }
  } });
  const before = h.read(), plan = await h.plan(); assert.equal(plan.ready, true, plan.reason);
  const result = await h.post(plan.previewToken), after = h.read();
  assert.equal(result.summary.CreditBalance, 14000); assert.equal(result.releasedCredit, 128030);
  for (const key of ['payments', 'ledger']) assert.deepEqual(after[key].map(withoutRevision), before[key].map(withoutRevision));
  const parent = accountSummaryForKeys(after.accountSummaries, [student.AccountRef], after.ledger, after.invoices.map(effectiveInvoiceAfterReversal));
  assert.equal(parent.TotalCredit, 1502885); assert.equal(parent.CreditBalance, 14000);
});

test('concurrent submissions can commit only once', async () => {
  let release, reached = 0; const barrier = new Promise(resolve => { release = resolve; });
  const h = harness({ beforeCommit: async () => { if (++reached === 2) release(); await barrier; } }), plan = await h.plan();
  const result = await Promise.allSettled([h.post(plan.previewToken), h.post(plan.previewToken)]);
  assert.equal(result.filter(row => row.status === 'fulfilled').length, 1); assert.equal(h.commits.length, 1);
});

test('changed profile, fee, invoice, receipt or ledger; missing revision; closed periods block without partial writes', async () => {
  for (const key of ['feeItems', 'invoices', 'ledger', 'payments', 'accountingJournals']) {
    const h = harness(), plan = await h.plan();
    const [, row] = [...h.db.entries()].find(([path, row]) => path.startsWith(`${key}/`) && (key !== 'accountingJournals' || row.SourceId === 'INV-1'));
    row.ExtraReviewChange = 'changed'; row.__updateTime = 'v2';
    await assert.rejects(h.post(plan.previewToken), /changed|differs/); assert.equal(h.commits.length, 0);
  }
  const stale = harness({ beforeCommit: db => { db.get('invoices/invoice-1').__updateTime = 'concurrent'; } });
  await assert.rejects(stale.post((await stale.plan()).previewToken), /revision/); assert.equal(stale.commits.length, 0);
  const noRev = harness({ configure: d => { delete d.invoices[1].__updateTime; } });
  await assert.rejects(noRev.post((await noRev.plan()).previewToken), /revision/); assert.equal(noRev.commits.length, 0);
  const closed = harness({ closed: () => true });
  await assert.rejects(closed.post((await closed.plan()).previewToken), /closed/); assert.equal(closed.commits.length, 0);
  const profile = harness(), plan = await profile.plan(); profile.profile.Gender = 'Female';
  await assert.rejects(profile.post(plan.previewToken), /changed/); assert.equal(profile.commits.length, 0);
});

test('shared fee guard revisions do not stale later accounts; actual fee edits do', async () => {
  const h = harness(), plan = await h.plan();
  for (const [path, row] of h.db) if (path.startsWith('feeItems/')) row.__updateTime = 'another-account-guard';
  assert.equal((await h.plan()).previewToken, plan.previewToken);
  await h.post(plan.previewToken); assert.equal(h.commits.length, 1);
});

test('legacy document IDs are preserved; missing historical dates and conflicting journals require review', async () => {
  const h = harness({ configure: (data, profile) => {
    profile.__id = 'student%2F26 legacy'; data.invoices[1].__id = 'invoice%2F legacy';
  } });
  await h.post((await h.plan()).previewToken);
  assert.equal(h.db.get('invoices/invoice%2F legacy').FeeChargeReversed, 'YES');
  assert.equal(h.db.has('invoices/invoice%252F%20legacy'), false);
  for (const change of [
    d => { delete d.invoices[1].Date; delete d.invoices[1].CreatedAt; },
    d => { delete d.payments[0].Date; },
    d => { d.payments[0].Currency = 'USD'; },
    d => { d.payments[0].Status = 'Failed'; },
    d => { d.journals.push({ ...d.journals[0], __id: 'duplicate-journal' }); },
    d => { d.journals[0].BranchId = 'other'; }
  ]) { const data = fixture(); change(data); assert.equal((await obsoleteSchoolChargeReversalPlan(student, data)).ready, false, String(change)); }
});

test('missing baseline journals are restored atomically only in open periods; summary races cannot partially reverse', async () => {
  const h = harness({ configure: d => { d.journals = []; } });
  const plan = await h.plan(); assert.equal(plan.ready, true, plan.reason); assert.equal(plan.baselineJournals.length, 5);
  await h.post(plan.previewToken); assert.equal(h.commits.length, 1);
  const closed = harness({ configure: d => { d.journals = []; }, closed: date => date.startsWith('2026-10-01') });
  await assert.rejects(closed.post((await closed.plan()).previewToken), /closed/); assert.equal(closed.commits.length, 0);
  const race = harness({ beforeCommit: db => {
    db.set(`accountSummaries/${safeDocumentId(student.AccountRef)}`, { AccountRef: student.AccountRef, __updateTime: 'new-payment' });
  } });
  await assert.rejects(race.post((await race.plan()).previewToken), /revision/); assert.equal(race.commits.length, 0);
  assert.ok(race.read().invoices.every(row => !row.FeeChargeReversed));
});

test('role, branch, section, edition, read-only subscription and reason authorization are checked before reads', async () => {
  for (const change of [{ role: 'Accounts Officer' }, { branchId: 'other' }, { schoolSectionAccess: 'Primary' },
    { edition: 'organization' }, { subscriptionReadOnly: true }, { subscriptionActive: false }, { allowedSections: ['students'] }]) {
    const h = harness(); await assert.rejects(h.post('token', { ...actor, ...change }), { status: 403 }); assert.equal(h.commits.length, 0);
  }
  const h = harness(); await assert.rejects(h.post('token', actor, ''), { status: 403 });
});

test('oversized financial histories are blocked at preview as well as approval', async () => {
  const h = harness({ configure: d => {
    d.ledger.push(...Array.from({ length: 450 }, (_, i) => ({ ...d.ledger[0], __id: `old-${i}`, Credit: 0 })));
  } });
  const plan = await h.plan(); assert.equal(plan.ready, false); assert.match(plan.reason, /Too many source/);
  await assert.rejects(h.post(plan.previewToken), /Too many source/); assert.equal(h.commits.length, 0);
});

test('school-wide UI batches every profile, prepares exact accounts and never silently retries posting', async () => {
  const profiles = Array.from({ length: 23 }, (_, i) => ({ AccountRef: `TEST/26/${i}`, revision: 'v1' })), requests = [];
  const report = await reviewObsoleteChargeAccounts(async body => {
    requests.push(body);
    if (body.action === 'obsoleteRoster') return { total: 23, rows: [], pendingProfiles: profiles, configurationToken: 'config' };
    return { checked: body.Profiles.length, matched: 0, rows: body.Profiles.map(row => ({ profile: row, candidateOnly: true, ready: true })) };
  });
  assert.equal(report.rows.length, 23); assert.equal(requests.length, 4);
  assert.ok(requests.slice(1).every(row => row.action === 'obsoleteBatch' && row.Profiles.length <= 10));
  const plan = await obsoleteSchoolChargeReversalPlan(student, fixture());
  const prepared = await prepareObsoleteCharges([plan], async body => { assert.equal(body.action, 'previewObsoleteReversal'); return plan; });
  let attempts = 0;
  const outcomes = await postObsoleteCharges(prepared, 'Correct obsolete intake charges', async body => {
    attempts++; assert.equal(body.action, 'applyObsoleteReversal'); throw new Error('Response lost');
  });
  assert.equal(attempts, 1); assert.match(outcomes[0].error, /lost/);
  await assert.rejects(postObsoleteCharges([plan, plan], 'Reason', () => {}), /Duplicate/);
  const html = obsoleteChargeTable([{ ...plan, profile: { ...plan.profile, DisplayName: '<script>' } }], true);
  assert.match(html, /&lt;script&gt;/); assert.match(html, /1,616,915.00 → ₦1,488,885.00/); assert.match(html, /128|118,030/);
  const ui = await readFile(new URL('../js/obsolete-charge-review.js', import.meta.url), 'utf8');
  assert.match(ui, /confirmText: 'Approve and post all'/); assert.match(ui, /finally \{ post.disabled = true/);
  const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const handler = admin.slice(admin.indexOf("panelEl.querySelector('[data-review-obsolete-charges]')"), admin.indexOf('const reviewBoardingWearReversal ='));
  assert.match(handler, /reviewClosed = true; abort\(\)/); assert.match(handler, /const isCurrent = \(\) => !reviewClosed/);
  assert.match(handler, /60000/); assert.match(handler, /sessionSignal\.removeEventListener/);
});

test('new correction endpoints retain scoped authority, no-store responses, candidate-only batches and fresh individual approvals', async () => {
  const source = await readFile(new URL('../functions/api/student-billing-reconciliation.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('const clean')).replace('export async function', 'async function');
  for (const action of ['obsoleteRoster', 'obsoleteBatch', 'previewObsoleteReversal', 'applyObsoleteReversal']) {
    for (const who of [actor, { ...actor, role: 'Class Teacher' }, { ...actor, schoolSectionAccess: 'primary' },
      { ...actor, branchId: 'annex' }, { ...actor, edition: 'church' }, { ...actor, subscriptionReadOnly: true }]) {
      const calls = [], h = harness(), plan = await h.plan();
      const handler = vm.runInNewContext(`${body}; onRequestPost`, {
        Response, requireFirestoreEnv: () => {}, requireStaffSession: async () => who,
        readJsonBody: async () => ({ action, AccountRef: student.AccountRef, PreviewToken: plan.previewToken, Reason: 'Reviewed obsolete intake charges' }),
        studentBillingReviewRoster: async (_env, user, opts) => {
          calls.push('roster'); assert.equal(user, who); assert.equal(opts.includeIncompleteProfiles, true); return { ok: true };
        },
        studentBillingReviewBatch: async (_env, user, _body, opts) => {
          calls.push('batch'); assert.equal(user, who); assert.equal(opts.includeIncompleteProfiles, true);
          const candidate = await opts.studentBillingReconciliationPlan(h.profile, h.read());
          assert.equal(candidate.candidateOnly, true); assert.equal(candidate.previewToken, ''); return { ok: true };
        },
        querySchoolCollection: async (_env, _collection, options) => {
          assert.equal(options.scope.branchId, who.branchId); assert.equal(options.scope.schoolSectionAccess, who.schoolSectionAccess);
          return [h.profile];
        }, billingPreviewStudent,
        obsoleteSchoolChargeReversalPlan,
        getObsoleteSchoolChargeReversalData: async () => { calls.push('preview'); return h.read(); },
        reverseObsoleteSchoolCharges: async (_env, profile, token, user, reason) => {
          calls.push('post'); assert.equal(profile.AdmissionNo, student.AdmissionNo);
          return h.post(token, user, reason);
        }
      });
      const response = await handler({ env: {}, request: {} });
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const forbidden = who.role !== 'Super Admin' || who.edition !== 'school' || (action === 'applyObsoleteReversal' && who.subscriptionReadOnly);
      const wrongScope = action.includes('ObsoleteReversal') && (who.branchId === 'annex' || who.schoolSectionAccess === 'primary');
      assert.equal(response.status, forbidden ? 403 : wrongScope ? 404 : 200, `${action} ${JSON.stringify(who)}`);
      assert.equal(h.commits.length, action === 'applyObsoleteReversal' && !forbidden && !wrongScope ? 1 : 0);
      if (forbidden || wrongScope) assert.equal(calls.length, 0);
    }
  }
});

test('subscription grace allows only the new read-only correction commands, not approval or other routes', async () => {
  const source = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
  const gate = vm.runInNewContext(`${source.slice(source.indexOf('const READ_ONLY_POST_ACTIONS'), source.indexOf('function logIdentityFailure'))}; subscriptionReadOnlyRequestAllowed`, {
    subscriptionGateExempt: () => false
  });
  for (const action of ['obsoleteRoster', 'obsoleteBatch', 'previewObsoleteReversal', 'applyObsoleteReversal']) {
    const make = () => new Request('https://example.test/api/student-billing-reconciliation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    assert.equal(await gate(make(), '/api/student-billing-reconciliation'), action !== 'applyObsoleteReversal');
    assert.equal(await gate(make(), '/api/backend'), false);
  }
});
