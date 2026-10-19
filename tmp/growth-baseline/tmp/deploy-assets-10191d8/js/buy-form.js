const form = document.getElementById('formPurchaseForm');
const button = document.getElementById('purchaseBtn');
const statusEl = document.getElementById('purchaseStatus');
const classSelect = document.getElementById('classApplyingFor');

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
    setClassOptions(Array.isArray(data.classes) ? data.classes : []);
  } catch (error) {
    setClassOptions([]);
    setStatus(error.message, 'bad');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  setStatus('Starting secure checkout...', '');

  const payload = {
    applicantName: document.getElementById('applicantName').value.trim(),
    email: document.getElementById('email').value.trim().toLowerCase(),
    phone: document.getElementById('phone').value.trim(),
    classApplyingFor: document.getElementById('classApplyingFor').value.trim()
  };

  try {
    const response = await fetch('/api/init-form-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not start payment.');
    }
    window.location.href = data.authorizationUrl;
  } catch (error) {
    setStatus(error.message, 'bad');
    button.disabled = false;
  }
});

loadAdmissionClasses();
