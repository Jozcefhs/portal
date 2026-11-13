(function (global) {
  'use strict';
  const clean = value => String(value ?? '').trim();
  const componentKey = value => clean(value).replace(/\s+/g, ' ').toLowerCase();
  const escape = value => clean(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const letterFields = ['LetterDate', 'StartDate', 'Position', 'Department', 'EmploymentType', 'WorkLocation', 'ReportingTo',
    'Probation', 'NoticePeriod', 'WorkingHours', 'Benefits', 'Terms', 'AcceptanceDeadline'];

  function normalizeComponents(rows) {
    return (rows || []).map(row => {
      const Name = clean(row.Name), text = clean(row.Amount).replace(/,/g, ''), Amount = Number(text);
      if (!Name || !/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(Amount) || Amount < 0) {
        throw new Error('Each salary component needs a name and a valid amount of zero or more.');
      }
      return { Name, Amount };
    });
  }

  function pdfBlob(base64) {
    const bytes = atob(clean(base64));
    return new Blob([Uint8Array.from(bytes, char => char.charCodeAt(0))], { type: 'application/pdf' });
  }

  function mount(root, { directory = [], capabilities = {}, request, personPicker, confirm, payGradeRoot,
    branches = [], workingBranch = '', onGradeChanged, isCurrent = () => root.isConnected } = {}) {
    if (!root || typeof request !== 'function') return;
    const viewSalary = Boolean(capabilities.canViewSalaryStructure || capabilities.canManageSalaryStructure || capabilities.canIssueEmploymentLetters);
    if (!viewSalary) { root.replaceChildren(); return; }
    const issueLetters = Boolean(capabilities.canIssueEmploymentLetters), cache = new Map(), templateCache = new Map(), templateLoads = new Map();
    const componentKinds = ['Allowances', 'Deductions'];
    root.classList.add('hr-employment-tools');
    const picker = personPicker ? personPicker('hrEmploymentToolsUsername', 'Staff member', directory)
      : `<label>Staff member<select name="Username" aria-label="Staff member"><option value="">Choose staff member</option>${directory.map(row => `<option value="${escape(row.Username)}">${escape(row.DisplayName || row.Username)}</option>`).join('')}</select></label>`;
    root.innerHTML = `<style>.hr-employment-tools fieldset,.hr-employment-tools .config-grid>*{min-width:0}.hr-employment-tools input,.hr-employment-tools textarea,.hr-employment-tools select{box-sizing:border-box;max-width:100%;width:100%}.hr-employment-tools .hr-component-row{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;gap:8px;align-items:end;margin:10px 0}.hr-employment-tools .hr-component-row label{min-width:0}.hr-employment-tools .hr-component-row button{min-height:38px}.hr-employment-tools .config-dialog-actions{position:static;display:flex;gap:8px;flex-wrap:wrap;padding:12px 0;box-shadow:none;background:transparent}.hr-employment-tools .table-scroll{max-width:100%;overflow-x:auto}.hr-employment-tools .admin-table{min-width:0;table-layout:fixed}.hr-employment-tools .admin-table th,.hr-employment-tools .admin-table td{padding:8px;overflow-wrap:anywhere}.hr-employment-tools .admin-table thead{position:static}.hr-employment-tools .config-grid-span{grid-column:1/-1}.hr-employment-tools header small{display:block;margin-top:6px}.hr-employment-tools [data-hr-salary-breakdown]{margin-bottom:14px}@media(max-width:600px){.hr-employment-tools .config-grid{grid-template-columns:minmax(0,1fr)}.hr-employment-tools .hr-component-row{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}.hr-employment-tools .hr-component-row button{grid-column:1/-1;justify-self:start}.hr-employment-tools .config-dialog-actions>button{flex:1 1 145px;white-space:normal}.hr-employment-tools fieldset{padding:10px}}</style>
      <section class="config-group hr-form-card"><header><strong>Employee salary and employment letters</strong><small>Load one employee's saved setup. Existing payroll, payments and employment history remain linked.</small></header>
      <form data-hr-employee-loader class="workflow-form config-form"><div class="config-grid">${picker}</div>
        <div class="config-dialog-actions"><button type="submit">Load employee setup</button><button type="button" data-hr-refresh-employee disabled>Refresh employee setup</button></div>
      </form><p data-hr-employment-status class="status" role="status">Choose an employee to load salary details and saved letters.</p></section>
      <div data-hr-employee-content hidden>
        <section class="config-group hr-form-card"><header><strong>Salary structure</strong><small data-hr-salary-description></small></header>
          <p data-hr-salary-summary></p><div data-hr-salary-breakdown></div>
          <button type="button" data-hr-open-templates aria-haspopup="dialog" hidden>Manage reusable items</button>
          <button type="button" data-hr-pay-grades aria-haspopup="dialog" hidden>Pay grades for this branch</button>
          <dialog class="hr-template-dialog" data-hr-template-tools aria-labelledby="hr-template-heading">
            <header><h2 id="hr-template-heading">Reusable salary items</h2><button type="button" data-hr-close-templates>Close</button></header>
            <label>Reusable item<select name="ExistingItem" aria-label="Reusable item"></select></label>
            <form data-hr-template-form>
              <fieldset><div class="hr-template-add-fields">
                <label>Type<select name="Kind" aria-label="Type"><option value="Allowances">Allowance</option><option value="Deductions">Deduction</option></select></label>
                <label>Reusable name<input name="Name" maxlength="120" required></label>
              </div><div class="hr-template-actions"><button type="submit">Add reusable item</button></div></fieldset>
            </form>
            <form data-hr-template-editor hidden>
              <fieldset><label>Updated name<input name="UpdatedName" maxlength="120" required></label>
              <div class="hr-template-actions">
                <button type="submit" data-hr-rename-template>Save reusable name</button>
                <button type="button" data-hr-delete-template>Delete reusable item</button>
              </div></fieldset>
            </form>
            <footer><button type="button" data-hr-refresh-templates>Refresh reusable items</button>
              <p data-hr-template-status class="status" role="status" hidden></p></footer>
          </dialog>
          <style>
            .hr-employment-tools .hr-template-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(100px,32%);gap:8px;align-items:center;margin:4px 0}
            .hr-employment-tools .hr-template-choice{display:flex;align-items:center;gap:8px;overflow-wrap:anywhere}
            .hr-employment-tools .hr-template-choice input{width:18px;height:18px;min-height:0;flex:none}
            .hr-employment-tools [data-hr-open-templates]{margin:0 0 8px;min-height:40px}
            .hr-employment-tools .hr-template-dialog{
              box-sizing:border-box;width:min(460px,calc(100vw - 24px));max-height:calc(100dvh - 32px);
              overflow:auto;overscroll-behavior:contain;padding:16px;margin:auto;border:1px solid var(--line,#cbd7e5);
              border-radius:14px;background:var(--surface,#fff);color:var(--text,#172b42);box-shadow:0 18px 52px #102a6733
            }
            .hr-employment-tools .hr-template-dialog::backdrop{background:#0d223f66}
            .hr-template-dialog header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
            .hr-template-dialog h2{font-size:17px;margin:0}
            .hr-template-dialog form,.hr-template-dialog fieldset{margin:0;padding:0;border:0;background:transparent}
            .hr-template-dialog fieldset{margin-top:8px}
            .hr-template-dialog label{display:grid;gap:3px;margin:0;font-size:12px;font-weight:650;min-width:0}
            .hr-template-dialog label input,.hr-template-dialog label select{margin:0;min-height:40px;font-size:16px}
            .hr-template-add-fields{display:grid;grid-template-columns:minmax(136px,.8fr) minmax(0,1.2fr);gap:8px}
            .hr-template-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
            .hr-template-dialog button{width:auto;min-height:40px;margin:0;padding:7px 11px;white-space:normal}
            .hr-template-dialog [data-hr-close-templates],.hr-template-dialog [data-hr-refresh-templates]{background:transparent;color:var(--primary,#174875);border:1px solid var(--line,#cbd7e5)}
            .hr-template-dialog [data-hr-delete-template]{background:transparent;color:#b42338;border:1px solid #e8aeba}
            .hr-template-dialog footer{margin-top:10px;padding-top:8px;border-top:1px solid var(--line,#cbd7e5)}
            .hr-template-dialog .status{margin:5px 0 0;overflow-wrap:anywhere}
            @media(max-width:370px){.hr-employment-tools .hr-template-dialog{padding:12px}.hr-template-dialog .hr-template-actions>button{flex:1 1 auto}}
          </style>
          <form data-hr-salary-form class="workflow-form config-form"><fieldset data-hr-salary-fields disabled><legend>Monthly salary · NGN</legend><div class="config-grid">
            <label>Basic salary (NGN)<input name="BasicSalary" type="number" min="0" step="0.01" required></label>
            <div class="config-grid-span"><strong>Allowances</strong><div data-hr-components="Allowances"></div><button type="button" data-hr-add-component="Allowances">Add allowance</button></div>
            <div class="config-grid-span"><strong>Other deductions</strong><div data-hr-components="Deductions"></div><button type="button" data-hr-add-component="Deductions">Add deduction</button><p><small>Existing pension, tax and payroll settings stay in Payroll.</small></p></div>
          </div></fieldset><div class="config-dialog-actions"><button type="submit" data-hr-save-salary>Save salary structure</button></div></form>
        </section>
        ${issueLetters ? `<section class="config-group hr-form-card"><header><strong>Employment letter</strong><small>Check the saved role, salary and recipient. Enter your organisation's agreed terms; no contract terms are added automatically.</small></header>
          <p data-hr-letter-recipient></p><div class="config-grid"><label>Saved letters<select data-hr-saved-letters><option value="">New letter</option></select></label><div class="config-dialog-actions"><button type="button" data-hr-load-letter>Load saved letter</button><button type="button" data-hr-new-letter>New letter</button></div></div>
          <p data-hr-letter-history-limit hidden>Only 100 saved letters are shown. Additional history remains preserved.</p>
          <form data-hr-letter-form class="workflow-form config-form"><div class="config-grid">
            <label>Letter date<input name="LetterDate" type="date" required></label><label>Employment start date<input name="StartDate" type="date" required></label>
            <label>Position<input name="Position" required maxlength="160"></label><label>Department<input name="Department" required maxlength="160"></label>
            <label>Employment type<input name="EmploymentType" list="hrEmploymentTypes" required maxlength="100"><datalist id="hrEmploymentTypes"><option value="Permanent"><option value="Contract"><option value="Part-time"><option value="Temporary"><option value="Volunteer"></datalist></label>
            <label>Work location<input name="WorkLocation" maxlength="250"></label><label>Reporting to<input name="ReportingTo" maxlength="160"></label>
            <label>Probation terms<input name="Probation" maxlength="1500"></label><label>Notice period<input name="NoticePeriod" maxlength="1500"></label>
            <label>Working hours<input name="WorkingHours" maxlength="1500"></label><label>Acceptance deadline<input name="AcceptanceDeadline" type="date"></label>
            <label class="config-grid-span">Benefits<textarea name="Benefits" rows="3" maxlength="2500"></textarea></label><label class="config-grid-span">Other agreed terms<textarea name="Terms" rows="5" maxlength="6000"></textarea></label>
          </div><div class="config-dialog-actions"><button type="submit">Save letter draft</button><button type="button" data-hr-preview-letter>Preview PDF</button><button type="button" data-hr-download-letter>Download PDF</button><button type="button" data-hr-send-letter disabled>Send employment letter</button></div>
          <p data-hr-letter-status class="status" role="status">Save a reviewed draft before sending it.</p></form></section>` : ''}
      </div>`;
    const find = selector => root.querySelector(selector), loader = find('[data-hr-employee-loader]'), selector = loader.elements.Username;
    const content = find('[data-hr-employee-content]'), salaryForm = find('[data-hr-salary-form]'), letterForm = find('[data-hr-letter-form]');
    const templateForm = find('[data-hr-template-form]'), templateStatus = find('[data-hr-template-status]');
    const templateEditor = find('[data-hr-template-editor]'), templateChoice = find('[name="ExistingItem"]');
    const templateDialog = find('[data-hr-template-tools]'), templateLauncher = find('[data-hr-open-templates]');
    let active = '', loaded = null, savedLetter = null, preview = null, busy = false, generation = 0;
    const username = () => clean(selector.value).toLowerCase();
    const current = (name = active, sequence = generation) => isCurrent() && name === username() && sequence === generation;
    const status = (message, bad = false, letter = false) => {
      const node = find(letter ? '[data-hr-letter-status]' : '[data-hr-employment-status]');
      if (node) { node.textContent = message; node.className = `status ${bad ? 'bad' : 'ok'}`; }
    };
    const canEditSalary = () => Boolean(loaded && capabilities.canManageSalaryStructure && loaded.salaryEditable !== false);
    const branchFor = data => clean(data?.employee?.BranchId).toLowerCase() || 'main';
    const loadTemplates = async branch => {
      if (templateCache.has(branch)) return templateCache.get(branch).templates;
      if (!templateLoads.has(branch)) {
        templateLoads.set(branch, request('listSalaryTemplates', { BranchId: branch }).then(result => {
          if (!templateCache.has(branch)) templateCache.set(branch, result);
          return templateCache.get(branch).templates;
        }).finally(() => templateLoads.delete(branch)));
      }
      return templateLoads.get(branch);
    };
    const selectedTemplate = () => JSON.parse(templateChoice.value || 'null');
    const populateTemplateEditor = () => {
      const templates = templateCache.get(branchFor(loaded))?.templates || {};
      templateChoice.innerHTML = '<option value="">Add a new item</option>' + componentKinds.map(kind => {
        const names = templates[kind] || [];
        if (!names.length) return '';
        return `<optgroup label="${kind}">${names.map(name =>
          `<option value="${escape(JSON.stringify([kind, name]))}">${escape(name)}</option>`).join('')}</optgroup>`;
      }).join('');
      templateEditor.elements.UpdatedName.value = '';
    };
    const showTemplateStatus = (message = '', bad = false) => {
      templateStatus.textContent = message;
      templateStatus.hidden = !message;
      templateStatus.className = `status ${bad ? 'bad' : 'ok'}`;
    };
    const updateButtons = () => {
      root.querySelectorAll('button').forEach(button => { button.disabled = busy; });
      find('[data-hr-pay-grades]').hidden = !gradeWorkspace || !loaded;
      selector.disabled = busy;
      find('[data-hr-refresh-employee]').disabled = busy || !active;
      find('[data-hr-salary-fields]').disabled = busy || !canEditSalary();
      find('[data-hr-save-salary]').hidden = !capabilities.canManageSalaryStructure;
      find('[data-hr-save-salary]').disabled = busy || !canEditSalary();
      templateLauncher.hidden = !canEditSalary();
      templateForm.querySelector('fieldset').disabled = busy || !canEditSalary();
      templateEditor.querySelector('fieldset').disabled = busy || !canEditSalary();
      templateChoice.disabled = busy || templateChoice.options.length < 2;
      templateForm.hidden = Boolean(templateChoice.value);
      templateEditor.hidden = !templateChoice.value;
      if (issueLetters) {
        letterForm.querySelectorAll('input,textarea,select').forEach(input => { input.disabled = busy; });
        find('[data-hr-saved-letters]').disabled = busy;
        find('[data-hr-send-letter]').disabled = busy || !savedLetter?.LetterId || !savedLetter?.LetterVersion || Boolean(savedLetter.SentAt) || !/^(draft|failed)$/i.test(savedLetter.Status || '');
        find('[data-hr-load-letter]').disabled = busy || !find('[data-hr-saved-letters]').value;
      }
    };
    const addComponent = (kind, component = {}) => {
      const row = document.createElement('div'); row.className = 'hr-component-row';
      const label = kind === 'Allowances' ? 'Allowance' : 'Deduction';
      row.innerHTML = `<label>${label} name<input data-hr-component-name maxlength="120" required value="${escape(component.Name || component.Code)}"></label><label>Amount (NGN)<input data-hr-component-amount type="number" min="0" step="0.01" required value="${escape(component.Amount ?? '')}"></label><button type="button" aria-label="Remove ${label.toLowerCase()}">Remove</button>`;
      row.querySelector('button').addEventListener('click', () => row.remove());
      find(`[data-hr-components="${kind}"]`).append(row);
    };
    for (const kind of componentKinds) find(`[data-hr-add-component="${kind}"]`).addEventListener('click', () => addComponent(kind));
    const componentRows = kind => [...find(`[data-hr-components="${kind}"]`).children].flatMap(row => {
      const choice = row.querySelector('[data-hr-template-choice]');
      if (choice && !choice.checked) return [];
      return [{ Name: choice ? row.dataset.componentName : row.querySelector('[data-hr-component-name]').value,
        Amount: row.querySelector('[data-hr-component-amount]').value }];
    });
    const addTemplateRow = (kind, name, component) => {
      const row = document.createElement('div');
      row.className = 'hr-template-row';
      const displayName = component?.Name || name;
      row.dataset.componentName = displayName;
      row.innerHTML = `<label class="hr-template-choice"><input type="checkbox" data-hr-template-choice>${escape(displayName)}</label>
        <input data-hr-component-amount aria-label="${escape(displayName)} amount (NGN)" placeholder="NGN" type="number" min="0.01" step="0.01" required>`;
      const choice = row.querySelector('[data-hr-template-choice]'), amount = row.querySelector('[data-hr-component-amount]');
      choice.checked = Boolean(component);
      amount.value = component?.Amount ?? '';
      amount.disabled = !choice.checked;
      choice.addEventListener('change', () => { amount.disabled = !choice.checked; });
      find(`[data-hr-components="${kind}"]`).append(row);
    };
    const renderComponents = (kind, components) => {
      const templates = canEditSalary() ? templateCache.get(branchFor(loaded))?.templates?.[kind] || [] : [];
      const names = new Map(templates.map(name => [componentKey(name), name]));
      find(`[data-hr-components="${kind}"]`).replaceChildren();
      for (const component of components) {
        const key = componentKey(component.Name || component.Code);
        const name = names.get(key);
        if (!name) { addComponent(kind, component); continue; }
        addTemplateRow(kind, name, component);
        names.delete(key);
      }
      for (const name of names.values()) addTemplateRow(kind, name);
    };
    const letterPayload = () => ({ Username: active, ...Object.fromEntries(letterFields.map(field => [field, clean(letterForm.elements[field].value)])) });
    const populateLetters = () => {
      if (!issueLetters) return;
      find('[data-hr-letter-history-limit]').hidden = !loaded?.lettersTruncated;
      find('[data-hr-saved-letters]').innerHTML = `<option value="">New letter</option>${(loaded?.letters || []).map(row => `<option value="${escape(row.LetterId)}">${escape([row.LetterDate, row.Status || 'Draft', row.LetterId].filter(Boolean).join(' · '))}</option>`).join('')}`;
    };
    const resetLetter = () => {
      if (!letterForm) return;
      letterForm.reset(); savedLetter = null; preview = null;
      const employee = loaded?.employee || {};
      for (const field of ['Position', 'Department', 'EmploymentType']) letterForm.elements[field].value = employee[field] || '';
      letterForm.elements.StartDate.value = employee.HireDate || '';
      letterForm.elements.LetterDate.value = new Date().toLocaleDateString('en-CA');
      find('[data-hr-saved-letters]').value = '';
      find('[data-hr-letter-recipient]').textContent = `Recipient: ${employee.WorkEmail || employee.Email || 'No saved work email. Update the employment record before sending.'}`;
      status('Save a reviewed draft before sending it.', false, true);
    };
    const showEmployee = data => {
      loaded = data; content.hidden = false;
      const employee = data.employee || {}, profile = data.profile || {};
      salaryForm.elements.BasicSalary.value = profile.BasicSalary ?? '';
      for (const kind of componentKinds) renderComponents(kind, profile[kind] || []);
      populateTemplateEditor();
      showTemplateStatus();
      find('[data-hr-salary-description]').textContent = data.salaryEditable === false
        ? 'This employee uses configurable payroll components. Review the saved summary here and edit components in Accounts → Payroll.'
        : 'This is the existing payroll salary profile. Saving changes future payroll calculations; posted payroll and payments are unchanged.';
      const currency = data.salary?.Currency || profile.Currency || 'NGN';
      const gross = data.salary?.GrossPay;
      const grade = [profile.PayGrade, profile.PayLevel].filter(Boolean).join(' · ');
      find('[data-hr-salary-summary]').textContent = `${employee.DisplayName || active}${employee.EmployeeId ? ` · ${employee.EmployeeId}` : ''}${grade ? ` · Pay grade ${grade}` : ''}${gross !== undefined ? ` · Gross monthly salary: ${new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(Number(gross) || 0)}` : ' · No saved salary structure yet.'}`;
      const breakdown = [['Earning', data.salary?.Earnings], ['Deduction', data.salary?.Deductions]]
        .flatMap(([type, rows]) => (Array.isArray(rows) ? rows : []).map(row => ({ type, ...row })));
      find('[data-hr-salary-breakdown]').innerHTML = breakdown.length ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Type</th><th>Salary component</th><th>Amount (${escape(currency)})</th></tr></thead><tbody>${breakdown.map(row => `<tr><td>${escape(row.type)}</td><td>${escape(row.Name || row.Code)}</td><td>${Number(row.Amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`).join('')}</tbody></table></div>` : '';
      populateLetters(); resetLetter(); updateButtons();
    };
    const perform = async (work, letter = false) => {
      if (busy || !isCurrent()) return;
      busy = true; updateButtons();
      try { return await work(); } catch (error) { if (isCurrent()) status(error.message || String(error), true, letter); }
      finally { busy = false; if (isCurrent()) updateButtons(); }
    };
    const updateTemplates = (action, fields = {}, confirmDelete = false) => perform(async () => {
      if (!canEditSalary()) return;
      const name = active, sequence = generation, branch = branchFor(loaded);
      try {
        if (confirmDelete) {
          const message = `Delete “${fields.ExistingName}” from this branch’s reusable list? Staff keep their saved names and amounts.`;
          const confirmed = confirm
            ? await confirm({ title: 'Delete reusable item', message, confirmText: 'Delete reusable item' })
            : global.confirm(message);
          if (!confirmed || !current(name, sequence)) return;
        }
        const result = await request(action, { ...fields, BranchId: branch, TemplateVersion: templateCache.get(branch)?.templateVersion || '' });
        if (!current(name, sequence)) return;
        templateCache.set(branch, result);
        for (const kind of componentKinds) renderComponents(kind, componentRows(kind));
        populateTemplateEditor();
        templateForm.elements.Name.value = '';
        showTemplateStatus(result.message || 'Reusable items refreshed.');
      } catch (error) {
        if (current(name, sequence)) showTemplateStatus(error.message || String(error), true);
      }
    });
    templateLauncher.addEventListener('click', () => templateDialog.showModal());
    find('[data-hr-close-templates]').addEventListener('click', () => templateDialog.close());
    templateDialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    templateForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!templateForm.reportValidity()) return;
      updateTemplates('addSalaryTemplate', { Kind: templateForm.elements.Kind.value, Name: templateForm.elements.Name.value });
    });
    find('[data-hr-refresh-templates]').addEventListener('click', () => updateTemplates('listSalaryTemplates'));
    templateChoice.addEventListener('change', () => {
      templateEditor.elements.UpdatedName.value = selectedTemplate()?.[1] || '';
      updateButtons();
    });
    templateEditor.addEventListener('submit', event => {
      event.preventDefault();
      const selected = selectedTemplate();
      if (!selected || !templateEditor.reportValidity()) return;
      const [Kind, ExistingName] = selected;
      updateTemplates('editSalaryTemplate', { Kind, ExistingName, Name: templateEditor.elements.UpdatedName.value });
    });
    find('[data-hr-delete-template]').addEventListener('click', () => {
      const selected = selectedTemplate();
      if (!selected) return;
      const [Kind, ExistingName] = selected;
      updateTemplates('deleteSalaryTemplate', { Kind, ExistingName }, true);
    });
    const loadEmployee = force => perform(async () => {
      const name = username();
      if (!name) throw new Error('Choose a staff member first.');
      active = name; const sequence = ++generation;
      status('Loading selected employee...');
      const data = !force && cache.has(name) ? cache.get(name) : await request('getSalaryStructure', { Username: name });
      if (!current(name, sequence)) return;
      const branch = branchFor(data);
      let templateError = '';
      if (capabilities.canManageSalaryStructure && data.salaryEditable !== false && !templateCache.has(branch)) {
        try {
          await loadTemplates(branch);
        } catch (error) {
          templateError = 'Reusable items could not be loaded. Use Refresh reusable items to try again.';
        }
      }
      if (!current(name, sequence)) return;
      cache.set(name, data); showEmployee(data); status('Employee setup loaded. Use Refresh for changes made elsewhere.');
      if (templateError) showTemplateStatus(templateError, true);
    });
    loader.addEventListener('submit', event => { event.preventDefault(); loadEmployee(false); });
    find('[data-hr-refresh-employee]').addEventListener('click', () => loadEmployee(true));
    selector.addEventListener('change', () => {
      generation++; active = username(); loaded = null; savedLetter = null; preview = null; content.hidden = true;
      if (cache.has(active)) { showEmployee(cache.get(active)); status('Restored employee setup without another request.'); }
      else status('Click Load employee setup for this staff member.');
      updateButtons();
    });
    salaryForm.addEventListener('submit', event => {
      event.preventDefault(); if (!canEditSalary() || !salaryForm.reportValidity()) return;
      perform(async () => {
        const name = active, sequence = generation;
        const BasicSalary = salaryForm.elements.BasicSalary.valueAsNumber;
        if (!Number.isFinite(BasicSalary) || BasicSalary < 0) throw new Error('Enter a valid basic salary.');
        const saved = await request('saveSalaryStructure', { Username: name, PayrollVersion: loaded.PayrollVersion || '', BasicSalary,
          Allowances: normalizeComponents(componentRows('Allowances')), Deductions: normalizeComponents(componentRows('Deductions')), Currency: 'NGN', PayFrequency: 'Monthly' });
        const result = { ...loaded, ...saved, letters: saved.letters || loaded.letters || [] };
        cache.set(name, result);
        if (!current(name, sequence)) return;
        showEmployee(result); status(result.message || 'Salary structure saved.');
      });
    });
    if (letterForm) {
      letterForm.addEventListener('input', () => { savedLetter = null; preview = null; updateButtons(); status('Letter changed. Save a new draft before sending.', false, true); });
      find('[data-hr-saved-letters]').addEventListener('change', updateButtons);
      find('[data-hr-new-letter]').addEventListener('click', () => { resetLetter(); updateButtons(); });
      const acceptLetter = letter => {
        savedLetter = letter; preview = { key: JSON.stringify(letterPayload()), letter };
        for (const field of letterFields) if (letterForm.elements[field]) letterForm.elements[field].value = letter.Terms?.[field] ?? letter[field] ?? '';
        preview.key = JSON.stringify(letterPayload());
        const rows = loaded.letters || [], summary = { ...letter }; delete summary.PdfBase64;
        loaded.letters = [summary, ...rows.filter(row => row.LetterId !== letter.LetterId)];
        cache.set(active, loaded); populateLetters(); find('[data-hr-saved-letters]').value = letter.LetterId || '';
        find('[data-hr-letter-recipient]').textContent = `Saved recipient: ${letter.RecipientEmail || 'Not recorded'}${letter.SignatureApplied ? ' · Officer signature included.' : ''}`;
        updateButtons();
      };
      find('[data-hr-load-letter]').addEventListener('click', () => perform(async () => {
        const LetterId = find('[data-hr-saved-letters]').value, name = active, sequence = generation;
        if (!LetterId) throw new Error('Choose a saved letter.');
        const result = savedLetter?.LetterId === LetterId && savedLetter.PdfBase64 ? { letter: savedLetter }
          : await request('loadEmploymentLetter', { Username: name, LetterId });
        if (!current(name, sequence)) return;
        acceptLetter(result.letter); status(result.message || 'Saved letter loaded.', false, true);
      }, true));
      letterForm.addEventListener('submit', event => {
        event.preventDefault(); if (!letterForm.reportValidity()) return;
        perform(async () => {
          const payload = letterPayload(), sequence = generation;
          const result = await request('saveEmploymentLetter', payload);
          if (!current(payload.Username, sequence)) return;
          acceptLetter(result.letter); status(result.message || 'Employment letter draft saved. Review the PDF before sending.', false, true);
        }, true);
      });
      const getPdf = async () => {
        if (!letterForm.reportValidity()) throw new Error('Complete the required letter fields.');
        const payload = letterPayload(), key = JSON.stringify(payload);
        if (preview?.key === key && preview.letter.PdfBase64) return preview.letter;
        const requestBody = savedLetter?.LetterId ? { Username: active, LetterId: savedLetter.LetterId } : payload;
        const result = await request('previewEmploymentLetter', requestBody);
        if (!result.letter?.PdfBase64) throw new Error('The employment-letter PDF was not returned.');
        preview = { key, letter: result.letter }; return result.letter;
      };
      const openPdf = download => {
        if (busy || !loaded || !letterForm.reportValidity()) return;
        const popup = download ? null : global.open('', '_blank');
        if (!download && !popup) { status('Allow a preview tab, or use Download PDF.', true, true); return; }
        if (popup) popup.document.title = 'Preparing employment letter';
        perform(async () => {
          try {
            const name = active, sequence = generation, letter = await getPdf();
            if (!current(name, sequence)) { popup?.close(); return; }
            const url = URL.createObjectURL(pdfBlob(letter.PdfBase64));
            if (download) {
              const anchor = document.createElement('a'); anchor.href = url; anchor.download = letter.FileName || 'employment-letter.pdf'; anchor.click();
            } else { popup.opener = null; popup.location.replace(url); }
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          } catch (error) { popup?.close(); throw error; }
        }, true);
      };
      find('[data-hr-preview-letter]').addEventListener('click', () => openPdf(false));
      find('[data-hr-download-letter]').addEventListener('click', () => openPdf(true));
      find('[data-hr-send-letter]').addEventListener('click', () => perform(async () => {
        const letter = savedLetter;
        if (!letter?.LetterId || !letter.LetterVersion) throw new Error('Save the reviewed letter draft before sending.');
        if (!confirm || !await confirm({ title: 'Send employment letter', message: `Send this saved employment letter PDF to ${letter.RecipientEmail}?`, confirmText: 'Send employment letter' })) return;
        const name = active, sequence = generation;
        let result;
        try {
          result = await request('sendEmploymentLetter', { Username: name, LetterId: letter.LetterId, LetterVersion: letter.LetterVersion,
            ConfirmedRecipientEmail: letter.RecipientEmail, ConfirmSend: true });
        } catch (error) {
          // A failed response may follow provider acceptance. Fetch the saved
          // delivery state before offering any retry; never resend blindly.
          if (current(name, sequence)) savedLetter = null;
          throw new Error(`${error.message || error} Load the saved letter to check its delivery state.`);
        }
        if (!current(name, sequence)) return;
        if (result.letter) acceptLetter(result.letter);
        status(result.message || 'Employment letter delivery processed.', false, true);
      }, true));
    }
    const gradeWorkspace = capabilities.canManageSalaryStructure && payGradeRoot && global.DynamaxHrPayGrades?.mount(payGradeRoot, {
      directory, request, isCurrent, confirm, branches, workingBranch, onGradeChanged, getTemplates: loadTemplates, normalizeComponents,
      onApplied(usernames) {
        for (const name of usernames) cache.delete(name);
        if (!usernames.includes(active)) return;
        if (root.getClientRects().length) loadEmployee(true);
        else {
          loaded = null;
          content.hidden = true;
          status('Salary updated. Load employee setup to see the saved amounts.');
        }
      }
    });
    find('[data-hr-pay-grades]').addEventListener('click', () => gradeWorkspace?.openForEmployee({
      data: loaded,
      readDraft() {
        if (!canEditSalary() || !salaryForm.checkValidity()) {
          throw new Error('Close this window and enter a valid basic salary and amounts for all selected items in the salary form.');
        }
        return { BasicSalary: salaryForm.elements.BasicSalary.valueAsNumber,
          Allowances: normalizeComponents(componentRows('Allowances')), Deductions: normalizeComponents(componentRows('Deductions')) };
      },
      copyDraft(grade) {
        if (!canEditSalary()) throw new Error('Open an editable salary profile to use the salary form.');
        salaryForm.elements.BasicSalary.value = grade.BasicSalary;
        for (const kind of componentKinds) renderComponents(kind, grade[kind]);
        status('Grade amounts copied to the salary form. Review the draft before saving.');
      }
    }));
    updateButtons();
  }

  global.DynamaxHrEmployment = { mount, normalizeComponents };
})(window);
