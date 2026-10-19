const form = document.getElementById('verifyForm');
const statusEl = document.getElementById('status');
const button = document.getElementById('verifyBtn');
let verificationIdempotencyKey = '';

function newIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const random = window.crypto?.getRandomValues
    ? Array.from(window.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join('')
    : Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}`;
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

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + (type || '');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('email').value.trim().toLowerCase();
  const code = document.getElementById('code').value.trim().toUpperCase();

  if (!email || !code) {
    setStatus('Email and verification code are required.', 'bad');
    return;
  }

  if (!window.DynamaxActionFeedback.begin(button, 'Verifying...')) return;
  setStatus('Verifying, please wait...', '');

  let verifiedSuccessfully = false;
  try {
    verificationIdempotencyKey = verificationIdempotencyKey || newIdempotencyKey();
    const turnstile = window.DynamaxPublicApi?.getTurnstileToken
      ? await window.DynamaxPublicApi.getTurnstileToken('verify_admission')
      : {};
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': verificationIdempotencyKey
      },
      body: JSON.stringify({
        email,
        code,
        idempotencyKey: verificationIdempotencyKey,
        ...turnstile
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      if (shouldReleaseIdempotencyKey(response, data)) verificationIdempotencyKey = '';
      throw new Error(data?.message || 'Verification failed.');
    }

    sessionStorage.setItem('dcaAdmissionVerified', JSON.stringify({
      email,
      code,
      applicantName: data.applicantName || '',
      receiptNo: data.receiptNo || '',
      verifiedAt: new Date().toISOString()
    }));

    setStatus('Verified. Opening application form...', 'ok');
    verifiedSuccessfully = true;
    verificationIdempotencyKey = '';
    window.location.href = 'application.html';
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    if (!verifiedSuccessfully) window.DynamaxActionFeedback.end(button);
  }
});

form.addEventListener('input', () => {
  if (!button.disabled) verificationIdempotencyKey = '';
});
