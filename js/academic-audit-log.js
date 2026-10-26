const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const snapshots = new Map();
const time = value => { const date = new Date(value); return Number.isFinite(date.getTime())
  ? `${new Intl.DateTimeFormat('en-GB', {timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'medium'}).format(date)} WAT` : String(value || ''); };

export function mountAcademicAuditLog(root, {scopeKey, request, isCurrent = () => root.isConnected}) {
  let state = snapshots.get(scopeKey) || {from:'',to:'',pages:[],page:0};
  let loading = false;
  function remember() {
    snapshots.delete(scopeKey); snapshots.set(scopeKey, state);
    while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value);
  }
  function render(message = '') {
    if (!isCurrent()) return;
    const page = state.pages[state.page];
    root.innerHTML = `<h3>Academic audit log</h3>
      <p>Saved academic changes for this branch and school section. Choose dates to load history. Dates use West Africa Time.</p>
      <form data-audit-range class="academic-management-editor academic-management-editor-wide">
        <div class="academic-management-form-grid"><label>From<input type="date" name="FromDate" required value="${escape(state.from)}"></label>
        <label>To<input type="date" name="ToDate" required value="${escape(state.to)}"></label></div>
        <button type="submit"${loading ? ' disabled' : ''}>${loading ? 'Loading…' : page ? 'Refresh selected dates' : 'Load academic history'}</button>
      </form><p role="status">${escape(message || (page ? `Page ${state.page+1}: ${page.rows.length} academic changes. Loaded pages are retained while you navigate.` : 'No academic history has been requested.'))}</p>
      ${page ? `<label>Find on loaded page<input type="search" data-audit-search placeholder="Student, admission number, action or officer"></label>
      <div style="overflow:auto;max-height:65vh"><table class="data-table"><thead><tr><th>Date & time</th><th>Action</th><th>Student / record</th><th>Officer</th><th>Details</th></tr></thead><tbody>
        ${page.rows.map(row => `<tr data-audit-row><td>${escape(time(row.Timestamp))}</td><td>${escape(String(row.Action || '').replace(/_/g,' '))}</td>
          <td>${escape(row.SubjectDisplay || 'Academic record')}${row.StudentRef ? `<br>${escape(row.StudentRef)}` : ''}</td>
          <td>${escape(row.Actor || 'System')}</td><td>${escape(row.SummaryDisplay || row.DetailsDisplay || '')}
          ${row.SummaryDisplay && row.DetailsDisplay ? `<details><summary>More details</summary>${escape(row.DetailsDisplay)}</details>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">No matching changes on this page. If available, use Next page to continue within the selected dates.</td></tr>'}
      </tbody></table></div>
      <div class="academic-management-form-actions"><button type="button" data-audit-prev${loading || state.page===0 ? ' disabled' : ''}>Previous page</button>
      <button type="button" data-audit-next${loading || !page.nextCursor ? ' disabled' : ''}>Next page</button></div>` : ''}`;
    root.querySelector('[data-audit-range]').addEventListener('submit', event => {
      event.preventDefault(); if (loading) return;
      const form = new FormData(event.currentTarget);
      const from = String(form.get('FromDate') || ''), to = String(form.get('ToDate') || '');
      if (!from || !to || from > to) { render('Choose a valid date range.'); return; }
      void load({from,to,pages:[],page:0}, null);
    });
    root.querySelector('[data-audit-search]')?.addEventListener('input', event => {
      const value = event.target.value.trim().toLowerCase();
      root.querySelectorAll('[data-audit-row]').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(value); });
    });
    root.querySelector('[data-audit-prev]')?.addEventListener('click', () => { if (!loading && state.page > 0) { state.page--; remember(); render(); } });
    root.querySelector('[data-audit-next]')?.addEventListener('click', () => {
      if (loading || !page.nextCursor) return;
      if (state.pages[state.page+1]) { state.page++; remember(); render(); }
      else void load({...state,page:state.page+1},page.nextCursor);
    });
  }
  async function load(next, cursor) {
    loading = true; render('Loading one page of academic history…');
    try {
      const result = await request({FromDate:next.from,ToDate:next.to,...(cursor ? {Cursor:cursor} : {})});
      if (!isCurrent()) return;
      next.pages = [...next.pages]; next.pages[next.page] = result.academicAudit;
      state = next; remember(); loading = false; render();
    } catch (error) { loading = false; if (isCurrent()) render(error.message || 'Academic history could not be loaded.'); }
  }
  render();
}
