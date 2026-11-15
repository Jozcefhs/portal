(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = value => String(value ?? '').trim();
  const norm = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  const classKey = value => norm(value).replace(/[^a-z0-9]/g, '');
  const money = value => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(Number(value) || 0);
  const date = value => {
    if (!value) return 'No payment recorded';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
  };
  const snapshot = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Not recorded' : parsed.toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) + ' WAT';
  };
  const note = 'Positive fee balances from the loaded School Insights snapshot. Refresh School Insights to include newer payments or billing changes.';
  const headers = ['S/N', 'Student', 'Admission / account no.', 'Class', 'Student type', 'Expected', 'Paid', 'Outstanding', 'Last payment'];
  let activeDialog = null;

  function filterRows(report, filters = {}) {
    const query = norm(filters.search);
    return (report.rows || []).filter(row => Number(row.OutstandingBalance) > 0
      && (!filters.className || classKey(row.ClassName || 'Unspecified') === filters.className)
      && (!filters.studentType || norm(row.StudentType || 'Unspecified') === filters.studentType)
      && (!query || [row.DisplayName, row.AdmissionNo, row.AccountRef].some(value => norm(value).includes(query))))
      .sort((a, b) => (filters.sort === 'name' ? text(a.DisplayName).localeCompare(text(b.DisplayName))
        : filters.sort === 'class' ? text(a.ClassName).localeCompare(text(b.ClassName), undefined, { numeric: true })
        : Number(b.OutstandingBalance) - Number(a.OutstandingBalance)) || text(a.DisplayName).localeCompare(text(b.DisplayName)));
  }
  const total = (rows, field) => rows.reduce((sum, row) => sum + Math.round((Number(row[field]) || 0) * 100), 0) / 100;
  function rowsHtml(rows, start = 0) {
    return rows.length ? rows.map((row, i) => `<tr><td>${start + i + 1}</td><td>${esc(row.DisplayName)}</td><td>${esc(row.AdmissionNo || row.AccountRef)}</td><td>${esc(row.ClassName || 'Unspecified')}</td><td>${esc(row.StudentType || 'Unspecified')}</td>${['TotalDebit', 'TotalCredit', 'OutstandingBalance'].map(field => `<td class="amount">${esc(money(row[field]))}</td>`).join('')}<td>${esc(date(row.LastPaymentAt))}</td></tr>`).join('')
      : '<tr><td colspan="9">No debtors match these filters.</td></tr>';
  }
  const tableHtml = (rows, start = 0) => `<table><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rowsHtml(rows, start)}</tbody></table>`;
  function caption(context, filters) {
    return [context.branchName, context.schoolSection ? `Section: ${context.schoolSection}` : '',
      `Class: ${filters.classLabel || 'All classes'}`, `Student type: ${filters.typeLabel || 'All types'}`,
      filters.search ? `Search: ${filters.search}` : ''].filter(Boolean).join(' · ');
  }
  function printHtml(report, filters = {}, context = {}) {
    const rows = filterRows(report, filters);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>School fee debtors</title><style>
      *{box-sizing:border-box}body{font:11px/1.4 Arial,sans-serif;color:#17314b;margin:18px}h1{font-size:22px;margin:0}h2{font-size:17px;margin:6px 0}p{margin:6px 0}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{padding:6px;border:1px solid #b9cddd;text-align:left;overflow-wrap:anywhere}th{background:#e9f2f8}tbody tr:nth-child(even){background:#f5f8fb}.amount{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}thead{display:table-header-group}tr{break-inside:avoid}.totals{font-weight:bold;border-top:2px solid #174b78;padding-top:8px}@page{size:A4 landscape;margin:10mm}@media print{body{margin:0}th{print-color-adjust:exact}}
      </style></head><body><h1>${esc(report.schoolName || context.schoolName || 'School')}</h1><h2>School fee debtors</h2><p>${esc(caption(context, filters))}</p><p>Academic session context: ${esc(report.academicSession || 'Not recorded')} · Snapshot: ${esc(snapshot(report.readTime))}</p><p>${rows.length} debtor(s) · Outstanding: <strong>${esc(money(total(rows, 'OutstandingBalance')))}</strong></p>${tableHtml(rows)}<p class="totals">${rows.length} debtor(s) · Expected: ${esc(money(total(rows, 'TotalDebit')))} · Paid: ${esc(money(total(rows, 'TotalCredit')))} · Outstanding: ${esc(money(total(rows, 'OutstandingBalance')))}</p><p>${esc(note)}</p></body></html>`;
  }
  function close() {
    if (!activeDialog) return;
    const dialog = activeDialog;
    activeDialog = null;
    if (dialog.open) dialog.close();
    dialog.remove();
  }
  function open(host, report, context = {}) {
    close();
    const dialog = document.createElement('dialog');
    activeDialog = dialog;
    dialog.className = 'school-debtors-dialog';
    dialog.setAttribute('aria-labelledby', 'schoolDebtorsTitle');
    const choices = (field, key) => [...new Map((report?.rows || []).map(row => {
      const label = text(row[field]) || 'Unspecified'; return [key(label), label];
    })).entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
      .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    dialog.innerHTML = `<header><div><p class="eyebrow">School Insights</p><h2 id="schoolDebtorsTitle">All fee debtors</h2><p>${esc(context.branchName || '')}</p></div><button type="button" data-dismiss aria-label="Close debtors report">Close</button></header>
      ${report?.available !== true ? '<p role="alert">The complete balances could not be loaded. Close this report and refresh School Insights before printing.</p>' : `
      <div data-list-view><div class="school-debtors-filters"><label>Find student<input type="search" data-filter="search" placeholder="Name or admission number" autocomplete="off"></label><label>Class<select data-filter="className"><option value="">All classes</option>${choices('ClassName', classKey)}</select></label><label>Student type<select data-filter="studentType"><option value="">All types</option>${choices('StudentType', norm)}</select></label><label>Sort by<select data-filter="sort"><option value="balance">Largest balance first</option><option value="name">Student name</option><option value="class">Class</option></select></label></div>
      <div class="school-debtors-actions"><button type="button" data-preview>Preview / print</button><button type="button" class="secondary" data-reset>Reset filters</button></div><p data-summary role="status" aria-live="polite"></p><p class="muted">${esc(note)}</p><div class="school-debtors-table" tabindex="0" role="region" aria-label="Fee debtors"><div data-table></div></div><nav aria-label="Debtors report pages"><button type="button" data-previous>Previous</button><span data-page></span><button type="button" data-next>Next</button></nav></div>
      <div data-preview-view hidden><div class="school-debtors-actions"><button type="button" data-print disabled>Print / save PDF</button><button type="button" class="secondary" data-back>Back to list</button></div><div data-preview-frame></div></div>`}`;
    const opener = document.activeElement;
    dialog.querySelector('[data-dismiss]').addEventListener('click', close);
    dialog.addEventListener('close', () => { if (activeDialog === dialog) activeDialog = null; dialog.remove(); if (opener?.isConnected) opener.focus(); }, { once: true });
    host.append(dialog);
    // A branch switch, sign-out or workspace replacement also removes the preview.
    const observer = new MutationObserver(() => { if (!dialog.isConnected) { if (activeDialog === dialog) activeDialog = null; observer.disconnect(); } });
    observer.observe(host, { childList: true, subtree: true });
    dialog.showModal();
    if (report?.available !== true) return;
    let page = 0, filtered = [], frame;
    const fields = [...dialog.querySelectorAll('[data-filter]')];
    const filters = () => ({ ...Object.fromEntries(fields.map(el => [el.dataset.filter, el.value])),
      classLabel: dialog.querySelector('[data-filter="className"]').selectedOptions[0].textContent,
      typeLabel: dialog.querySelector('[data-filter="studentType"]').selectedOptions[0].textContent });
    function render() {
      filtered = filterRows(report, filters());
      const pageCount = Math.max(1, Math.ceil(filtered.length / 100));
      page = Math.min(page, pageCount - 1);
      dialog.querySelector('[data-table]').innerHTML = tableHtml(filtered.slice(page * 100, (page + 1) * 100), page * 100);
      dialog.querySelector('[data-summary]').textContent = `${filtered.length} of ${report.rows.length} debtor(s) · Outstanding: ${money(total(filtered, 'OutstandingBalance'))} · Snapshot: ${snapshot(report.readTime)}`;
      dialog.querySelector('[data-page]').textContent = `Page ${page + 1} of ${pageCount}`;
      dialog.querySelector('[data-previous]').disabled = page === 0;
      dialog.querySelector('[data-next]').disabled = page === pageCount - 1;
      dialog.querySelector('[data-preview]').disabled = filtered.length === 0;
    }
    fields.forEach(el => el.addEventListener(el.type === 'search' ? 'input' : 'change', () => { page = 0; render(); }));
    dialog.querySelector('[data-reset]').addEventListener('click', () => { fields.forEach(el => { el.value = el.dataset.filter === 'sort' ? 'balance' : ''; }); page = 0; render(); });
    dialog.querySelector('[data-previous]').addEventListener('click', () => { page--; render(); });
    dialog.querySelector('[data-next]').addEventListener('click', () => { page++; render(); });
    dialog.querySelector('[data-preview]').addEventListener('click', () => {
      frame = document.createElement('iframe'); frame.title = 'Printable fee debtors report';
      frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
      const print = dialog.querySelector('[data-print]'); print.disabled = true;
      frame.addEventListener('load', () => { print.disabled = false; }, { once: true });
      frame.srcdoc = printHtml(report, filters(), context);
      dialog.querySelector('[data-preview-frame]').replaceChildren(frame);
      dialog.querySelector('[data-list-view]').hidden = true;
      dialog.querySelector('[data-preview-view]').hidden = false;
    });
    dialog.querySelector('[data-print]').addEventListener('click', () => { if (frame?.isConnected) { frame.contentWindow.focus(); frame.contentWindow.print(); } });
    dialog.querySelector('[data-back]').addEventListener('click', () => {
      frame?.remove(); frame = null;
      dialog.querySelector('[data-preview-view]').hidden = true;
      dialog.querySelector('[data-list-view]').hidden = false;
      dialog.querySelector('[data-preview]').focus();
    });
    render();
  }
  root.addEventListener?.('pagehide', close);
  root.DynamaxSchoolDebtors = { open, close, filterRows, printHtml, total };
})(globalThis);
