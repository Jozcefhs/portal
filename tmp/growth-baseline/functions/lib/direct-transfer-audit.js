import { paymentAuditSummary } from './audit-language.js';

const clean = value => String(value ?? '').trim();

function paymentKind(transfer) {
  if (transfer.Context === 'admission-form') return 'admission-form payment';
  if (transfer.Context === 'church-donation') return 'donation';
  if (transfer.Context === 'organization-store') return 'organisation-store payment';
  const payload = transfer.Payload || {};
  if (clean(payload.FeeCode).toUpperCase() === 'WALLET_TOPUP' || clean(payload.FeeCategory).toLowerCase() === 'wallet') return 'wallet top-up';
  if (clean(payload.FeeCode).toUpperCase() === 'STORE_CART' || clean(payload.FeeCategory).toLowerCase() === 'store') return 'school-store payment';
  return transfer.Context === 'school-payment' ? 'school payment' : 'payment';
}

// Server-attested stage metadata only. Never copy proof, bank details, passwords or mail errors.
export function directTransferAudit(transfer, stage, result = null) {
  const kind = paymentKind(transfer);
  const action = {
    review: `Review ${kind} bank-transfer request`,
    reserve: `Reserve bank reference for ${kind}`,
    record: `Record ${kind} from bank transfer`,
    delivery: `Deliver ${kind} receipt and notification`,
    complete: `Complete ${kind} approval`,
    reject: `Reject ${kind} bank-transfer request`
  }[stage] || `Review ${kind} bank-transfer request`;
  const amount = Number(transfer.Amount);
  const details = [`Approval stage: ${stage}`,
    Number.isFinite(amount) ? `Receipt amount: ${clean(transfer.Currency || 'NGN').slice(0, 8)} ${amount.toFixed(2)}` : 'Receipt amount not recorded'];
  if (['reserve', 'delivery', 'complete'].includes(stage)) details.push('This step does not post another payment or wallet credit.');
  if (stage === 'record' && result?.recorded?.duplicate) details.push('Existing payment reused; dependent records checked.');
  if (stage === 'delivery' && result) {
    for (const [key, name] of [['email', 'Receipt email'], ['notification', 'Parent notification']]) {
      const delivery = result[key];
      details.push(`${name}: ${delivery?.skipped ? 'skipped' : delivery?.ok ? 'sent' : delivery?.notification ? (delivery.created ? 'created' : 'already present') : 'not confirmed'}.`);
    }
  }
  const accountRef = clean(transfer.Payload?.AccountRef || transfer.Payload?.AdmissionNo);
  const owner = accountRef ? ` for student ${accountRef}` : '';
  let summary = '';
  if (result && stage === 'record' && result.recorded?.payment) {
    summary = paymentAuditSummary(result.recorded.payment, { duplicate: result.recorded.duplicate, channel: 'bank-transfer approval' });
  } else if (result && stage === 'record') {
    summary = `The ${kind}${owner} was recorded through bank-transfer approval. ${details[1]}.`;
  } else if (result && stage === 'reserve') {
    summary = `The bank reference was reserved for this ${kind}${owner}. No payment or wallet credit was posted by this step.`;
  } else if (result && stage === 'delivery') {
    summary = `Receipt and notification delivery was processed for the ${kind}${owner}. ${details.slice(-2).join(' ')} No additional payment or wallet credit was posted.`;
  } else if (result && stage === 'complete') {
    summary = `Approval of the ${kind}${owner} was marked complete. The payment was recorded in an earlier step; this step made no additional credit.`;
  } else if (result && stage === 'reject') {
    summary = `The ${kind} bank-transfer request${owner} was rejected. No payment or wallet credit was added.`;
  }
  return { action, details: details.join('; '), summary };
}

export function setDirectTransferAudit(context, user, transfer, stage, result = null) {
  const audit = directTransferAudit(transfer, stage, result);
  context.data ||= {};
  context.data.securityAuditActor = user;
  context.data.securityAuditAction = audit.action;
  context.data.securityAuditDetails = audit.details;
  context.data.securityAuditSummary = audit.summary;
}
