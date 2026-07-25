const verifiedRaw = sessionStorage.getItem('dcaAdmissionVerified');
const verifiedBox = document.getElementById('verifiedBox');
const form = document.getElementById('applicationForm');
const statusEl = document.getElementById('submitStatus');
const submitBtn = document.getElementById('submitBtn');
const classSelect = document.getElementById('classApplying');
const classCompletedSelect = document.getElementById('classCompleted');

let verified = null;
let openClassesLoaded = false;

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
    const response = await fetch('/api/admission-classes');
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_err) {
      throw new Error('Could not load available classes because the server returned an error page. Please try again.');
    }
    if (!response.ok || !data.ok) {
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

  submitBtn.disabled = true;
  showUploadOverlay();
  setStatus('Uploading your application, please wait...', '');

  const formData = new FormData(form);
  const application = {};
  for (const [key, value] of formData.entries()) {
    application[key] = value;
  }

  try {
    const response = await fetch('/api/submit-application', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verification: verified,
        application
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Application submission failed.');
    }

    const reference = data.applicationReference || data.reference || '';
    const applicantName = [
      application.Surname || '',
      application.FirstName || '',
      application.MiddleName || ''
    ].join(' ').replace(/\s+/g, ' ').trim();

    sessionStorage.removeItem('dcaAdmissionVerified');
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
    submitBtn.disabled = false;
  }
});
