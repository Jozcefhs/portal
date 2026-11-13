const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const dimensions = [
  { field: 'Class', label: 'Classes', all: 'All classes in this branch' },
  { field: 'Term', label: 'Terms', all: 'All terms' }
];

function rateAmount(rate) {
  if (rate?.DiscountType === 'Percentage') return `${rate.DiscountValue}%`;
  if (rate?.DiscountType === 'Fixed amount') return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(rate.DiscountValue);
  return 'No discount';
}

function rateScope(rate) {
  return dimensions.map(({ field, all }) => rate[field + 'Scope'] === 'Selected' ? rate[field + 'Names'].join(', ') : all).join(' · ');
}

function coverageFields({ field, label, all }) {
  const plural = label.toLowerCase();
  return `<label style="display:block;margin:14px 0">${label}<select aria-label="${label}" name="${field}Scope" required style="width:100%"><option value="Selected">Selected ${plural}</option><option value="All">${all}</option></select></label>
    <fieldset data-list="${field}" style="min-width:0"><legend>Choose ${plural}${field === 'Term' ? ' (every academic session)' : ''}</legend><div data-options class="config-option-list config-option-grid"></div></fieldset>`;
}

export async function openBillingDiscounts(request, { isCurrent = () => true, branchName = '', readOnly = false } = {}) {
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'box-sizing:border-box;width:min(680px,94vw);max-height:90dvh;overflow:auto;border:1px solid #ccdbea;border-radius:16px;padding:18px';
  dialog.setAttribute('aria-label', 'Billing categories and total-fee discounts');
  dialog.innerHTML = `<h2>Billing categories & discounts</h2><p>A learner receives the rate for their class and billing term. The category default applies when no specific rate matches.</p>
    <p data-branch></p><form><fieldset disabled style="min-width:0;border:0;padding:0;margin:0">
    <label style="display:block;margin:14px 0">Billing category<input name="Name" list="billingDiscountCategories" maxlength="100" required style="width:100%;box-sizing:border-box"></label><datalist id="billingDiscountCategories"></datalist>
    <section aria-label="Rates for this category"><h3>Rates for this category</h3>
    <div data-rates style="display:grid;gap:6px;max-height:15rem;overflow:auto"></div>
    <button type="button" data-add style="margin:8px 0">Add rate</button></section>
    <fieldset data-policy style="min-width:0;border:0;padding:0;margin:0">
    <legend data-editor-heading></legend>
    <label style="display:block;margin:14px 0">Discount on total school fees<select aria-label="Discount on total school fees" name="DiscountType" style="width:100%"><option>None</option><option>Percentage</option><option>Fixed amount</option></select></label>
    <label style="display:block;margin:14px 0">Value (% or NGN)<input name="DiscountValue" type="number" min="0" max="100000000" step="0.01" value="0" required style="width:100%;box-sizing:border-box"></label>
    ${dimensions.map(coverageFields).join('')}
    <p>Assign the category in the learner’s billing profile. Rates apply to new school fees after component discounts. Wallet top-ups, optional services and acceptance deposits are excluded. Use billing review to check existing charges.</p>
    <button type="button" data-remove hidden>Remove rate</button></fieldset></fieldset>
    <footer style="position:sticky;bottom:-18px;background:Canvas;color:CanvasText;padding:8px 0;border-top:1px solid var(--line);z-index:1">
    <p role="status" aria-live="polite" style="margin:0">Loading categories…</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px"><button type="submit" disabled style="flex:1 1 150px;margin:0">Save total-fee discount</button><button type="button" data-reload style="margin:0">Reload settings</button><button type="button" data-close style="margin:0">Close</button></div></footer></form>`;
  document.body.append(dialog); dialog.showModal();
  const closeOnBranchChange = () => dialog.close();
  window.addEventListener('dynamax:staff-branch-changed', closeOnBranchChange);
  dialog.addEventListener('close', () => {
    window.removeEventListener('dynamax:staff-branch-changed', closeOnBranchChange);
    dialog.remove();
  }, { once: true });
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  const form = dialog.querySelector('form'), fieldset = form.querySelector('fieldset'), status = form.querySelector('[role=status]');
  const reload = form.querySelector('[data-reload]'), name = form.elements.Name, type = form.elements.DiscountType, value = form.elements.DiscountValue;
  const add = form.querySelector('[data-add]'), remove = form.querySelector('[data-remove]'), ratesList = form.querySelector('[data-rates]');
  const saveButton = form.querySelector('[type=submit]');
  const coverage = dimensions.map(dimension => ({ ...dimension, scope: form.elements[dimension.field + 'Scope'],
    list: form.querySelector(`[data-list="${dimension.field}"]`), options: [] }));
  form.querySelector('[data-policy]').disabled = readOnly;
  add.hidden = readOnly;
  let rules = [], loaded = false, busy = false, editingId = '', draftId = '', displayedCategory = '';
  const current = () => rules.find(row => key(row.Name) === key(name.value));
  const scholarshipSelected = () => key(name.value) === 'full scholarship';
  const scholarshipMessage = 'Full Scholarship is automatically exempt. Use Fee Setup to assign a fee explicitly to Full Scholarship.';
  const active = () => isCurrent() && dialog.isConnected && dialog.open;
  function updateControls() {
    fieldset.disabled = busy || !loaded;
    saveButton.disabled = busy || !loaded || readOnly || scholarshipSelected();
    reload.disabled = busy;
  }
  const setLimits = () => { value.max = type.value === 'Percentage' ? '100' : '100000000'; value.disabled = type.value === 'None'; if (value.disabled) value.value = '0'; };
  function showOptions({ field, label, scope, list, options }, rule) {
    scope.value = rule ? rule[field + 'Scope'] || 'All' : 'Selected';
    const stored = rule?.[field + 'Names'] || [];
    const selected = new Set(stored.map(key));
    const choices = new Map(options.map(name => [key(name), { name, offered: true }]));
    for (const name of stored) {
      if (!choices.has(key(name))) choices.set(key(name), { name, offered: false });
    }
    list.querySelector('[data-options]').innerHTML = [...choices.values()].map(({ name, offered }) =>
      `<label class="check-row"><input type="checkbox" name="${field}Names" value="${esc(name)}"${selected.has(key(name)) ? ' checked' : ''}><span>${esc(name)}${offered ? '' : ' (no longer offered)'}</span></label>`
    ).join('') || `<p>No ${label.toLowerCase()} are configured for this branch.</p>`;
    list.hidden = scope.value !== 'Selected';
  }
  function selectRate(id) {
    const policy = current(), rates = policy?.Rates || [];
    const scholarship = scholarshipSelected();
    const rate = id === 'default' ? { ...policy, ClassScope: 'All', TermScope: 'All' } : rates.find(row => row.RateId === id);
    editingId = rate ? id : '';
    if (!editingId) draftId = crypto.randomUUID();
    ratesList.replaceChildren();
    for (const item of [{ RateId: 'default', DiscountType: policy?.DiscountType, DiscountValue: policy?.DiscountValue }, ...rates]) {
      const isDefault = item.RateId === 'default';
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(item.RateId === editingId));
      button.style.cssText = 'width:100%;min-width:0;margin:0;text-align:left;white-space:normal;overflow-wrap:anywhere;border:1px solid var(--line)';
      if (item.RateId !== editingId) { button.style.background = 'Canvas'; button.style.color = 'CanvasText'; }
      button.textContent = isDefault ? `Category default · ${scholarship ? 'Automatic exemption' : rateAmount(item)} · All classes, all terms` : `${rateAmount(item)} · ${rateScope(item)}`;
      button.onclick = () => selectRate(item.RateId);
      ratesList.append(button);
    }
    const heading = editingId === 'default' ? 'Category default' : 'Selected rate';
    form.querySelector('[data-editor-heading]').textContent = scholarship ? 'Automatic Full Scholarship exemption' : editingId ? heading : 'New rate';
    form.querySelector('[data-policy]').hidden = scholarship;
    add.hidden = readOnly || scholarship;
    remove.hidden = readOnly || scholarship || !editingId || editingId === 'default';
    type.value = rate?.DiscountType || 'None';
    value.value = rate?.DiscountValue || 0;
    setLimits();
    for (const item of coverage) {
      item.scope.disabled = editingId === 'default';
      showOptions(item, rate);
    }
    status.textContent = scholarship ? scholarshipMessage : readOnly ? 'Read-only access. Choose a billing category to view its discount.' : '';
    updateControls();
  }
  function selectCategory() {
    displayedCategory = key(name.value);
    const policy = current();
    selectRate(scholarshipSelected() ? 'default' : policy?.Rates?.[0]?.RateId || 'default');
  }
  for (const { scope, list } of coverage) scope.onchange = () => { list.hidden = scope.value !== 'Selected'; };
  name.oninput = name.onchange = () => { if (key(name.value) !== displayedCategory) selectCategory(); };
  type.onchange = setLimits;
  add.onclick = () => { selectRate(''); type.focus(); };
  async function load() {
    if (busy || !active()) return;
    busy = true; loaded = false; updateControls();
    try {
      const data = await request({ action: 'list', IncludeOptions: true });
      if (!active()) return;
      if (data.scopedRatesVersion !== 1) throw new Error('The billing service needs an update before class and term rates can be edited. Reload settings after the update.');
      for (const item of coverage) {
        const options = data[item.label.toLowerCase()];
        if (!Array.isArray(options)) throw new Error(`Could not load ${item.label.toLowerCase()} for this branch. Reload settings before editing discounts.`);
        item.options = options;
      }
      rules = data.rules;
      form.querySelector('datalist').innerHTML = data.categories.map(item => `<option value="${esc(item)}"></option>`).join('');
      if (!name.value) name.value = data.categories[0] || '';
      dialog.querySelector('[data-branch]').textContent = `Branch: ${branchName || data.branchId}`;
      selectCategory(); loaded = true;
    } catch (error) { if (active()) status.textContent = error.message; }
    finally { busy = false; updateControls(); }
  }
  reload.onclick = load;
  function savePayload() {
    const payload = { action: 'save', Name: name.value.trim(), RateId: editingId || draftId, DiscountType: type.value, DiscountValue: value.value,
      recordVersion: current()?.recordVersion || '' };
    for (const { field, all, scope, list } of coverage) {
      const names = scope.value === 'Selected' ? [...list.querySelectorAll('input:checked')].map(input => input.value) : [];
      if (scope.value === 'Selected' && !names.length) {
        status.textContent = `Choose at least one ${field.toLowerCase()}, or select ${all}.`;
        (list.querySelector('input') || scope).focus();
        return;
      }
      payload[field + 'Scope'] = scope.value;
      payload[field + 'Names'] = names;
    }
    if (payload.ClassScope === 'All' && payload.TermScope === 'All' && editingId !== 'default') {
      if (editingId || current()?.DiscountType && current().DiscountType !== 'None') {
        status.textContent = 'Choose the category default to change the rate for all classes and all terms.';
        ratesList.querySelector('button')?.focus();
        return;
      }
      payload.RateId = 'default';
    }
    return payload;
  }
  async function save(payload) {
    if (!payload || busy || !loaded || readOnly || !active()) return;
    busy = true; updateControls(); status.textContent = 'Saving discount…';
    try {
      const result = await request(payload);
      if (!active()) return;
      rules = [...rules.filter(row => key(row.Name) !== key(result.rule.Name)), result.rule];
      name.value = result.rule.Name;
      const categories = form.querySelector('datalist');
      if (![...categories.options].some(option => key(option.value) === key(result.rule.Name))) categories.append(new Option(result.rule.Name));
      if (payload.RemoveRate) selectCategory();
      else selectRate(payload.RateId);
      status.textContent = payload.RemoveRate ? 'Rate removed. Future matching fees will use the category default.' : result.message;
    } catch (error) { if (active()) status.textContent = error.message; }
    finally { busy = false; updateControls(); }
  }
  form.onsubmit = event => {
    event.preventDefault();
    if (busy || !loaded || readOnly || !active() || !form.reportValidity()) return;
    return save(savePayload());
  };
  remove.onclick = async () => {
    const policy = current(), rate = policy?.Rates?.find(row => row.RateId === editingId);
    if (!rate || busy || !loaded || readOnly || !active()) return;
    const confirmed = await window.DynamaxDialogs.confirm({ title: 'Remove discount rate',
      message: `Remove the ${rateAmount(rate)} rate for ${policy.Name} (${rateScope(rate)})? Future matching fees will use the category default.`,
      confirmText: 'Remove rate', tone: 'danger' });
    if (confirmed && policy === current() && editingId === rate.RateId) {
      await save({ action: 'save', Name: policy.Name, RateId: rate.RateId, RemoveRate: true, recordVersion: policy.recordVersion });
    }
  };
  await load();
}
