import { getDocument, patchDocumentFields, patchDocumentFieldsIfCurrent } from './firestore.js';
import { sendConfiguredEmail } from './email-service.js';

const clean = (value) => String(value ?? '').trim();

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function money(amount, currency) {
  const number = Number(amount || 0);
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: clean(currency || 'NGN').toUpperCase(),
      minimumFractionDigits: 2
    }).format(Number.isFinite(number) ? number : 0);
  } catch (_error) {
    return `${clean(currency || 'NGN').toUpperCase()} ${(Number.isFinite(number) ? number : 0).toFixed(2)}`;
  }
}

export function subscriptionReceiptNumber(reference, paidAt) {
  const date = new Date(clean(paidAt));
  const datePart = Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10).replace(/-/g, '')
    : 'UNDATED';
  const referencePart = clean(reference).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(-12) || 'PAYMENT';
  return `DMX-RCT-${datePart}-${referencePart}`;
}

export function buildSubscriptionReceipt(intent = {}, registration = {}, options = {}) {
  const paidAt = clean(options.paidAt) || new Date().toISOString();
  const reference = clean(options.reference || intent.Reference || intent.__id);
  const adjustment = intent.PaymentAdjustment && typeof intent.PaymentAdjustment === 'object'
    ? intent.PaymentAdjustment
    : {};
  const existingSubscription = clean(registration.PaymentStatus).toLowerCase() === 'paid'
    && clean(registration.SubscriptionPaymentReference)
    && clean(registration.SubscriptionPaymentReference) !== reference;
  const purpose = clean(adjustment.Type).toLowerCase() === 'flexproration'
    ? 'Flex plan upgrade'
    : existingSubscription ? 'Dynamax subscription renewal or plan change' : 'Dynamax subscription';
  return {
    ReceiptNo: subscriptionReceiptNumber(reference, paidAt),
    Status: 'Paid',
    PaymentReference: reference,
    RegistrationReference: clean(options.registrationReference || intent.RegistrationReference || registration.Reference || registration.__id),
    OrganisationName: clean(registration.OrganisationName || intent.OrganisationName) || 'Subscriber organisation',
    ContactName: clean(registration.ContactName || intent.ContactName),
    Email: clean(registration.Email || intent.Email).toLowerCase(),
    Plan: clean(intent.Plan || registration.Plan),
    BillingCycle: clean(intent.BillingCycle || registration.BillingCycle),
    UserLimit: Math.max(1, Number(intent.UserLimit || registration.UserLimit || 1) || 1),
    Amount: Number(intent.Amount || 0),
    FullCycleAmount: Number(intent.FullCycleAmount || intent.Amount || 0),
    Currency: clean(intent.Currency || registration.Currency || 'NGN').toUpperCase(),
    PaymentMethod: clean(options.provider || intent.PaymentMethod || 'Paystack'),
    PaymentPurpose: purpose,
    ProviderTransactionId: clean(options.providerFields?.PaystackTransactionId),
    BankReference: clean(options.providerFields?.BankReference || options.providerFields?.DirectTransferReference),
    PaidAt: paidAt,
    IssuedAt: clean(options.issuedAt) || new Date().toISOString()
  };
}

export function publicSubscriptionReceipt(receipt = {}) {
  return {
    receiptNo: clean(receipt.ReceiptNo),
    status: clean(receipt.Status),
    paymentReference: clean(receipt.PaymentReference),
    registrationReference: clean(receipt.RegistrationReference),
    organisationName: clean(receipt.OrganisationName),
    contactName: clean(receipt.ContactName),
    plan: clean(receipt.Plan),
    billingCycle: clean(receipt.BillingCycle),
    userLimit: Math.max(1, Number(receipt.UserLimit || 1) || 1),
    amount: Number(receipt.Amount || 0),
    fullCycleAmount: Number(receipt.FullCycleAmount || receipt.Amount || 0),
    currency: clean(receipt.Currency || 'NGN'),
    paymentMethod: clean(receipt.PaymentMethod),
    paymentPurpose: clean(receipt.PaymentPurpose),
    providerTransactionId: clean(receipt.ProviderTransactionId),
    bankReference: clean(receipt.BankReference),
    paidAt: clean(receipt.PaidAt),
    issuedAt: clean(receipt.IssuedAt)
  };
}

export function subscriptionReceiptUrl(env = {}, receipt = {}) {
  const configured = clean(env.CANONICAL_PORTAL_URL || env.PUBLIC_PORTAL_URL || 'https://dynamaxms.pages.dev');
  let base;
  try { base = new URL(configured); } catch (_error) { base = new URL('https://dynamaxms.pages.dev'); }
  const url = new URL('/subscription-receipt.html', base.origin);
  url.searchParams.set('reference', clean(receipt.PaymentReference));
  url.searchParams.set('registration', clean(receipt.RegistrationReference));
  return url.href;
}

export function subscriptionReceiptText(receipt = {}, receiptUrl = '') {
  return [
    'DYNAMAX SUBSCRIPTION RECEIPT',
    `Receipt: ${clean(receipt.ReceiptNo)}`,
    `Status: ${clean(receipt.Status || 'Paid')}`,
    `Subscriber: ${clean(receipt.OrganisationName)}`,
    `Plan: ${clean(receipt.Plan)} (${clean(receipt.BillingCycle)})`,
    `Active users: ${Math.max(1, Number(receipt.UserLimit || 1) || 1)}`,
    `Amount paid: ${money(receipt.Amount, receipt.Currency)}`,
    `Payment method: ${clean(receipt.PaymentMethod)}`,
    `Payment reference: ${clean(receipt.PaymentReference)}`,
    `Paid at: ${clean(receipt.PaidAt)}`,
    receiptUrl ? `View or print receipt: ${receiptUrl}` : '',
    '',
    'Thank you for subscribing to Dynamax.'
  ].filter((line) => line !== '').join('\n');
}

export function subscriptionReceiptHtml(receipt = {}, receiptUrl = '') {
  const rows = [
    ['Receipt number', receipt.ReceiptNo],
    ['Subscriber', receipt.OrganisationName],
    ['Plan', `${clean(receipt.Plan)} (${clean(receipt.BillingCycle)})`],
    ['Active users', Math.max(1, Number(receipt.UserLimit || 1) || 1)],
    ['Amount paid', money(receipt.Amount, receipt.Currency)],
    ['Payment method', receipt.PaymentMethod],
    ['Payment reference', receipt.PaymentReference],
    ['Paid at', receipt.PaidAt]
  ];
  return `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#10243e"><div style="border-bottom:4px solid #0b7d70;padding:16px 0"><h1 style="margin:0;font-size:24px">Dynamax subscription receipt</h1><p style="margin:6px 0 0;color:#47627e">Official payment confirmation</p></div><p style="margin:22px 0">Hello ${escapeHtml(receipt.ContactName || 'Subscriber')},</p><p>Payment for <strong>${escapeHtml(receipt.OrganisationName)}</strong> was received successfully.</p><table style="width:100%;border-collapse:collapse;margin:20px 0">${rows.map(([label, value]) => `<tr><th style="text-align:left;padding:10px;border:1px solid #d8e2ee;background:#f3f7fb;width:38%">${escapeHtml(label)}</th><td style="padding:10px;border:1px solid #d8e2ee">${escapeHtml(value)}</td></tr>`).join('')}<tr><th style="text-align:left;padding:10px;border:1px solid #d8e2ee;background:#e7f7f1">Status</th><td style="padding:10px;border:1px solid #d8e2ee;color:#08705f;font-weight:700">PAID</td></tr></table>${receiptUrl ? `<p><a href="${escapeHtml(receiptUrl)}" style="display:inline-block;padding:11px 16px;border-radius:7px;background:#126fe8;color:#fff;text-decoration:none;font-weight:700">View or print receipt</a></p>` : ''}<p style="margin-top:28px;color:#5b6f85;font-size:13px">Keep this receipt for your records. Thank you for subscribing to Dynamax.</p></div>`;
}

function suppressedStatus(current = {}) {
  const status = clean(current.ReceiptEmailStatus);
  if (['sent', 'sending', 'uncertain'].includes(status.toLowerCase())) {
    return { sent: status.toLowerCase() === 'sent', status, suppressed: true };
  }
  return null;
}

async function finishReceiptEmail(platformEnv, reference, attemptId, delivery = {}) {
  const finalStatus = delivery.sent
    ? 'Sent'
    : (delivery.deliveryUncertain === true || delivery.retrySafe !== true ? 'Uncertain' : 'Failed');
  const completedAt = new Date().toISOString();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await getDocument(platformEnv, 'subscriptionPayments', reference);
    if (!current || clean(current.ReceiptEmailAttemptId) !== attemptId) {
      return { sent: false, status: finalStatus, suppressed: true };
    }
    try {
      await patchDocumentFieldsIfCurrent(platformEnv, 'subscriptionPayments', reference, {
        ReceiptEmailStatus: finalStatus,
        ReceiptEmailSentAt: delivery.sent ? completedAt : '',
        ReceiptEmailCompletedAt: completedAt,
        ReceiptEmailProvider: clean(delivery.provider),
        ReceiptEmailProviderMessageId: clean(delivery.providerMessageId),
        ReceiptEmailMessage: clean(delivery.message || finalStatus).slice(0, 240),
        ReceiptEmailRetrySafe: finalStatus === 'Failed' && delivery.retrySafe === true,
        ReceiptEmailDeliveryUncertain: finalStatus === 'Uncertain',
        UpdatedAt: completedAt
      }, current);
      return { sent: delivery.sent === true && finalStatus === 'Sent', status: finalStatus };
    } catch (error) {
      if (error?.code === 'FIRESTORE_WRITE_CONFLICT') continue;
      throw error;
    }
  }
  return { sent: false, status: finalStatus, suppressed: true };
}

export async function deliverSubscriptionReceiptEmail(deliveryEnv, platformEnv, reference, receipt = {}) {
  const recipient = clean(receipt.Email).toLowerCase();
  if (!validEmail(recipient)) return { sent: false, status: 'Failed', message: 'Recipient email is invalid.' };
  let attemptId = '';
  let claimed = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await getDocument(platformEnv, 'subscriptionPayments', reference);
    if (!current) return { sent: false, status: 'Failed', message: 'Payment record was not found.' };
    const suppressed = suppressedStatus(current);
    if (suppressed) return suppressed;
    attemptId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      await patchDocumentFieldsIfCurrent(platformEnv, 'subscriptionPayments', reference, {
        ReceiptEmailStatus: 'Sending',
        ReceiptEmailAttemptId: attemptId,
        ReceiptEmailStartedAt: startedAt,
        ReceiptEmailDeliveryUncertain: false,
        ReceiptEmailRetrySafe: false,
        UpdatedAt: startedAt
      }, current);
      claimed = true;
      break;
    } catch (error) {
      if (error?.code === 'FIRESTORE_WRITE_CONFLICT') continue;
      throw error;
    }
  }
  if (!claimed) return { sent: false, status: 'Sending', suppressed: true };
  const receiptUrl = subscriptionReceiptUrl(deliveryEnv, receipt);
  let delivery;
  try {
    const response = await sendConfiguredEmail(deliveryEnv, {
      toEmail: recipient,
      toName: clean(receipt.ContactName) || clean(receipt.OrganisationName),
      subject: `Dynamax receipt ${clean(receipt.ReceiptNo)}`,
      textContent: subscriptionReceiptText(receipt, receiptUrl),
      htmlContent: subscriptionReceiptHtml(receipt, receiptUrl),
      providerOverride: 'brevo',
      senderOverride: {
        email: clean(deliveryEnv.DYNAMAX_SENDER_EMAIL || deliveryEnv.BREVO_SENDER_EMAIL),
        name: clean(deliveryEnv.DYNAMAX_SENDER_NAME || deliveryEnv.BREVO_SENDER_NAME || 'Dynamax')
      }
    });
    delivery = {
      sent: true,
      provider: response.provider,
      providerMessageId: response.providerMessageId,
      message: 'Sent',
      retrySafe: false,
      deliveryUncertain: false
    };
  } catch (error) {
    const uncertain = error?.deliveryUncertain === true || error?.retrySafe !== true;
    delivery = {
      sent: false,
      provider: clean(error?.provider),
      message: clean(error?.message || error).slice(0, 240),
      retrySafe: !uncertain && error?.retrySafe === true,
      deliveryUncertain: uncertain
    };
  }
  return finishReceiptEmail(platformEnv, reference, attemptId, delivery);
}

export async function markReceiptEmailNotRequired(platformEnv, reference, message) {
  return patchDocumentFields(platformEnv, 'subscriptionPayments', reference, {
    ReceiptEmailStatus: 'Not sent',
    ReceiptEmailMessage: clean(message).slice(0, 240),
    UpdatedAt: new Date().toISOString()
  });
}
