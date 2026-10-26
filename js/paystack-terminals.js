const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const statusName = value => ({ Creating: 'Creation unconfirmed', Pending: 'Awaiting payment', Dispatching: 'Delivery unconfirmed',
  Sent: 'Sent to terminal', Paid: 'Paid and recorded', TestPaid: 'Test payment confirmed' }[value] || value);

export async function openCardTerminal(request, { storageKey = 'terminal-payment', branchLabel = '' } = {}) {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Card terminal');
  dialog.style.cssText = 'box-sizing:border-box;width:min(760px,94vw);max-height:92vh;overflow:auto;border:1px solid #ccdbea;border-radius:16px;padding:22px';
  dialog.innerHTML = `<style>
    .terminal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}
    .terminal-grid label{display:grid;gap:5px}.terminal-grid input,.terminal-grid select{width:100%;box-sizing:border-box;min-width:0}
    .terminal-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:14px 0}.terminal-state{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf7fa;padding:14px}
    .terminal-workspace fieldset{border:1px solid #ccdbea;border-radius:8px;margin:18px 0;padding:14px;min-width:0}
    </style><div class="terminal-workspace"><div class="terminal-actions" style="justify-content:space-between"><h2>Card terminal</h2><button data-close>Close</button></div>
    <p>${esc(branchLabel)} · Paystack physical terminal</p>
    <p>Collect general income into the selected revenue account. Use the dedicated payment screens for school fees, wallets, store orders and hotel bills.</p>
    <p role="status" aria-live="polite">Loading terminal settings…</p>
    <details data-setup><summary>Terminal setup</summary><form data-settings><fieldset><div class="terminal-grid">
      <label>Terminal ID<input name="terminalId" maxlength="80"></label><label>Label<input name="label" maxlength="100"></label>
      <label>Paystack split ID (optional)<input name="splitId" inputmode="numeric"></label></div>
      <label style="display:block;margin:15px 0"><input type="checkbox" name="enabled" style="width:auto"> Enable terminal payments for this branch</label>
      <p>Keep disabled until your terminal arrives. A branch subaccount needs a matching Paystack split. Your existing Paystack connection stays on the server.</p>
      <div class="terminal-actions"><button type="submit">Verify and save setup</button><button type="button" data-reload>Reload setup</button></div>
    </fieldset></form></details>
    <form data-payment><fieldset disabled><legend>New payment</legend><div class="terminal-grid">
      <label>Payer name<input name="payerName" required maxlength="120"></label><label>Payer email<input name="email" type="email" required maxlength="200"></label>
      <label>Income account<select name="accountCode" required></select></label><label>Amount (NGN)<input name="amount" type="number" min="1" max="10000000" step="0.01" required></label>
      <label>Description<input name="description" required maxlength="200"></label></div>
      <div class="terminal-actions"><button type="submit">Create payment request</button></div></fieldset></form>
    <section><h3>Current payment</h3><div class="terminal-state" data-payment-state>No payment selected.</div>
      <div class="terminal-actions"><button data-send disabled>Send to terminal</button><button data-check disabled>Check payment</button><button data-print disabled>Print receipt</button><button data-new>New payment</button></div>
      <details><summary>Resume or recover a payment</summary><div class="terminal-grid">
        <label>Dynamax payment reference<input data-reference placeholder="TERM-…"></label><label>Paystack request code (only for recovery)<input data-code placeholder="PRQ_…"></label></div>
        <div class="terminal-actions"><button data-resume>Resume</button><button data-recover>Recover original invoice</button></div>
        <p>If creation was interrupted, copy the original PRQ code from Paystack. Recovery verifies it belongs to this saved request; it does not create a second invoice.</p>
      </details></section>
    <form data-history><fieldset><legend>Payment history</legend><div class="terminal-grid"><label>From<input name="dateFrom" type="date" required></label><label>To<input name="dateTo" type="date" required></label></div>
      <div class="terminal-actions"><button type="submit">Load selected dates</button><button type="button" data-more hidden>Load more</button></div><div data-history-rows>No history loaded. Choose up to 31 days.</div></fieldset></form></div>`;
  document.body.append(dialog); dialog.showModal();
  const $ = selector => dialog.querySelector(selector);
  const status = $('[role=status]'), settings = $('[data-settings]'), form = $('[data-payment]');
  const state = { busy: false, config: null, payment: null, reference: '' };
  try { state.reference = sessionStorage.getItem(storageKey) || ''; } catch {}
  const remember = reference => { state.reference = reference; $('[data-reference]').value = reference;
    try { if (reference) sessionStorage.setItem(storageKey, reference); else sessionStorage.removeItem(storageKey); } catch {} };
  const show = result => {
    if (result.payment) { state.payment = result.payment; remember(result.payment.RequestId); }
    const p = state.payment;
    $('[data-payment-state]').textContent = p ? [p.PayerName, p.Description, `NGN ${Number(p.Amount).toLocaleString()}`, `${p.RevenueAccountName || p.RevenueAccountCode}`,
      `Status: ${statusName(p.Status)}${p.Mode === 'test' ? ' — TEST MODE' : ''}`, p.RequestId, p.RequestCode, p.ReceiptNo ? `Receipt: ${p.ReceiptNo}` : 'No verified receipt yet.'].filter(Boolean).join('\n')
      : state.reference ? `${state.reference}\nCreation may be pending. Resume this reference to check before charging again.` : 'No payment selected.';
    if (result.message) status.textContent = result.message;
  };
  const update = () => {
    const paid = ['Paid', 'TestPaid'].includes(state.payment?.Status);
    dialog.querySelectorAll('button').forEach(button => { if (!button.matches('[data-close]')) button.disabled = state.busy; });
    settings.querySelector('fieldset').disabled = state.busy || !state.config?.canConfigure;
    settings.elements.enabled.disabled = state.busy || state.config?.available !== true;
    form.querySelector('fieldset').disabled = state.busy || state.config?.available !== true || !state.config?.settings.enabled || Boolean(state.reference);
    $('[data-send]').disabled = state.busy || state.config?.available !== true || !state.payment?.RequestCode || paid || !state.config?.settings.enabled;
    $('[data-check]').disabled = state.busy || !state.reference;
    $('[data-print]').disabled = state.busy || state.payment?.Status !== 'Paid';
  };
  async function run(operation) {
    if (state.busy || !dialog.isConnected) return;
    state.busy = true; update(); status.textContent = 'Checking…';
    try { const result = await operation(); if (dialog.isConnected) show(result || {}); }
    catch (error) { if (dialog.isConnected) status.textContent = error.message; }
    finally { state.busy = false; if (dialog.isConnected) update(); }
  }
  async function load() {
    const result = await request({ action: 'settings' });
    if (!dialog.isConnected) return {};
    state.config = result;
    for (const field of ['terminalId', 'label', 'splitId']) settings.elements[field].value = result.settings[field] || '';
    settings.elements.enabled.checked = result.settings.enabled;
    form.elements.accountCode.innerHTML = '<option value="">Choose income account</option>' + result.accounts.map(row => `<option value="${esc(row.code)}">${esc(row.name)}</option>`).join('');
    $('[data-setup]').open = !result.settings.enabled;
    return { message: result.disabledMessage || `Paystack mode: ${result.mode}. ${result.settings.enabled ? 'Terminal enabled.' : 'Terminal disabled until setup is complete.'}` };
  }
  $('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  $('[data-reload]').onclick = () => run(load);
  settings.onsubmit = event => { event.preventDefault(); run(async () => {
    const result = await request({ action: 'save-settings', version: state.config.settings.version,
      terminalId: settings.elements.terminalId.value, label: settings.elements.label.value,
      splitId: settings.elements.splitId.value, enabled: settings.elements.enabled.checked });
    await load(); return result;
  }); };
  form.onsubmit = event => { event.preventDefault(); if (!form.reportValidity() || state.reference) return;
    const payload = Object.fromEntries(new FormData(form));
    remember(`TERM-${crypto.randomUUID()}`);
    run(() => request({ ...payload, action: 'create', requestId: state.reference }));
  };
  $('[data-send]').onclick = () => run(() => request({ action: 'send', requestId: state.reference }));
  $('[data-check]').onclick = () => run(() => request({ action: 'verify', requestId: state.reference }));
  $('[data-resume]').onclick = () => run(() => request({ action: 'get', requestId: $('[data-reference]').value.trim() }));
  $('[data-recover]').onclick = () => run(() => request({ action: 'recover', requestId: $('[data-reference]').value.trim(), requestCode: $('[data-code]').value.trim() }));
  $('[data-new]').onclick = () => {
    if (state.reference && !['Paid', 'TestPaid'].includes(state.payment?.Status)
      && !window.confirm('The current payment may still be unpaid or unconfirmed. It stays in history. Start a different payment?')) return;
    state.payment = null; remember(''); form.reset(); show({ message: 'Enter a new payment. Existing requests remain in history.' }); update();
  };
  let historyFilter = null, historyCursor = '', historyRows = [];
  const loadHistory = more => {
    const filter = more ? historyFilter : Object.fromEntries(new FormData($('[data-history]')));
    run(async () => { const result = await request({ action: 'history', ...filter, ...(more ? { cursor: historyCursor } : {}) });
      if (!dialog.isConnected) return {};
      historyRows = more ? [...historyRows, ...result.payments] : result.payments;
      historyFilter = filter; historyCursor = result.nextCursor || ''; $('[data-more]').hidden = !historyCursor;
      $('[data-history-rows]').innerHTML = historyRows.map(p => `<p><button type="button" data-load="${esc(p.RequestId)}">Resume</button> ${esc(p.CreatedAt)} · ${esc(p.PayerName)} · NGN ${esc(p.Amount)} · ${esc(statusName(p.Status))}</p>`).join('') || 'No payments in this date range.';
      $('[data-history-rows]').querySelectorAll('[data-load]').forEach(button => button.onclick = () => run(() => request({ action: 'get', requestId: button.dataset.load })));
      return { message: `${historyRows.length} payments loaded.${historyCursor ? ' Use Load more for older payments in these dates.' : ''}` };
    });
  };
  $('[data-history]').onsubmit = event => { event.preventDefault(); loadHistory(false); };
  $('[data-more]').onclick = () => loadHistory(true);
  $('[data-print]').onclick = () => {
    const p = state.payment; if (p?.Status !== 'Paid') return;
    const win = window.open('', '_blank'); if (!win) { status.textContent = 'Allow the receipt preview window to print.'; return; }
    win.opener = null;
    win.document.write(`<html><head><title>Payment receipt</title></head><body><h1>Payment receipt</h1><p>${esc(branchLabel)}</p><p>${esc(p.PayerName)}</p><p>${esc(p.Description)}</p><h2>NGN ${esc(Number(p.Amount).toLocaleString())}</h2><p>Paid: ${esc(p.PaidAt)}</p><p>Receipt: ${esc(p.ReceiptNo)}</p><p>Paystack reference: ${esc(p.TransactionReference)}</p><p>Verified card terminal payment</p></body></html>`);
    win.document.close(); win.focus(); win.print();
  };
  remember(state.reference); show({});
  await run(async () => { const loaded = await load(); return state.reference ? request({ action: 'get', requestId: state.reference }) : loaded; });
}
