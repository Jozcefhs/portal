(() => {
  'use strict';
  function create({ $, esc, can, api, run, status }) {
    const host = $('medicineUsage');
    host.innerHTML = `<summary>Medicine usage report</summary>
      <p>Net issued is the quantity dispensed less patient returns recorded in the selected period. A return can relate to an earlier dispensing.</p>
      <form id="usageFilter" class="toolbar"><label>From<input id="usageFrom" type="date" required></label>
      <label>To<input id="usageTo" type="date" required></label><button>Load report</button>
      <button type="button" id="usageRefresh" hidden>Refresh report</button></form>
      <div id="usagePreview" aria-live="polite"></div><div class="toolbar">
      <button type="button" id="usageMore" hidden>Load next page</button>
      <button type="button" id="usagePrint" hidden>Print / save PDF</button></div>`;
    let scope, result, pending;
    const preview = $('usagePreview');
    function clearPrint() {
      if ($('cardPrint').firstElementChild?.dataset.usagePrint) $('cardPrint').replaceChildren();
    }
    function reset() {
      scope = result = pending = null;
      clearPrint(); preview.replaceChildren();
      $('usageRefresh').hidden = $('usageMore').hidden = $('usagePrint').hidden = true;
    }
    function permissions() {
      host.hidden = !can('pharmacy.work') && !can('pharmacy.configure');
      if (host.hidden && scope) reset();
    }
    const format = n => (n / 1000).toLocaleString('en-GB', { maximumFractionDigits:3 });
    function draw() {
      const groups = [...result.groups.values()].sort((a,b) => a.medicine.localeCompare(b.medicine) || a.key.localeCompare(b.key));
      preview.innerHTML = `<h3>Medicine usage</h3><p>${esc(scope.branch)} · ${esc(scope.from)} to ${esc(scope.to)} (WAT)</p>
        <p><strong>${result.next ? 'Partial report' : 'Full selected period'}</strong> · Snapshot ${esc(new Date(result.readTime).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}))} WAT</p>
        ${groups.length ? `<div class="table-wrap"><table><thead><tr><th>Medicine</th><th>Strength</th><th>Form</th><th>Unit</th><th>Dispensed</th><th>Returned</th><th>Net issued</th></tr></thead><tbody>
        ${groups.map(g => `<tr><td>${esc(g.medicine)}</td><td>${esc(g.strength)}</td><td>${esc(g.form)}</td><td>${esc(g.unit)}</td><td>${format(g.issued)}</td><td>${format(g.back)}</td><td>${format(g.issued-g.back)}</td></tr>`).join('')}</tbody></table></div>` :
        '<p>No dispensing or patient returns recorded for this branch and period.</p>'}`;
      $('usageMore').hidden = !result.next;
      $('usageRefresh').hidden = $('usagePrint').hidden = false;
    }
    async function load(more = false) {
      if (pending || (more ? !result?.next : result)) return;
      const selected = scope ||= { from:$('usageFrom').value, to:$('usageTo').value, branch:$('branch').selectedOptions[0]?.textContent || $('branch').value };
      const token = pending = {};
      try {
        const data = await api('getMedicineUsage', {DateRange:{fromDate:selected.from,toDate:selected.to},
          ...(more ? {Cursor:result.next,ReadTime:result.readTime} : {})});
        if (scope !== selected) return;
        result ||= { groups:new Map() };
        for (const g of data.groups) {
          const row = result.groups.get(g.key) || {...g,issued:0,back:0};
          row.issued += Math.round(1000*g.dispensed);
          row.back += Math.round(1000*g.returned);
          result.groups.set(g.key,row);
        }
        Object.assign(result,{next:data.next,readTime:data.readTime});
        draw(); status(data.next ? 'Medicine usage page loaded. More movements are available.' : 'Medicine usage report loaded.');
      } finally { if (pending === token) pending = null; }
    }
    $('usageFilter').oninput = reset;
    $('usageFilter').onsubmit = e => { e.preventDefault(); run(()=>load()); };
    $('usageMore').onclick = () => run(()=>load(true));
    $('usageRefresh').onclick = () => run(()=>{ reset(); return load(); });
    $('usagePrint').onclick = () => {
      if (!result) return;
      const copy = preview.cloneNode(true); copy.removeAttribute('id'); copy.dataset.usagePrint='true';
      const target=$('cardPrint'); target.classList.add('billing-print'); target.replaceChildren(copy); window.print();
    };
    window.addEventListener('afterprint',clearPrint);
    return {permissions,reset,open() { permissions(); if (!host.hidden) { host.open=true; host.scrollIntoView({block:'start'}); } }};
  }
  window.DynamaxMedicineUsage = {create};
})();
