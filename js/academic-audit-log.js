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
    root.innerHTML = `<section class="security-audit-workspace module-audit-workspace">
      <div class="workflow-intro security-audit-heading"><div><p class="eyebrow">Governance &amp; accountability</p><h2>Academic audit log</h2>
      <p class="muted">Saved academic changes for this branch and school section. Choose dates to load history. Dates use West Africa Time.</p></div></div>
      <form data-audit-range class="security-audit-filters">
        <label>From<input type="date" name="FromDate" required value="${escape(state.from)}"></label>
        <label>To<input type="date" name="ToDate" required value="${escape(state.to)}"></label>
        <div class="security-audit-filter-actions"><button type="submit"${loading ? ' disabled' : ''}>${loading ? 'Loading…' : page ? 'Refresh selected dates' : 'Load academic history'}</button></div>
      </form><p class="muted security-audit-snapshot" role="status">${escape(message || (page ? `Page ${state.page+1}: ${page.rows.length} academic changes. Loaded pages are retained while you navigate.` : 'No academic history has been requested.'))}</p>
      ${page ? `<div class="security-audit-filters"><label class="security-audit-search">Find on loaded page<input type="search" data-audit-search placeholder="Student, admission number, action or officer"></label></div>
      <div class="security-audit-result-bar"><strong data-audit-count>${page.rows.length} actions on this page</strong><span>Read-only history. Searching this page makes no additional requests.</span></div>
      <div class="admin-table-wrap security-audit-table-wrap module-audit-table-wrap"><table class="admin-table security-audit-table module-audit-table"><thead><tr><th scope="col">Date &amp; time</th><th scope="col">Action</th><th scope="col">Student / record</th><th scope="col">Officer</th><th scope="col">Details</th></tr></thead><tbody>
        ${page.rows.map(row => `<tr data-audit-row><td>${escape(time(row.Timestamp))}</td><td class="security-audit-description"><strong>${escape(String(row.Action || '').replace(/_/g,' '))}</strong></td>
          <td>${escape(row.SubjectDisplay || 'Academic record')}${row.StudentRef ? `<small>${escape(row.StudentRef)}</small>` : ''}</td>
          <td>${escape(row.Actor || 'System')}</td><td class="module-audit-details">${escape(row.SummaryDisplay || row.DetailsDisplay || '')}
          ${row.SummaryDisplay && row.DetailsDisplay ? `<details><summary>More details</summary><p>${escape(row.DetailsDisplay)}</p></details>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">No matching changes on this page. If available, use Next page to continue within the selected dates.</td></tr>'}
      </tbody></table></div>
      <div class="security-audit-actions security-audit-pagination"><button type="button" class="secondary" data-audit-prev${loading || state.page===0 ? ' disabled' : ''}>Previous page</button>
      <span>Page ${state.page+1}</span><button type="button" class="secondary" data-audit-next${loading || !page.nextCursor ? ' disabled' : ''}>Next page</button></div>` : ''}</section>`;
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
      root.querySelector('[data-audit-count]').textContent = `${root.querySelectorAll('[data-audit-row]:not([hidden])').length} matching actions on this page`;
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
