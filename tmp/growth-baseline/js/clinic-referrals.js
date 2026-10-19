const clean = value => String(value ?? '').trim();
const escape = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function mountClinicReferrals(host, { request, setStatus, accountRef = '', today, openSignatureSettings }) {
  let student = null, visits = [], referral = null, pdfUrl = '', busy = false, searchGeneration = 0;
  host.innerHTML = `<header class="config-card-heading"><div><small>Parent communication</small><h3>Hospital referral letter</h3>
    <p>Prepare a confidential letter for one clinic visit using your configured PDF letterhead. Your saved personal signature is added automatically, with the referral date beside it. Without a saved signature, a handwritten-signature line is provided. Review the PDF before sending.</p></div></header>
    <button type="button" data-referral-signature-settings${openSignatureSettings ? '' : ' hidden'}>My signature settings</button>
    <form data-referral-find class="workflow-form config-form"><label>Student admission number<input name="AccountRef" value="${escape(accountRef)}" required autocomplete="off"></label><button type="submit">Find student / clinic visits</button></form>
    <p data-referral-status class="status" role="status" aria-live="polite"></p>
    <section data-referral-workspace hidden>
      <p data-referral-student class="muted"></p>
      <form data-referral-form class="workflow-form workflow-form-grid config-form">
        <label>Saved clinic visit<select name="VisitId" required></select></label>
        <label>Referral date<input name="ReferralDate" type="date" value="${escape(today)}" required></label>
        <label>Receiving hospital / medical centre<input name="Hospital" maxlength="180" required></label>
        <label>Clinic staff role / designation<input name="ClinicianTitle" value="Clinic staff" maxlength="100" required></label>
        <label>Clinic contact (optional)<input name="ClinicContact" maxlength="160"></label>
        <label>Reason for hospital referral<textarea name="Reason" maxlength="1800" required></textarea></label>
        <label>Clinical observations<textarea name="Observations" maxlength="2400"></textarea></label>
        <label>Care / treatment already provided<textarea name="Treatment" maxlength="2400"></textarea></label>
        <label>Instructions / follow-up for parent (optional)<textarea name="Instructions" maxlength="1800"></textarea></label>
        <div class="config-actionbar"><p class="muted">Review all details before issuing. This does not change the visit, record a hospital admission, or contact the hospital.</p><button type="submit">Generate PDF / preview</button></div>
      </form>
      <label>Previously prepared referrals<select data-referral-history><option value="">Choose a saved referral</option></select></label>
      <section data-referral-preview hidden>
        <p data-referral-summary></p>
        <div class="form-actions"><a data-referral-open target="_blank" rel="noopener">Open PDF / print preview</a> <a data-referral-download>Download PDF</a></div>
        <iframe data-referral-frame title="Hospital referral PDF preview" style="width:100%;height:560px;border:1px solid #cad8e3;margin-top:12px"></iframe>
        <p class="muted">If your browser does not show the PDF here, use Open PDF / print preview or Download PDF above.</p>
        <label class="check-row"><input type="checkbox" data-referral-confirm> I have reviewed this PDF and checked the parent recipient shown above.</label>
        <button type="button" data-referral-send disabled>Email PDF to parent</button>
      </section>
    </section>`;
  const find = host.querySelector('[data-referral-find]'), form = host.querySelector('[data-referral-form]');
  const workspace = host.querySelector('[data-referral-workspace]'), preview = host.querySelector('[data-referral-preview]');
  const status = host.querySelector('[data-referral-status]'), history = host.querySelector('[data-referral-history]');
  const send = host.querySelector('[data-referral-send]'), confirm = host.querySelector('[data-referral-confirm]');
  const invalidate = () => {
    referral = null; preview.hidden = true; confirm.checked = false; send.disabled = true;
    host.querySelector('[data-referral-frame]').removeAttribute('src');
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = '';
  };
  const canSend = () => referral && referral.ParentEmail && ['Draft', 'Failed'].includes(referral.Status);
  const show = row => {
    invalidate(); referral = row;
    const bytes = Uint8Array.from(atob(row.PdfBase64), char => char.charCodeAt(0));
    pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    host.querySelector('[data-referral-frame]').src = pdfUrl;
    host.querySelector('[data-referral-open]').href = pdfUrl;
    const download = host.querySelector('[data-referral-download]');
    download.href = pdfUrl; download.download = row.FileName;
    host.querySelector('[data-referral-summary]').textContent = `${row.StudentName} · ${row.ReferralDate} · ${row.Hospital} · ${row.Status === 'Sent' ? 'Accepted by email provider' : row.Status}. Parent recipient: ${row.ParentEmail || 'No parent email saved — PDF download / print only'}. ${row.SignatureApplied ? `Saved signature of ${row.PreparedBy} included.` : 'No saved signature applied — print for handwritten signature, or save your signature and generate a new PDF.'} Reference: ${row.ReferralId}`;
    preview.hidden = false; confirm.disabled = !canSend();
    const optionLabel = `${row.ReferralDate} · ${row.Hospital} · ${row.Status}`;
    const previousOption = [...history.options].find(option => option.value === row.ReferralId);
    if (previousOption) previousOption.textContent = optionLabel;
    else history.add(new Option(optionLabel, row.ReferralId));
    history.value = row.ReferralId;
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const run = async operation => {
    if (busy) return;
    busy = true;
    host.querySelectorAll('button, input, select, textarea').forEach(node => { node.disabled = true; });
    try { await operation(); }
    catch (error) { setStatus(status, error.message || String(error), 'bad'); }
    finally {
      busy = false;
      host.querySelectorAll('button, input, select, textarea').forEach(node => { node.disabled = false; });
      confirm.disabled = !canSend(); send.disabled = !(canSend() && confirm.checked);
    }
  };
  const applyVisit = () => {
    const visit = visits.find(row => row.VisitId === form.elements.VisitId.value);
    form.elements.Observations.value = visit?.Complaint || '';
    form.elements.Treatment.value = visit?.Treatment || '';
    invalidate(); history.value = '';
  };
  host.querySelector('[data-referral-signature-settings]').addEventListener('click', () => {
    invalidate(); openSignatureSettings?.();
  });
  find.elements.AccountRef.addEventListener('input', () => {
    searchGeneration++; student = null; workspace.hidden = true; invalidate();
  });
  find.addEventListener('submit', event => {
    event.preventDefault();
    const account = find.elements.AccountRef.value, generation = ++searchGeneration;
    run(async () => {
      invalidate(); workspace.hidden = true; student = null;
      const result = await request('prepareClinicReferral', { AccountRef: account });
      if (generation !== searchGeneration || !host.isConnected) return;
      student = result.student; visits = result.visits;
      host.querySelector('[data-referral-student]').textContent = `${student.StudentName} · ${student.AccountRef} · ${student.ClassName} · Parent: ${student.ParentEmail || 'No parent email saved (download / print only)'}`;
      form.elements.VisitId.innerHTML = `<option value="">Choose the visit being referred</option>${visits.map(row => `<option value="${escape(row.VisitId)}">${escape(row.Date)} · ${escape(row.Complaint)} · ${escape(row.Disposition)}</option>`).join('')}`;
      form.reset(); form.elements.ReferralDate.value = today;
      history.innerHTML = '<option value="">Choose a saved referral</option>' + result.referrals.map(row => `<option value="${escape(row.ReferralId)}">${escape(row.ReferralDate)} · ${escape(row.Hospital)} · ${escape(row.Status)}</option>`).join('');
      workspace.hidden = false;
      setStatus(status, visits.length ? result.message : 'No active clinic visits found. Save a clinic visit first.', visits.length ? 'ok' : 'bad');
    });
  });
  form.elements.VisitId.addEventListener('change', applyVisit);
  form.addEventListener('input', () => { invalidate(); history.value = ''; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!student) return;
    // Capture before run disables controls (disabled fields are omitted by FormData).
    const payload = { ...Object.fromEntries(new FormData(form)), AccountRef: student.AccountRef };
    run(async () => {
      invalidate();
      const result = await request('previewClinicReferral', payload);
      if (host.isConnected) { show(result.referral); setStatus(status, result.message, 'ok'); }
    });
  });
  history.addEventListener('change', () => {
    const id = history.value;
    if (!id) { invalidate(); return; }
    run(async () => {
      invalidate();
      const result = await request('loadClinicReferral', { ReferralId: id });
      if (host.isConnected) show(result.referral);
    });
  });
  confirm.addEventListener('change', () => { send.disabled = !(canSend() && confirm.checked); });
  send.addEventListener('click', () => {
    if (!canSend() || !confirm.checked) return;
    const saved = referral;
    run(async () => {
      const approved = await window.DynamaxDialogs.confirm({ title: 'Email hospital referral?',
        message: `Send the reviewed PDF for ${saved.StudentName} to ${saved.ParentEmail}? This contains confidential clinic information.`, confirmText: 'Send PDF to parent' });
      if (!approved || !host.isConnected) return;
      try {
        const result = await request('sendClinicReferral', { ReferralId: saved.ReferralId, ConfirmSend: true, ConfirmedParentEmail: saved.ParentEmail });
        if (host.isConnected) { show(result.referral); setStatus(status, result.message, 'ok'); }
      } catch (error) {
        // Even if the response was lost, do not offer a blind resend. Reload saved status first.
        confirm.checked = false; referral = { ...saved, Status: 'Check delivery status' };
        throw error;
      }
    });
  });
  const observer = new MutationObserver(() => {
    if (!host.isConnected) { invalidate(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
