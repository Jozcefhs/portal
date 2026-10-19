const clean = value => String(value ?? '').trim();
const escape = value => clean(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function clinicDispensingItems(rows) {
  if (!Array.isArray(rows) || rows.length > 30) throw new Error('Choose no more than 30 dispensed items.');
  const selected = new Set();
  return rows.filter(row => clean(row.InventoryId) || clean(row.Quantity)).map(row => {
    const InventoryId = clean(row.InventoryId), Quantity = Number(row.Quantity);
    if (!InventoryId || selected.has(InventoryId) || !Number.isFinite(Quantity) || Quantity <= 0 || Quantity > 1000000
      || Math.abs(Math.round(Quantity * 1000) / 1000 - Quantity) > 0.0000001) {
      throw new Error('Choose each dispensed item once and enter a positive quantity with up to three decimal places.');
    }
    selected.add(InventoryId);
    return { InventoryId, Quantity };
  });
}

export function mountClinicDispensing(form, { inventory = [], records = [], request, onSaved, setStatus }) {
  const host = form.querySelector('[data-clinic-dispensing]');
  const submit = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-department-status]');
  let editing = null, requestId = '', recordId = `CLN-${crypto.randomUUID()}`, studentSection = '', studentBranch = '';
  let lines = [];
  const supplies = inventory.filter(row => !clean(row.VendorId) && clean(row.OwnershipType || row.OwnerType).toLowerCase() !== 'vendor');
  host.innerHTML = `<label>Visit<select data-clinic-edit><option value="">New clinic visit</option>${records.map((row, index) => `<option value="${index}">${escape(row.Date)} · ${escape(row.StudentName)} · ${escape(row.RecordId || row.__id)}${row.Status === 'Cancelled' ? ' · Cancelled' : ''}</option>`).join('')}</select></label>
    <fieldset><legend>Items dispensed (optional)</legend><p class="muted">Choose the drugs or supplies used and enter the quantity in the displayed stock unit. Save visit deducts the quantities automatically. Leave the row blank if no items were used.</p><div data-clinic-lines></div><button type="button" data-clinic-add>Add another item</button></fieldset>
    <div data-clinic-correction hidden><label>Visit status<select data-clinic-status><option>Active</option><option>Cancelled</option></select></label><label>Reason for correction / cancellation<input data-clinic-reason maxlength="1000"></label>
    <label class="check-row"><input type="checkbox" data-clinic-return> All previously dispensed items were unused and physically returned to Clinic stock.</label><p class="muted">Cancelling the clinical record alone does not return consumed stock. Reducing quantities records a stock correction; only return items actually unused or correct an entry made in error.</p></div>`;
  const draw = () => {
    if (!lines.length) lines.push({ InventoryId: '', Quantity: '' });
    const scoped = supplies.filter(item => (!studentSection || clean(item.SchoolSection || 'Secondary').toLowerCase() === studentSection)
      && (!studentBranch || clean(item.BranchId || 'main').toLowerCase() === studentBranch));
    const available = scoped.filter(item => clean(item.__id) && Number.isFinite(Number(item.Quantity)) && Number(item.Quantity) > 0
      && !['no', 'inactive', 'false', '0'].includes(clean(item.Active).toLowerCase()))
      .sort((left, right) => clean(left.ItemName).localeCompare(clean(right.ItemName), undefined, { sensitivity: 'base', numeric: true }));
    host.querySelector('[data-clinic-lines]').innerHTML = lines.map((line, index) => {
      const missing = line.InventoryId && !available.some(item => clean(item.__id) === line.InventoryId);
      const previous = scoped.find(item => clean(item.__id) === line.InventoryId);
      const retained = editing?.DispensedItems?.some(item => clean(item.InventoryId) === line.InventoryId);
      return `<div class="config-grid" data-clinic-line><label>Drug / supply<select data-clinic-item><option value="">${available.length ? 'Choose an item in stock' : 'No active items in stock'}</option>${missing ? `<option value="${escape(line.InventoryId)}" selected>${escape(previous?.ItemName || line.ItemName || line.InventoryId)} (${retained ? 'previously dispensed; unavailable for new use' : 'unavailable; refresh inventory'})</option>` : ''}${available.map(item => `<option value="${escape(item.__id)}" ${clean(item.__id) === line.InventoryId ? 'selected' : ''}>${escape(item.ItemName)} · ${escape(item.Quantity)} ${escape(item.Unit)} in stock · ${escape(item.SchoolSection || 'Secondary')}</option>`).join('')}</select></label><label>Quantity used<input type="number" data-clinic-quantity min="0.001" step="0.001" placeholder="Enter quantity" value="${escape(line.Quantity ?? '')}"></label><button type="button" data-clinic-remove="${index}" aria-label="Remove dispensed item ${index + 1}">Remove</button></div>`;
    }).join('');
    host.querySelector('[data-clinic-add]').disabled = lines.length >= 30;
  };
  const capture = () => { lines = [...host.querySelectorAll('[data-clinic-line]')].map((row, index) => ({ ...lines[index],
    InventoryId: row.querySelector('[data-clinic-item]').value, Quantity: row.querySelector('[data-clinic-quantity]').value
  })); };
  host.querySelector('[data-clinic-add]').addEventListener('click', () => { capture(); if (lines.length < 30) lines.push({ InventoryId: '', Quantity: '' }); requestId = ''; draw(); });
  host.addEventListener('click', event => {
    const button = event.target.closest('[data-clinic-remove]');
    if (!button) return;
    capture(); lines.splice(Number(button.dataset.clinicRemove), 1); requestId = ''; draw();
  });
  form.addEventListener('input', event => {
    if (!submit.disabled) requestId = '';
    if (event.target.name === 'AdmissionNo' && !editing) { lines = []; studentSection = ''; studentBranch = ''; draw(); }
  });
  form.addEventListener('clinic-student-selected', event => {
    capture(); studentSection = clean(event.detail?.SchoolSection).toLowerCase();
    studentBranch = clean(event.detail?.BranchId || 'main').toLowerCase(); draw();
  });
  host.querySelector('[data-clinic-edit]').addEventListener('change', event => {
    editing = event.target.value === '' ? null : records[Number(event.target.value)];
    recordId = editing ? clean(editing.RecordId || editing.__id) : `CLN-${crypto.randomUUID()}`;
    requestId = ''; studentSection = clean(editing?.SchoolSection).toLowerCase();
    studentBranch = editing ? clean(editing.BranchId || 'main').toLowerCase() : '';
    for (const name of ['Date', 'AdmissionNo', 'Complaint', 'Treatment', 'Disposition', 'Notes']) {
      const field = form.elements[name];
      let value = editing ? clean(editing[name]) : name === 'Date' ? field.defaultValue : name === 'Disposition' ? field.options[0]?.value || '' : '';
      if (name === 'Date') value = value.slice(0, 10);
      if (field.tagName === 'SELECT' && value && ![...field.options].some(option => option.value === value)) field.add(new Option(value, value));
      field.value = value;
    }
    form.elements.AdmissionNo.readOnly = Boolean(editing);
    form.querySelector('#clinicStudentSearch').disabled = Boolean(editing);
    form.querySelector('#clinicFaceLookup').disabled = Boolean(editing);
    form.querySelector('[data-clinic-student-result]')?.setAttribute('hidden', '');
    host.querySelector('[data-clinic-correction]').hidden = !editing;
    host.querySelector('[data-clinic-reason]').required = Boolean(editing);
    host.querySelector('[data-clinic-reason]').value = '';
    host.querySelector('[data-clinic-return]').checked = false;
    host.querySelector('[data-clinic-status]').value = editing?.Status || 'Active';
    lines = (editing?.DispensedItems || []).map(line => ({ ...line })); draw();
    submit.textContent = editing ? 'Save reviewed correction' : 'Save visit';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submit.disabled) return;
    try {
      capture(); const items = clinicDispensingItems(lines);
      requestId ||= `CLN-${crypto.randomUUID()}`;
      const payload = { ...Object.fromEntries(new FormData(form).entries()), RecordId: recordId,
        RequestId: requestId, DispensedItems: items,
        ...(editing ? { ExpectedRevision: Number(editing.Revision || 0), Status: host.querySelector('[data-clinic-status]').value,
          ChangeReason: host.querySelector('[data-clinic-reason]').value, RestoreDispensedStock: host.querySelector('[data-clinic-return]').checked } : {}) };
      submit.disabled = true;
      const result = await request(payload);
      onSaved(result);
    } catch (error) { setStatus(status, error.message || String(error), 'bad'); }
    finally { if (submit.isConnected) submit.disabled = false; }
  });
  draw(); submit.disabled = false;
}
