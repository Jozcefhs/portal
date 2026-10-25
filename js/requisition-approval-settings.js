const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

export async function openRequisitionApprovalSettings(request) {
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'width:min(720px,92vw);max-height:90vh;overflow:auto;border:1px solid #ccdbea;border-radius:16px;padding:24px';
  dialog.setAttribute('aria-label', 'Requisition approval settings');
  dialog.innerHTML = '<h2>Requisition approval settings</h2><p role="status">Loading…</p><button type="button" data-close>Close</button>';
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.showModal();
  try {
    const data = await request({ action: 'get' });
    if (!dialog.isConnected) return;
    dialog.innerHTML = `<h2>Requisition approval settings</h2><p>Organisation-wide · all branches · ${esc(data.edition)} edition.</p>
      <p>Checked stages run in order. Unchecked stages are bypassed. Keep at least one approval stage for each type. Authorised finance officers can complete the last checked stage within their account and amount limits. Accounts always records payment separately.</p>
      <form>${[['staff','Staff / department requisitions'],['vendor','Vendor payment requests']].map(([kind,label]) => `<fieldset style="margin:16px 0;padding:16px"><legend>${label}</legend>
        ${data.stages.map(s => `<label style="display:flex;align-items:center;justify-content:flex-start;gap:10px;margin:10px 0;font-weight:500"><input style="width:18px;height:18px;min-width:18px;flex:0 0 18px;margin:0" type="checkbox" name="${kind}" value="${esc(s.id)}" ${data.policies[kind].includes(s.id) ? 'checked' : ''}><span>${esc(s.label)}</span></label>`).join('')}
        <p data-path="${kind}" style="font-size:13px;color:#36516b"></p></fieldset>`).join('')}
      <p>Changes apply only to new requests. Existing requests and revisions keep their original approval path. Imprest and supplier-bill approvals are unchanged.</p>
      <p role="status" aria-live="polite"></p><button type="submit">Save approval settings</button> <button type="button" data-close>Close</button></form>`;
    const form = dialog.querySelector('form'), status = form.querySelector('[role=status]');
    const selection = kind => [...form.querySelectorAll(`input[name="${kind}"]:checked`)].map(i => i.value);
    const update = () => {
      for (const kind of ['staff','vendor']) form.querySelector(`[data-path="${kind}"]`).textContent =
        [...data.stages.filter(s => selection(kind).includes(s.id)).map(s => s.label), 'Accounts records payment'].join(' → ');
    };
    form.onchange = update; update();
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    form.onsubmit = async event => {
      event.preventDefault();
      const policies = { staff: selection('staff'), vendor: selection('vendor') };
      if (!policies.staff.length || !policies.vendor.length) { status.textContent = 'Select at least one stage for each request type.'; return; }
      const controls = [...form.querySelectorAll('button,input')]; controls.forEach(e => e.disabled = true);
      try {
        const result = await request({ action: 'save', policies, recordVersion: data.recordVersion });
        status.textContent = result.message;
        const refreshed = await request({ action: 'get' }); data.recordVersion = refreshed.recordVersion;
      } catch (error) { status.textContent = error.message; }
      finally { controls.forEach(e => e.disabled = false); }
    };
  } catch (error) { dialog.querySelector('[role=status]').textContent = error.message; }
}
