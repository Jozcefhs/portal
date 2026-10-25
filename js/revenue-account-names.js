const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

export async function openRevenueAccountNames(request, { selectedCode = '', onSaved = () => {} } = {}) {
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'box-sizing:border-box;width:min(580px,94vw);max-height:90vh;overflow:auto;border:1px solid #ccdbea;border-radius:16px;padding:24px';
  dialog.setAttribute('aria-label', 'Edit revenue account names');
  dialog.innerHTML = `<h2>Edit revenue account names</h2>
    <p>Account names are shared across all branches. Account codes, balances and existing transactions stay unchanged.</p>
    <form><fieldset style="border:0;padding:0;margin:0" disabled>
      <label style="display:block;margin:14px 0">Revenue account<select name="account" style="width:100%" required></select></label>
      <label style="display:block;margin:14px 0">Account code<input name="code" style="width:100%;box-sizing:border-box" readonly></label>
      <label style="display:block;margin:14px 0">Account name<input name="name" style="width:100%;box-sizing:border-box" maxlength="120" required></label>
      <button type="submit">Save account name</button></fieldset>
      <p role="status" aria-live="polite">Loading revenue accounts…</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px"><button type="button" data-reload>Reload accounts</button><button type="button" data-close>Close</button></div>
    </form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.showModal();
  const form = dialog.querySelector('form'), fields = form.querySelector('fieldset');
  const select = form.elements.account, name = form.elements.name, code = form.elements.code;
  const status = form.querySelector('[role=status]'), reload = form.querySelector('[data-reload]');
  let accounts = [], busy = false;
  const selected = () => accounts.find(row => row.documentId === select.value);
  const showAccount = () => { const row = selected(); code.value = row?.code || ''; name.value = row?.name || ''; };
  select.onchange = showAccount;
  async function load() {
    if (busy) return;
    busy = true; fields.disabled = true; reload.disabled = true;
    status.textContent = 'Loading revenue accounts…';
    try {
      const data = await request({ action: 'list' });
      if (!dialog.isConnected) return;
      const preferred = code.value || selectedCode;
      accounts = data.accounts;
      select.innerHTML = accounts.map(row => `<option value="${esc(row.documentId)}">${esc(row.code)} — ${esc(row.name)}${row.active ? '' : ' (inactive)'}</option>`).join('');
      const match = accounts.find(row => row.code === preferred);
      if (match) select.value = match.documentId;
      showAccount();
      status.textContent = accounts.length ? 'Choose an account and edit its name.' : 'No revenue accounts are available.';
    } catch (error) { accounts = []; status.textContent = error.message; }
    finally { busy = false; fields.disabled = !accounts.length; reload.disabled = false; }
  }
  reload.onclick = load;
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !selected() || !form.reportValidity()) return;
    const row = selected();
    const payload = { action: 'rename', documentId: row.documentId, code: row.code, name: name.value.trim(), recordVersion: row.recordVersion };
    busy = true; fields.disabled = true; reload.disabled = true; status.textContent = 'Saving account name…';
    try {
      const result = await request(payload);
      Object.assign(row, result.account);
      onSaved(result.account);
      if (!dialog.isConnected) return;
      select.selectedOptions[0].textContent = `${row.code} — ${row.name}${row.active ? '' : ' (inactive)'}`;
      showAccount(); status.textContent = result.message;
    } catch (error) { if (dialog.isConnected) status.textContent = error.message; }
    finally { busy = false; fields.disabled = false; reload.disabled = false; }
  };
  await load();
}
