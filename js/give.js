const givingForm = document.getElementById('publicGivingForm');
const givingButton = document.getElementById('publicGivingButton');
const givingStatus = document.getElementById('publicGivingStatus');
const givingOrganisation = document.getElementById('givingOrganisation');
const givingLogo = document.getElementById('givingLogo');
const givingBranch = document.getElementById('givingBranch');

function clean(value) {
  return String(value ?? '').trim();
}

function givingRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function setGivingStatus(message = '', tone = '') {
  givingStatus.textContent = message;
  givingStatus.className = `status ${tone}`.trim();
}

function setGivingBusy(busy) {
  givingButton.disabled = busy;
  givingButton.setAttribute('aria-busy', busy ? 'true' : 'false');
  givingButton.textContent = busy ? 'Opening secure payment…' : 'Continue to secure payment';
}

const requestedBranch = clean(new URLSearchParams(window.location.search).get('branch')).toLowerCase();
givingBranch.value = /^[a-z0-9._-]{1,80}$/.test(requestedBranch) ? requestedBranch : 'main';

window.siteProfileReady.then((profile) => {
  const name = clean(profile.OrganisationName || profile.OrganizationName || profile.SchoolName) || 'Dynamax';
  givingOrganisation.textContent = name;
  document.title = `Give to ${name}`;
  const logo = clean(profile.WebLogoUrl);
  if (logo) givingLogo.src = logo;
}).catch(() => null);

givingForm.addEventListener('input', () => {
  if (!givingButton.disabled) delete givingForm.dataset.idempotencyKey;
});

givingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (givingButton.disabled) return;
  const idempotencyKey = givingForm.dataset.idempotencyKey || givingRequestId();
  givingForm.dataset.idempotencyKey = idempotencyKey;
  setGivingBusy(true);
  setGivingStatus('Preparing your secure payment…');
  try {
    const turnstile = window.DynamaxPublicApi?.getTurnstileToken
      ? await window.DynamaxPublicApi.getTurnstileToken('church_giving')
      : {};
    const payload = {
      ...Object.fromEntries(new FormData(givingForm).entries()),
      ...turnstile,
      idempotencyKey
    };
    const response = await fetch('/api/public-church-payment', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({ ok: false, message: 'The payment service returned an invalid response.' }));
    if (!response.ok || !data.ok) {
      const error = new Error(data.message || 'Could not start the payment.');
      error.responseReceived = true;
      throw error;
    }
    const paymentUrl = clean(data.authorizationUrl);
    if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(paymentUrl)) {
      throw new Error('The secure payment address was not returned.');
    }
    setGivingStatus('Payment page ready. Redirecting now…', 'ok');
    window.location.assign(paymentUrl);
  } catch (error) {
    if (error?.responseReceived) delete givingForm.dataset.idempotencyKey;
    setGivingStatus(error.message || String(error), 'bad');
    setGivingBusy(false);
  }
});
