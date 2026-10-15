import { assertManualPaymentScope } from './manual-payment-scope.js';
import { financeFailure, financeMoney, financeOperationId } from './accounting-mutation-guards.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const cents = value => Math.round(Number(value || 0) * 100);
const wallet = row => lower(row.FeeCategory) === 'wallet' || clean(row.FeeCode).toUpperCase() === 'WALLET_TOPUP';
const source = row => lower(row.Channel) === 'historical payment import' || /historical payment import/i.test(clean(row.Metadata))
  ? 'Batch upload' : lower(row.Gateway) === 'manual' ? 'Manual payment' : clean(row.Gateway || row.Source) || 'Wallet ledger credit';

// Only the interactive manual-payment route calls this. Gateway confirmations and
// historical imports retain their existing reference-based idempotency workflow.
export async function reviewManualWalletTopup({ body, student, scope, payments = [], ledger = [] }) {
  if (!wallet(body)) return null;
  if (!student || !scope?.branchId || !scope.references?.length) {
    throw financeFailure('The student and branch must be verified before checking for duplicate wallet credits.', 403);
  }
  assertManualPaymentScope(student, scope, 'Student');
  const amount = financeMoney(body.Amount, 'Top-up amount', { min: 0.01 });
  const currency = clean(body.Currency || 'NGN').toUpperCase(), reference = clean(body.Reference);
  const receipts = new Set(), matches = [];
  const append = (row, kind, credit) => {
    assertManualPaymentScope(row, scope, 'Wallet credit');
    if (lower(row.Reference) === lower(reference) || clean(row.Currency || 'NGN').toUpperCase() !== currency || cents(credit) !== cents(amount)) return;
    const corrected = Number(row.CorrectionTotal || 0);
    if (!Number.isFinite(corrected) || corrected < 0 || cents(corrected) > cents(credit)) {
      throw financeFailure('A matching wallet credit has inconsistent corrections. Accounts must review its history before another top-up.', 409);
    }
    if (cents(credit) - cents(corrected) <= 0) return;
    matches.push({ Id: `${kind}/${clean(row.__id || row.PaymentId || row.LedgerNo || row.Reference)}`,
      Reference: clean(row.Reference), ReceiptNo: clean(row.ReceiptNo), Amount: amount,
      RemainingCredit: (cents(credit) - cents(corrected)) / 100, Currency: currency,
      Date: clean(row.PaidAt || row.RawDate || row.Date || row.RecordedAt), Source: source(row),
      RecordedBy: clean(row.RecordedBy), Status: clean(row.ProcessingStatus || row.Status),
      Version: clean(row.__updateTime) });
  };
  for (const row of payments) {
    assertManualPaymentScope(row, scope, 'Payment');
    if (row.Reference) receipts.add(lower(row.Reference));
    if (wallet(row) && lower(row.Status) === 'paid') append(row, 'payments', row.Amount);
  }
  for (const row of ledger) {
    assertManualPaymentScope(row, scope, 'Ledger');
    // A receipt and its posted ledger entry are one credit, not two matches.
    if (row.Reference && receipts.has(lower(row.Reference))) continue;
    if ((wallet(row) || lower(row.EntryType).startsWith('wallet')) && Number(row.Credit) > 0) append(row, 'ledger', row.Credit);
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.Date.localeCompare(a.Date) || a.Id.localeCompare(b.Id));
  // A review acknowledgement is tied to this instruction, actor, scope and live
  // matching records. New/changed matching credits require another review.
  const digest = await financeOperationId('wallet-review', scope.branchId, scope.schoolSectionAccess,
    clean(body.UserUsername), clean(student.__scopePath), clean(student.__id), clean(body.AccountRef), reference,
    amount, currency, clean(body.FeeCode), clean(body.FeeCategory), clean(body.PaidAt),
    clean(body.AcademicSession), clean(body.Term), matches);
  const visible = matches.slice(0, 50).map(({ Version, ...row }) => row);
  const review = { Student: { AccountRef: clean(student.AdmissionNo || student.AccountRef), DisplayName: clean(student.DisplayName) },
    Amount: amount, Currency: currency, MatchCount: matches.length, Matches: visible,
    MoreMatches: Math.max(0, matches.length - visible.length), ReviewDigest: digest };
  if (body.DuplicateWalletReviewDigest !== digest) {
    const details = visible.slice(0, 3).map(row => `${row.Date || 'Date not recorded'}: ${row.Source}, ${row.Reference || row.Id}`).join('; ');
    return { required: true, response: { ok: false, code: 'WALLET_DUPLICATE_REVIEW_REQUIRED', duplicateReview: review,
      message: `Possible duplicate wallet top-up: ${review.Student.AccountRef} already has ${matches.length} credit(s) of ${currency} ${amount.toFixed(2)}. ${details}. No new payment was recorded. Check the payment proof and review these credits before continuing. If your app has no review option, update the desktop app.` } };
  }
  return { required: false, acknowledgement: { MatchCount: matches.length, References: visible.map(row => row.Reference || row.Id),
    ReviewDigest: digest, ReviewedBy: clean(body.RecordedBy || body.UserUsername), ReviewedUsername: clean(body.UserUsername),
    ReviewedAt: new Date().toISOString(), Decision: 'Confirmed this is a separate payment after reviewing same-amount wallet credits' } };
}
