import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { effectiveInvoiceAfterReversal } from '../functions/lib/invoice-charge-reversal.js';
import { boardingWearReversalPlan, buildSchoolInvoiceChargeAccountingJournal,
  buildSchoolInvoiceCreditAccountingJournal, buildPaymentAccountingJournal, schoolInvoiceCreditJournalGap,
  calculateAccountFinancialSummary, calculateDueSchoolFeeCreditAllocations,
  buildReceivablesAgeing, getAccountsOverview } from '../functions/api/backend.js';

const student = { AdmissionNo: 'TEST/24/001', ClassName: 'Grade 12', DisplayName: 'Test returning student',
  EnrollmentCategory: 'Returning', StudentType: 'Boarding Student', BillingCategory: 'Regular', AcademicProgress: 'Promoted',
  BranchId: 'main', SchoolSection: 'secondary', AcademicSession: '2026/2027', Term: 'First Term', ProfileCompletionStatus: 'Complete',
  __id: 'TEST_24_001', __scopePath: 'students', __updateTime: 'rev-student' };
const fee = { FeeCode: 'BOW', FeeName: 'Boarding Wear', FeeCategory: 'School Fee', Amount: 60000,
  Active: 'YES', PayableOnline: 'YES', EnrollmentCategory: 'New Intake', ClassName: 'All', StudentType: 'Boarding Student',
  BillingCategory: 'All', Gender: 'All', AcademicProgress: 'All', AcademicSession: student.AcademicSession, Term: student.Term,
  __id: 'BOW', __updateTime: 'rev-fee' };
const invoice = { InvoiceId: 'INV-BOW-TEST', AccountRef: student.AdmissionNo, Amount: 60000, Credit: 0, Balance: 60000,
  FeeCode: 'BOW', FeeName: 'Boarding Wear', FeeCategory: 'School Fee', Status: 'Unpaid', BranchId: 'main',
  AcademicSession: student.AcademicSession, Term: student.Term, Date: '2026-10-01', CreatedAt: '2026-10-01',
  __id: 'INV-BOW-TEST', __updateTime: 'rev-invoice' };
const reversed = (row) => ({ ...row, FeeChargeReversed: 'YES', FeeChargeReversalId: 'BOW-REV-INV-BOW-TEST',
  FeeChargeReversalAmount: row.Amount, FeeChargeReleasedCredit: row.Credit });
const dataFor = (credit = 0) => {
  const inv = { ...invoice, Credit: credit, Balance: 60000 - credit, Status: credit === 60000 ? 'Paid' : credit ? 'Part Paid' : 'Unpaid' };
  const ledger = credit ? [{ AccountRef: student.AdmissionNo, FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee',
    Credit: credit, Debit: 0, __id: 'LED-1', __updateTime: 'rev-ledger' }] : [];
  const payments = credit ? [{ PaymentId: 'PAY-1', AccountRef: student.AdmissionNo, FeeCode: 'SCHOOL_FEES_TOTAL',
    FeeCategory: 'School Fee', Status: 'Paid', Amount: credit, Method: 'Cash', BranchId: 'main',
    Date: '2026-10-01', __id: 'PAY-1', __updateTime: 'rev-payment' }] : [];
  const journals = [buildSchoolInvoiceChargeAccountingJournal(inv),
    ...(credit ? [buildSchoolInvoiceCreditAccountingJournal(inv), buildPaymentAccountingJournal(payments[0])] : [])]
    .filter(Boolean).map((row, index) => ({ ...row, __id: row.JournalNo, __updateTime: `journal-${index}` }));
  return { schoolProfile: {}, feeItems: [fee], invoices: [inv], ledger, payments, journals, accountSummaries: [] };
};

const reorderFields = (value) => Array.isArray(value) ? value.map(reorderFields)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderFields(item)])) : value;
const reorderRecords = (data) => Object.fromEntries(Object.entries(data).map(([key, value]) =>
  [key, Array.isArray(value) ? reorderFields(value).reverse() : reorderFields(value)]));

test('unchanged financial snapshots retain preview tokens across field and document ordering', async () => {
  const data = dataFor(60000), before = JSON.stringify(data);
  const initial = await boardingWearReversalPlan(student, data);
  const reordered = await boardingWearReversalPlan(reorderFields(student), reorderRecords(data));
  assert.equal(initial.ready, true, initial.reason);
  assert.equal(reordered.ready, true, reordered.reason);
  assert.equal(reordered.previewToken, initial.previewToken);
  assert.equal(JSON.stringify(data), before);
});

test('returning BOW reversal preview separates unpaid, partial and fully allocated amounts without writes', async () => {
  for (const credit of [0, 25000, 60000]) {
    const data = dataFor(credit), before = JSON.stringify(data);
    const plan = await boardingWearReversalPlan(student, data);
    assert.equal(plan.ready, true, plan.reason);
    assert.equal(plan.amount, 60000);
    assert.equal(plan.releasedCredit, credit);
    assert.equal(plan.outstandingRemoved, 60000 - credit);
    assert.equal(JSON.stringify(data), before);
  }
});

test('school-wide candidates use only the indexed charge slice and cannot authorize posting', async () => {
  const candidate = await boardingWearReversalPlan(student, dataFor(), { candidateOnly: true });
  assert.equal(candidate.ready, true);
  assert.equal(candidate.previewToken, '');
  assert.deepEqual(candidate.baselineJournals, []);
  const route = await readFile(new URL('../functions/api/student-billing-reconciliation.js', import.meta.url), 'utf8');
  assert.match(route, /\['FeeCode', 'feeCode'\].map/);
  assert.match(route, /field, op: 'in', value: \['BOW'/);
  assert.match(route, /reversalReview \? \[\] : listCollectionForReport\(env, 'accountSummaries'\)/);
});

test('new-intake, missing billing classifications, duplicate, mismatched rule/amount/currency and other-term cases cannot post', async () => {
  const cases = [
    [{ ...student, EnrollmentCategory: 'New Intake' }, dataFor()],
    [{ ...student, StudentType: '' }, dataFor()],
    [{ ...student, EnrollmentCategory: '' }, dataFor()],
    [{ ...student, AcademicSession: '' }, dataFor()],
    [student, { ...dataFor(), invoices: [invoice, { ...invoice, InvoiceId: 'DUP' }] }],
    [student, { ...dataFor(), feeItems: [{ ...fee, EnrollmentCategory: 'All' }] }],
    [student, { ...dataFor(), invoices: [{ ...invoice, Amount: 50000 }] }],
    [student, { ...dataFor(), invoices: [{ ...invoice, Currency: 'USD' }] }],
    [student, { ...dataFor(), invoices: [{ ...invoice, Term: 'Second Term' }] }],
    [student, { ...dataFor(), invoices: [{ ...invoice, SchoolSection: 'primary' }] }]
  ];
  for (const [row, data] of cases) assert.equal((await boardingWearReversalPlan(row, data)).ready, false);
});

test('unrelated profile completion does not block a verified returning-student fee correction', async () => {
  const plan = await boardingWearReversalPlan({ ...student, ProfileCompletionStatus: 'Needs completion' }, dataFor(60000));
  assert.equal(plan.ready, true, plan.reason);
  assert.equal(plan.releasedCredit, 60000);
});

test('paid reversals block missing receipt evidence, over-allocation and inconsistent source journals', async () => {
  for (const change of [
    (data) => { data.ledger = []; }, (data) => { data.payments = []; },
    (data) => { data.journals[0].Lines[0].Debit = 1; },
    (data) => { data.journals[1].Lines[0].Debit = 1; },
    (data) => { data.invoices[0].Credit = 70000; }
  ]) {
    const data = dataFor(60000); change(data);
    assert.equal((await boardingWearReversalPlan(student, data)).ready, false);
  }
});

test('reversal metadata preserves gross history, is idempotent and rejects invalid releases', () => {
  const raw = reversed({ ...invoice, Credit: 25000 });
  const effective = effectiveInvoiceAfterReversal(raw);
  assert.equal(effective.Amount, 0); assert.equal(effective.Credit, 0); assert.equal(effective.Balance, 0);
  assert.equal(effective.GrossInvoiceAmount, 60000); assert.equal(effective.GrossInvoiceCredit, 25000);
  assert.equal(raw.Amount, 60000); assert.equal(raw.Credit, 25000);
  assert.deepEqual(effectiveInvoiceAfterReversal(effective), effective);
  assert.throws(() => effectiveInvoiceAfterReversal({ ...raw, FeeChargeReleasedCredit: 60000 }), /Invalid/);
  assert.equal(buildSchoolInvoiceChargeAccountingJournal(raw).TotalDebit, 60000);
});

test('reversed paid charge releases only real receipt credit and is never automatically reallocated to BOW', async () => {
  const data = dataFor(60000), raw = reversed(data.invoices[0]);
  const before = calculateAccountFinancialSummary(data.invoices, data.ledger, student.AdmissionNo);
  const after = calculateAccountFinancialSummary([raw], data.ledger, student.AdmissionNo);
  assert.equal(before.TotalDebit, 60000); assert.equal(before.CreditBalance, 0);
  assert.equal(after.TotalDebit, 0); assert.equal(after.TotalCredit, 60000); assert.equal(after.CreditBalance, 60000);
  assert.equal(calculateDueSchoolFeeCreditAllocations([raw], data.ledger).allocations.length, 0);
  assert.equal(buildReceivablesAgeing([raw], data.payments, '2026-10-05').length, 0);
  const overview = await getAccountsOverview({}, { ...data, students: [student], accounts: [], applications: [], billingCategories: [] });
  assert.equal(overview.invoices[0].Debit, 60000);
  const corrected = await getAccountsOverview({}, { ...data, invoices: [raw], students: [student], accounts: [], applications: [], billingCategories: [] });
  assert.equal(corrected.invoices[0].Debit, 0);
  assert.equal((await boardingWearReversalPlan(student, { ...data, invoices: [raw] })).ready, false);
});

test('credit-release journal offsets allocations without changing historical credit journals', () => {
  const data = dataFor(60000), raw = reversed(data.invoices[0]);
  const release = { JournalNo: 'RELEASE', Source: 'Student Invoice Credit Release', SourceId: invoice.InvoiceId,
    ReversalId: raw.FeeChargeReversalId, Status: 'Posted', Lines: [{ AccountCode: '1100', Debit: 60000, Credit: 0 },
      { AccountCode: '2310', Debit: 0, Credit: 60000 }] };
  const gap = schoolInvoiceCreditJournalGap(raw, [...data.journals, release]);
  assert.equal(gap.expected, 0); assert.equal(gap.posted, 0); assert.equal(gap.missing, 0);
  assert.equal(schoolInvoiceCreditJournalGap(raw, data.journals).invalidPostedJournalIds.length, 1);
  assert.ok(schoolInvoiceCreditJournalGap(raw, [...data.journals, { ...release, ReversalId: 'WRONG' }]).invalidPostedJournalIds.length);
});

test('preview fingerprint expires on payment, ledger, profile, fee, invoice and journal revision changes', async () => {
  const data = dataFor(60000), token = (await boardingWearReversalPlan(student, data)).previewToken;
  for (const key of ['feeItems', 'invoices', 'payments', 'ledger', 'journals']) {
    const changed = structuredClone(data); changed[key][0].__updateTime += '-changed';
    assert.notEqual((await boardingWearReversalPlan(student, changed)).previewToken, token);
  }
  assert.notEqual((await boardingWearReversalPlan({ ...student, __updateTime: 'new' }, data)).previewToken, token);
});

test('atomic posting preserves original fields, records adjustment/journals/audit, rejects closed periods and stale previews', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const posting = source.slice(source.indexOf('export async function reverseBoardingWearCharge'), source.indexOf('async function saveOrganizationModulePreferences')).replace('export ', '');
  let writes = null, closed = false;
  const data = dataFor(60000);
  const context = { getBoardingWearReversalData: async () => reorderRecords(structuredClone(data)), boardingWearReversalPlan,
    clean: (value) => String(value ?? '').trim(), nowIso: () => '2026-10-05T10:00:00Z',
    sameText: (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase(),
    safeDocumentId: (value) => String(value).replaceAll('/', '_'), accountingPeriodIsClosed: async () => closed,
    buildSchoolInvoiceChargeAccountingJournal, normalizedJournal: (value) => value, getDocument: async () => null,
    accountRefsFrom: () => [student.AdmissionNo], calculateAccountFinancialSummary,
    accountingAuditWrite: () => ({ collectionPath: 'accountingAudit', documentId: 'AUD', data: {} }),
    batchCommitDocuments: async (_env, rows) => { writes = rows; } };
  const post = vm.runInNewContext(`(${posting})`, context);
  const actor = { role: 'Super Admin', username: 'tester' };
  const plan = await boardingWearReversalPlan(student, data);
  await assert.rejects(post({}, student, 'stale', actor, 'New Intake only'), /changed/);
  assert.equal(writes, null);
  data.payments[0].__updateTime += '-changed';
  await assert.rejects(post({}, student, plan.previewToken, actor, 'New Intake only'), /changed/);
  assert.equal(writes, null);
  data.payments[0].__updateTime = 'rev-payment';
  closed = true;
  await assert.rejects(post({}, student, plan.previewToken, actor, 'New Intake only'), /closed/);
  assert.equal(writes, null); closed = false;
  const result = await post({}, student, plan.previewToken, actor, 'New Intake only');
  assert.equal(result.summary.CreditBalance, 60000);
  const updated = writes.find((row) => row.collectionPath === 'invoices');
  assert.equal(updated.updateTime, invoice.__updateTime);
  assert.ok(updated.updateMask.includes('FeeChargeReversalId'));
  assert.ok(!updated.updateMask.some((field) => ['Amount', 'Debit', 'Credit', 'Status', 'Balance'].includes(field)));
  assert.ok(writes.some((row) => row.collectionPath === 'accountingAdjustments' && row.exists === false && row.data.OriginalInvoice.Amount === 60000));
  assert.ok(writes.some((row) => row.collectionPath === 'accountingAudit' && row.data.Before.Amount === 60000));
  const journals = writes.filter((row) => row.collectionPath === 'accountingJournals' && row.exists === false);
  for (const journal of journals) assert.equal(journal.data.Lines.reduce((sum, row) => sum + row.Debit, 0), journal.data.Lines.reduce((sum, row) => sum + row.Credit, 0));
  assert.ok(writes.filter((row) => row.collectionPath === 'payments').every((row) => row.updateMask.length === 1 && row.updateMask[0] === 'AccountRef'));
});

test('both finance readers share effective invoices; UI requires a fresh individual preview and approval reason', async () => {
  for (const file of ['parent-dashboard', 'staff-records']) assert.match(await readFile(new URL(`../functions/api/${file}.js`, import.meta.url), 'utf8'), /effectiveInvoiceAfterReversal/);
  const ui = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(ui, /action: 'previewReversal'/); assert.match(ui, /data-reversal-reason/); assert.match(ui, /confirmText: 'Approve and post'/);
  const api = await readFile(new URL('../functions/api/student-billing-reconciliation.js', import.meta.url), 'utf8');
  assert.match(api, /user.subscriptionReadOnly/); assert.match(api, /candidateOnly: true/);
});
