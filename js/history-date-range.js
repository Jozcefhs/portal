(() => {
const HISTORY_MODULES = Object.freeze({
  formPurchases: { required: true }, financeRequests: { required: true }, payroll: { required: true },
  donations: { required: true }, offerings: { required: true }, services: {}, members: {}, funds: {},
  hotel: {}, humanResources: {}, organizationStore: {}, bookstore: {}, uniformStore: {}
});

function validHistoryDates(range = {}) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return valid(range.fromDate) && valid(range.toDate) && range.fromDate <= range.toDate;
}

const ENDPOINTS = new Set(['/api/admin', '/api/finance-workflow', '/api/staff-services', '/api/staff-funds',
  '/api/staff-offerings', '/api/staff-church-payments', '/api/staff-members', '/api/staff-membership',
  '/api/staff-organization-departments', '/api/staff-hr', '/api/staff-stores', '/api/staff-hotel']);
const REFRESH_AFTER_MUTATION = new Set(['/api/staff-organization-departments', '/api/staff-stores', '/api/staff-hotel']);

function datedHistoryBody(path, body, range) {
  if (!ENDPOINTS.has(path) || typeof body !== 'string') return body;
  let payload;
  try { payload = JSON.parse(body); } catch { return body; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return body;
  const action = String(payload.action || payload.Action || 'list').toLowerCase();
  if (!REFRESH_AFTER_MUTATION.has(path) && !['list', 'getchurchdonations', 'getchurchservices', 'getchurchofferings', 'getchurchfunds', 'getchurchmembership'].includes(action) && path !== '/api/admin') return body;
  if (path === '/api/admin' && payload.section !== 'formPurchases') return body;
  return JSON.stringify({ ...payload, HistoryDateRange: range || {} });
}

function createHistoryDateWorkspace({ panel, scope, load, title }) {
  const ranges = new Map();
  let toolbar;
  const key = module => JSON.stringify([scope(), module]);
  const range = module => ranges.get(key(module)) || {};
  function show(module) {
    toolbar?.remove(); toolbar = null;
    const config = HISTORY_MODULES[module];
    if (!config) return true;
    const selected = range(module);
    toolbar = document.createElement('form');
    toolbar.className = 'workflow-form history-date-range';
    toolbar.setAttribute('aria-label', 'History date range');
    toolbar.innerHTML = '<p><strong data-history-title></strong> — select the recorded date range before loading history. Current registers remain available. Linked balances retain all their transactions.</p><div class="config-grid"><label>From<input type="date" name="fromDate" required></label><label>To<input type="date" name="toDate" required></label></div><button type="submit">Load selected period</button><p class="status" role="status"></p>';
    if (module === 'payroll') toolbar.querySelector('[role="status"]').textContent = 'Payroll includes the selected months. Year-to-date totals include earlier months in the same year.';
    toolbar.querySelector('[data-history-title]').textContent = title(module);
    toolbar.elements.fromDate.value = selected.fromDate || '';
    toolbar.elements.toDate.value = selected.toDate || '';
    const expectedScope = scope();
    toolbar.addEventListener('submit', event => {
      event.preventDefault();
      if (scope() !== expectedScope) return;
      const value = { fromDate: toolbar.elements.fromDate.value, toDate: toolbar.elements.toDate.value };
      if (!validHistoryDates(value)) {
        toolbar.querySelector('[role="status"]').textContent = 'Choose a valid date range with From no later than To.';
        return;
      }
      ranges.set(key(module), value);
      load(module);
    });
    panel.before(toolbar);
    if (config.required && !validHistoryDates(selected)) {
      panel.innerHTML = '<p class="muted">Choose dates above and click Load selected period. No history has been requested.</p>';
      return false;
    }
    return true;
  }
  return { range, show, clear() { ranges.clear(); toolbar?.remove(); toolbar = null; } };
}

window.DynamaxHistoryDates = { HISTORY_MODULES, validHistoryDates, datedHistoryBody, createHistoryDateWorkspace };
})();
