const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const money = value => `₦${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function cardRefundReport(result) {
  const buyers = new Map();
  for (const row of result.Rows || []) {
    const buyer = buyers.get(row.AdmissionNo) || { name: row.StudentName, ref: row.AdmissionNo, count: 0, amount: 0, posted: 0, issues: [] };
    buyer.count++; buyer.amount += row.Amount;
    if (row.Status === 'Posted') buyer.posted += row.Amount;
    if (row.Problem) buyer.issues.push(row.Problem);
    buyers.set(row.AdmissionNo, buyer);
  }
  return `<p>${esc(result.ItemName)} · ${result.Count} purchases · ${result.Students} students · Refund total <strong>${money(result.Total)}</strong>.</p>
    <p><strong>${result.PostedCount} refunds posted: ${money(result.PostedAmount)}</strong>. Payments, receipts and original wallet debits are preserved. Cards are not restocked.</p>
    ${(result.Errors || []).map(error => `<p class="vendor-status error">${esc(error)}</p>`).join('')}
    ${(result.Requests || []).length ? `<p>Vendor requests: ${result.Requests.map(r => `${esc(r.SettlementId)} — ${money(r.Amount)} — ${esc(r.Status)}`).join('<br>')}. ${result.Status === 'Preview' ? 'These unpaid requests will be cancelled with history retained when Accounts approves.' : 'Original request amounts, allocations and history are retained.'}</p>` : ''}
    <div class="vendor-table-wrap"><table class="vendor-table"><thead><tr><th>Student / admission no.</th><th>Cards</th><th>Amount paid</th><th>Refund amount</th><th>Refund posted</th><th>Reversal status</th></tr></thead><tbody>${[...buyers.values()].sort((a,b) => a.name.localeCompare(b.name)).map(b =>
      `<tr><td>${esc(b.name)}<small>${esc(b.ref)}</small></td><td>${b.count}</td><td class="vendor-amount">${money(b.amount)}</td><td class="vendor-amount">${money(b.amount)}</td><td class="vendor-amount">${money(b.posted)}</td><td>${b.issues.length ? `Blocked: ${b.issues.map(esc).join('; ')}` : b.posted === b.amount ? 'Posted' : b.posted ? 'Partly posted — resume' : 'Not posted'}</td></tr>`).join('')}</tbody></table></div>`;
}

export async function openCardRefundBatch({ vendorId, canPost, request, print, isCurrent, onClose }) {
  const modal = document.createElement('dialog'); modal.className = 'vendor-dialog card-refund-dialog';
  modal.innerHTML = `<header class="vendor-header"><h3>Reviewed NFC card wallet refunds</h3><button type="button" data-close aria-label="Close refund review">×</button></header>
    <p>Accounts Officer approval is required. This batch covers only the 255 reviewed purchases: ₦892,500, including repeat purchases.</p>
    <div class="vendor-actions"><button type="button" data-review>Refresh review / status</button><button type="button" data-print disabled>Print / Save PDF register</button></div>
    <p role="status" aria-live="polite" data-progress>Loading read-only review…</p><div data-report></div>
    <form class="vendor-form" data-approval hidden>
      <label class="vendor-full">Reason<textarea name="Notes" required maxlength="2000">Refund of 4k RFID S70 NFC Card purchases because sales approval is under review.</textarea></label>
      <label>Approval evidence reference<input name="EvidenceReference" required maxlength="2000"></label>
      <label>Accounts Officer password<input name="approvalPassword" type="password" autocomplete="current-password" required></label>
      <label class="vendor-check vendor-full"><input name="Confirmed" type="checkbox" required> I approve all 255 refunds totalling ₦892,500 and cancellation of the listed unpaid vendor requests.</label>
      <button type="submit" class="vendor-full">Approve and post all</button>
    </form><button type="button" data-resume hidden>Resume approved refunds</button><button type="button" data-stop hidden>Pause after current refund</button>`;
  document.body.append(modal); modal.showModal();
  let result, running = false, stop = false, changed = false, closed = false;
  const progress = modal.querySelector('[data-progress]'), form = modal.querySelector('form');
  const live = () => !closed && modal.isConnected && isCurrent();
  const show = () => {
    if (!live()) return;
    modal.querySelector('[data-report]').innerHTML = cardRefundReport(result);
    form.hidden = running || !canPost || result.Status !== 'Preview' || !result.CanApprove;
    modal.querySelector('[data-resume]').hidden = running || !canPost || !['Approved','Processing'].includes(result.Status);
    modal.querySelector('[data-stop]').hidden = !running;
    modal.querySelector('[data-review]').disabled = running;
    modal.querySelector('[data-print]').disabled = running;
    modal.querySelector('[data-close]').disabled = running;
  };
  const api = async (action, body = {}) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
    try { return await request(action, { ...body, VendorId: vendorId }, controller.signal); }
    finally { clearTimeout(timer); }
  };
  const failure = error => {
    if (!live()) return;
    progress.textContent = `${error.name === 'AbortError' ? 'The request timed out; its result is not yet confirmed.' : error.message} Refresh review / status before resuming. Posted refunds are retained and cannot be duplicated.`;
    void window.DynamaxStaffActionFeedback?.report(progress.textContent, 'bad');
  };
  const refresh = async () => {
    if (running) return;
    running = true; modal.querySelector('[data-review]').disabled = true; form.hidden = true;
    try {
      const next = await api('previewCardRefundBatch');
      if (!live()) return;
      result = next; progress.textContent = `${next.message}${canPost ? '' : ' Sign in as an Accounts Officer to approve/post.'}`;
    } catch (error) { failure(error); }
    finally { running = false; if (result) show(); else if (live()) modal.querySelector('[data-review]').disabled = false; }
  };
  const process = async () => {
    while (live() && !stop && result.Status !== 'Completed') {
      progress.textContent = `Posting safely: ${result.PostedCount} / ${result.Count} confirmed (${money(result.PostedAmount)}). Keep this window open, or pause and resume later.`;
      result = await api('postCardRefundBatch'); changed = true; show();
    }
    if (live()) {
      progress.textContent = result.Status === 'Completed' ? result.message : `Paused: ${result.PostedCount} / ${result.Count} refunds posted. The vendor settlement hold remains until completion.`;
      if (result.Status === 'Completed') void window.DynamaxStaffActionFeedback?.report(`${result.message} ${money(result.PostedAmount)} credited to student wallets.`, 'ok');
    }
  };
  const run = async approve => {
    if (running || !canPost) return;
    if (approve && !form.reportValidity()) return;
    running = true; stop = false; show();
    try {
      if (approve) {
        const body = Object.fromEntries(new FormData(form));
        progress.textContent = 'Validating approval and reconciling the unpaid vendor requests…';
        result = await api('approveCardRefundBatch', { ...body, Confirmed: form.elements.Confirmed.checked, PreviewDigest: result.PreviewDigest });
        form.elements.approvalPassword.value = ''; changed = true; show();
      }
      await process();
    } catch (error) { failure(error); }
    finally { form.elements.approvalPassword.value = ''; running = false; if (live()) show(); }
  };
  form.onsubmit = event => { event.preventDefault(); void run(true); };
  modal.querySelector('[data-resume]').onclick = () => run(false);
  modal.querySelector('[data-review]').onclick = refresh;
  modal.querySelector('[data-print]').onclick = () => print('NFC card refund register', cardRefundReport(result));
  modal.querySelector('[data-stop]').onclick = () => { stop = true; progress.textContent = 'Pausing after the current refund is confirmed…'; };
  modal.querySelector('[data-close]').onclick = () => { if (!running) modal.close(); };
  modal.addEventListener('cancel', event => { if (running) event.preventDefault(); });
  modal.addEventListener('close', () => { closed = true; modal.remove(); if (changed) onClose(); });
  await refresh();
  return { close() { stop = true; closed = true; modal.close(); modal.remove(); } };
}
