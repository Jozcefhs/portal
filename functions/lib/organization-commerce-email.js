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
  return `<div style="margin:0;background:#eef4f8;padding:16px 10px;color:#17324d;font-family:Arial,sans-serif"><div style="max-width:640px;margin:auto;border-top:6px solid #0b8f76;border-radius:12px;background:#fff;padding:20px;box-shadow:0 10px 28px #173b5818">${content}<p style="margin:26px 0 0;border-top:1px solid #d9e5ee;padding-top:14px;color:#63788d;font-size:12px">Sent securely by the organisation store.</p></div></div>`;
}

function paymentItemsTable(lines = []) {
  const rows = lines.map((line) => `<tr><td width="52%" style="width:52%;padding:8px 5px;border-bottom:1px solid #dce6ee;vertical-align:middle;line-height:16px;overflow-wrap:anywhere">${escapeEmailHtml(line.name)}</td><td width="14%" style="width:14%;padding:8px 3px;border-bottom:1px solid #dce6ee;text-align:center;vertical-align:middle;white-space:nowrap">${line.quantity}</td><td width="34%" style="width:34%;padding:8px 5px;border-bottom:1px solid #dce6ee;text-align:right;vertical-align:middle;white-space:nowrap;font-size:12px">${escapeEmailHtml(line.lineTotal)}</td></tr>`).join('');
  return `<table aria-label="Order items" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;margin:18px 0;font-size:13px"><thead><tr style="background:#123f6d;color:#fff"><th width="52%" style="width:52%;padding:8px 5px;text-align:left">Item</th><th width="14%" style="width:14%;padding:8px 3px;text-align:center">Qty</th><th width="34%" style="width:34%;padding:8px 5px;text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function receiptItemsTable(lines = []) {
  const rows = lines.map((line) => `<tr><td width="28%" style="width:28%;padding:8px 4px;border-bottom:1px solid #dce6ee;vertical-align:middle;line-height:16px;overflow-wrap:anywhere">${escapeEmailHtml(line.name)}</td><td width="12%" style="width:12%;padding:8px 2px;border-bottom:1px solid #dce6ee;text-align:center;vertical-align:middle;white-space:nowrap">${line.quantity}</td><td width="30%" style="width:30%;padding:8px 3px;border-bottom:1px solid #dce6ee;text-align:right;vertical-align:middle;white-space:nowrap;font-size:11px;letter-spacing:-0.2px">${escapeEmailHtml(line.unitPrice)}</td><td width="30%" style="width:30%;padding:8px 3px;border-bottom:1px solid #dce6ee;text-align:right;vertical-align:middle;white-space:nowrap;font-size:11px;letter-spacing:-0.2px">${escapeEmailHtml(line.lineTotal)}</td></tr>`).join('');
  return `<table aria-label="Purchased items" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;margin:18px 0;font-size:13px"><thead><tr style="background:#123f6d;color:#fff"><th width="28%" style="width:28%;padding:8px 4px;text-align:left">Item</th><th width="12%" style="width:12%;padding:8px 2px;text-align:center">Qty</th><th width="30%" style="width:30%;padding:8px 3px;text-align:right">Price</th><th width="30%" style="width:30%;padding:8px 3px;text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function totalSummary(label, total) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#e7f8f2;color:#08735e"><tr><td style="padding:12px;font-size:16px;line-height:20px">${escapeEmailHtml(label)}</td><td style="padding:12px;text-align:right;font-size:17px;line-height:20px;white-space:nowrap"><strong>${escapeEmailHtml(total)}</strong></td></tr></table>`;
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
  const itemHtml = paymentItemsTable(lines);
  const total = amount(sale.Amount || sale.GrossAmount, sale.Currency);
  const customer = clean(sale.CustomerName) || 'Customer';
  const subject = `Complete your organisation store payment - ${clean(sale.SaleNo)}`;
  const delivery = await sendConfiguredEmail(env, {
    toEmail: email,
    toName: customer,
    subject,
    textContent: `Dear ${customer},\n\nYour organisation store order is ready for payment.\n\n${itemText}\n\nTotal: ${total}\nOrder: ${clean(sale.SaleNo)}\n\nComplete payment securely: ${link}\n\nStock is deducted only after payment is confirmed.`,
    htmlContent: emailFrame(`<p style="margin:0;color:#0b8f76;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Organisation store</p><h1 style="margin:6px 0 10px;color:#123f6d;font-size:23px">Complete your payment</h1><p>Dear ${escapeEmailHtml(customer)},</p><p>Your order is ready. Use the secure button below to complete payment.</p>${itemHtml}${totalSummary('Total', total)}<p style="margin:22px 0;text-align:center"><a href="${escapeEmailHtml(link)}" style="display:inline-block;border-radius:8px;background:#1769e0;padding:12px 18px;color:#fff;font-weight:bold;text-decoration:none">Complete secure payment</a></p><p style="color:#63788d;font-size:12px">Order ${escapeEmailHtml(sale.SaleNo)}. Stock is deducted only after payment is confirmed.</p>`)
  });
  return { ...delivery, type: 'payment-link' };
}

export async function sendOrganizationCommerceReceiptEmail(env, sale = {}) {
  const email = clean(sale.CustomerEmail).toLowerCase();
  if (!validEmail(email)) return { ok: false, skipped: true, message: 'Customer email was not provided.' };
  const lines = saleLines(sale);
  const itemText = lines.map((line) => `${line.number}. ${line.name} x ${line.quantity} @ ${line.unitPrice} = ${line.lineTotal}`).join('\n');
  const itemHtml = receiptItemsTable(lines);
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
    htmlContent: emailFrame(`<p style="margin:0;color:#0b8f76;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Payment receipt</p><h1 style="margin:6px 0 10px;color:#123f6d;font-size:23px">Payment received</h1><p>Dear ${escapeEmailHtml(customer)},</p><p>Thank you. Your organisation store purchase has been paid and recorded.</p><div style="margin:16px 0;padding:12px;background:#edf5fb"><strong>Receipt:</strong> ${escapeEmailHtml(sale.SaleNo)}<br><strong>Payment:</strong> ${escapeEmailHtml(sale.PaymentMethod)}${reference ? `<br><strong>Reference:</strong> ${escapeEmailHtml(reference)}` : ''}${paidAt ? `<br><strong>Date:</strong> ${escapeEmailHtml(paidAt)}` : ''}</div>${itemHtml}${totalSummary('Total paid', total)}<p style="color:#63788d;font-size:12px">Please retain this email as your receipt.</p>`)
  });
  return { ...delivery, type: 'receipt' };
}
