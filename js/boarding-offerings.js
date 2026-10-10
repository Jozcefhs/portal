(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const cash = value => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(Number(value) || 0);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const options = rows => '<option value="">Choose an account</option>' + rows.map(row => `<option value="${esc(row.Code)}">${esc(row.Code)} · ${esc(row.Name)}</option>`).join('');
  const batchSize = 5;
  window.DynamaxBoardingOfferings = {
    canAccess: user => user?.edition === 'school' && (user.allowedSections || []).includes('accounts')
      && ['Accounts Officer', 'Super Admin', 'Director'].includes(user.assignedRole || user.role),
    async open({ fetch: staffFetch, user }) {
      if (!this.canAccess(user)) return;
      document.getElementById('boardingOfferingsDialog')?.remove();
      const dialog = document.createElement('dialog');
      dialog.id = 'boardingOfferingsDialog'; dialog.className = 'workflow-dialog boarding-offerings-dialog';
      dialog.setAttribute('aria-labelledby', 'boardingOfferingTitle');
      dialog.innerHTML = `<header class="boarding-offering-heading"><div><p class="eyebrow">Accounts · Student wallets</p><h2 id="boardingOfferingTitle">Boarding service offerings</h2></div><button type="button" data-close aria-label="Close boarding offerings">×</button></header>
        <p class="status" role="status" aria-live="polite" data-status>Loading boarding students…</p><div data-content></div>`;
      document.body.append(dialog); dialog.showModal();
      let busy = false, preview = null, service = null, data = null, selections = new Map(), credentials = '';
      const status = (message, bad = false) => { const el = dialog.querySelector('[data-status]'); el.textContent = message; el.className = `status ${bad ? 'bad' : 'ok'}`; };
      const close = () => { if (!busy) dialog.close(); };
      dialog.querySelector('[data-close]').addEventListener('click', close);
      dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
      dialog.addEventListener('close', () => { credentials = ''; selections.clear(); dialog.remove(); });
      const api = async body => {
        const response = await staffFetch('/api/staff-boarding-offerings', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.message || 'The offering request could not be completed. Reload the service before retrying.');
        return result;
      };
      const lock = value => {
        busy = value;
        dialog.querySelectorAll('input,select,button').forEach(el => { el.disabled = value || el.dataset.permanentDisabled === 'true'; });
        dialog.querySelector('[data-close]').disabled = value;
      };
      const run = async task => {
        if (busy) return; lock(true);
        try { await task(); } catch (error) { if (service) { data.Services = [service, ...data.Services.filter(row => row.ServiceId !== service.ServiceId)]; render(); } status(error.message, true); }
        finally { lock(false); credentials = ''; const password = dialog.querySelector('[name="approvalPassword"]'); if (password) password.value = ''; }
      };
      const rowMarkup = row => {
        const entry = selections.get(row.StudentKey) || { selected: false, amount: '', pin: '' };
        const result = preview?.Rows.find(item => item.StudentKey === row.StudentKey);
        const saved = service?.Rows.find(item => item.StudentKey === row.StudentKey);
        return `<tr data-student="${esc(row.StudentKey)}"><td><input type="checkbox" data-select aria-label="Include ${esc(row.DisplayName)}" ${entry.selected ? 'checked' : ''} ${service ? 'disabled data-permanent-disabled="true"' : ''}></td>
          <td><strong>${esc(row.DisplayName)}</strong><small>${esc(row.AccountRef)} · ${esc(row.ClassName)} · ${esc(row.SchoolSection)}</small></td>
          <td><input type="number" data-amount min="0" max="10000000" step="0.01" inputmode="decimal" value="${esc(entry.amount)}" aria-label="Offering amount for ${esc(row.DisplayName)}" ${service ? 'readonly' : ''}></td>
          <td>${row.PinProtected ? `<input type="password" data-pin autocomplete="new-password" inputmode="numeric" maxlength="8" value="${esc(entry.pin)}" aria-label="Wallet PIN for ${esc(row.DisplayName)}" placeholder="When required">` : '<span class="muted">—</span>'}</td>
          <td data-result>${saved?.Posted ? '<strong>Deducted</strong>' : result ? `${cash(result.Balance)} → ${cash(result.BalanceAfter)}${result.Errors.length ? `<small class="bad">${esc(result.Errors.join(' '))}</small>` : ''}` : '<span class="muted">Checked in preview</span>'}</td></tr>`;
      };
      const rows = () => service ? service.Rows.map(row => ({ ...row, PinProtected: data.Students.find(item => item.StudentKey === row.StudentKey)?.PinProtected })) : data.Students;
      const selectionRows = () => rows().filter(row => selections.get(row.StudentKey)?.selected).map(row => ({ StudentKey: row.StudentKey, StudentDocumentId: row.StudentDocumentId, Amount: selections.get(row.StudentKey).amount, Pin: selections.get(row.StudentKey).pin }));
      const updateCount = () => {
        const selected = selectionRows(), total = selected.reduce((sum, row) => sum + (Number(row.Amount) || 0), 0);
        dialog.querySelector('[data-selection-count]').textContent = `${selected.length} selected · ${cash(total)}`;
      };
      const invalidate = () => {
        preview = null;
        dialog.querySelector('[data-preview-summary]').textContent = '';
        dialog.querySelector('[data-post]').hidden = !service || service.PostedCount === service.Count;
        dialog.querySelectorAll('[data-result]').forEach(el => { el.textContent = 'Checked in preview'; });
      };
      const applyFilter = () => {
        const search = dialog.querySelector('[data-search]').value.trim().toLowerCase(), cls = dialog.querySelector('[data-class]').value;
        let shown = 0;
        dialog.querySelectorAll('[data-student]').forEach(tr => {
          const row = rows().find(item => item.StudentKey === tr.dataset.student);
          const visible = (!cls || row.ClassName === cls) && (!search || `${row.DisplayName} ${row.AccountRef} ${row.ClassName}`.toLowerCase().includes(search));
          tr.hidden = !visible; if (visible) shown++;
        });
        dialog.querySelector('[data-visible-count]').textContent = `${shown} of ${rows().length} boarding students shown`;
      };
      const drawRows = () => {
        dialog.querySelector('tbody').innerHTML = rows().map(rowMarkup).join('');
        dialog.querySelectorAll('[data-student]').forEach(tr => {
          const key = tr.dataset.student;
          tr.querySelector('[data-select]').addEventListener('change', event => { const entry = selections.get(key); entry.selected = event.target.checked; invalidate(); updateCount(); });
          tr.querySelector('[data-amount]').addEventListener('input', event => { selections.get(key).amount = event.target.value; invalidate(); updateCount(); });
          tr.querySelector('[data-pin]')?.addEventListener('input', event => { selections.get(key).pin = event.target.value; if (!service) invalidate(); });
        });
        applyFilter(); updateCount();
      };
      const historyMarkup = () => data.Services.length ? data.Services.map(item => `<article class="boarding-offering-history"><div><strong>${esc(item.ServiceName)}</strong><small>${esc(item.Reference)} · ${esc(item.Date)} · ${esc(item.ChurchName)}</small><span>${item.PostedCount}/${item.Count} students deducted · ${esc(item.Status)}</span></div><div>Collected ${cash(item.Collected)}<br>Remitted ${cash(item.Remitted)}<br><strong>Owed ${cash(item.Outstanding)}</strong></div><div class="boarding-offering-actions">${item.PostedCount < item.Count ? `<button type="button" data-resume="${esc(item.ServiceId)}">Resume deductions</button>` : ''}${item.Outstanding > 0 ? `<button type="button" class="secondary" data-remit="${esc(item.ServiceId)}">Record remittance</button>` : ''}<button type="button" class="secondary" data-view="${esc(item.ServiceId)}">View students</button></div></article>`).join('') : '<p>No offering services recorded in this branch and section.</p>';
      const bindHistory = () => {
        dialog.querySelectorAll('[data-resume], [data-view]').forEach(button => button.addEventListener('click', () => {
          service = data.Services.find(item => item.ServiceId === (button.dataset.resume || button.dataset.view));
          preview = null; selections = new Map(service.Rows.map(row => [row.StudentKey, { selected: true, amount: String(row.Amount), pin: '' }]));
          render(); status(`${service.Reference}: ${service.PostedCount} of ${service.Count} students deducted. Completed students will not be charged again.`);
        }));
        dialog.querySelectorAll('[data-remit]').forEach(button => button.addEventListener('click', () => {
          const item = data.Services.find(row => row.ServiceId === button.dataset.remit);
          const area = dialog.querySelector('[data-remittance]');
          area.innerHTML = `<form data-remit-form class="workflow-form workflow-form-grid"><h3>Record remittance · ${esc(item.Reference)}</h3><p>Owed to ${esc(item.ChurchName)}: <strong>${cash(item.Outstanding)}</strong>. Record only a payment already made; this does not send money.</p>
            <label>Date<input name="Date" type="date" value="${today()}" required></label><label>Amount<input name="Amount" type="number" step="0.01" min="0.01" max="${item.Outstanding}" value="${item.Outstanding}" required></label>
            <label>Cash / bank account<select name="PaymentAccount" required>${options(data.PaymentAccounts)}</select></label><label>Unique payment reference<input name="RemittanceReference" required maxlength="100" pattern="[A-Za-z0-9_-]{3,100}" autocomplete="off"></label>
            <label class="boarding-full"><input name="Authorized" type="checkbox" required> I confirm this payment was made to the receiving church.</label><label>Current staff password<input name="approvalPassword" type="password" autocomplete="current-password" required></label><button type="submit">Record remittance</button></form>`;
          area.querySelector('form').addEventListener('submit', event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); run(async () => {
            const result = await api({ ...values, action: 'remit', ServiceId: item.ServiceId, Authorized: true });
            data.Services = data.Services.map(row => row.ServiceId === item.ServiceId ? result.Service : row);
            render(); status(result.message);
          }); });
          area.scrollIntoView({ block: 'nearest' });
        }));
      };
      // Controls are disabled while a request runs. Read their explicit values;
      // FormData would omit disabled fields and lose the service reference.
      const fields = () => Object.fromEntries([...dialog.querySelector('[data-service-form]').elements].filter(el => el.name).map(el => [el.name, el.value]));
      const render = () => {
        const classes = [...new Set(rows().map(row => row.ClassName).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        dialog.querySelector('[data-content]').innerHTML = `<p>Choose only students covered by an authorised offering instruction. Zero or unselected amounts are not deducted. Wallet balances, limits and PINs are checked before posting.</p>
          <form data-service-form class="workflow-form workflow-form-grid" autocomplete="off"><label>Unique service reference<input name="Reference" required pattern="[A-Za-z0-9_-]{3,80}" maxlength="80" placeholder="CHAPEL-20261011" value="${esc(service?.Reference || '')}" ${service ? 'readonly' : ''}></label>
            <label>Service date<input name="Date" type="date" required value="${esc(service?.Date || today())}" ${service ? 'readonly' : ''}></label><label>Service name<input name="ServiceName" required maxlength="150" value="${esc(service?.ServiceName || '')}" ${service ? 'readonly' : ''}></label>
            <label>Receiving church<input name="ChurchName" required maxlength="150" value="${esc(service?.ChurchName || '')}" ${service ? 'readonly' : ''}></label><label>Church payable account<select name="PayableAccount" required ${service ? 'disabled data-permanent-disabled="true"' : ''}>${options(data.PayableAccounts)}</select><small>Money held for the church, not school revenue.</small></label>
            <label>Instruction / notes<input name="Notes" maxlength="1000" value="${esc(service?.Notes || '')}" ${service ? 'readonly' : ''}></label></form>
          <div class="boarding-offering-tools"><label>Search boarding students<input data-search type="search" placeholder="Name, admission number or class" autocomplete="off"></label><label>Class<select data-class><option value="">All classes</option>${classes.map(cls => `<option>${esc(cls)}</option>`).join('')}</select></label>${!service ? '<label>Flat amount<input data-flat type="number" step="0.01" min="0" max="10000000" inputmode="decimal"></label><button type="button" data-flat-apply>Apply to selected</button><button type="button" class="secondary" data-select-visible>Select shown</button><button type="button" class="secondary" data-clear>Clear selection</button>' : '<button type="button" class="secondary" data-new>New service</button>'}</div>
          <div class="boarding-offering-counts"><span data-visible-count></span><strong data-selection-count></strong></div><div class="boarding-offering-table"><table><thead><tr><th>Include</th><th>Boarding student</th><th>Offering amount</th><th>Wallet PIN</th><th>Wallet balance / result</th></tr></thead><tbody></tbody></table></div>
          <p data-preview-summary role="status"></p><div class="boarding-offering-approval"><label><input data-authorized type="checkbox"> I confirm the selected students and amounts follow an authorised student / guardian offering instruction.</label><label>Current staff password<input name="approvalPassword" type="password" autocomplete="current-password"></label></div>
          <div class="boarding-offering-actions">${!service ? '<button type="button" data-preview>Preview deductions</button>' : ''}<button type="button" data-post ${!service || service.PostedCount === service.Count ? 'hidden' : ''}>${service ? 'Resume remaining deductions' : 'Confirm wallet deductions'}</button><button type="button" class="secondary" data-reload>Reload students & services</button></div>
          <h3>Recent offering services</h3><div data-history>${historyMarkup()}</div><div data-remittance></div>`;
        if (service) dialog.querySelector('[name="PayableAccount"]').value = service.PayableAccount;
        drawRows(); bindHistory();
        dialog.querySelector('[data-search]').addEventListener('input', applyFilter);
        dialog.querySelector('[data-class]').addEventListener('change', applyFilter);
        dialog.querySelector('[data-service-form]').addEventListener('input', invalidate);
        dialog.querySelector('[data-service-form]').addEventListener('submit', event => event.preventDefault());
        dialog.querySelector('[data-new]')?.addEventListener('click', () => { service = null; preview = null; selections = new Map(data.Students.map(row => [row.StudentKey, { selected: false, amount: '', pin: '' }])); render(); status('New service. Select only authorised boarding students and preview before deducting.'); dialog.scrollTop = 0; });
        dialog.querySelector('[data-select-visible]')?.addEventListener('click', () => { dialog.querySelectorAll('[data-student]:not([hidden])').forEach(tr => { selections.get(tr.dataset.student).selected = true; }); invalidate(); drawRows(); });
        dialog.querySelector('[data-clear]')?.addEventListener('click', () => { selections.forEach(row => { row.selected = false; }); invalidate(); drawRows(); });
        dialog.querySelector('[data-flat-apply]')?.addEventListener('click', () => {
          const input = dialog.querySelector('[data-flat]');
          if (!input.value || !input.reportValidity()) { status('Enter a valid flat amount first.', true); return; }
          selections.forEach(row => { if (row.selected) row.amount = input.value; }); invalidate(); drawRows();
        });
        dialog.querySelector('[data-reload]').addEventListener('click', () => run(load));
        dialog.querySelector('[data-preview]')?.addEventListener('click', () => run(async () => {
          const form = dialog.querySelector('[data-service-form]'); if (!form.reportValidity()) return;
          const selected = selectionRows().filter(row => Number(row.Amount) > 0).sort((a, b) => a.StudentKey.localeCompare(b.StudentKey));
          if (!selected.length) throw new Error('Select at least one boarding student and enter an amount greater than zero.');
          const details = fields(), result = { Rows: [], PreviewTokens: [], Count: selected.length, Total: 0, Ready: true };
          for (let offset = 0; offset < selected.length; offset += batchSize) {
            status(`Checking wallets ${offset + 1}–${Math.min(offset + batchSize, selected.length)} of ${selected.length}…`);
            const batch = await api({ ...details, action: 'preview', Rows: selected.slice(offset, offset + batchSize) });
            result.Rows.push(...batch.Rows); result.PreviewTokens.push(batch.PreviewToken); result.Ready = result.Ready && batch.Ready;
            result.Total = Math.round((result.Total + batch.Total) * 100) / 100;
          }
          result.message = result.Ready ? 'Review these deductions before confirming. Balances are rechecked when posting.' : 'Resolve the flagged wallets before confirming. No money has been deducted.';
          preview = result;
          drawRows(); dialog.querySelector('[data-preview-summary]').textContent = `${result.Count} students · total ${cash(result.Total)}. ${result.message}`;
          dialog.querySelector('[data-post]').hidden = !result.Ready; status(result.message, !result.Ready);
        }));
        dialog.querySelector('[data-post]').addEventListener('click', () => run(async () => {
          if (!dialog.querySelector('[data-authorized]').checked) throw new Error('Confirm the authorised student / guardian offering instruction first.');
          credentials = dialog.querySelector('[name="approvalPassword"]').value;
          if (!credentials) throw new Error('Enter your current staff password to authorise these deductions.');
          const selected = selectionRows().filter(row => Number(row.Amount) > 0);
          if (!service) {
            if (!preview?.Ready) throw new Error('Preview the deductions before confirming.');
            const result = await api({ ...fields(), action: 'start', Rows: selected.map(({ Pin, ...row }) => row), PreviewTokens: preview.PreviewTokens, Authorized: true, approvalPassword: credentials });
            service = result.Service;
          }
          // References and server progress are retained on errors/timeouts. A
          // replayed batch returns current progress, never deducting twice.
          while (service.PostedCount < service.Count) {
            const result = await api({ action: 'postNext', ServiceId: service.ServiceId, Offset: service.PostedCount,
              Rows: selected.filter(row => service.Rows.slice(service.PostedCount, service.PostedCount + batchSize).some(item => item.StudentKey === row.StudentKey)), Authorized: true, approvalPassword: credentials });
            service = result.Service; status(result.message);
          }
          credentials = ''; preview = null;
          data.Services = [service, ...data.Services.filter(row => row.ServiceId !== service.ServiceId)];
          selections.forEach(row => { row.pin = ''; }); render();
          status(`Complete: ${service.Count} students; ${cash(service.Collected)} deducted. ${cash(service.Outstanding)} is awaiting remittance to ${service.ChurchName}.`);
        }));
      };
      async function load() {
        data = await api({ action: 'bootstrap' });
        if (!dialog.isConnected) return;
        service = null; preview = null; selections = new Map(data.Students.map(row => [row.StudentKey, { selected: false, amount: '', pin: '' }]));
        render(); status(`${data.Students.length} active boarding students loaded. Balances are checked in the preview.`);
      }
      await run(load);
    }
  };
})();
