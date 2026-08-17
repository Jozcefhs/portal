const form = document.getElementById('verifyAcademicResultForm');
const input = document.getElementById('academicResultReference');
const status = document.getElementById('academicResultVerificationStatus');

function clean(value) { return String(value ?? '').trim(); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

async function verify(reference) {
  status.className = 'academic-result-verification-status is-loading';
  status.textContent = 'Checking the published result register...';
  const response = await fetch(`/api/verify-academic-result?reference=${encodeURIComponent(reference)}`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({ ok: false, valid: false, message: 'The verification service did not return a valid response.' }));
  if (!response.ok || !data.ok) throw new Error(data.message || 'Result verification failed.');
  status.className = `academic-result-verification-status ${data.valid ? 'is-valid' : 'is-invalid'}`;
  if (!data.valid) {
    status.innerHTML = `<strong>Not verified</strong><span>${escapeHtml(data.message)}</span>`;
    return;
  }
  const result = data.result || {};
  status.innerHTML = `<strong>Published result verified</strong><span>${escapeHtml(result.ResultReference)}</span><dl><div><dt>Period</dt><dd>${escapeHtml([result.Term, result.AcademicSession].filter(Boolean).join(' · '))}</dd></div><div><dt>Classroom</dt><dd>${escapeHtml([result.ClassName, result.ArmName].filter(Boolean).join(' / '))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(result.PublicationStatus)}</dd></div><div><dt>Subjects</dt><dd>${escapeHtml(result.SubjectCount)}</dd></div></dl>`;
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const reference = clean(input.value).toUpperCase();
  if (!reference) return;
  const button = form.querySelector('button');
  button.disabled = true;
  try { await verify(reference); } catch (error) {
    status.className = 'academic-result-verification-status is-invalid';
    status.innerHTML = `<strong>Verification unavailable</strong><span>${escapeHtml(error.message || String(error))}</span>`;
  } finally { button.disabled = false; }
});

const initial = clean(new URLSearchParams(location.search).get('reference')).toUpperCase();
if (initial) {
  input.value = initial;
  verify(initial).catch((error) => {
    status.className = 'academic-result-verification-status is-invalid';
    status.textContent = error.message || String(error);
  });
}
