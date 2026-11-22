(() => {
  'use strict';
  function create({ $, esc, money, can, api, run }) {
    const host = $('billReport');
    host.innerHTML = `<summary>Financial reports</summary><form id="financeReportFilter" class="toolbar">
      <label>Report<select id="financeReportKind"><option value="invoices">Invoiced amounts and unpaid bills</option>
      <option value="claims">Insurance claims by insurer and status</option></select></label>
      <label>From<input type="date" id="financeReportFrom" required></label>
      <label>To<input type="date" id="financeReportTo" required></label><button>Load report</button>
      <button id="financeRefresh" type="button" hidden>Refresh report</button></form>
      <div id="financePreview" aria-live="polite"></div><div class="toolbar">
      <button id="financeMore" type="button" hidden>Load next page</button>
      <button id="financePrint" type="button" hidden>Print / save PDF</button></div>`;
    const picker = $('financeReportKind'), preview = $('financePreview');
    let result, pending;
    function clearPrint() {
      if ($('cardPrint').firstElementChild?.dataset.financePrint) $('cardPrint').replaceChildren();
    }
    function reset() {
      result = pending = null;
      preview.replaceChildren();
      clearPrint();
      $('financeMore').hidden = $('financeRefresh').hidden = $('financePrint').hidden = true;
    }
    function permissions() {
      picker.options[0].disabled = !can('billing.read');
      picker.options[1].disabled = !can('hmo.work');
      host.hidden = picker.options[0].disabled && picker.options[1].disabled;
      if (host.hidden || picker.selectedOptions[0]?.disabled) {
        if (result || pending) reset();
        picker.value = can('billing.read') ? 'invoices' : 'claims';
      }
    }
    const invoiceFields = ['billed','credits','applied','outstanding','overpaid'];
    const claimFields = ['count','claimed','settled'];
    function render() {
      const claims = result.kind === 'claims';
      const fields = claims ? claimFields : invoiceFields;
      const headings = claims ? ['Insurer','Status','Claims','Claim amount','Settled'] :
        ['Payer','Billed','Fee credits','Net payments applied','Outstanding','Overpaid'];
      const groups = [...result.groups.values()].sort((a,b)=>a.label.localeCompare(b.label) || (a.status||'').localeCompare(b.status||''));
      const cells = row => fields.map(f=>`<td>${f==='count'?row[f]:money(row[f])}</td>`).join('');
      const total = Object.fromEntries(fields.map(f=>[f,groups.reduce((sum,g)=>sum+g[f],0)]));
      const when = new Date(result.readTime).toLocaleString('en-GB',{timeZone:'Africa/Lagos'});
      preview.innerHTML = `<h3>${esc(picker.selectedOptions[0].textContent)}</h3><p>${esc(result.branch)} · ${esc(result.from)} to ${esc(result.to)} (WAT)</p>
        <p>${claims?'Claims created':'Invoices issued'} in this period, with balances and statuses as of ${esc(when)} WAT.</p>
        <p><strong>${result.next?'Partial totals — more records available':'Complete period'}</strong> · ${result.count} ${claims?'claims':'invoices'}${claims?'':' · '+result.unpaid+' unpaid invoices'}</p>
        ${groups.length?`<div class="table-wrap"><table><thead><tr>${headings.map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>
          ${groups.map(g=>`<tr><th>${esc(g.label)}</th>${claims?'<td>'+esc(g.status)+'</td>':''}${cells(g)}</tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="${claims?2:1}">Total</th>${cells(total)}</tr></tfoot></table></div>`:'<p>No matching records.</p>'}
        ${claims?'':'<p>Net payments applied include advance allocations and reflect refunds and returned allocations. Outstanding and overpaid amounts are shown separately for each payer.</p>'}`;
      $('financeMore').hidden = !result.next;
      $('financeRefresh').hidden = $('financePrint').hidden = false;
    }
    async function load(more=false) {
      if (pending || (more ? !result?.next : result)) return;
      const state = result || {kind:picker.value, from:$('financeReportFrom').value, to:$('financeReportTo').value,
        branch:$('branch').selectedOptions[0]?.textContent || $('branch').value, groups:new Map(), count:0, unpaid:0};
      const token = pending = {};
      try {
        const data = await api('billingReport', {Report:state.kind, DateRange:{fromDate:state.from,toDate:state.to},
          ...(more ? {Cursor:state.next,ReadTime:state.readTime} : {})});
        if (token !== pending) return;
        const fields = state.kind==='claims' ? claimFields : invoiceFields;
        for (const row of data.groups) {
          const key = JSON.stringify([row.label,row.status]);
          const previous = state.groups.get(key);
          state.groups.set(key, previous ? {...row,...Object.fromEntries(fields.map(f=>[f,previous[f]+row[f]]))} : row);
        }
        state.count += data.count;
        state.unpaid += data.unpaid;
        Object.assign(state,{next:data.next,readTime:data.readTime});
        result=state;
        render();
      } finally { if (pending===token) pending=null; }
    }
    $('financeReportFilter').oninput=reset;
    $('financeReportFilter').onsubmit=e=>{e.preventDefault();run(()=>load());};
    $('financeMore').onclick=()=>run(()=>load(true));
    $('financeRefresh').onclick=()=>run(()=>{reset();return load();});
    $('financePrint').onclick=()=>{
      if (!result) return;
      const copy=preview.cloneNode(true);
      copy.removeAttribute('id'); copy.dataset.financePrint='true';
      $('cardPrint').classList.add('billing-print'); $('cardPrint').replaceChildren(copy); window.print();
    };
    window.addEventListener('afterprint',clearPrint);
    return {permissions,reset};
  }
  window.DynamaxHospitalBillingReport = {create};
})();
