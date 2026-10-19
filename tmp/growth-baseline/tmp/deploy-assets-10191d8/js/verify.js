const form = document.getElementById('verifyForm');
const statusEl = document.getElementById('status');
const button = document.getElementById('verifyBtn');

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

  button.disabled = true;
  setStatus('Verifying, please wait...', '');

  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Verification failed.');
    }

    sessionStorage.setItem('dcaAdmissionVerified', JSON.stringify({
      email,
      code,
      applicantName: data.applicantName || '',
      receiptNo: data.receiptNo || '',
      verifiedAt: new Date().toISOString()
    }));

    setStatus('Verified. Opening application form...', 'ok');
    window.location.href = 'application.html';
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    button.disabled = false;
  }
});
