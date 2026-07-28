const statusEl = document.getElementById('confirmationStatus');
const box = document.getElementById('confirmationBox');
const leadEl = document.getElementById('confirmationLead');

function setStatus(message, type) {
  statusEl.textContent = message || '';
  statusEl.className = 'status ' + (type || '');
}

function setLead(message) {
  if (leadEl) {
    leadEl.textContent = message || '';
  }
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN'
  }).format(Number(amount || 0));
}

function shouldReleaseIdempotencyKey(response, data) {
  const status = Number(response?.status || 0);
  if (response?.ok && data?.ok) return true;
  if (status < 400 || status >= 500 || [408, 425, 429].includes(status)) return false;
  if (status === 409 && /IDEMPOTENCY_(IN_PROGRESS|LOCKED|OWNERSHIP_LOST|OUTCOME_UNCERTAIN)|already being processed|outcome.+uncertain|unresolved request|no longer owned/i.test(
    `${data?.code || ''} ${data?.message || ''}`
  )) return false;
  return status < 500;
}

function verificationIdempotency(reference, isFormPurchase) {
  const safeReference = String(reference || '').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
  const storageKey = `dynamaxPaymentVerification:${isFormPurchase ? 'form' : 'general'}:${safeReference}`;
  const deterministicKey = `payment-success:${isFormPurchase ? 'form' : 'general'}:${safeReference}`.slice(0, 160);
  let key = '';
  try {
    key = sessionStorage.getItem(storageKey) || deterministicKey;
    sessionStorage.setItem(storageKey, key);
  } catch (_error) {
    key = deterministicKey;
  }
  return {
    key,
    release() {
      try {
        sessionStorage.removeItem(storageKey);
      } catch (_error) {
        // Storage can be unavailable in hardened/private browser contexts.
      }
    }
  };
}

async function verifyPayment() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');
  const paymentType = params.get('type') || '';
  if (!reference) {
    setStatus('Payment reference is missing. Please contact the Accounts Office.', 'bad');
    return;
  }

  try {
    const isFormPurchase = paymentType.toLowerCase() === 'form';
    const idempotency = verificationIdempotency(reference, isFormPurchase);
    const response = await fetch(isFormPurchase ? '/api/verify-form-payment' : '/api/verify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotency.key
      },
      body: JSON.stringify({ reference, idempotencyKey: idempotency.key })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      if (shouldReleaseIdempotencyKey(response, data)) idempotency.release();
      throw new Error(data?.message || 'Payment could not be verified.');
    }
    idempotency.release();
    setLead(isFormPurchase
      ? 'Your admission form purchase has been confirmed.'
      : 'Your payment has been confirmed.');
    setStatus(isFormPurchase ? 'Admission form purchased successfully.' : 'Payment verified successfully.', 'ok');
    const details = document.createElement('div');
    details.className = 'receipt-box';
    const rows = isFormPurchase
      ? [
          ['Applicant', data.applicantName || 'Admission applicant'],
          ['Email', data.email || ''],
          ['Receipt No.', data.receiptNo || ''],
          ['Verification Code', data.verificationCode || ''],
          ['Amount', formatMoney(data.amount, data.currency)],
          ['Reference', data.reference || reference],
          ['Code Expiry Date', data.expiryDate || '']
        ]
      : [
          ['Fee', data.feeName || 'Online Payment'],
          ['Amount', formatMoney(data.amount, data.currency)],
          ['Reference', data.reference || reference]
        ];

    rows.forEach(([label, value]) => {
      if (!value) return;
      const line = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      line.append(strong, document.createTextNode(value));
      details.appendChild(line);
    });
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = isFormPurchase
      ? 'Use this email address and verification code to register. A copy has also been sent to your email.'
      : 'Your payment has been recorded with the Accounts Office.';
    details.appendChild(note);
    if (isFormPurchase) {
      const link = document.createElement('p');
      const anchor = document.createElement('a');
      anchor.className = 'btn';
      anchor.href = data.formLink || 'verify.html';
      anchor.textContent = 'Register Now';
      link.appendChild(anchor);
      details.appendChild(link);
    }
    box.appendChild(details);
  } catch (error) {
    setLead('We could not confirm your payment automatically.');
    setStatus(error.message, 'bad');
  }
}

verifyPayment();
