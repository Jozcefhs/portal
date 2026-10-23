const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const weeklyWidths = [18, 24, 28, 15, 15], schemeWidths = [8, 32, 60];
const table = (headings, rows, widths = []) => `<table>${widths.length ? `<colgroup>${widths.map(width => `<col style="width:${width}%">`).join('')}</colgroup>` : ''}<thead><tr>${headings.map(value => `<th scope="col">${escape(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

function legacyRecordsHtml(diary) {
  if (!diary.LegacyArmRecords?.length) return '<p>No earlier arm-based records were found for this week and selected subject/term.</p>';
  return diary.LegacyArmRecords.map(record => {
    const week = record.Weekly || {}, scheme = record.Scheme || {};
    const subjectName = id => (week.SubjectSnapshot || []).find(row => row.SubjectId === id)?.Name
      || diary.Subjects.find(row => row.SubjectId === id)?.Name || id;
    return `<h3>${escape(record.Name)} — earlier arm record (read-only)</h3>
      ${week.RecordId ? `<p>Week ${escape(week.Week)} · Week ending ${escape(week.WeekEnding)} · ${escape(week.Status)}</p>
        ${table(['Subject', 'Planned work', 'Work completed', 'Notes', 'Teacher / status'], (week.Entries || []).map(entry => [subjectName(entry.SubjectId),
          [entry.PlannedWork?.Theme, entry.PlannedWork?.Content].filter(Boolean).join('\n'), entry.WorkCompleted, entry.Notes,
          [entry.TeacherUsername, entry.Status, entry.ReturnReason].filter(Boolean).join('\n')]), weeklyWidths)}
        <p>Compiled by: ${escape(week.Compiled?.By)} · ${escape(week.Compiled?.At)}<br>Reviewed by: ${escape(week.Reviewed?.By)} · ${escape(week.Reviewed?.At)} · ${escape(week.Reviewed?.Comment)}</p>
        <p>Record: ${escape(week.RecordId)} · Revision ${escape(week.Version)}</p>` : ''}
      ${scheme.RecordId ? `<h4>Scheme of work — ${escape(subjectName(scheme.SubjectId))}</h4>
        ${table(['Week', 'Theme / topic', 'Content'], (scheme.Weeks || []).map(row => [row.Week, row.Theme, row.Content]), schemeWidths)}
        <p>Record: ${escape(scheme.RecordId)} · Revision ${escape(scheme.Version)}</p>` : ''}`;
  }).join('');
}

export function diaryPrintHtml(diary, context, schoolName, mode = 'weekly') {
  const week = diary.Weekly || {};
  const className = (diary.Classes || []).find(row => row.ClassId === context.ClassId)?.Name || '';
  const subject = diary.Subjects.find(row => row.SubjectId === context.SubjectId)?.Name || '';
  const scheme = mode === 'scheme';
  const legacy = mode === 'legacy';
  const title = legacy ? 'Earlier arm-based diary records — read-only' : scheme ? `Scheme of work — ${subject}` : 'Weekly record of work';
  const content = legacy ? legacyRecordsHtml(diary) : scheme
    ? (diary.SessionSchemes?.length ? diary.SessionSchemes : [{ ...diary.Scheme, TermName: diary.TermName }]).map(term =>
      `<h2>${escape(term.TermName)}</h2>${table(['Week', 'Theme / topic', 'Content'], (term.Weeks || []).map(row => [row.Week, row.Theme, row.Content]), schemeWidths)}`).join('')
    : `<p>Week ${escape(week.Week)} · Week ending ${escape(week.WeekEnding || 'Not recorded')} · Status: <strong>${escape(week.Status)}</strong></p>
      ${table(['Subject', 'Planned work', 'Work completed', 'Notes', 'Teacher / status'], (week.SubjectSnapshot || diary.Subjects).map(subject => {
        const entry = (week.Entries || []).find(row => row.SubjectId === subject.SubjectId) || {};
        return [subject.Name, [entry.PlannedWork?.Theme, entry.PlannedWork?.Content].filter(Boolean).join('\n'), entry.WorkCompleted || 'Not submitted', entry.Notes || '', [entry.TeacherUsername, entry.Status || 'Missing'].filter(Boolean).join('\n')];
      }), weeklyWidths)}<p>Compiled by: ${escape(week.Compiled?.By || 'Not compiled')} · ${escape(week.Compiled?.At || '')}</p>
      <p>Reviewed by: ${escape(week.Reviewed?.By || 'Not reviewed')} · ${escape(week.Reviewed?.At || '')}<br>${escape(week.Reviewed?.Comment || '')}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>
    @page{size:A4 landscape;margin:12mm}body{font:12px/1.35 Arial;color:#172d40;width:calc(100% - 32px);max-width:273mm;margin:24px auto}h1{font-size:22px}h2{font-size:16px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #aab9c6;padding:5px 6px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}thead{display:table-header-group}th{background:#edf3f7;text-align:left}tr{break-inside:avoid}button{padding:10px 18px}@media print{button{display:none}body{width:100%;max-width:none;margin:0}}</style></head><body>
    <button onclick="window.print()">Print / Save as PDF</button><h1>${escape(schoolName || 'School')}</h1><h2>${escape(title)}</h2>
    <p>${escape(diary.SessionName)} · ${escape(scheme ? 'Full session' : diary.TermName)} · ${escape(className)}</p>
    ${!legacy && !scheme && week.Status !== 'Approved' ? '<p><strong>STAFF PREVIEW — NOT YET APPROVED</strong></p>' : ''}${content}
    <p>${legacy ? '' : `Record: ${escape((scheme ? diary.Scheme?.RecordId : week.RecordId) || 'Unsaved')} · `}Generated ${escape(new Date().toLocaleString())}</p></body></html>`;
}

export async function openAcademicDiary({ request, context, schoolName = '' }) {
  const { deadlineButtonLabel } = await import('./academic-submissions.js');
  const { settings: deadlineSettings } = await request('getAcademicSubmissionSettings', context);
  const dialog = document.createElement('dialog');
  dialog.className = 'academic-diary-dialog';
  dialog.style.cssText = 'width:min(1150px,95vw);max-height:92vh;overflow:auto;padding:20px';
  dialog.innerHTML = `<style>
    .academic-diary-dialog{box-sizing:border-box;border:1px solid #bccbd9;border-radius:14px;background:#fff;color:#12314c}
    .academic-diary-dialog::backdrop{background:#152b45aa}.academic-diary-dialog header{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .academic-diary-dialog label{display:flex;flex-direction:column;gap:5px;margin:8px 0;min-width:0}.academic-diary-dialog input,.academic-diary-dialog select,.academic-diary-dialog textarea{box-sizing:border-box;width:100%;padding:8px;color:inherit;background:#fff;border:1px solid #bccbd9;border-radius:5px}
    .academic-diary-dialog button{margin:5px;padding:9px 14px;border:1px solid #adc4db;border-radius:6px;cursor:pointer}.academic-diary-dialog button:disabled{cursor:wait;opacity:.6}
    .academic-diary-dialog form[data-load]{display:grid;grid-template-columns:2fr 2fr 80px auto;gap:10px;align-items:end}.academic-diary-dialog fieldset{margin:12px 0;padding:12px;border:1px solid #d3deea;border-radius:8px}
    .academic-diary-dialog table{border-collapse:collapse;width:100%;min-width:480px}.academic-diary-dialog th,.academic-diary-dialog td{padding:10px;border:1px solid #d3deea;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}
    @media(max-width:650px){.academic-diary-dialog form[data-load]{grid-template-columns:1fr 1fr}.academic-diary-dialog [data-scheme-row]{flex-wrap:wrap}}
    </style><header><h2>Teaching diary</h2><button type="button" data-close>Close</button></header>
    <p>One diary for the whole class, with one shared entry per subject. Subject teacher → class teacher compilation → Academic Management approval.</p><p role="status" data-status>Loading classes…</p>
    <form data-load><label>Class<select name="ClassId" required></select></label>
    <label>Subject<select name="SubjectId"><option value="">All subjects</option></select></label>
    <label>Week<input name="Week" type="number" min="1" max="53" value="1" required></label><button>Load diary</button></form><section data-body></section>`;
  document.body.append(dialog); dialog.showModal();
  const status = dialog.querySelector('[data-status]'), form = dialog.querySelector('[data-load]'), body = dialog.querySelector('[data-body]');
  let data = null, loaded = null, busy = false, dirty = false, dirtyScheme = false, dirtyWeekly = false;
  const close = () => { if (!busy && (!dirty || window.confirm('Discard unsaved diary changes?'))) { dialog.close(); dialog.remove(); } };
  dialog.querySelector('[data-close]').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  const run = async task => {
    if (busy) return;
    busy = true; dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const controls = [...dialog.querySelectorAll('input,select,textarea')].map(node => [node, node.disabled]);
    controls.forEach(([node]) => { node.disabled = true; });
    try { await task(); } catch (error) { status.textContent = error.message; }
    finally { busy = false; controls.forEach(([node, disabled]) => { if (node.isConnected) node.disabled = disabled; }); dialog.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  };
  const render = () => {
    const week = data.Weekly, entry = week.Entries.find(row => row.SubjectId === loaded.SubjectId) || {};
    const owns = data.OwnSubjects.includes(loaded.SubjectId), editable = owns && !['Submitted', 'Approved'].includes(week.Status) && entry.Status !== 'Submitted';
    const actions = `<label>Review / correction reason<textarea data-reason maxlength="2000"></textarea></label>
      ${data.CanCompile && entry.Status === 'Submitted' && !['Submitted', 'Approved'].includes(week.Status) ? '<button data-action="returnAcademicDiaryEntry">Return subject entry</button>' : ''}
      ${data.CanCompile && ['Draft', 'Returned'].includes(week.Status) ? '<button data-action="submitAcademicDiary">Compile and submit diary</button>' : ''}
      ${data.CanReview && week.Status === 'Submitted' ? '<button data-action="approveAcademicDiary">Approve diary</button>' : ''}
      ${data.CanReview && ['Submitted', 'Approved'].includes(week.Status) ? '<button data-action="returnAcademicDiary">Return diary for correction</button>' : ''}`;
    body.innerHTML = `<h3>${escape(data.Classes.find(row => row.ClassId === loaded.ClassId)?.Name)} · ${escape(data.SessionName)} · ${escape(data.TermName)} · ${escape(week.Status)}</h3>
      <button data-print="weekly">Preview / print weekly diary</button>${loaded.SubjectId ? '<button data-print="scheme">Preview / print session scheme</button>' : ''}
      <p>${escape(week.Reviewed?.Comment || entry.ReturnReason || '')}</p><div style="overflow-x:auto">${table(['Subject', 'Work completed', 'Teacher', 'Status'], data.Subjects.map(subject => {
        const saved = week.Entries.find(row => row.SubjectId === subject.SubjectId) || {};
        return [subject.Name, saved.WorkCompleted || '', saved.TeacherUsername || '', saved.Status || 'Missing'];
      }))}</div>
      ${loaded.SubjectId ? `<h3>Weekly work for ${escape(data.Subjects.find(row => row.SubjectId === loaded.SubjectId)?.Name)}</h3>
        <fieldset ${editable ? '' : 'disabled'}><label>Week-ending date<input type="date" data-ending value="${escape(week.WeekEnding)}" ${week.WeekEnding ? 'readonly' : ''}></label>
        <label>Work completed<textarea data-work rows="5" maxlength="4000">${escape(entry.WorkCompleted)}</textarea></label>
        <label>Notes / explanation<textarea data-notes maxlength="2000">${escape(entry.Notes)}</textarea></label>
        <button data-action="saveAcademicDiaryEntry">Save draft</button><button data-action="submitAcademicDiaryEntry">Submit subject work</button></fieldset>
        <h3>Scheme of work — ${escape(data.TermName)}</h3><p>Use the Academic Management term selector for each of the session’s three terms.</p>
        <fieldset ${owns ? '' : 'disabled'}><div data-weeks style="overflow-x:auto"></div><button data-add-week>Add week</button><button data-action="saveAcademicDiaryScheme">Save scheme</button></fieldset>` : ''}${actions}
      <details data-legacy><summary>Earlier arm-based records (read-only)</summary>
        <p>Older entries and approvals are preserved separately, not merged into this class diary. Choose a week and, for a scheme, a subject above.</p>
        <button data-load-legacy>Load earlier records</button><button data-print="legacy">Preview / print earlier records</button>
        <div data-legacy-records style="overflow-x:auto"></div></details>`;
    const submissionTypes = { submitAcademicDiaryEntry: 'diary-entry', submitAcademicDiary: 'diary', saveAcademicDiaryScheme: 'scheme' };
    body.querySelectorAll('[data-action]').forEach(button => {
      const type = submissionTypes[button.dataset.action];
      if (type) button.textContent = deadlineButtonLabel(deadlineSettings, type, loaded, button.textContent);
    });
    const weeks = body.querySelector('[data-weeks]');
    const rowHtml = row => `<div data-scheme-row style="display:flex;gap:8px;align-items:start;margin:8px 0"><label>Week<input data-number type="number" min="1" max="53" value="${escape(row.Week)}" style="width:70px"></label><label style="flex:1">Theme<input data-theme maxlength="300" value="${escape(row.Theme)}"></label><label style="flex:2">Content<textarea data-content rows="3" maxlength="4000">${escape(row.Content)}</textarea></label><button data-remove>Remove</button></div>`;
    if (weeks) weeks.innerHTML = (data.Scheme.Weeks?.length ? data.Scheme.Weeks : Array.from({ length: 13 }, (_, index) => ({ Week: index + 1 }))).map(rowHtml).join('');
    body.oninput = event => {
      dirty = true;
      if (event.target.closest('[data-scheme-row]')) dirtyScheme = true;
      if (event.target.matches('[data-work],[data-notes],[data-ending]')) dirtyWeekly = true;
    };
    body.onclick = event => {
      const button = event.target.closest('button'); if (!button || busy) return;
      if (button.hasAttribute('data-remove')) { button.closest('[data-scheme-row]').remove(); dirty = dirtyScheme = true; return; }
      if (button.hasAttribute('data-add-week')) { const next = weeks.children.length + 1; if (next <= 53) weeks.insertAdjacentHTML('beforeend', rowHtml({ Week: next })); dirty = dirtyScheme = true; return; }
      if (button.hasAttribute('data-load-legacy')) {
        void run(async () => {
          const fresh = await request('getAcademicDiary', { ...loaded, IncludeLegacyArmRecords: true });
          // Do not rerender the editor or replace its optimistic version while
          // someone has unsaved changes in the new class diary.
          body.querySelector('[data-legacy-records]').innerHTML = legacyRecordsHtml(fresh.diary);
          status.textContent = 'Earlier arm records loaded read-only. Current class diary edits are unchanged.';
        }); return;
      }
      if (button.dataset.print) {
        const preview = window.open('', '_blank');
        if (!preview) { status.textContent = 'Allow pop-ups to open the print preview.'; return; }
        preview.opener = null;
        void run(async () => {
          try {
            const fresh = await request('getAcademicDiary', { ...loaded, IncludeSessionSchemes: button.dataset.print === 'scheme',
              IncludeLegacyArmRecords: button.dataset.print === 'legacy' });
            preview.document.open(); preview.document.write(diaryPrintHtml(fresh.diary, loaded, schoolName, button.dataset.print)); preview.document.close();
          } catch (error) { preview.close(); throw error; }
        }); return;
      }
      if (!button.dataset.action) return;
      const savesScheme = button.dataset.action === 'saveAcademicDiaryScheme';
      const savesEntry = ['saveAcademicDiaryEntry', 'submitAcademicDiaryEntry'].includes(button.dataset.action);
      if ((savesScheme ? dirtyWeekly : dirtyScheme || (!savesEntry && dirtyWeekly))
        && !window.confirm('This action reloads the diary. Discard unsaved edits in the other section? Cancel to save them first.')) return;
      void run(async () => {
        const action = button.dataset.action, scheme = action === 'saveAcademicDiaryScheme';
        const payload = { ...loaded, Version: scheme ? data.Scheme.Version || 0 : week.Version || 0,
          WorkCompleted: body.querySelector('[data-work]')?.value || '', Notes: body.querySelector('[data-notes]')?.value || '',
          WeekEnding: body.querySelector('[data-ending]')?.value || week.WeekEnding, Reason: body.querySelector('[data-reason]')?.value || '',
          Weeks: [...body.querySelectorAll('[data-scheme-row]')].map(row => ({ Week: row.querySelector('[data-number]').value,
            Theme: row.querySelector('[data-theme]').value, Content: row.querySelector('[data-content]').value })).filter(row => row.Theme.trim() || row.Content.trim()) };
        const result = await request(action, payload); data = result.diary; dirty = dirtyScheme = dirtyWeekly = false; render(); status.textContent = result.message;
      });
    };
  };
  const loadSelectedDiary = async () => {
      const selectedClass = data.Classes.find(row => row.ClassId === form.elements.ClassId.value);
      if (!selectedClass) throw new Error('Choose a class.');
      const next = { ...context, ClassId: selectedClass.ClassId, ArmId: '',
        SubjectId: form.elements.SubjectId.value, Week: Number(form.elements.Week.value) };
      if (loaded && next.ClassId !== loaded.ClassId) next.SubjectId = '';
      const result = await request('getAcademicDiary', next); data = result.diary; loaded = next; dirty = dirtyScheme = dirtyWeekly = false;
      form.elements.SubjectId.innerHTML = `<option value="">All subjects</option>${data.Subjects.map(row => `<option value="${escape(row.SubjectId)}" ${row.SubjectId === next.SubjectId ? 'selected' : ''}>${escape(row.Name)}</option>`).join('')}`;
      render(); status.textContent = data.Subjects.length
        ? 'Saved diary loaded. Print previews use saved records only.'
        : 'No active subject offerings or subject-teacher allocations are configured for this class and term.';
  };
  const changeSelection = () => {
    if (dirty && !window.confirm('Discard unsaved edits and load the selected diary?')) {
      form.elements.ClassId.value = loaded.ClassId;
      form.elements.SubjectId.value = loaded.SubjectId;
      form.elements.Week.value = loaded.Week;
      return;
    }
    void run(loadSelectedDiary);
  };
  form.onsubmit = event => { event.preventDefault(); changeSelection(); };
  form.elements.ClassId.onchange = changeSelection;
  form.elements.SubjectId.onchange = changeSelection;
  await run(async () => {
    const result = await request('getAcademicDiary', context); data = result.diary;
    if (data.DiaryScope !== 'Class' || !Array.isArray(data.Classes)) throw new Error('The class-based diary backend is not available yet. Update the web/backend before using this diary.');
    form.elements.ClassId.innerHTML = data.Classes.map(row => `<option value="${escape(row.ClassId)}">${escape(row.Name)}</option>`).join('');
    status.textContent = data.Classes.length ? 'Choose a class and week, then Load diary. Select a subject to enter its shared work.' : 'No class assignments are available for this period.';
    if (data.Classes.length) await loadSelectedDiary();
  });
}
