const givingForm = document.getElementById('publicGivingForm');
const givingButton = document.getElementById('publicGivingButton');
const givingStatus = document.getElementById('publicGivingStatus');
const givingOrganisation = document.getElementById('givingOrganisation');
const givingLogo = document.getElementById('givingLogo');
const givingBranch = document.getElementById('givingBranch');
const givingType = document.getElementById('givingType');
const givingCurrency = document.getElementById('givingCurrency');
const givingCurrencyNote = document.getElementById('givingCurrencyNote');
const donorProfileStorageKey = 'dynamax-church-donor-profile-v1';

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
  givingButton.textContent = busy ? 'Opening payment choices…' : 'Choose payment method';
}

const requestedBranch = clean(new URLSearchParams(window.location.search).get('branch')).toLowerCase();
givingBranch.value = /^[a-z0-9._-]{1,80}$/.test(requestedBranch) ? requestedBranch : 'main';

try {
  const savedProfile = JSON.parse(localStorage.getItem(donorProfileStorageKey) || '{}');
  ['DonorName', 'DonorEmail', 'DonorPhone'].forEach((field) => {
    if (givingForm.elements[field] && clean(savedProfile[field])) givingForm.elements[field].value = clean(savedProfile[field]);
  });
  if (savedProfile.SaveDonorProfile && givingForm.elements.SaveDonorProfile) givingForm.elements.SaveDonorProfile.checked = true;
} catch (_error) {
  // A blocked or cleared browser store must never stop a donation.
}

async function loadGivingTypes() {
  try {
    const response = await fetch(
      `/api/public-church-payment?branch=${encodeURIComponent(givingBranch.value)}`,
      { credentials: 'same-origin', cache: 'no-store' }
    );
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load giving types.');
    givingType.innerHTML = (data.givingTypes || []).map((row) =>
      `<option value="${clean(row.Name).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">${clean(row.Name).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`
    ).join('');
    if (!givingType.options.length) throw new Error('No online giving type is active.');
  } catch (error) {
    givingType.innerHTML = '<option value="">Giving is temporarily unavailable</option>';
    givingType.disabled = true;
    givingButton.disabled = true;
    setGivingStatus(error.message || String(error), 'bad');
  }
}

loadGivingTypes();

function updateGivingCurrencyNote() {
  const currency = clean(givingCurrency?.value || 'NGN').toUpperCase();
  if (givingCurrencyNote) givingCurrencyNote.textContent = currency === 'NGN'
    ? 'Accounting base currency: NGN.'
    : `Your payment remains ${currency}. The church will freeze the applicable NGN exchange rate before it enters combined income totals.`;
}

givingCurrency?.addEventListener('change', updateGivingCurrencyNote);
updateGivingCurrencyNote();

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
  let paymentChoice;
  try {
    paymentChoice = await window.DynamaxPaymentMethods.choose({ branchId: givingBranch.value, currency: givingCurrency.value, amount: givingForm.elements.Amount.value });
    if (!paymentChoice) return;
  } catch (error) {
    setGivingStatus(error.message || String(error), 'bad');
    return;
  }
  const idempotencyKey = givingForm.dataset.idempotencyKey || givingRequestId();
  givingForm.dataset.idempotencyKey = idempotencyKey;
  setGivingBusy(true);
  setGivingStatus('Preparing your payment choices…');
  try {
    const turnstile = window.DynamaxPublicApi?.getTurnstileToken
      ? await window.DynamaxPublicApi.getTurnstileToken('church_giving')
      : {};
    const payload = {
      ...Object.fromEntries(new FormData(givingForm).entries()),
      ...paymentChoice,
      PaymentMethod: paymentChoice.paymentMethod,
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
    if (givingForm.elements.SaveDonorProfile?.checked) {
      try {
        localStorage.setItem(donorProfileStorageKey, JSON.stringify({
          DonorName: clean(payload.DonorName),
          DonorEmail: clean(payload.DonorEmail),
          DonorPhone: clean(payload.DonorPhone),
          SaveDonorProfile: true
        }));
      } catch (_error) {
        // The secure payment flow continues even if this browser blocks storage.
      }
    }
    if (data.directTransfer) {
      setGivingStatus(window.DynamaxPaymentMethods.directTransferMessage(data), 'ok');
      setGivingBusy(false);
      return;
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
