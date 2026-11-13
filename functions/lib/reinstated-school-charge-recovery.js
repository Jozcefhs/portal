import { modulePermissionRole } from './module-authority.js';
import { batchCommitDocuments, getDocument, queryCollectionPages } from './firestore.js';
import { studentBillingIdentity, studentProfileValue } from './student-billing-profile.js';
import { financeMoney, financeDate, financeOperationId } from './accounting-mutation-guards.js';
import { financialPreviewFingerprint } from './financial-preview-fingerprint.js';
import { invoiceIsDue } from './account-credit.js';
import { getStudentBillingData, buildStudentBillingPreview, normalizeInvoice, normalizeFeeItem,
  normalizePayment, normalizeLedger, feeMatchesAccountPeriod, isSchoolFeeInvoice,
  isAvailableSchoolCreditReceipt, paymentCreditedAmount, sameFinancialPeriod,
  buildSchoolInvoiceChargeAccountingJournal, buildSchoolInvoiceCreditAccountingJournal,
  buildPaymentAccountingJournal, schoolInvoiceCreditJournalGap, journalLineSignature,
  calculateAccountFinancialSummary, calculateDueSchoolFeeCreditAllocations,
  accountingPeriodIsClosed, accountingAuditWrite, safeDocumentId, accountRefsFrom } from '../api/backend.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const same = (a, b) => lower(a) === lower(b);
const money = value => Math.round(Number(value || 0) * 100) / 100;
const active = value => ['yes', 'true', '1'].includes(lower(value));
const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
const defaults = { getStudentBillingData, getDocument, queryCollectionPages, batchCommitDocuments, accountingPeriodIsClosed };
const closed = row => ['reversed', 'void', 'voided', 'cancelled', 'canceled'].includes(lower(row.Status));
const kind = row => /\btextbooks?\b/i.test(clean(row.FeeName)) ? 'textbook'
  : /\byearbook\b/i.test(clean(row.FeeName)) ? 'yearbook' : '';
const listKeys = ['feeItems', 'invoices', 'payments', 'ledger', 'accountSummaries', 'journals', 'accountingAdjustments', 'billingCategoryDiscounts'];

function sourceScope(row, profile, { account = true } = {}) {
  if (!same(row.BranchId || row.branchId || 'main', profile.BranchId) ||
    clean(row.SchoolSection || row.schoolSection) && !same(row.SchoolSection || row.schoolSection, profile.SchoolSection)) {
    fail('A source record belongs to another branch or school section.');
  }
  if (!account) return;
  const references = new Set(accountRefsFrom(profile).map(lower));
  const ref = clean(row.AccountRef || row.accountRef || row.AdmissionNo || row.admissionNo);
  if (!ref || !references.has(lower(ref)) || clean(row.AdmissionNo || row.admissionNo) &&
    !same(row.AdmissionNo || row.admissionNo, profile.AccountRef)) fail('A source record has an ambiguous account identity.');
}

function validateSources(student, data, profile) {
  for (const key of listKeys) {
    const rows = data[key] || [];
    if (!Array.isArray(rows)) fail(`The ${key} source is incomplete.`);
    if (new Set(rows.map(row => clean(row.__name || row.__id))).size !== rows.length) fail(`Duplicate ${key} documents require finance review.`);
    for (const row of rows) {
      if (!clean(row.__id) || !clean(row.__updateTime)) fail(`A ${key} source lacks its database revision.`);
      for (const field of ['Amount', 'amount', 'Debit', 'debit', 'Credit', 'credit', 'PaidAmount', 'paidAmount',
        'GrossAmount', 'grossAmount', 'NetAmount', 'netAmount', 'FeeChargeReversalAmount', 'FeeChargeReleasedCredit']) {
        if (Object.hasOwn(row, field)) financeMoney(row[field], `Source ${field}`);
      }
      if (key === 'feeItems') {
        if (!same(row.BranchId || row.branchId || 'main', profile.BranchId)) fail('A fee rule belongs to another branch.');
      } else sourceScope(row, profile, { account: !['journals', 'billingCategoryDiscounts'].includes(key) });
    }
  }
  if (!student.__id || !student.__updateTime) fail('The student profile lacks its database revision.');
  if (data.billingCategoryDiscounts?.length) fail('A discounted bill requires the dedicated billing review.');
  const invoiceIds = data.invoices.map(row => lower(normalizeInvoice(row).InvoiceId));
  if (invoiceIds.some(id => !id) || new Set(invoiceIds).size !== invoiceIds.length) fail('Duplicate invoice references require finance review.');
  const journalIds = (data.journals || []).map(row => lower(row.JournalNo || row.__id));
  if (new Set(journalIds).size !== journalIds.length) fail('Duplicate journal references require finance review.');
}

// Establish the complete existing receipt/charge/allocation chain before reusing
// any credit. Missing original baselines can be added in the same guarded commit;
// an approved reversal itself must already exist and is never reconstructed.
function financialEvidence(data, profile) {
  const journals = data.journals || [], baseline = new Map();
  const requireJournal = (expected, { required = false } = {}) => {
    if (!expected) fail('A financial source cannot be traced to an accounting journal.');
    const found = journals.find(row => same(row.JournalNo || row.__id, expected.JournalNo));
    if (!found) {
      if (required) fail('The original approved charge reversal journal is missing.');
      baseline.set(expected.JournalNo, expected);
    } else if (lower(found.Status) !== 'posted' || journalLineSignature(found.Lines) !== journalLineSignature(expected.Lines) ||
      !same(found.Source, expected.Source) || !same(found.SourceId, expected.SourceId) ||
      !same(found.BranchId || 'main', expected.BranchId) || !same(found.Date, expected.Date) ||
      !same(found.AcademicSession, expected.AcademicSession) || !same(found.Term, expected.Term)) {
      fail('An existing financial journal differs from its source.');
    }
    return found;
  };
  for (const raw of data.invoices) {
    const invoice = normalizeInvoice(raw);
    if (!isSchoolFeeInvoice(invoice)) continue;
    if (closed(invoice) && raw.FeeChargeReversed !== 'YES') fail('A cancelled school invoice needs separate finance review.');
    financeDate(raw.CreatedAt || raw.createdAt || raw.Date, 'Original invoice date', { allowTimestamp: true });
    if (!same(raw.Currency || raw.currency || 'NGN', 'NGN') || invoice.Credit > invoice.Debit) fail('An invoice currency or allocation requires finance review.');
    const charge = buildSchoolInvoiceChargeAccountingJournal(raw);
    requireJournal(charge);
    if (raw.FeeChargeReversed === 'YES') {
      const date = financeDate(raw.FeeChargeReversedAt, 'Original reversal date', { allowTimestamp: true });
      const reversal = requireJournal({ ...charge, JournalNo: `SYS-${raw.FeeChargeReversalId}`, Date: date,
        Source: 'Student Invoice Charge Reversal', Lines: charge.Lines.map(line => ({ ...line, Debit: line.Credit, Credit: line.Debit })) }, { required: true });
      if (!same(reversal.ReversalId, raw.FeeChargeReversalId) || !same(reversal.ReversesJournalNo, charge.JournalNo)) fail('The reversal does not identify its original charge.');
      if (Number(raw.FeeChargeReleasedCredit) > 0) {
        const released = Number(raw.FeeChargeReleasedCredit);
        const release = requireJournal({ ...charge, JournalNo: `SYS-${raw.FeeChargeReversalId}-RELEASE`, Date: date,
          Source: 'Student Invoice Credit Release', Lines: [
            { AccountCode: '1100', Debit: released, Credit: 0 }, { AccountCode: '2310', Debit: 0, Credit: released }
          ] }, { required: true });
        if (!same(release.ReversalId, raw.FeeChargeReversalId)) fail('The released allocation does not identify the approved reversal.');
      }
      const adjustment = (data.accountingAdjustments || []).filter(row => same(row.AdjustmentNo, raw.FeeChargeReversalId));
      if (adjustment.length !== 1 || !same(adjustment[0].Status, 'Posted') || !same(adjustment[0].Type, 'Student charge reversal') ||
        !same(adjustment[0].Reference, invoice.InvoiceId) || !same(adjustment[0].JournalNo, reversal.JournalNo) ||
        Number(adjustment[0].Amount) !== Number(raw.FeeChargeReversalAmount) || Number(adjustment[0].ReleasedCredit) !== Number(raw.FeeChargeReleasedCredit)) {
        fail('The approved reversal adjustment does not match the retained invoice.');
      }
    }
    const gap = schoolInvoiceCreditJournalGap(raw, journals);
    if (gap.invalidPostedJournalIds?.length || gap.missing < -0.005 || gap.missing > 0.005 && gap.baselineExists) fail('Existing invoice allocations do not reconcile to their journals.');
    if (gap.missing > 0.005) requireJournal(buildSchoolInvoiceCreditAccountingJournal(raw, { amount: gap.missing }));
  }
  const ledger = data.ledger.map(normalizeLedger);
  // Transfers and payment corrections need their own provenance checks. Do not
  // guess whether a historical debit freed or removed a school receipt.
  if (ledger.some(row => same(row.FeeCategory, 'Account Credit') && row.Debit > 0) ||
    [...data.payments, ...data.ledger].some(row => Number(row.CorrectionTotal || row.PaymentCorrectionTotal || 0) > 0)) {
    fail('A corrected payment or credit action requires separate finance review.');
  }
  const receipts = data.payments.map(normalizePayment).filter(isAvailableSchoolCreditReceipt);
  const deposits = ledger.filter(row => isAvailableSchoolCreditReceipt(row) && row.Credit > 0);
  const seen = new Set();
  for (const payment of receipts) {
    const ref = clean(payment.Reference || payment.GatewayReference || payment.PaymentId);
    if (!ref || seen.has(lower(ref))) fail('Duplicate or untraceable payment references require finance review.');
    seen.add(lower(ref));
    if (!['paid', 'success', 'successful', 'completed'].includes(lower(payment.Status)) || !same(payment.Currency || 'NGN', 'NGN')) fail('A school receipt is not confirmed paid in NGN.');
    financeDate(payment.PaidAt || payment.PaymentDate || payment.Date, 'Original receipt date', { allowTimestamp: true });
    const matching = deposits.filter(row => same(row.Reference, ref));
    if (matching.length !== 1 || matching[0].Credit !== paymentCreditedAmount(payment) || matching[0].Debit !== 0) fail('The school receipt and ledger do not agree.');
    requireJournal(buildPaymentAccountingJournal(payment));
  }
  if (deposits.length !== receipts.length || deposits.some(row => !seen.has(lower(row.Reference)))) fail('Available school credit contains an untraceable ledger entry.');
  const received = money(deposits.reduce((sum, row) => sum + row.Credit, 0));
  const allocated = money(data.invoices.map(normalizeInvoice).filter(isSchoolFeeInvoice).reduce((sum, row) => sum + row.Credit, 0));
  if (allocated > received) fail('Existing allocations exceed confirmed school receipts.');
  return { baselineJournals: [...baseline.values()], received, allocated };
}

export async function reinstatedSchoolChargeRecoveryPlan(student, data, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const identity = studentBillingIdentity(student);
  let profile = { AccountRef: student.AdmissionNo || student.AccountRef, BranchId: identity.branch, SchoolSection: identity.section };
  let preview, charges = [], baselineJournals = [], invoicesToCreate = [], summaryBefore, summaryAfter;
  let reason = '', recoveryId = '', allocatedCredit = 0, noOp = false;
  const remainingMissing = [];
  try {
    financeDate(today, 'Recovery date');
    const required = ['AdmissionNo', 'ClassName', 'BillingCategory', 'EnrollmentCategory', 'AcademicProgress', 'AcademicSession', 'Term'];
    if (required.some(field => !studentProfileValue(student, field)) ||
      !same(student.EnrollmentCategory, 'New Intake') || clean(student.AccountRef) && !same(student.AccountRef, student.AdmissionNo) ||
      !['primary', 'secondary'].includes(identity.section)) fail('An unambiguous New Intake identity, class, category and academic period are required.');
    preview = await buildStudentBillingPreview(student, data);
    profile = { ...preview.profile, AdmissionNo: student.AdmissionNo, ApplicationReference: student.ApplicationReference || '',
      StudentType: studentProfileValue(student, 'StudentType'), Gender: studentProfileValue(student, 'Gender') };
    if (!same(profile.AccountRef, student.AdmissionNo) || !same(profile.BranchId, identity.branch) || !same(profile.SchoolSection, identity.section)) fail('The billing profile does not match the saved student scope.');
    validateSources(student, data, profile);
    const invoices = data.invoices.map(normalizeInvoice);
    const current = invoices.filter(row => sameFinancialPeriod(row, profile.AcademicSession, profile.Term));
    const reversed = current.filter(row => row.FeeChargeReversed === 'YES' && kind(row));
    if (!reversed.length) fail('No retained textbook or yearbook reversal supports this recovery.');
    const used = new Set();
    for (const component of preview.rows) {
      const matches = current.filter(row => same(row.FeeCode, component.code) && !closed(row));
      if (matches.length === 1 && matches[0].Debit === component.expected && component.expected > 0) continue;
      if (!matches.length && component.expected === 0) continue;
      if (matches.length || component.expected <= 0) fail(`Unresolved posted charge ${component.code} requires separate finance review.`);
      const fees = data.feeItems.map(normalizeFeeItem).filter(row => same(row.FeeCode, component.code) && active(row.Active) &&
        active(row.PayableOnline || 'YES') && isSchoolFeeInvoice(row) && feeMatchesAccountPeriod(row, profile) &&
        (!clean(row.SchoolSection || row.schoolSection) || same(row.SchoolSection || row.schoolSection, profile.SchoolSection)));
      if (fees.length === 1 && !kind(fees[0])) { remainingMissing.push(component); continue; }
      if (fees.length !== 1 || fees[0].Amount !== component.expected || !same(fees[0].Currency, 'NGN') || fees[0].BillingDiscount) {
        fail(`The missing ${component.code} charge is outside this recovery or its current rule is ambiguous.`);
      }
      const fee = fees[0];
      if (!profile.StudentType || !profile.Gender) {
        const possibleProfiles = (profile.StudentType ? [profile.StudentType] : ['Day Student', 'Boarding Student']).flatMap(StudentType =>
          (profile.Gender ? [profile.Gender] : ['Male', 'Female']).map(Gender => ({ ...profile, StudentType, Gender })));
        // A missing classification is not a declaration. Every possible saved
        // type/gender must select this same unique policy, including alternatives
        // with another fee code. Never fill the missing profile fields.
        if (possibleProfiles.some(candidate => {
          const alternatives = data.feeItems.map(normalizeFeeItem).filter(row => active(row.Active) && active(row.PayableOnline || 'YES') &&
            isSchoolFeeInvoice(row) && same(row.FeeName, fee.FeeName) && kind(row) === kind(fee) && feeMatchesAccountPeriod(row, candidate) &&
            (!clean(row.SchoolSection || row.schoolSection) || same(row.SchoolSection || row.schoolSection, profile.SchoolSection)));
          return alternatives.length !== 1 || alternatives[0].__id !== fee.__id || alternatives[0].Amount !== fee.Amount;
        })) fail('The missing Student Type or Gender can change this fee; complete that classification before recovering it.');
      }
      const histories = current.filter(row => same(row.FeeCode, fee.FeeCode));
      if (histories.some(row => row.FeeChargeReversed !== 'YES')) fail('An existing cancelled or legacy invoice prevents automatic rebilling.');
      const sources = reversed.filter(row => same(row.FeeCode, fee.FeeCode) || kind(row) === kind(fee) && same(row.FeeName, fee.FeeName));
      if (!sources.length && !histories.length) { remainingMissing.push(component); continue; }
      if (sources.length !== 1 || used.has(sources[0].InvoiceId)) fail('The current charge has no unique, unused matching reversal.');
      const source = sources[0];
      if (same(fee.FeeCode, source.FeeCode)) {
        if (!(Date.parse(fee.UpdatedAt || fee.CreatedAt) > Date.parse(source.FeeChargeReversedAt))) fail('The current fee rule does not prove a change after the approved reversal.');
      } else if (preview.rows.some(row => same(row.code, source.FeeCode) && row.expected > 0)) {
        fail('The old fee code still applies; a different-code replacement would duplicate the current policy.');
      }
      used.add(source.InvoiceId);
      charges.push({ code: fee.FeeCode, name: fee.FeeName, amount: fee.Amount, dueDate: fee.DueDate || '',
        sourceInvoiceId: source.InvoiceId, priorInvoiceIds: [source.InvoiceId], reversalId: source.FeeChargeReversalId, feeDocumentId: fee.__id });
    }
    charges.sort((a, b) => a.code.localeCompare(b.code));
    if (!charges.length) { noOp = true; fail('No supported billing gaps remain; no recovery is needed.'); }
    const evidence = financialEvidence(data, profile);
    baselineJournals = evidence.baselineJournals;
    recoveryId = await financeOperationId('FEE-RECOVERY', identity.key, profile.AcademicSession, profile.Term,
      charges.map(row => [lower(row.code), row.sourceInvoiceId, row.reversalId]));
    for (const charge of charges) {
      const InvoiceId = await financeOperationId('INV-RECOVERY', identity.key, profile.AcademicSession, profile.Term,
        lower(charge.code), charge.sourceInvoiceId, charge.reversalId);
      if (invoices.some(row => same(row.InvoiceId, InvoiceId))) fail('The deterministic recovery invoice already exists. Refresh the review.');
      invoicesToCreate.push({ ...profile, InvoiceId, FeeCode: charge.code, FeeName: charge.name, FeeCategory: 'School Fee',
        Currency: 'NGN', Amount: charge.amount, Debit: charge.amount, Credit: 0, Balance: charge.amount, Status: 'Unpaid',
        DueDate: charge.dueDate, RecoveryId: recoveryId, RecoveryKind: 'Reinstated textbook/yearbook charge',
        ReplacesInvoiceIds: [charge.sourceInvoiceId], ReinstatedFromReversalIds: [charge.reversalId] });
    }
    // Use the established allocator against the full history, reserving earlier
    // and future allocations. Only the new, currently due invoices are changed.
    const allocations = calculateDueSchoolFeeCreditAllocations([...data.invoices, ...invoicesToCreate], data.ledger, today).allocations;
    invoicesToCreate = invoicesToCreate.map(row => {
      const allocation = allocations.find(item => same(item.invoice.InvoiceId, row.InvoiceId));
      if (!allocation || !invoiceIsDue(row, today)) return row;
      allocatedCredit = money(allocatedCredit + allocation.applied);
      return { ...row, Credit: allocation.Credit, Balance: allocation.Balance, Status: allocation.Status };
    });
    summaryBefore = calculateAccountFinancialSummary(data.invoices, data.ledger, profile.AccountRef, today);
    summaryAfter = calculateAccountFinancialSummary([...data.invoices, ...invoicesToCreate], data.ledger, profile.AccountRef, today);
    const saved = data.accountSummaries.filter(row => same(row.__id, safeDocumentId(profile.AccountRef)));
    if (saved.length > 1) fail('The account summary identity is ambiguous.');
    if (saved.length && ['TotalDebit', 'TotalCredit', 'AccountCreditDebits', 'OutstandingBalance', 'CreditBalance']
      .some(field => money(saved[0][field] || 0) !== money(summaryBefore[field]))) fail('The saved account summary differs from the current financial evidence.');
    if (saved.length) {
      if (Object.hasOwn(saved[0], 'WalletBalance')) summaryAfter.WalletBalance = saved[0].WalletBalance;
      else delete summaryAfter.WalletBalance;
    }
  } catch (error) { reason = error.message; }
  const previewToken = await financialPreviewFingerprint({ kind: 'reinstated-school-charges-v1', today, student, profile, charges,
    ...Object.fromEntries(listKeys.map(key => [key, (data[key] || []).map(row => key === 'feeItems' ? (({ __updateTime, __createTime, ...rule }) => rule)(row) : row)])) }, listKeys);
  const relevantCodes = new Set([...(preview?.rows || []).map(row => lower(row.code)), ...data.invoices.map(row => lower(row.FeeCode || row.feeCode))]);
  const guardedFeeIds = data.feeItems.filter(row => relevantCodes.has(lower(row.FeeCode || row.feeCode)) ||
    kind(normalizeFeeItem(row))).map(row => row.__id);
  return { ok: true, readOnly: true, profile, today, ready: !reason, noOp, reason, recoveryId, previewToken,
    expectedTotal: preview?.expectedTotal ?? null, postedTotal: preview?.invoicedTotal ?? null,
    charges, amount: money(charges.reduce((sum, row) => sum + row.amount, 0)), invoicesToCreate,
    allocatedCredit, summaryBefore, summaryAfter, baselineJournals, guardedFeeIds, remainingMissing,
    afterPostedTotal: preview ? money(preview.invoicedTotal + charges.reduce((sum, row) => sum + row.amount, 0)) : null,
    existingCredit: summaryBefore?.CreditBalance ?? null, creditBefore: summaryBefore?.CreditBalance ?? null,
    creditToApply: allocatedCredit, afterCredit: summaryAfter?.CreditBalance ?? null, creditAfter: summaryAfter?.CreditBalance ?? null,
    afterOutstanding: summaryAfter?.OutstandingBalance ?? null,
    message: 'Review only. New charges retain links to approved reversals. Original invoices, payments, receipts and wallets are preserved.' };
}

export async function getReinstatedSchoolChargeRecoveryData(env, student, overrides = {}) {
  const db = { ...defaults, ...overrides };
  const data = await db.getStudentBillingData(env, student, { section: studentBillingIdentity(student).section });
  const journals = [], adjustments = [];
  for (const invoice of data.invoices.map(normalizeInvoice).filter(isSchoolFeeInvoice)) {
    journals.push(...await db.queryCollectionPages(env, 'accountingJournals', {
      filters: [{ field: 'SourceId', op: '==', value: invoice.InvoiceId }], pageSize: 250, maxRows: 2000 }));
    if (invoice.FeeChargeReversed === 'YES') {
      const adjustment = await db.getDocument(env, 'accountingAdjustments', safeDocumentId(invoice.FeeChargeReversalId));
      if (adjustment) adjustments.push(adjustment);
    }
  }
  for (const receipt of data.payments.map(normalizePayment).filter(isAvailableSchoolCreditReceipt)) {
    const journal = buildPaymentAccountingJournal(receipt);
    if (journal) {
      const stored = await db.getDocument(env, 'accountingJournals', safeDocumentId(journal.JournalNo));
      if (stored) journals.push(stored);
    }
  }
  return { ...data, journals: [...new Map(journals.map(row => [row.__name || row.__id, row])).values()],
    accountingAdjustments: [...new Map(adjustments.map(row => [row.__name || row.__id, row])).values()] };
}

export async function recoverReinstatedSchoolCharges(env, student, token, actor, approvalReason, overrides = {}) {
  const identity = studentBillingIdentity(student), db = { ...defaults, ...overrides };
  if (modulePermissionRole(actor, 'accounts') !== 'Super Admin' || actor.edition !== 'school' || actor.subscriptionReadOnly || actor.subscriptionActive === false ||
    !same(actor.branchId, identity.branch) || !['accounts', 'students'].every(section => actor.allowedSections?.includes(section)) ||
    !same(actor.schoolSectionAccess || 'All', 'All') && !same(actor.schoolSectionAccess, identity.section) ||
    !clean(actor.username) || !clean(approvalReason) || clean(approvalReason).length > 500) {
    throw Object.assign(new Error('Writable Super Admin approval in this school scope and a reason are required.'), { status: 403 });
  }
  const data = await getReinstatedSchoolChargeRecoveryData(env, student, db);
  const plan = await reinstatedSchoolChargeRecoveryPlan(student, data);
  if (!plan.ready || !token || token !== plan.previewToken) fail(plan.reason || 'Financial records changed after preview. Review again.');
  const stamp = new Date().toISOString(), date = stamp.slice(0, 10);
  if (await db.accountingPeriodIsClosed(env, date)) fail('The recovery posting period is closed.');
  for (const journal of plan.baselineJournals) if (await db.accountingPeriodIsClosed(env, journal.Date)) fail('A missing source journal belongs to a closed period.');
  const writes = [], guard = (row, collectionPath) => {
    // Guard the raw persisted value, never a normalized effective zero from a
    // reversed invoice. All original amounts and paid allocations stay intact.
    const field = ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef', 'InvoiceId', 'invoiceId', 'JournalNo', 'FeeCode', 'feeCode', 'AdjustmentNo', 'Name']
      .find(key => Object.hasOwn(row, key));
    if (!field || !row.__id || !row.__updateTime) fail('A financial source lacks a safe revision guard.');
    writes.push({ collectionPath, documentId: row.__id, updateTime: row.__updateTime, updateMask: [field], data: { [field]: row[field] } });
  };
  guard(student, student.__scopePath || 'students');
  for (const key of ['feeItems', 'invoices', 'payments', 'ledger', 'journals', 'accountingAdjustments']) {
    for (const row of data[key]) if (key !== 'feeItems' || plan.guardedFeeIds.includes(row.__id)) guard(row, key === 'journals' ? 'accountingJournals' : key);
  }
  const newInvoices = plan.invoicesToCreate.map(row => ({ ...row, Date: stamp, CreatedAt: stamp, UpdatedAt: stamp,
    RecordedBy: actor.displayName || actor.username, Source: 'Reviewed reinstated school charge', RecoveryReason: clean(approvalReason) }));
  const newJournals = [...plan.baselineJournals];
  for (const invoice of newInvoices) {
    writes.push({ collectionPath: 'invoices', documentId: invoice.InvoiceId, exists: false, data: invoice });
    newJournals.push(buildSchoolInvoiceChargeAccountingJournal(invoice));
    if (invoice.Credit > 0) newJournals.push(buildSchoolInvoiceCreditAccountingJournal(invoice, {
      amount: invoice.Credit, date, journalNo: `SYS-INVCREDIT-RECOVERY-${invoice.InvoiceId}` }));
  }
  for (const journal of newJournals) writes.push({ collectionPath: 'accountingJournals', documentId: safeDocumentId(journal.JournalNo), exists: false,
    data: { ...journal, ...(newInvoices.some(row => row.InvoiceId === journal.SourceId) ? { RecoveryId: plan.recoveryId,
      SchoolSection: identity.section, RecordedBy: actor.displayName || actor.username, Reason: clean(approvalReason) } : {}) } });
  const summaryId = safeDocumentId(plan.profile.AccountRef);
  const snapshot = await db.getDocument(env, 'accountSummaries', summaryId);
  const before = data.accountSummaries.find(row => row.__id === summaryId);
  if ((snapshot?.__updateTime || '') !== (before?.__updateTime || '')) fail('The account summary changed after preview.');
  if (snapshot) sourceScope(snapshot, plan.profile);
  const summary = calculateAccountFinancialSummary([...data.invoices, ...newInvoices], data.ledger, plan.profile.AccountRef, date);
  if (snapshot) {
    if (Object.hasOwn(snapshot, 'WalletBalance')) summary.WalletBalance = snapshot.WalletBalance;
    else delete summary.WalletBalance;
  }
  const summaryData = { ...summary, BranchId: identity.branch, SchoolSection: identity.section,
    LinkedReferences: accountRefsFrom(student).filter(ref => !same(ref, plan.profile.AccountRef)) };
  if (snapshot) delete summaryData.WalletBalance;
  writes.push({ collectionPath: 'accountSummaries', documentId: summaryId,
    ...(snapshot ? { updateTime: snapshot.__updateTime, updateMask: Object.keys(summaryData) } : { exists: false }), data: summaryData });
  const audit = accountingAuditWrite('RECOVER REINSTATED SCHOOL FEE CHARGES', 'Student account', plan.profile.AccountRef,
    { UserRole: actor.role, UserUsername: actor.username, RecordedBy: actor.displayName || actor.username, BranchId: identity.branch }, clean(approvalReason), stamp);
  audit.documentId = `AUD-${plan.recoveryId}`; audit.exists = false;
  Object.assign(audit.data, { AuditId: audit.documentId, SourcePlatform: 'Web', RecoveryId: plan.recoveryId,
    SchoolSection: identity.section, AccountRef: plan.profile.AccountRef, Amount: plan.amount, AllocatedCredit: plan.allocatedCredit,
    Before: { Summary: plan.summaryBefore, SourceInvoices: data.invoices.filter(row => plan.charges.some(charge => same(charge.sourceInvoiceId, normalizeInvoice(row).InvoiceId))) },
    CreatedInvoiceIds: newInvoices.map(row => row.InvoiceId), After: summary });
  writes.push(audit);
  if (writes.length > 450 || new Set(writes.map(row => `${row.collectionPath}/${row.documentId}`)).size !== writes.length) fail('The recovery cannot fit one unambiguous atomic commit.');
  await db.batchCommitDocuments(env, writes, { literalDocumentIds: true });
  return { ok: true, recoveryId: plan.recoveryId, created: newInvoices.length, amount: plan.amount,
    allocatedCredit: plan.allocatedCredit, summary, invoiceIds: newInvoices.map(row => row.InvoiceId),
    message: 'Reviewed textbook/yearbook charges posted and existing school receipts applied. Original invoices, reversals, payments, receipts and wallet activity preserved.' };
}
