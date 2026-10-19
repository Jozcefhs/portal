const form = document.getElementById('formPurchaseForm');
const button = document.getElementById('purchaseBtn');
const statusEl = document.getElementById('purchaseStatus');
const classSelect = document.getElementById('classApplyingFor');
let purchaseIdempotencyKey = '';

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
  statusEl.textContent = message || '';
  statusEl.className = 'status ' + (type || '');
}

function setClassOptions(classes) {
  classSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = classes.length ? 'Select class' : 'No class is currently open for admission';
  classSelect.appendChild(placeholder);

  classes.forEach((className) => {
    const option = document.createElement('option');
    option.value = className;
    option.textContent = className;
    classSelect.appendChild(option);
  });

  button.disabled = classes.length === 0;
}

async function loadAdmissionClasses() {
  try {
    const data = window.DynamaxPublicApi?.getJson
      ? await window.DynamaxPublicApi.getJson('/api/admission-classes', {
          cacheKey: 'admission-classes',
          invalidMessage: 'Could not load available classes because the server returned an error page. Please try again.',
          errorMessage: 'Could not load available classes.'
        })
      : await fetch('/api/admission-classes', { cache: 'no-cache' }).then((response) => response.json());
    if (!data.ok) {
      throw new Error(data.message || 'Could not load available classes.');
    }
    setClassOptions(Array.isArray(data.classes) ? data.classes : []);
  } catch (error) {
    setClassOptions([]);
    setStatus(error.message, 'bad');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!window.DynamaxActionFeedback.begin(button, 'Starting checkout...')) return;
  setStatus('Starting secure checkout...', '');

  const payload = {
    applicantName: document.getElementById('applicantName').value.trim(),
    email: document.getElementById('email').value.trim().toLowerCase(),
    phone: document.getElementById('phone').value.trim(),
    classApplyingFor: document.getElementById('classApplyingFor').value.trim()
  };

  try {
    purchaseIdempotencyKey = purchaseIdempotencyKey || newIdempotencyKey();
    const turnstile = window.DynamaxPublicApi?.getTurnstileToken
      ? await window.DynamaxPublicApi.getTurnstileToken('init_form_payment')
      : {};
    const response = await fetch('/api/init-form-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': purchaseIdempotencyKey
      },
      body: JSON.stringify({
        ...payload,
        idempotencyKey: purchaseIdempotencyKey,
        ...turnstile
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      if (shouldReleaseIdempotencyKey(response, data)) purchaseIdempotencyKey = '';
      throw new Error(data?.message || 'Could not start payment.');
    }
    purchaseIdempotencyKey = '';
    window.location.href = data.authorizationUrl;
  } catch (error) {
    setStatus(error.message, 'bad');
    window.DynamaxActionFeedback.end(button);
  }
});

form.addEventListener('input', () => {
  if (!button.disabled) purchaseIdempotencyKey = '';
});

loadAdmissionClasses();
