(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const values = form => Object.fromEntries([...form.elements].filter(e => e.name && e.type !== 'checkbox').map(e => [e.name,e.value]));
  const at = value => value ? new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}) + ' WAT' : '';
  const input = (name,label,type='text',attrs='') => `<label>${label}<input name="${name}" type="${type}" ${attrs}></label>`;
  const dates = (label='Recorded from') => input('fromDate',label,'date','required') + input('toDate','To','date','required');
  const badge = value => `<span class="stock-state stock-${esc(String(value).toLowerCase())}">${esc(value)}</span>`;
  window.DynamaxHospitalStockDisposal = {create({api,run,can,writable,status}) {
    const $ = id => document.getElementById(id), root = $('stockDisposal');
    root.innerHTML = `<h2>Quarantined stock disposal</h2>
      <p>Record a completed physical disposal of quarantined medicines, with evidence and an independent witness. Quarantined stock decreases only when a different authorised officer approves the witnessed event.</p>
      <section><h3>Pending independent review</h3><p id="sdQueueNote" class="hint">Open this workspace to load up to 30 pending records.</p><div class="toolbar"><button id="sdQueueRefresh" type="button">Refresh pending queue</button><button id="sdQueuePrint" type="button">Preview / print pending</button></div><div id="sdQueueRows" class="table-wrap sd-rows"></div><div class="toolbar"><button id="sdQueuePrevious" type="button" hidden>Previous page</button><button id="sdQueueNext" type="button" hidden>Next page</button></div></section>
      <section><h3>Choose a quarantined batch</h3><p>Choose an expiry period, then select a batch with quarantined stock. Shelf stock cannot be disposed through this form.</p><form id="sdBatchesFilter" class="toolbar">${dates('Expiry from')}<button>Load batches</button><button id="sdBatchesRefresh" type="button">Refresh batches</button></form><p id="sdBatchesNote" class="hint">Choose a batch before recording disposal evidence.</p><div id="sdBatchesRows" class="table-wrap sd-rows"></div><div class="toolbar"><button id="sdBatchesPrevious" type="button" hidden>Previous page</button><button id="sdBatchesNext" type="button" hidden>Next page</button></div></section>
      <form id="sdRecordForm" hidden><h3>Record physical disposal evidence</h3><div id="sdBatchSummary" class="care-identity"></div><div class="form-grid">
        ${input('Reference','Permanent disposal reference','text','required maxlength="120"')}${input('DisposedAt','Physically disposed at (WAT)','datetime-local','required step="1"')}${input('Quantity','Quantity disposed from quarantine','number','required min="0.001" max="1000000" step="0.001"')}${input('Method','Disposal method','text','required maxlength="200"')}
        <label>Reason for disposal<textarea name="Reason" required maxlength="2000"></textarea></label><label>Disposal evidence / certificate reference<textarea name="Evidence" required maxlength="2000"></textarea></label></div>
        <label class="check-line"><input name="Confirmed" type="checkbox" required>I checked this batch and quantity, and this physical disposal has taken place.</label><div class="toolbar"><button data-sd-write="stock.count">Submit for independent review</button><button id="sdRecordClose" type="button" class="secondary">Close record</button></div></form>
      <section id="sdDetail" hidden><h3>Disposal evidence and review</h3><div id="sdSummary"></div><p id="sdStale" class="care-amendment-note" hidden>Stock changed after this disposal was recorded. Approval is blocked. Review the discrepancy and reject or cancel this record before recording fresh evidence.</p><div class="toolbar"><button id="sdDetailRefresh" type="button">Refresh disposal</button><button id="sdDetailPrint" type="button">Preview / print disposal</button></div>
        <div class="toolbar" id="sdDecisions"><button id="sdApprove" type="button" hidden>Approve witnessed disposal</button><button id="sdReject" type="button" class="secondary" hidden>Reject evidence</button><button id="sdCancel" type="button" class="secondary" hidden>Cancel my record</button></div>
        <form id="sdReviewForm" hidden><h3 id="sdDecisionTitle"></h3><input type="hidden" name="Decision"><label>Decision reason<textarea name="Reason" required maxlength="2000"></textarea></label><label id="sdReviewEvidenceLabel">Independent witness evidence / certificate reference<textarea name="Evidence" maxlength="2000"></textarea></label><label id="sdWitnessLabel" class="check-line"><input name="Witnessed" type="checkbox">I independently witnessed this physical disposal of the stated batch and quantity.</label><label class="check-line"><input name="Confirmed" type="checkbox" required>I reviewed the batch, quantity and evidence for this decision.</label><div class="toolbar"><button id="sdSaveDecision">Save decision</button><button id="sdReviewClose" type="button" class="secondary">Close decision</button></div></form>
        <form id="sdEventsFilter" class="toolbar">${dates('Event from')}<button>Load disposal audit history</button><button id="sdEventsRefresh" type="button">Refresh audit history</button></form><div id="sdEventsRows"></div><button id="sdEventsNext" type="button" hidden>Next audit page</button>
      </section>
      <section><h3>Disposal register</h3><p>Choose a period to load completed or pending records. No completed history is loaded automatically.</p><form id="sdRegisterFilter" class="toolbar">${dates()}<label>Status<select name="Status"><option value="">All statuses</option><option>Approved</option><option>Rejected</option><option>Cancelled</option><option>Pending</option></select></label><button>Load disposal register</button><button id="sdRegisterRefresh" type="button">Refresh register</button><button id="sdRegisterPrint" type="button">Preview / print register</button></form><p id="sdRegisterNote" class="hint">No disposal history requested.</p><div id="sdRegisterRows" class="table-wrap sd-rows"></div><div class="toolbar"><button id="sdRegisterPrevious" type="button" hidden>Previous page</button><button id="sdRegisterNext" type="button" hidden>Next page</button></div></section>
      <dialog id="sdPreview" aria-label="Disposal snapshot preview"><div class="toolbar"><button id="sdPrint" type="button">Print</button><button id="sdPreviewClose" type="button" class="secondary">Close preview</button></div><div id="sdPreviewBody"></div></dialog>`;
    let batch = null, detail = null, dirty = false, eventQuery = null, eventCursor = null;
    const cache = new Map(), pages = {};
    const prefixes = {queue:'sdQueue',batches:'sdBatches',register:'sdRegister'};
    async function cached(action,body,refresh=false) {
      const key = JSON.stringify([action,body]);
      if (refresh) cache.delete(key);
      if (cache.has(key)) return cache.get(key);
      const result = await api(action,body);
      cache.set(key,result); while (cache.size > 24) cache.delete(cache.keys().next().value);
      return result;
    }
    async function confirmLeave() {
      return !dirty || await window.DynamaxDialogs.confirm({title:'Unsaved disposal evidence',message:'Discard the unsaved disposal record or review changes?',confirmLabel:'Discard changes',tone:'warning'});
    }
    function permissions() {
      document.querySelector('[data-tab=stockDisposal]').hidden = !can('stock.read');
      root.querySelectorAll('[data-sd-write]').forEach(e => e.hidden = !writable(e.dataset.sdWrite));
      $('sdRecordForm').querySelectorAll('input,textarea,button:not([type=button])').forEach(e => e.disabled = !writable('stock.count'));
      const review = detail?.CanReview && writable('stock.review'), cancel = detail?.CanCancel && writable('stock.count');
      $('sdApprove').hidden = !review || detail.Stale; $('sdReject').hidden = !review; $('sdCancel').hidden = !cancel;
      const decision = $('sdReviewForm').elements.Decision.value;
      if (!decision || !(decision === 'Cancel' ? cancel : review)) $('sdReviewForm').hidden = true;
    }
    function dateRange(form) {
      const v = values(form);
      if (!v.fromDate || !v.toDate || v.fromDate > v.toDate) throw Error('Choose a valid from and to date before loading records.');
      return {fromDate:v.fromDate,toDate:v.toDate};
    }
    function labelCells(container) {
      const headers = [...container.querySelectorAll('th')].map(e => e.textContent);
      container.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td,i) => td.dataset.label = headers[i] || ''));
    }
    function render(kind,data) {
      const prefix = prefixes[kind], p = pages[kind], rows = kind === 'batches' ? data.batches : data.disposals;
      $(prefix+'Note').textContent = `${rows.length} records on page ${p.index+1}. ${kind === 'queue' ? 'Pending independent review; up to 30 per page.' : p.query.DateRange.fromDate+' to '+p.query.DateRange.toDate+(p.query.Status?' · '+p.query.Status:'')+'.'} Refresh checks for newer records.`;
      $(prefix+'Previous').hidden = !p.index; $(prefix+'Next').hidden = !data.next;
      if (kind === 'batches') {
        $(prefix+'Rows').innerHTML = `<table><thead><tr><th>Medicine / strength</th><th>Batch / expiry</th><th>Quarantined</th><th>Action</th></tr></thead><tbody>${rows.map((r,i) => `<tr><td>${esc(r.Medicine)}<br>${esc(r.Strength)} · ${esc(r.Form)}</td><td>${esc(r.BatchNumber)}<br>${esc(r.ExpiryDate)}</td><td>${esc(r.Quarantined)} ${esc(r.Unit)}</td><td>${Number(r.Quarantined)>0 && writable('stock.count') ? `<button type="button" data-sd-batch="${i}">Choose batch</button>` : Number(r.Quarantined)>0 ? 'Read only' : 'No quarantined stock'}</td></tr>`).join('') || '<tr><td colspan="4">No batches in this expiry period. Choose another period to select a batch.</td></tr>'}</tbody></table>`;
        $(prefix+'Rows').querySelectorAll('[data-sd-batch]').forEach(button => button.onclick = () => run(() => openBatch(rows[Number(button.dataset.sdBatch)].BatchId)));
      } else {
        $(prefix+'Rows').innerHTML = `<table><thead><tr><th>Reference / disposal time</th><th>Medicine / batch</th><th>Disposed quantity</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map((r,i) => `<tr><td>${esc(r.Reference)}<br>${esc(at(r.DisposedAt))}</td><td>${esc(r.Medicine)} ${esc(r.Strength)}<br>${esc(r.BatchNumber)}</td><td>${esc(r.Quantity)} ${esc(r.Unit)}</td><td>${badge(r.Status)}</td><td><button type="button" data-sd-disposal="${i}">Open disposal</button></td></tr>`).join('') || `<tr><td colspan="5">${kind==='queue'?'No disposals awaiting review.':'No disposals in this selected period.'}</td></tr>`}</tbody></table>`;
        $(prefix+'Rows').querySelectorAll('[data-sd-disposal]').forEach(button => button.onclick = () => run(() => openDisposal(rows[Number(button.dataset.sdDisposal)].DisposalId)));
      }
      labelCells($(prefix+'Rows'));
    }
    async function load(kind,step=0,refresh=false) {
      const form = $(prefixes[kind]+'Filter');
      const query = kind === 'queue' ? {} : {DateRange:dateRange(form),...(kind==='register'?{Status:form.elements.Status.value}:{})};
      const current = pages[kind], reset = !current || JSON.stringify(current.query)!==JSON.stringify(query) || refresh;
      const p = reset ? {query,stack:[null],index:0} : {...current,stack:[...current.stack]};
      if (step>0 && p.data?.next) {p.stack[p.index+1]=p.data.next;p.index++;} else if (step<0 && p.index) p.index--;
      const action = {queue:'stockDisposalQueue',batches:'stockExpiryRegister',register:'stockDisposalRegister'}[kind];
      if (refresh) for (const key of cache.keys()) {
        const cachedAction=JSON.parse(key)[0];
        if (cachedAction===action || kind!=='batches' && cachedAction==='stockDisposalDetails') cache.delete(key);
      }
      p.data = await cached(action,{...query,...(p.stack[p.index]?{Cursor:p.stack[p.index]}:{})},refresh);
      pages[kind]=p;render(kind,p.data);
      status({queue:'Pending disposal queue loaded.',batches:'Selected batch expiry period loaded. Choose a quarantined batch.',register:'Selected disposal period loaded.'}[kind]);
    }
    async function openBatch(BatchId) {
      if (!await confirmLeave()) return;
      const data = await api('stockBatchForCount',{BatchId});
      if (!(Number(data.batch.Quarantined)>0)) throw Error('This batch has no quarantined stock. Choose another batch.');
      batch=data.batch;detail=null;dirty=false;$('sdRecordForm').reset();$('sdReviewForm').reset();$('sdReviewForm').hidden=true;$('sdDetail').hidden=true;
      $('sdRecordForm').hidden=false;
      $('sdBatchSummary').innerHTML=`<p><strong>${esc(batch.Medicine)} · ${esc(batch.Strength)} · ${esc(batch.Form)}</strong><br>Batch ${esc(batch.BatchNumber)} · expiry ${esc(batch.ExpiryDate)}<br>Quarantined: ${esc(batch.Quarantined)} ${esc(batch.Unit)} · shelf: ${esc(batch.OnHand)} ${esc(batch.Unit)}</p>`;
      $('sdRecordForm').elements.Quantity.max=batch.Quarantined;
      $('sdRecordForm').elements.DisposedAt.value=new Date(Date.now()+3600000).toISOString().slice(0,19);
      permissions();status('Quarantined batch selected. Record the completed physical disposal evidence.');$('sdRecordForm').scrollIntoView({block:'start'});
    }
    async function openDisposal(DisposalId,refresh=false) {
      if (!await confirmLeave()) return;
      const loaded=await cached('stockDisposalDetails',{DisposalId},refresh);
      detail=loaded;batch=null;dirty=false;eventQuery=eventCursor=null;
      $('sdRecordForm').reset();$('sdRecordForm').hidden=true;$('sdReviewForm').reset();$('sdReviewForm').hidden=true;$('sdEventsRows').replaceChildren();$('sdEventsNext').hidden=true;$('sdDetail').hidden=false;
      const r=detail.disposal;
      $('sdSummary').innerHTML=`${badge(r.Status)}<p><strong>${esc(r.Reference)}</strong><br>${esc(r.Medicine)} · ${esc(r.Strength)} · ${esc(r.Form)}<br>Batch ${esc(r.BatchNumber)} · expiry ${esc(r.ExpiryDate)}</p><p><strong>Physically disposed: ${esc(r.Quantity)} ${esc(r.Unit)}</strong><br>Quarantined before: ${esc(r.Before.Quarantined)} ${esc(r.Unit)} · shelf unchanged: ${esc(r.Before.OnHand)} ${esc(r.Unit)}<br>Disposed at ${esc(at(r.DisposedAt))}<br>Method: ${esc(r.Method)}</p><p>Submitted by ${esc(r.SubmittedByName)} · ${esc(at(r.CreatedAt))}</p><h4>Reason</h4><p class="sd-text">${esc(r.Reason)}</p><h4>Disposal evidence</h4><p class="sd-text">${esc(r.Evidence)}</p>${r.DecidedAt?`<h4>${esc(r.Status)} decision</h4><p>${esc(r.DecidedByName)} · ${esc(at(r.DecidedAt))}</p><p class="sd-text">${esc(r.DecisionReason)}</p><p class="sd-text">${esc(r.DecisionEvidence||'')}</p>`:''}`;
      $('sdStale').hidden=!detail.Stale;permissions();status('Disposal evidence loaded.');
    }
    function chooseDecision(decision) {
      if (!detail) return;
      $('sdReviewForm').elements.Decision.value=decision;$('sdReviewForm').hidden=false;
      $('sdDecisionTitle').textContent={Approve:'Approve independently witnessed disposal',Reject:'Reject disposal evidence',Cancel:'Cancel your pending disposal record'}[decision];
      $('sdSaveDecision').textContent={Approve:'Confirm witnessed disposal approval',Reject:'Confirm rejection',Cancel:'Confirm cancellation'}[decision];
      const approve=decision==='Approve';$('sdReviewEvidenceLabel').hidden=$('sdWitnessLabel').hidden=!approve;
      $('sdReviewForm').elements.Evidence.required=$('sdReviewForm').elements.Witnessed.required=approve;
      dirty=true;
    }
    async function events(next=null,refresh=false) {
      if (!detail) throw Error('Open a disposal record first.');
      const query=next?eventQuery:{DisposalId:detail.disposal.DisposalId,DateRange:dateRange($('sdEventsFilter'))};
      const data=await cached('stockDisposalHistory',{...query,...(next?{Cursor:next}:{})},refresh);
      eventQuery=query;eventCursor=data.next;if(!next)$('sdEventsRows').replaceChildren();
      $('sdEventsRows').insertAdjacentHTML('beforeend',data.events.map(r=>`<article class="clinical-entry"><strong>${esc(r.Action)}</strong><p>${esc(r.ActorName)} · ${esc(at(r.CreatedAt))}</p><p class="sd-text">${esc(r.Reason||'')}</p></article>`).join('')||'<p>No audit events in this period.</p>');
      $('sdEventsNext').hidden=!eventCursor;status('Selected disposal audit history loaded.');
    }
    function invalidate() {
      cache.clear();for(const key of Object.keys(pages))delete pages[key];eventQuery=eventCursor=null;
      ['sdQueueRows','sdBatchesRows','sdRegisterRows','sdEventsRows','sdPreviewBody'].forEach(id=>$(id).replaceChildren());
      for(const prefix of Object.values(prefixes)){ $(prefix+'Previous').hidden=$(prefix+'Next').hidden=true;$(prefix+'Note').textContent='Records changed. Refresh to load current records.'; }
      $('sdEventsNext').hidden=true;if($('sdPreview').open)$('sdPreview').close();
    }
    $('sdRecordForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!batch)throw Error('Choose a quarantined batch before recording disposal evidence.');
      const v=values($('sdRecordForm'));
      const result=await api('submitStockDisposal',{...v,BatchId:batch.BatchId,BatchRevision:batch.Revision,DisposedAt:new Date((v.DisposedAt.length===16?v.DisposedAt+':00':v.DisposedAt)+'+01:00').toISOString(),Confirmed:$('sdRecordForm').elements.Confirmed.checked},true);
      dirty=false;batch=null;$('sdRecordForm').reset();$('sdRecordForm').hidden=true;invalidate();await openDisposal(result.DisposalId,true);
      status('Disposal evidence submitted. Quarantined balance changes only after independent witnessed approval.');
    });};
    $('sdReviewForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!detail)throw Error('Open a disposal record before deciding.');
      const v=values($('sdReviewForm')),DisposalId=detail.disposal.DisposalId;
      await api('reviewStockDisposal',{DisposalId,Revision:detail.disposal.Revision,...v,Confirmed:$('sdReviewForm').elements.Confirmed.checked,Witnessed:v.Decision==='Approve'&&$('sdReviewForm').elements.Witnessed.checked},true);
      dirty=false;$('sdReviewForm').reset();$('sdReviewForm').hidden=true;invalidate();await openDisposal(DisposalId,true);
      status('Disposal decision saved. Original evidence and stock movements retained.');
    });};
    ['sdRecordForm','sdReviewForm'].forEach(id=>$(id).addEventListener('input',()=>dirty=true));
    $('sdRecordClose').onclick=()=>run(async()=>{if(await confirmLeave()){dirty=false;batch=null;$('sdRecordForm').reset();$('sdRecordForm').hidden=true;}});
    $('sdReviewClose').onclick=()=>run(async()=>{if(await confirmLeave()){dirty=false;$('sdReviewForm').reset();$('sdReviewForm').hidden=true;}});
    for(const decision of ['Approve','Reject','Cancel'])$('sd'+decision).onclick=()=>chooseDecision(decision);
    for(const [kind,prefix]of Object.entries(prefixes)) {
      if(kind!=='queue')$(prefix+'Filter').onsubmit=e=>{e.preventDefault();run(()=>load(kind));};
      $(prefix+'Refresh').onclick=()=>run(()=>load(kind,0,true));$(prefix+'Previous').onclick=()=>run(()=>load(kind,-1));$(prefix+'Next').onclick=()=>run(()=>load(kind,1));
    }
    $('sdDetailRefresh').onclick=()=>run(()=>detail&&openDisposal(detail.disposal.DisposalId,true));
    $('sdEventsFilter').onsubmit=e=>{e.preventDefault();run(()=>events());};$('sdEventsRefresh').onclick=()=>run(()=>events(null,true));$('sdEventsNext').onclick=()=>run(()=>events(eventCursor));
    function preview(title,markup,note='') {
      if(!markup){status('Load records before previewing.',true);return;}
      $('sdPreviewBody').innerHTML=`<h2>${esc(title)}</h2><p>${esc($('branch').selectedOptions[0]?.textContent)} · Loaded snapshot</p><p>${esc(note)}</p>${markup}`;
      $('sdPreviewBody').querySelectorAll('button').forEach(e=>e.remove());$('sdPreview').showModal();
    }
    $('sdQueuePrint').onclick=()=>preview('Pending quarantine disposals',$('sdQueueRows').innerHTML,$('sdQueueNote').textContent);
    $('sdRegisterPrint').onclick=()=>preview('Quarantine disposal register',$('sdRegisterRows').innerHTML,$('sdRegisterNote').textContent);
    $('sdDetailPrint').onclick=()=>detail&&preview('Quarantined stock disposal',$('sdSummary').innerHTML);
    $('sdPreviewClose').onclick=()=>$('sdPreview').close();$('sdPrint').onclick=()=>{$('cardPrint').classList.add('billing-print');$('cardPrint').innerHTML=$('sdPreviewBody').innerHTML;$('sdPreview').close();window.print();};
    function clear() {
      invalidate();batch=detail=null;dirty=false;root.querySelectorAll('form').forEach(f=>f.reset());
      ['sdBatchSummary','sdSummary'].forEach(id=>$(id).replaceChildren());['sdRecordForm','sdReviewForm','sdDetail'].forEach(id=>$(id).hidden=true);
      $('sdQueueNote').textContent='Open this workspace to load up to 30 pending records.';$('sdBatchesNote').textContent='Choose a batch before recording disposal evidence.';$('sdRegisterNote').textContent='No disposal history requested.';
    }
    return {clear,permissions,confirmLeave,invalidate,open:()=>load('queue')};
  }};
})();
