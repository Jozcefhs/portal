import { escapeEmailHtml, sendConfiguredEmail } from './email-service.js';

const clean = (value) => String(value ?? '').trim();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));

function amount(value, currency = 'NGN') {
  const number = Number(String(value ?? 0).replace(/,/g, '')) || 0;
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: clean(currency).toUpperCase() || 'NGN',
      minimumFractionDigits: 2
    }).format(number);
  } catch {
    return `${clean(currency).toUpperCase() || 'NGN'} ${number.toFixed(2)}`;
  }
}

function saleLines(sale = {}) {
  return (Array.isArray(sale.Items) ? sale.Items : []).slice(0, 50).map((item, index) => ({
    number: index + 1,
    name: clean(item.ItemName || item.ItemCode || 'Item'),
    quantity: Math.max(1, Math.floor(Number(item.Quantity || 1) || 1)),
    unitPrice: amount(item.UnitPrice, sale.Currency),
    lineTotal: amount(item.Amount, sale.Currency)
  }));
}

function emailFrame(content = '') {
  return `<div style="margin:0;background:#eef4f8;padding:24px;color:#17324d;font-family:Arial,sans-serif"><div style="max-width:640px;margin:auto;border-top:6px solid #0b8f76;border-radius:12px;background:#fff;padding:26px;box-shadow:0 10px 28px #173b5818">${content}<p style="margin:26px 0 0;border-top:1px solid #d9e5ee;padding-top:14px;color:#63788d;font-size:12px">Sent securely by the organisation store.</p></div></div>`;
}

export async function sendOrganizationCommercePaymentLinkEmail(env, sale = {}) {
  const email = clean(sale.CustomerEmail).toLowerCase();
  const link = clean(sale.AuthorizationUrl);
  if (!validEmail(email)) return { ok: false, skipped: true, message: 'Customer email was not provided.' };
  if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(link)) {
    return { ok: false, skipped: true, message: 'The secure payment link is unavailable.' };
  }
  const lines = saleLines(sale);
  const itemText = lines.map((line) => `${line.number}. ${line.name} x ${line.quantity} - ${line.lineTotal}`).join('\n');
  const itemHtml = lines.map((line) => `<tr><td style="padding:8px;border-bottom:1px solid #dce6ee">${escapeEmailHtml(line.name)}</td><td style="padding:8px;border-bottom:1px solid #dce6ee;text-align:center">${line.quantity}</td><td style="padding:8px;border-bottom:1px solid #dce6ee;text-align:right">${escapeEmailHtml(line.lineTotal)}</td></tr>`).join('');
  const total = amount(sale.Amount || sale.GrossAmount, sale.Currency);
  const customer = clean(sale.CustomerName) || 'Customer';
  const subject = `Complete your organisation store payment - ${clean(sale.SaleNo)}`;
  const delivery = await sendConfiguredEmail(env, {
    toEmail: email,
    toName: customer,
    subject,
    textContent: `Dear ${customer},\n\nYour organisation store order is ready for payment.\n\n${itemText}\n\nTotal: ${total}\nOrder: ${clean(sale.SaleNo)}\n\nComplete payment securely: ${link}\n\nStock is deducted only after payment is confirmed.`,
    htmlContent: emailFrame(`<p style="margin:0;color:#0b8f76;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Organisation store</p><h1 style="margin:6px 0 10px;color:#123f6d;font-size:23px">Complete your payment</h1><p>Dear ${escapeEmailHtml(customer)},</p><p>Your order is ready. Use the secure button below to complete payment.</p><table style="width:100%;border-collapse:collapse;margin:18px 0"><thead><tr style="background:#123f6d;color:#fff"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Amount</th></tr></thead><tbody>${itemHtml}</tbody></table><p style="display:flex;justify-content:space-between;padding:12px;background:#e7f8f2;color:#08735e;font-size:17px"><span>Total</span><strong>${escapeEmailHtml(total)}</strong></p><p style="margin:22px 0;text-align:center"><a href="${escapeEmailHtml(link)}" style="display:inline-block;border-radius:8px;background:#1769e0;padding:12px 18px;color:#fff;font-weight:bold;text-decoration:none">Complete secure payment</a></p><p style="color:#63788d;font-size:12px">Order ${escapeEmailHtml(sale.SaleNo)}. Stock is deducted only after payment is confirmed.</p>`)
  });
  return { ...delivery, type: 'payment-link' };
}

export async function sendOrganizationCommerceReceiptEmail(env, sale = {}) {
  const email = clean(sale.CustomerEmail).toLowerCase();
  if (!validEmail(email)) return { ok: false, skipped: true, message: 'Customer email was not provided.' };
  const lines = saleLines(sale);
  const itemText = lines.map((line) => `${line.number}. ${line.name} x ${line.quantity} @ ${line.unitPrice} = ${line.lineTotal}`).join('\n');
  const itemHtml = lines.map((line) => `<tr><td style="padding:8px;border-bottom:1px solid #dce6ee">${escapeEmailHtml(line.name)}</td><td style="padding:8px;border-bottom:1px solid #dce6ee;text-align:center">${line.quantity}</td><td style="padding:8px;border-bottom:1px solid #dce6ee;text-align:right">${escapeEmailHtml(line.unitPrice)}</td><td style="padding:8px;border-bottom:1px solid #dce6ee;text-align:right">${escapeEmailHtml(line.lineTotal)}</td></tr>`).join('');
  const total = amount(sale.Amount || sale.GrossAmount, sale.Currency);
  const customer = clean(sale.CustomerName) || 'Customer';
  const paidAt = clean(sale.PaidAt || sale.SaleDate).replace('T', ' ').replace('Z', '').slice(0, 19);
  const reference = clean(sale.PaymentReference);
  const subject = `Organisation store receipt - ${clean(sale.SaleNo)}`;
  const delivery = await sendConfiguredEmail(env, {
    toEmail: email,
    toName: customer,
    subject,
    textContent: `Dear ${customer},\n\nPayment received with thanks.\n\n${itemText}\n\nTotal paid: ${total}\nReceipt: ${clean(sale.SaleNo)}\nPayment: ${clean(sale.PaymentMethod)}${reference ? `\nReference: ${reference}` : ''}${paidAt ? `\nDate: ${paidAt}` : ''}\n\nPlease retain this receipt for your records.`,
    htmlContent: emailFrame(`<p style="margin:0;color:#0b8f76;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Payment receipt</p><h1 style="margin:6px 0 10px;color:#123f6d;font-size:23px">Payment received</h1><p>Dear ${escapeEmailHtml(customer)},</p><p>Thank you. Your organisation store purchase has been paid and recorded.</p><div style="margin:16px 0;padding:12px;background:#edf5fb"><strong>Receipt:</strong> ${escapeEmailHtml(sale.SaleNo)}<br><strong>Payment:</strong> ${escapeEmailHtml(sale.PaymentMethod)}${reference ? `<br><strong>Reference:</strong> ${escapeEmailHtml(reference)}` : ''}${paidAt ? `<br><strong>Date:</strong> ${escapeEmailHtml(paidAt)}` : ''}</div><table style="width:100%;border-collapse:collapse;margin:18px 0"><thead><tr style="background:#123f6d;color:#fff"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Price</th><th style="padding:8px;text-align:right">Total</th></tr></thead><tbody>${itemHtml}</tbody></table><p style="display:flex;justify-content:space-between;padding:12px;background:#e7f8f2;color:#08735e;font-size:17px"><span>Total paid</span><strong>${escapeEmailHtml(total)}</strong></p><p style="color:#63788d;font-size:12px">Please retain this email as your receipt.</p>`)
  });
  return { ...delivery, type: 'receipt' };
}
