(function (root) {
  'use strict';
  const fields = ['receipts', 'grossCents', 'gatewayCents', 'correctionCents'];
  const headers = ['Fee component', 'Code', 'Category', 'Currency', 'Receipts', 'Gross received', 'Gateway charges', 'Corrections', 'Net collected'];
  const note = 'Payments collected only; wallet deposits and unpaid invoices are excluded. Combined school-fee receipts remain under their recorded component; bill snapshots are not treated as payment splits. Corrections use their recording date. Net = gross received − gateway charges − corrections. Dates use Africa/Lagos.';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const net = row => row.grossCents - row.gatewayCents - row.correctionCents;
  const money = cents => (cents / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const csvCell = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, match => "'" + match).replaceAll('"', '""') + '"';
  const values = row => [row.name, row.code, row.category, row.currency, row.receipts,
    money(row.grossCents), money(row.gatewayCents), money(row.correctionCents), money(net(row))];
  const caption = report => `${report.scope.dateFrom} to ${report.scope.dateTo} · Branch: ${report.scope.branchId} · Section: ${report.scope.schoolSection} · Edition: ${report.scope.edition}`;

  async function loadReport(request, period, progress = () => {}) {
    const rows = new Map(), warnings = { undated: 0, unfinished: 0, walletsExcluded: 0 }, visited = new Set();
    let next = { collection: 'feeItems', pageToken: '' }, readTime, scope, scanned = 0;
    while (next) {
      const cursor = JSON.stringify(next);
      if (visited.has(cursor)) throw new Error('A report page repeated. Generate the report again.');
      visited.add(cursor);
      const page = await request({ ...period, ...next, ...(readTime ? { readTime } : {}) });
      if (!page?.ok || !Array.isArray(page.rows) || page.complete !== !page.next || !page.readTime || !page.scope) throw new Error(page?.message || 'Incomplete report response.');
      if (readTime && (page.readTime !== readTime || JSON.stringify(page.scope) !== JSON.stringify(scope))) throw new Error('The report scope changed. Generate it again.');
      if (page.scope.dateFrom !== period.dateFrom || page.scope.dateTo !== period.dateTo) throw new Error('The report period changed.');
      readTime = page.readTime; scope = page.scope;
      for (const row of page.rows) {
        const current = rows.get(row.key) || { ...row, ...Object.fromEntries(fields.map(key => [key, 0])) };
        for (const key of fields) {
          if (!Number.isSafeInteger(row[key]) || row[key] < 0 || !Number.isSafeInteger(current[key] + row[key])) throw new Error('Invalid report amount.');
          current[key] += row[key];
        }
        rows.set(row.key, current);
      }
      for (const key of Object.keys(warnings)) warnings[key] += Number(page.warnings?.[key] || 0);
      scanned += page.scanned || 0; progress(scanned);
      next = page.next;
    }
    const totals = new Map();
    for (const row of rows.values()) {
      const total = totals.get(row.currency) || { name: 'TOTAL', code: '', category: '', currency: row.currency, ...Object.fromEntries(fields.map(key => [key, 0])) };
      for (const key of fields) {
        total[key] += row[key];
        if (!Number.isSafeInteger(total[key])) throw new Error('Report total exceeds the supported range.');
      }
      totals.set(row.currency, total);
    }
    return { rows: [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.name.localeCompare(b.name)),
      totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), warnings, scope, readTime };
  }
  function warningText(report) {
    const { undated, unfinished } = report.warnings;
    return [undated ? `${undated} undated record(s) excluded; their period cannot be established.` : '',
      unfinished ? `${unfinished} receipt(s) awaiting completed processing excluded.` : ''].filter(Boolean).join(' ');
  }
  function table(report) {
    const row = (value, total = false) => `<tr${total ? ' class="fee-summary-total"' : ''}>${values(value).map((cell, index) => `<td${index >= 4 ? ' class="fee-summary-number"' : ''}>${esc(cell)}</td>`).join('')}</tr>`;
    return `<table><thead><tr>${headers.map((header, index) => `<th${index >= 4 ? ' class="fee-summary-number"' : ''}>${header}</th>`).join('')}</tr></thead><tbody>${report.rows.map(value => row(value)).join('') || '<tr><td colspan="9">No fee components or collections found in this scope.</td></tr>'}</tbody><tfoot>${report.totals.map(value => row(value, true)).join('')}</tfoot></table>`;
  }
  function csv(report) {
    return '\uFEFF' + [ ['Fee collections summary'], [caption(report)], [note], [warningText(report)], headers,
      ...report.rows.map(values), ...report.totals.map(values) ].map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  function printHtml(report) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Fee collections summary</title><style>body{font:12px Arial,sans-serif;color:#12304a;margin:24px}h1{font-size:22px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ccd6df;text-align:left;vertical-align:top}.fee-summary-number{text-align:right;white-space:nowrap}.fee-summary-total{font-weight:bold;background:#eef6fa}thead{display:table-header-group}tr{break-inside:avoid}@page{size:landscape;margin:12mm}@media print{button{display:none}body{margin:0}}</style></head><body><button onclick="window.print()">Print / save PDF</button><h1>Fee collections summary</h1><p>${esc(caption(report))}</p><p>${esc(note)}</p><p>${esc(warningText(report))}</p>${table(report)}<p>Snapshot: ${esc(report.readTime)}</p></body></html>`;
  }
  function mount(host, options) {
    if (!host) return;
    host.classList.add('fee-summary');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const date = ['year', 'month', 'day'].map(type => today.find(part => part.type === type).value).join('-');
    host.innerHTML = `<h3>Fee collections summary</h3><p class="muted">${esc(note)}</p><form class="fee-summary-controls"><label>From<input name="dateFrom" type="date" value="${date.slice(0, 8)}01" required></label><label>To<input name="dateTo" type="date" value="${date}" required></label><button type="submit">Generate summary</button><button type="button" data-cancel hidden>Cancel</button><button type="button" data-print disabled>Preview / print</button><button type="button" data-csv disabled>Download CSV</button></form><p role="status" aria-live="polite">Choose a period and generate the summary.</p><div data-result></div>`;
    const form = host.querySelector('form'), status = host.querySelector('[role="status"]'), result = host.querySelector('[data-result]');
    const print = host.querySelector('[data-print]'), download = host.querySelector('[data-csv]'), cancel = host.querySelector('[data-cancel]');
    let report = null, controller, generation = 0, preview;
    const context = () => JSON.stringify(options.getContext?.() || null);
    const invalidate = () => { generation++; controller?.abort(); preview?.remove(); report = null; result.innerHTML = ''; print.disabled = download.disabled = true; cancel.hidden = true; };
    form.addEventListener('input', () => { invalidate(); status.textContent = 'Dates changed. Generate the summary again.'; });
    cancel.addEventListener('click', () => { invalidate(); status.textContent = 'Cancelled. No partial totals displayed.'; });
    // A hidden/unmounted report must not survive a workspace or account change.
    const observer = new MutationObserver(() => { if (!host.isConnected) { controller?.abort(); preview?.remove(); observer.disconnect(); } });
    observer.observe(document.body, { childList: true, subtree: true });
    form.addEventListener('submit', async event => {
      event.preventDefault(); invalidate();
      const period = Object.fromEntries(new FormData(form));
      if (period.dateFrom > period.dateTo) { status.textContent = 'Start date must be on or before end date.'; return; }
      const id = generation, scope = context(); controller = new AbortController(); const signal = controller.signal;
      cancel.hidden = false; status.textContent = 'Loading complete fee collections…';
      const active = () => host.isConnected && generation === id && scope === context() && !signal.aborted;
      try {
        const loaded = await loadReport(async payload => {
          if (!active()) throw new Error('The active account or workspace changed.');
          const response = await options.fetch('/api/fee-collection-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
          const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Unable to load the report.'); return data;
        }, period, count => { if (active()) status.textContent = `Checking records… ${count.toLocaleString()} scanned. No partial totals displayed.`; });
        if (!active()) return;
        report = loaded; report.context = scope;
        result.innerHTML = `<p class="fee-summary-period">${esc(caption(report))}</p><p class="fee-summary-warning">${esc(warningText(report))}</p><div class="fee-summary-scroll" tabindex="0" role="region" aria-label="Fee totals">${table(report)}</div>`;
        status.textContent = 'Summary complete. Totals are separated by currency.'; print.disabled = download.disabled = false;
      } catch (error) {
        if (active()) { result.innerHTML = ''; status.textContent = `${error.message} No partial totals displayed.`; }
      } finally { if (generation === id) cancel.hidden = true; }
    });
    const valid = () => { if (report && report.context === context()) return true; invalidate(); status.textContent = 'Generate a new report for the current account and workspace.'; return false; };
    print.addEventListener('click', () => {
      if (!valid()) return;
      preview?.remove(); preview = document.createElement('dialog'); preview.className = 'fee-summary-preview';
      preview.setAttribute('aria-label', 'Fee collections print preview');
      const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close preview';
      close.addEventListener('click', () => preview.close());
      const frame = document.createElement('iframe'); frame.title = 'Fee collections printable report';
      frame.setAttribute('sandbox', 'allow-scripts allow-modals'); frame.srcdoc = printHtml(report);
      preview.append(close, frame); preview.addEventListener('close', () => { preview.remove(); print.focus(); }, { once: true });
      document.body.append(preview); preview.showModal();
    });
    download.addEventListener('click', () => {
      if (!valid()) return;
      const url = URL.createObjectURL(new Blob([csv(report)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `fee-collections-${report.scope.dateFrom}-${report.scope.dateTo}.csv`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  root.DynamaxFeeCollectionSummary = { mount, loadReport, csv, printHtml, warningText };
})(globalThis);
