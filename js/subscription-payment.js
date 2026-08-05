const message = document.getElementById('subscriptionPaymentMessage');
const result = document.getElementById('subscriptionPaymentResult');
const params = new URLSearchParams(window.location.search);
const reference = params.get('reference') || params.get('trxref') || '';
const registrationReference = params.get('registration') || '';

function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function confirmPayment() {
  if (!reference) {
    message.textContent = 'The Paystack payment reference is missing.';
    result.innerHTML = '<p class="status bad">Return to the plans page and start the payment again.</p>';
    return;
  }
  try {
    const response = await fetch('/api/verify-subscription-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference, registrationReference })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Subscription payment could not be confirmed.');
    message.textContent = data.message;
    result.innerHTML = `<dl class="subscription-confirmation-summary"><div><dt>Reference</dt><dd>${safeText(data.registrationReference)}</dd></div><div><dt>Plan</dt><dd>${safeText(data.plan)}</dd></div><div><dt>Billing</dt><dd>${safeText(data.billingCycle)}</dd></div></dl>`;
  } catch (error) {
    message.textContent = 'Payment confirmation needs attention.';
    result.innerHTML = `<p class="status bad">${safeText(error.message || error)}</p>`;
  }
}

confirmPayment();
