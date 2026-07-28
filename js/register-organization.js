const form = document.getElementById('organisationRegistrationForm');
const statusNode = document.getElementById('organisationRegistrationStatus');
let registrationIdempotencyKey = '';

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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusNode.className = 'status';
  statusNode.textContent = 'Submitting registration...';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    registrationIdempotencyKey = registrationIdempotencyKey || newIdempotencyKey();
    const turnstile = window.DynamaxPublicApi?.getTurnstileToken
      ? await window.DynamaxPublicApi.getTurnstileToken('register_organization')
      : {};
    const response = await fetch('/api/register-organization', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': registrationIdempotencyKey
      },
      body: JSON.stringify({
        ...payload,
        idempotencyKey: registrationIdempotencyKey,
        ...turnstile
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      if (shouldReleaseIdempotencyKey(response, data)) registrationIdempotencyKey = '';
      throw new Error(data?.message || 'Registration could not be submitted.');
    }
    statusNode.className = 'status good';
    statusNode.textContent = `${data.message} Reference: ${data.reference}`;
    registrationIdempotencyKey = '';
    form.reset();
  } catch (error) {
    statusNode.className = 'status bad';
    statusNode.textContent = error.message || String(error);
  } finally {
    button.disabled = false;
  }
});

form.addEventListener('input', () => {
  if (!form.querySelector('button[type="submit"]')?.disabled) registrationIdempotencyKey = '';
});
