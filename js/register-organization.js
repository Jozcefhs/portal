const form = document.getElementById('organisationRegistrationForm');
const statusNode = document.getElementById('organisationRegistrationStatus');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusNode.className = 'status';
  statusNode.textContent = 'Submitting registration...';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const response = await fetch('/api/register-organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Registration could not be submitted.');
    statusNode.className = 'status good';
    statusNode.textContent = `${data.message} Reference: ${data.reference}`;
    form.reset();
  } catch (error) {
    statusNode.className = 'status bad';
    statusNode.textContent = error.message || String(error);
  } finally {
    button.disabled = false;
  }
});
