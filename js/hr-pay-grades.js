(function (global) {
  'use strict';

  const clean = value => String(value ?? '').trim();
  const key = value => clean(value).toLowerCase();
  const escape = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });
  const format = value => money.format(Number(value || 0));
  const title = grade => `${grade.PayGrade} · ${grade.PayLevel}`;
  const componentKinds = [['Allowances', 'Allowance'], ['Deductions', 'Deduction']];

  function amounts(salary) {
    if (!salary) return '<span>No saved salary profile</span>';
    return `<strong>Basic ${format(salary.BasicSalary)}</strong>` + [['Allowances', salary.Allowances], ['Deductions', salary.Deductions]]
      .map(([label, rows]) => `<div><small>${label}</small> ${rows?.length ? rows.map(row =>
        `${escape(row.Name)} ${format(row.Amount)}`).join(' · ') : '—'}</div>`).join('');
  }

  function mount(root, { directory, request, branches = [], workingBranch = '', getTemplates, normalizeComponents, onApplied, isCurrent, confirm }) {
    const knownBranches = new Map(branches.filter(row => key(row.id) && key(row.id) !== 'all').map(row => [key(row.id), row.name || row.id]));
    const fixedBranch = key(workingBranch) === 'all' ? '' : key(workingBranch);
    if (fixedBranch && !knownBranches.has(fixedBranch)) knownBranches.set(fixedBranch, fixedBranch);
    if (!knownBranches.size) {
      for (const row of directory) {
        const id = key(row.BranchId) || 'main';
        knownBranches.set(id, row.BranchName || (id === 'main' ? 'Main Branch' : id));
      }
    }
    if (!knownBranches.size) knownBranches.set('main', 'Main Branch');
    root.innerHTML = `<style>
      .hr-pay-grade-launcher{margin:0 0 8px;min-height:40px}
      .hr-pay-grade-dialog{box-sizing:border-box;width:min(565px,calc(100vw - 24px));max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain;
        margin:auto;padding:16px;border:1px solid var(--line,#cbd7e5);border-radius:14px;background:var(--surface,#fff);color:var(--text,#172b42)}
      .hr-pay-grade-dialog::backdrop{background:#0d223f66}
      .hr-pay-grade-dialog header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
      .hr-pay-grade-dialog h2{font-size:17px;margin:0}
      .hr-pay-grade-dialog label{display:grid;gap:3px;margin:0;font-size:12px;font-weight:650;min-width:0}
      .hr-pay-grade-dialog label input,.hr-pay-grade-dialog label select{box-sizing:border-box;width:100%;min-width:0;min-height:40px;font-size:16px;margin:0}
      .hr-pay-grade-dialog section,.hr-pay-grade-dialog form{padding:0;border:0;background:transparent;margin:10px 0 0;min-width:0}
      .hr-pay-grade-dialog .hr-pay-grade-identifiers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:8px}
      .hr-pay-grade-components{display:grid;gap:6px;margin-top:8px}
      .hr-pay-grade-components header{margin:0}
      .hr-pay-grade-component{display:grid;grid-template-columns:minmax(0,1fr) minmax(95px,34%) auto;align-items:end;gap:6px}
      .hr-pay-grade-dialog .hr-pay-grade-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px}
      .hr-pay-grade-dialog button{width:auto;min-height:40px;margin:0;padding:7px 10px;white-space:normal}
      .hr-pay-grade-dialog .hr-pay-grade-summary{margin:8px 0;padding:9px;border:1px solid var(--line,#cbd7e5);border-radius:8px;font-size:12px;overflow-wrap:anywhere}
      .hr-pay-grade-dialog .hr-pay-grade-staff,.hr-pay-grade-dialog .hr-pay-grade-preview{max-height:165px;overflow:auto;overscroll-behavior:contain;
        border:1px solid var(--line,#cbd7e5);border-radius:8px;margin-top:6px}
      .hr-pay-grade-dialog .hr-pay-grade-staff label{display:flex;align-items:center;gap:8px;padding:5px 8px;min-height:34px;overflow-wrap:anywhere}
      .hr-pay-grade-dialog .hr-pay-grade-staff input{width:18px;height:18px;min-height:0;flex:none}
      .hr-pay-grade-dialog .hr-pay-grade-preview details{padding:6px 8px;font-size:12px;overflow-wrap:anywhere}
      .hr-pay-grade-dialog .hr-pay-grade-preview details+details{border-top:1px solid var(--line,#cbd7e5)}
      .hr-pay-grade-dialog .status{margin:8px 0 0;overflow-wrap:anywhere}
      .hr-pay-grade-dialog [data-grade-manage]{margin-top:8px;padding:8px;border:1px solid var(--line,#cbd7e5);border-radius:8px}
      .hr-pay-grade-dialog [data-grade-manage]>summary{cursor:pointer;font-size:13px;font-weight:650}
      .hr-pay-grade-dialog [data-grade-delete]{background:transparent;color:#b42338;border:1px solid #e8aeba}
      .hr-pay-grade-dialog [hidden]{display:none}
      @media(max-width:390px){
        .hr-pay-grade-dialog{padding:12px}
        .hr-pay-grade-component{grid-template-columns:minmax(0,1fr) minmax(92px,38%)}
        .hr-pay-grade-component button{grid-column:1/-1;justify-self:start}
      }
    </style>
    <button type="button" class="hr-pay-grade-launcher" aria-haspopup="dialog" data-grade-open>Pay grades &amp; levels</button>
    <dialog class="hr-pay-grade-dialog" aria-label="Pay grades and levels">
      <header><h2>Pay grades &amp; levels</h2><button type="button" data-grade-close>Close</button></header>
      <label data-grade-branch-picker hidden>Branch<select data-grade-branch aria-label="Pay grades branch">
        <option value="">Choose branch</option>${[...knownBranches].map(([id, name]) => `<option value="${escape(id)}">${escape(name)}</option>`).join('')}
      </select></label>
      <p data-grade-branch-label></p>
      <label data-grade-choice-label>Grade and level<select data-grade-choice aria-label="Grade and level"></select></label>
      <form data-grade-setup>
        <div class="hr-pay-grade-identifiers" data-grade-identifiers>
          <label>Pay grade<input name="PayGrade" maxlength="60" required></label>
          <label>Pay level<input name="PayLevel" maxlength="60" required></label>
        </div>
        <label>Grade basic salary (NGN)<input name="BasicSalary" type="number" min="0" step="0.01" required></label>
        ${componentKinds.map(([kind, label]) => `<div class="hr-pay-grade-components">
          <header><strong>${kind}</strong><button type="button" data-grade-add="${kind}">Add ${label.toLowerCase()}</button></header>
          <div class="hr-pay-grade-components" data-grade-components="${kind}"></div>
          <datalist id="hr-grade-${kind}"></datalist>
        </div>`).join('')}
        <div class="hr-pay-grade-actions">
          <button type="submit" data-grade-save>Save grade salary</button>
          <button type="button" data-grade-import hidden>Use amounts from staff salary form</button>
          <button type="button" data-grade-copy hidden>Copy amounts to salary form</button>
          <button type="button" data-grade-refresh>Refresh grades</button>
        </div>
      </form>
      <details data-grade-manage hidden>
        <summary>Edit or delete grade and level</summary>
        <form data-grade-names>
          <div class="hr-pay-grade-identifiers">
            <label>New pay grade<input name="PayGrade" maxlength="60" required></label>
            <label>New pay level<input name="PayLevel" maxlength="60" required></label>
          </div>
          <small>These controls edit the grade catalogue. Staff keep their saved salary amounts and grade details.</small>
          <div class="hr-pay-grade-actions">
            <button type="submit">Save grade and level names</button>
            <button type="button" data-grade-delete>Delete grade and level</button>
          </div>
        </form>
      </details>
      <section data-grade-batch hidden>
        <label>Find staff<input data-grade-search type="search" placeholder="Name or username"></label>
        <div class="hr-pay-grade-actions"><button type="button" data-grade-members>Select staff on this grade and level</button>
          <button type="button" data-grade-clear>Clear selection</button><small data-grade-count></small></div>
        <div class="hr-pay-grade-staff" data-grade-staff aria-label="Staff selected for this pay grade"></div>
        <div class="hr-pay-grade-actions">
          <button type="button" data-grade-assign>Assign grade and level only</button>
          <button type="button" data-grade-preview>Preview salary batch</button>
        </div>
        <small>Grade assignment leaves saved salaries unchanged.</small>
        <section data-grade-confirmation hidden>
          <div class="hr-pay-grade-summary" data-grade-amounts></div>
          <p><small>Applying replaces the selected staff’s basic salary, allowances and deductions with this grade’s amounts.</small></p>
          <div class="hr-pay-grade-preview" data-grade-changes></div>
          <div class="hr-pay-grade-actions"><button type="button" data-grade-apply></button></div>
        </section>
      </section>
      <p class="status" data-grade-status role="status" hidden></p>
    </dialog>`;

    const find = selector => root.querySelector(selector);
    const opener = find('[data-grade-open]'), dialog = find('dialog'), choice = find('[data-grade-choice]');
    const branchChoice = find('[data-grade-branch]');
    const setup = find('[data-grade-setup]'), search = find('[data-grade-search]'), staffList = find('[data-grade-staff]');
    const manage = find('[data-grade-manage]'), namesForm = find('[data-grade-names]');
    const status = find('[data-grade-status]'), selected = new Set(), cache = new Map();
    let employeeContext = null, branch = '', directBranch = fixedBranch || (knownBranches.size === 1 ? [...knownBranches.keys()][0] : '');
    let gradeId = '', preview = null, busy = false, dirty = false;
    const grades = () => cache.get(branch) || [];
    const grade = () => grades().find(row => row.GradeId === gradeId);
    const candidates = () => directory.filter(row => row.Active !== false && !/^(exited|terminated|inactive|disabled)$/i.test(clean(row.Status))
      && (key(row.BranchId) || 'main') === branch && row.Username);
    const showStatus = (message = '', bad = false) => {
      status.textContent = message;
      status.hidden = !message;
      status.className = `status ${bad ? 'bad' : 'ok'}`;
    };
    const buttons = () => {
      dialog.querySelectorAll('button, input, select').forEach(control => { control.disabled = busy; });
      setup.elements.PayGrade.disabled = busy || Boolean(grade());
      setup.elements.PayLevel.disabled = busy || Boolean(grade());
      find('[data-grade-assign]').disabled = busy || !selected.size || selected.size > 50;
      const previewButton = find('[data-grade-preview]');
      previewButton.disabled = busy || !selected.size;
      previewButton.textContent = selected.size > 50 ? 'Preview first 50 salaries' : 'Preview salary batch';
      find('[data-grade-apply]').disabled = busy || !(preview?.changedCount || selected.size > 50 && preview);
      find('[data-grade-count]').textContent = `${selected.size} selected${selected.size > 50 ? ' · 50 per batch' : ''}`;
    };
    const clearPreview = () => {
      preview = null;
      find('[data-grade-confirmation]').hidden = true;
    };
    const salaryChanged = () => {
      dirty = true;
      clearPreview();
      buttons();
    };
    function addComponent(kind, row = {}) {
      const label = componentKinds.find(([field]) => field === kind)[1];
      const field = document.createElement('div');
      field.className = 'hr-pay-grade-component';
      field.innerHTML = `<label>${label} name<input data-grade-component-name list="hr-grade-${kind}" maxlength="120" required value="${escape(row.Name)}"></label>
        <label>${label} amount (NGN)<input data-grade-component-amount type="number" min="0" step="0.01" required value="${escape(row.Amount)}"></label>
        <button type="button" aria-label="Remove ${label.toLowerCase()}">Remove</button>`;
      field.querySelector('button').addEventListener('click', () => { field.remove(); salaryChanged(); });
      find(`[data-grade-components="${kind}"]`).append(field);
    }
    function populateSalary(salary = {}) {
      setup.elements.BasicSalary.value = salary.BasicSalary ?? '';
      for (const [kind] of componentKinds) {
        find(`[data-grade-components="${kind}"]`).replaceChildren();
        (salary[kind] || []).forEach(row => addComponent(kind, row));
      }
    }
    function readSalary() {
      const salary = { BasicSalary: setup.elements.BasicSalary.valueAsNumber };
      for (const [kind] of componentKinds) {
        salary[kind] = normalizeComponents([...find(`[data-grade-components="${kind}"]`).children].map(row => ({
          Name: row.querySelector('[data-grade-component-name]').value,
          Amount: row.querySelector('[data-grade-component-amount]').value
        })));
      }
      return salary;
    }
    function renderStaff() {
      const term = key(search.value);
      const rows = candidates().filter(row => !term || key(`${row.DisplayName} ${row.Username}`).includes(term));
      staffList.innerHTML = rows.length ? rows.map(row => {
        const username = key(row.Username);
        return `<label><input type="checkbox" value="${escape(username)}" ${selected.has(username) ? 'checked' : ''}>${escape(row.DisplayName || row.Username)} <small>${escape(row.Username)}</small></label>`;
      }).join('') : '<p>No matching staff in this branch.</p>';
      buttons();
    }
    function renderGrade() {
      const row = grade();
      find('[data-grade-choice-label]').hidden = !branch;
      setup.hidden = !branch;
      find('[data-grade-identifiers]').hidden = Boolean(row);
      find('[data-grade-copy]').hidden = !row || !employeeContext?.copyDraft;
      find('[data-grade-import]').hidden = !employeeContext?.readDraft;
      manage.hidden = !row;
      manage.open = false;
      namesForm.elements.PayGrade.value = row?.PayGrade || '';
      namesForm.elements.PayLevel.value = row?.PayLevel || '';
      find('[data-grade-batch]').hidden = !row;
      find('[data-grade-save]').textContent = row ? 'Update grade salary' : 'Save grade salary';
      populateSalary(row || {});
      dirty = false;
      clearPreview();
      if (row) renderStaff();
      buttons();
    }
    function renderGrades() {
      const rows = [...grades()].sort((a, b) => title(a).localeCompare(title(b), undefined, { numeric: true }));
      choice.innerHTML = '<option value="">New grade and level</option>' + rows.map(row =>
        `<option value="${escape(row.GradeId)}">${escape(title(row))}</option>`).join('');
      choice.value = grade() ? gradeId : '';
      gradeId = choice.value;
      renderGrade();
    }
    async function work(action) {
      if (busy || !branch || !isCurrent()) return;
      busy = true; buttons(); showStatus();
      try { await action(); } catch (error) { if (isCurrent()) showStatus(error.message || String(error), true); }
      finally { busy = false; if (isCurrent()) buttons(); }
    }
    const loadGrades = () => work(async () => {
      const result = await request('listPayGrades', { BranchId: branch });
      if (!isCurrent()) return;
      cache.set(branch, result.grades);
      renderGrades();
    });
    const batchBody = () => ({ BranchId: branch, GradeId: gradeId, Usernames: [...selected].slice(0, 50) });

    async function populateReusableNames() {
      const requestedBranch = branch;
      for (const [kind] of componentKinds) find(`#hr-grade-${kind}`).replaceChildren();
      if (!requestedBranch || !getTemplates) return;
      const templates = await getTemplates(requestedBranch).catch(() => null);
      if (branch !== requestedBranch || !isCurrent() || !templates) return;
      for (const [kind] of componentKinds) find(`#hr-grade-${kind}`).innerHTML = (templates[kind] || [])
        .map(name => `<option value="${escape(name)}"></option>`).join('');
    }

    function open(context = null) {
      if (!isCurrent() || dialog.open) return;
      employeeContext = context;
      branch = key(context?.data?.employee?.BranchId) || (context ? 'main' : directBranch);
      gradeId = context?.data?.profile?.PayGradeId || '';
      selected.clear();
      search.value = '';
      setup.reset();
      showStatus();
      const showBranchPicker = !context && !fixedBranch && knownBranches.size > 1;
      find('[data-grade-branch-picker]').hidden = !showBranchPicker;
      find('[data-grade-branch-label]').hidden = showBranchPicker;
      branchChoice.value = branch;
      find('[data-grade-branch-label]').textContent = branch ? knownBranches.get(branch) || branch : '';
      renderGrades();
      // The assigned grade may be selected after the first scoped load.
      if (!cache.has(branch)) gradeId = context?.data?.profile?.PayGradeId || '';
      dialog.showModal();
      if (branch && !cache.has(branch)) loadGrades();
      populateReusableNames();
    }
    opener.addEventListener('click', () => open());
    branchChoice.addEventListener('change', () => {
      directBranch = branch = branchChoice.value;
      gradeId = '';
      selected.clear();
      search.value = '';
      setup.reset();
      showStatus();
      find('[data-grade-branch-label]').textContent = knownBranches.get(branch) || '';
      renderGrades();
      if (branch && !cache.has(branch)) loadGrades();
      populateReusableNames();
    });
    find('[data-grade-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    find('[data-grade-refresh]').addEventListener('click', loadGrades);
    choice.addEventListener('change', () => {
      gradeId = choice.value;
      selected.clear();
      showStatus();
      renderGrade();
    });
    setup.addEventListener('submit', event => {
      event.preventDefault();
      work(async () => {
        const current = grade();
        const result = await request('savePayGrade', { ...readSalary(), BranchId: branch, GradeId: current?.GradeId || '', GradeRevision: current?.Revision || '',
          PayGrade: current?.PayGrade || setup.elements.PayGrade.value, PayLevel: current?.PayLevel || setup.elements.PayLevel.value });
        if (!isCurrent()) return;
        cache.set(branch, [...grades().filter(row => row.GradeId !== result.grade.GradeId), result.grade]);
        gradeId = result.grade.GradeId;
        setup.reset();
        renderGrades();
        showStatus('Pay grade and level saved. Use Preview salary batch to apply its amounts.');
      });
    });
    setup.addEventListener('input', salaryChanged);
    for (const [kind] of componentKinds) find(`[data-grade-add="${kind}"]`).addEventListener('click', () => {
      addComponent(kind);
      salaryChanged();
      find(`[data-grade-components="${kind}"]`).lastElementChild.querySelector('input').focus();
    });
    find('[data-grade-import]').addEventListener('click', () => {
      try { populateSalary(employeeContext.readDraft()); salaryChanged(); } catch (error) { showStatus(error.message, true); }
    });
    find('[data-grade-copy]').addEventListener('click', () => {
      try { employeeContext.copyDraft(grade()); dialog.close(); } catch (error) { showStatus(error.message, true); }
    });
    namesForm.addEventListener('submit', event => {
      event.preventDefault();
      work(async () => {
        const current = grade();
        const result = await request('renamePayGrade', { BranchId: branch, GradeId: gradeId, GradeRevision: current.Revision,
          PayGrade: namesForm.elements.PayGrade.value, PayLevel: namesForm.elements.PayLevel.value });
        if (!isCurrent()) return;
        cache.set(branch, grades().map(row => row.GradeId === gradeId ? result.grade : row));
        renderGrades();
        showStatus('Grade and level names saved.');
      });
    });
    find('[data-grade-delete]').addEventListener('click', () => work(async () => {
      const current = grade();
      const message = `Delete “${title(current)}” from this branch’s pay grades? Staff keep their saved salary amounts and grade details.`;
      const approved = confirm
        ? await confirm({ title: 'Delete grade and level', message, confirmText: 'Delete grade and level', tone: 'danger' })
        : global.confirm(message);
      if (!approved || !isCurrent()) return;
      await request('deletePayGrade', { BranchId: branch, GradeId: gradeId, GradeRevision: current.Revision });
      if (!isCurrent()) return;
      cache.set(branch, grades().filter(row => row.GradeId !== gradeId));
      gradeId = '';
      selected.clear();
      setup.reset();
      renderGrades();
      showStatus('Grade and level deleted.');
    }));
    search.addEventListener('input', renderStaff);
    staffList.addEventListener('change', event => {
      const checkbox = event.target;
      if (checkbox.checked && selected.size >= 50) {
        checkbox.checked = false;
        showStatus('Select up to 50 staff per batch.', true);
        return;
      }
      if (checkbox.checked) selected.add(checkbox.value);
      else selected.delete(checkbox.value);
      clearPreview();
      buttons();
    });
    find('[data-grade-clear]').addEventListener('click', () => { selected.clear(); clearPreview(); renderStaff(); });
    find('[data-grade-members]').addEventListener('click', () => work(async () => {
      const result = await request('listPayGradeMembers', { BranchId: branch, GradeId: gradeId });
      if (!isCurrent()) return;
      const assigned = new Set(result.usernames);
      const members = candidates().map(row => key(row.Username)).filter(username => assigned.has(username));
      selected.clear();
      members.forEach(username => selected.add(username));
      search.value = '';
      clearPreview();
      renderStaff();
      showStatus(members.length ? `${members.length} staff on this grade and level selected.` : 'No active staff are assigned to this grade and level.');
    }));
    find('[data-grade-assign]').addEventListener('click', () => work(async () => {
      clearPreview();
      const result = await request('assignPayGradeMembers', { ...batchBody(), GradeRevision: grade().Revision });
      if (!isCurrent()) return;
      showStatus(result.assignedCount
        ? `Grade and level assigned to ${result.assignedCount} staff. Their saved salaries are unchanged.`
        : 'All selected staff already have this grade and level.');
    }));
    find('[data-grade-preview]').addEventListener('click', () => work(async () => {
      if (dirty) throw new Error('Save the grade salary before previewing the batch.');
      clearPreview();
      const result = await request('getPayGradePreview', batchBody());
      if (!isCurrent()) return;
      cache.set(branch, [...grades().filter(row => row.GradeId !== gradeId), result.grade]);
      renderGrades();
      find('[data-grade-amounts]').innerHTML = amounts(result.grade);
      preview = result;
      find('[data-grade-changes]').innerHTML = result.staff.map(row => `<details><summary>${escape(row.DisplayName)} · ${escape(row.Username)}</summary>${amounts(row.current)}</details>`).join('');
      find('[data-grade-confirmation]').hidden = false;
      find('[data-grade-apply]').textContent = result.changedCount ? `Apply to ${result.changedCount} staff`
        : selected.size > 50 ? 'Continue to next batch' : 'All selected staff are up to date';
    }));
    find('[data-grade-apply]').addEventListener('click', () => work(async () => {
      const payload = batchBody();
      const { previewVersion, changedCount } = preview;
      clearPreview();
      const result = changedCount ? await request('applyPayGrade', { ...payload, PreviewVersion: previewVersion }) : { updatedCount: 0 };
      if (!isCurrent()) return;
      if (result.updatedCount) onApplied(payload.Usernames);
      const more = selected.size > payload.Usernames.length;
      if (more) {
        payload.Usernames.forEach(username => selected.delete(username));
        renderStaff();
      }
      const message = result.updatedCount ? `Salary structure saved for ${result.updatedCount} staff.` : 'This batch is up to date.';
      showStatus(more ? `${message} ${selected.size} remaining in the selection.` : message);
    }));
    return { openForEmployee: open };
  }

  global.DynamaxHrPayGrades = { mount };
})(window);
