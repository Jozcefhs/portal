(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = value => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(Number(value) || 0);
  const student = row => `${row.DisplayName || ''} · ${row.AccountRef || row.AdmissionNo || ''} · ${row.ClassName || ''}`;
  window.DynamaxPaymentCorrections = {
    canAccess: user => user?.edition === 'school' && (user.allowedSections || []).includes('accounts')
      && ['Accounts Officer', 'Super Admin', 'Director'].includes(user.assignedRole || user.role),
    open({ fetch: staffFetch, user, payments = [], accounts = [], onSaved }) {
      if (!this.canAccess(user) || document.getElementById('paymentCorrectionDialog')) return;
      const dialog = document.createElement('dialog');
      dialog.id = 'paymentCorrectionDialog'; dialog.className = 'workflow-dialog payment-correction-dialog';
      dialog.setAttribute('aria-labelledby', 'paymentCorrectionTitle');
      dialog.innerHTML = `<header><h2 id="paymentCorrectionTitle">Correct manual payment</h2><button type="button" data-close aria-label="Close">×</button></header>
        <p>Correct a wallet top-up or school-fee receipt. The original receipt stays in the audit trail. This does not send money or refund a bank transfer.</p>
        <form autocomplete="off">
          <label>Original payment reference<input name="Reference" list="correctionReceipts" required autocomplete="off" placeholder="Select a receipt or enter its reference"></label>
          <datalist id="correctionReceipts">${payments.filter(row => String(row.Gateway).toLowerCase() === 'manual').map(row => `<option value="${esc(row.Reference)}">${esc(row.AccountRef)} · ${esc(row.FeeName || row.FeeCode)} · ${esc(money(row.Amount))}</option>`).join('')}</datalist>
          <button type="button" data-lookup>Load receipt</button><div data-receipt role="status"></div>
          <label>Correction<select name="Kind"><option value="reduce">Reduce an overstated amount</option><option value="reverse">Reverse the remaining payment</option><option value="move">Move the remaining credit to the correct wallet</option></select></label>
          <label data-reduce>Correct amount to retain<input name="CorrectAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 10000 when 14000 was recorded"></label>
          <div data-move hidden><label>Correct student's admission number<input name="TargetAccountRef" list="correctionStudents" autocomplete="off"></label>
            <datalist id="correctionStudents">${accounts.map(row => `<option value="${esc(row.AccountRef || row.AdmissionNo)}">${esc(student(row))}</option>`).join('')}</datalist>
            <label>Correct student's school section<select name="TargetSchoolSection"><option value="">Resolve from admission number</option><option value="primary">Primary</option><option value="secondary">Secondary</option></select></label></div>
          <label>Reason / proof-of-payment reference<textarea name="Reason" required maxlength="1000" rows="3" placeholder="Explain the error and reference the payment proof"></textarea></label>
          <button type="submit" data-preview>Preview correction</button>
        </form>
        <div data-summary aria-live="polite"></div>
        <section data-confirm hidden><label>Your current staff password<input name="approvalPassword" type="password" autocomplete="current-password"></label>
          <button type="button" data-post>Confirm correction</button></section>
        <p data-status role="status" aria-live="polite"></p>`;
      document.body.append(dialog); dialog.showModal();
      const form = dialog.querySelector('form'), status = dialog.querySelector('[data-status]');
      let busy = false, preview = null, posted = false;
      // Keep this identity unchanged on timeouts/retries. A new dialog starts a new instruction.
      const operationId = crypto.randomUUID();
      const values = () => ({ ...Object.fromEntries(new FormData(form)), OperationId: operationId });
      const api = async body => {
        const response = await staffFetch('/api/staff-payment-corrections', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.message || 'Correction could not be confirmed. Retry the same instruction before starting another.');
        return data;
      };
      const invalidate = () => {
        preview = null; dialog.querySelector('[data-confirm]').hidden = true; dialog.querySelector('[data-summary]').textContent = '';
        dialog.querySelector('[name="approvalPassword"]').value = '';
      };
      const updateMode = () => {
        const kind = form.elements.Kind.value;
        dialog.querySelector('[data-reduce]').hidden = kind !== 'reduce';
        form.elements.CorrectAmount.required = kind === 'reduce';
        dialog.querySelector('[data-move]').hidden = kind !== 'move';
        form.elements.TargetAccountRef.required = kind === 'move';
      };
      form.addEventListener('input', event => {
        invalidate();
        if (event.target.name === 'Reference') dialog.querySelector('[data-receipt]').textContent = '';
        updateMode();
      });
      const lock = value => {
        busy = value;
        dialog.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = value || (posted && !el.hasAttribute('data-close')); });
      };
      const run = async task => {
        if (busy || posted) return;
        lock(true); status.className = ''; status.textContent = 'Checking…';
        try { await task(); }
        catch (error) { status.textContent = error.message; status.className = 'bad'; }
        finally { lock(false); dialog.querySelector('[name="approvalPassword"]').value = ''; }
      };
      dialog.querySelector('[data-close]').addEventListener('click', () => { if (!busy) dialog.close(); });
      dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
      dialog.addEventListener('close', () => { dialog.remove(); });
      const showReceipt = row => {
        dialog.querySelector('[data-receipt]').textContent = `${student(row.Student)} — ${row.Type}. Original: ${money(row.OriginalAmount)}. Remaining after earlier corrections: ${money(row.RemainingAmount)}.`;
        form.elements.Kind.querySelector('[value="move"]').disabled = row.Type !== 'Wallet';
        if (row.Type !== 'Wallet' && form.elements.Kind.value === 'move') form.elements.Kind.value = 'reduce';
        updateMode();
      };
      dialog.querySelector('[data-lookup]').addEventListener('click', () => run(async () => {
        invalidate(); const data = await api({ action: 'lookup', Reference: form.elements.Reference.value });
        showReceipt(data.Receipt); status.textContent = 'Choose the correction and enter a reason.';
      }));
      // Read enabled fields before locking: disabled fields are excluded by FormData.
      form.addEventListener('submit', event => {
        event.preventDefault(); const input = values();
        run(async () => {
          const data = await api({ ...input, action: 'preview' });
          preview = { input, data }; showReceipt(data.Receipt);
          const parts = [`Correction amount: ${money(data.Amount)}`, `Receipt amount remaining: ${money(data.RemainingAmount)}`];
          if (data.BalanceBefore !== undefined) parts.push(`Source wallet: ${money(data.BalanceBefore)} → ${money(data.BalanceAfter)}`);
          if (data.Target) parts.push(`Correct student: ${student(data.Target)}`, `Target wallet: ${money(data.TargetBalanceBefore)} → ${money(data.TargetBalanceAfter)}`);
          if (data.SchoolFees) {
            parts.push(`Fees outstanding: ${money(data.SchoolFees.Before.OutstandingBalance)} → ${money(data.SchoolFees.After.OutstandingBalance)}`);
            parts.push(...data.SchoolFees.Invoices.map(row => `${row.InvoiceId}: credit reduced by ${money(row.ReleasedCredit)}; outstanding ${money(row.BalanceAfter)}`));
          }
          dialog.querySelector('[data-summary]').innerHTML = `<h3>Review before confirming</h3>${parts.map(text => `<p>${esc(text)}</p>`).join('')}`;
          dialog.querySelector('[data-confirm]').hidden = Boolean(data.replayed);
          posted = Boolean(data.replayed); status.textContent = data.message;
        });
      });
      dialog.querySelector('[data-post]').addEventListener('click', () => {
        if (!preview) return;
        const approvalPassword = dialog.querySelector('[name="approvalPassword"]').value;
        if (!approvalPassword) { status.textContent = 'Enter your current staff password.'; return; }
        run(async () => {
          const data = await api({ ...preview.input, action: 'post', PreviewDigest: preview.data.PreviewDigest, approvalPassword });
          posted = true; status.className = 'ok'; status.textContent = data.message;
          dialog.querySelector('[data-confirm]').hidden = true;
          if (onSaved) await onSaved(data);
        });
      });
      updateMode();
    }
  };
})();
