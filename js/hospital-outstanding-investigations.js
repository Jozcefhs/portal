(() => {
  'use strict';
  const kinds = ['Laboratory', 'Imaging'];
  function create({ $, esc, can, api, run, status }) {
    const host = $('outstandingInvestigations');
    host.innerHTML = `<summary>Outstanding investigations report</summary>
      <p>Results awaiting release and amendments in progress are included.</p>
      <form id="outstandingFilter" class="toolbar">
        <label>Department<select id="outstandingKind"></select></label>
        <label>Order dates<select id="outstandingPeriod"><option value="range">Selected dates</option><option value="all">All order dates</option></select></label>
        <label>From<input id="outstandingFrom" type="date" required></label>
        <label>To<input id="outstandingTo" type="date" required></label>
        <button>Load report</button><button id="outstandingRefresh" type="button" hidden>Refresh report</button>
      </form>
      <div id="outstandingPreview" aria-live="polite"></div>
      <div class="toolbar"><button type="button" id="outstandingMore" hidden>Load next page</button>
      <button type="button" id="outstandingPrint" hidden>Print / save PDF</button></div>`;
    let selection, result, requestId, loading;
    const preview = $('outstandingPreview');
    function clearPrint() {
      if ($('cardPrint').firstElementChild?.dataset.investigationPrint) $('cardPrint').replaceChildren();
    }
    function reset() {
      clearPrint();
      selection = result = requestId = loading = null;
      preview.replaceChildren();
      $('outstandingMore').hidden = $('outstandingPrint').hidden = $('outstandingRefresh').hidden = true;
    }
    function permissions() {
      const available = kinds.filter(kind => can('orders.read') || can(kind.toLowerCase()+'.work') || can(kind.toLowerCase()+'.configure'));
      host.hidden = !available.length;
      const choices = available.length > 1 ? ['All', ...available] : available;
      const select = $('outstandingKind');
      if (Array.from(select.options, option=>option.value).join('/') !== choices.join('/')) {
        reset();
        select.replaceChildren(...choices.map(kind => new Option(kind==='All'?'Laboratory and imaging':kind, kind)));
      }
    }
    function draw() {
      const { groups, orders, next, departments, summaryOnly, readTime } = result;
      const totals = [...groups.values()];
      const count = totals.reduce((n, group) => n + group.count, 0);
      const urgent = totals.reduce((n, group) => n + group.urgent, 0);
      const rows = [...orders.values()].sort((a,b) => Number(b.urgent)-Number(a.urgent) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
      const scope = selection;
      const time = new Date(readTime).toLocaleString('en-GB', {timeZone:'Africa/Lagos'});
      const period = scope.allDates ? 'All order dates' : `${esc(scope.from)} to ${esc(scope.to)} by order date (WAT)`;
      preview.innerHTML = `<h3>Outstanding investigations</h3>
        <p>${esc(scope.branchName)} · ${esc(departments.join(' and '))} · ${period}</p>
        <p><strong>${next ? 'Partial report' : scope.allDates ? 'Full report' : 'Full selected period'}</strong> · ${count} outstanding · ${urgent} urgent · Snapshot ${esc(time)} WAT</p>
        ${next?'<p>More orders remain to be checked. Load the next page to extend this report.</p>':''}
        ${summaryOnly.length?`<p>Department totals only for ${esc(summaryOnly.join(' and '))}.</p>`:''}
        ${totals.length?`<div class="table-wrap"><table><caption>Outstanding by stage</caption><thead><tr><th>Department</th><th>Stage</th><th>Outstanding</th><th>Urgent</th></tr></thead><tbody>
        ${totals.sort((a,b)=>a.kind.localeCompare(b.kind)||a.stage.localeCompare(b.stage)).map(g=>`<tr><td>${esc(g.kind)}</td><td>${esc(g.stage)}</td><td>${g.count}</td><td>${g.urgent}</td></tr>`).join('')}</tbody></table></div>`:
        `<p>${next?'No outstanding investigations on the pages checked.':'No outstanding investigations for this selection.'}</p>`}
        ${rows.length?`<div class="table-wrap"><table><caption>Outstanding orders</caption><thead><tr><th>Order</th><th>Patient / wristband</th><th>Department / investigation</th><th>Stage</th><th>Priority</th></tr></thead><tbody>
        ${rows.map(r=>`<tr><td>${esc(r.number)}<br>${esc(new Date(r.created).toLocaleDateString('en-GB',{timeZone:'Africa/Lagos'}))}</td><td>${esc(r.patient)}<br>${esc(r.reference)}</td><td>${esc(r.kind)}<br>${esc(r.service)}</td><td>${esc(r.stage)}</td><td>${r.urgent?'Urgent':'—'}</td></tr>`).join('')}</tbody></table></div>`:''}`;
      $('outstandingMore').hidden = !next;
      $('outstandingPrint').hidden = $('outstandingRefresh').hidden = false;
    }
    async function load(mode) {
      if (loading) return;
      if (mode==='refresh') reset();
      if (mode==='first' && result) { draw(); return; }
      if (mode==='more' && !result?.next) return;
      const scope = selection ||= { kind:$('outstandingKind').value, allDates:$('outstandingPeriod').value === 'all', from:$('outstandingFrom').value, to:$('outstandingTo').value,
        branchName:$('branch').selectedOptions[0]?.textContent || $('branch').value };
      const pending = loading = {};
      requestId ||= crypto.randomUUID();
      try {
        const data = await api('getOutstandingInvestigations', {Kind:scope.kind, RequestId:requestId,
          ...(scope.allDates ? {AllOrderDates:true} : {DateRange:{fromDate:scope.from,toDate:scope.to}}),
          ...(result?.next?{Cursor:result.next,ReadTime:result.readTime}:{})});
        if (selection!==scope) return;
        result ||= { groups:new Map(), orders:new Map() };
        for (const g of data.groups) {
          const key=g.kind+'/'+g.stage, previous=result.groups.get(key);
          result.groups.set(key,{...g,count:g.count+(previous?.count||0),urgent:g.urgent+(previous?.urgent||0)});
        }
        for (const order of data.orders) result.orders.set(order.id, order);
        Object.assign(result,{departments:data.departments,summaryOnly:data.summaryOnly,readTime:data.readTime,next:data.next});
        requestId = null;
        draw();
        status(data.next?'Report page loaded. More orders are available.':'Outstanding investigations report loaded.');
      } finally { if (loading===pending) loading=null; }
    }
    $('outstandingPeriod').addEventListener('change', () => {
      const range = $('outstandingPeriod').value === 'range';
      for (const field of [$('outstandingFrom'), $('outstandingTo')]) {
        field.required = range;
        field.closest('label').hidden = !range;
      }
      reset();
    });
    $('outstandingFilter').addEventListener('input',reset);
    $('outstandingFilter').onsubmit=e=>{e.preventDefault();run(()=>load('first'));};
    $('outstandingMore').onclick=()=>run(()=>load('more'));
    $('outstandingRefresh').onclick=()=>run(()=>load('refresh'));
    $('outstandingPrint').onclick=()=>{
      if (!result) return;
      const copy=preview.cloneNode(true);
      copy.removeAttribute('id'); copy.dataset.investigationPrint='true';
      const target=$('cardPrint'); target.classList.add('billing-print'); target.replaceChildren(copy); window.print();
    };
    window.addEventListener('afterprint',clearPrint);
    return { permissions, reset, open(kind) {
      permissions();
      if (host.hidden) return;
      if ([...$('outstandingKind').options].some(o=>o.value===kind) && $('outstandingKind').value!==kind) {
        reset(); $('outstandingKind').value=kind;
      }
      host.open=true;
      host.scrollIntoView({block:'start'});
    }};
  }
  window.DynamaxOutstandingInvestigations={create};
})();
