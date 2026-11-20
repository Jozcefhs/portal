const labels = {
  BirthCertificate: 'Birth certificate', PreviousSchoolReport: 'Previous school report',
  PassportPhotograph: 'Passport photograph', MedicalReport: 'Medical report',
  TransferCertificateDoc: 'Transfer certificate', AcceptanceForm: 'Acceptance form'
};

export async function openSettings(staffFetch, session) {
  if (document.querySelector('[data-school-settings-dialog]')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'workflow-dialog';
  dialog.dataset.schoolSettingsDialog = '';
  dialog.innerHTML = `<header class="workflow-dialog-header"><h2>School documents &amp; structure</h2>
    <button type="button" data-close aria-label="Close school settings">×</button></header>
    <form class="workflow-form"><fieldset disabled><legend>School-wide settings</legend>
    <div data-branches></div><button type="button" data-add>Add branch</button>
    <label>Active branch<select data-active></select></label>
    <fieldset data-sections><legend>School sections</legend></fieldset>
    <fieldset data-documents><legend>Required admission documents</legend></fieldset>
    <button type="submit">Save school settings</button></fieldset>
    <p role="status">Loading school settings…</p></form>`;
  const find = selector => dialog.querySelector(selector);
  const dismiss = () => dialog.close();
  dialog.addEventListener('close', () => { session.removeEventListener('abort', dismiss); dialog.remove(); }, { once: true });
  session.addEventListener('abort', dismiss, { once: true });
  find('[data-close]').onclick = dismiss;
  document.body.append(dialog);
  dialog.showModal();
  const status = find('[role=status]');
  const fieldset = find('form > fieldset');
  async function request(options = {}) {
    const response = await staffFetch('/api/school-structure-settings', { cache: 'no-store', signal: session, ...options });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load school settings.');
    return data;
  }
  try {
    const { settings } = await request();
    if (!dialog.open || session.aborted) return;
    const branches = find('[data-branches]');
    const active = find('[data-active]');
    const rows = [];
    function addBranch(id = '', name = '') {
      const index = rows.length;
      const label = document.createElement('label');
      label.textContent = 'Branch name';
      const input = document.createElement('input');
      input.required = true;
      input.maxLength = 160;
      input.value = name;
      rows.push({ id, input });
      const option = new Option(name || 'New branch', String(index));
      active.add(option);
      input.oninput = () => { option.textContent = input.value || 'New branch'; };
      label.append(input);
      branches.append(label);
      return input;
    }
    settings.branches.forEach(branch => addBranch(branch.Id, branch.Name));
    active.value = String(rows.findIndex(row => row.id === settings.activeBranch));
    find('[data-add]').onclick = () => addBranch().focus();
    function checkbox(container, key, text, checked) {
      const label = document.createElement('label');
      label.className = 'check-row';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.name = key; input.checked = checked;
      label.append(input, document.createTextNode(text));
      container.append(label);
      return input;
    }
    const sections = ['primary', 'secondary'].map(key => checkbox(find('[data-sections]'), key,
      key === 'primary' ? 'Primary / Nursery' : 'Secondary', settings.sections.includes(key)));
    const docs = Object.entries(labels).map(([key, label]) => checkbox(find('[data-documents]'), key, label, settings.documents[key]));
    fieldset.disabled = false;
    status.textContent = '';
    find('form').onsubmit = async event => {
      event.preventDefault();
      if (fieldset.disabled) return;
      const selection = sections.filter(input => input.checked).map(input => input.name);
      if (!selection.length) { status.textContent = 'Select at least one school section.'; return; }
      fieldset.disabled = true;
      status.textContent = 'Saving…';
      try {
        const data = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ structureVersion: settings.structureVersion, documentsVersion: settings.documentsVersion,
            branches: rows.map(row => ({ Id: row.id, Name: row.input.value.trim() })), activeIndex: Number(active.value),
            sections: selection, documents: Object.fromEntries(docs.map(input => [input.name, input.checked])) }) });
        status.textContent = data.changed ? 'School settings saved.' : 'These settings are already saved.';
      } catch (error) { status.textContent = error.message; fieldset.disabled = false; }
    };
  } catch (error) { status.textContent = error.message; }
}
