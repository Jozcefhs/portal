const loginForm = document.getElementById('planPricingLoginForm');
const pricingForm = document.getElementById('planPricingForm');
const loginStatus = document.getElementById('planPricingLoginStatus');
const pricingStatus = document.getElementById('planPricingStatus');
const cards = document.getElementById('planPricingCards');
const entitlementMatrix = document.getElementById('planEntitlementMatrix');
let unlockedPassword = '';
let catalog = null;
let selectedEntitlementEdition = 'school';

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
    const isFree = plan.Name === 'Free';
    const counts = ['school', 'faith', 'organization'].map((edition) =>
      (plan.EntitlementsByEdition?.[edition] || []).length);
    return `<article class="plan-pricing-card" data-plan="${escapeHtml(plan.Name)}">
      <header><div><h3>${escapeHtml(plan.Name)}</h3><p>${escapeHtml(plan.Summary)}</p></div><label class="inline-check"><input type="checkbox" data-field="Active" ${plan.Active ? 'checked' : ''}> Available</label></header>
      <div class="plan-pricing-fields">
        <label>Monthly price (NGN)<input data-field="MonthlyAmount" inputmode="decimal" type="number" min="0" step="0.01" value="${Number(plan.MonthlyAmount || 0)}" ${isFree ? 'readonly' : ''}></label>
        <label>Yearly price (NGN)<input data-field="YearlyAmount" inputmode="decimal" type="number" min="0" step="0.01" value="${Number(plan.YearlyAmount || 0)}" ${isFree ? 'readonly' : ''}></label>
        <label>Active-user limit<input data-field="UserLimit" type="number" min="1" step="1" value="${Number(plan.UserLimit || 1)}" ${plan.Name === 'Enterprise' ? '' : 'readonly'}></label>
      </div>
      <p class="plan-module-counts"><span>School <b>${counts[0]}</b></span><span>Church <b>${counts[1]}</b></span><span>Other <b>${counts[2]}</b></span></p>
      ${isFree ? '<small class="plan-trial-note">The seven-day duration remains fixed; its enabled modules are now controlled below.</small>' : ''}
    </article>`;
  }).join('');
  renderEntitlementMatrix();
}

function editionLabel(edition) {
  return edition === 'school' ? 'School' : edition === 'faith' ? 'Church' : 'Other organisation';
}

function modulesForEdition(edition) {
  return Array.isArray(catalog?.ModuleCatalog?.[edition]) ? catalog.ModuleCatalog[edition] : [];
}

function planForName(name) {
  return (catalog?.Plans || []).find((plan) => plan.Name === name);
}

function updateModuleCounts() {
  cards.querySelectorAll('[data-plan]').forEach((card) => {
    const plan = planForName(card.dataset.plan);
    const countNodes = card.querySelectorAll('.plan-module-counts b');
    ['school', 'faith', 'organization'].forEach((edition, index) => {
      if (countNodes[index]) {
        countNodes[index].textContent = String(plan?.EntitlementsByEdition?.[edition]?.length || 0);
      }
    });
  });
}

function setPlanModule(planName, edition, moduleKey, enabled) {
  const plan = planForName(planName);
  if (!plan) return;
  plan.EntitlementsByEdition ||= {};
  const values = new Set(plan.EntitlementsByEdition[edition] || []);
  if (enabled) values.add(moduleKey);
  else values.delete(moduleKey);
  plan.EntitlementsByEdition[edition] = modulesForEdition(edition)
    .map((module) => module.Key)
    .filter((key) => values.has(key));
}

function applyModuleDependencies(planName, edition, moduleKey, enabled) {
  const modules = modulesForEdition(edition);
  const byKey = new Map(modules.map((module) => [module.Key, module]));
  setPlanModule(planName, edition, moduleKey, enabled);
  if (enabled) {
    const visit = (key) => {
      (byKey.get(key)?.Requires || []).forEach((required) => {
        setPlanModule(planName, edition, required, true);
        visit(required);
      });
    };
    visit(moduleKey);
  } else {
    let changed = true;
    while (changed) {
      changed = false;
      modules.forEach((module) => {
        const current = new Set(planForName(planName)?.EntitlementsByEdition?.[edition] || []);
        if (current.has(module.Key) && (module.Requires || []).some((required) => !current.has(required))) {
          setPlanModule(planName, edition, module.Key, false);
          changed = true;
        }
      });
    }
  }
}

function renderEntitlementMatrix() {
  if (!entitlementMatrix) return;
  const modules = modulesForEdition(selectedEntitlementEdition);
  const plans = catalog?.Plans || [];
  const tabs = ['school', 'faith', 'organization'].map((edition) => `
    <button type="button" data-entitlement-edition="${edition}" class="${edition === selectedEntitlementEdition ? 'active' : ''}" aria-pressed="${edition === selectedEntitlementEdition}">${editionLabel(edition)}</button>
  `).join('');
  const rows = modules.map((module) => {
    const requirementNames = (module.Requires || []).map((key) =>
      modules.find((candidate) => candidate.Key === key)?.Label || key);
    return `<tr>
      <th scope="row"><strong>${escapeHtml(module.Label)}</strong><small>${escapeHtml(module.Description)}</small>${requirementNames.length ? `<em>Requires ${escapeHtml(requirementNames.join(' and '))}</em>` : ''}</th>
      ${plans.map((plan) => {
        const checked = (plan.EntitlementsByEdition?.[selectedEntitlementEdition] || []).includes(module.Key);
        return `<td><label title="${escapeHtml(`${plan.Name}: ${module.Label}`)}"><input type="checkbox" data-entitlement-plan="${escapeHtml(plan.Name)}" data-entitlement-module="${escapeHtml(module.Key)}" ${checked ? 'checked' : ''}><span aria-hidden="true"></span><span class="sr-only">${escapeHtml(`${plan.Name}: ${module.Label}`)}</span></label></td>`;
      }).join('')}
    </tr>`;
  }).join('');
  entitlementMatrix.innerHTML = `
    <div class="plan-entitlement-tabs" role="tablist" aria-label="Organisation type">${tabs}</div>
    <div class="plan-entitlement-table-wrap" tabindex="0">
      <table class="plan-entitlement-table">
        <thead><tr><th>Feature or module</th>${plans.map((plan) => `<th>${escapeHtml(plan.Name)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="plan-entitlement-help">Overview, secure sign-in, notifications, settings and role permissions remain core platform services. Checked operational modules are enforced in both the web companion and desktop app.</p>
  `;
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
        UserLimit: Number(value('UserLimit').value || 1),
        EntitlementsByEdition: Object.fromEntries(['school', 'faith', 'organization'].map((edition) => [
          edition,
          [...(planForName(card.dataset.plan)?.EntitlementsByEdition?.[edition] || [])]
        ]))
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

entitlementMatrix?.addEventListener('click', (event) => {
  const editionButton = event.target.closest('[data-entitlement-edition]');
  if (editionButton) {
    selectedEntitlementEdition = editionButton.dataset.entitlementEdition;
    renderEntitlementMatrix();
  }
});

entitlementMatrix?.addEventListener('change', (event) => {
  const input = event.target.closest('[data-entitlement-plan][data-entitlement-module]');
  if (!input) return;
  applyModuleDependencies(
    input.dataset.entitlementPlan,
    selectedEntitlementEdition,
    input.dataset.entitlementModule,
    input.checked
  );
  renderEntitlementMatrix();
  updateModuleCounts();
  setStatus(pricingStatus, 'You have unsaved plan-module changes.', '');
});
