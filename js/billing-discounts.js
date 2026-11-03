const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function openBillingDiscounts(request, { isCurrent = () => true } = {}) {
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'box-sizing:border-box;width:min(620px,94vw);max-height:90vh;overflow:auto;border:1px solid #ccdbea;border-radius:16px;padding:24px';
  dialog.setAttribute('aria-label', 'Billing categories and total-fee discounts');
  dialog.innerHTML = `<h2>Billing categories & discounts</h2><p>One discount on total matching school fees, after category-specific component rates. Wallet top-ups, optional services and acceptance deposits are excluded.</p>
    <form><fieldset disabled style="border:0;padding:0;margin:0">
    <label style="display:block;margin:14px 0">Billing category<input name="Name" list="billingDiscountCategories" maxlength="100" required style="width:100%;box-sizing:border-box"><datalist id="billingDiscountCategories"></datalist></label>
    <label style="display:block;margin:14px 0">Discount on total school fees<select aria-label="Discount on total school fees" name="DiscountType" style="width:100%"><option>None</option><option>Percentage</option><option>Fixed amount</option></select></label>
    <label style="display:block;margin:14px 0">Value (% or NGN)<input name="DiscountValue" type="number" min="0" max="100000000" step="0.01" value="0" required style="width:100%;box-sizing:border-box"></label>
    <p>Assign the category to the learner in their billing profile. New settings apply to new billing. Existing invoices and payments stay unchanged; use billing review for existing charges.</p>
    <button type="submit">Save total-fee discount</button></fieldset><p role="status" aria-live="polite">Loading categories…</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px"><button type="button" data-reload>Reload settings</button><button type="button" data-close>Close</button></div></form>`;
  document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  const form = dialog.querySelector('form'), fieldset = form.querySelector('fieldset'), status = form.querySelector('[role=status]');
  const reload = form.querySelector('[data-reload]'), name = form.elements.Name, type = form.elements.DiscountType, value = form.elements.DiscountValue;
  let rules = [], busy = false;
  const current = () => rules.find(row => key(row.Name) === key(name.value));
  const active = () => isCurrent() && dialog.isConnected;
  const setLimits = () => { value.max = type.value === 'Percentage' ? '100' : '100000000'; value.disabled = type.value === 'None'; if (value.disabled) value.value = '0'; };
  function select() { const rule = current(); type.value = rule?.DiscountType || 'None'; value.value = rule?.DiscountValue || 0; setLimits(); }
  name.onchange = select; type.onchange = setLimits;
  async function load() {
    if (busy || !active()) return;
    busy = true; fieldset.disabled = true; reload.disabled = true;
    try {
      const data = await request({ action: 'list' });
      if (!active()) return;
      rules = data.rules;
      form.querySelector('datalist').innerHTML = data.categories.map(item => `<option value="${esc(item)}"></option>`).join('');
      if (!name.value) name.value = data.categories[0] || '';
      select(); status.textContent = `Settings for branch ${data.branchId}. Choose a category to view or change its discount.`;
      fieldset.disabled = false;
    } catch (error) { if (active()) status.textContent = error.message; }
    finally { busy = false; reload.disabled = false; }
  }
  reload.onclick = load;
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !active() || !form.reportValidity()) return;
    const payload = { action: 'save', Name: name.value.trim(), DiscountType: type.value, DiscountValue: value.value, recordVersion: current()?.recordVersion || '' };
    busy = true; fieldset.disabled = true; reload.disabled = true; status.textContent = 'Saving discount…';
    try {
      const result = await request(payload);
      if (!active()) return;
      rules = [...rules.filter(row => key(row.Name) !== key(result.rule.Name)), result.rule];
      status.textContent = result.message;
    } catch (error) { if (active()) status.textContent = error.message; }
    finally { busy = false; fieldset.disabled = false; reload.disabled = false; }
  };
  await load();
}
