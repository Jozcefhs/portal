import { financeFailure, financeMoney } from './accounting-mutation-guards.js';
import { assertManualPaymentScope } from './manual-payment-scope.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const cents = value => Math.round(financeMoney(value, 'Transfer amount') * 100);
const fail = () => { throw financeFailure('The verified bank-transfer request does not match this completed receipt. Accounts must review its approval evidence.', 409); };

export const isDirectBankReceipt = payment => lower(payment?.Gateway) === 'direct bank transfer';
export const isCorrectablePaymentGateway = payment => lower(payment?.Gateway) === 'manual' || isDirectBankReceipt(payment);

export function directTransferReceiptId(payment) {
  const reference = clean(payment?.Reference);
  const canonical = reference.replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
  if (!reference || reference !== canonical) fail();
  return reference;
}

// Gateway labels alone are not proof of approval. Both search and posting use
// this exact check; the posting transaction also locks the request's revision.
export function assertVerifiedBankReceipt(payment, transfer, scope) {
  const reference = directTransferReceiptId(payment);
  const payload = transfer?.Payload;
  if (!isDirectBankReceipt(payment) || !transfer?.__updateTime || transfer.__id !== reference
    || clean(transfer.Reference) !== reference || lower(transfer.Context) !== 'school-payment'
    || lower(transfer.Status) !== 'verified' || lower(transfer.ApprovalStage) !== 'completed'
    || clean(transfer.VerificationError) || !clean(transfer.ReviewedBy) || !Number.isFinite(Date.parse(transfer.ReviewedAt))
    || lower(payment.Status) !== 'paid' || lower(payment.ProcessingStatus) !== 'completed'
    || lower(payment.Method) !== 'bank transfer'
    || !payload || typeof payload !== 'object' || Array.isArray(payload)
    || !clean(transfer.BranchId) || !clean(payload.AccountRef)
    || lower(payload.AccountRef) !== lower(payment.AccountRef)
    || !clean(payment.GatewayReference) || clean(transfer.BankReference) !== clean(payment.GatewayReference)
    || clean(transfer.Currency).toUpperCase() !== 'NGN' || clean(payment.Currency || 'NGN').toUpperCase() !== 'NGN'
    || !clean(payment.FeeCode) || lower(payload.FeeCode) !== lower(payment.FeeCode)
    || lower(payload.FeeCategory) !== lower(payment.FeeCategory)
    || (Array.isArray(payload.StoreCart) && payload.StoreCart.length)) fail();
  assertManualPaymentScope(transfer, scope, 'Verified bank-transfer request', { accountRequired: false });
  assertManualPaymentScope({ ...payload, BranchId: payload.BranchId || transfer.BranchId }, scope, 'Verified transfer payment');
  if (cents(transfer.Amount) !== cents(payment.Amount)
    || (payload.Amount !== undefined && cents(payload.Amount) !== cents(payment.Amount))
    || (payload.Currency && clean(payload.Currency).toUpperCase() !== 'NGN')
    || ['AcademicSession', 'Term'].some(field => clean(payload[field]) && clean(payment[field])
      && lower(payload[field]) !== lower(payment[field]))) fail();
  return transfer;
}

// Search reads one bounded page of approval evidence, without downloading bank
// proof attachments or issuing a separate request for every payment row.
export async function bankReceiptEvidenceForSearch(env, payments, io) {
  const references = [...new Set(payments.map(payment => {
    try { return directTransferReceiptId(payment); } catch { return ''; }
  }).filter(Boolean))];
  const byReference = new Map();
  for (let offset = 0; offset < references.length; offset += 30) {
    const values = references.slice(offset, offset + 30);
    const rows = await io.query(env, 'directTransferRequests', {
      filters: [{ field: 'Reference', op: 'in', value: values }], pageSize: 30, maxRows: 60,
      select: ['Reference', 'Context', 'Status', 'ApprovalStage', 'BranchId', 'SchoolSection', 'Amount', 'Currency',
        'BankReference', 'ReviewedAt', 'ReviewedBy', 'VerificationError', 'Payload']
    });
    for (const row of rows) {
      const reference = clean(row.Reference);
      if (!values.includes(reference)) fail();
      byReference.set(reference, byReference.has(reference) ? null : row);
    }
  }
  return byReference;
}
