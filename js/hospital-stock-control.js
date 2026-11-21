(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=form=>Object.fromEntries([...form.elements].filter(e=>e.name&&e.type!=='checkbox').map(e=>[e.name,e.value]));
  const date=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):'';
  const input=(name,label,type='text',attributes='')=>`<label>${label}<input name="${name}" type="${type}" ${attributes}></label>`;
  const dates=(label='Recorded from')=>input('fromDate',label,'date','required')+input('toDate','To','date','required');
  const badge=value=>`<span class="stock-state stock-${esc(String(value).toLowerCase())}">${esc(value)}</span>`;
  window.DynamaxHospitalStockControl={create({api,run,can,writable,status}){
    const $=id=>document.getElementById(id),root=$('stockControl');
    root.innerHTML=`<h2>Pharmacy stock control</h2><p>Review expiry dates and reconcile physical counts with a second authorised officer. Choose a period before loading records.</p>
      <section><h3>Expiring medicine stock report</h3><p>Choose the expiry dates to see current shelf and quarantined stock in this branch.</p>
        <form id="scExpiryFilter" class="toolbar">${dates('Expiry from')}<button>Load report</button><button type="button" id="scExpiryRefresh">Refresh batches</button>
          <label class="check-line"><input type="checkbox" id="scExpiryDepleted">Include depleted batches for stock counts</label>
          <button type="button" id="scExpiryPrint" hidden>Preview / print loaded report</button></form>
        <p id="scExpiryNote" class="hint">Choose an expiry period of up to 93 days.</p><div id="scExpiryRows" class="table-wrap"></div>
        <div class="toolbar"><button type="button" id="scExpiryPrevious" hidden>Previous page</button><button type="button" id="scExpiryNext" hidden>Next page</button></div></section>
      <section><h3>Physical stock counts</h3><form id="scCountsFilter" class="toolbar">${dates()}<label>Status<select name="Status"><option value="">All statuses</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Cancelled</option></select></label><button>Load counts</button><button type="button" id="scCountsRefresh">Refresh counts</button><button type="button" id="scCountsPrint">Preview / print</button></form><p id="scCountsNote" class="hint">No count history requested.</p><div id="scCountsRows" class="table-wrap"></div><div class="toolbar"><button type="button" id="scCountsPrevious" hidden>Previous page</button><button type="button" id="scCountsNext" hidden>Next page</button></div></section>
      <form id="scCountForm" hidden><h3>Record physical batch count</h3><div id="scBatchSummary"></div><p>Count shelf stock and quarantined stock separately. Returned medicines remain quarantined. Use the existing pharmacy controls for stock movements; this form records a physical discrepancy only.</p><div class="form-grid">${input('Reference','Permanent count reference','text','required maxlength="120"')}${input('CountedAt','Counted at (WAT)','datetime-local','required step="1"')}${input('OnHand','Physical shelf quantity','number','required min="0" max="1000000" step="0.001"')}${input('Quarantined','Physical quarantined quantity','number','required min="0" max="1000000" step="0.001"')}<label>Count evidence / reason<textarea name="Reason" required maxlength="2000"></textarea></label></div><label class="check-line"><input name="Confirmed" type="checkbox" required>I checked the medicine, strength, unit, batch and physical quantities.</label><button data-sc-write="stock.count">Submit for independent review</button><button id="scCountClose" type="button">Close count</button></form>
      <section id="scDetail" hidden><h3>Physical count review</h3><div id="scCountSummary"></div><p id="scStale" class="notice" hidden>Stock changed after this count. Approval is blocked. Reject or cancel it, refresh the batch and record a new physical count.</p><div class="toolbar"><button type="button" id="scDetailRefresh">Refresh count</button><button type="button" id="scDetailPrint">Preview / print count</button></div>
        <form id="scReviewForm" hidden><div class="form-grid"><label>Decision<select name="Decision"></select></label><label>Review evidence / reason<textarea name="Reason" maxlength="2000" required></textarea></label></div><label class="check-line"><input name="Confirmed" type="checkbox" required>I reviewed the batch, physical count and supporting evidence.</label><button>Save decision</button></form>
        <form id="scHistoryFilter" class="toolbar">${dates()}<button>Load count history</button><button type="button" id="scHistoryRefresh">Refresh history</button></form><div id="scHistoryRows"></div><button type="button" id="scHistoryNext" hidden>Next history page</button>
      </section>
      <dialog id="scPreview"><div class="toolbar"><button type="button" id="scPrint">Print</button><button type="button" id="scPreviewClose">Close preview</button></div><div id="scPreviewBody"></div></dialog>`;
    let batch=null,detail=null,dirty=false,historyCursor=null,historyQuery=null;
    const cache=new Map();
    let countsPage=null;
    const remember=(key,value)=>{cache.delete(key);cache.set(key,value);while(cache.size>24)cache.delete(cache.keys().next().value);return value;};
    async function cached(action,body,refresh=false){const key=JSON.stringify([action,body]);if(refresh)cache.delete(key);if(cache.has(key))return cache.get(key);return remember(key,await api(action,body));}
    async function confirmLeave(){return !dirty||await window.DynamaxDialogs.confirm({title:'Unsaved stock count',message:'Discard the unsaved stock count or review changes?',confirmLabel:'Discard changes',tone:'warning'});}
    function permissions(){
      document.querySelector('[data-tab=stockControl]').hidden=!can('stock.read');
      root.querySelectorAll('[data-sc-write]').forEach(e=>e.hidden=!writable(e.dataset.scWrite));
      $('scCountForm').querySelectorAll('input,textarea,button:not([type=button])').forEach(e=>e.disabled=!writable('stock.count'));
      $('scReviewForm').hidden=!detail||!(detail.CanReview&&writable('stock.review')||detail.CanCancel&&writable('stock.count'));
    }
    const batchSummary=row=>`<p><strong>${esc(row.Medicine)} · ${esc(row.Strength)} · ${esc(row.Form)}</strong><br>Batch ${esc(row.BatchNumber)} · expiry ${esc(row.ExpiryDate)} · unit ${esc(row.Unit)}<br>Recorded shelf: ${row.OnHand}; quarantined: ${row.Quarantined}</p>`;
    let expiry = null;
    function clearExpiry(){
      expiry=null;
      $('scExpiryRows').replaceChildren();
      $('scExpiryPrevious').hidden=$('scExpiryNext').hidden=$('scExpiryPrint').hidden=true;
      $('scExpiryNote').textContent='Choose an expiry period of up to 93 days.';
      if($('scPreview').open)$('scPreview').close();
    }
    function expiryTable(rows,controls){
      const canCount=controls && writable('stock.count');
      const headings=['Medicine / strength','Batch','Expiry date','Shelf stock','Quarantined'];
      if(canCount)headings.push('Physical count');
      const body=rows.map(row=>{
        const cells=[esc(row.Medicine)+'<br>'+esc(row.Strength)+' · '+esc(row.Form),esc(row.BatchNumber),
          esc(row.ExpiryDate)+(row.Expired?' '+badge('Expired'):''),esc(row.OnHand??0)+' '+esc(row.Unit),esc(row.Quarantined??0)+' '+esc(row.Unit)];
        if(canCount)cells.push(`<button type="button" data-sc-batch="${esc(row.BatchId)}">Record physical count</button>`);
        return '<tr>'+cells.map((cell,i)=>`<td data-label="${headings[i]}">${cell}</td>`).join('')+'</tr>';
      }).join('');
      return '<table><thead><tr>'+headings.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>';
    }
    function visibleExpiry(rows){
      return $('scExpiryDepleted').checked ? rows : rows.filter(row=>row.OnHand>0 || row.Quarantined>0);
    }
    function expirySummary(){
      const loaded=new Map();
      for(const page of expiry.pages)for(const row of page.batches)loaded.set(row.BatchId,row);
      const rows=visibleExpiry([...loaded.values()]);
      const range=expiry.range;
      const coverage=expiry.pages.at(-1).next?'Partial report · more batches available':'Complete report';
      const note=`${coverage} · ${rows.length} batches · expiry ${range.fromDate} to ${range.toDate} · stock as of ${date(expiry.pages[0].readTime)} WAT.`;
      return {rows,note};
    }
    function renderExpiry(){
      const page=expiry.pages[expiry.index], rows=visibleExpiry(page.batches);
      $('scExpiryNote').textContent=expirySummary().note+' Showing page '+(expiry.index+1)+'.';
      $('scExpiryRows').innerHTML=rows.length?expiryTable(rows,true):'<p>No matching stock on this page.</p>';
      $('scExpiryRows').querySelectorAll('[data-sc-batch]').forEach(button=>button.onclick=()=>run(()=>openBatch(button.dataset.scBatch)));
      $('scExpiryNext').hidden=!page.next;
      $('scExpiryPrevious').hidden=expiry.index===0;
      $('scExpiryPrint').hidden=false;
    }
    async function loadExpiry(step=0,refresh=false){
      const form=$('scExpiryFilter');
      if(!form.reportValidity())return;
      const {fromDate,toDate}=fields(form);
      if(refresh || !expiry || expiry.range.fromDate!==fromDate || expiry.range.toDate!==toDate){
        clearExpiry();
        expiry={range:{fromDate,toDate},pages:[],index:0};
      }
      const report=expiry, index=step?Math.max(0,report.index+step):0;
      if(!report.pages[index]){
        const previous=report.pages[index-1];
        if(index && !previous?.next)return;
        const data=await api('stockExpiryRegister',{DateRange:report.range,Snapshot:true,
          ...(previous?{Cursor:previous.next,ReadTime:report.pages[0].readTime}:{})});
        if(report!==expiry)return;
        report.pages.push(data);
      }
      report.index=index;
      renderExpiry();
      status('Selected expiry period loaded.');
    }
    $('scExpiryFilter').onsubmit=e=>{e.preventDefault();run(()=>loadExpiry());};
    $('scExpiryRefresh').onclick=()=>run(()=>loadExpiry(0,true));
    $('scExpiryNext').onclick=()=>run(()=>loadExpiry(1));
    $('scExpiryPrevious').onclick=()=>run(()=>loadExpiry(-1));
    $('scExpiryDepleted').onchange=()=>{if(expiry?.pages.length)renderExpiry();};
    $('scExpiryFilter').querySelectorAll('input[type=date]').forEach(input=>input.oninput=clearExpiry);
    $('scExpiryPrint').onclick=()=>{
      if(!expiry?.pages.length)return;
      const {rows,note}=expirySummary();
      preview('Expiring medicine stock report',rows.length?expiryTable(rows,false):'<p>No matching stock in the loaded batches.</p>',note);
    };
    function renderCounts(data){
      const prefix='scCounts',p=countsPage,rows=data.counts;
      $(prefix+'Note').textContent=`${rows.length} records on page ${p.index+1}. ${p.query.DateRange.fromDate} to ${p.query.DateRange.toDate}${p.query.Status?' · '+p.query.Status:''}. Loaded pages are retained; Refresh checks newer records.`;
      $(prefix+'Previous').hidden=p.index===0;$(prefix+'Next').hidden=!data.next;
        $(prefix+'Rows').innerHTML=`<table><thead><tr><th>Reference / counted at</th><th>Medicine / batch</th><th>Shelf difference</th><th>Quarantine difference</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.Reference)}<br>${esc(date(r.CountedAt))} WAT</td><td>${esc(r.Medicine)}<br>${esc(r.BatchNumber)}</td><td>${r.Difference.OnHand} ${esc(r.Unit)}</td><td>${r.Difference.Quarantined} ${esc(r.Unit)}</td><td>${badge(r.Status)}</td><td><button type="button" data-sc-count="${i}">Open count</button></td></tr>`).join('')||'<tr><td colspan="6">No counts in this selected period.</td></tr>'}</tbody></table>`;
        $(prefix+'Rows').querySelectorAll('[data-sc-count]').forEach(button=>button.onclick=()=>run(()=>openCount(rows[Number(button.dataset.scCount)].CountId)));
      const headers=[...$(prefix+'Rows').querySelectorAll('th')].map(h=>h.textContent);$(prefix+'Rows').querySelectorAll('tbody tr').forEach(tr=>[...tr.children].forEach((td,i)=>td.dataset.label=headers[i]||''));
    }
    async function loadCounts(step=0,refresh=false){
      const form=$('scCountsFilter');if(!form.reportValidity())return;
      const v=fields(form),query={DateRange:{fromDate:v.fromDate,toDate:v.toDate},Status:v.Status};
      if(!countsPage||JSON.stringify(countsPage.query)!==JSON.stringify(query)||refresh)countsPage={query,stack:[null],index:0};
      const p=countsPage;if(step>0&&p.data?.next){p.stack[p.index+1]=p.data.next;p.index++;}else if(step<0&&p.index)p.index--;
      const body={...query,...(p.stack[p.index]?{Cursor:p.stack[p.index]}:{})};
      p.data=await cached('stockCountRegister',body,refresh);renderCounts(p.data);status('Selected stock count period loaded.');
    }
    async function openBatch(BatchId){
      if(!await confirmLeave())return;const data=await api('stockBatchForCount',{BatchId});batch=data.batch;dirty=false;$('scDetail').hidden=true;$('scReviewForm').reset();$('scCountForm').reset();$('scCountForm').hidden=false;$('scBatchSummary').innerHTML=batchSummary(batch);
      $('scCountForm').elements.CountedAt.value=new Date(Date.now()+3600000).toISOString().slice(0,19);permissions();status('Current batch loaded. Enter the physical quantities.');$('scCountForm').scrollIntoView({block:'start'});
    }
    async function openCount(CountId,refresh=false){
      if(!await confirmLeave())return;detail=await cached('stockCountDetails',{CountId},refresh);dirty=false;batch=null;$('scCountForm').hidden=true;$('scCountForm').reset();const r=detail.count;$('scDetail').hidden=false;$('scReviewForm').reset();$('scHistoryRows').replaceChildren();historyCursor=null;$('scHistoryNext').hidden=true;
      $('scCountSummary').innerHTML=`${badge(r.Status)}<p><strong>${esc(r.Reference)}</strong> · ${esc(r.Medicine)} ${esc(r.Strength)}<br>Batch ${esc(r.BatchNumber)} · expiry ${esc(r.ExpiryDate)}</p><table><thead><tr><th>Stock</th><th>Before count</th><th>Physical count</th><th>Difference</th></tr></thead><tbody>${['OnHand','Quarantined'].map(k=>`<tr><td>${k==='OnHand'?'Shelf':'Quarantined'} (${esc(r.Unit)})</td><td>${r.Before[k]}</td><td>${r.Counted[k]}</td><td>${r.Difference[k]}</td></tr>`).join('')}</tbody></table><p>Counted by ${esc(r.CountedByName)} · ${esc(date(r.CountedAt))} WAT</p><p>${esc(r.Reason)}</p>${r.DecidedAt?`<p>${esc(r.Status)} by ${esc(r.DecidedByName)} · ${esc(date(r.DecidedAt))} WAT<br>${esc(r.DecisionReason)}</p>`:''}`;
      $('scStale').hidden=!detail.Stale;
      $('scReviewForm').elements.Decision.innerHTML=(detail.CanReview?`${detail.Stale?'':'<option>Approve</option>'}<option>Reject</option>`:'')+(detail.CanCancel?'<option>Cancel</option>':'');permissions();status('Stock count loaded.');
    }
    async function history(next=null,refresh=false){
      if(!detail||!$('scHistoryFilter').reportValidity())return;if(!next){const v=fields($('scHistoryFilter'));historyQuery={CountId:detail.count.CountId,DateRange:{fromDate:v.fromDate,toDate:v.toDate}};}
      const data=await cached('stockCountHistory',{...historyQuery,...(next?{Cursor:next}:{})},refresh);if(!next)$('scHistoryRows').replaceChildren();$('scHistoryRows').insertAdjacentHTML('beforeend',data.events.map(r=>`<article class="clinical-entry"><strong>${esc(r.Action)}</strong><p>${esc(r.ActorName)} · ${esc(date(r.CreatedAt))} WAT</p><p>${esc(r.Reason||'')}</p></article>`).join('')||'<p>No history in this period.</p>');historyCursor=data.next;$('scHistoryNext').hidden=!historyCursor;status('Selected count history loaded.');
    }
    function invalidate(){clearExpiry();cache.clear();countsPage=null;['scExpiryRows','scCountsRows','scHistoryRows'].forEach(id=>$(id).replaceChildren());['scExpiryNext','scExpiryPrevious','scCountsNext','scCountsPrevious','scHistoryNext'].forEach(id=>$(id).hidden=true);$('scExpiryNote').textContent=$('scCountsNote').textContent='Stock count changed. Load the selected period for current records.';}
    $('scCountForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!batch)throw Error('Load the batch first.');const v=fields($('scCountForm'));
      const data=await api('submitStockCount',{BatchId:batch.BatchId,BatchRevision:batch.Revision,...v,CountedAt:new Date((v.CountedAt.length===16?v.CountedAt+':00':v.CountedAt)+'+01:00').toISOString(),Confirmed:$('scCountForm').elements.Confirmed.checked},true);
      dirty=false;batch=null;$('scCountForm').hidden=true;invalidate();await openCount(data.CountId,true);status('Physical count submitted. Stock changes only after independent approval.');
    });};
    $('scReviewForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!detail)throw Error('Open the count first.');const v=fields($('scReviewForm'));await api('reviewStockCount',{CountId:detail.count.CountId,Revision:detail.count.Revision,...v,Confirmed:$('scReviewForm').elements.Confirmed.checked},true);
      dirty=false;invalidate();await openCount(detail.count.CountId,true);status('Stock count decision saved. Original count and movements retained.');
    });};
    ['scCountForm','scReviewForm'].forEach(id=>$(id).addEventListener('input',()=>dirty=true));
    $('scCountClose').onclick=()=>run(async()=>{if(await confirmLeave()){dirty=false;batch=null;$('scCountForm').reset();$('scCountForm').hidden=true;}});
    {
      const prefix='scCounts';
      $(prefix+'Filter').onsubmit=e=>{e.preventDefault();run(()=>loadCounts());};$(prefix+'Refresh').onclick=()=>run(()=>loadCounts(0,true));$(prefix+'Next').onclick=()=>run(()=>loadCounts(1));$(prefix+'Previous').onclick=()=>run(()=>loadCounts(-1));
      $(prefix+'Print').onclick=()=>preview('Physical stock counts',$(prefix+'Rows').innerHTML,$(prefix+'Note').textContent);
    }
    $('scDetailRefresh').onclick=()=>run(()=>detail&&openCount(detail.count.CountId,true));$('scDetailPrint').onclick=()=>detail&&preview('Physical stock count',$('scCountSummary').innerHTML);
    $('scHistoryFilter').onsubmit=e=>{e.preventDefault();run(()=>history());};$('scHistoryRefresh').onclick=()=>run(()=>history(null,true));$('scHistoryNext').onclick=()=>run(()=>history(historyCursor));
    function preview(title,markup,note=''){if(!markup){status('Load the records before previewing.',true);return;}$('scPreviewBody').innerHTML=`<h2>${esc(title)}</h2><p>${esc($('branch').selectedOptions[0]?.textContent)} · Snapshot preview</p><p>${esc(note)}</p>${markup}`;$('scPreviewBody').querySelectorAll('button').forEach(e=>e.remove());$('scPreview').showModal();}
    $('scPreviewClose').onclick=()=>$('scPreview').close();$('scPrint').onclick=()=>{$('cardPrint').classList.add('billing-print');$('cardPrint').innerHTML=$('scPreviewBody').innerHTML;$('scPreview').close();window.print();};
    function clear(){clearExpiry();cache.clear();countsPage=null;batch=detail=historyCursor=historyQuery=null;dirty=false;root.querySelectorAll('form').forEach(f=>f.reset());['scExpiryRows','scCountsRows','scBatchSummary','scCountSummary','scHistoryRows','scPreviewBody'].forEach(id=>$(id).replaceChildren());['scCountForm','scDetail','scExpiryPrevious','scExpiryNext','scCountsPrevious','scCountsNext','scHistoryNext'].forEach(id=>$(id).hidden=true);$('scExpiryNote').textContent='No stock register requested.';$('scCountsNote').textContent='No count history requested.';if($('scPreview').open)$('scPreview').close();}
    return {clear,clearExpiry,permissions,confirmLeave,invalidate};
  }};
})();
