import { escapeEmailHtml, sendConfiguredEmail } from './email-service.js';

const clean = (value) => String(value ?? '').trim();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));

function money(value, currency = 'NGN') {
  const amount = Number(String(value ?? 0).replace(/,/g, '')) || 0;
  const code = clean(currency).toUpperCase() || 'NGN';
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export function schoolPaymentReceiptDetails(payment = {}) {
  const recipientCandidates = [
    payment.ParentEmail,
    ...(Array.isArray(payment.ParentEmails) ? payment.ParentEmails : []),
    payment.VerificationEmail,
    payment.Email
  ].map((value) => clean(value).toLowerCase()).filter(validEmail);
  const toEmail = [...new Set(recipientCandidates)][0] || '';
  return {
    toEmail,
    toName: clean(payment.ParentName || payment.DisplayName) || 'Parent/Guardian',
    studentName: clean(payment.DisplayName || payment.StudentName) || 'Student',
    amount: money(payment.GrossAmount || payment.Amount || payment.Credit, payment.Currency),
    feeName: clean(payment.FeeName || payment.Description || payment.FeeCode) || 'School payment',
    receiptNo: clean(payment.ReceiptNo || payment.PaymentId || payment.Reference),
    reference: clean(payment.GatewayReference || payment.Reference),
    method: clean(payment.Method || payment.Gateway) || 'Direct Bank Transfer',
    paidAt: clean(payment.PaidAt || payment.RecordedAt).replace('T', ' ').replace('Z', '').slice(0, 19),
    branchId: clean(payment.BranchId || 'main') || 'main'
  };
}

function receiptFrame(details) {
  const rows = [
    ['Student', details.studentName],
    ['Purpose', details.feeName],
    ['Amount paid', details.amount],
    ['Receipt number', details.receiptNo],
    ['Payment method', details.method],
    ...(details.reference ? [['Bank reference', details.reference]] : []),
    ...(details.paidAt ? [['Payment date', details.paidAt]] : [])
  ].map(([label, value]) => `<tr><th style="width:38%;padding:9px;border:1px solid #d5e2ec;background:#eaf2fb;color:#17466f;text-align:left">${escapeEmailHtml(label)}</th><td style="padding:9px;border:1px solid #d5e2ec">${escapeEmailHtml(value)}</td></tr>`).join('');
  return `<div style="margin:0;background:#eef4f8;padding:18px 10px;color:#17324d;font-family:Arial,sans-serif"><div style="max-width:640px;margin:auto;border-top:6px solid #0b8f76;border-radius:12px;background:#fff;padding:22px;box-shadow:0 10px 28px #173b5818"><p style="margin:0;color:#0b8f76;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Official payment receipt</p><h1 style="margin:6px 0 12px;color:#123f6d;font-size:23px">Payment received</h1><p>Dear ${escapeEmailHtml(details.toName)},</p><p>Thank you. The school has confirmed and recorded this direct bank transfer.</p><table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:18px 0">${rows}</table><p style="color:#63788d;font-size:12px">Please retain this email as your official payment receipt.</p></div></div>`;
}

export async function sendSchoolPaymentReceiptEmail(env, payment = {}) {
  const details = schoolPaymentReceiptDetails(payment);
  if (!details.toEmail) {
    return { ok: false, skipped: true, message: 'No valid parent email is linked to this payment.' };
  }
  const subject = `School payment receipt - ${details.receiptNo || details.reference || details.studentName}`;
  const delivery = await sendConfiguredEmail(env, {
    toEmail: details.toEmail,
    toName: details.toName,
    subject,
    textContent: `Dear ${details.toName},\n\nThe school has confirmed and recorded this direct bank transfer.\n\nStudent: ${details.studentName}\nPurpose: ${details.feeName}\nAmount paid: ${details.amount}\nReceipt number: ${details.receiptNo}\nPayment method: ${details.method}${details.reference ? `\nBank reference: ${details.reference}` : ''}${details.paidAt ? `\nPayment date: ${details.paidAt}` : ''}\n\nPlease retain this email as your official payment receipt.`,
    htmlContent: receiptFrame(details),
    branchId: details.branchId
  });
  return { ...delivery, type: 'receipt', recipient: details.toEmail };
}
