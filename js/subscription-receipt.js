const message = document.getElementById('receiptMessage');
const statusBadge = document.getElementById('receiptStatus');
const content = document.getElementById('receiptContent');
const params = new URLSearchParams(window.location.search);

function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function displayDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value || '—');
}

function displayMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency', currency: String(currency || 'NGN').toUpperCase(), minimumFractionDigits: 2
    }).format(Number(amount || 0));
  } catch (_error) {
    return `${safeText(currency || 'NGN')} ${Number(amount || 0).toFixed(2)}`;
  }
}

function field(label, value) {
  return `<div class="receipt-field"><span>${safeText(label)}</span><strong>${safeText(value || '—')}</strong></div>`;
}

async function loadReceipt() {
  const reference = params.get('reference') || '';
  const registration = params.get('registration') || '';
  if (!reference || !registration) throw new Error('The receipt link is incomplete.');
  const query = new URLSearchParams({ reference, registration });
  const response = await fetch(`/api/subscription-receipt?${query}`, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.message || 'The receipt could not be loaded.');
  const receipt = data.receipt;
  document.title = `${receipt.receiptNo} — Dynamax receipt`;
  statusBadge.textContent = 'PAID';
  message.textContent = 'Official payment confirmation';
  content.innerHTML = `<div class="receipt-grid">${field('Receipt number', receipt.receiptNo)}${field('Paid at', displayDate(receipt.paidAt))}${field('Subscriber', receipt.organisationName)}${field('Contact', receipt.contactName)}${field('Plan', `${receipt.plan} (${receipt.billingCycle})`)}${field('Active users', receipt.userLimit)}${field('Payment method', receipt.paymentMethod)}${field('Payment reference', receipt.paymentReference)}${receipt.providerTransactionId ? field('Provider transaction', receipt.providerTransactionId) : ''}${receipt.bankReference ? field('Bank reference', receipt.bankReference) : ''}</div><div class="receipt-amount"><span>Amount paid</span><strong>${safeText(displayMoney(receipt.amount, receipt.currency))}</strong></div><div class="receipt-actions"><button type="button" class="primary-button" id="printReceipt">Print / Save as PDF</button><a class="settings-link" href="register-organization.html#plans">View plans</a></div><p class="receipt-note">This receipt was generated from the verified Dynamax subscription payment record. Keep it for your organisation's records.</p>`;
  document.getElementById('printReceipt').addEventListener('click', () => window.print());
}

loadReceipt().catch((error) => {
  statusBadge.textContent = 'UNAVAILABLE';
  message.textContent = 'Receipt needs attention';
  content.innerHTML = `<p class="status bad">${safeText(error.message || error)}</p><p><a class="settings-link" href="register-organization.html#plans">Return to plans</a></p>`;
});
