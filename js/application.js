const verifiedRaw = sessionStorage.getItem('dcaAdmissionVerified');
const verifiedBox = document.getElementById('verifiedBox');
const form = document.getElementById('applicationForm');
const statusEl = document.getElementById('submitStatus');
const submitBtn = document.getElementById('submitBtn');
const classSelect = document.getElementById('classApplying');
const classCompletedSelect = document.getElementById('classCompleted');
const dobInput = document.getElementById('dob');
const dobYear = document.getElementById('dobYear');
const dobMonth = document.getElementById('dobMonth');
const dobDay = document.getElementById('dobDay');

let verified = null;
let openClassesLoaded = false;
let applicationIdempotencyKey = '';

function option(value, label = value) {
  const item = document.createElement('option');
  item.value = String(value);
  item.textContent = String(label);
  return item;
}

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function syncDateOfBirth() {
  if (!dobInput || !dobYear || !dobMonth || !dobDay) return;
  const previousDay = dobDay.value;
  const year = Number(dobYear.value);
  const month = Number(dobMonth.value);
  const dayLimit = year && month ? daysInMonth(year, month) : 31;
  dobDay.innerHTML = '<option value="">Day</option>';
  for (let day = 1; day <= dayLimit; day += 1) dobDay.appendChild(option(day, String(day).padStart(2, '0')));
  if (previousDay && Number(previousDay) <= dayLimit) dobDay.value = previousDay;
  const day = Number(dobDay.value);
  const selectedDate = year && month && day ? new Date(year, month - 1, day) : null;
  dobDay.setCustomValidity(selectedDate && selectedDate > new Date() ? 'Date of birth cannot be in the future.' : '');
  dobInput.value = year && month && day
    ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : '';
}

function installDateOfBirthPicker() {
  if (!dobInput || !dobYear || !dobMonth || !dobDay) return;
  const today = new Date();
  const currentYear = today.getFullYear();
  for (let year = currentYear; year >= currentYear - 120; year -= 1) dobYear.appendChild(option(year));
  [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ].forEach((month, index) => dobMonth.appendChild(option(index + 1, month)));
  syncDateOfBirth();
  [dobYear, dobMonth, dobDay].forEach((select) => select.addEventListener('change', syncDateOfBirth));
}

installDateOfBirthPicker();

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

function isLocalDev() {
  return ['localhost', '127.0.0.1', ''].includes(window.location.hostname) || window.location.protocol === 'file:';
}

function getDevVerification() {
  const params = new URLSearchParams(window.location.search);
  if (!isLocalDev() || params.get('dev') !== '1') {
    return null;
  }
  return {
    email: 'test@example.com',
    code: 'TESTCODE',
    receiptNo: 'DEV-TEST-RECEIPT'
  };
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + (type || '');
}

function disableForm() {
  const fields = form.querySelectorAll('input, select, textarea, button');
  fields.forEach((field) => {
    field.disabled = true;
  });
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

  openClassesLoaded = true;
  submitBtn.disabled = classes.length === 0;
}

function setCompletedClassOptions(classes) {
  if (!classCompletedSelect) {
    return;
  }
  const classNames = Array.isArray(classes) ? classes : [];
  classCompletedSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = classNames.length ? 'Select highest class completed' : 'No class records are available yet';
  classCompletedSelect.appendChild(placeholder);
  classNames.forEach((className) => {
    const option = document.createElement('option');
    option.value = className;
    option.textContent = className;
    classCompletedSelect.appendChild(option);
  });
}

function normalizeClassName(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return String(value.ClassName || value.className || value.Name || "").trim();
}

function parseConfiguredClasses(values) {
  const unique = new Set();
  const classes = [];
  (Array.isArray(values) ? values : []).forEach((entry) => {
    const className = normalizeClassName(entry);
    if (!className || unique.has(className.toLowerCase())) {
      return;
    }
    unique.add(className.toLowerCase());
    classes.push(className);
  });
  return classes;
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
    const openClasses = Array.isArray(data.classes) ? data.classes : [];
    const configured = parseConfiguredClasses(data.allClasses || openClasses || data.classes || []);
    setClassOptions(openClasses);
    setCompletedClassOptions(configured);
  } catch (error) {
    setClassOptions([]);
    setCompletedClassOptions([]);
    setStatus(error.message, 'bad');
  }
}

function showUploadOverlay() {
  const uploadOverlay = document.getElementById('uploadOverlay');
  if (uploadOverlay) {
    uploadOverlay.classList.add('show');
  }
}

function hideUploadOverlay() {
  const uploadOverlay = document.getElementById('uploadOverlay');
  if (uploadOverlay) {
    uploadOverlay.classList.remove('show');
  }
}

try {
  verified = JSON.parse(verifiedRaw || 'null');
} catch (_) {
  verified = null;
}

verified = verified || getDevVerification();

if (!verified || !verified.email || !verified.code) {
  window.location.href = 'verify.html';
} else {
  verifiedBox.textContent = `Verified purchase: ${verified.email}${verified.receiptNo ? ' | Receipt: ' + verified.receiptNo : ''}`;
  const parentEmailInput = document.getElementById('parentEmail');
  if (parentEmailInput && !parentEmailInput.value) {
    parentEmailInput.value = verified.email || '';
  }
  loadAdmissionClasses();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!verified) {
    window.location.href = 'verify.html';
    return;
  }

  if (!openClassesLoaded || !classSelect.value) {
    setStatus('Select a class currently open for admission.', 'bad');
    return;
  }

  if (!window.DynamaxActionFeedback.begin(submitBtn, 'Submitting application...')) return;
  showUploadOverlay();
  setStatus('Uploading your application, please wait...', '');

  const formData = new FormData(form);
  const application = {};
  for (const [key, value] of formData.entries()) {
    application[key] = value;
  }

  try {
    applicationIdempotencyKey = applicationIdempotencyKey || newIdempotencyKey();
    const turnstile = window.DynamaxPublicApi?.getTurnstileToken
      ? await window.DynamaxPublicApi.getTurnstileToken('submit_application')
      : {};
    const response = await fetch('/api/submit-application', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': applicationIdempotencyKey
      },
      body: JSON.stringify({
        verification: verified,
        application,
        idempotencyKey: applicationIdempotencyKey,
        ...turnstile
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      if (shouldReleaseIdempotencyKey(response, data)) applicationIdempotencyKey = '';
      throw new Error(data?.message || 'Application submission failed.');
    }

    const reference = data.applicationReference || data.reference || '';
    const applicantName = [
      application.Surname || '',
      application.FirstName || '',
      application.MiddleName || ''
    ].join(' ').replace(/\s+/g, ' ').trim();

    sessionStorage.removeItem('dcaAdmissionVerified');
    applicationIdempotencyKey = '';
    sessionStorage.setItem('dcaApplicationSuccess', JSON.stringify({
      reference,
      applicantName,
      email: verified.email,
      submittedAt: new Date().toISOString()
    }));

    disableForm();
    setStatus('Application submitted successfully. Opening confirmation page...', 'ok');

    const params = new URLSearchParams();
    if (reference) params.set('ref', reference);
    if (applicantName) params.set('name', applicantName);

    window.location.href = `success.html?${params.toString()}`;

  } catch (error) {
    hideUploadOverlay();
    setStatus(error.message, 'bad');
    window.DynamaxActionFeedback.end(submitBtn);
  }
});

form.addEventListener('input', () => {
  if (!submitBtn.disabled) applicationIdempotencyKey = '';
});
