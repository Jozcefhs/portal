import { batchCommitDocuments, getDocument, queryCollectionPages } from './firestore.js';
import { financialPreviewFingerprint } from './financial-preview-fingerprint.js';
import { studentBillingIdentity } from './student-billing-profile.js';
import { financeMoney } from './accounting-mutation-guards.js';
import { getStudentBillingData, buildStudentBillingPreview, normalizeInvoice, normalizeFeeItem, normalizePayment,
  normalizeLedger, feeMatchesAccountPeriod, isSchoolFeeInvoice, sameFinancialPeriod,
  isAvailableSchoolCreditReceipt, paymentCreditedAmount, journalLineSignature,
  buildSchoolInvoiceChargeAccountingJournal, buildSchoolInvoiceCreditAccountingJournal,
  buildPaymentAccountingJournal, schoolInvoiceCreditJournalGap, calculateAccountFinancialSummary,
  accountingPeriodIsClosed, normalizedJournal, accountingAuditWrite, safeDocumentId, accountRefsFrom } from '../api/backend.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const same = (a, b) => lower(a) === lower(b);
const money = value => Math.round(Number(value || 0) * 100) / 100;
const active = value => ['yes', 'true', '1'].includes(lower(value));
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const closedInvoice = row => ['void', 'voided', 'cancelled', 'canceled', 'reversed'].includes(lower(row.Status));
const supported = row => /^(TXT(?:_|$)|LEG$)/i.test(clean(row.FeeCode)) || /\b(textbooks?|yearbook)\b/i.test(clean(row.FeeName));
const dbDefaults = { batchCommitDocuments, getDocument, queryCollectionPages, getStudentBillingData, accountingPeriodIsClosed };

// Only release real, reconciled allocations. Restore absent baseline journals
// within the same commit; never rewrite a receipt or an existing journal.
function financialEvidence(profile, invoices, data) {
  const journals = data.journals || [], baseline = new Map();
  // Legacy normalizers are permissive for display. A financial write must not
  // silently interpret malformed source amounts as zero or strip stray letters.
  for (const row of [...data.feeItems, ...data.invoices, ...data.payments, ...data.ledger]) {
    for (const field of ['Amount', 'amount', 'Debit', 'debit', 'Credit', 'credit', 'PaidAmount', 'paidAmount', 'CreditedAmount', 'creditedAmount']) {
      if (Object.hasOwn(row, field)) financeMoney(row[field], `Source ${field}`, { defaultValue: 0 });
    }
  }
  if (new Set(journals.map(row => lower(row.JournalNo || row.__id))).size !== journals.length ||
    journals.some(row => !same(row.BranchId || 'main', profile.BranchId))) fail('Duplicate or out-of-scope journals require finance review.');
  const remember = journal => {
    const prior = baseline.get(journal.JournalNo);
    if (prior && journalLineSignature(prior.Lines) !== journalLineSignature(journal.Lines)) fail('Conflicting source journals require finance review.');
    baseline.set(journal.JournalNo, journal);
  };
  for (const invoice of invoices) {
    if (!clean(invoice.CreatedAt || invoice.Date) || !Number.isFinite(Date.parse(invoice.CreatedAt || invoice.Date))) fail('Verify the original invoice date before reversing this charge.');
    const source = buildSchoolInvoiceChargeAccountingJournal(invoice);
    const prior = journals.find(row => same(row.JournalNo || row.__id, source.JournalNo));
    if (prior && (lower(prior.Status) !== 'posted' || journalLineSignature(prior.Lines) !== journalLineSignature(source.Lines) ||
      !same(prior.BranchId || 'main', profile.BranchId) || !same(prior.Date, source.Date))) fail('A posted invoice journal differs from its source; finance review is required.');
    if (!prior) remember(source);
    const gap = schoolInvoiceCreditJournalGap(invoice, journals);
    if (gap.invalidPostedJournalIds?.length || gap.missing < -0.005 || (gap.missing > 0.005 && gap.baselineExists)) fail('Payment allocations and journals do not reconcile; finance review is required.');
    if (gap.missing > 0.005) remember(buildSchoolInvoiceCreditAccountingJournal(invoice, { amount: gap.missing }));
  }
  const ledger = (data.ledger || []).map(normalizeLedger);
  const received = ledger.filter(isAvailableSchoolCreditReceipt).reduce((sum, row) => sum + row.Credit, 0);
  const withdrawn = ledger.filter(row => lower(row.FeeCategory) === 'account credit').reduce((sum, row) => sum + row.Debit, 0);
  const allocated = (data.invoices || []).map(normalizeInvoice).filter(isSchoolFeeInvoice).reduce((sum, row) => sum + Math.min(row.Debit, row.Credit), 0);
  if (allocated + withdrawn > received + 0.005) fail('Allocated parent credit lacks matching receipt evidence; finance review is required.');
  const receipts = (data.payments || []).map(normalizePayment).filter(isAvailableSchoolCreditReceipt);
  const traced = receipts.filter(row => ['paid', 'success', 'successful', 'completed'].includes(lower(row.Status)))
    .reduce((sum, row) => sum + paymentCreditedAmount(row), 0);
  if (invoices.some(row => row.Credit > 0) && traced + 0.005 < received) fail('Paid charges require traceable successful receipts; finance review is required.');
  for (const receipt of receipts) {
    if (!same(receipt.Currency || 'NGN', 'NGN') || !clean(receipt.PaidAt || receipt.PaymentDate || receipt.Date) ||
      !Number.isFinite(Date.parse(receipt.PaidAt || receipt.PaymentDate || receipt.Date))) fail('Verify the original receipt currency and date before releasing its allocation.');
    if (!['paid', 'success', 'successful', 'completed'].includes(lower(receipt.Status))) fail('A receipt is not confirmed successful; finance review is required.');
    const source = buildPaymentAccountingJournal(receipt);
    if (!source) fail('A receipt cannot be traced to its accounting journal.');
    const prior = journals.find(row => same(row.JournalNo || row.__id, source.JournalNo));
    if (!prior) remember(source);
    else if (lower(prior.Status) !== 'posted' || journalLineSignature(prior.Lines) !== journalLineSignature(source.Lines) ||
      !same(prior.BranchId || 'main', profile.BranchId) || !same(prior.Date, source.Date)) fail('A receipt journal requires finance review before credit can be released.');
  }
  return [...baseline.values()];
}

export async function obsoleteSchoolChargeReversalPlan(student, data, { candidateOnly = false } = {}) {
  const preview = await buildStudentBillingPreview(student, data), profile = preview.profile;
  const invoices = (data.invoices || []).map(normalizeInvoice);
  const current = invoices.filter(row => sameFinancialPeriod(row, profile.AcademicSession, profile.Term) && !closedInvoice(row));
  const candidates = current.filter(row => supported(row) && isSchoolFeeInvoice(row) && row.Debit > 0 &&
    preview.rows.some(component => same(component.code, row.FeeCode) && component.expected === 0));
  const fees = (data.feeItems || []).map(normalizeFeeItem);
  const charges = candidates.map(invoice => {
    const rules = fees.filter(fee => same(fee.FeeCode, invoice.FeeCode) && supported(fee) && active(fee.Active) &&
      feeMatchesAccountPeriod(fee, profile, { enrollmentCategoryOverride: 'Returning' }));
    let reason = '';
    if (!same(profile.EnrollmentCategory, 'New Intake')) reason = 'Only obsolete returning-only charges on a verified New Intake profile qualify.';
    else if (!clean(student.AcademicSession || student.academicSession) || !clean(student.Term || student.term) ||
      !clean(student.ClassName || student.className) || !clean(student.StudentType || student.studentType)) reason = 'Verify the saved class, student type, session and term first.';
    else if (current.filter(row => same(row.FeeCode, invoice.FeeCode)).length !== 1) reason = 'Duplicate invoices for this component require individual finance review.';
    else if (invoices.filter(row => same(row.InvoiceId, invoice.InvoiceId)).length !== 1) reason = 'Duplicate invoice references require individual finance review.';
    else if (rules.length !== 1 || !same(rules[0].EnrollmentCategory, 'Returning')) reason = 'One active returning-only fee rule must confirm that this charge is obsolete.';
    else if (['Gender', 'BillingCategory', 'AcademicProgress'].some(field => clean(rules[0][field]) && !['all', '*'].includes(lower(rules[0][field])) &&
      !clean(student[field] || student[field[0].toLowerCase() + field.slice(1)]))) reason = 'Verify the billing classifications required by this fee rule first.';
    else if (invoice.Debit !== rules[0].Amount || invoice.Credit < 0 || invoice.Credit > invoice.Debit ||
      !Number.isFinite(invoice.Debit) || !Number.isFinite(invoice.Credit)) reason = 'Invoice amounts differ from the configured charge; finance review is required.';
    else if (!same(invoice.Currency || invoice.currency || 'NGN', 'NGN')) reason = 'Foreign-currency charges require individual finance review.';
    else if (!same(invoice.BranchId || 'main', profile.BranchId) ||
      (clean(invoice.SchoolSection || invoice.schoolSection) && !same(invoice.SchoolSection || invoice.schoolSection, profile.SchoolSection))) reason = 'Invoice scope differs from the student profile.';
    return { invoiceId: invoice.InvoiceId, code: invoice.FeeCode, name: invoice.FeeName, amount: invoice.Debit,
      releasedCredit: invoice.Credit, outstandingRemoved: money(invoice.Debit - invoice.Credit), reason, ready: !reason };
  });
  let reason = charges.find(row => row.reason)?.reason || (!charges.length ? 'No eligible obsolete textbook or yearbook charges in this period.' : '');
  if (['invoices', 'ledger', 'payments'].some(key => (data[key] || []).some(row =>
    !same(row.BranchId || 'main', profile.BranchId) || (clean(row.SchoolSection || row.schoolSection) &&
      !same(row.SchoolSection || row.schoolSection, profile.SchoolSection))))) reason = 'Financial record scope differs from the student profile; finance review is required.';
  let baselineJournals = [];
  if (!reason && !candidateOnly) {
    try { baselineJournals = financialEvidence(profile, candidates, data); }
    catch (error) { reason = error.message; }
  }
  const writeCount = 2 + ['feeItems', 'invoices', 'payments', 'ledger', 'journals'].reduce((sum, key) => sum + (data[key]?.length || 0), 0)
    + baselineJournals.length + charges.reduce((sum, row) => sum + 3 + (row.releasedCredit > 0 ? 1 : 0), 0);
  if (!candidateOnly && writeCount > 450) reason = 'Too many source records for one safe correction; individual finance review is required.';
  const amount = money(charges.reduce((sum, row) => sum + row.amount, 0));
  const releasedCredit = money(charges.reduce((sum, row) => sum + row.releasedCredit, 0));
  const previewToken = candidateOnly ? '' : await financialPreviewFingerprint({ kind: 'obsolete-school-fees-v1',
    // Other students' no-op fee guards advance revisions. Keep all rule values
    // in the token; the commit still guards the freshly read fee revisions.
    profile, revision: student.__updateTime, feeItems: (data.feeItems || []).map(({ __updateTime, __createTime, ...rule }) => rule), invoices: data.invoices, ledger: data.ledger,
    payments: data.payments, summaries: data.accountSummaries, journals: data.journals }, ['feeItems', 'invoices', 'ledger', 'payments', 'summaries', 'journals']);
  return { ok: true, readOnly: true, candidateOnly, profile, charges, amount, releasedCredit,
    outstandingRemoved: money(amount - releasedCredit), expectedTotal: preview.expectedTotal, postedTotal: preview.invoicedTotal,
    afterPostedTotal: money(preview.invoicedTotal - amount), ready: !reason, reason, previewToken, baselineJournals, writeCount,
    rows: charges.map(row => ({ ...row, expected: 0, invoiced: row.amount, difference: -row.amount, invoiceIds: [row.invoiceId] })),
    message: 'Review only. Original charges and receipts remain in the audit trail. Reversals release existing allocations, not new money; no refund or payment is created.' };
}

export async function getObsoleteSchoolChargeReversalData(env, student, overrides = {}) {
  const db = { ...dbDefaults, ...overrides };
  const data = await db.getStudentBillingData(env, student, { section: student.SchoolSection });
  const journals = [];
  // Bound concurrency; financial history is scoped to one student, not the school.
  for (const invoice of data.invoices.map(normalizeInvoice).filter(supported)) journals.push(...await db.queryCollectionPages(env, 'accountingJournals', {
    filters: [{ field: 'SourceId', op: '==', value: invoice.InvoiceId }], pageSize: 250, maxRows: 2000
  }));
  for (const receipt of data.payments.map(normalizePayment).filter(isAvailableSchoolCreditReceipt)) {
    const journal = buildPaymentAccountingJournal(receipt);
    if (journal) {
      const stored = await db.getDocument(env, 'accountingJournals', safeDocumentId(journal.JournalNo));
      if (stored) journals.push(stored);
    }
  }
  return { ...data, journals: [...new Map(journals.map(row => [row.__name || row.__id, row])).values()] };
}

export async function reverseObsoleteSchoolCharges(env, student, token, actor, approvalReason, overrides = {}) {
  const identity = studentBillingIdentity(student);
  if (actor.role !== 'Super Admin' || actor.edition !== 'school' || actor.subscriptionReadOnly || actor.subscriptionActive === false ||
    !same(actor.branchId, identity.branch) || !['accounts', 'students'].every(section => actor.allowedSections?.includes(section)) ||
    (!same(actor.schoolSectionAccess || 'All', 'All') && !same(actor.schoolSectionAccess, identity.section)) ||
    !clean(approvalReason) || clean(approvalReason).length > 500) fail('Writable Super Admin approval in this school scope and a reason are required.', 403);
  const db = { ...dbDefaults, ...overrides };
  const data = await getObsoleteSchoolChargeReversalData(env, student, db);
  const plan = await obsoleteSchoolChargeReversalPlan(student, data);
  if (!plan.ready || !token || token !== plan.previewToken) fail(plan.reason || 'Financial records changed after preview. Review again.');
  const stamp = new Date().toISOString(), date = stamp.slice(0, 10);
  if (await db.accountingPeriodIsClosed(env, date)) fail('The reversal posting period is closed.');
  for (const journal of plan.baselineJournals) if (await db.accountingPeriodIsClosed(env, journal.Date)) fail('A missing source journal belongs to a closed period; finance review is required.');
  const writes = [], updates = new Map();
  const guard = (row, collectionPath) => {
    const field = ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef', 'Amount', 'amount', 'InvoiceId', 'invoiceId', 'JournalNo', 'FeeCode', 'feeCode', 'Credit', 'credit'].find(key => Object.hasOwn(row, key));
    if (!row.__id || !row.__updateTime || !field) fail('A source record lacks its database revision; no reversal was posted.');
    writes.push({ collectionPath, documentId: row.__id, updateTime: row.__updateTime, updateMask: [field], data: { [field]: row[field] } });
  };
  guard(student, student.__scopePath || 'students');
  for (const [key, collection] of [['feeItems', 'feeItems'], ['ledger', 'ledger'], ['payments', 'payments'], ['journals', 'accountingJournals']]) {
    for (const row of data[key]) guard(row, collection);
  }
  const journals = [...plan.baselineJournals];
  for (const charge of plan.charges) {
    const invoice = data.invoices.find(row => same(normalizeInvoice(row).InvoiceId, charge.invoiceId));
    if (!invoice?.__id || !invoice.__updateTime) fail('The invoice lacks its database revision.');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([identity.branch, identity.section, invoice.__id])));
    const reversalId = `FEE-REV-${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const fields = { FeeChargeReversed: 'YES', FeeChargeReversalId: reversalId, FeeChargeReversalAmount: charge.amount,
      FeeChargeReleasedCredit: charge.releasedCredit, FeeChargeReversedAt: stamp, FeeChargeReversedBy: actor.username,
      FeeChargeReversalReason: clean(approvalReason) };
    updates.set(invoice.__id, fields);
    writes.push({ collectionPath: 'invoices', documentId: invoice.__id, updateTime: invoice.__updateTime, updateMask: Object.keys(fields), data: fields });
    const source = buildSchoolInvoiceChargeAccountingJournal(invoice);
    const reverse = normalizedJournal({ ...source, JournalNo: `SYS-${reversalId}`, Date: date,
      Description: `Obsolete ${charge.code} charge reversal: ${plan.profile.AccountRef}`, Source: 'Student Invoice Charge Reversal',
      SourceId: charge.invoiceId, ReversalId: reversalId, ReversesJournalNo: source.JournalNo,
      SchoolSection: identity.section,
      RecordedBy: actor.displayName || actor.username, Reason: clean(approvalReason), CreatedAt: stamp, UpdatedAt: stamp,
      Lines: source.Lines.map(line => ({ ...line, Debit: line.Credit, Credit: line.Debit })) });
    journals.push(reverse);
    if (charge.releasedCredit > 0) journals.push(normalizedJournal({ ...reverse, JournalNo: `SYS-${reversalId}-RELEASE`,
      Source: 'Student Invoice Credit Release', Description: `Release original parent credit allocation: ${plan.profile.AccountRef}`,
      TotalDebit: charge.releasedCredit, TotalCredit: charge.releasedCredit,
      ReversesJournalNo: '', ReversesJournalNos: [...data.journals, ...plan.baselineJournals]
        .filter(row => same(row.Source, 'Student Invoice Credit') && same(row.SourceId, charge.invoiceId)).map(row => row.JournalNo),
      Lines: [{ AccountCode: '1100', Debit: charge.releasedCredit, Credit: 0 }, { AccountCode: '2310', Debit: 0, Credit: charge.releasedCredit }] }));
    writes.push({ collectionPath: 'accountingAdjustments', documentId: reversalId, exists: false, data: {
      AdjustmentNo: reversalId, Type: 'Student charge reversal', Status: 'Posted', Date: date, AccountRef: plan.profile.AccountRef,
      BranchId: identity.branch, SchoolSection: identity.section, AcademicSession: plan.profile.AcademicSession, Term: plan.profile.Term,
      Amount: charge.amount, ReleasedCredit: charge.releasedCredit, Reason: clean(approvalReason), Reference: charge.invoiceId,
      JournalNo: reverse.JournalNo, PostedBy: actor.username, PostedAt: stamp, OriginalInvoice: invoice } });
    const audit = accountingAuditWrite('REVERSE OBSOLETE SCHOOL FEE CHARGE', 'Student invoice', charge.invoiceId,
      { UserRole: actor.role, UserUsername: actor.username, RecordedBy: actor.displayName || actor.username, BranchId: identity.branch }, clean(approvalReason));
    Object.assign(audit.data, { SourcePlatform: 'Web', ReversalId: reversalId, Before: invoice, After: fields,
      Amount: charge.amount, ReleasedCredit: charge.releasedCredit, AccountRef: plan.profile.AccountRef, SchoolSection: identity.section });
    writes.push(audit);
  }
  for (const row of data.invoices) if (!updates.has(row.__id)) guard(row, 'invoices');
  for (const journal of journals) writes.push({ collectionPath: 'accountingJournals', documentId: safeDocumentId(journal.JournalNo), exists: false, data: journal });
  const summaryId = safeDocumentId(plan.profile.AccountRef);
  const snapshot = await db.getDocument(env, 'accountSummaries', summaryId);
  const before = data.accountSummaries.find(row => row.__id === summaryId);
  if ((snapshot?.__updateTime || '') !== (before?.__updateTime || '')) fail('Account balance changed since preview. No reversal was posted.');
  const summary = calculateAccountFinancialSummary(data.invoices.map(row => ({ ...row, ...updates.get(row.__id) })), data.ledger, plan.profile.AccountRef, date);
  writes.push({ collectionPath: 'accountSummaries', documentId: summaryId,
    ...(snapshot ? { updateTime: snapshot.__updateTime } : { exists: false }), data: { ...summary,
      BranchId: identity.branch, SchoolSection: identity.section, LinkedReferences: accountRefsFrom(student).filter(ref => !same(ref, plan.profile.AccountRef)) } });
  if (writes.length > 450) fail('Too many source records for one safe correction; individual finance review is required.');
  // __id values are literal Firestore resource IDs, including legacy % escapes
  // or spaces. Encoding them again would target different financial records.
  await db.batchCommitDocuments(env, writes, { literalDocumentIds: true });
  return { ok: true, reversed: plan.charges.length, amount: plan.amount, releasedCredit: plan.releasedCredit, summary,
    message: 'Obsolete textbook/yearbook charges reversed. Original invoices, payments and receipts preserved. Existing allocations released to the account; no new payment or refund created. Refresh Accounts and the parent portal.' };
}
