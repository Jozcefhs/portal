const form = document.getElementById('activationForm');
const statusNode = document.getElementById('activationStatus');
const summaryNode = document.getElementById('activationSummary');
const loginLink = document.getElementById('activationLogin');
const submitButton = document.getElementById('activationSubmit');

const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const activationId = fragment.get('activation') || '';
const token = fragment.get('token') || '';
if (window.location.hash) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function suggestedUsername(email) {
  const local = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return local.length >= 3 ? local.slice(0, 80) : 'admin';
}

function setFailure(message) {
  statusNode.className = 'status bad';
  statusNode.textContent = message;
  form.hidden = true;
}

async function activationRequest(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.message || 'The activation request could not be completed.');
  return data;
}

async function inspectActivation() {
  if (!activationId || !token) {
    setFailure('This activation link is incomplete. Use the complete link sent after organisation registration.');
    return;
  }
  try {
    const data = await activationRequest('/api/tenant-activation', { action: 'inspect', activationId, token });
    summaryNode.innerHTML = `<dl><div><dt>Organisation</dt><dd>${escapeHtml(data.organisationName)}</dd></div><div><dt>Registered email</dt><dd>${escapeHtml(data.email)}</dd></div><div><dt>Plan</dt><dd>${escapeHtml(data.plan)}</dd></div><div><dt>Workspace</dt><dd>${escapeHtml(data.workspaceId)}</dd></div></dl>`;
    summaryNode.hidden = false;
    document.getElementById('activationDisplayName').value = data.contactName || '';
    document.getElementById('activationUsername').value = suggestedUsername(data.email);
    form.hidden = false;
    statusNode.className = 'status good';
    statusNode.textContent = `Link verified. It expires ${new Date(data.expiresAt).toLocaleString()}.`;
    document.getElementById('activationDisplayName').focus();
  } catch (error) {
    setFailure(error.message || String(error));
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  if (payload.password !== payload.confirmPassword) {
    statusNode.className = 'status bad';
    statusNode.textContent = 'Passwords do not match.';
    return;
  }
  const feedbackStarted = window.DynamaxActionFeedback?.begin?.(submitButton, 'Creating account...');
  if (feedbackStarted === false) return;
  statusNode.className = 'status';
  statusNode.textContent = 'Creating your secure administrator account...';
  try {
    const data = await activationRequest('/api/complete-tenant-activation', { activationId, token, ...payload });
    form.reset();
    form.hidden = true;
    statusNode.className = 'status good';
    statusNode.textContent = data.message;
    loginLink.href = data.loginUrl || `admin.html?activated=1&username=${encodeURIComponent(data.username || '')}`;
    loginLink.hidden = false;
  } catch (error) {
    statusNode.className = 'status bad';
    statusNode.textContent = error.message || String(error);
  } finally {
    if (feedbackStarted) window.DynamaxActionFeedback?.end?.(submitButton);
  }
});

inspectActivation();
