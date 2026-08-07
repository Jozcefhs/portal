const loginForm = document.getElementById('planPricingLoginForm');
const pricingForm = document.getElementById('planPricingForm');
const loginStatus = document.getElementById('planPricingLoginStatus');
const pricingStatus = document.getElementById('planPricingStatus');
const cards = document.getElementById('planPricingCards');
let unlockedPassword = '';
let catalog = null;

document.getElementById('paystackWebhookUrl').textContent = `${window.location.origin}/api/paystack-subscription-webhook`;

function setStatus(node, message, type = '') {
  node.textContent = message || '';
  node.className = `status ${type}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderCatalog() {
  cards.innerHTML = (catalog?.Plans || []).map((plan) => {
    const features = plan.FeaturesByEdition?.school || [];
    const isFree = plan.Name === 'Free';
    return `<article class="plan-pricing-card" data-plan="${escapeHtml(plan.Name)}">
      <header><div><h3>${escapeHtml(plan.Name)}</h3><p>${escapeHtml(plan.Summary)}</p></div><label class="inline-check"><input type="checkbox" data-field="Active" ${plan.Active ? 'checked' : ''}> Available</label></header>
      <div class="plan-pricing-fields">
        <label>Monthly price (NGN)<input data-field="MonthlyAmount" inputmode="decimal" type="number" min="0" step="0.01" value="${Number(plan.MonthlyAmount || 0)}" ${isFree ? 'readonly' : ''}></label>
        <label>Yearly price (NGN)<input data-field="YearlyAmount" inputmode="decimal" type="number" min="0" step="0.01" value="${Number(plan.YearlyAmount || 0)}" ${isFree ? 'readonly' : ''}></label>
        <label>Active-user limit<input data-field="UserLimit" type="number" min="1" step="1" value="${Number(plan.UserLimit || 1)}" ${plan.Name === 'Enterprise' ? '' : 'readonly'}></label>
      </div>
      <details><summary>Feature summary</summary><ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul><p>${isFree ? 'The Free plan is a one-time seven-day trial. Its price and duration are fixed.' : 'Public feature wording automatically changes for school, church and other organisation registrations.'}</p></details>
    </article>`;
  }).join('');
}

async function pricingRequest(payload) {
  const response = await fetch('/api/plan-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.message || 'Pricing could not be loaded.');
  return data;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (!window.DynamaxActionFeedback.begin(button, 'Unlocking...')) return;
  try {
    unlockedPassword = document.getElementById('planPricingPassword').value;
    const data = await pricingRequest({ action: 'load', password: unlockedPassword });
    catalog = data.catalog;
    document.getElementById('planPricingCurrency').value = catalog.Currency || 'NGN';
    renderCatalog();
    loginForm.hidden = true;
    pricingForm.hidden = false;
    setStatus(pricingStatus, 'Pricing loaded. Changes are not published until you save.', 'ok');
  } catch (error) {
    unlockedPassword = '';
    setStatus(loginStatus, error.message || String(error), 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

pricingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter || document.getElementById('savePlanPricing');
  if (!window.DynamaxActionFeedback.begin(button, 'Saving and syncing...')) return;
  try {
    const plans = {};
    cards.querySelectorAll('[data-plan]').forEach((card) => {
      const value = (field) => card.querySelector(`[data-field="${field}"]`);
      plans[card.dataset.plan] = {
        Active: value('Active').checked,
        MonthlyAmount: Number(value('MonthlyAmount').value || 0),
        YearlyAmount: Number(value('YearlyAmount').value || 0),
        UserLimit: Number(value('UserLimit').value || 1)
      };
    });
    const data = await pricingRequest({
      password: unlockedPassword,
      catalog: { Currency: document.getElementById('planPricingCurrency').value, Plans: plans },
      updateExistingSubscriptions: document.getElementById('updateExistingSubscriptions').checked
    });
    catalog = data.catalog;
    renderCatalog();
    document.getElementById('updateExistingSubscriptions').checked = false;
    setStatus(pricingStatus, data.message, 'ok');
  } catch (error) {
    setStatus(pricingStatus, error.message || String(error), 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

pricingForm.addEventListener('input', () => setStatus(pricingStatus, 'You have unsaved pricing changes.'));
