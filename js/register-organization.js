const form = document.getElementById('organisationRegistrationForm');
const statusNode = document.getElementById('organisationRegistrationStatus');
const planGrid = document.getElementById('planChoiceGrid');
const planComparisonGrid = document.getElementById('planComparisonGrid');
let registrationIdempotencyKey = '';
let planCatalog = null;

const fallbackPlans = [
  { Name: 'Starter', Summary: 'Core records for a small team', UserLimit: 5, MonthlyAmount: 0, YearlyAmount: 0, Active: true, FeaturesByEdition: { school: ['Student and admission records', 'Parent portal', 'Records Desk'], faith: ['Member records', 'Services and attendance', 'Departments'], organization: ['People records', 'Departments', 'Records Desk'] } },
  { Name: 'Standard', Summary: 'Finance, people and approval workflows', UserLimit: 20, MonthlyAmount: 0, YearlyAmount: 0, Active: true, FeaturesByEdition: { school: ['Everything in Starter', 'Finance and income analytics', 'Bills, requisitions and approvals', 'Human Resources'], faith: ['Everything in Starter', 'Funds, offerings and donations', 'Finance and income analytics', 'Human Resources'], organization: ['Everything in Starter', 'Finance and income analytics', 'Bills, requisitions and approvals', 'Human Resources'] } },
  { Name: 'Professional', Summary: 'Full operations for a growing organisation', UserLimit: 50, MonthlyAmount: 0, YearlyAmount: 0, Active: true, FeaturesByEdition: { school: ['Everything in Standard', 'Payroll', 'Clinic, conduct and school stores', 'All school operation modules'], faith: ['Everything in Standard', 'Payroll', 'Organisation store and restaurant', 'All church operation modules'], organization: ['Everything in Standard', 'Payroll', 'Commerce', 'All organisation operation modules'] } },
  { Name: 'Enterprise', Summary: 'Custom users, modules and onboarding', UserLimit: 250, MonthlyAmount: 0, YearlyAmount: 0, Active: true, FeaturesByEdition: { school: ['Everything in Professional', 'Custom active-user allowance', 'Custom module policy', 'Priority onboarding'], faith: ['Everything in Professional', 'Custom active-user allowance', 'Custom module policy', 'Priority onboarding'], organization: ['Everything in Professional', 'Custom active-user allowance', 'Custom module policy', 'Priority onboarding'] } }
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function edition() {
  const value = String(form.elements.Edition?.value || 'school').toLowerCase();
  return ['faith', 'organization'].includes(value) ? value : 'school';
}

function billingCycle() {
  return form.querySelector('[name="BillingCycle"]:checked')?.value === 'yearly' ? 'yearly' : 'monthly';
}

function formattedPrice(amount, currency = 'NGN') {
  if (!(Number(amount) > 0)) return 'Price to be confirmed';
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
  } catch (_error) {
    return `${currency} ${Number(amount).toLocaleString('en-NG')}`;
  }
}

function selectedPlanName() {
  return form.querySelector('[name="Plan"]:checked')?.value || 'Starter';
}

function renderPlans() {
  const plans = planCatalog?.Plans?.length ? planCatalog.Plans : fallbackPlans;
  const current = selectedPlanName();
  const cycle = billingCycle();
  const currentEdition = edition();
  const available = plans.filter((plan) => plan.Active !== false);
  const selectedName = available.some((plan) => plan.Name === current) ? current : available[0]?.Name;
  planGrid.innerHTML = plans.map((plan) => {
    const amount = cycle === 'yearly' ? plan.YearlyAmount : plan.MonthlyAmount;
    const selected = plan.Name === selectedName;
    const active = plan.Active !== false;
    const userText = plan.Name === 'Enterprise'
      ? `Up to ${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users or custom`
      : `${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users`;
    const period = Number(amount) > 0 ? `<em> / ${cycle === 'yearly' ? 'year' : 'month'}</em>` : '';
    return `<article class="plan-choice-card${selected ? ' selected' : ''}${active ? '' : ' unavailable'}">
      <label class="plan-choice-select">
        <input type="radio" name="Plan" value="${escapeHtml(plan.Name)}" ${selected ? 'checked' : ''} ${active ? '' : 'disabled'}>
        <span class="plan-choice-main"><strong>${escapeHtml(plan.Name)}</strong><small>${escapeHtml(userText)} · ${escapeHtml(plan.Summary)}</small><b>${active ? `${escapeHtml(formattedPrice(amount, planCatalog?.Currency || 'NGN'))}${period}` : 'Currently unavailable'}</b></span>
      </label>
    </article>`;
  }).join('') || '<p class="status bad">No subscription plan is currently configured.</p>';
  planComparisonGrid.innerHTML = plans.map((plan) => {
    const amount = cycle === 'yearly' ? plan.YearlyAmount : plan.MonthlyAmount;
    const features = plan.FeaturesByEdition?.[currentEdition] || [];
    const userText = plan.Name === 'Enterprise'
      ? `Up to ${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users or custom`
      : `${Number(plan.UserLimit || 0).toLocaleString('en-NG')} active users`;
    const period = Number(amount) > 0 ? ` per ${cycle === 'yearly' ? 'year' : 'month'}` : '';
    return `<article class="plan-comparison-column${plan.Active === false ? ' unavailable' : ''}">
      <header><h3>${escapeHtml(plan.Name)}</h3><strong>${escapeHtml(formattedPrice(amount, planCatalog?.Currency || 'NGN'))}${escapeHtml(period)}</strong><small>${escapeHtml(userText)}</small></header>
      <ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
    </article>`;
  }).join('');
  const submit = form.querySelector('button[type="submit"]');
  const selected = available.find((plan) => plan.Name === selectedPlanName());
  const amount = cycle === 'yearly' ? selected?.YearlyAmount : selected?.MonthlyAmount;
  if (submit) submit.textContent = Number(amount) > 0 ? 'Continue to Paystack' : 'Submit registration';
}

async function loadPlans() {
  try {
    const response = await fetch('/api/plan-catalog', { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Current plan pricing could not be loaded.');
    planCatalog = data.catalog;
  } catch (error) {
    planCatalog = { Currency: 'NGN', Plans: fallbackPlans };
    statusNode.className = 'status bad';
    statusNode.textContent = `${error.message} You may still submit a registration for manual confirmation.`;
  }
  renderPlans();
}

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
  const button = event.submitter || form.querySelector('button[type="submit"]');
  if (!window.DynamaxActionFeedback.begin(button, 'Submitting registration...')) return;
  statusNode.className = 'status';
  statusNode.textContent = 'Submitting registration...';
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
    if (data.authorizationUrl) {
      statusNode.textContent = 'Opening Paystack secure checkout...';
      window.location.assign(data.authorizationUrl);
      return;
    }
    form.reset();
    renderPlans();
  } catch (error) {
    statusNode.className = 'status bad';
    statusNode.textContent = error.message || String(error);
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

form.addEventListener('input', () => {
  if (!form.querySelector('button[type="submit"]')?.disabled) registrationIdempotencyKey = '';
});

form.addEventListener('change', (event) => {
  if (['Edition', 'BillingCycle', 'Plan'].includes(event.target?.name)) renderPlans();
});

loadPlans();
