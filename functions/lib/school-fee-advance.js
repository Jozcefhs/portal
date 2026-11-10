const clean = value => String(value ?? '').trim();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const SCHOOL_FEES_ADVANCE_CODE = 'SCHOOL_FEES_ADVANCE';
export const SCHOOL_FEES_ADVANCE_TYPE = 'SchoolFeeAdvance';

export function isSchoolFeeAdvance(row = {}) {
  return clean(row.FeeCode || row.feeCode).toUpperCase() === SCHOOL_FEES_ADVANCE_CODE
    || clean(row.PaymentType || row.paymentType).toLowerCase() === SCHOOL_FEES_ADVANCE_TYPE.toLowerCase();
}

export function schoolFeeAdvanceAmount(input) {
  const raw = clean(input), text = raw.replace(/,/g, '');
  const amount = Number(text), cents = Math.round(amount * 100);
  if (!raw || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw) || !Number.isSafeInteger(cents) || cents <= 0
    || Math.abs(amount * 100 - cents) > 0.000001) {
    throw fail('Enter a positive school-fee advance amount with at most two decimal places.');
  }
  return cents / 100;
}

export function schoolFeeAdvanceItem(input) {
  return { FeeCode: SCHOOL_FEES_ADVANCE_CODE, FeeName: 'School fees paid in advance', FeeCategory: 'School Fee',
    PaymentType: SCHOOL_FEES_ADVANCE_TYPE, Amount: schoolFeeAdvanceAmount(input), Currency: 'NGN', AllowInstallment: 'NO' };
}

export function requireSchoolFeeAdvanceIntent(intent, settlement = {}) {
  if (!intent || !isSchoolFeeAdvance(intent) || clean(intent.FeeCode) !== SCHOOL_FEES_ADVANCE_CODE
    || clean(intent.PaymentType) !== SCHOOL_FEES_ADVANCE_TYPE) throw fail('The saved school-fee advance payment intent was not found.', 409);
  const path = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/students$/.exec(clean(intent.StudentScopePath));
  const legacyMain = clean(intent.StudentScopePath) === 'students' && clean(intent.BranchId) === 'main'
    && ['primary', 'secondary'].includes(clean(intent.SchoolSection));
  if ((!path && !legacyMain) || !clean(intent.StudentDocumentId) || !clean(intent.AccountRef)
    || (path && (path[1] !== clean(intent.BranchId) || path[2] !== clean(intent.SchoolSection)))) {
    throw fail('The saved advance is not bound to one student in one school branch.', 409);
  }
  const amount = schoolFeeAdvanceAmount(intent.Amount);
  if (clean(settlement.Reference) !== clean(intent.Reference)
    || clean(settlement.Currency).toUpperCase() !== clean(intent.Currency).toUpperCase()
    || clean(intent.Currency).toUpperCase() !== 'NGN'
    || schoolFeeAdvanceAmount(settlement.RequestedAmount) !== amount) {
    throw fail('The verified payment does not match the saved advance amount, currency or reference.', 409);
  }
  const expectedMethod = clean(intent.PaymentMethod).toLowerCase();
  if (!['paystack', 'direct bank transfer'].includes(expectedMethod)
    || clean(settlement.Gateway).toLowerCase() !== expectedMethod) throw fail('The payment route does not match its saved advance intent.', 409);
  const gross = schoolFeeAdvanceAmount(settlement.GrossAmount);
  const fee = Number(settlement.GatewayFee || 0);
  const net = schoolFeeAdvanceAmount(settlement.NetAmount);
  if (!Number.isFinite(fee) || fee < 0 || gross < amount || Math.round((gross - fee) * 100) !== Math.round(net * 100)
    || (expectedMethod === 'direct bank transfer' && (fee !== 0 || gross !== amount || net !== amount))) {
    throw fail('The verified advance settlement amounts do not reconcile.', 409);
  }
  return { amount, gross, fee, net, branchId: clean(intent.BranchId), schoolSectionAccess: clean(intent.SchoolSection),
    accountRef: clean(intent.AccountRef), studentScopePath: clean(intent.StudentScopePath), studentDocumentId: clean(intent.StudentDocumentId) };
}

const safeId = value => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
const data = value => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !key.startsWith('__')));
const money = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const condition = row => {
  if (!row) return { exists: false };
  if (!row.__updateTime) throw fail('The financial record version is unavailable. Retry the original payment reference.', 409);
  return { updateTime: row.__updateTime };
};

export function schoolFeeCreditReviewReason(history, identity, deps) {
  for (const record of [history.summary, identity]) {
    if (!record) continue;
    if (record.SchoolFeeCreditReviewRequired === true || record.requiresReview === true
      || record.BillingReview?.status === 'needs_review' || record.billingReview?.status === 'needs_review') {
      return clean(record.SchoolFeeCreditReviewReason || record.reviewWarning)
        || 'The existing fee bill requires finance review before credit is allocated.';
    }
  }
  const ledger = history.ledger.map(deps.normalizeLedger);
  const receipts = money(ledger.filter(deps.isAvailableSchoolCreditReceipt).reduce((sum, row) => sum + Number(row.Credit || 0), 0));
  const withdrawn = money(ledger.filter(row => clean(row.FeeCategory).toLowerCase() === 'account credit')
    .reduce((sum, row) => sum + Number(row.Debit || 0), 0));
  const applied = money(history.invoices.map(deps.normalizeInvoice).filter(deps.isSchoolFeeInvoice)
    .reduce((sum, row) => sum + Math.min(Number(row.Debit || row.Amount || 0), Number(row.Credit || 0)), 0));
  return applied + withdrawn > receipts + 0.005
    ? 'Existing allocations or credit withdrawals exceed the recorded school-fee receipts. Finance review is required.' : '';
}

function allocationWrites(history, scope, ledger, deps, now, reviewReason = '') {
  const today = now.slice(0, 10);
  const proposed = deps.calculateDueSchoolFeeCreditAllocations(history.invoices, ledger, today);
  // A new verified receipt is still recorded, but it must not silently repair
  // an old allocation deficit or settle charges already flagged for review.
  const allocation = reviewReason ? { allocations: [], remaining: money(proposed.remaining
    + proposed.allocations.reduce((sum, row) => sum + row.applied, 0)), held: true, reviewReason } : proposed;
  const changed = new Map(), writes = [];
  for (const item of allocation.allocations) {
    const invoice = item.invoice;
    const updated = { ...data(invoice), Credit: item.Credit, Balance: item.Balance, Status: item.Status,
      AutomaticAccountCreditApplied: money(Number(invoice.AutomaticAccountCreditApplied || 0) + item.applied), UpdatedAt: now };
    for (const key of ['PaidAmount', 'paidAmount']) if (Object.hasOwn(invoice, key)) updated[key] = item.Credit;
    for (const key of ['BalanceAmount', 'balanceAmount']) if (Object.hasOwn(invoice, key)) updated[key] = item.Balance;
    if (Object.hasOwn(invoice, 'status')) updated.status = item.Status;
    changed.set(clean(invoice.InvoiceId || invoice.__id), updated);
    writes.push({ collectionPath: 'invoices', documentId: clean(invoice.__id) || safeId(invoice.InvoiceId),
      data: updated, ...condition(invoice) });
    const journal = deps.buildSchoolInvoiceCreditAutomaticJournal(invoice, Number(invoice.Credit || 0), item.Credit, today);
    if (journal) writes.push({ collectionPath: 'accountingJournals', documentId: safeId(journal.JournalNo), exists: false, data: journal });
  }
  const invoices = history.invoices.map(row => changed.get(clean(row.InvoiceId || row.__id)) || row);
  const summary = { ...deps.calculateAccountFinancialSummary(invoices, ledger, scope.accountRef, today),
    ...deps.schoolFeeCreditQueueFields(allocation.remaining, invoices, today, deps.isSchoolFeeInvoice),
    SchoolFeeCreditReviewRequired: Boolean(reviewReason), SchoolFeeCreditReviewReason: reviewReason,
    StudentScopePath: scope.scopePath, StudentDocumentId: scope.studentDocumentId || '', UpdatedAt: now };
  writes.push(deps.schoolFeeCreditSummaryWrite(scope, summary, history.summary));
  return { allocation, writes, summary };
}

// Only verified gateway or approved transfer handlers call this function. The
// original server intent supplies identity; browser/provider metadata cannot.
export async function settleSchoolFeeAdvance(env, intent, settlement, deps) {
  const verified = requireSchoolFeeAdvanceIntent(intent, settlement);
  const reference = clean(intent.Reference), paymentId = safeId(reference);
  const existing = await deps.getDocument(env, 'payments', paymentId);
  if (existing) {
    if (!isSchoolFeeAdvance(existing) || clean(existing.Reference) !== reference
      || clean(existing.AccountRef) !== verified.accountRef || clean(existing.BranchId) !== verified.branchId
      || clean(existing.SchoolSection) !== verified.schoolSectionAccess
      || clean(existing.StudentScopePath) !== verified.studentScopePath || clean(existing.StudentDocumentId) !== verified.studentDocumentId
      || Number(existing.AdvanceRequestedAmount) !== verified.amount || Number(existing.AdvanceSettledAmount) !== verified.net
      || clean(existing.Currency) !== clean(intent.Currency) || clean(existing.ProcessingStatus) !== 'Completed') {
      throw fail('This payment reference already belongs to different or incomplete financial records. Finance review is required.', 409);
    }
    return { ok: true, duplicate: true, payment: data(existing), message: 'This school-fee advance was already recorded.' };
  }
  const student = await deps.getDocument(env, verified.studentScopePath, verified.studentDocumentId);
  if (!student || clean(student.AdmissionNo || student.AccountRef) !== verified.accountRef) throw fail('The saved student identity changed. Finance must review this payment before posting.', 409);
  const scope = deps.schoolFeeCreditScope({ ...student, __scopePath: verified.studentScopePath,
    BranchId: student.BranchId || verified.branchId, SchoolSection: student.SchoolSection || verified.schoolSectionAccess, AccountRef: verified.accountRef });
  if (scope.branchId !== verified.branchId || scope.schoolSectionAccess !== verified.schoolSectionAccess) throw fail('The advance student scope no longer matches.', 409);
  scope.studentDocumentId = verified.studentDocumentId;
  const now = deps.now?.() || new Date().toISOString();
  const paidAt = clean(settlement.PaidAt) || now;
  if (await deps.accountingPeriodIsClosed(env, paidAt)) throw fail('The payment date belongs to a closed accounting period; finance review is required.', 409);
  const history = await deps.readSchoolFeeCreditHistory(env, scope, deps);
  const reviewReason = schoolFeeCreditReviewReason(history, student, deps);
  const payment = { PaymentId: paymentId, Reference: reference, AccountRef: scope.accountRef,
    AccountRefNormalized: scope.accountRef.toLowerCase().replace(/[^a-z0-9]/g, ''), AdmissionNo: clean(student.AdmissionNo),
    ApplicationReference: clean(student.ApplicationReference), BranchId: scope.branchId, SchoolSection: scope.schoolSectionAccess,
    StudentScopePath: verified.studentScopePath, StudentDocumentId: verified.studentDocumentId,
    DisplayName: clean(student.DisplayName || student.ApplicantName || intent.DisplayName), ClassName: clean(student.ClassName || intent.ClassName),
    StudentType: clean(student.StudentType || intent.StudentType), BillingCategory: clean(student.BillingCategory) || 'Regular',
    ParentEmail: clean(intent.ParentEmail), AcademicSession: clean(intent.AcademicSession), Term: clean(intent.Term),
    FeeCode: SCHOOL_FEES_ADVANCE_CODE, FeeName: 'School fees paid in advance', FeeCategory: 'School Fee', PaymentType: SCHOOL_FEES_ADVANCE_TYPE,
    Amount: verified.net, GrossAmount: verified.gross, NetAmount: verified.net, GatewayFee: verified.fee,
    AdvanceRequestedAmount: verified.amount, AdvanceSettledAmount: verified.net, Currency: 'NGN',
    Method: clean(settlement.Method), Gateway: clean(settlement.Gateway), GatewayReference: clean(settlement.GatewayReference || reference),
    ReceiptNo: clean(settlement.ReceiptNo) || paymentId, PaidAt: paidAt, RecordedAt: now,
    RecordedBy: clean(settlement.RecordedBy) || 'Verified online payment', Status: 'Paid',
    ProcessingStatus: 'Completed', ProcessingVersion: 3, LedgerPostingStatus: 'Completed', InvoiceAllocationStatus: 'Completed',
    InvoicePostingStatus: 'Not Required', CompletedAt: now, Metadata: JSON.stringify({ paymentType: SCHOOL_FEES_ADVANCE_TYPE }) };
  const ledger = { ...payment, LedgerNo: `LED-${paymentId}`, Date: paidAt, EntryType: 'Payment',
    Debit: 0, Credit: verified.net, Description: payment.FeeName, Source: payment.Gateway };
  const prepared = allocationWrites(history, history.scope || scope, [...history.ledger, ledger], deps, now, reviewReason);
  if (prepared.allocation.allocations.length && await deps.accountingPeriodIsClosed(env, now.slice(0, 10))) throw fail('The credit-allocation date belongs to a closed accounting period.', 409);
  const receiptJournal = deps.buildPaymentAccountingJournal(payment, false, 'school');
  if (!receiptJournal) throw fail('The school-fee advance accounting entry could not be prepared.', 409);
  const writes = [
    { collectionPath: verified.studentScopePath, documentId: verified.studentDocumentId,
      data: { SchoolFeeCreditUpdatedAt: now }, updateMask: ['SchoolFeeCreditUpdatedAt'], ...condition(student) },
    { collectionPath: 'payments', documentId: paymentId, data: payment, exists: false },
    { collectionPath: 'ledger', documentId: safeId(ledger.LedgerNo), data: ledger, exists: false },
    { collectionPath: 'accountingJournals', documentId: safeId(receiptJournal.JournalNo), data: receiptJournal, exists: false },
    ...prepared.writes,
    { collectionPath: 'paymentIntents', documentId: paymentId, data: { ...data(intent), Status: 'Completed', CompletedAt: now,
      GrossAmount: verified.gross, GatewayFee: verified.fee, NetAmount: verified.net }, ...condition(intent) }
  ];
  if (verified.fee > 0) writes.push({ collectionPath: 'paymentGatewayCharges', documentId: safeId(`PAYSTACK-FEE-${reference}`), exists: false,
    data: { ChargeId: safeId(`PAYSTACK-FEE-${reference}`), Date: paidAt, Reference: reference, AccountRef: scope.accountRef,
      BranchId: scope.branchId, SchoolSection: scope.schoolSectionAccess, Amount: verified.fee, GrossCollection: verified.gross,
      NetSettlement: verified.net, Treatment: 'DeductedBeforeStudentCredit', Status: 'Recorded', Source: 'Paystack', CreatedAt: now } });
  await deps.batchCommitDocuments(env, writes);
  return { ok: true, payment, allocations: prepared.allocation.allocations.length, creditRemaining: prepared.allocation.remaining,
    creditAllocationDeferred: Boolean(reviewReason), reviewReason,
    message: reviewReason ? 'School-fee advance recorded. Allocation is on hold while the Accounts Office reviews the existing fee bill.'
      : 'School-fee advance recorded. Due school fees were paid first; remaining credit is saved for future school fees.' };
}

export async function applyManagedSchoolFeeCredit(env, identity, deps, options = {}) {
  const scope = deps.schoolFeeCreditScope(identity);
  const summary = options.history?.summary || options.summary || await deps.getDocument(env, 'accountSummaries', deps.schoolFeeCreditSummaryId(scope.accountRef, scope));
  if (!summary?.SchoolFeeCreditManaged) return null;
  const studentPath = scope.scopePath || clean(summary.StudentScopePath || summary.AccountScopePath);
  const studentId = scope.studentDocumentId || clean(summary.StudentDocumentId);
  if (!studentPath || !studentId) throw fail('The managed school-fee credit has no canonical student identity.', 409);
  const student = await deps.getDocument(env, studentPath, studentId);
  if (!student || clean(student.AdmissionNo || student.AccountRef) !== scope.accountRef) throw fail('The managed school-fee credit student changed.', 409);
  const currentScope = deps.schoolFeeCreditScope({ ...student, __scopePath: studentPath, BranchId: student.BranchId || scope.branchId,
    SchoolSection: student.SchoolSection || scope.schoolSectionAccess, AccountRef: scope.accountRef });
  if (currentScope.branchId !== scope.branchId || currentScope.schoolSectionAccess !== scope.schoolSectionAccess) throw fail('The managed school-fee credit student scope changed.', 409);
  const history = options.history || await deps.readSchoolFeeCreditHistory(env, scope, deps, { summary });
  const now = options.today ? `${options.today}T12:00:00.000Z` : (deps.now?.() || new Date().toISOString());
  const reviewReason = schoolFeeCreditReviewReason(history, student, deps);
  const prepared = allocationWrites(history, history.scope || scope, history.ledger, deps, now, reviewReason);
  if (!prepared.allocation.allocations.length && !deps.schoolFeeCreditSummaryChanged(summary, prepared.summary)
    && summary.SchoolFeeCreditReviewRequired === prepared.summary.SchoolFeeCreditReviewRequired
    && clean(summary.SchoolFeeCreditReviewReason) === reviewReason) return prepared.allocation;
  if (prepared.allocation.allocations.length && await deps.accountingPeriodIsClosed(env, now.slice(0, 10))) throw fail('The credit-allocation date belongs to a closed accounting period.', 409);
  await deps.batchCommitDocuments(env, [{ collectionPath: studentPath, documentId: studentId,
    data: { SchoolFeeCreditUpdatedAt: now }, updateMask: ['SchoolFeeCreditUpdatedAt'], ...condition(student) }, ...prepared.writes]);
  return prepared.allocation;
}
