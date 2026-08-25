const form = document.getElementById('organisationRegistrationForm');
const statusNode = document.getElementById('organisationRegistrationStatus');
const planGrid = document.getElementById('planChoiceGrid');
const planComparisonGrid = document.getElementById('planComparisonGrid');
const flexPlanBuilder = document.getElementById('flexPlanBuilder');
const downloadPricingBookButton = document.getElementById('downloadPricingBook');
let registrationIdempotencyKey = '';
let planCatalog = null;
const flexSelections = { school: new Set(), faith: new Set(), organization: new Set() };
let flexUserLimit = 1;
const planBookThemes = {
  free: {
    sheet: '#eefcff',
    cover: '#0f8fa8',
    strip: '#a9e8f1',
    accent: '#075766'
  },
  starter: {
    sheet: '#f3f7ff',
    cover: '#2f6ff2',
    strip: '#c5d7ff',
    accent: '#173f96'
  },
  standard: {
    sheet: '#f2fbf2',
    cover: '#2f9b52',
    strip: '#bfe5c6',
    accent: '#1d5a34'
  },
  professional: {
    sheet: '#fff6fb',
    cover: '#9f38d8',
    strip: '#edc8f7',
    accent: '#5c1e83'
  },
  flex: {
    sheet: '#eefbf8',
    cover: '#0c9278',
    strip: '#b9eadf',
    accent: '#075d4e'
  },
  enterprise: {
    sheet: '#fff7e8',
    cover: '#f08a2d',
    strip: '#ffd8a1',
    accent: '#8d4f07'
  }
};
const defaultPlanTheme = {
  sheet: '#f3f7ff',
  cover: '#4f6eff',
  strip: '#c9d7ff',
  accent: '#2246b8'
};

const fallbackPlans = [
  { Name: 'Free', Summary: 'Seven-day full-access trial', UserLimit: 5, TrialDays: 7, MonthlyAmount: 0, YearlyAmount: 0, Active: true, FeaturesByEdition: { school: ['Full access to every school module for 7 days', 'Up to 5 active users during the trial', 'Paid subscription required after the trial'], faith: ['Full access to every church module for 7 days', 'Up to 5 active users during the trial', 'Paid subscription required after the trial'], organization: ['Full access to every organisation module for 7 days', 'Up to 5 active users during the trial', 'Paid subscription required after the trial'] } },
  { Name: 'Starter', Summary: 'Core records for a small team', UserLimit: 5, MonthlyAmount: 0, YearlyAmount: 0, Active: true, FeaturesByEdition: { school: ['Student and admission records', 'Parent portal', 'Records Desk'], faith: ['Member records', 'Services and attendance', 'Departments'], organization: ['Personnel records', 'Departments', 'Records Centre'] } },
  { Name: 'Standard', Summary: 'Finance, people and approval workflows', UserLimit: 20, MonthlyAmount: 0, YearlyAmount: 0, Active: true, FeaturesByEdition: { school: ['Everything in Starter', 'Finance and income analytics', 'Bills, requisitions and approvals', 'Human Resources'], faith: ['Everything in Starter', 'Funds, offerings and donations', 'Finance and income analytics', 'Human Resources'], organization: ['Everything in Starter', 'Finance and revenue analytics', 'Bills, requisitions and approvals', 'Human Resources'] } },
  { Name: 'Professional', Summary: 'Full operations for a growing organisation', UserLimit: 50, MonthlyAmount: 0, YearlyAmount: 0, Active: true, FeaturesByEdition: { school: ['Everything in Standard', 'Payroll', 'Clinic, conduct and school stores', 'All school operation modules'], faith: ['Everything in Standard', 'Payroll', 'Organisation store and restaurant', 'All church operation modules'], organization: ['Everything in Standard', 'Payroll', 'Inventory, sales and catering', 'All organisation operation modules'] } },
  { Name: 'Flex', Summary: 'Choose modules and active users', UserLimit: 250, IncludedUsers: 1, MonthlyAmount: 0, YearlyAmount: 0, AdditionalUserMonthlyAmount: 0, AdditionalUserYearlyAmount: 0, Active: false, FeaturesByEdition: { school: ['Choose only the school modules you need'], faith: ['Choose only the church modules you need'], organization: ['Choose only the organisation modules you need'] } },
  { Name: 'Enterprise', Summary: 'Custom users, modules and onboarding', UserLimit: 250, MonthlyAmount: 0, YearlyAmount: 0, Active: true, FeaturesByEdition: { school: ['Everything in Professional', 'Custom active-user allowance', 'Custom module policy', 'Priority onboarding'], faith: ['Everything in Professional', 'Custom active-user allowance', 'Custom module policy', 'Priority onboarding'], organization: ['Everything in Professional', 'Custom active-user allowance', 'Custom module policy', 'Priority onboarding'] } }
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function normalizePlanName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function planTheme(planName) {
  return planBookThemes[normalizePlanName(planName)] || defaultPlanTheme;
}

function visiblePlans() {
  return planCatalog?.Plans?.length ? planCatalog.Plans : fallbackPlans;
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

function displayedPlanPrice(plan, amount, currency = 'NGN') {
  return plan?.Name === 'Free' ? 'Free for 7 days' : formattedPrice(amount, currency);
}

function selectedPlanName() {
  return form.querySelector('[name="Plan"]:checked')?.value || 'Free';
}

function flexPlan() {
  return visiblePlans().find((plan) => plan.Name === 'Flex');
}

function flexModules() {
  return Array.isArray(planCatalog?.ModuleCatalog?.[edition()]) ? planCatalog.ModuleCatalog[edition()] : [];
}

function applyFlexModule(moduleKey, checked) {
  const modules = flexModules();
  const selected = flexSelections[edition()];
  const byKey = new Map(modules.map((module) => [module.Key, module]));
  if (checked) {
    const visit = (key) => {
      if (selected.has(key)) return;
      selected.add(key);
      (byKey.get(key)?.Requires || []).forEach(visit);
    };
    visit(moduleKey);
  } else {
    selected.delete(moduleKey);
    let changed = true;
    while (changed) {
      changed = false;
      modules.forEach((module) => {
        if (selected.has(module.Key) && (module.Requires || []).some((required) => !selected.has(required))) {
          selected.delete(module.Key);
          changed = true;
        }
      });
    }
  }
}

function currentFlexQuote() {
  const plan = flexPlan();
  if (!plan) return { amount: 0, modules: [], userLimit: 1, additionalUsers: 0 };
  const modules = flexModules();
  const selected = flexSelections[edition()];
  const cycle = billingCycle();
  const amountKey = cycle === 'yearly' ? 'YearlyAmount' : 'MonthlyAmount';
  const selectedModules = modules.filter((module) => selected.has(module.Key));
  const includedUsers = Math.max(1, Number(plan.IncludedUsers || 1));
  const userLimit = Math.min(Math.max(1, Number(flexUserLimit || includedUsers)), Math.max(1, Number(plan.UserLimit || 250)));
  const additionalUsers = Math.max(0, userLimit - includedUsers);
  const additionalUserRate = Number(cycle === 'yearly' ? plan.AdditionalUserYearlyAmount : plan.AdditionalUserMonthlyAmount) || 0;
  const moduleAmount = selectedModules.reduce((sum, module) => sum + Number(plan.ModulePricesByEdition?.[edition()]?.[module.Key]?.[amountKey] || 0), 0);
  return {
    amount: Number(plan[amountKey] || 0) + moduleAmount + (additionalUsers * additionalUserRate),
    modules: selectedModules,
    userLimit,
    additionalUsers
  };
}

function renderFlexBuilder() {
  const plan = flexPlan();
  const show = selectedPlanName() === 'Flex' && plan?.Active !== false;
  flexPlanBuilder.hidden = !show;
  if (!show) return;
  const quote = currentFlexQuote();
  const currency = planCatalog?.Currency || 'NGN';
  const selected = flexSelections[edition()];
  flexPlanBuilder.innerHTML = `
    <header><div><p class="eyebrow">Build your subscription</p><h3>Choose modules and users</h3><p>Required modules are selected automatically and included in the total.</p></div><strong>${escapeHtml(formattedPrice(quote.amount, currency))}<small> / ${billingCycle() === 'yearly' ? 'year' : 'month'}</small></strong></header>
    <label class="flex-user-limit">Active users <input id="flexUserLimit" type="number" min="1" max="${Number(plan.UserLimit || 250)}" step="1" value="${quote.userLimit}"><small>${Number(plan.IncludedUsers || 1)} included in the base fee</small></label>
    <div class="flex-module-options">${flexModules().map((module) => {
      const price = plan.ModulePricesByEdition?.[edition()]?.[module.Key]?.[billingCycle() === 'yearly' ? 'YearlyAmount' : 'MonthlyAmount'] || 0;
      const required = flexModules().some((candidate) => selected.has(candidate.Key) && (candidate.Requires || []).includes(module.Key));
      return `<label class="flex-module-option ${selected.has(module.Key) ? 'selected' : ''}"><input type="checkbox" data-flex-module="${escapeHtml(module.Key)}" ${selected.has(module.Key) ? 'checked' : ''} ${required ? 'data-required-by-selection="true"' : ''}><span><strong>${escapeHtml(module.Label)}</strong><small>${escapeHtml(module.Description)}</small>${module.Requires?.length ? `<em>Requires ${escapeHtml(module.Requires.map((key) => flexModules().find((entry) => entry.Key === key)?.Label || key).join(', '))}</em>` : ''}</span><b>${escapeHtml(formattedPrice(price, currency))}</b></label>`;
    }).join('')}</div>
    <footer><span>${quote.modules.length} module${quote.modules.length === 1 ? '' : 's'} · ${quote.userLimit} active user${quote.userLimit === 1 ? '' : 's'}</span><strong>Total ${escapeHtml(formattedPrice(quote.amount, currency))}</strong></footer>`;
}

function buildPricingBookPrintMarkup() {
  const plans = visiblePlans();
  const cycle = billingCycle();
  const currency = planCatalog?.Currency || 'NGN';
  const cycleLabel = cycle === 'yearly' ? 'Yearly' : 'Monthly';
  const selected = selectedPlanName();
  const currentEdition = edition();
  const generatedAt = new Date().toLocaleString();

  const themeRows = plans
    .map((plan) => {
      const amount = cycle === 'yearly' ? plan.YearlyAmount : plan.MonthlyAmount;
      const features = (plan.FeaturesByEdition?.[currentEdition] || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join('');
      const slug = normalizePlanName(plan.Name);
      const recommended = slug === 'professional' ? ' (Recommended)' : '';
      const availability = plan.Active === false ? '<span class="plan-badge unavailable">Unavailable</span>' : '';
      const userText = plan.Name === 'Enterprise'
        ? `Up to ${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users or custom`
        : `${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users`;
      const priceText = plan.Name === 'Free'
        ? 'Free for 7 days'
        : Number(amount) > 0 ? `${escapeHtml(formattedPrice(amount, currency))} / ${cycleLabel}` : 'Price to be confirmed';

      return `<article class="pdf-plan-card ${selected === plan.Name ? 'selected' : ''} ${plan.Active === false ? 'unavailable' : ''}">
  <header><h1>${escapeHtml(plan.Name)}${escapeHtml(recommended)}</h1><span class="muted">${escapeHtml(userText)}</span>${availability}</header>
  <p class="pdf-plan-summary">${escapeHtml(plan.Summary || '')}</p>
  <strong class="pdf-plan-price">${priceText}</strong>
  <p><strong>Edition:</strong> ${escapeHtml(currentEdition)}</p>
  <ul>${features || '<li>No feature list provided.</li>'}</ul>
</article>`;
    })
    .join('');

  const comparisonRows = plans
    .map((plan) => {
      const amount = cycle === 'yearly' ? plan.YearlyAmount : plan.MonthlyAmount;
      const features = (plan.FeaturesByEdition?.[currentEdition] || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join('');
      const userText = plan.Name === 'Enterprise'
        ? `Up to ${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users or custom`
        : `${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users`;
      return `<tr>
  <td>${escapeHtml(plan.Name)}</td>
  <td>${plan.Name === 'Free' ? 'Free for 7 days' : Number(amount) > 0 ? escapeHtml(formattedPrice(amount, currency)) : '—'}</td>
  <td>${escapeHtml(plan.Active === false ? 'Unavailable' : plan.Name === 'Free' ? 'One-time trial' : `${cycleLabel} plan`)}</td>
  <td>${escapeHtml(userText)}</td>
</tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pricing Book · Dynamax</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font:12px/1.45 Arial, sans-serif;color:#17314b;background:#f6f9ff}
    .sheet{max-width:1100px;margin:0 auto;padding:22px}
    .sheet h1{margin:.08rem 0 .55rem 0;font-size:28px;color:#1a3f70}
    .sheet p{margin:.15rem 0}
    .sheet small{display:block;color:#65778f;margin-bottom:15px}
    .toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid #d7e2ee;border-radius:12px;padding:10px 12px;background:#eef4ff;margin:8px 0 14px}
    .toolbar p{margin:0}
    .pdf-plan-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
    .pdf-plan-card{border:1px solid #d9e4f4;background:#fff;padding:12px;border-radius:12px}
    .pdf-plan-card.selected{border-color:#1769e0;box-shadow:0 8px 18px #1738ab33}
    .pdf-plan-card.unavailable{opacity:.72}
    .pdf-plan-card h1{font-size:18px;margin:.1rem 0 .5rem}
    .pdf-plan-card .muted{font-size:11px;color:#687d97}
    .pdf-plan-summary{min-height:36px;color:#3b516a}
    .pdf-plan-price{display:block;color:#0c745e;margin:.5rem 0;font-size:16px}
    .pdf-plan-card ul{margin:.35rem 0 0 .9rem;padding:0}
    .pdf-plan-card li{line-height:1.45}
    .plan-badge{display:inline-block;margin-left:8px;padding:2px 7px;border-radius:999px;background:#173f96;color:#fff;font-size:10px;font-weight:700}
    .plan-badge.unavailable{background:#7d8ea5}
    .feature-table{margin-top:14px;border:1px solid #d9e5f5;background:#fff;border-radius:12px;overflow:hidden}
    .feature-table table{width:100%;border-collapse:collapse}
    .feature-table th,.feature-table td{padding:9px 10px;border-bottom:1px solid #e1e9f3;text-align:left;vertical-align:top}
    .feature-table thead{background:#f0f5fb}
    .feature-table th{font-size:10px;letter-spacing:.2px;text-transform:uppercase}
    .footer-note{margin-top:12px;font-size:10px;color:#667e98}
    .print-action{display:none}
    @page{size:A4;margin:10mm}
    @media print{.print-action{display:none}}
    .plan-book-footer{display:grid;gap:4px;font-size:10px;color:#65778f}
    @media (max-width:900px){.sheet{padding:14px}.pdf-plan-grid{grid-template-columns:1fr 1fr}}
  </style>
</head>
<body>
  <main class="sheet">
    <h1>Pricing Book</h1>
    <small>Dynamax plan catalogue · Generated ${escapeHtml(generatedAt)}</small>
    <section class="toolbar">
      <p>Billing cycle selected: <strong>${escapeHtml(cycleLabel)}</strong> · Edition context: <strong>${escapeHtml(currentEdition)}</strong> · Default currency: <strong>${escapeHtml(currency)}</strong></p>
    </section>
    <div class="pdf-plan-grid">
      ${themeRows}
    </div>
    <section class="feature-table">
      <table>
        <thead><tr><th>Plan</th><th>Price</th><th>Availability</th><th>Users</th></tr></thead>
        <tbody>${comparisonRows}</tbody>
      </table>
    </section>
    <div class="plan-book-footer">
      <div class="footer-note">For purchase and onboarding questions, contact the Dynamax support team.</div>
      <div class="footer-note">Generated by Dynamax · Pricing is subject to change.</div>
    </div>
  </main>
  <script>
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => window.print(), 220));
  </script>
</body>
</html>`;
}

function pricingBookDownloadUrl() {
  const url = new URL('/api/pricing-book-pdf', window.location.origin);
  url.searchParams.set('edition', edition());
  url.searchParams.set('billingCycle', billingCycle());
  return url;
}

async function downloadPricingBook() {
  const response = await fetch(pricingBookDownloadUrl(), {
    headers: { Accept: 'application/pdf' }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || 'The pricing book could not be downloaded.');
  }
  const blob = await response.blob();
  if (!blob.size || !String(blob.type || '').toLowerCase().includes('pdf')) {
    throw new Error('The server did not return a valid pricing book PDF.');
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `Dynamax_Pricing_Book_${edition()}_${billingCycle()}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function renderPlans() {
  const plans = visiblePlans();
  const current = selectedPlanName();
  const cycle = billingCycle();
  const currentEdition = edition();
  const available = plans.filter((plan) => plan.Active !== false);
  const selectedName = available.some((plan) => plan.Name === current) ? current : available[0]?.Name;
  planGrid.innerHTML = plans.map((plan) => {
    const amount = cycle === 'yearly' ? plan.YearlyAmount : plan.MonthlyAmount;
    const selected = plan.Name === selectedName;
    const active = plan.Active !== false;
    const slug = normalizePlanName(plan.Name);
    const theme = planTheme(plan.Name);
    const recommended = slug === 'professional';
    const cardClass = ['plan-choice-card', `plan-${slug}`, active ? '' : 'unavailable', selected ? 'selected' : '']
      .filter(Boolean)
      .join(' ');
    const userText = plan.Name === 'Enterprise'
      ? `Up to ${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users or custom`
      : `${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users`;
    const period = Number(amount) > 0 ? `<em> / ${cycle === 'yearly' ? 'year' : 'month'}</em>` : '';
    return `<article class="${cardClass}" style="--plan-sheet:${theme.sheet}; --plan-cover:${theme.cover}; --plan-strip:${theme.strip}; --plan-accent:${theme.accent};">
      <label class="plan-choice-select">
        <input type="radio" name="Plan" value="${escapeHtml(plan.Name)}" ${selected ? 'checked' : ''} ${active ? '' : 'disabled'}>
        <span class="plan-choice-main">${recommended ? '<span class="plan-choice-tag" aria-hidden="true">Recommended</span>' : ''}<strong>${escapeHtml(plan.Name)}</strong><small>${escapeHtml(userText)} · ${escapeHtml(plan.Summary)}</small><b>${active ? `${escapeHtml(displayedPlanPrice(plan, amount, planCatalog?.Currency || 'NGN'))}${plan.Name === 'Free' ? '' : period}` : 'Currently unavailable'}</b></span>
      </label>
    </article>`;
  }).join('') || '<p class="status bad">No subscription plan is currently configured.</p>';
  planComparisonGrid.innerHTML = plans.map((plan) => {
    const amount = cycle === 'yearly' ? plan.YearlyAmount : plan.MonthlyAmount;
    const features = plan.FeaturesByEdition?.[currentEdition] || [];
    const slug = normalizePlanName(plan.Name);
    const theme = planTheme(plan.Name);
    const compareClass = ['plan-comparison-column', `plan-${slug}`, plan.Active === false ? 'unavailable' : '']
      .filter(Boolean)
      .join(' ');
    const userText = plan.Name === 'Enterprise'
      ? `Up to ${Number(plan.UserLimit || 0).toLocaleString('en-NG')} users or custom`
      : `${Number(plan.UserLimit || 0).toLocaleString('en-NG')} active users`;
    const period = Number(amount) > 0 ? ` per ${cycle === 'yearly' ? 'year' : 'month'}` : '';
    return `<article class="${compareClass}" style="--plan-sheet:${theme.sheet}; --plan-cover:${theme.cover}; --plan-strip:${theme.strip}; --plan-accent:${theme.accent};">
      <header><h3>${escapeHtml(plan.Name)}</h3><strong>${escapeHtml(displayedPlanPrice(plan, amount, planCatalog?.Currency || 'NGN'))}${escapeHtml(plan.Name === 'Free' ? '' : period)}</strong><small>${escapeHtml(userText)}</small></header>
      <ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
    </article>`;
  }).join('');
  renderFlexBuilder();
  const submit = form.querySelector('button[type="submit"]');
  const selected = available.find((plan) => plan.Name === selectedPlanName());
  const amount = selected?.Name === 'Flex'
    ? currentFlexQuote().amount
    : cycle === 'yearly' ? selected?.YearlyAmount : selected?.MonthlyAmount;
  if (submit) submit.textContent = selected?.Name === 'Free'
    ? 'Start free trial'
    : Number(amount) > 0 ? 'Choose payment method' : 'Submit registration';
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
  let actionStarted = false;
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const selectedPlan = visiblePlans().find((plan) => plan.Name === selectedPlanName());
    const flexQuote = selectedPlan?.Name === 'Flex' ? currentFlexQuote() : null;
    if (selectedPlan?.Name === 'Flex' && !flexQuote.modules.length) {
      throw new Error('Choose at least one module for the Flex plan.');
    }
    const selectedAmount = flexQuote
      ? Number(flexQuote.amount || 0)
      : billingCycle() === 'yearly'
        ? Number(selectedPlan?.YearlyAmount || 0)
        : Number(selectedPlan?.MonthlyAmount || 0);
    let paymentChoice = {};
    if (selectedPlan?.Name !== 'Free' && selectedAmount > 0) {
      paymentChoice = await window.DynamaxPaymentMethods.choose({
        methodsUrl: '/api/platform-payment-methods',
        amount: selectedAmount,
        currency: planCatalog?.Currency || 'NGN'
      });
      if (!paymentChoice) return;
    }
    if (!window.DynamaxActionFeedback.begin(button, paymentChoice.paymentMethod === 'direct_bank_transfer'
      ? 'Submitting transfer...'
      : 'Submitting registration...')) return;
    actionStarted = true;
    statusNode.className = 'status';
    statusNode.textContent = paymentChoice.paymentMethod === 'direct_bank_transfer'
      ? 'Submitting your bank reference for verification...'
      : 'Submitting registration...';
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
        PaymentMethod: paymentChoice.paymentMethod || '',
        bankReference: paymentChoice.bankReference || '',
        proofDataUrl: paymentChoice.proofDataUrl || '',
        proofFileName: paymentChoice.proofFileName || '',
        FlexModules: flexQuote ? flexQuote.modules.map((module) => module.Key) : [],
        FlexUserLimit: flexQuote ? flexQuote.userLimit : '',
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
    const accountLink = data.activationUrl
      ? ` <a class="settings-link" href="${escapeHtml(data.activationUrl)}">Create administrator account</a>`
      : data.loginUrl
        ? ` <a class="settings-link" href="${escapeHtml(data.loginUrl)}">Sign in to your organisation</a>`
        : data.portalUrl
          ? ` <a class="settings-link" href="${escapeHtml(data.portalUrl)}">Open your organisation portal</a>`
          : '';
    const deliveryNote = data.activationUrl && !data.activationEmailSent
      ? /sent recently/i.test(data.activationEmailStatus || '')
        ? ' A prior activation email was sent recently; this is a fresh link you can use now.'
        : ' Save this activation link now because an activation email could not be delivered.'
      : '';
    const transferReference = data.directTransfer && data.paymentReference
      ? ` Transfer reference: ${escapeHtml(data.paymentReference)}.`
      : '';
    statusNode.innerHTML = `${escapeHtml(data.message)} Reference: ${escapeHtml(data.reference)}.${transferReference}${escapeHtml(deliveryNote)}${accountLink}`;
    registrationIdempotencyKey = '';
    if (data.authorizationUrl) {
      statusNode.textContent = 'Opening Paystack secure checkout...';
      window.location.assign(data.authorizationUrl);
      return;
    }
    if (data.directTransfer) return;
    if (data.activationUrl || data.loginUrl || data.onboardingUrl) {
      statusNode.textContent = data.activationUrl
        ? 'Opening secure administrator activation...'
        : data.loginUrl
          ? 'Opening your organisation sign-in...'
          : 'Opening your workspace preparation status...';
      window.location.assign(data.activationUrl || data.loginUrl || data.onboardingUrl);
      return;
    }
    form.reset();
    renderPlans();
  } catch (error) {
    statusNode.className = 'status bad';
    statusNode.textContent = error.message || String(error);
  } finally {
    if (actionStarted) window.DynamaxActionFeedback.end(button);
  }
});

form.addEventListener('input', () => {
  if (!form.querySelector('button[type="submit"]')?.disabled) registrationIdempotencyKey = '';
});

form.addEventListener('change', (event) => {
  if (['Edition', 'BillingCycle', 'Plan'].includes(event.target?.name)) renderPlans();
});

flexPlanBuilder?.addEventListener('change', (event) => {
  const moduleInput = event.target.closest('[data-flex-module]');
  if (moduleInput) {
    applyFlexModule(moduleInput.dataset.flexModule, moduleInput.checked);
    renderFlexBuilder();
    registrationIdempotencyKey = '';
    return;
  }
  if (event.target.id === 'flexUserLimit') {
    flexUserLimit = Math.max(1, Number(event.target.value || 1));
    renderFlexBuilder();
    registrationIdempotencyKey = '';
  }
});

flexPlanBuilder?.addEventListener('input', (event) => {
  if (event.target.id !== 'flexUserLimit') return;
  flexUserLimit = Math.max(1, Number(event.target.value || 1));
  const quote = currentFlexQuote();
  flexPlanBuilder.querySelector('header > strong').innerHTML = `${escapeHtml(formattedPrice(quote.amount, planCatalog?.Currency || 'NGN'))}<small> / ${billingCycle() === 'yearly' ? 'year' : 'month'}</small>`;
  flexPlanBuilder.querySelector('footer').innerHTML = `<span>${quote.modules.length} module${quote.modules.length === 1 ? '' : 's'} · ${quote.userLimit} active user${quote.userLimit === 1 ? '' : 's'}</span><strong>Total ${escapeHtml(formattedPrice(quote.amount, planCatalog?.Currency || 'NGN'))}</strong>`;
});

downloadPricingBookButton?.addEventListener('click', async () => {
  const loadingAction = window.DynamaxActionFeedback?.begin?.(downloadPricingBookButton, 'Preparing pricing book...');
  if (loadingAction === false) return;
  try {
    const plans = visiblePlans();
    if (!plans?.length) {
      throw new Error('Pricing data is not available at the moment.');
    }
    await downloadPricingBook();
    statusNode.className = 'status good';
    statusNode.textContent = 'Pricing book downloaded successfully.';
  } catch (error) {
    statusNode.className = 'status bad';
    statusNode.textContent = error.message || 'Unable to prepare pricing book PDF.';
  } finally {
    if (loadingAction) window.DynamaxActionFeedback?.end?.(downloadPricingBookButton);
  }
});

loadPlans();
