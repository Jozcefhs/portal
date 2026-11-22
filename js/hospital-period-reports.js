(() => {
  'use strict';
  const money = new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'});
  const minutes = new Intl.NumberFormat('en-NG',{maximumFractionDigits:1});
  const reports = {
    waiting: {
      title:'Waiting times by department', permission:'visits.read', record:'visits',
      description:'Select arrival dates. The average uses visits with a recorded service start. Waiting, cancelled and unknown timings are listed separately.',
      columns:['Department','Measured visits','Average (min)','Longest (min)','Still waiting','Cancelled','Unknown'],
      sums:['measured','totalMs','waiting','cancelled','unknown'],
      cells:g=>[g.measured,g.measured?minutes.format(g.totalMs/g.measured/60000):'—',
        g.measured?minutes.format(g.longestMs/60000):'—',g.waiting,g.cancelled,g.unknown]
    },
    revenue: {
      title:'Posted hospital revenue', permission:'billing.read', record:'journal entries',
      description:'Select accounting dates. Hospital invoices add revenue and posted fee credits reduce it on their own posting dates. Payments, refunds and advance allocations do not contribute to this report.',
      columns:['Accounting date','Invoice postings','Credit postings','Invoiced','Fee credits','Net revenue'],
      sums:['invoices','credits','billed','credited'],
      cells:g=>[g.invoices,g.credits,money.format(g.billed/100),money.format(g.credited/100),money.format((g.billed-g.credited)/100)]
    }
  };
  function create({$,esc,api,run,can,kind}) {
    const spec = reports[kind];
    const host = $(kind+'Report');
    const el = suffix=>$(kind+'Report'+suffix);
    host.innerHTML = `<summary>${spec.title}</summary><p>${spec.description}</p>
      <form class="toolbar" id="${kind}ReportFilter"><label>From<input required type="date" id="${kind}ReportFrom"></label>
      <label>To<input required type="date" id="${kind}ReportTo"></label><button>Load report</button>
      <button type="button" id="${kind}ReportRefresh" hidden>Refresh report</button></form>
      <div id="${kind}ReportPreview" aria-live="polite"></div><div class="toolbar"><button type="button" id="${kind}ReportMore" hidden>Load next page</button>
      <button type="button" id="${kind}ReportPrint" hidden>Print / save PDF</button></div>`;
    let state, pending;
    function clearPrint() {
      if ($('cardPrint').firstElementChild?.dataset.periodReport===kind) $('cardPrint').replaceChildren();
    }
    function reset() {
      state=pending=null;
      clearPrint(); el('Preview').replaceChildren();
      el('Print').hidden=el('Refresh').hidden=el('More').hidden=true;
    }
    function add(target,group) {
      for (const key of spec.sums) target[key]=(target[key]||0)+group[key];
      if (kind==='waiting') target.longestMs=Math.max(target.longestMs||0,group.longestMs);
    }
    function render() {
      const groups=[...state.groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
      const total={label:'Total'};
      for (const group of groups) add(total,group);
      const cells=g=>`<th>${esc(g.label)}</th>`+spec.cells(g).map(v=>`<td>${esc(v)}</td>`).join('');
      const when=new Date(state.readTime).toLocaleString('en-GB',{timeZone:'Africa/Lagos'});
      el('Preview').innerHTML=`<h3>${spec.title}</h3><p>${esc(state.branch)} · ${esc(state.from)} to ${esc(state.to)} (WAT)</p>
        <p>${spec.description}</p><p><strong>${state.next?'Partial totals — more records available':'Complete period'}</strong> · ${state.count} ${spec.record} · Snapshot ${esc(when)} WAT</p>
        ${groups.length?`<div class="table-wrap"><table><thead><tr>${spec.columns.map(c=>'<th>'+c+'</th>').join('')}</tr></thead>
        <tbody>${groups.map(g=>'<tr>'+cells(g)+'</tr>').join('')}</tbody><tfoot><tr>${cells(total)}</tr></tfoot></table></div>`:'<p>No matching records.</p>'}`;
      el('More').hidden=!state.next; el('Print').hidden=el('Refresh').hidden=false;
    }
    async function load(more=false) {
      if (pending || (more?!state?.next:state)) return;
      const current=state||{groups:new Map(),count:0,from:el('From').value,to:el('To').value,
        branch:$('branch').selectedOptions[0]?.textContent || $('branch').value};
      const token=pending={};
      try {
        const result=await api('hospitalPeriodReport',{Report:kind,DateRange:{fromDate:current.from,toDate:current.to},
          ...(more?{Cursor:current.next,ReadTime:current.readTime}:{})});
        if (pending!==token) return;
        for (const group of result.groups) {
          const combined=current.groups.get(group.label)||{label:group.label};
          add(combined,group); current.groups.set(group.label,combined);
        }
        current.count+=result.count; Object.assign(current,{next:result.next,readTime:result.readTime});
        state=current; render();
      } finally {if (token===pending) pending=null;}
    }
    el('Filter').oninput=reset;
    el('Filter').onsubmit=e=>{e.preventDefault();run(()=>load());};
    el('More').onclick=()=>run(()=>load(true));
    el('Refresh').onclick=()=>run(()=>{reset();return load();});
    el('Print').onclick=()=>{
      if (!state) return;
      const copy=el('Preview').cloneNode(true); copy.removeAttribute('id'); copy.dataset.periodReport=kind;
      $('cardPrint').classList.add('billing-print'); $('cardPrint').replaceChildren(copy); window.print();
    };
    window.addEventListener('afterprint',clearPrint);
    return {reset,permissions(){host.hidden=!can(spec.permission);if(host.hidden&&(state||pending))reset();}};
  }
  window.DynamaxHospitalPeriodReports={create};
})();
