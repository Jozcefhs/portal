(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const norm = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const headers = ['S/N', 'Student', 'Admission / account no.', 'Class at payment', 'Club', 'Session', 'Term', 'Branch', 'Receipts'];
  const note = 'Confirmed club payments only. Pending payments and fully reversed receipts are excluded. A student appears once per club, session, term, branch and school section. This is a payment-backed register, not a manual enrolment list. Names and classes are as recorded on receipts.';

  function members(receipts) {
    const groups = new Map();
    for (const receipt of receipts) {
      const key = JSON.stringify([receipt.branch, receipt.section, norm(receipt.student), norm(receipt.club), norm(receipt.session), norm(receipt.term)]);
      const previous = groups.get(key);
      const newest = !previous || receipt.paidAt > previous.paidAt;
      groups.set(key, { ...(newest ? receipt : previous), receipts: (previous?.receipts || 0) + 1 });
    }
    return [...groups.values()].sort((a, b) => a.club.localeCompare(b.club) || a.name.localeCompare(b.name) || a.student.localeCompare(b.student));
  }
  async function loadReport(request, progress = () => {}) {
    let next = {}, readTime, scope, scanned = 0;
    const visited = new Set(), ids = new Set(), receipts = [], warnings = { missingIdentity: 0, missingPeriod: 0, unfinished: 0 };
    while (next) {
      const cursor = JSON.stringify(next);
      if (visited.has(cursor)) throw new Error('A register page repeated. Reload the register.');
      visited.add(cursor);
      const page = await request({ ...next, ...(readTime ? { readTime } : {}) });
      if (!page?.ok || !Array.isArray(page.rows) || page.complete !== !page.next || !page.readTime || !page.scope) throw new Error(page?.message || 'Incomplete club register response.');
      if (readTime && (readTime !== page.readTime || JSON.stringify(scope) !== JSON.stringify(page.scope))) throw new Error('Register scope changed. Reload the register.');
      readTime = page.readTime; scope = page.scope;
      for (const row of page.rows) {
        if (!row.id || !row.student || !row.club || ids.has(row.id)) throw new Error('A receipt identity is missing or repeated. Reload the register.');
        ids.add(row.id); receipts.push(row);
      }
      for (const key of Object.keys(warnings)) warnings[key] += Number(page.warnings?.[key] || 0);
      scanned += Number(page.scanned || 0); progress(scanned); next = page.next;
    }
    return { rows: members(receipts), scope, readTime, warnings };
  }
  const filterRows = (report, filters) => report.rows.filter(row => ['club', 'session', 'term'].every(key => !filters[key] || (row[key] || 'Not recorded') === filters[key]));
  const values = (row, index) => [index + 1, row.name, row.student, row.className, row.club, row.session || 'Not recorded', row.term || 'Not recorded', row.branch, row.receipts];
  function table(rows) {
    return `<table><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map((row, index) => `<tr>${values(row, index).map(value => `<td>${esc(value)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="9">No confirmed club members match these filters.</td></tr>'}</tbody></table>`;
  }
  const caption = (report, filters) => `Club: ${filters.club || 'All'} · Session: ${filters.session || 'All'} · Term: ${filters.term || 'All'} · Branch: ${report.scope.branchId} · Section: ${report.scope.schoolSection}`;
  function warningText(report) {
    return [report.warnings.missingIdentity ? `${report.warnings.missingIdentity} receipt(s) excluded: student identity missing.` : '',
      report.warnings.missingPeriod ? `${report.warnings.missingPeriod} receipt(s) have an unrecorded session or term; these are not assigned to a period by assumption.` : '',
      report.warnings.unfinished ? `${report.warnings.unfinished} unconfirmed/unfinished club receipt(s) excluded.` : ''].filter(Boolean).join(' ');
  }
  function printHtml(report, filters = {}) {
    const rows = filterRows(report, filters);
    return `<!doctype html><html><head><meta charset="utf-8"><title>Club member register</title><style>body{font:11px Arial;color:#18354b;margin:24px}h1{font-size:20px;border-bottom:2px solid #18354b;padding-bottom:8px}table{width:100%;border-collapse:collapse}th,td{padding:5px 7px;text-align:left;border:1px solid #d5e0e8}th{background:#edf3f7}tbody tr:nth-child(even){background:#f7fafc}thead{display:table-header-group}tr{break-inside:avoid}p{line-height:1.4}@page{size:landscape;margin:12mm}@media print{button{display:none}body{margin:0}}</style></head><body><button onclick="window.print()">Print / save PDF</button><h1>Club member register</h1><p>${esc(caption(report, filters))}</p><p>${rows.length} membership(s) · Confirmed payments only</p>${table(rows)}<p>${esc(note)}</p><p>${esc(warningText(report))}</p><p>Snapshot: ${esc(report.readTime)}</p></body></html>`;
  }
  function mount(host, options) {
    host.classList.add('fee-summary', 'club-members');
    host.innerHTML = `<h3>Club member register</h3><details class="fee-summary-method"><summary>Membership is based on confirmed club payments</summary><p>${esc(note)}</p></details><div class="fee-summary-controls"><label>Club<select data-filter="club"><option value="">All clubs</option></select></label><label>Session<select data-filter="session"><option value="">All sessions</option></select></label><label>Term<select data-filter="term"><option value="">All terms</option></select></label><button type="button" data-load>Load / refresh register</button><button type="button" data-cancel hidden>Cancel</button><button type="button" data-print disabled>Preview / print</button></div><p role="status" aria-live="polite">Load the register, then choose a club and academic period.</p><div data-result></div>`;
    const status = host.querySelector('[role="status"]'), result = host.querySelector('[data-result]');
    const print = host.querySelector('[data-print]'), cancel = host.querySelector('[data-cancel]');
    const selectors = [...host.querySelectorAll('[data-filter]')];
    const filters = () => Object.fromEntries(selectors.map(select => [select.dataset.filter, select.value]));
    const context = () => JSON.stringify(options.getContext?.() || null);
    let report, controller, generation = 0, loadedContext, preview;
    const invalidate = () => { generation++; controller?.abort(); preview?.remove(); report = null; print.disabled = true; cancel.hidden = true; result.innerHTML = ''; };
    function render() {
      preview?.remove();
      if (!report) return;
      if (context() !== loadedContext) { invalidate(); status.textContent = 'Workspace changed. Reload the register.'; return; }
      const selected = filters(), rows = filterRows(report, selected);
      result.innerHTML = `<p class="fee-summary-period">${esc(caption(report, selected))}</p><p class="fee-summary-warning">${esc(warningText(report))}</p><div class="fee-summary-scroll" tabindex="0" role="region" aria-label="Club members">${table(rows)}</div>`;
      status.textContent = `${rows.length} membership(s) shown. Register complete; confirmed club payments only.`;
      print.disabled = false;
    }
    selectors.forEach(select => select.addEventListener('change', render));
    cancel.addEventListener('click', () => { invalidate(); status.textContent = 'Cancelled. No partial register displayed.'; });
    const observer = new MutationObserver(() => { if (!host.isConnected) { invalidate(); observer.disconnect(); } });
    observer.observe(document.body, { childList: true, subtree: true });
    host.querySelector('[data-load]').addEventListener('click', async () => {
      invalidate(); const id = generation, captured = context(); controller = new AbortController();
      const signal = controller.signal, active = () => host.isConnected && id === generation && captured === context() && !signal.aborted;
      cancel.hidden = false; status.textContent = 'Checking confirmed club payments…';
      try {
        const loaded = await loadReport(async payload => {
          if (!active()) throw new Error('Workspace changed. Reload the register.');
          const response = await options.fetch('/api/club-members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
          const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Unable to load club members.'); return data;
        }, count => { if (active()) status.textContent = `Checking payments… ${count.toLocaleString()} scanned. No partial register displayed.`; });
        if (!active()) return;
        report = loaded; loadedContext = captured;
        selectors.forEach(select => {
          const previous = select.value, key = select.dataset.filter;
          const choices = [...new Set(report.rows.map(row => row[key] || 'Not recorded'))].sort((a, b) => a.localeCompare(b));
          select.innerHTML = `<option value="">All ${key === 'club' ? 'clubs' : key === 'session' ? 'sessions' : 'terms'}</option>` + choices.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
          if (choices.includes(previous)) select.value = previous;
        }); render();
      } catch (error) { if (active()) status.textContent = `${error.message} No partial register displayed.`; }
      finally { if (id === generation) cancel.hidden = true; }
    });
    print.addEventListener('click', () => {
      if (!report || context() !== loadedContext) { invalidate(); status.textContent = 'Reload the register for the current workspace.'; return; }
      preview?.remove(); preview = document.createElement('dialog'); preview.className = 'fee-summary-preview'; preview.setAttribute('aria-label', 'Club member register print preview');
      const close = document.createElement('button'); close.textContent = 'Close preview'; close.addEventListener('click', () => preview.close());
      const frame = document.createElement('iframe'); frame.title = 'Printable club member register'; frame.setAttribute('sandbox', 'allow-scripts allow-modals'); frame.srcdoc = printHtml(report, filters());
      preview.append(close, frame); preview.addEventListener('close', () => { preview.remove(); print.focus(); }, { once: true }); document.body.append(preview); preview.showModal();
    });
  }
  root.DynamaxClubMembers = { mount, loadReport, members, filterRows, printHtml, warningText };
})(globalThis);
