const form = document.getElementById('verifyAcademicTranscriptForm');
const numberField = document.getElementById('academicTranscriptNumber');
const status = document.getElementById('academicTranscriptVerificationStatus');
const details = document.getElementById('academicTranscriptVerificationDetails');

const clean = (value) => String(value ?? '').trim();
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function showResult(data) {
  status.className = `academic-result-verification-status ${data.valid ? 'is-valid' : 'is-invalid'}`;
  status.textContent = data.message || (data.valid ? 'Transcript verified.' : 'Transcript not found.');
  if (!data.valid || !data.transcript) {
    details.hidden = true;
    details.replaceChildren();
    return;
  }
  const rows = [
    ['Transcript number', data.transcript.TranscriptNumber],
    ['Status', data.transcript.Status],
    ['Version', data.transcript.Version],
    ['Academic sessions', data.transcript.SessionCount],
    ['Issued', data.transcript.IssuedAt ? new Date(data.transcript.IssuedAt).toLocaleDateString() : 'Not recorded']
  ];
  details.innerHTML = rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
  details.hidden = false;
}

async function verify(number) {
  status.className = 'academic-result-verification-status';
  status.textContent = 'Checking the official register...';
  details.hidden = true;
  const response = await fetch(`/api/verify-academic-transcript?number=${encodeURIComponent(number)}`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({ ok: false, valid: false, message: 'Verification did not return a valid response.' }));
  showResult(data);
}

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const number = clean(numberField.value).toUpperCase();
  numberField.value = number;
  void verify(number).catch((error) => showResult({ valid: false, message: error.message || 'Verification is unavailable.' }));
});

const requested = clean(new URLSearchParams(window.location.search).get('number')).toUpperCase();
if (requested && numberField) {
  numberField.value = requested;
  void verify(requested).catch((error) => showResult({ valid: false, message: error.message || 'Verification is unavailable.' }));
}
