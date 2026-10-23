const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const escape = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const list = value => Array.isArray(value) ? value : [];
const label = (rows, id, field) => clean(list(rows).find(row => row[field] === id)?.Name || id);

export function cbtRejectionNextStep(rejection = {}) {
  if (rejection.Code === 'ACADEMIC_CBT_SYNC_ATTEMPT_CONFLICT') {
    return 'Compare the saved online mark with the original attempt/report on both CBT servers. If the saved mark is correct, keep it—do not repeat the test or repeatedly push the rejected attempt. If correction is needed, an authorised academic manager must use the existing score-editing and approval workflow.';
  }
  return 'Check the recorded reason and the original CBT server upload report. Use the scorebook to verify the saved mark, then ask an authorised academic manager to resolve the issue. This review does not approve, retry or overwrite any result.';
}

export function buildCbtRejectionReview(batch, data = {}, snapshot = null) {
  const rejected = list(batch.RejectedScores);
  const count = Math.max(rejected.length, Number(batch.RejectedCount) || 0);
  const savedSheet = list(data.scoreSheets).find(row => row.SheetId === batch.SheetId);
  const sheet = snapshot?.sheet || savedSheet;
  const component = list(sheet?.AssessmentComponents).find(row => row.Id === batch.AssessmentComponentId);
  const scores = snapshot ? list(snapshot.scores) : [];
  const rows = rejected.map(rejection => {
    const studentRef = clean(rejection.StudentRef);
    const person = list(data.students).find(row => lower(row.StudentRef || row.AdmissionNo) === lower(studentRef));
    const membership = list(data.studentMemberships).find(row => lower(row.StudentRef) === lower(studentRef)
      && row.SessionId === batch.SessionId && row.TermId === batch.TermId && row.ClassId === batch.ClassId);
    const matches = scores.filter(row => row.SheetId === batch.SheetId && lower(row.StudentRef) === lower(studentRef));
    const score = matches.length === 1 ? matches[0] : null;
    const recorded = list(score?.ComponentScores).find(row => row.ComponentId === batch.AssessmentComponentId);
    const split = component?.ScoreEntryMode === 'objective-theory' || list(recorded?.Parts).length > 0;
    const cell = split ? list(recorded?.Parts).find(row => row.PartId === 'objective') : recorded;
    const cellId = `${batch.AssessmentComponentId}${split ? ':objective' : ''}`;
    const source = list(score?.CbtScoreSources).find(row => row.CellId === cellId);
    const corrected = list(score?.ManualScoreCorrections).some(row => row.CellId === cellId);
    let onlineScore = 'Not checked yet';
    if (snapshot) {
      onlineScore = matches.length > 1 ? 'Duplicate score records—needs review'
        : cell?.State === 'Numeric' && clean(cell.RawScore) !== '' && Number.isFinite(Number(cell.RawScore))
          ? `${cell.RawScore} / ${cell.MaximumScore ?? batch.MaximumScore ?? 'maximum not recorded'}`
          : clean(cell?.State) || 'Not found in this scorebook';
    }
    return {
      studentRef: studentRef || 'Admission number not recorded',
      studentName: clean(person?.StudentName || person?.DisplayName || person?.Name || membership?.StudentName || rejection.StudentName) || 'Name unavailable',
      reason: clean(rejection.Reason || rejection.Message) || 'This receipt did not save a reason. Check the original server upload report.',
      code: clean(rejection.Code) || 'Not recorded', onlineScore,
      evidence: snapshot ? [corrected ? 'Authorised manual correction recorded' : '',
        source?.AttemptId ? `Saved attempt: ${source.AttemptId}` : '',
        source?.SourceTestId ? `Saved test: ${source.SourceTestId}` : '',
        source?.SubmittedAt ? `Submitted: ${source.SubmittedAt}` : '',
        sheet?.Status ? `Current scorebook: ${sheet.Status}` : ''].filter(Boolean).join('\n') || 'No attempt details available' : 'Load current online marks to compare.',
      nextStep: cbtRejectionNextStep(rejection)
    };
  });
  return {
    title: `${label(data.classes, batch.ClassId, 'ClassId')} / ${label(data.arms, batch.ArmId, 'ArmId')} · ${label(data.subjects, batch.SubjectId, 'SubjectId')} · ${component?.Name || batch.AssessmentComponentId}`,
    period: `${label(data.sessions, batch.SessionId, 'SessionId')} · ${label(data.terms, batch.TermId, 'TermId')}`,
    batchId: clean(batch.BatchId || batch.SyncId || batch.RecordId),
    synchronizedAt: clean(batch.SynchronizedAt) || 'Not recorded',
    imported: Number(batch.ImportedRows) || 0, count, unavailable: Math.max(0, count - rejected.length), rows
  };
}

function reviewTable(rows) {
  return `<table><thead><tr><th>Student / admission number</th><th>Reason recorded at upload</th><th>Current online score</th><th>How to review</th></tr></thead><tbody>${rows.map(row => `<tr>
    <td><strong>${escape(row.studentName)}</strong><br>${escape(row.studentRef)}</td>
    <td>${escape(row.reason)}<small>Code: ${escape(row.code)}</small></td>
    <td><strong>${escape(row.onlineScore)}</strong><small>${escape(row.evidence)}</small></td>
    <td>${escape(row.nextStep)}</td></tr>`).join('') || '<tr><td colspan="4">No saved rejection details match this search.</td></tr>'}</tbody></table>`;
}

function missingDetails(model) {
  return model.unavailable ? `<p class="review-warning">This receipt reports ${model.count} rejected result(s), but per-student details are unavailable for ${model.unavailable}. They cannot be reconstructed from the count alone. Check the original CBT server upload report. Do not assume those students have no saved scores.</p>` : '';
}

export function cbtRejectionPrintHtml(model, rows = model.rows, checked = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>CBT rejection review</title><style>
    @page{size:A4 landscape;margin:10mm}body{font:12px/1.4 Arial;color:#17324d;margin:24px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #acbfce;padding:8px;vertical-align:top;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#edf3f7}small{display:block;margin-top:6px}thead{display:table-header-group}tr{break-inside:avoid}@media print{button{display:none}body{margin:0}}</style></head><body>
    <button onclick="window.print()">Print / Save as PDF</button><h1>CBT rejection review</h1><h2>${escape(model.title)}</h2><p>${escape(model.period)}</p>
    <p>Batch: ${escape(model.batchId)} · Uploaded: ${escape(model.synchronizedAt)}<br>${model.imported} saved · ${model.count} rejected · ${rows.length} shown</p>
    <p>Read-only review. Already saved scores are unchanged. Current marks checked: ${escape(checked || 'Not checked')}.</p>${missingDetails(model)}${reviewTable(rows)}</body></html>`;
}

export function openCbtRejectionReview({ batch, data, loadSnapshot, openScorebook, isCurrent = () => true, trigger }) {
  const origin = trigger || document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'cbt-rejection-review';
  dialog.setAttribute('aria-label', 'Review rejected CBT students');
  dialog.innerHTML = `<style>
    .cbt-rejection-review{box-sizing:border-box;width:min(1200px,95vw);max-width:95vw;max-height:92vh;overflow:auto;border:1px solid #aebfce;border-radius:12px;padding:20px;color:#17324d;background:#fff;font:14px/1.45 system-ui,sans-serif}
    .cbt-rejection-review::backdrop{background:#152b4599}.cbt-rejection-review header,.cbt-rejection-review .review-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.cbt-rejection-review header{justify-content:space-between}
    .cbt-rejection-review h2{margin:0}.cbt-rejection-review button{padding:9px 13px;cursor:pointer}.cbt-rejection-review label{display:block;margin:14px 0}.cbt-rejection-review input{box-sizing:border-box;display:block;width:100%;padding:10px;border:1px solid #aebfce;border-radius:6px}
    .cbt-rejection-review .review-table{overflow:auto;max-height:55vh}.cbt-rejection-review table{width:100%;min-width:850px;border-collapse:collapse;table-layout:fixed}.cbt-rejection-review th,.cbt-rejection-review td{border:1px solid #b9cbd9;padding:10px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.cbt-rejection-review th{background:#edf3f7;position:sticky;top:0}.cbt-rejection-review small{display:block;margin-top:6px}.cbt-rejection-review .review-warning{background:#fff3d9;padding:12px}.cbt-rejection-review [data-status],.cbt-rejection-review [data-summary]{white-space:pre-wrap}
    </style><header><h2>Review rejected CBT students</h2><button type="button" data-close>Close</button></header>
    <p data-summary></p><p>Read-only review: this window does not approve or retry uploads, unlock scorebooks, or change saved marks.</p>
    <div class="review-actions"><button type="button" data-refresh>Refresh current online marks</button><button type="button" data-scorebook>Open this scorebook</button><button type="button" data-print>Preview / print</button></div>
    <p role="status" data-status></p><div data-missing></div><label>Find rejected student<input type="search" data-search placeholder="Name, admission number, reason or code"></label><p data-count></p><div class="review-table" data-table></div>`;
  let model = buildCbtRejectionReview(batch, data), busy = false, checked = '', controller;
  const status = dialog.querySelector('[data-status]');
  const refreshButton = dialog.querySelector('[data-refresh]');
  const search = dialog.querySelector('[data-search]');
  const selectedRows = () => model.rows.filter(row => lower(`${row.studentName} ${row.studentRef} ${row.reason} ${row.code}`).includes(lower(search.value)));
  const render = () => {
    dialog.querySelector('[data-summary]').textContent = `${model.title}\n${model.period} · ${model.imported} saved · ${model.count} rejected\nBatch: ${model.batchId} · Uploaded: ${model.synchronizedAt}`;
    dialog.querySelector('[data-missing]').innerHTML = missingDetails(model);
    const rows = selectedRows();
    dialog.querySelector('[data-count]').textContent = `${rows.length} of ${model.rows.length} available rejection details`;
    dialog.querySelector('[data-table]').innerHTML = reviewTable(rows);
  };
  const close = () => dialog.close();
  const active = () => {
    if (!dialog.isConnected || !dialog.open) return false;
    if (!isCurrent()) { close(); return false; }
    return true;
  };
  dialog.addEventListener('close', () => { controller?.abort(); dialog.remove(); if (origin?.isConnected) origin.focus(); }, { once: true });
  dialog.querySelector('[data-close]').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  search.addEventListener('input', render);
  dialog.querySelector('[data-scorebook]').disabled = !openScorebook;
  dialog.querySelector('[data-scorebook]').onclick = () => { if (active()) { close(); openScorebook(); } };
  dialog.querySelector('[data-print]').onclick = () => {
    if (!active()) return;
    const popup = window.open('', '_blank');
    if (!popup) { status.textContent = 'Allow pop-ups to open the print preview.'; return; }
    popup.opener = null;
    popup.document.write(cbtRejectionPrintHtml(model, selectedRows(), checked)); popup.document.close();
  };
  const refresh = async () => {
    if (busy || !loadSnapshot || !active()) return;
    busy = true; refreshButton.disabled = true; controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    status.textContent = 'Loading current online marks… Saved rejection reasons are shown below.';
    try {
      const snapshot = await loadSnapshot(controller.signal);
      if (!active()) return;
      if (!snapshot || snapshot.SheetId !== batch.SheetId || (snapshot.sheet && snapshot.sheet.SheetId !== batch.SheetId)) throw new Error('The returned scorebook does not match this upload. No marks were changed.');
      model = buildCbtRejectionReview(batch, data, snapshot);
      checked = new Date().toLocaleString(); render();
      status.textContent = `Current marks checked: ${checked}. These are current scores, not a reconstruction of the rejected attempt. The original rejection receipt is unchanged.`;
    } catch (error) {
      if (active()) status.textContent = `Could not refresh online marks: ${controller.signal.aborted ? 'The request timed out. Try Refresh current online marks again.' : error.message || error}${checked ? ` Last successful check: ${checked}.` : ''} Saved rejection reasons remain available.`;
    } finally { clearTimeout(timeout); busy = false; if (dialog.isConnected) refreshButton.disabled = !loadSnapshot; }
  };
  refreshButton.disabled = !loadSnapshot;
  refreshButton.onclick = refresh;
  document.body.append(dialog); render(); dialog.showModal();
  if (loadSnapshot) void refresh(); else status.textContent = 'Saved rejection reasons loaded. Current online marks have not been checked.';
  return dialog;
}
