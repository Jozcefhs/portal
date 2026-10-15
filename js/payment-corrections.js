(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = value => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(Number(value) || 0);
  const student = row => `${row.DisplayName || ''} · ${row.AccountRef || row.AdmissionNo || ''} · ${row.ClassName || ''}`;
  window.DynamaxPaymentCorrections = {
    canAccess: user => user?.edition === 'school' && (user.allowedSections || []).includes('accounts')
      && ['Accounts Officer', 'Super Admin', 'Director'].includes(user.assignedRole || user.role),
    open({ fetch: staffFetch, user, accounts = [], onSaved }) {
      if (!this.canAccess(user) || document.getElementById('paymentCorrectionDialog')) return;
      const dialog = document.createElement('dialog');
      dialog.id = 'paymentCorrectionDialog'; dialog.className = 'workflow-dialog payment-correction-dialog';
      dialog.setAttribute('aria-labelledby', 'paymentCorrectionTitle');
      dialog.innerHTML = `<header><h2 id="paymentCorrectionTitle">Correct manual payment</h2><button type="button" data-close aria-label="Close">×</button></header>
        <p>Correct a wallet top-up or school-fee receipt. The original receipt stays in the audit trail. This does not send money or refund a bank transfer.</p>
        <form autocomplete="off">
          <section class="payment-history-search" aria-label="Find a student's payment history">
            <label>Student's full admission number<input name="SearchAccountRef" autocomplete="off" maxlength="180" placeholder="e.g. DCA/25/2024"></label>
            <button type="button" data-search>Search payments</button>
            <small>Search all dates and academic sessions in your permitted branch and school section. Results show receipt amounts, not wallet balances.</small>
            <p data-history-status role="status" aria-live="polite"></p>
            <div data-history-results></div>
            <button type="button" data-more hidden>Load more payments</button>
          </section>
          <label>Original payment reference<input name="Reference" required autocomplete="off" placeholder="Use a receipt above or enter its exact reference"></label>
          <small>Use a receipt from the results, or enter its payment reference and load it to check the current wallet balance.</small>
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
      let historyRows = [], nextCursor = '', searchAccountRef = '', searchVersion = 0;
      const historyStatus = dialog.querySelector('[data-history-status]'), historyResults = dialog.querySelector('[data-history-results]');
      const moreButton = dialog.querySelector('[data-more]');
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
        if (event.target.name === 'SearchAccountRef') {
          searchVersion++; historyRows = []; nextCursor = ''; searchAccountRef = '';
          historyStatus.textContent = ''; historyStatus.className = ''; historyResults.textContent = ''; moreButton.hidden = true;
          form.elements.Reference.value = ''; dialog.querySelector('[data-receipt]').textContent = '';
        }
        if (event.target.name === 'Reference') dialog.querySelector('[data-receipt]').textContent = '';
        updateMode();
      });
      const lock = value => {
        busy = value;
        dialog.querySelectorAll('input,select,textarea,button').forEach(el => {
          el.disabled = value || el.hasAttribute('data-unavailable') || (posted && !el.hasAttribute('data-close'));
        });
      };
      const run = async task => {
        if (busy || posted) return;
        lock(true); status.className = ''; status.textContent = 'Checking…';
        try { await task(); }
        catch (error) { status.textContent = error.message; status.className = 'bad'; void window.DynamaxStaffActionFeedback?.report(error.message, 'bad'); }
        finally { lock(false); dialog.querySelector('[name="approvalPassword"]').value = ''; }
      };
      dialog.querySelector('[data-close]').addEventListener('click', () => { if (!busy) dialog.close(); });
      dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
      dialog.addEventListener('close', () => { searchVersion++; dialog.remove(); });
      const renderHistory = data => {
        const byId = new Map(historyRows.map(row => [row.Id, row]));
        data.Rows.forEach(row => byId.set(row.Id, row));
        historyRows = [...byId.values()].sort((a, b) => String(b.PaidAt).localeCompare(String(a.PaidAt)) || String(a.Id).localeCompare(String(b.Id)));
        nextCursor = data.NextCursor || ''; moreButton.hidden = !nextCursor;
        historyStatus.textContent = `${student(data.Student)} — ${historyRows.length} payment(s) loaded. ${nextCursor ? 'More history is available below.' : 'Full payment history loaded.'}`;
        historyResults.innerHTML = historyRows.length ? `<ul class="payment-history-results">${historyRows.map((row, index) => {
          let amount = 'Not recorded';
          if (Number.isFinite(row.Amount)) {
            try { amount = new Intl.NumberFormat('en-NG', { style: 'currency', currency: row.Currency || 'NGN' }).format(row.Amount); }
            catch { amount = `${row.Currency} ${row.Amount.toFixed(2)}`; }
          }
          const timestamp = new Date(row.PaidAt);
          const date = Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) + ' WAT' : row.PaidAt || 'Date not recorded';
          return `<li><div><strong>${esc(row.FeeName || 'Payment')}</strong><span>Receipt amount: ${esc(amount)}</span>
            <small>${esc(date)} · ${esc(row.Source)}${row.RecordedBy ? ` · Recorded by ${esc(row.RecordedBy)}` : ''}</small>
            <small>Reference: ${esc(row.Reference || 'Not recorded')}${row.ReceiptNo ? ` · Receipt: ${esc(row.ReceiptNo)}` : ''}</small>
            <small>${esc([row.AcademicSession, row.Term, row.CorrectionStatus].filter(Boolean).join(' · '))}</small>
            ${row.CanSelect ? '' : `<small>${esc(row.UnavailableReason)}</small>`}</div>
            <button type="button" data-use-receipt="${index}"${row.CanSelect ? '' : ' disabled data-unavailable'}>Use receipt</button></li>`;
        }).join('')}</ul>` : '<p>No payments found for this student in the pages loaded.</p>';
      };
      const searchHistory = more => {
        const accountRef = form.elements.SearchAccountRef.value.trim();
        if (busy || posted) return;
        if (!accountRef) { historyStatus.textContent = "Enter the student's full admission number."; historyStatus.className = 'bad'; form.elements.SearchAccountRef.focus(); return; }
        if (more && (!nextCursor || accountRef !== searchAccountRef)) return;
        const cursor = more ? nextCursor : '', version = ++searchVersion;
        if (!more) {
          historyRows = []; nextCursor = ''; searchAccountRef = accountRef;
          historyResults.textContent = ''; historyStatus.textContent = ''; moreButton.hidden = true;
          form.elements.Reference.value = ''; dialog.querySelector('[data-receipt]').textContent = ''; invalidate();
        }
        historyStatus.className = ''; historyStatus.textContent = more ? 'Loading more payments…' : 'Searching all payment history…';
        return run(async () => {
          let data;
          try { data = await api({ action: 'search', AccountRef: accountRef, ...(cursor ? { Cursor: cursor } : {}) }); }
          catch (error) {
            if (dialog.isConnected && version === searchVersion) {
              historyStatus.textContent = `${error.message}${more ? ' Already loaded payments are retained; use Load more payments to retry.' : ''}`;
              historyStatus.className = 'bad';
            }
            throw error;
          }
          if (!dialog.isConnected || version !== searchVersion || accountRef !== form.elements.SearchAccountRef.value.trim()) return;
          renderHistory(data); status.textContent = historyRows.length ? 'Choose the receipt to correct. Searching does not change any balance.' : 'No payment selected.';
        });
      };
      dialog.querySelector('[data-search]').addEventListener('click', () => searchHistory(false));
      moreButton.addEventListener('click', () => searchHistory(true));
      form.elements.SearchAccountRef.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); searchHistory(false); }
      });
      const showReceipt = row => {
        const balance = Number.isFinite(row.CurrentWalletBalance) ? money(row.CurrentWalletBalance) : 'Not loaded — load receipt again';
        dialog.querySelector('[data-receipt]').innerHTML = `<p>${esc(student(row.Student))} — ${esc(row.Type)}</p>
          <dl class="payment-correction-amounts">
            <div><dt>Receipt amount</dt><dd>${esc(money(row.OriginalAmount))}</dd></div>
            ${row.Type === 'Wallet' ? `<div><dt>Current wallet balance</dt><dd>${esc(balance)}</dd></div>` : ''}
            <div><dt>Receipt remaining after corrections</dt><dd>${esc(money(row.RemainingAmount))}</dd></div>
          </dl>
          ${row.Type === 'Wallet' ? '<small>The wallet balance includes all credits and spending, not just this receipt. Checked when loaded; checked again before confirmation.</small>' : ''}`;
        form.elements.Kind.querySelector('[value="move"]').disabled = row.Type !== 'Wallet';
        if (row.Type !== 'Wallet' && form.elements.Kind.value === 'move') form.elements.Kind.value = 'reduce';
        updateMode();
      };
      const loadReceipt = () => run(async () => {
        const reference = form.elements.Reference.value;
        dialog.querySelector('[data-receipt]').textContent = '';
        invalidate(); const data = await api({ action: 'lookup', Reference: reference });
        if (!dialog.isConnected || form.elements.Reference.value !== reference) return;
        showReceipt(data.Receipt); status.textContent = 'Choose the correction and enter a reason.';
        dialog.querySelector('[data-receipt]').scrollIntoView({ block: 'nearest' });
      });
      dialog.querySelector('[data-lookup]').addEventListener('click', loadReceipt);
      historyResults.addEventListener('click', event => {
        const button = event.target.closest('[data-use-receipt]');
        if (!button || !historyResults.contains(button) || busy || posted) return;
        const row = historyRows[Number(button.dataset.useReceipt)];
        if (!row?.CanSelect) return;
        form.elements.Reference.value = row.Reference;
        loadReceipt();
      });
      // Read enabled fields before locking: disabled fields are excluded by FormData.
      form.addEventListener('submit', event => {
        event.preventDefault(); const input = values();
        run(async () => {
          const data = await api({ ...input, action: 'preview' });
          preview = { input, data }; showReceipt(data.replayed ? { ...data.Receipt, CurrentWalletBalance: undefined } : data.Receipt);
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
          // A successful correction changes the balance. Do not leave the pre-correction value labelled current.
          if (data.Receipt) showReceipt({ ...data.Receipt, RemainingAmount: data.RemainingAmount,
            CurrentWalletBalance: data.replayed ? undefined : data.BalanceAfter });
          dialog.querySelector('[data-confirm]').hidden = true;
          if (onSaved) await onSaved(data);
        });
      });
      updateMode();
    }
  };
})();
