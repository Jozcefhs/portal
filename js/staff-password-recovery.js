const status = document.getElementById('recoveryStatus');
const ownerSection = document.getElementById('owner-recovery');
const recoveryType = document.getElementById('recoveryType');
let busy = false;

function selectRecoveryType(type) {
  const owner = type === 'owner';
  const minimum = owner ? 12 : 6;
  recoveryType.value = type;
  ownerSection.open = owner;
  document.getElementById('newPasswordLabel').textContent = `New password (${minimum}–128 characters)`;
  document.getElementById('newPassword').minLength = minimum;
  document.getElementById('confirmPassword').minLength = minimum;
  const fragment = owner ? '#owner-recovery' : '#staff-recovery';
  if (window.location.hash !== fragment) window.history.replaceState(null, '', fragment);
}

function readRecoveryType() {
  selectRecoveryType(window.location.hash === '#owner-recovery' ? 'owner' : 'staff');
}
readRecoveryType();
window.addEventListener('hashchange', readRecoveryType);
recoveryType.addEventListener('change', () => selectRecoveryType(recoveryType.value));
ownerSection.addEventListener('toggle', () => {
  if (ownerSection.open && recoveryType.value !== 'owner') selectRecoveryType('owner');
});

function result(message, ok) {
  status.textContent = message;
  void window.DynamaxDialogs.alert({
    title: ok ? 'Request completed' : 'Action not completed', tone: ok ? 'success' : 'danger', message
  });
}

async function submit(form, action) {
  if (busy) return;
  if (action === 'request' || action === 'request-owner') selectRecoveryType(action === 'request-owner' ? 'owner' : 'staff');
  const data = Object.fromEntries(new FormData(form));
  if (action === 'reset' && data.password !== data.confirmPassword) {
    result('The new passwords do not match.', false);
    return;
  }
  delete data.confirmPassword;
  busy = true;
  const buttons = [...document.querySelectorAll('.recovery-shell button')];
  buttons.forEach(button => { button.disabled = true; });
  status.textContent = action === 'reset' ? 'Resetting your password…' : 'Requesting a recovery code…';
  try {
    const response = await fetch('/api/staff-password-recovery', {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, action })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true) throw new Error(payload.message || 'Recovery is temporarily unavailable.');
    if (action === 'reset') {
      form.reset();
      window.location.replace(document.getElementById('staffSignInLink').href);
      return;
    }
    result(payload.message, true);
  } catch (error) {
    result(error instanceof TypeError ? 'The connection failed. If you submitted a reset, try signing in before requesting another code.' : error.message, false);
  } finally {
    busy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

for (const [id, action] of [['requestRecoveryForm', 'request'], ['ownerRecoveryForm', 'request-owner'], ['resetPasswordForm', 'reset']]) {
  document.getElementById(id).addEventListener('submit', event => {
    event.preventDefault();
    submit(event.currentTarget, action);
  });
}
