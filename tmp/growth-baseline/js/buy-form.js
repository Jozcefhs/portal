const form = document.getElementById('formPurchaseForm');
const button = document.getElementById('purchaseBtn');
const statusEl = document.getElementById('purchaseStatus');
const classSelect = document.getElementById('classApplyingFor');
const branchSelect = document.getElementById('admissionBranch');
const alreadyPaidLink = document.getElementById('alreadyPaidLink');
let purchaseIdempotencyKey = '';
let defaultFormAmount = 0;
let classFormAmounts = new Map();
let admissionLoadSerial = 0;

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

function setBranchOptions(branches, selectedBranchId) {
  branchSelect.innerHTML = '';
  (Array.isArray(branches) ? branches : []).forEach((branch) => {
    const option = document.createElement('option');
    option.value = String(branch.id || '').trim();
    option.textContent = String(branch.name || branch.id || '').trim();
    branchSelect.appendChild(option);
  });
  branchSelect.value = selectedBranchId || branchSelect.options[0]?.value || '';
  branchSelect.disabled = branchSelect.options.length < 2;
}

function updateBranchLinks(branchId) {
  const url = new URL(window.location.href);
  if (branchId) url.searchParams.set('branch', branchId);
  else url.searchParams.delete('branch');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  if (alreadyPaidLink) {
    alreadyPaidLink.href = branchId ? `verify.html?branch=${encodeURIComponent(branchId)}` : 'verify.html';
  }
}

async function loadAdmissionClasses(requestedBranchId = '') {
  const loadSerial = ++admissionLoadSerial;
  try {
    const branchQuery = requestedBranchId ? `?branchId=${encodeURIComponent(requestedBranchId)}` : '';
    const data = window.DynamaxPublicApi?.getJson
      ? await window.DynamaxPublicApi.getJson(`/api/admission-classes${branchQuery}`, {
          cacheKey: `admission-classes:${requestedBranchId || 'active'}`,
          cache: false,
          force: true,
          invalidMessage: 'Could not load available classes because the server returned an error page. Please try again.',
          errorMessage: 'Could not load available classes.'
        })
      : await fetch(`/api/admission-classes${branchQuery}`, { cache: 'no-cache' }).then((response) => response.json());
    if (!data.ok) {
      throw new Error(data.message || 'Could not load available classes.');
    }
    if (loadSerial !== admissionLoadSerial) return;
    defaultFormAmount = Number(data.formAmount || 0);
    classFormAmounts = new Map((data.allClasses || []).map((row) => [
      String(row.ClassName || '').trim().toLowerCase(),
      Number(row.FormAmount || 0)
    ]));
    setBranchOptions(data.availableBranches, data.branchId);
    updateBranchLinks(data.branchId);
    setClassOptions(Array.isArray(data.classes) ? data.classes : []);
    setStatus('', '');
    if (window.DynamaxPublicApi?.refreshSiteProfile && data.branchId) {
      window.DynamaxPublicApi.refreshSiteProfile({ branchId: data.branchId }).catch(() => null);
    }
  } catch (error) {
    if (loadSerial !== admissionLoadSerial) return;
    setClassOptions([]);
    setStatus(error.message, 'bad');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    applicantName: document.getElementById('applicantName').value.trim(),
    email: document.getElementById('email').value.trim().toLowerCase(),
    phone: document.getElementById('phone').value.trim(),
    classApplyingFor: document.getElementById('classApplyingFor').value.trim(),
    branchId: branchSelect.value.trim()
  };

  try {
    const branchId = payload.branchId;
    const amount = classFormAmounts.get(payload.classApplyingFor.toLowerCase()) || defaultFormAmount;
    const paymentChoice = await window.DynamaxPaymentMethods.choose({ branchId, currency: 'NGN', amount });
    if (!paymentChoice) return;
    if (!window.DynamaxActionFeedback.begin(button, paymentChoice.paymentMethod === 'direct_bank_transfer' ? 'Submitting transfer...' : 'Starting checkout...')) return;
    setStatus(paymentChoice.paymentMethod === 'direct_bank_transfer' ? 'Submitting your transfer for verification...' : 'Starting secure checkout...', '');
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
        ...paymentChoice,
        branchId,
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
    if (data.directTransfer) {
      setStatus(window.DynamaxPaymentMethods.directTransferMessage(data), 'ok');
      window.DynamaxActionFeedback.end(button);
      return;
    }
    window.location.href = data.authorizationUrl;
  } catch (error) {
    setStatus(error.message, 'bad');
    window.DynamaxActionFeedback.end(button);
  }
});

form.addEventListener('input', () => {
  if (!button.disabled) purchaseIdempotencyKey = '';
});

branchSelect.addEventListener('change', () => {
  purchaseIdempotencyKey = '';
  setClassOptions([]);
  setStatus('Loading this branch\'s admission setup...', '');
  loadAdmissionClasses(branchSelect.value);
});

loadAdmissionClasses(new URLSearchParams(window.location.search).get('branch') || '');
