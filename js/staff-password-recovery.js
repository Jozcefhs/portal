const status = document.getElementById('recoveryStatus');
let busy = false;

function result(message, ok) {
  status.textContent = message;
  void window.DynamaxDialogs.alert({
    title: ok ? 'Request completed' : 'Action not completed', tone: ok ? 'success' : 'danger', message
  });
}

async function submit(form, action) {
  if (busy) return;
  const data = Object.fromEntries(new FormData(form));
  if (action === 'reset' && data.password !== data.confirmPassword) {
    result('The new passwords do not match.', false);
    return;
  }
  delete data.confirmPassword;
  busy = true;
  const buttons = [...document.querySelectorAll('.recovery-shell button')];
  buttons.forEach(button => { button.disabled = true; });
  status.textContent = action === 'request' ? 'Requesting a recovery code…' : 'Resetting your password…';
  try {
    const response = await fetch('/api/staff-password-recovery', {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, action })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || 'Recovery is temporarily unavailable.');
    if (action === 'reset') form.reset();
    result(payload.message, true);
  } catch (error) {
    result(error instanceof TypeError ? 'The connection failed. If you submitted a reset, try signing in before requesting another code.' : error.message, false);
  } finally {
    busy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

for (const [id, action] of [['requestRecoveryForm', 'request'], ['resetPasswordForm', 'reset']]) {
  document.getElementById(id).addEventListener('submit', event => {
    event.preventDefault();
    submit(event.currentTarget, action);
  });
}
