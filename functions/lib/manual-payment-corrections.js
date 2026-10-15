import { batchCommitDocuments, getDocument, queryCollection, queryCollectionPages, listCollectionForReport } from './firestore.js';
import { searchStudentPaymentHistory } from './manual-payment-search.js';
import { getAccountingChartRows } from './accounting-reference-cache.js';
import { financeFailure, financeMoney, financeOperationId, financeWrite } from './accounting-mutation-guards.js';
import { validateRequisitionPosting } from './requisition-posting.js';
import { assertManualPaymentScope, bindManualPaymentIdentity } from './manual-payment-scope.js';
import { verifyStaffApprovalPassword } from './staff-auth.js';
import { findStudentByAccountRef, walletAccountPayload, queryAccountRows, isAvailableSchoolCreditReceipt,
  isSchoolFeeInvoice, schoolInvoiceCreditJournalGap, calculateAccountFinancialSummary, normalizeInvoice, normalizeLedger } from '../api/backend.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const safeId = value => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/-+/g, '-').slice(0, 140);
const fail = (message, status = 409) => { throw financeFailure(message, status); };
const cents = value => Math.round(financeMoney(value, 'Amount', { defaultValue: 0 }) * 100);
const roles = new Set(['Accounts Officer', 'Super Admin', 'Director']);
const patch = (collection, row, fields) => ({ ...financeWrite(collection, row.__id, fields, row), updateMask: Object.keys(fields) });
const version = row => { if (!row?.__id || !row.__updateTime) fail('A record has no current database version. Refresh before correcting it.'); return row; };

export function correctionScope(user) {
  if (!clean(user.username) || user.edition !== 'school' || !roles.has(user.assignedRole || user.role)
    || !(user.allowedSections || []).includes('accounts')) fail('Only authorised school Accounts users may correct manual payments.', 403);
  const branch = lower(user.branchId), section = lower(user.schoolSectionAccess || 'All');
  if (!branch || branch === 'all' || !['all', 'primary', 'secondary'].includes(section)) fail('Select one working branch and an authorised school section.', 403);
  return { branchId: branch, schoolSectionAccess: section === 'all' ? '' : section, strictReads: true };
}

async function receipt(env, body, scope, io) {
  const reference = clean(body.Reference);
  if (!reference || reference.length > 180) fail('Enter the original payment reference.', 400);
  const rows = await io.query(env, 'payments', { filters: [{ field: 'Reference', op: '==', value: reference }], pageSize: 3, maxRows: 3 });
  if (rows.length !== 1) fail(rows.length ? 'This reference is ambiguous. Accounts must review the duplicate receipts.' : 'No payment with that reference was found.', 404);
  const payment = version(rows[0]);
  assertManualPaymentScope(payment, scope, 'Payment');
  if (lower(payment.Gateway) !== 'manual' || lower(payment.Status) !== 'paid' || Number(payment.GatewayFee || 0) !== 0
    || (payment.ProcessingStatus && lower(payment.ProcessingStatus) !== 'completed')) fail('Only completed manual payments without gateway charges can be corrected here. Online payments require their own refund process.');
  const wallet = lower(payment.FeeCategory) === 'wallet' || clean(payment.FeeCode).toUpperCase() === 'WALLET_TOPUP';
  if (!wallet && (!isAvailableSchoolCreditReceipt(payment) || /acceptance/i.test(`${payment.FeeCode} ${payment.FeeName}`))) fail('This screen supports student wallet top-ups and school-fee receipts, not admission or earmarked service payments.');
  const student = version(await io.student(env, payment.AccountRef, { ...scope,
    schoolSectionAccess: clean(payment.SchoolSection).toLowerCase() || scope.schoolSectionAccess }));
  if (!student.__scopePath) fail('The student record cannot be locked. Refresh and try again.');
  const bound = bindManualPaymentIdentity({ AccountRef: payment.AccountRef }, student, scope).scope;
  assertManualPaymentScope(payment, bound, 'Payment');
  if (body.SourceAccountRef && lower(body.SourceAccountRef) !== lower(payment.AccountRef)) fail('The receipt does not belong to the selected student.', 403);
  const original = cents(payment.Amount), corrected = cents(payment.CorrectionTotal || 0);
  if (original <= 0 || corrected > original) fail('The receipt amount or its earlier corrections need finance review.');
  if (clean(payment.Currency || 'NGN').toUpperCase() !== 'NGN'
    || (payment.GrossAmount !== undefined && cents(payment.GrossAmount) !== original)
    || (payment.NetAmount !== undefined && cents(payment.NetAmount) !== original)) fail('This receipt has currency or net-amount differences that need finance review.');
  return { payment, student, bound, wallet, original, remaining: original - corrected };
}

function identity(student, account = {}) {
  return { AccountRef: clean(account.AccountRef || student.AdmissionNo || student.AccountRef),
    AdmissionNo: clean(student.AdmissionNo), ApplicationReference: clean(student.ApplicationReference),
    DisplayName: clean(student.DisplayName), ClassName: clean(student.ClassName),
    BranchId: clean(student.BranchId || 'main'), SchoolSection: clean(student.SchoolSection),
    AcademicSession: clean(student.AcademicSession), Term: clean(student.Term) };
}
function publicReceipt(record, account = null) {
  return { Reference: record.payment.Reference, ReceiptNo: record.payment.ReceiptNo,
    Type: record.wallet ? 'Wallet' : 'School fees', OriginalAmount: record.original / 100,
    RemainingAmount: record.remaining / 100, CorrectedAmount: (record.original - record.remaining) / 100,
    Student: identity(record.student), PaidAt: record.payment.PaidAt,
    ...(record.wallet && account ? { CurrentWalletBalance: Number(account.WalletBalance) } : {}) };
}
function instruction(body) {
  const value = { Reference: clean(body.Reference), Kind: clean(body.Kind), Reason: clean(body.Reason),
    CorrectAmount: body.Kind === 'reduce' ? financeMoney(body.CorrectAmount, 'Correct amount') : null,
    TargetAccountRef: body.Kind === 'move' ? clean(body.TargetAccountRef) : '',
    TargetSchoolSection: body.Kind === 'move' ? lower(body.TargetSchoolSection) : '' };
  if (!['reverse', 'reduce', 'move'].includes(value.Kind)) fail('Choose reverse, reduce, or move to the correct wallet.', 400);
  if (!value.Reason || value.Reason.length > 1000) fail('Enter the correction reason (up to 1,000 characters).', 400);
  if (value.Kind === 'move' && !value.TargetAccountRef) fail('Choose the correct student wallet.', 400);
  if (!['', 'primary', 'secondary'].includes(value.TargetSchoolSection)) fail('Choose a valid target school section.', 400);
  return value;
}
function journal(id, source, account, amount, debit, credit, description, user, date, timestamp, extra = {}) {
  return { JournalNo: id, Date: date, Source: source, SourceId: id, Reference: id, Status: 'Posted', System: 'YES',
    ...account, Description: description, Currency: 'NGN', TotalDebit: amount, TotalCredit: amount,
    CreatedAt: timestamp, CreatedBy: user.username, PostedAt: timestamp, PostedBy: user.username,
    Lines: [{ AccountCode: debit, Debit: amount, Credit: 0, Description: description },
      { AccountCode: credit, Debit: 0, Credit: amount, Description: description }], ...extra };
}

async function schoolPlan(env, record, amount, entry, id, user, date, timestamp, io) {
  const { student, bound, payment } = record;
  const ref = payment.AccountRef;
  const [invoiceRows, ledgerRows, summary] = await Promise.all([
    io.rows(env, 'invoices', ref, bound, { strict: true }), io.rows(env, 'ledger', ref, bound, { strict: true }),
    io.get(env, 'accountSummaries', safeId(ref)) ]);
  const invoices = invoiceRows.map(normalizeInvoice), ledger = ledgerRows.map(normalizeLedger);
  if (summary) assertManualPaymentScope(summary, bound, 'Account summary');
  const schoolInvoices = invoices.filter(isSchoolFeeInvoice);
  const received = ledger.filter(isAvailableSchoolCreditReceipt).reduce((sum, row) => sum + cents(row.Credit), 0);
  const withdrawn = ledger.filter(row => lower(row.FeeCategory) === 'account credit').reduce((sum, row) => sum + cents(row.Debit), 0);
  const applied = schoolInvoices.reduce((sum, row) => sum + cents(row.Credit), 0);
  if (received < withdrawn + applied || amount > received - withdrawn) fail('School-fee credit has already been transferred or has inconsistent allocations. Accounts must reconcile it before this correction.');
  let release = Math.max(0, amount - (received - withdrawn - applied));
  const writes = [], changes = [], versions = [], updatedInvoices = new Map();
  // Undo the latest allocations first, preserving older settled invoices where possible.
  const ordered = [...schoolInvoices].sort((a, b) => clean(b.Date || b.CreatedAt).localeCompare(clean(a.Date || a.CreatedAt)) || clean(b.InvoiceId).localeCompare(clean(a.InvoiceId)));
  for (const invoice of ordered) {
    if (release <= 0) break;
    const credit = cents(invoice.Credit), debit = cents(invoice.Debit ?? invoice.Amount);
    if (!credit) continue;
    if (credit > debit || invoice.FeeChargeReversalId) fail('An allocated invoice needs finance review before reducing this payment.');
    const related = await io.query(env, 'accountingJournals', { filters: [{ field: 'SourceId', op: '==', value: invoice.InvoiceId }], pageSize: 100, maxRows: 300 });
    related.forEach(row => assertManualPaymentScope(row, bound, 'Invoice journal', { accountRequired: false }));
    const gap = schoolInvoiceCreditJournalGap(invoice, related);
    if (gap.invalidPostedJournalIds?.length || Math.abs(gap.missing) > 0.005) fail('Invoice credit journals need reconciliation before this payment can be corrected. Run revenue synchronization, then preview again.');
    const released = Math.min(credit, release), value = released / 100;
    const fields = { Credit: (credit - released) / 100, Balance: (debit - credit + released) / 100,
      Status: credit === released ? 'Unpaid' : 'Part Paid', UpdatedAt: timestamp,
      PaymentCorrectionReleasedCredit: (cents(invoice.PaymentCorrectionReleasedCredit || 0) + released) / 100 };
    // Older invoice readers prefer imported aliases; keep existing aliases consistent.
    for (const field of ['paidAmount', 'PaidAmount']) if (Object.hasOwn(invoice, field)) fields[field] = fields.Credit;
    for (const field of ['balanceAmount', 'BalanceAmount']) if (Object.hasOwn(invoice, field)) fields[field] = fields.Balance;
    if (Object.hasOwn(invoice, 'status')) fields.status = fields.Status;
    const releaseJournal = journal(`SYS-${id}-INV-${changes.length}`, 'Student Payment Correction Credit Release', identity(student), value,
      '1100', '2310', `Reopen invoice ${invoice.InvoiceId}: ${payment.Reference}`, user, date, timestamp,
      { SourceId: invoice.InvoiceId, CorrectionId: id, PaymentReference: payment.Reference });
    writes.push(patch('invoices', version(invoice), fields), financeWrite('accountingJournals', releaseJournal.JournalNo, releaseJournal));
    changes.push({ InvoiceId: invoice.InvoiceId, ReleasedCredit: value, BalanceAfter: fields.Balance });
    updatedInvoices.set(invoice.__id, { ...invoice, ...fields });
    versions.push(...related.map(row => [row.__id, row.__updateTime]));
    for (const row of related) writes.push(patch('accountingJournals', version(row), { JournalNo: row.JournalNo }));
    release -= released;
  }
  if (release) fail('The excess payment cannot be safely released from invoices. Accounts review is required.');
  // Guard the records used for the balance calculation, including previous credit actions.
  for (const [collection, rows, field] of [['ledger', ledger, 'Credit'], ['invoices', invoices, 'Credit']]) {
    for (const row of rows) {
      version(row);
      if (collection === 'invoices' && updatedInvoices.has(row.__id)) continue;
      if (collection === 'ledger' && row.__id === record.deposit.__id) continue;
      writes.push(patch(collection, row, { [field]: row[field] ?? 0 }));
    }
  }
  const before = calculateAccountFinancialSummary(invoices, ledger, ref, date);
  const after = calculateAccountFinancialSummary(invoices.map(row => updatedInvoices.get(row.__id) || row), [...ledger, entry], ref, date);
  writes.push(financeWrite('accountSummaries', safeId(ref), { ...after, BranchId: bound.branchId,
    SchoolSection: bound.schoolSectionAccess, LinkedReferences: [student.ApplicationReference].filter(Boolean) }, summary));
  return { writes, changes, versions: [...versions, ...invoices.map(row => [row.__id, row.__updateTime]),
    ...ledger.map(row => [row.__id, row.__updateTime]), [summary?.__id, summary?.__updateTime]],
    Before: { OutstandingBalance: before.OutstandingBalance, CreditBalance: before.CreditBalance },
    After: { OutstandingBalance: after.OutstandingBalance, CreditBalance: after.CreditBalance } };
}

// Injected storage permits atomicity/concurrency testing without live financial records.
export async function handleManualPaymentCorrection(env, user, body, dependencies = {}) {
  const scope = correctionScope(user), action = clean(body.action);
  const io = { get: getDocument, query: queryCollectionPages, page: queryCollection, list: listCollectionForReport, student: findStudentByAccountRef,
    wallet: walletAccountPayload, rows: queryAccountRows, chart: getAccountingChartRows, commit: batchCommitDocuments,
    authorize: () => verifyStaffApprovalPassword(env, user.username, body.approvalPassword),
    now: () => new Date(), ...dependencies };
  if (!['search', 'lookup', 'preview', 'post'].includes(action)) fail('Choose a valid payment correction action.', 400);
  if (action === 'search') return searchStudentPaymentHistory(env, body, scope, io);
  if (action === 'post' && (user.subscriptionReadOnly || user.subscriptionActive === false || !await io.authorize())) fail('Enter your current staff password and use a writable account to confirm this correction.', 403);
  const record = await receipt(env, body, scope, io);
  if (action === 'lookup') {
    // Read the live, scoped ledger, not the receipt amount or a cached account summary.
    const account = record.wallet ? await io.wallet(env, record.student) : null;
    return { ok: true, Receipt: publicReceipt(record, account) };
  }
  const input = instruction(body);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(clean(body.OperationId))) fail('Start a new correction from the Accounts screen.', 400);
  const id = await financeOperationId('PC', scope.branchId, body.OperationId);
  const fingerprint = await financeOperationId('INPUT', input);
  const previous = await io.get(env, 'manualPaymentCorrections', id);
  if (previous) {
    assertManualPaymentScope(previous, scope, 'Correction');
    if (previous.Fingerprint !== fingerprint) fail('This correction ID was already used with different details. Load a new preview.');
    return { ok: true, replayed: true, ...previous.Result, message: 'This correction was already posted. No duplicate adjustment was made.' };
  }
  if (record.remaining <= 0) fail('This receipt has already been fully corrected.');
  const amount = input.Kind === 'reduce' ? record.remaining - cents(input.CorrectAmount) : record.remaining;
  if (amount <= 0 || amount > record.remaining) fail('The correct amount must be lower than the remaining recorded payment and cannot be negative.', 400);
  if (input.Kind === 'move' && !record.wallet) fail('Moving between students is available for wallet top-ups only. School-fee payments can be reduced or reversed.', 400);
  const timestamp = io.now().toISOString();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(io.now());
  const { payment, student, bound, wallet } = record;
  const [deposit, posted, chart, periods] = await Promise.all([
    io.get(env, 'ledger', safeId(`LED-${safeId(payment.Reference)}`)),
    io.get(env, 'accountingJournals', safeId(`SYS-PAY-${safeId(payment.Reference)}`)),
    io.chart(env, { fresh: true }), io.list(env, 'accountingPeriods') ]);
  version(deposit); version(posted); record.deposit = deposit;
  assertManualPaymentScope(deposit, bound, 'Original ledger deposit');
  assertManualPaymentScope(posted, bound, 'Original receipt journal', { accountRequired: false });
  const liability = wallet ? '2200' : '2310', lines = posted.Lines;
  if (deposit.Reference !== payment.Reference || cents(deposit.Credit) !== record.original || cents(deposit.Debit) !== 0
    || posted.SourceId !== payment.Reference || lower(posted.Status) !== 'posted' || !Array.isArray(lines) || lines.length !== 2) fail('The original receipt, ledger and journal do not agree. Finance reconciliation is required.');
  if (cents(deposit.CorrectionTotal || 0) !== record.original - record.remaining
    || cents(posted.PaymentCorrectionTotal || 0) !== record.original - record.remaining) fail('Earlier receipt corrections do not agree with its ledger and journal. Accounts review is required.');
  const cash = lines.find(row => cents(row.Debit) === record.original && cents(row.Credit) === 0);
  const liabilityLine = lines.find(row => row.AccountCode === liability && cents(row.Credit) === record.original && cents(row.Debit) === 0);
  if (!cash || !liabilityLine || !chart.some(row => clean(row.Code) === cash.AccountCode && lower(row.Type) === 'asset' && lower(row.Group) === 'cash and bank')) fail('The receipt journal needs finance review before correction.');
  const reversals = await io.query(env, 'accountingJournals', { filters: [
    { field: 'ReversalOf', op: '==', value: posted.JournalNo },
    { field: 'Reference', op: '==', value: `REV-${posted.JournalNo}` }
  ], filterJoin: 'OR', pageSize: 50, maxRows: 100 });
  if (reversals.some(row => lower(row.Status) === 'posted')) fail('The original journal has already been reversed separately. Finance review is required.');
  const account = await io.wallet(env, student);
  const source = identity(student, account), value = amount / 100;
  if (wallet && cents(account.WalletBalance) < amount) fail('The wallet has insufficient remaining funds. The student may have spent the credit; no negative balance or partial correction will be forced.');
  let target = null, targetAccount = null;
  if (input.Kind === 'move') {
    if (input.TargetSchoolSection && scope.schoolSectionAccess && input.TargetSchoolSection !== scope.schoolSectionAccess) fail('The target student is outside your authorised school section.', 403);
    target = version(await io.student(env, input.TargetAccountRef, { ...scope, schoolSectionAccess: input.TargetSchoolSection || scope.schoolSectionAccess }));
    assertManualPaymentScope(target, scope, 'Target student');
    if (!target.__scopePath || lower(target.AdmissionNo || target.AccountRef) === lower(source.AccountRef)) fail('Choose a different student wallet in this branch.', 400);
    targetAccount = await io.wallet(env, target);
    if (lower(targetAccount.WalletCardStatus) !== 'active') fail('The target wallet is not active. Review its setup before moving the credit.');
  }
  const description = `Manual payment correction: ${payment.Reference}. ${input.Reason}`;
  const base = { ...source, AcademicSession: payment.AcademicSession || source.AcademicSession, Term: payment.Term || source.Term,
    Date: timestamp, Currency: 'NGN', Reference: id, OriginalPaymentReference: payment.Reference,
    CorrectionId: id, Source: 'Manual Payment Correction', RecordedBy: clean(user.displayName || user.username),
    Description: description, FeeCategory: wallet ? 'Wallet' : 'Account Credit', FeeCode: 'PAYMENT_CORRECTION',
    EntryType: wallet ? 'Wallet Correction Debit' : 'Payment Correction Debit' };
  const entry = { ...base, LedgerNo: `${id}-OUT`, Debit: value, Credit: 0 };
  const adjustment = journal(`SYS-${id}`, 'Manual Payment Correction', source, value, liability,
    target ? liability : cash.AccountCode, description, user, date, timestamp,
    { CorrectionId: id, OriginalPaymentReference: payment.Reference, OriginalJournalNo: posted.JournalNo });
  const fields = { CorrectionTotal: (record.original - record.remaining + amount) / 100,
    LastCorrectionId: id, LastCorrectionAt: timestamp, LastCorrectionBy: user.username,
    LastCorrectionReason: input.Reason, CorrectionStatus: amount === record.remaining ? (target ? 'Moved to correct wallet' : 'Reversed') : 'Amount reduced' };
  const writes = [patch('payments', payment, fields), patch('ledger', deposit, { CorrectionTotal: fields.CorrectionTotal }),
    patch('accountingJournals', posted, { PaymentCorrectionTotal: fields.CorrectionTotal }),
    patch(student.__scopePath, student, { WalletLastPurchaseAt: timestamp, WalletLastPurchaseNo: id }),
    financeWrite('ledger', entry.LedgerNo, entry), financeWrite('accountingJournals', adjustment.JournalNo, adjustment)];
  let school = null;
  if (!wallet) { school = await schoolPlan(env, record, amount, entry, id, user, date, timestamp, io); writes.push(...school.writes); }
  const walletSummaryVersions = [];
  if (wallet) {
    for (const [owner, payload, delta] of [[student, account, -amount], ...(target ? [[target, targetAccount, amount]] : [])]) {
      const summary = await io.get(env, 'accountSummaries', safeId(payload.AccountRef));
      walletSummaryVersions.push([summary?.__id, summary?.__updateTime]);
      if (summary) {
        const ownerScope = bindManualPaymentIdentity({ AccountRef: payload.AccountRef }, owner, scope).scope;
        assertManualPaymentScope(summary, ownerScope, 'Wallet summary');
        writes.push(patch('accountSummaries', version(summary), { WalletBalance: (cents(payload.WalletBalance) + delta) / 100, UpdatedAt: timestamp }));
      }
    }
  }
  if (target) {
    const incoming = { ...base, ...identity(target, targetAccount), LedgerNo: `${id}-IN`, Debit: 0, Credit: value, EntryType: 'Wallet Correction Credit' };
    writes.push(patch(target.__scopePath, target, { WalletLastPurchaseAt: timestamp, WalletLastPurchaseNo: id }), financeWrite('ledger', incoming.LedgerNo, incoming));
  }
  for (const write of writes.filter(row => row.collectionPath === 'accountingJournals' && row.exists === false)) validateRequisitionPosting(write.data, chart, periods, 'school');
  const result = { Receipt: publicReceipt(record, account), CorrectionId: id, Kind: input.Kind, Amount: value,
    RemainingAmount: (record.remaining - amount) / 100, Source: source,
    ...(wallet ? { BalanceBefore: Number(account.WalletBalance), BalanceAfter: (cents(account.WalletBalance) - amount) / 100 } : { SchoolFees: school }),
    ...(target ? { Target: identity(target, targetAccount), TargetBalanceBefore: Number(targetAccount.WalletBalance), TargetBalanceAfter: (cents(targetAccount.WalletBalance) + amount) / 100 } : {}) };
  if (school) result.SchoolFees = { Before: school.Before, After: school.After, Invoices: school.changes };
  const digest = await financeOperationId('PREVIEW', input, date, payment.__updateTime, deposit.__updateTime, posted.__updateTime,
    student.__updateTime, target?.__updateTime, walletSummaryVersions, result, school?.versions.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  if (action === 'preview') return { ok: true, ...result, PreviewDigest: digest, message: 'Review this correction. No balances have changed.' };
  if (body.PreviewDigest !== digest) fail('The payment, wallet or invoice balances changed after preview. Preview again before confirming.');
  writes.push(financeWrite('manualPaymentCorrections', id, { ...source, ...input, CorrectionId: id, Amount: value,
    OriginalPaymentId: payment.__id, Fingerprint: fingerprint, RecordedAt: timestamp, RecordedBy: user.username, Result: result }),
  financeWrite('accountingAudit', id, { AuditId: id, Timestamp: timestamp,
    Action: input.Kind === 'move' ? 'Move manual credit to the correct student wallet'
      : `${input.Kind === 'reduce' ? 'Reduce' : 'Reverse'} manual ${wallet ? 'wallet top-up' : 'school-fee'} receipt`,
    Summary: `${new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(value)} ${target
      ? `moved from student ${source.AccountRef}'s wallet to student ${targetAccount.AccountRef}'s wallet`
      : `removed from student ${source.AccountRef}'s ${wallet ? 'wallet' : 'school-fee credit'} to correct receipt ${payment.Reference}`}.
      ${wallet ? `Source wallet balance: ${Number(account.WalletBalance).toFixed(2)} to ${result.BalanceAfter.toFixed(2)} NGN.` : 'Invoice and account balances were recalculated.'} No bank transfer or cash refund was made.`,
    EntityType: 'Payment', EntityId: payment.Reference, BranchId: scope.branchId, SchoolSection: source.SchoolSection,
    User: clean(user.displayName || user.username), ActorUsername: user.username, UserRole: user.assignedRole || user.role,
    SourcePlatform: user.sourcePlatform || 'Web', Details: `${input.Kind}; amount ${value}; source ${source.AccountRef}; target ${targetAccount?.AccountRef || 'none'}; ${input.Reason}` }));
  if (writes.length > 450) fail('This account has too many financial records for a single safe correction. Accounts must reconcile its history first.');
  try { await io.commit(env, writes); }
  catch (error) {
    if ([409, 412].includes(Number(error.status))) fail('Records changed during posting. No partial correction was made. Preview again or retry the same correction to check whether it completed.');
    throw error;
  }
  return { ok: true, ...result, message: 'Correction posted. Original records are retained. No bank transfer or cash refund was initiated.' };
}
