(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const date = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) + ' WAT' : 'Not scheduled';

  async function open({ fetch: staffFetch, onChanged = () => {} } = {}) {
    if (document.getElementById('admissionCycleDialog')) return;
    const returnFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.id = 'admissionCycleDialog';
    dialog.className = 'admission-cycle-dialog';
    dialog.setAttribute('aria-labelledby', 'admissionCycleTitle');
    dialog.innerHTML = `<header><h2 id="admissionCycleTitle">Close admission cycle</h2><button type="button" data-dismiss aria-label="Close admission cycle window">Close</button></header>
      <div class="admission-cycle-body">
        <p>This manages the selected session and term across <strong>all branches and school sections</strong>. Closing hides its applications from the active list and stops new applications for that cycle. It does not delete anything.</p>
        <fieldset><legend>School retention policy</legend>
          <label for="admissionRetentionMode">Keep applicant details</label><select id="admissionRetentionMode"><option value="never">Indefinitely — no cleanup</option><option value="days">For a set number of days after closing</option></select>
          <label for="admissionRetentionDays">Retention days</label><input id="admissionRetentionDays" type="number" min="0" max="36500" step="1" value="180" disabled>
          <p>Applies to cycles closed after saving. Each closed cycle keeps its confirmed retention period. Zero days allows cleanup immediately, but never deletes automatically.</p>
          <button type="button" data-save-policy>Save retention policy</button>
        </fieldset>
        <fieldset><legend>Choose the admission cycle</legend>
          <label for="admissionClosedCycles">Previously closed cycles</label><select id="admissionClosedCycles"><option value="">Choose a cycle, or enter one below</option></select>
          <div class="admission-cycle-grid"><label>Academic session<input name="session" placeholder="2026/2027" maxlength="9" required></label>
          <label>Term<select name="term"><option>First Term</option><option>Second Term</option><option>Third Term</option></select></label></div>
          <button type="button" data-preview>Preview cycle and admission history</button>
        </fieldset>
        <p role="status" aria-live="polite" data-status></p><section data-preview-content></section>
        <section data-backups></section>
      </div>`;
    document.body.append(dialog);
    let state = null;
    let preview = null;
    let busy = false;
    let changed = false;
    const find = selector => dialog.querySelector(selector);
    const status = message => { find('[data-status]').textContent = message; };
    const scope = () => ({ session: find('[name=session]').value.trim(), term: find('[name=term]').value });
    async function request(action, body = {}, download = false) {
      const response = await staffFetch('/api/admission-cycles', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
      if (download && response.ok) return response.blob();
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.message || 'The operation did not complete.');
      return result;
    }
    async function run(task) {
      if (busy) return;
      busy = true;
      const enabled = [...dialog.querySelectorAll('button,input,select')].filter(control => !control.disabled);
      enabled.forEach(control => { control.disabled = true; });
      dialog.setAttribute('aria-busy', 'true');
      try { await task(); }
      catch (error) { status(error.message || 'The operation did not complete. Preview again to verify the saved state.'); }
      finally {
        busy = false;
        enabled.filter(control => control.isConnected).forEach(control => { control.disabled = false; });
        dialog.removeAttribute('aria-busy');
        find('#admissionRetentionDays').disabled = find('#admissionRetentionMode').value !== 'days';
      }
    }
    async function loadState() {
      state = await request('state');
      find('#admissionRetentionMode').value = state.policy.days === null ? 'never' : 'days';
      if (state.policy.days !== null) find('#admissionRetentionDays').value = state.policy.days;
      find('#admissionClosedCycles').innerHTML = '<option value="">Choose a cycle, or enter one below</option>' + state.cycles.map((cycle, index) =>
        `<option value="${index}">${escape(cycle.AcademicSession)} · ${escape(cycle.Term)}</option>`).join('');
    }
    function invalidate() {
      preview = null;
      find('[data-preview-content]').replaceChildren();
      find('[data-backups]').replaceChildren();
      status('Preview the selected cycle before making changes.');
    }
    function renderPreview() {
      const closed = preview.cycle?.Status === 'Closed';
      const phrase = `${closed ? 'CLEAN' : 'CLOSE'} ${preview.scope.AcademicSession} ${preview.scope.Term}`;
      const rows = preview.records.map(record => `<tr><td>${escape(record.reference)}</td><td>${escape(record.name)}</td><td>${escape(record.branch)}</td><td>${escape(record.protectedReason || (record.fields.length ? 'Eligible personal details' : 'No eligible details'))}</td></tr>`).join('');
      const removal = preview.batch.map(record => `<li><strong>${escape(record.reference)}</strong>: ${record.fields.map(escape).join(', ')}</li>`).join('');
      find('[data-preview-content]').innerHTML = `<h3>${escape(preview.scope.AcademicSession)} · ${escape(preview.scope.Term)} — ${closed ? 'Closed' : 'Open'}</h3>
        <p>${preview.total} applications · ${preview.protected} protected/already cleaned · ${preview.eligible} eligible for personal-detail cleanup.</p>
        <p>${preview.unassigned} applications in this session have no valid term and are <strong>excluded</strong>. Their term must be reviewed separately.</p>
        <p>${closed ? `Closed ${escape(date(preview.cycle.ClosedAt))}. Retention: ${preview.cycle.RetentionDays === 'never' ? 'indefinite' : escape(preview.cycle.RetentionDays) + ' days'}. Cleanup eligible: ${escape(date(preview.cycle.EligibleAfter))}.` : 'Closing records the current retention policy. It does not remove applicant details.'}</p>
        <p>Enrolled/admitted applicants, students, scores, answers, payment/receipt links, documents and admission history are preserved. Existing uploaded files are not deleted. Cleanup removes only the personal form fields listed below, after a private backup passes read-back and SHA-256 verification.</p>
        <div class="admission-cycle-table"><table><thead><tr><th>Reference</th><th>Applicant</th><th>Branch</th><th>Protection / eligibility</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No applications in this cycle.</td></tr>'}</tbody></table></div>
        ${closed && preview.batch.length ? `<details><summary>Exact fields in the next cleanup batch (${preview.batch.length} applicants)</summary><ul>${removal}</ul></details>` : ''}
        ${!closed || (preview.due && preview.batch.length) ? `<label for="admissionCycleConfirm">Type <strong>${escape(phrase)}</strong> to confirm this ${closed ? 'previewed batch' : 'cycle closure'}<input id="admissionCycleConfirm" autocomplete="off"></label><button type="button" data-confirm-action>${closed ? `Back up, verify & clean ${preview.batch.length} applicants` : 'Close this admission cycle'}</button>` : `<p>${preview.eligible ? 'Cleanup is unavailable until the confirmed retention period ends.' : 'No eligible personal details remain to clean. Protected records and admission history are retained.'}</p>`}`;
      find('[data-confirm-action]')?.addEventListener('click', () => {
        const confirmation = find('#admissionCycleConfirm').value.trim();
        if (confirmation !== phrase) { status(`Type ${phrase} exactly to confirm.`); return; }
        run(async () => {
          status(closed ? 'Saving and verifying the backup, then cleaning this batch. Keep this window open.' : 'Closing the admission cycle…');
          const result = await request(closed ? 'cleanup' : 'close', { ...preview.scope, fingerprint: preview.fingerprint, confirmation });
          changed = true;
          await loadState();
          await loadPreview();
          status(closed ? `${result.cleaned} applicants cleaned after verified backup. Scores and history preserved. ${result.remaining} eligible applicants remain; review the next batch below.` : 'Admission cycle closed. No applicant details were deleted.');
        });
      });
    }
    async function loadPreview() {
      preview = await request('preview', scope());
      renderPreview();
      const backups = await request('backups', scope());
      find('[data-backups]').innerHTML = '<h3>Verified backups</h3><p>Keep downloaded copies securely. They contain the original personal details and all original application fields. Uploaded files remain in their existing private storage.</p>' +
        (backups.backups.map(backup => `<p><button type="button" data-download="${escape(backup.id)}">Download ${backup.count}-applicant backup</button> ${escape(date(backup.verifiedAt))}<br><small>SHA-256: ${escape(backup.sha256)}</small></p>`).join('') || '<p>No cleanup backups yet.</p>');
      dialog.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => run(async () => {
        const blob = await request('download', { ...scope(), backupId: button.dataset.download }, true);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `admission-backup-${button.dataset.download}.json`;
        document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        status('Verified backup downloaded. Store it securely.');
      })));
    }
    find('[data-dismiss]').addEventListener('click', () => { if (!busy) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); returnFocus?.focus(); if (changed) onChanged(); }, { once: true });
    find('#admissionRetentionMode').addEventListener('change', () => {
      find('#admissionRetentionDays').disabled = find('#admissionRetentionMode').value !== 'days';
    });
    find('[data-save-policy]').addEventListener('click', () => run(async () => {
      const days = find('#admissionRetentionMode').value === 'never' ? null : Number(find('#admissionRetentionDays').value);
      if (days !== null && (!find('#admissionRetentionDays').value || !Number.isInteger(days) || days < 0 || days > 36500)) throw new Error('Enter 0 to 36,500 whole days.');
      await request('policy', { days, revision: state.policy.revision });
      await loadState(); invalidate(); status('Retention policy saved for future closures. Existing closed cycles are unchanged.');
    }));
    find('#admissionClosedCycles').addEventListener('change', event => {
      const cycle = event.target.value === '' ? null : state.cycles[Number(event.target.value)];
      if (cycle) { find('[name=session]').value = cycle.AcademicSession; find('[name=term]').value = cycle.Term; }
      invalidate();
    });
    find('[name=session]').addEventListener('input', invalidate);
    find('[name=term]').addEventListener('change', invalidate);
    find('[data-preview]').addEventListener('click', () => run(async () => { status('Loading the full cycle and checking student links…'); await loadPreview(); status('Preview loaded. Review the protection and exact fields before confirming.'); }));
    dialog.showModal();
    await run(async () => { status('Loading school retention settings…'); await loadState(); status('Choose a session and term, then preview.'); });
  }
  window.DynamaxAdmissionCycles = { open };
})();
