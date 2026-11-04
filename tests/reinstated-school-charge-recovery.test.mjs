import test from 'node:test';
import assert from 'node:assert/strict';
import { reinstatedSchoolChargeRecoveryPlan, getReinstatedSchoolChargeRecoveryData,
  recoverReinstatedSchoolCharges } from '../functions/lib/reinstated-school-charge-recovery.js';
import { normalizeInvoice, calculateAccountFinancialSummary, buildSchoolInvoiceChargeAccountingJournal,
  buildSchoolInvoiceCreditAccountingJournal, buildPaymentAccountingJournal, safeDocumentId,
  schoolInvoiceCreditJournalGap, buildStudentBillingPreview } from '../functions/api/backend.js';

const copy = value => structuredClone(value);
const actor = { role: 'Super Admin', username: 'approver', edition: 'school', branchId: 'main',
  schoolSectionAccess: 'All', allowedSections: ['accounts', 'students'] };
const scope = { AccountRef: 'TEST/26/274', AdmissionNo: 'TEST/26/274', BranchId: 'main',
  SchoolSection: 'secondary', AcademicSession: '2026/2027', Term: 'First Term' };
const student = { ...scope, __id: 'student', __updateTime: 'v1', __scopePath: 'schoolBranches/main/sections/secondary/students',
  ClassName: 'Grade 10', StudentType: 'Day Student', Gender: 'Female', BillingCategory: 'Regular',
  EnrollmentCategory: 'New Intake', AcademicProgress: 'Promoted', ProfileCompletionStatus: 'Complete', DisplayName: 'Synthetic student' };
const stripRevision = rows => rows.map(({ __updateTime, ...row }) => row);

function fixture({ originalCredit = 0 } = {}) {
  const common = { ...scope, ClassName: 'Grade 10', Active: 'YES', PayableOnline: 'YES', FeeCategory: 'School Fee',
    StudentType: 'All', Gender: 'All', BillingCategory: 'All', BillingCategories: ['All'], AcademicProgress: 'All',
    Currency: 'NGN', DueDate: '2026-09-14', CreatedAt: '2026-09-19T10:00:00Z', UpdatedAt: '2026-11-04T10:53:00Z' };
  const feeItems = [
    ['BASE', 'Other school fees', 870600, 'All'], ['TXT_SNR_10', 'Textbooks (All Subjects)', 148060, 'All'],
    ['LEG', 'Legacy Magazine/Yearbook', 10000, 'Returning'], ['LEGN10', 'Legacy Magazine/Yearbook', 10000, 'New Intake']
  ].map(([FeeCode, FeeName, Amount, EnrollmentCategory]) => ({ ...common, FeeCode, FeeName, Amount, EnrollmentCategory }));
  const invoices = feeItems.slice(0, 3).map((fee, index) => ({ ...scope, InvoiceId: `INV-${index}`, FeeCode: fee.FeeCode,
    FeeName: fee.FeeName, FeeCategory: 'School Fee', Amount: fee.Amount, Debit: fee.Amount,
    Credit: index === 0 ? fee.Amount : originalCredit, Status: index === 0 ? 'Paid' : originalCredit ? 'Part Paid' : 'Unpaid',
    Currency: 'NGN', Date: '2026-10-05', CreatedAt: '2026-10-05T12:00:00Z', UpdatedAt: '2026-10-16T12:00:00Z',
    ...(index ? { FeeChargeReversed: 'YES', FeeChargeReversalId: `FEE-REV-${index}`,
      FeeChargeReversalAmount: fee.Amount, FeeChargeReleasedCredit: originalCredit,
      FeeChargeReversedAt: '2026-10-16T12:00:00Z', FeeChargeReversalReason: 'Returning-only fee on a New Intake student.' } : {}) }));
  const payments = [{ ...scope, PaymentId: 'PAY-1', Reference: 'PAY-1', FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee',
    Amount: 1028660, GrossAmount: 1028660, NetAmount: 1028660, Currency: 'NGN', Method: 'Cash', Status: 'Paid', Date: '2026-10-20' },
  { ...scope, PaymentId: 'WALLET', Reference: 'WALLET', FeeCode: 'WALLET_TOPUP', FeeCategory: 'Wallet', Amount: 500, Currency: 'NGN', Status: 'Paid', Date: '2026-10-20' }];
  const ledger = payments.map(row => ({ ...scope, LedgerNo: `LED-${row.Reference}`, Reference: row.Reference,
    FeeCode: row.FeeCode, FeeCategory: row.FeeCategory, Debit: 0, Credit: row.Amount, Date: row.Date }));
  const journals = [], accountingAdjustments = [];
  for (const raw of invoices) {
    const charge = buildSchoolInvoiceChargeAccountingJournal(raw);
    journals.push(charge);
    if (!raw.FeeChargeReversed) journals.push(buildSchoolInvoiceCreditAccountingJournal(raw));
    else {
      journals.push({ ...charge, JournalNo: `SYS-${raw.FeeChargeReversalId}`, Date: '2026-10-16',
        Source: 'Student Invoice Charge Reversal', ReversalId: raw.FeeChargeReversalId, ReversesJournalNo: charge.JournalNo,
        Lines: charge.Lines.map(line => ({ ...line, Debit: line.Credit, Credit: line.Debit })) });
      if (originalCredit) {
        journals.push(buildSchoolInvoiceCreditAccountingJournal(raw, { amount: originalCredit }));
        journals.push({ ...charge, JournalNo: `SYS-${raw.FeeChargeReversalId}-RELEASE`, Date: '2026-10-16',
          Source: 'Student Invoice Credit Release', ReversalId: raw.FeeChargeReversalId,
          Lines: [{ AccountCode: '1100', Debit: originalCredit, Credit: 0 }, { AccountCode: '2310', Debit: 0, Credit: originalCredit }] });
      }
      accountingAdjustments.push({ ...scope, AdjustmentNo: raw.FeeChargeReversalId, Type: 'Student charge reversal', Status: 'Posted',
        Date: '2026-10-16', Reference: raw.InvoiceId, JournalNo: `SYS-${raw.FeeChargeReversalId}`, Amount: raw.Amount,
        ReleasedCredit: originalCredit, OriginalInvoice: copy(raw) });
    }
  }
  journals.push(buildPaymentAccountingJournal(payments[0]));
  const summary = calculateAccountFinancialSummary(invoices, ledger, scope.AccountRef);
  const data = { schoolProfile: {}, feeItems, invoices, payments, ledger, journals, accountingAdjustments,
    accountSummaries: [{ ...scope, ...summary, __id: safeDocumentId(scope.AccountRef) }], billingCategoryDiscounts: [] };
  for (const [key, rows] of Object.entries(data)) if (Array.isArray(rows)) rows.forEach((row, index) => Object.assign(row, {
    __id: row.__id || (key === 'journals' ? safeDocumentId(row.JournalNo) : key === 'accountingAdjustments' ? row.AdjustmentNo : `${key}-${index}`), __updateTime: 'v1' }));
  return data;
}

function harness({ configure = () => {}, beforeCommit = null, lostResponse = false, closed = () => false, originalCredit = 0 } = {}) {
  const profile = copy(student), data = fixture({ originalCredit }); configure(data, profile);
  const db = new Map(), commits = [];
  db.set(`${profile.__scopePath}/${profile.__id}`, copy(profile));
  for (const [key, rows] of Object.entries(data)) if (Array.isArray(rows)) for (const row of rows) db.set(`${key === 'journals' ? 'accountingJournals' : key}/${row.__id}`, copy(row));
  const read = () => ({ schoolProfile: {}, ...Object.fromEntries(['feeItems', 'invoices', 'payments', 'ledger', 'journals',
    'accountingAdjustments', 'accountSummaries', 'billingCategoryDiscounts'].map(key => [key,
    [...db.entries()].filter(([path]) => path.startsWith(`${key === 'journals' ? 'accountingJournals' : key}/`)).map(([, row]) => copy(row))])) });
  const deps = {
    getStudentBillingData: async (_env, _profile, options) => { assert.equal(options.section, profile.SchoolSection); return read(); },
    queryCollectionPages: async (_env, collection, options) => { assert.equal(collection, 'accountingJournals'); return read().journals.filter(row => row.SourceId === options.filters[0].value); },
    getDocument: async (_env, collection, id) => copy(db.get(`${collection}/${id}`) || null),
    accountingPeriodIsClosed: async (_env, date) => closed(date),
    batchCommitDocuments: async (_env, writes, options) => {
      assert.equal(options.literalDocumentIds, true);
      if (beforeCommit) await beforeCommit(db, writes);
      assert.equal(new Set(writes.map(row => `${row.collectionPath}/${row.documentId}`)).size, writes.length);
      for (const write of writes) {
        const old = db.get(`${write.collectionPath}/${write.documentId}`);
        if (write.exists === false && old || write.updateTime && old?.__updateTime !== write.updateTime) throw new Error('Atomic revision conflict');
      }
      for (const write of writes) {
        const path = `${write.collectionPath}/${write.documentId}`, old = db.get(path);
        db.set(path, { ...(write.updateMask ? old : {}), ...copy(write.data), __id: write.documentId, __updateTime: `after-${commits.length + 1}` });
      }
      commits.push(copy(writes));
      if (lostResponse) throw new Error('Response lost after commit');
    }
  };
  return { profile, data, read, db, commits, deps,
    plan: async () => reinstatedSchoolChargeRecoveryPlan(profile, await getReinstatedSchoolChargeRecoveryData({}, profile, deps)),
    post: token => recoverReinstatedSchoolCharges({}, profile, token, actor, 'Restore the currently applicable textbook and New Intake yearbook charges.', deps) };
}

test('the 158060 gap posts new linked charges, applies existing receipts once, and preserves every original record', async () => {
  for (const originalCredit of [0, 5000]) {
    const h = harness({ originalCredit }), before = h.read(), plan = await h.plan();
    assert.equal(plan.ready, true, plan.reason); assert.equal(plan.amount, 158060);
    assert.equal(plan.expectedTotal, 1028660); assert.equal(plan.postedTotal, 870600); assert.equal(plan.afterPostedTotal, 1028660);
    assert.equal(plan.existingCredit, 158060); assert.equal(plan.creditToApply, 158060); assert.equal(plan.afterCredit, 0);
    assert.deepEqual(h.read(), before, 'planning is read only');
    const result = await h.post(plan.previewToken), after = h.read();
    assert.equal(result.created, 2); assert.equal(result.summary.CreditBalance, 0); assert.equal(result.summary.OutstandingBalance, 0);
    assert.equal(result.summary.TotalCredit, 1028660); assert.equal(result.summary.TotalDebit, 1028660); assert.equal(result.summary.WalletBalance, 500);
    for (const key of ['payments', 'ledger', 'accountingAdjustments']) assert.deepEqual(stripRevision(after[key]), stripRevision(before[key]), key);
    assert.deepEqual(stripRevision(after.invoices.filter(row => before.invoices.some(old => old.__id === row.__id))), stripRevision(before.invoices));
    assert.deepEqual(stripRevision(after.journals.filter(row => before.journals.some(old => old.__id === row.__id))), stripRevision(before.journals));
    for (const row of after.invoices.filter(row => row.RecoveryId)) {
      assert.equal(row.ReplacesInvoiceIds.length, 1); assert.equal(row.ReinstatedFromReversalIds.length, 1);
      assert.equal(row.Credit, row.Amount); assert.equal(schoolInvoiceCreditJournalGap(row, after.journals).missing, 0);
    }
    assert.equal((await h.plan()).noOp, true);
    await assert.rejects(h.post(plan.previewToken)); assert.equal(h.commits.length, 1);
  }
});

test('historical same-code reversal plus one new active charge has a matched billing preview', async () => {
  const h = harness(), plan = await h.plan(); await h.post(plan.previewToken);
  const preview = await buildStudentBillingPreview(h.profile, h.read());
  assert.equal(preview.billingReview.status, 'matched');
  assert.equal(preview.invoicedTotal, preview.expectedTotal);
});

test('unrelated missing tablet stays unposted while the verified textbook and yearbook recover', async () => {
  const h = harness({ configure: data => data.feeItems.push({ ...data.feeItems[0], __id: 'tablet', FeeCode: 'TAB', FeeName: 'Learning tablet', Amount: 250000 }) });
  const plan = await h.plan(); assert.equal(plan.ready, true, plan.reason); assert.equal(plan.amount, 158060);
  assert.deepEqual(plan.remainingMissing.map(row => row.code), ['TAB']);
  await h.post(plan.previewToken); assert.equal(h.read().invoices.some(row => row.FeeCode === 'TAB'), false);
});

test('only the matching textbook is restored when the old yearbook remains returning-only', async () => {
  const h = harness({ configure: data => { data.feeItems = data.feeItems.filter(row => row.FeeCode !== 'LEGN10'); } });
  const plan = await h.plan(); assert.equal(plan.ready, true, plan.reason); assert.equal(plan.amount, 148060);
  const result = await h.post(plan.previewToken); assert.equal(result.summary.CreditBalance, 10000);
});

test('future charges preserve existing credit until due and earmarked wallet/club receipts cannot pay school fees', async () => {
  const h = harness({ configure: data => {
    data.feeItems.filter(row => ['TXT_SNR_10', 'LEGN10'].includes(row.FeeCode)).forEach(row => { row.DueDate = '2099-01-01'; });
    data.payments.push({ ...data.payments[1], __id: 'clubpay', Reference: 'CLUB', FeeCategory: 'Club', FeeCode: 'CLUB_CHESS', Amount: 90000 });
    data.ledger.push({ ...data.ledger[1], __id: 'clubledger', Reference: 'CLUB', FeeCategory: 'Club', FeeCode: 'CLUB_CHESS', Credit: 90000 });
    data.accountSummaries[0] = { ...data.accountSummaries[0], ...calculateAccountFinancialSummary(data.invoices, data.ledger, scope.AccountRef) };
  } });
  const plan = await h.plan(); assert.equal(plan.ready, true, plan.reason); assert.equal(plan.creditToApply, 0); assert.equal(plan.afterCredit, 158060);
  await h.post(plan.previewToken); assert.ok(h.read().invoices.filter(row => row.RecoveryId).every(row => row.Credit === 0));
});

test('unrelated conflicts, ambiguous rules, identities, periods and malformed sources block recovery', async () => {
  const changes = [
    d => { d.feeItems[0].Amount++; }, d => { d.feeItems.push({ ...d.feeItems[1], __id: 'duplicate' }); },
    d => { d.feeItems[1].UpdatedAt = '2026-10-01'; }, d => { d.feeItems[1].Currency = 'USD'; },
    d => { d.invoices[0].Credit = '870600junk'; }, d => { d.ledger[0].Credit++; },
    d => { d.ledger.push({ ...d.ledger[0], __id: 'duplicate-ledger', LedgerNo: 'DUPLICATE' }); },
    d => { d.payments[0].Status = 'Pending'; }, d => { d.payments[0].AccountRef = 'OTHER'; },
    d => { d.invoices[0].SchoolSection = 'primary'; }, d => { d.invoices[0].BranchId = 'annex'; },
    d => { d.invoices[1].AcademicSession = '2025/2026'; },
    d => { d.journals.find(row => row.Source === 'Student Invoice Charge Reversal').Lines[0].Credit++; },
    d => { d.accountingAdjustments[0].Amount++; }, d => { d.accountSummaries[0].CreditBalance++; },
    d => { d.billingCategoryDiscounts = [{ __id: 'discount', __updateTime: 'v1', BranchId: 'main', Name: 'Regular', Percentage: 10 }]; },
    (d, p) => { p.ClassName = ''; }, (d, p) => { p.AcademicSession = ''; },
    (d, p) => { p.EnrollmentCategory = 'Returning'; }, (d, p) => { p.AccountRef = 'OTHER'; }
  ];
  for (const change of changes) {
    const h = harness({ configure: change }), plan = await h.plan();
    assert.equal(plan.ready, false, String(change)); await assert.rejects(h.post(plan.previewToken)); assert.equal(h.commits.length, 0);
  }
});

test('unknown gender or type allows only the same neutral policy for every possible classification, preserving the incomplete profile', async () => {
  for (const missing of [['Gender'], ['StudentType', 'Gender']]) {
    const h = harness({ configure: (_d, p) => { for (const key of missing) delete p[key]; p.ProfileCompletionStatus = 'Needs completion'; } });
    const original = copy(h.profile), plan = await h.plan();
    assert.equal(plan.ready, true, plan.reason); assert.equal(plan.amount, 158060);
    await h.post(plan.previewToken);
    assert.deepEqual(h.profile, original);
    const saved = h.db.get(`${h.profile.__scopePath}/${h.profile.__id}`);
    for (const key of missing) assert.equal(Object.hasOwn(saved, key), false);
  }
  for (const type of ['gender', 'type']) {
    const h = harness({ configure: (d, p) => {
      delete p.Gender; delete p.StudentType;
      d.feeItems.push({ ...d.feeItems[1], __id: 'alternative', FeeCode: 'TXT_ALTERNATE', Amount: 999,
        ...(type === 'gender' ? { Gender: 'Male' } : { StudentType: 'Boarding Student' }) });
    } });
    const plan = await h.plan(); assert.equal(plan.ready, false); assert.match(plan.reason, /classification|Gender|Type/);
  }
});

test('a new textbook code can recover its unique same-name reversed textbook while unrelated tablet stays missing', async () => {
  const h = harness({ configure: d => {
    const oldRule = { ...d.feeItems[1], __id: 'old-textbook-rule', EnrollmentCategory: 'Returning', Amount: 148060 };
    d.feeItems[1].FeeCode = 'TXT_NEW'; d.feeItems[1].Amount = 120065; d.feeItems[1].EnrollmentCategory = 'New Intake';
    d.feeItems[1].UpdatedAt = '2026-10-05T20:00:00Z';
    d.feeItems.push(oldRule);
    d.feeItems = d.feeItems.filter(row => row.FeeCode !== 'LEGN10');
    d.feeItems.push({ ...d.feeItems[0], __id: 'tablet', FeeCode: 'TAB', FeeName: 'Learning tablet', Amount: 250000 });
  } });
  const plan = await h.plan(); assert.equal(plan.ready, true, plan.reason); assert.equal(plan.amount, 120065);
  assert.equal(plan.charges[0].sourceInvoiceId, 'INV-1'); assert.equal(plan.charges[0].code, 'TXT_NEW');
  await h.post(plan.previewToken);
  assert.equal(h.read().invoices.filter(row => row.RecoveryId)[0].FeeCode, 'TXT_NEW');
  assert.equal(h.read().invoices.some(row => row.FeeCode === 'TAB'), false);
});

test('invalid retained reversal metadata and a wrong-period release fail closed', async () => {
  const invalid = harness({ configure: d => { d.invoices[1].FeeChargeReversalAmount = 1; } });
  await assert.rejects(invalid.plan(), /Invalid invoice reversal/); assert.equal(invalid.commits.length, 0);
  const release = harness({ originalCredit: 5000, configure: d => { d.journals.find(row => row.Source === 'Student Invoice Credit Release').Term = 'Second Term'; } });
  assert.equal((await release.plan()).ready, false);
});

test('stale preview and atomic source races cannot partially post invoices or allocations', async () => {
  for (const collection of ['invoices', 'payments', 'ledger', 'feeItems', 'accountingJournals', 'accountingAdjustments', 'accountSummaries']) {
    const h = harness({ beforeCommit: db => {
      const [, row] = [...db.entries()].find(([key]) => key.startsWith(`${collection}/`)); row.__updateTime = 'concurrent-change';
    } });
    const plan = await h.plan(); assert.equal(plan.ready, true, plan.reason);
    await assert.rejects(h.post(plan.previewToken), /revision conflict/); assert.equal(h.commits.length, 0);
    assert.equal(h.read().invoices.length, 3);
  }
  const h = harness(), plan = await h.plan(); h.db.get('feeItems/feeItems-1').Amount++;
  await assert.rejects(h.post(plan.previewToken), /changed|differs/); assert.equal(h.commits.length, 0);
});

test('lost responses, deterministic ID collisions and concurrent approval never duplicate records', async () => {
  const lost = harness({ lostResponse: true }), plan = await lost.plan();
  await assert.rejects(lost.post(plan.previewToken), /Response lost/);
  await assert.rejects(lost.post(plan.previewToken)); assert.equal(lost.commits.length, 1); assert.equal(lost.read().invoices.length, 5);
  const collision = harness({ beforeCommit: (db, writes) => {
    const row = writes.find(write => write.collectionPath === 'invoices' && write.exists === false);
    db.set(`invoices/${row.documentId}`, { __id: row.documentId, __updateTime: 'collision' });
  } });
  const collisionPlan = await collision.plan(); await assert.rejects(collision.post(collisionPlan.previewToken), /revision conflict/);
  assert.equal(collision.commits.length, 0);
  const parallel = harness(), simultaneous = await parallel.plan();
  const results = await Promise.allSettled([parallel.post(simultaneous.previewToken), parallel.post(simultaneous.previewToken)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(parallel.commits.length, 1);
});

test('missing original baseline journals are added atomically only in open periods; missing reversals always block', async () => {
  for (const closed of [false, true]) {
    const h = harness({ configure: d => { d.journals = d.journals.filter(row => row.JournalNo !== 'SYS-INV-INV-0'); },
      closed: date => closed && String(date).startsWith('2026-10-05') });
    const plan = await h.plan(); assert.equal(plan.ready, true, plan.reason); assert.equal(plan.baselineJournals.length, 1);
    if (closed) { await assert.rejects(h.post(plan.previewToken), /closed period/); assert.equal(h.commits.length, 0); }
    else { await h.post(plan.previewToken); assert.ok(h.read().journals.some(row => row.JournalNo === 'SYS-INV-INV-0')); }
  }
  const missing = harness({ configure: d => { d.journals = d.journals.filter(row => row.Source !== 'Student Invoice Charge Reversal'); } });
  assert.equal((await missing.plan()).ready, false);
  const current = harness({ closed: () => true }), plan = await current.plan();
  await assert.rejects(current.post(plan.previewToken), /posting period is closed/);
});

test('only authorized writable school Super Admins can commit a reviewed recovery', async () => {
  const h = harness(), plan = await h.plan();
  for (const override of [{ role: 'Accounts Officer' }, { edition: 'church' }, { branchId: 'annex' },
    { schoolSectionAccess: 'primary' }, { allowedSections: ['accounts'] }, { subscriptionReadOnly: true }, { subscriptionActive: false }]) {
    await assert.rejects(recoverReinstatedSchoolCharges({}, h.profile, plan.previewToken, { ...actor, ...override }, 'Approve recovery', h.deps), /Super Admin/);
  }
  assert.equal(h.commits.length, 0);
});

test('source guard writes retain literal legacy IDs and original reversed credits; unrelated fee rules are not touched', async () => {
  const h = harness({ originalCredit: 5000, configure: d => {
    d.invoices[1].__id = 'legacy%2Finvoice with space';
    d.feeItems.push({ ...d.feeItems[0], __id: 'other-class-rule', FeeCode: 'OTHER_CLASS', ClassName: 'Grade 3', Amount: 20000 });
  } });
  const plan = await h.plan(); assert.equal(plan.ready, true, plan.reason);
  assert.equal(plan.guardedFeeIds.includes('other-class-rule'), false);
  await h.post(plan.previewToken);
  const writes = h.commits[0];
  assert.ok(writes.some(row => row.collectionPath === 'invoices' && row.documentId === 'legacy%2Finvoice with space'));
  assert.equal(writes.some(row => row.documentId === 'other-class-rule'), false);
  assert.equal(h.db.get('invoices/legacy%2Finvoice with space').Credit, 5000);
});

test('a stale stored wallet balance does not block school recovery and is not refreshed by the school-only summary update', async () => {
  const h = harness({ configure: d => { d.accountSummaries[0].WalletBalance = 1300; d.accountSummaries[0].OtherRetainedField = 'preserve'; } });
  const plan = await h.plan(); assert.equal(plan.ready, true, plan.reason);
  assert.equal(plan.summaryAfter.WalletBalance, 1300);
  const result = await h.post(plan.previewToken);
  assert.equal(result.summary.WalletBalance, 1300);
  assert.equal(h.read().accountSummaries[0].WalletBalance, 1300);
  assert.equal(h.read().accountSummaries[0].OtherRetainedField, 'preserve');
  const write = h.commits[0].find(row => row.collectionPath === 'accountSummaries');
  assert.equal(write.updateMask.includes('WalletBalance'), false);
});
