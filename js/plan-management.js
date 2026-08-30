const loginForm = document.getElementById('planPricingLoginForm');
const pricingForm = document.getElementById('planPricingForm');
const loginStatus = document.getElementById('planPricingLoginStatus');
const pricingStatus = document.getElementById('planPricingStatus');
const cards = document.getElementById('planPricingCards');
const entitlementMatrix = document.getElementById('planEntitlementMatrix');
const tenantPoolStatus = document.getElementById('tenantPoolStatus');
const tenantPoolSummary = document.getElementById('tenantPoolSummary');
const tenantPoolRows = document.getElementById('tenantPoolRows');
const tenantRequestRows = document.getElementById('tenantRequestRows');
const tenantRetirementRows = document.getElementById('tenantRetirementRows');
const platformPaymentStatus = document.getElementById('platformPaymentStatus');
const platformTransferRows = document.getElementById('platformTransferRows');
const platformTransferDecisionDialog = document.getElementById('platformTransferDecisionDialog');
const platformTransferDecisionForm = document.getElementById('platformTransferDecisionForm');
const platformTransferDecisionNotes = document.getElementById('platformTransferDecisionNotes');
const platformTransferDecisionStatus = document.getElementById('platformTransferDecisionStatus');
const platformTransferDecisionConfirm = document.getElementById('platformTransferDecisionConfirm');
let unlockedPassword = '';
let catalog = null;
let tenantPoolState = null;
let platformPaymentState = null;
let selectedEntitlementEdition = 'school';
let platformTransferDecisionResolver = null;

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

function platformPaymentMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency', currency: String(currency || 'NGN').toUpperCase(), maximumFractionDigits: 2
    }).format(Number(amount || 0));
  } catch (_error) {
    return `${escapeHtml(currency || 'NGN')} ${Number(amount || 0).toLocaleString('en-NG')}`;
  }
}

function finishPlatformTransferDecision(result = null) {
  const resolve = platformTransferDecisionResolver;
  platformTransferDecisionResolver = null;
  if (platformTransferDecisionDialog.open) platformTransferDecisionDialog.close();
  if (resolve) resolve(result);
}

function requestPlatformTransferDecision(approve, reference) {
  const transfer = (Array.isArray(platformPaymentState?.transfers) ? platformPaymentState.transfers : [])
    .find((entry) => String(entry.Reference || '') === String(reference || '')) || {};
  const rejecting = !approve;
  platformTransferDecisionDialog.classList.toggle('is-rejection', rejecting);
  platformTransferDecisionDialog.dataset.decision = approve ? 'approve' : 'reject';
  document.getElementById('platformTransferDecisionIcon').textContent = approve ? '✓' : '!';
  document.getElementById('platformTransferDecisionTitle').textContent = approve ? 'Approve subscription transfer' : 'Reject subscription transfer';
  document.getElementById('platformTransferDecisionCopy').textContent = approve
    ? 'Confirm that the bank credit has been received. Approval activates the subscriber’s selected plan.'
    : 'Rejecting this transfer will not activate the selected plan. Record a clear reason for the subscriber.';
  document.getElementById('platformDecisionSubscriber').textContent = transfer.OrganisationName || transfer.RegistrationReference || 'Subscriber';
  document.getElementById('platformDecisionPlan').textContent = [transfer.Plan, transfer.BillingCycle].filter(Boolean).join(' • ') || '—';
  document.getElementById('platformDecisionAmount').textContent = platformPaymentMoney(transfer.Amount, transfer.Currency);
  document.getElementById('platformDecisionReference').textContent = transfer.BankReference || reference || '—';
  document.getElementById('platformTransferDecisionNoteLabel').textContent = approve ? 'Approval note (optional)' : 'Rejection reason';
  platformTransferDecisionNotes.value = '';
  platformTransferDecisionNotes.required = rejecting;
  platformTransferDecisionNotes.placeholder = approve
    ? 'Example: Payment confirmed and subscription approved.'
    : 'Explain why this transfer is being rejected.';
  platformTransferDecisionConfirm.textContent = approve ? 'Approve transfer' : 'Reject transfer';
  platformTransferDecisionConfirm.classList.toggle('danger', rejecting);
  setStatus(platformTransferDecisionStatus, '');
  return new Promise((resolve) => {
    platformTransferDecisionResolver = resolve;
    platformTransferDecisionDialog.showModal();
    window.requestAnimationFrame(() => platformTransferDecisionNotes.focus());
  });
}

async function platformPaymentRequest(payload) {
  const response = await fetch('/api/platform-payment-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: unlockedPassword, ...payload })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.message || 'Dynamax payment settings could not be loaded.');
  return data;
}

function renderPlatformPaymentState() {
  const settings = platformPaymentState?.settings || {};
  document.getElementById('platformOnlinePaymentEnabled').value = settings.OnlinePaymentEnabled || 'YES';
  document.getElementById('platformDirectTransferEnabled').value = settings.DirectBankTransferEnabled || 'NO';
  document.getElementById('platformPaymentBankName').value = settings.PaymentBankName || '';
  document.getElementById('platformPaymentAccountName').value = settings.PaymentAccountName || '';
  document.getElementById('platformPaymentAccountNumber').value = settings.PaymentAccountNumber || '';
  document.getElementById('platformPaymentBankCurrency').value = settings.PaymentBankCurrency || 'NGN';
  document.getElementById('platformPaymentTransferInstructions').value = settings.PaymentTransferInstructions || '';
  const transfers = Array.isArray(platformPaymentState?.transfers) ? platformPaymentState.transfers : [];
  platformTransferRows.innerHTML = transfers.length ? transfers.map((transfer) => {
    const awaiting = String(transfer.Status || '').toLowerCase() === 'awaiting verification';
    return `<tr>
      <td><strong>${escapeHtml(transfer.OrganisationName || transfer.RegistrationReference)}</strong><small>${escapeHtml(transfer.Email)}</small></td>
      <td>${escapeHtml(transfer.Plan)}<small>${escapeHtml(transfer.BillingCycle)}</small></td>
      <td>${escapeHtml(platformPaymentMoney(transfer.Amount, transfer.Currency))}</td>
      <td>${escapeHtml(transfer.BankReference)}</td>
      <td>${transfer.HasProof ? `<button type="button" class="compact-action" data-platform-transfer-proof="${escapeHtml(transfer.Reference)}">View proof</button>` : '<span class="muted">Not supplied</span>'}</td>
      <td><span class="tenant-pool-status ${awaiting ? '' : String(transfer.Status).toLowerCase() === 'paid' ? 'ok' : 'bad'}">${escapeHtml(transfer.Status)}</span></td>
      <td>${transfer.CreatedAt ? escapeHtml(new Date(transfer.CreatedAt).toLocaleString()) : '&mdash;'}</td>
      <td>${awaiting ? `<span class="compact-row-actions"><button type="button" class="compact-action" data-platform-transfer-decision="approve" data-reference="${escapeHtml(transfer.Reference)}">Approve</button><button type="button" class="compact-action danger" data-platform-transfer-decision="reject" data-reference="${escapeHtml(transfer.Reference)}">Reject</button></span>` : escapeHtml(transfer.ReviewNotes || 'Closed')}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8">No direct subscription transfers have been submitted.</td></tr>';
}

async function loadPlatformPayments(message = '') {
  try {
    platformPaymentState = await platformPaymentRequest({ action: 'load' });
    renderPlatformPaymentState();
    setStatus(platformPaymentStatus, message || 'Dynamax payment methods and transfer queue loaded.', 'ok');
  } catch (error) {
    setStatus(platformPaymentStatus, error.message || String(error), 'bad');
  }
}

function platformPaymentSettingsFromForm() {
  return {
    OnlinePaymentEnabled: document.getElementById('platformOnlinePaymentEnabled').value,
    DirectBankTransferEnabled: document.getElementById('platformDirectTransferEnabled').value,
    PaymentBankName: document.getElementById('platformPaymentBankName').value,
    PaymentAccountName: document.getElementById('platformPaymentAccountName').value,
    PaymentAccountNumber: document.getElementById('platformPaymentAccountNumber').value,
    PaymentBankCurrency: document.getElementById('platformPaymentBankCurrency').value,
    PaymentTransferInstructions: document.getElementById('platformPaymentTransferInstructions').value
  };
}

function selectedPricingCurrency() {
  const value = String(document.getElementById('planPricingCurrency')?.value || 'NGN').toUpperCase();
  return value === 'USD' ? 'USD' : 'NGN';
}

function usdToNgnRate() {
  const value = Number(document.getElementById('planUsdToNgnRate')?.value || catalog?.UsdToNgnRate || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function pricingMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'NGN' ? 0 : 2
    }).format(Number(amount || 0));
  } catch (_error) {
    return `${currency} ${Number(amount || 0).toLocaleString('en-NG')}`;
  }
}

function convertedPriceText(amount, currency = selectedPricingCurrency()) {
  const rate = usdToNgnRate();
  const value = Number(amount || 0);
  if (!(rate > 0) || !(value >= 0)) return 'Equivalent unavailable until a conversion rate is entered.';
  return currency === 'USD'
    ? `≈ ${pricingMoney(value * rate, 'NGN')}`
    : `≈ ${pricingMoney(value / rate, 'USD')}`;
}

function suggestedModulePriceText(module) {
  const monthlyUsd = Number(module.SuggestedMonthlyAmountUSD || 0);
  const yearlyUsd = Number(module.SuggestedYearlyAmountUSD || monthlyUsd * 10);
  const rate = usdToNgnRate();
  const monthlyNgn = rate > 0 ? pricingMoney(monthlyUsd * rate, 'NGN') : 'set NGN rate';
  const yearlyNgn = rate > 0 ? pricingMoney(yearlyUsd * rate, 'NGN') : 'set NGN rate';
  return `Suggested ${pricingMoney(monthlyUsd, 'USD')} / ${monthlyNgn} monthly · ${pricingMoney(yearlyUsd, 'USD')} / ${yearlyNgn} yearly`;
}

function updateConvertedPricePreviews() {
  cards.querySelectorAll('[data-price-input]').forEach((input) => {
    const target = input.parentElement?.querySelector('[data-price-equivalent]');
    if (target) target.textContent = convertedPriceText(input.value);
  });
  entitlementMatrix?.querySelectorAll('[data-flex-module-price]').forEach((input) => {
    const target = input.parentElement?.querySelector('[data-price-equivalent]');
    if (target) target.textContent = convertedPriceText(input.value);
  });
  entitlementMatrix?.querySelectorAll('[data-module-suggestion]').forEach((node) => {
    const module = modulesForEdition(selectedEntitlementEdition).find((entry) => entry.Key === node.dataset.moduleSuggestion);
    if (module) node.textContent = suggestedModulePriceText(module);
  });
}

function updatePriceCurrencyLabels() {
  const currency = selectedPricingCurrency();
  cards.querySelectorAll('[data-price-currency]').forEach((node) => { node.textContent = currency; });
  entitlementMatrix?.querySelectorAll('[data-price-currency]').forEach((node) => { node.textContent = currency; });
  updateConvertedPricePreviews();
}

function renderCatalog() {
  const currency = selectedPricingCurrency();
  cards.innerHTML = (catalog?.Plans || []).map((plan) => {
    const isFree = plan.Name === 'Free';
    const isFlex = plan.Name === 'Flex';
    const counts = ['school', 'faith', 'organization'].map((edition) =>
      (plan.EntitlementsByEdition?.[edition] || []).length);
    return `<article class="plan-pricing-card" data-plan="${escapeHtml(plan.Name)}">
      <header><div><h3>${escapeHtml(plan.Name)}</h3><p>${escapeHtml(plan.Summary)}</p></div><label class="inline-check"><input type="checkbox" data-field="Active" ${plan.Active ? 'checked' : ''}> Available</label></header>
      <div class="plan-pricing-fields">
        <label><span>${isFlex ? 'Base monthly fee' : 'Monthly price'} (<span data-price-currency>${currency}</span>)</span><input data-field="MonthlyAmount" data-price-input inputmode="decimal" type="number" min="0" step="0.01" value="${Number(plan.MonthlyAmount || 0)}" ${isFree ? 'readonly' : ''}><small data-price-equivalent>${escapeHtml(convertedPriceText(plan.MonthlyAmount || 0, currency))}</small></label>
        <label><span>${isFlex ? 'Base yearly fee' : 'Yearly price'} (<span data-price-currency>${currency}</span>)</span><input data-field="YearlyAmount" data-price-input inputmode="decimal" type="number" min="0" step="0.01" value="${Number(plan.YearlyAmount || 0)}" ${isFree ? 'readonly' : ''}><small data-price-equivalent>${escapeHtml(convertedPriceText(plan.YearlyAmount || 0, currency))}</small></label>
        <label>${isFlex ? 'Maximum active users' : 'Active-user limit'}<input data-field="UserLimit" type="number" min="1" step="1" value="${Number(plan.UserLimit || 1)}" ${['Enterprise', 'Flex'].includes(plan.Name) ? '' : 'readonly'}></label>
        ${isFlex ? `
          <label>Users included in base fee<input data-field="IncludedUsers" type="number" min="1" step="1" value="${Number(plan.IncludedUsers || 1)}"></label>
          <label><span>Extra user / month (<span data-price-currency>${currency}</span>)</span><input data-field="AdditionalUserMonthlyAmount" data-price-input inputmode="decimal" type="number" min="0" step="0.01" value="${Number(plan.AdditionalUserMonthlyAmount || 0)}"><small data-price-equivalent>${escapeHtml(convertedPriceText(plan.AdditionalUserMonthlyAmount || 0, currency))}</small></label>
          <label><span>Extra user / year (<span data-price-currency>${currency}</span>)</span><input data-field="AdditionalUserYearlyAmount" data-price-input inputmode="decimal" type="number" min="0" step="0.01" value="${Number(plan.AdditionalUserYearlyAmount || 0)}"><small data-price-equivalent>${escapeHtml(convertedPriceText(plan.AdditionalUserYearlyAmount || 0, currency))}</small></label>
        ` : ''}
      </div>
      <p class="plan-module-counts"><span>School <b>${counts[0]}</b></span><span>Church <b>${counts[1]}</b></span><span>Other <b>${counts[2]}</b></span></p>
      ${isFree ? '<small class="plan-trial-note">The seven-day duration remains fixed; its enabled modules are now controlled below.</small>' : ''}
      ${isFlex ? '<small class="plan-trial-note">The base fee, selected module prices and any users above the included allowance form the subscriber total.</small>' : ''}
    </article>`;
  }).join('');
  updatePriceCurrencyLabels();
  renderEntitlementMatrix();
}

function editionLabel(edition) {
  return edition === 'school' ? 'School' : edition === 'faith' ? 'Church' : 'Other organisation';
}

function poolStatusClass(status) {
  const value = String(status || '').toLowerCase();
  return value === 'ready' || value === 'assigned' ? 'ok' : value === 'failed' ? 'bad' : '';
}

function renderTenantPool() {
  if (!tenantPoolState) return;
  const editions = ['school', 'faith', 'organization'];
  tenantPoolSummary.innerHTML = editions.map((edition) => {
    const row = tenantPoolState.summary?.[edition] || {};
    return `<article class="tenant-pool-summary-card ${Number(row.Shortfall || 0) > 0 ? 'needs-capacity' : ''}"><span>${escapeHtml(editionLabel(edition))}</span><strong>${Number(row.Ready || 0)} ready</strong><small>Target ${Number(row.Target || 0)} · ${Number(row.Assigned || 0)} assigned${Number(row.Shortfall || 0) ? ` · ${Number(row.Shortfall)} needed` : ''}</small></article>`;
  }).join('');
  tenantPoolRows.innerHTML = (tenantPoolState.slots || []).length ? tenantPoolState.slots.map((slot) => `
    <tr><td><strong>${escapeHtml(slot.FirebaseProjectId)}</strong><small>${escapeHtml(slot.Region || 'Default region')}</small></td><td>${escapeHtml(editionLabel(slot.Edition))}</td><td><span class="tenant-pool-status ${poolStatusClass(slot.Status)}">${escapeHtml(slot.Status)}</span></td><td>${escapeHtml(slot.AssignedOrganisationName || '—')}</td><td>${slot.PortalUrl ? `<a href="${escapeHtml(slot.PortalUrl)}" target="_blank" rel="noopener">Open</a>` : '—'}</td><td>${String(slot.Status).toLowerCase() === 'reserved' && !slot.AssignedRegistrationReference ? `<button type="button" class="compact-action" data-release-tenant-slot="${escapeHtml(slot.Id)}">Release</button>` : String(slot.Status).toLowerCase() === 'assigned' ? '<span class="muted">Secure retirement only</span>' : '—'}</td></tr>
  `).join('') : '<tr><td colspan="6">No tenant projects have been registered yet.</td></tr>';
  tenantRequestRows.innerHTML = (tenantPoolState.requests || []).length ? tenantPoolState.requests.map((request) => `
    <tr><td>${escapeHtml(request.Reference)}</td><td>${escapeHtml(editionLabel(request.Edition))}</td><td>${escapeHtml(request.Mode)}</td><td>${Number(request.Count || 1)}</td><td><span class="tenant-pool-status ${poolStatusClass(request.Status)}">${escapeHtml(request.Status)}</span></td><td>${request.RequestedAt ? escapeHtml(new Date(request.RequestedAt).toLocaleString()) : '—'}</td></tr>
  `).join('') : '<tr><td colspan="6">No provisioning requests are waiting.</td></tr>';
  if (tenantRetirementRows) {
    tenantRetirementRows.innerHTML = (tenantPoolState.retirements || []).length ? tenantPoolState.retirements.map((request) => `
      <tr><td>${escapeHtml(request.FirebaseProjectId)}</td><td>${escapeHtml(editionLabel(request.Edition))}</td><td><span class="tenant-pool-status ${poolStatusClass(request.Status)}">${escapeHtml(request.Status)}</span></td><td>${Number(request.Attempts || 0)}</td><td>${request.RequestedAt ? escapeHtml(new Date(request.RequestedAt).toLocaleString()) : '—'}</td><td>${escapeHtml(request.LastError || '—')}</td></tr>
    `).join('') : '<tr><td colspan="6">No tenant projects are awaiting secure retirement.</td></tr>';
    if ((tenantPoolState.retirements || []).length) {
      [...tenantRetirementRows.rows].forEach((row, index) => {
        const request = tenantPoolState.retirements[index] || {};
        const subscriptionCell = row.insertCell(1);
        subscriptionCell.innerHTML = `${escapeHtml(request.SubscriptionKind || 'Trial')}${request.OriginalPlan ? `<small>${escapeHtml(request.OriginalPlan)}</small>` : ''}`;
      });
    } else if (tenantRetirementRows.rows[0]?.cells[0]) {
      tenantRetirementRows.rows[0].cells[0].colSpan = 7;
    }
  }
  const policy = tenantPoolState.policy || {};
  document.getElementById('tenantTargetSchool').value = Number(policy.TargetReadyPerEdition?.school || 2);
  document.getElementById('tenantTargetFaith').value = Number(policy.TargetReadyPerEdition?.faith || 2);
  document.getElementById('tenantTargetOrganization').value = Number(policy.TargetReadyPerEdition?.organization || 2);
  document.getElementById('tenantDefaultRegion').value = policy.DefaultRegion || 'africa-south1';
  document.getElementById('tenantProjectPrefix').value = policy.ProjectPrefix || 'dynamax-tenant';
  document.getElementById('tenantSlotRegion').value ||= policy.DefaultRegion || 'africa-south1';
}

async function tenantPoolRequest(payload) {
  const response = await fetch('/api/tenant-project-pool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: unlockedPassword, ...payload })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.message || 'The tenant project pool could not be loaded.');
  return data;
}

async function loadTenantPool(message = '') {
  try {
    tenantPoolState = await tenantPoolRequest({ action: 'load' });
    renderTenantPool();
    setStatus(tenantPoolStatus, message || 'Tenant project pool loaded.', 'ok');
  } catch (error) {
    setStatus(tenantPoolStatus, error.message || String(error), 'bad');
  }
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
      <th scope="row"><strong>${escapeHtml(module.Label)}</strong><small>${escapeHtml(module.Description)}</small><small class="module-price-suggestion" data-module-suggestion="${escapeHtml(module.Key)}">${escapeHtml(suggestedModulePriceText(module))}</small>${requirementNames.length ? `<em>Requires ${escapeHtml(requirementNames.join(' and '))}</em>` : ''}</th>
      ${plans.map((plan) => {
        if (plan.Name === 'Flex') {
          const price = plan.ModulePricesByEdition?.[selectedEntitlementEdition]?.[module.Key] || {};
          return `<td class="flex-module-price-cell">
            <label><span>M</span><input type="number" min="0" step="0.01" inputmode="decimal" aria-label="${escapeHtml(`Flex monthly price: ${module.Label}`)}" data-flex-module-price="MonthlyAmount" data-flex-module-key="${escapeHtml(module.Key)}" value="${Number(price.MonthlyAmount || 0)}"><small data-price-equivalent>${escapeHtml(convertedPriceText(price.MonthlyAmount || 0))}</small></label>
            <label><span>Y</span><input type="number" min="0" step="0.01" inputmode="decimal" aria-label="${escapeHtml(`Flex yearly price: ${module.Label}`)}" data-flex-module-price="YearlyAmount" data-flex-module-key="${escapeHtml(module.Key)}" value="${Number(price.YearlyAmount || 0)}"><small data-price-equivalent>${escapeHtml(convertedPriceText(price.YearlyAmount || 0))}</small></label>
          </td>`;
        }
        const checked = (plan.EntitlementsByEdition?.[selectedEntitlementEdition] || []).includes(module.Key);
        const accessibleLabel = escapeHtml(`${plan.Name}: ${module.Label}`);
        return `<td><label title="${accessibleLabel}"><input type="checkbox" aria-label="${accessibleLabel}" data-entitlement-plan="${escapeHtml(plan.Name)}" data-entitlement-module="${escapeHtml(module.Key)}" ${checked ? 'checked' : ''}></label></td>`;
      }).join('')}
    </tr>`;
  }).join('');
  entitlementMatrix.innerHTML = `
    <div class="plan-entitlement-tabs" role="tablist" aria-label="Organisation type">${tabs}<button type="button" class="apply-flex-estimates" data-apply-flex-estimates>Apply suggested Flex prices for ${escapeHtml(editionLabel(selectedEntitlementEdition))}</button></div>
    <div class="plan-entitlement-table-wrap" tabindex="0">
      <table class="plan-entitlement-table">
        <thead><tr><th>Feature or module</th>${plans.map((plan) => `<th>${escapeHtml(plan.Name)}${plan.Name === 'Flex' ? '<small>Monthly / yearly price</small>' : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="plan-entitlement-help">Overview, secure sign-in, notifications, settings and role permissions remain core platform services. Fixed plans use checkboxes; Flex uses a monthly and yearly price for each selectable module. Suggested module prices are commercial starting points in USD; yearly estimates include two months free. Applying them converts them into the selected billing currency using the rate above. Dependencies are charged and enabled automatically.</p>
  `;
  updatePriceCurrencyLabels();
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
    document.getElementById('planUsdToNgnRate').value = Number(catalog.UsdToNgnRate || 1350);
    renderCatalog();
    await Promise.all([loadTenantPool(), loadPlatformPayments()]);
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
        IncludedUsers: Number(value('IncludedUsers')?.value || 1),
        AdditionalUserMonthlyAmount: Number(value('AdditionalUserMonthlyAmount')?.value || 0),
        AdditionalUserYearlyAmount: Number(value('AdditionalUserYearlyAmount')?.value || 0),
        ModulePricesByEdition: card.dataset.plan === 'Flex'
          ? Object.fromEntries(['school', 'faith', 'organization'].map((edition) => [
            edition,
            { ...(planForName('Flex')?.ModulePricesByEdition?.[edition] || {}) }
          ]))
          : {},
        EntitlementsByEdition: Object.fromEntries(['school', 'faith', 'organization'].map((edition) => [
          edition,
          [...(planForName(card.dataset.plan)?.EntitlementsByEdition?.[edition] || [])]
        ]))
      };
    });
    const data = await pricingRequest({
      password: unlockedPassword,
      catalog: {
        Currency: document.getElementById('planPricingCurrency').value,
        UsdToNgnRate: Number(document.getElementById('planUsdToNgnRate').value || 0),
        Plans: plans
      },
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

pricingForm.addEventListener('input', (event) => {
  if (event.target.matches('[data-price-input], [data-flex-module-price], #planUsdToNgnRate')) updateConvertedPricePreviews();
  if (!event.target.closest('.tenant-pool-section, .platform-payment-section')) setStatus(pricingStatus, 'You have unsaved pricing changes.');
});

document.getElementById('savePlatformPaymentSettings')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!window.DynamaxActionFeedback.begin(button, 'Saving...')) return;
  try {
    platformPaymentState = await platformPaymentRequest({ action: 'save', settings: platformPaymentSettingsFromForm() });
    renderPlatformPaymentState();
    setStatus(platformPaymentStatus, platformPaymentState.message, 'ok');
  } catch (error) {
    setStatus(platformPaymentStatus, error.message || String(error), 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

document.getElementById('refreshPlatformTransfers')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!window.DynamaxActionFeedback.begin(button, 'Refreshing...')) return;
  try {
    await loadPlatformPayments('Subscription transfer queue refreshed.');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

platformTransferRows?.addEventListener('click', async (event) => {
  const proofButton = event.target.closest('[data-platform-transfer-proof]');
  if (proofButton) {
    if (!window.DynamaxActionFeedback.begin(proofButton, 'Opening...')) return;
    try {
      const data = await platformPaymentRequest({ action: 'proof', reference: proofButton.dataset.platformTransferProof });
      const anchor = document.createElement('a');
      anchor.href = data.proofDataUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.download = data.fileName || 'subscription-payment-proof';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      setStatus(platformPaymentStatus, error.message || String(error), 'bad');
    } finally {
      window.DynamaxActionFeedback.end(proofButton);
    }
    return;
  }
  const decisionButton = event.target.closest('[data-platform-transfer-decision][data-reference]');
  if (!decisionButton) return;
  const approve = decisionButton.dataset.platformTransferDecision === 'approve';
  const decision = await requestPlatformTransferDecision(approve, decisionButton.dataset.reference);
  if (!decision) return;
  const notes = decision.notes;
  if (!window.DynamaxActionFeedback.begin(decisionButton, approve ? 'Approving...' : 'Rejecting...')) return;
  try {
    platformPaymentState = await platformPaymentRequest({
      action: 'decision',
      reference: decisionButton.dataset.reference,
      decision: decisionButton.dataset.platformTransferDecision,
      notes
    });
    renderPlatformPaymentState();
    setStatus(platformPaymentStatus, platformPaymentState.message, platformPaymentState.warning ? 'bad' : 'ok');
  } catch (error) {
    setStatus(platformPaymentStatus, error.message || String(error), 'bad');
  } finally {
    window.DynamaxActionFeedback.end(decisionButton);
  }
});

platformTransferDecisionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const notes = platformTransferDecisionNotes.value.trim();
  const rejecting = platformTransferDecisionDialog.dataset.decision === 'reject';
  if (rejecting && !notes) {
    setStatus(platformTransferDecisionStatus, 'Enter a rejection reason before continuing.', 'bad');
    platformTransferDecisionNotes.focus();
    return;
  }
  finishPlatformTransferDecision({ notes });
});

platformTransferDecisionDialog.querySelectorAll('[data-platform-decision-cancel]').forEach((button) => {
  button.addEventListener('click', () => finishPlatformTransferDecision(null));
});
platformTransferDecisionDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  finishPlatformTransferDecision(null);
});
platformTransferDecisionDialog.addEventListener('click', (event) => {
  if (event.target === platformTransferDecisionDialog) finishPlatformTransferDecision(null);
});

document.getElementById('planPricingCurrency')?.addEventListener('change', () => {
  updatePriceCurrencyLabels();
  document.getElementById('updateExistingSubscriptions').checked = false;
  setStatus(pricingStatus, `Currency changed to ${selectedPricingCurrency()}. Review every price before saving; existing subscribers remain on their current Paystack plans.`);
});

entitlementMatrix?.addEventListener('click', (event) => {
  const editionButton = event.target.closest('[data-entitlement-edition]');
  if (editionButton) {
    selectedEntitlementEdition = editionButton.dataset.entitlementEdition;
    renderEntitlementMatrix();
    return;
  }
  const estimateButton = event.target.closest('[data-apply-flex-estimates]');
  if (estimateButton) {
    const flex = planForName('Flex');
    if (!flex) return;
    const currency = selectedPricingCurrency();
    const rate = usdToNgnRate();
    if (currency === 'NGN' && !(rate > 0)) {
      setStatus(pricingStatus, 'Enter the USD-to-naira conversion rate before applying naira estimates.', 'bad');
      document.getElementById('planUsdToNgnRate')?.focus();
      return;
    }
    flex.ModulePricesByEdition ||= {};
    flex.ModulePricesByEdition[selectedEntitlementEdition] = Object.fromEntries(
      modulesForEdition(selectedEntitlementEdition).map((module) => {
        const monthlyUsd = Number(module.SuggestedMonthlyAmountUSD || 0);
        const yearlyUsd = Number(module.SuggestedYearlyAmountUSD || monthlyUsd * 10);
        return [module.Key, {
          MonthlyAmount: Math.round((currency === 'USD' ? monthlyUsd : monthlyUsd * rate) * 100) / 100,
          YearlyAmount: Math.round((currency === 'USD' ? yearlyUsd : yearlyUsd * rate) * 100) / 100
        }];
      })
    );
    renderEntitlementMatrix();
    setStatus(pricingStatus, `Suggested Flex prices applied to ${editionLabel(selectedEntitlementEdition)}. Review them, then save to publish.`, 'ok');
  }
});

entitlementMatrix?.addEventListener('change', (event) => {
  const priceInput = event.target.closest('[data-flex-module-price][data-flex-module-key]');
  if (priceInput) {
    const flex = planForName('Flex');
    flex.ModulePricesByEdition ||= {};
    flex.ModulePricesByEdition[selectedEntitlementEdition] ||= {};
    flex.ModulePricesByEdition[selectedEntitlementEdition][priceInput.dataset.flexModuleKey] ||= {};
    flex.ModulePricesByEdition[selectedEntitlementEdition][priceInput.dataset.flexModuleKey][priceInput.dataset.flexModulePrice] = Number(priceInput.value || 0);
    setStatus(pricingStatus, 'You have unsaved Flex module prices.', '');
    return;
  }
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

entitlementMatrix?.addEventListener('input', (event) => {
  const priceInput = event.target.closest('[data-flex-module-price][data-flex-module-key]');
  if (!priceInput) return;
  const flex = planForName('Flex');
  if (!flex) return;
  flex.ModulePricesByEdition ||= {};
  flex.ModulePricesByEdition[selectedEntitlementEdition] ||= {};
  flex.ModulePricesByEdition[selectedEntitlementEdition][priceInput.dataset.flexModuleKey] ||= {};
  flex.ModulePricesByEdition[selectedEntitlementEdition][priceInput.dataset.flexModuleKey][priceInput.dataset.flexModulePrice] = Number(priceInput.value || 0);
  setStatus(pricingStatus, 'You have unsaved Flex module prices.', '');
});

document.querySelector('.tenant-pool-tabs')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tenant-pool-tab]');
  if (!button) return;
  document.querySelectorAll('[data-tenant-pool-tab]').forEach((item) => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-tenant-pool-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.tenantPoolPanel !== button.dataset.tenantPoolTab;
  });
});

document.getElementById('tenantRequestMode')?.addEventListener('change', (event) => {
  const branded = event.target.value === 'branded';
  document.getElementById('tenantBrandedProjectField').hidden = !branded;
  document.getElementById('tenantRequestCount').disabled = branded;
});

document.getElementById('registerTenantSlot')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!window.DynamaxActionFeedback.begin(button, 'Adding...')) return;
  try {
    const data = await tenantPoolRequest({
      action: 'register',
      slot: {
        Edition: document.getElementById('tenantSlotEdition').value,
        FirebaseProjectId: document.getElementById('tenantSlotFirebaseProject').value,
        CloudflareProject: document.getElementById('tenantSlotCloudflareProject').value,
        WorkspaceId: document.getElementById('tenantSlotWorkspace').value,
        Region: document.getElementById('tenantSlotRegion').value,
        Status: 'Ready'
      }
    });
    ['tenantSlotFirebaseProject', 'tenantSlotCloudflareProject', 'tenantSlotWorkspace'].forEach((id) => { document.getElementById(id).value = ''; });
    await loadTenantPool(data.message);
  } catch (error) {
    setStatus(tenantPoolStatus, error.message || String(error), 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

document.getElementById('requestTenantProjects')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!window.DynamaxActionFeedback.begin(button, 'Queuing...')) return;
  try {
    const data = await tenantPoolRequest({
      action: 'request',
      request: {
        Edition: document.getElementById('tenantRequestEdition').value,
        Mode: document.getElementById('tenantRequestMode').value,
        Count: document.getElementById('tenantRequestCount').value,
        RequestedProjectId: document.getElementById('tenantRequestedProjectId').value
      }
    });
    document.getElementById('tenantRequestedProjectId').value = '';
    await loadTenantPool(data.message);
  } catch (error) {
    setStatus(tenantPoolStatus, error.message || String(error), 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

document.getElementById('saveTenantPoolPolicy')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!window.DynamaxActionFeedback.begin(button, 'Saving...')) return;
  try {
    const data = await tenantPoolRequest({
      action: 'save-policy',
      policy: {
        TargetReadyPerEdition: {
          school: document.getElementById('tenantTargetSchool').value,
          faith: document.getElementById('tenantTargetFaith').value,
          organization: document.getElementById('tenantTargetOrganization').value
        },
        DefaultRegion: document.getElementById('tenantDefaultRegion').value,
        ProjectPrefix: document.getElementById('tenantProjectPrefix').value
      }
    });
    await loadTenantPool(data.message);
  } catch (error) {
    setStatus(tenantPoolStatus, error.message || String(error), 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

tenantPoolRows?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-release-tenant-slot]');
  if (!button || !await window.DynamaxDialogs.confirm({ title: 'Release ready project', message: 'Release this unused project back to the ready pool?', confirmText: 'Release project' })) return;
  if (!window.DynamaxActionFeedback.begin(button, 'Releasing...')) return;
  try {
    const data = await tenantPoolRequest({ action: 'release', slotId: button.dataset.releaseTenantSlot });
    await loadTenantPool(data.message);
  } catch (error) {
    setStatus(tenantPoolStatus, error.message || String(error), 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});
