import { batchCommitDocuments, getDocument, queryCollectionPages } from './firestore.js';
import { financialPreviewFingerprint } from './financial-preview-fingerprint.js';
import { studentBillingIdentity, studentProfileValue } from './student-billing-profile.js';
import { financeMoney } from './accounting-mutation-guards.js';
import { getStudentBillingData, buildStudentBillingPreview, normalizeInvoice, normalizeFeeItem, normalizePayment,
  normalizeLedger, feeMatchesAccountPeriod, isSchoolFeeInvoice, sameFinancialPeriod,
  isAvailableSchoolCreditReceipt, paymentCreditedAmount, journalLineSignature,
  buildSchoolInvoiceChargeAccountingJournal, buildSchoolInvoiceCreditAccountingJournal,
  buildSchoolInvoiceCreditAutomaticJournal,
  buildPaymentAccountingJournal, schoolInvoiceCreditJournalGap, calculateAccountFinancialSummary,
  calculateDueSchoolFeeCreditAllocations,
  accountingPeriodIsClosed, normalizedJournal, accountingAuditWrite, safeDocumentId, accountRefsFrom } from '../api/backend.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const same = (a, b) => lower(a) === lower(b);
const money = value => Math.round(Number(value || 0) * 100) / 100;
const active = value => ['yes', 'true', '1'].includes(lower(value));
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const closedInvoice = row => ['void', 'voided', 'cancelled', 'canceled', 'reversed'].includes(lower(row.Status));
const uniform = row => /^UNI_[MF]$/i.test(clean(row.FeeCode)) || /\buniforms?\b/i.test(clean(row.FeeName));
const tuition = row => /\btuition\b/i.test(clean(row.FeeName));
const supported = row => tuition(row) || uniform(row) || /^(TXT(?:_|$)|LEG$)/i.test(clean(row.FeeCode)) || /\b(textbooks?|yearbook)\b/i.test(clean(row.FeeName));
const dbDefaults = { batchCommitDocuments, getDocument, queryCollectionPages, getStudentBillingData, accountingPeriodIsClosed };
const classificationFields = ['Gender', 'BillingCategory', 'AcademicProgress'];
const savedValue = (student, field) => studentProfileValue(student, field, [field[0].toLowerCase() + field.slice(1)]);

// An unfinished profile is not a Day Student declaration. For a type-independent
// reversal, even a potentially applicable New Intake rule must prevent approval.
// Missing classifications cannot hide such a rule through display defaults.
function potentiallyApplies(fee, profile, student) {
  const possibleRule = { ...fee };
  for (const field of classificationFields) {
    if (!savedValue(student, field)) {
      possibleRule[field] = 'All';
      if (field === 'BillingCategory') possibleRule.BillingCategories = ['All'];
    }
  }
  return feeMatchesAccountPeriod(possibleRule, profile);
}

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
  const preview = await buildStudentBillingPreview(student, data);
  const savedType = savedValue(student, 'StudentType');
  const profile = { ...preview.profile, StudentType: savedType };
  const profiles = savedType ? [profile] : ['Day Student', 'Boarding Student'].map(StudentType => ({ ...profile, StudentType }));
  const invoices = (data.invoices || []).map(normalizeInvoice);
  const current = invoices.filter(row => sameFinancialPeriod(row, profile.AcademicSession, profile.Term) && !closedInvoice(row));
  const candidates = current.filter(row => supported(row) && isSchoolFeeInvoice(row) && row.Debit > 0 &&
    preview.rows.some(component => same(component.code, row.FeeCode) && component.expected === 0));
  const fees = (data.feeItems || []).map(normalizeFeeItem);
  const charges = candidates.map(invoice => {
    const componentFees = fees.filter(fee => same(fee.FeeCode, invoice.FeeCode) && supported(fee) && active(fee.Active));
    const rulesByType = profiles.map(candidate => componentFees.filter(fee =>
      feeMatchesAccountPeriod(fee, candidate, { enrollmentCategoryOverride: 'Returning' })));
    // A configured fee can also belong exclusively to another class. Prove
    // that class is the only mismatch; never infer this from a fee-code suffix.
    const classRulesByType = profiles.map(candidate => componentFees.filter(fee =>
      feeMatchesAccountPeriod({ ...fee, ClassName: 'All' }, candidate) && !feeMatchesAccountPeriod(fee, candidate)));
    const differentClass = !uniform(invoice) && !!savedValue(student, 'EnrollmentCategory') &&
      classRulesByType.every(matches => matches.length === 1) &&
      !profiles.some(candidate => componentFees.some(fee => potentiallyApplies(fee, candidate, student)));
    // Require the saved gender and an unambiguous active rule: only gender
    // may differ. A fee's label or code alone never proves a wrong charge.
    const savedGender = lower(savedValue(student, 'Gender'));
    const genderRulesByType = profiles.map(candidate => componentFees.filter(fee =>
      ['male', 'female'].includes(lower(fee.Gender)) && lower(fee.Gender) !== savedGender &&
      feeMatchesAccountPeriod({ ...fee, Gender: profile.Gender }, candidate) && !feeMatchesAccountPeriod(fee, candidate)));
    const differentGender = uniform(invoice) && ['male', 'female'].includes(savedGender) &&
      genderRulesByType.every(matches => matches.length === 1) &&
      !profiles.some(candidate => componentFees.some(fee => potentiallyApplies(fee, candidate, student)));
    // Tuition/textbook category replacements need an explicit saved category,
    // proof that category is the only mismatch, and one already-correct invoice
    // for the same named component. Never infer a replacement from a code suffix.
    const categoryRules = componentFees.filter(fee =>
      (!clean(fee.SchoolSection || fee.schoolSection) || same(fee.SchoolSection || fee.schoolSection, profile.SchoolSection)) &&
      feeMatchesAccountPeriod({ ...fee, BillingCategory: 'All', BillingCategories: ['All'] }, profile) &&
      !feeMatchesAccountPeriod(fee, profile));
    const replacementRules = fees.filter(fee => active(fee.Active) && !same(fee.FeeCode, invoice.FeeCode) &&
      same(fee.FeeName, invoice.FeeName) && same(fee.FeeCategory, invoice.FeeCategory) &&
      same(fee.BranchId, profile.BranchId) && feeMatchesAccountPeriod(fee, profile) &&
      (!clean(fee.SchoolSection || fee.schoolSection) || same(fee.SchoolSection || fee.schoolSection, profile.SchoolSection)) &&
      fee.BillingCategories?.some(category => same(category, profile.BillingCategory)) &&
      preview.rows.some(row => same(row.code, fee.FeeCode) && !row.conflict && row.expected > 0 && row.expected === fee.Amount && row.invoiced === row.expected));
    const replacementInvoices = replacementRules.length === 1 ? current.filter(row =>
      same(row.FeeCode, replacementRules[0].FeeCode) && isSchoolFeeInvoice(row) && row.Debit === replacementRules[0].Amount) : [];
    const differentCategory = !uniform(invoice) && (tuition(invoice) || /\btextbooks?\b/i.test(invoice.FeeName)) &&
      ['BillingCategory', 'StudentType', 'EnrollmentCategory', 'AcademicProgress'].every(field => !!savedValue(student, field)) &&
      categoryRules.length === 1 && !componentFees.some(fee => potentiallyApplies(fee, profile, student)) &&
      replacementRules.length === 1 && replacementInvoices.length === 1 &&
      replacementInvoices[0].Credit >= 0 && replacementInvoices[0].Credit <= replacementInvoices[0].Debit &&
      same(replacementRules[0].Currency, 'NGN') && same(replacementInvoices[0].Currency || 'NGN', 'NGN');
    const rules = differentCategory ? categoryRules : (differentGender ? genderRulesByType : differentClass ? classRulesByType : rulesByType).flat();
    let reason = '';
    if (tuition(invoice) && !differentCategory) reason = 'Tuition correction requires a verified billing-category mismatch and one correctly billed replacement tuition component.';
    else if (uniform(invoice) && !differentGender) reason = 'Uniform correction requires a saved Male or Female profile and one active fee rule proving that only the gender does not match.';
    else if (!differentCategory && !differentGender && !differentClass && !same(profile.EnrollmentCategory, 'New Intake')) reason = 'This correction requires one verified rule showing that the charge belongs to another class, or a returning-only charge on a New Intake profile. Check the saved class and fee rule.';
    else if (['ClassName', 'AcademicSession', 'Term'].some(field => !savedValue(student, field))) reason = 'Verify the saved class, session and term first.';
    else if (current.filter(row => same(row.FeeCode, invoice.FeeCode)).length !== 1) reason = 'Duplicate invoices for this component require individual finance review.';
    else if (invoices.filter(row => same(row.InvoiceId, invoice.InvoiceId)).length !== 1) reason = 'Duplicate invoice references require individual finance review.';
    else if (!differentCategory && !differentGender && !differentClass && rulesByType.some(matches => matches.length !== 1 || !same(matches[0].EnrollmentCategory, 'Returning'))) reason = savedType
      ? 'One active returning-only fee rule must confirm that this charge is obsolete.'
      : 'Student Type is not saved. One active returning-only fee rule must confirm this charge for each of day and boarding students.';
    else if (!differentCategory && !differentGender && !differentClass && !savedType && profiles.some(candidate => componentFees.some(fee => potentiallyApplies(fee, candidate, student))))
      reason = 'Student Type is not saved and this charge may still apply to a day or boarding New Intake student. Review the fee rules first.';
    else if (rules.some(rule => classificationFields.some(field => clean(rule[field]) && !['all', '*'].includes(lower(rule[field])) &&
      !savedValue(student, field)))) reason = 'Verify the billing classifications required by this fee rule first.';
    else if (rules.some(rule => invoice.Debit !== rule.Amount) || invoice.Credit < 0 || invoice.Credit > invoice.Debit ||
      !Number.isFinite(invoice.Debit) || !Number.isFinite(invoice.Credit)) reason = 'Invoice amounts differ from the configured charge; finance review is required.';
    else if (!same(invoice.Currency || invoice.currency || 'NGN', 'NGN') || rules.some(rule => !same(rule.Currency || 'NGN', 'NGN'))) reason = 'Foreign-currency charges require individual finance review.';
    else if (!same(invoice.BranchId || 'main', profile.BranchId) ||
      (clean(invoice.SchoolSection || invoice.schoolSection) && !same(invoice.SchoolSection || invoice.schoolSection, profile.SchoolSection))) reason = 'Invoice scope differs from the student profile.';
    return { invoiceId: invoice.InvoiceId, code: invoice.FeeCode, name: invoice.FeeName, amount: invoice.Debit,
      releasedCredit: invoice.Credit, outstandingRemoved: money(invoice.Debit - invoice.Credit), reason, ready: !reason,
      basis: differentCategory ? 'different-billing-category' : differentGender ? 'different-gender' : differentClass ? 'different-class' : 'new-intake', ruleClass: [...new Set(rules.map(rule => rule.ClassName))].join('; '),
      ...(differentCategory ? { replacementInvoiceId: replacementInvoices[0].InvoiceId, replacementCode: replacementRules[0].FeeCode } : {}),
      explanation: differentCategory ? `The original rule is for ${categoryRules[0].BillingCategory}; the saved category is ${profile.BillingCategory}. The matching ${replacementRules[0].FeeCode} charge is already correctly billed.`
        : differentGender ? `The saved uniform fee rule is for ${rules[0].Gender} students, but the student's saved gender is ${profile.Gender}.`
        : differentClass ? `The saved fee rule applies to ${[...new Set(rules.map(rule => rule.ClassName))].join('; ')}, but the student's saved class is ${profile.ClassName}.`
        : 'The saved fee rule is for returning students, but this student is classified as New Intake.' };
  });
  // Move only credit actually released by a wrong-gender uniform correction,
  // and only to an existing, undisputed correct uniform in this same period.
  let remainingUniformCredit = money(charges.filter(row => row.basis === 'different-gender').reduce((sum, row) => sum + row.releasedCredit, 0));
  const reallocations = [];
  for (const invoice of current.filter(row => uniform(row) && row.Debit > row.Credit).sort((a, b) => a.InvoiceId.localeCompare(b.InvoiceId))) {
    const component = preview.rows.find(row => same(row.code, invoice.FeeCode));
    if (remainingUniformCredit <= 0 || !component || component.conflict || component.expected <= 0 ||
      current.filter(row => same(row.FeeCode, invoice.FeeCode)).length !== 1 ||
      !fees.some(fee => active(fee.Active) && same(fee.FeeCode, invoice.FeeCode) && same(fee.Gender, profile.Gender) && feeMatchesAccountPeriod(fee, profile))) continue;
    if (invoice.Credit < 0 || invoice.Credit > invoice.Debit || !same(invoice.Currency || 'NGN', 'NGN')) continue;
    const amount = money(Math.min(remainingUniformCredit, invoice.Debit - invoice.Credit));
    reallocations.push({ invoiceId: invoice.InvoiceId, code: invoice.FeeCode, name: invoice.FeeName, amount,
      previousCredit: invoice.Credit, Credit: money(invoice.Credit + amount), Balance: money(invoice.Debit - invoice.Credit - amount) });
    remainingUniformCredit = money(remainingUniformCredit - amount);
  }
  // Reuse existing payment credit only, capped by the category allocations
  // released here. Other periods, disputed charges and future invoices stay put.
  const categoryCharges = charges.filter(row => row.ready && row.basis === 'different-billing-category');
  let remainingCategoryCredit = money(categoryCharges.reduce((sum, row) => sum + row.releasedCredit, 0));
  if (remainingCategoryCredit > 0) {
    const effective = data.invoices.map(row => {
      const charge = categoryCharges.find(item => same(item.invoiceId, normalizeInvoice(row).InvoiceId));
      return charge ? { ...row, FeeChargeReversed: 'YES', FeeChargeReversalId: 'preview-only',
        FeeChargeReversalAmount: charge.amount, FeeChargeReleasedCredit: charge.releasedCredit } : row;
    });
    for (const { invoice, applied } of calculateDueSchoolFeeCreditAllocations(effective, data.ledger).allocations) {
      if (remainingCategoryCredit <= 0) break;
      const component = preview.rows.find(row => same(row.code, invoice.FeeCode));
      if (!sameFinancialPeriod(invoice, profile.AcademicSession, profile.Term) || !component || component.conflict ||
        component.expected <= 0 || component.expected !== component.invoiced ||
        current.filter(row => same(row.FeeCode, invoice.FeeCode)).length !== 1 ||
        reallocations.some(row => same(row.invoiceId, invoice.InvoiceId)) ||
        !same(invoice.Currency || 'NGN', 'NGN')) continue;
      const amount = money(Math.min(applied, remainingCategoryCredit));
      reallocations.push({ invoiceId: invoice.InvoiceId, code: invoice.FeeCode, name: invoice.FeeName, amount,
        previousCredit: invoice.Credit, Credit: money(invoice.Credit + amount), Balance: money(invoice.Debit - invoice.Credit - amount),
        basis: 'billing-category', releasedFrom: categoryCharges.map(row => row.invoiceId) });
      remainingCategoryCredit = money(remainingCategoryCredit - amount);
    }
  }
  let reason = charges.find(row => row.reason)?.reason || (!charges.length ? 'No eligible obsolete school fee charges in this period.' : '');
  if (['invoices', 'ledger', 'payments'].some(key => (data[key] || []).some(row =>
    !same(row.BranchId || 'main', profile.BranchId) || (clean(row.SchoolSection || row.schoolSection) &&
      !same(row.SchoolSection || row.schoolSection, profile.SchoolSection))))) reason = 'Financial record scope differs from the student profile; finance review is required.';
  let baselineJournals = [];
  if (!reason && !candidateOnly) {
    try { baselineJournals = financialEvidence(profile, [...new Map([...candidates, ...current.filter(invoice =>
      reallocations.some(row => row.invoiceId === invoice.InvoiceId) || charges.some(row => row.replacementInvoiceId === invoice.InvoiceId))]
      .map(invoice => [lower(invoice.InvoiceId), invoice])).values()], data); }
    catch (error) { reason = error.message; }
  }
  const writeCount = 2 + ['feeItems', 'invoices', 'payments', 'ledger', 'journals'].reduce((sum, key) => sum + (data[key]?.length || 0), 0)
    + baselineJournals.length + charges.reduce((sum, row) => sum + 3 + (row.releasedCredit > 0 ? 1 : 0), 0) + reallocations.length * 2;
  if (!candidateOnly && writeCount > 450) reason = 'Too many source records for one safe correction; individual finance review is required.';
  const amount = money(charges.reduce((sum, row) => sum + row.amount, 0));
  const releasedCredit = money(charges.reduce((sum, row) => sum + row.releasedCredit, 0));
  const previewToken = candidateOnly ? '' : await financialPreviewFingerprint({ kind: 'obsolete-school-fees-v5-category',
    // Other students' no-op fee guards advance revisions. Keep all rule values
    // in the token; the commit still guards the freshly read fee revisions.
    profile, revision: student.__updateTime, charges, reallocations, feeItems: (data.feeItems || []).map(({ __updateTime, __createTime, ...rule }) => rule), invoices: data.invoices, ledger: data.ledger,
    payments: data.payments, summaries: data.accountSummaries, journals: data.journals }, ['feeItems', 'invoices', 'ledger', 'payments', 'summaries', 'journals']);
  return { ok: true, readOnly: true, candidateOnly, profile, charges, amount, releasedCredit, reallocations,
    conflicts: preview.rows.filter(row => row.conflict),
    expectedComponents: savedType ? preview.rows.filter(row => row.expected > 0).map(({ code, name, expected }) => ({ code, name, amount: expected })) : [],
    outstandingRemoved: money(amount - releasedCredit), expectedTotal: savedType ? preview.expectedTotal : null, postedTotal: preview.invoicedTotal,
    afterPostedTotal: money(preview.invoicedTotal - amount), ready: !reason, reason, previewToken, baselineJournals, writeCount,
    eligibilityNote: !savedType && !reason ? 'Student Type not required: these charges are obsolete for both day and boarding students. The incomplete profile is unchanged.' : '',
    rows: charges.map(row => ({ ...row, expected: 0, invoiced: row.amount, difference: -row.amount, invoiceIds: [row.invoiceId] })),
    message: 'Review only. Original charges and receipts remain in the audit trail. Reversals release existing allocations, not new money; no refund or payment is created.' };
}

export async function getObsoleteSchoolChargeReversalData(env, student, overrides = {}) {
  const db = { ...dbDefaults, ...overrides };
  const data = await db.getStudentBillingData(env, student, { section: student.SchoolSection });
  const journals = [];
  const preview = await obsoleteSchoolChargeReversalPlan(student, data, { candidateOnly: true });
  const targetIds = new Set(preview.reallocations.map(row => lower(row.invoiceId)));
  // Bound concurrency; financial history is scoped to one student, not the school.
  for (const invoice of data.invoices.map(normalizeInvoice).filter(row => supported(row) || targetIds.has(lower(row.InvoiceId)))) journals.push(...await db.queryCollectionPages(env, 'accountingJournals', {
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
    audit.exists = false;
    Object.assign(audit.data, { SourcePlatform: 'Web', ReversalId: reversalId, Before: invoice, After: fields,
      Amount: charge.amount, ReleasedCredit: charge.releasedCredit, AccountRef: plan.profile.AccountRef, SchoolSection: identity.section });
    writes.push(audit);
  }
  for (const transfer of plan.reallocations) {
    const invoice = data.invoices.find(row => same(normalizeInvoice(row).InvoiceId, transfer.invoiceId));
    if (!invoice?.__id || !invoice.__updateTime) fail('The receiving invoice lacks its database revision.');
    const fields = { Credit: transfer.Credit, Balance: transfer.Balance, Status: transfer.Balance <= 0 ? 'Paid' : 'Part Paid',
      UpdatedAt: stamp };
    const allocationField = transfer.basis === 'billing-category' ? 'FeeCorrectionAllocatedCredit' : 'UniformCorrectionAllocatedCredit';
    fields[allocationField] = money(Number(invoice[allocationField] || 0) + transfer.amount);
    // Keep legacy aliases consistent; normalizers prefer these where present.
    for (const [field, value] of [['paidAmount', transfer.Credit], ['PaidAmount', transfer.Credit], ['balanceAmount', transfer.Balance],
      ['BalanceAmount', transfer.Balance], ['status', fields.Status]]) if (Object.hasOwn(invoice, field)) fields[field] = value;
    updates.set(invoice.__id, fields);
    writes.push({ collectionPath: 'invoices', documentId: invoice.__id, updateTime: invoice.__updateTime, updateMask: Object.keys(fields), data: fields });
    const journal = buildSchoolInvoiceCreditAutomaticJournal(normalizeInvoice(invoice), transfer.previousCredit, transfer.Credit, date);
    if (!journal) fail('The fee credit transfer has no accounting journal.');
    journals.push({ ...journal, RecordedBy: actor.displayName || actor.username, Reason: clean(approvalReason), SchoolSection: identity.section });
    const audit = accountingAuditWrite(transfer.basis === 'billing-category' ? 'REALLOCATE BILLING CATEGORY PAYMENT CREDIT' : 'REALLOCATE UNIFORM PAYMENT CREDIT', 'Student invoice', transfer.invoiceId,
      { UserRole: actor.role, UserUsername: actor.username, RecordedBy: actor.displayName || actor.username, BranchId: identity.branch }, clean(approvalReason));
    audit.exists = false;
    Object.assign(audit.data, { SourcePlatform: 'Web', AccountRef: plan.profile.AccountRef, SchoolSection: identity.section,
      Amount: transfer.amount, Before: invoice, After: fields, ReleasedFrom: transfer.releasedFrom || plan.charges.filter(row => row.basis === 'different-gender').map(row => row.invoiceId) });
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
  return { ok: true, reversed: plan.charges.length, amount: plan.amount, releasedCredit: plan.releasedCredit,
    reallocatedCredit: money(plan.reallocations.reduce((sum, row) => sum + row.amount, 0)), summary,
    message: 'Verified incorrect school fee charges reversed. Original invoices, payments and receipts preserved. Released allocations were applied to verified correct fees where available; any remainder stays on the account. No new payment or refund created. Refresh Accounts and the parent portal.' };
}
