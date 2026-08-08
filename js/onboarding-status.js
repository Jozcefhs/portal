const summary = document.getElementById('onboardingSummary');
const statusNode = document.getElementById('onboardingStatus');
const nextCheckNode = document.getElementById('onboardingNextCheck');
const checkNowButton = document.getElementById('onboardingCheckNow');
const workspaceProgress = document.getElementById('workspaceProgress');
const workspaceProgressText = document.getElementById('workspaceProgressText');
const administratorProgress = document.getElementById('administratorProgress');
const storageKey = 'dynamaxRegistrationOnboarding';
let timer = null;
let checking = false;
let credentials = null;

function clean(value) { return String(value ?? '').trim(); }
function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function loadCredentials() {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fromFragment = { reference: clean(fragment.get('reference')), token: clean(fragment.get('token')) };
  if (fromFragment.reference && fromFragment.token) {
    sessionStorage.setItem(storageKey, JSON.stringify(fromFragment));
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return fromFragment;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    return { reference: clean(saved.reference), token: clean(saved.token) };
  } catch (_error) {
    return { reference: '', token: '' };
  }
}

function renderSummary(data) {
  summary.hidden = false;
  summary.innerHTML = `<dl>
    <div><dt>Organisation</dt><dd>${escapeHtml(data.organisationName || 'Your organisation')}</dd></div>
    <div><dt>Registration</dt><dd>${escapeHtml(data.reference)}</dd></div>
    <div><dt>Plan</dt><dd>${escapeHtml(data.plan || 'Pending')}</dd></div>
    <div><dt>Status</dt><dd>${escapeHtml(data.provisioningStatus || data.status || 'Preparing')}</dd></div>
  </dl>`;
  if (data.workspaceReady) {
    workspaceProgress.classList.add('is-complete');
    workspaceProgressText.textContent = 'Your isolated tenant project has been assigned.';
  }
  if (data.ready) administratorProgress.classList.add('is-complete');
}

function schedule(seconds = 60) {
  clearTimeout(timer);
  const delay = Math.max(10, Number(seconds || 60));
  nextCheckNode.textContent = `Dynamax will check again in about ${delay} seconds.`;
  timer = setTimeout(() => {
    if (document.hidden) {
      schedule(delay);
      return;
    }
    checkStatus();
  }, delay * 1000);
}

async function checkStatus() {
  if (checking || !credentials?.reference || !credentials?.token) return;
  checking = true;
  clearTimeout(timer);
  nextCheckNode.textContent = '';
  window.DynamaxActionFeedback?.begin?.(checkNowButton, 'Checking...');
  try {
    const response = await fetch('/api/registration-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'The onboarding status could not be loaded.');
    renderSummary(data);
    statusNode.className = 'status good';
    statusNode.textContent = data.message;
    if (data.destinationUrl) {
      sessionStorage.removeItem(storageKey);
      nextCheckNode.textContent = 'Opening your secure administrator page...';
      window.location.replace(data.destinationUrl);
      return;
    }
    schedule(data.retryAfterSeconds || 60);
  } catch (error) {
    statusNode.className = 'status bad';
    statusNode.textContent = error.message || String(error);
    schedule(60);
  } finally {
    checking = false;
    window.DynamaxActionFeedback?.end?.(checkNowButton);
  }
}

credentials = loadCredentials();
if (!credentials.reference || !credentials.token) {
  statusNode.className = 'status bad';
  statusNode.textContent = 'This onboarding status link is incomplete. Submit the organisation registration again.';
  checkNowButton.hidden = true;
} else {
  checkNowButton.addEventListener('click', checkStatus);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !checking) checkStatus();
  });
  checkStatus();
}
