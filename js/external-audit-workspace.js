const clean = (value) => String(value ?? '').trim();
const esc = (value) => clean(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const money = (value) => Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const label = (value) => clean(value).replace(/([a-z])([A-Z])/g, '$1 $2');
const csv = (value) => `"${(/^[=+\-@]/.test(clean(value)) ? "'" : '') + clean(value).replace(/"/g, '""')}"`;

function download(content, name, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob(['\uFEFF', content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function auditRecordsCsv(records) {
  const output = [['Register', 'Reference', 'Date', 'Branch', 'Status', 'Field', 'Value']];
  for (const record of records) {
    for (const [field, value] of Object.entries(record.fields || {})) {
      output.push([record.register, record.reference, record.date, record.branchId, record.status, field, typeof value === 'object' ? JSON.stringify(value) : value]);
    }
  }
  return output.map((row) => row.map(csv).join(',')).join('\r\n');
}

export function auditTrialBalanceCsv(report) {
  const headings = ['Account', 'Name', 'Type', 'Opening debit/(credit)', 'Period debit', 'Period credit', 'Closing debit/(credit)'];
  return [headings, ...report.trialBalance.map((row) => [row.code, row.name, row.type, row.opening, row.debit, row.credit, row.closing])]
    .map((row) => row.map(csv).join(',')).join('\r\n');
}

export function auditRegisterPreviewHtml(records, scope, title) {
  const table = records.map((record) => `<tr><td>${esc(record.date || 'Current master record')}</td><td>${esc(record.reference)}</td><td>${esc(record.label)}</td><td>${esc(record.status)}</td><td>${esc(record.branchId)}</td><td>${money(record.fields.GrossAmount ?? record.fields.Amount ?? record.fields.TotalAmount ?? record.fields.TotalDebit ?? 0)}</td></tr>
    <tr class="detail-row"><td colspan="6"><details><summary>Record details &amp; allocations</summary>${fieldsHtml(record.fields)}</details></td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:12px/1.4 Arial,sans-serif;color:#17324d;margin:24px}h1{font-size:21px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd8e3;padding:6px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#eef4f9}thead{display:table-header-group}tr{break-inside:avoid}.detail-row{font-size:10px}.audit-evidence-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.audit-evidence-fields>div{padding:4px}.audit-evidence-fields dt{font-weight:bold}.audit-evidence-fields dd{margin:0}button{padding:9px 15px;border:0;border-radius:6px;background:#1769e0;color:white;cursor:pointer}.note{color:#52687c}@media print{body{margin:0}.actions{display:none}details>*{display:block!important}summary{display:none}}</style></head><body><div class="actions"><button type="button" onclick="window.print()">Print / save as PDF</button></div><h1>${esc(title)}</h1><p>${esc(scope.dateFrom)} to ${esc(scope.dateTo)} · Branch ${esc(scope.branchId)} · ${records.length} records</p><p class="note">Payments are the original receipt totals. Fee allocations and credit applications are supporting details, not additional cash received. Master-register records show current values.</p><table><thead><tr><th>Date</th><th>Reference</th><th>Description / payer</th><th>Status</th><th>Branch</th><th>Amount / journal debit</th></tr></thead><tbody>${table || '<tr><td colspan="6">No matching records.</td></tr>'}</tbody></table></body></html>`;
}

export async function previewAuditRegister(request, scope, register, existingPreview = null) {
  const preview = existingPreview || window.open('', '_blank');
  if (!preview) throw new Error('Allow pop-ups for this portal to open the audit preview.');
  preview.opener = null;
  preview.document.write('<p>Preparing the complete audit register…</p>');
  try {
    const data = await request('exportRegister', { register });
    if (preview.closed) return;
    preview.document.open(); preview.document.write(auditRegisterPreviewHtml(data.records, scope, `Financial audit — ${label(register)}`)); preview.document.close();
  } catch (error) { if (!preview.closed) { preview.document.open(); preview.document.write(`<p>${esc(error.message || error)}</p>`); preview.document.close(); } throw error; }
}

function fieldsHtml(fields) {
  return `<dl class="audit-evidence-fields">${Object.entries(fields || {}).map(([key, value]) => `<div><dt>${esc(label(key))}</dt><dd>${Array.isArray(value)
    ? `<div class="admin-table-wrap"><table class="admin-table"><tbody>${value.map((line, index) => `<tr><td>${index + 1}</td><td>${Object.entries(line).map(([field, item]) => `${esc(label(field))}: ${esc(item)}`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>` : esc(value)}</dd></div>`).join('')}</dl>`;
}

function recordCard(record, allowFinding) {
  return `<article class="audit-evidence-record"><header><div><small>${esc(record.register)} · ${esc(record.branchId)}</small><h3>${esc(record.reference)}</h3><small>Record ID: ${esc(record.id)}</small><p>${esc(record.label)}</p></div>${allowFinding ? `<button type="button" data-evidence-finding="${esc(record.register)}" data-record-id="${esc(record.id)}">Raise finding / request evidence</button>` : ''}</header>
    ${record.snapshot ? '<p class="status">Current master-register values; these are not a historical snapshot.</p>' : ''}
    ${fieldsHtml(record.fields)}
    <div class="audit-evidence-documents">${record.attachments.length ? record.attachments.map((item) => item.available
      ? `<button type="button" class="secondary" data-audit-document="${esc(record.register)}" data-record-id="${esc(record.id)}" data-attachment="${item.index}">Download ${esc(item.label)}</button>`
      : `<span class="status bad">${esc(item.label)} uses an unsupported legacy link. Request a secure copy from management.</span>`).join('') : '<p class="muted">No supporting file is attached to this record. Management can supply one in Supporting documents &amp; governance.</p>'}</div></article>`;
}

export async function mountAuditEvidenceWorkspace(root, options) {
  const { request, staffFetch, scope, user, raiseFinding } = options;
  const state = { register: options.initialRecord?.register || (options.view === 'payments' ? 'payments' : 'expenses'), cursor: null, history: [], page: 1, records: [], nextCursor: null, note: '', detail: null, report: null, catalog: [], categories: [], busy: false, message: '' };
  const active = () => root.isConnected;
  const external = user.role === 'External Auditor';
  function status(message, bad = false) {
    const target = root.querySelector('[data-evidence-status]');
    if (target) { target.textContent = message; target.className = bad ? 'status bad' : 'status'; }
  }
  async function run(task) {
    if (state.busy) return;
    state.busy = true; status('Loading audit evidence…');
    root.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try { await task(); }
    catch (error) { if (active()) { state.message = error.message || String(error); render(); status(state.message, true); } }
    finally { state.busy = false; if (active()) root.querySelectorAll('button[data-busy]').forEach((button) => { button.disabled = false; }); }
  }
  async function loadRecords() {
    const data = await request('records', { register: state.register, recordCursor: state.cursor });
    if (!active()) return;
    Object.assign(state, { records: data.records || [], nextCursor: data.nextCursor, note: data.note, detail: null, scanned: data.scanned, message: '' }); render();
  }
  function uploadHtml() {
    if (external || state.register !== 'evidence') return '';
    return `<details class="audit-evidence-upload"><summary>Supply a supporting document</summary><form data-audit-upload class="workflow-form">
      <p class="muted">Supply statements, contracts, tax evidence, approvals or governance documents here. Uploads add evidence without editing financial source records. Select a specific branch first.</p>
      <div class="config-grid"><label>Title<input name="title" maxlength="180" required></label><label>Category<select name="category">${state.categories.map((value) => `<option>${esc(value)}</option>`).join('')}</select></label><label>Document date<input name="documentDate" type="date" min="${esc(scope.dateFrom)}" max="${esc(scope.dateTo)}" value="${esc(scope.dateTo)}" required></label></div>
      <div class="config-grid"><label>Link to register (optional)<select name="relatedRegister"><option value="">General supporting document</option>${state.catalog.filter((item) => item.key !== 'evidence').map((item) => `<option value="${esc(item.key)}">${esc(item.label)}</option>`).join('')}</select></label><label>Linked record ID (optional)<input name="relatedRecordId" maxlength="180"><small>Use the record ID shown in its evidence view.</small></label><label>PDF, JPG or PNG · maximum 8 MB<input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required></label></div>
      <button type="submit" data-busy>Supply document</button></form></details>`;
  }
  function reportsHtml() {
    const report = state.report;
    if (!report) return '<p class="muted">Load the complete period reports to review opening balances, movements and closing balances.</p><button type="button" data-load-audit-report data-busy>Generate period reports</button>';
    const totals = report.totals;
    const accountRows = (type, amount) => report.trialBalance.filter((row) => type.includes(row.type.toLowerCase())).map((row) => `<tr><td>${esc(row.code)} ${esc(row.name)}</td><td>${money(amount(row))}</td></tr>`).join('');
    return `<div class="audit-report-content"><h3>Financial audit period report</h3><p>${esc(scope.dateFrom)} to ${esc(scope.dateTo)} · ${esc(scope.branchId)} · ${report.postedJournals} posted journals</p><p class="muted">${esc(report.note)}</p><p class="muted">Generated ${esc(report.generatedAt)} · Consistent database snapshot ${esc(report.readTime)}</p>
      ${report.warnings.length ? `<p class="status bad">Review required: ${report.warnings.map(esc).join(' ')}</p>` : ''}
      <div class="workflow-kpis"><div><small>Income</small><strong>${money(totals.income)}</strong></div><div><small>Expenditure</small><strong>${money(totals.expenditure)}</strong></div><div><small>Surplus / deficit</small><strong>${money(totals.surplus)}</strong></div><div><small>Closing trial balance difference</small><strong>${money(totals.closing)}</strong></div></div>
      <h3>Trial balance: opening, period movements and closing</h3><p class="muted">Positive opening/closing values are debit balances; negative values are credit balances.</p>
      <div class="admin-table-wrap"><table class="admin-table audit-period-trial"><thead><tr><th>Account</th><th>Name</th><th>Type</th><th>Opening Dr/(Cr)</th><th>Period debit</th><th>Period credit</th><th>Closing Dr/(Cr)</th></tr></thead><tbody>${report.trialBalance.map((row) => `<tr><td>${esc(row.code)}</td><td>${esc(row.name)}</td><td>${esc(row.type)}</td><td>${money(row.opening)}</td><td>${money(row.debit)}</td><td>${money(row.credit)}</td><td>${money(row.closing)}</td></tr>`).join('')}<tr><td colspan="3"><strong>Totals</strong></td><td>${money(totals.opening)}</td><td>${money(totals.debit)}</td><td>${money(totals.credit)}</td><td>${money(totals.closing)}</td></tr></tbody></table></div>
      <div class="audit-statement-grid"><section><h3>Income &amp; expenditure</h3><table class="admin-table"><thead><tr><th>Income</th><th>Amount</th></tr></thead><tbody>${accountRows(['revenue', 'income'], (row) => row.credit - row.debit)}</tbody></table><table class="admin-table"><thead><tr><th>Expenditure</th><th>Amount</th></tr></thead><tbody>${accountRows(['expense'], (row) => row.debit - row.credit)}</tbody></table><p><strong>Surplus / deficit: ${money(totals.surplus)}</strong></p></section>
      <section><h3>Statement of financial position at ${esc(scope.dateTo)}</h3><table class="admin-table"><thead><tr><th>Assets</th><th>Amount</th></tr></thead><tbody>${accountRows(['asset'], (row) => row.closing)}<tr><td>Total assets</td><td>${money(totals.assets)}</td></tr></tbody></table><table class="admin-table"><thead><tr><th>Liabilities &amp; funds/equity</th><th>Amount</th></tr></thead><tbody>${accountRows(['liability', 'equity'], (row) => -row.closing)}<tr><td>Unclosed accumulated earnings</td><td>${money(totals.unclosedEarnings)}</td></tr><tr><td>Total liabilities &amp; funds/equity</td><td>${money(totals.liabilities + totals.equity + totals.unclosedEarnings)}</td></tr></tbody></table><p><strong>Difference: ${money(totals.balanceSheetDifference)}</strong></p></section></div>
      <p class="muted">These statements are generated from recorded journals. Review source evidence, classifications and completeness before drawing an audit conclusion.</p></div>
      <div class="workflow-primary-actions audit-report-actions"><button type="button" data-export-trial data-busy>Download full trial balance CSV</button><button type="button" data-export-ledger data-busy>Download full period journal evidence CSV</button><button type="button" data-print-audit-report data-busy>Preview / print period reports</button><button type="button" class="secondary" data-load-audit-report data-busy>Regenerate reports</button></div>`;
  }
  function render() {
    if (!active()) return;
    root.innerHTML = `<div class="audit-evidence-workspace"><p class="status" data-evidence-status>${esc(state.message)}</p>${options.view === 'reports' ? reportsHtml() : `
      <div class="audit-evidence-toolbar"><label>Evidence register<select data-audit-register>${state.catalog.map((item) => `<option value="${esc(item.key)}" ${state.register === item.key ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label><button type="button" class="secondary" data-refresh-audit-records data-busy>Refresh</button><button type="button" data-preview-audit-register data-busy>Preview / print complete register</button><button type="button" data-export-audit-register data-busy>Download complete register CSV</button></div>
      ${state.register === 'payments' ? '<p class="status">Each row is an actual payment receipt. The amount paid is shown once; fee allocations and credit applications are supporting details in the evidence view.</p>' : ''}
      <p class="muted">${esc(state.note)} Page ${state.page}: ${state.records.length} visible records from ${state.scanned || 0} scanned. ${scope.branchId === 'all' ? 'Select a working branch to inspect offerings, donations and restricted funds.' : ''}</p>${uploadHtml()}
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date / master record</th><th>Reference</th><th>Description / payer</th><th>Status</th><th>Branch</th><th>Amount paid / recorded</th><th>Evidence</th></tr></thead><tbody>${state.records.length ? state.records.map((record) => `<tr><td>${esc(record.date || 'Current master register')}</td><td><strong>${esc(record.reference)}</strong></td><td>${esc(record.label)}</td><td>${esc(record.status)}</td><td>${esc(record.branchId)}</td><td>${money(record.fields.GrossAmount ?? record.fields.Amount ?? record.fields.TotalAmount ?? record.fields.TotalDebit ?? 0)}</td><td><button type="button" data-audit-detail="${esc(record.register)}" data-record-id="${esc(record.id)}" data-busy>Inspect evidence</button></td></tr>`).join('') : '<tr><td colspan="7">No matching records on this page. Continue if another page is available, or request evidence from management.</td></tr>'}</tbody></table></div>
      <div class="workflow-primary-actions"><button type="button" data-audit-record-previous ${state.history.length ? 'data-busy' : 'disabled'}>Previous records</button><button type="button" data-audit-record-next ${state.nextCursor ? 'data-busy' : 'disabled'}>Next records</button></div>
      ${state.detail ? `<section class="audit-evidence-detail"><h3>Transaction evidence</h3>${[...(state.detail.warnings || []), ...(state.detail.gaps || [])].map((message) => `<p class="status bad">${esc(message)}</p>`).join('')}${recordCard(state.detail.record, external)}<h3>Linked source transactions, payments &amp; documents</h3>${state.detail.related.length ? state.detail.related.map((record) => `<details><summary>${esc(record.register)} · ${esc(record.reference)} · ${esc(record.label)}</summary>${recordCard(record, external)}</details>`).join('') : '<p class="muted">No linked records found within this audit scope.</p>'}<h3>Financial record history</h3>${state.detail.auditTrail.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Time</th><th>Action</th><th>User</th><th>Record</th><th>Details</th></tr></thead><tbody>${state.detail.auditTrail.map((event) => `<tr><td>${esc(event.Timestamp)}</td><td>${esc(event.Action)}</td><td>${esc(event.User || event.ActorUsername)}</td><td>${esc(event.RecordId)}</td><td>${esc(event.Details)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No financial history entries were found within the selected period.</p>'}</section>` : ''}`}</div>`;
    bind();
  }
  function bind() {
    root.querySelector('[data-audit-register]')?.addEventListener('change', (event) => {
      state.register = event.currentTarget.value; state.cursor = null; state.nextCursor = null; state.history = []; state.page = 1; state.records = []; state.detail = null; void run(loadRecords);
    });
    root.querySelector('[data-refresh-audit-records]')?.addEventListener('click', () => { void run(loadRecords); });
    root.querySelector('[data-audit-record-next]')?.addEventListener('click', () => { if (!state.nextCursor) return; state.history.push(state.cursor); state.cursor = state.nextCursor; state.page += 1; void run(loadRecords); });
    root.querySelector('[data-audit-record-previous]')?.addEventListener('click', () => { if (!state.history.length) return; state.cursor = state.history.pop(); state.page -= 1; void run(loadRecords); });
    root.querySelectorAll('[data-audit-detail]').forEach((button) => button.addEventListener('click', () => { void run(async () => { const data = await request('detail', { register: button.dataset.auditDetail, recordId: button.dataset.recordId }); if (active()) { state.detail = data; render(); root.querySelector('.audit-evidence-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }); }));
    root.querySelectorAll('[data-evidence-finding]').forEach((button) => button.addEventListener('click', () => raiseFinding({ register: button.dataset.evidenceFinding, recordId: button.dataset.recordId })));
    root.querySelectorAll('[data-audit-document]').forEach((button) => button.addEventListener('click', () => { void run(async () => {
      const query = new URLSearchParams({ register: button.dataset.auditDocument, recordId: button.dataset.recordId, attachment: button.dataset.attachment, dateFrom: scope.dateFrom, dateTo: scope.dateTo });
      const response = await staffFetch(`/api/external-audit-document?${query}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.message || 'The document could not be downloaded.'); }
      const fileName = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'audit-evidence.pdf';
      download(await response.blob(), fileName); if (active()) { render(); status('Supporting document downloaded.'); }
    }); }));
    const exportRegister = async (register) => {
      const data = await request('exportRegister', { register });
      download(auditRecordsCsv(data.records), `audit-${register}-${scope.dateFrom}-${scope.dateTo}.csv`);
      if (active()) { render(); status(`Complete register exported: ${data.records.length} records within your dates and branch.`); }
    };
    root.querySelector('[data-export-audit-register]')?.addEventListener('click', () => { void run(() => exportRegister(state.register)); });
    root.querySelector('[data-preview-audit-register]')?.addEventListener('click', () => { void run(async () => { await previewAuditRegister(request, scope, state.register); if (active()) { render(); status('Complete register preview opened. Use Print / save as PDF in the preview.'); } }); });
    root.querySelector('[data-export-ledger]')?.addEventListener('click', () => { void run(() => exportRegister('journals')); });
    root.querySelector('[data-load-audit-report]')?.addEventListener('click', () => { void run(async () => { const report = await request('reports'); if (active()) { state.report = report; state.message = ''; render(); } }); });
    root.querySelector('[data-export-trial]')?.addEventListener('click', () => { void run(async () => { await request('recordExport', { report: 'complete trial balance' }); download(auditTrialBalanceCsv(state.report), `audit-trial-balance-${scope.dateTo}.csv`); if (active()) { render(); status('Complete trial balance exported.'); } }); });
    root.querySelector('[data-print-audit-report]')?.addEventListener('click', () => { void run(async () => {
      await request('recordExport', { report: 'period report print' });
      if (!active()) return;
      const content = root.querySelector('.audit-report-content');
      const previous = document.title;
      const finish = () => { document.body.classList.remove('external-audit-report-print'); document.title = previous; };
      document.title = `Financial audit ${scope.dateFrom} to ${scope.dateTo}`;
      document.body.classList.add('external-audit-report-print');
      window.addEventListener('afterprint', finish, { once: true });
      try { if (content) window.print(); } catch (error) { window.removeEventListener('afterprint', finish); finish(); throw error; }
      if (active()) render();
    }); });
    root.querySelector('[data-audit-upload]')?.addEventListener('submit', (event) => {
      event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const file = values.get('file');
      void run(async () => {
        if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024) throw new Error('Choose a PDF, JPG or PNG file up to 8 MB.');
        const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
        const response = await staffFetch('/api/external-audit-document', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ title: values.get('title'), category: values.get('category'), documentDate: values.get('documentDate'), relatedRegister: values.get('relatedRegister'), relatedRecordId: values.get('relatedRecordId'), fileName: file.name, fileBase64: base64, dateFrom: scope.dateFrom, dateTo: scope.dateTo }) });
        const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Evidence upload failed.');
        state.cursor = null; state.history = []; state.page = 1; await loadRecords(); status(data.message);
      });
    });
  }
  root.innerHTML = '<p class="muted">Loading audit registers…</p>';
  try {
    const catalog = await request('catalog');
    if (!active()) return;
    state.catalog = catalog.registers; state.categories = catalog.documentCategories;
    render();
    if (options.initialRecord) { state.detail = await request('detail', options.initialRecord); if (active()) render(); }
    else if (options.view !== 'reports') await run(loadRecords);
  } catch (error) { if (active()) { state.message = error.message || String(error); render(); status(state.message, true); } }
}
