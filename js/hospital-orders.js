(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=form=>Object.fromEntries([...form.elements].filter(el=>el.name&&el.type!=='checkbox').map(el=>[el.name,el.value]));
  const input=(name,label,attributes='')=>`<label>${label}<input name="${name}" ${attributes}></label>`;
  const area=(name,label,required=false,max=2000)=>`<label>${label}<textarea name="${name}" rows="3" maxlength="${max}" ${required?'required':''}></textarea></label>`;
  const medicine=()=>['Medicine','Strength','Form','Unit'].map(name=>input(name,name==='Unit'?'Dispensing unit (tablet, bottle, mL…)':name,'required maxlength="160"')).join('');
  const dates=prefix=>`<label>From<input id="${prefix}From" type="date" required></label><label>To<input id="${prefix}To" type="date" required></label>`;
  const date=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):'—';
  const pairs=object=>`<dl>${Object.entries(object||{}).filter(([key])=>!['MedicineKey','Kind'].includes(key)).map(([key,value])=>`<dt>${esc(key.replace(/([a-z])([A-Z])/g,'$1 $2'))}</dt><dd>${esc(value||'Not recorded')}</dd>`).join('')}</dl>`;
  const quantity=()=>input('Quantity','Quantity','type="number" min="0.001" step="0.001" max="1000000" required');
  window.DynamaxHospitalOrders={create({api,run,can,writable,status,navigate}){
    $('orders').innerHTML=`<h2>Prescriptions, pharmacy and investigations</h2><p>Choose dates and an order type before loading. New orders start from a patient’s reception visit.</p>
      <form id="ordersFilter" class="toolbar">${dates('orders')}<label>Order type<select id="ordersKind"></select></label><button>Load orders</button></form>
      <div id="ordersRows" class="table-wrap"></div><button id="nextOrders" type="button" hidden>Next orders</button>
      <section id="issueOrderPanel" hidden><h3>Issue an order</h3><div id="issueIdentity" class="care-identity"></div><p id="issueAllergies" class="care-allergies"></p>
        <form id="issueOrderForm"><label>Order type<select id="issueKind"><option>Prescription</option><option>Laboratory</option><option>Imaging</option></select></label>
          <fieldset id="prescriptionFields"><legend>Prescribed medicine</legend><div class="form-grid">${medicine()}${['Dose','Route','Frequency','Duration'].map(name=>input(name,name,'required maxlength="200"')).join('')}${quantity()}${area('Instructions','Instructions')}</div></fieldset>
          <fieldset id="investigationFields" hidden disabled><legend>Investigation request</legend><div class="form-grid">${input('Service','Test or investigation','required maxlength="200"')}${input('Specimen','Required specimen (laboratory)','maxlength="200"')}<label>Priority<select name="Priority"><option>Routine</option><option>Urgent</option></select></label>${area('Indication','Clinical indication',true)}</div></fieldset>
          <label class="check-line"><input id="confirmIssue" type="checkbox" required>I checked the patient, allergies and order instructions.</label><button>Sign and issue order</button><button type="button" id="closeIssue" class="secondary">Close</button>
        </form></section>
      <section id="orderPanel" hidden><div id="orderIdentity" class="care-identity"></div><p id="orderAllergies" class="care-allergies"></p>
        <div class="toolbar"><button id="refreshOrder" type="button">Refresh order</button><button id="closeOrder" type="button" class="secondary">Close order</button><button id="printSpecimen" type="button">Print specimen label</button></div>
        <p id="orderFreshness" class="hint"></p><article id="orderInstructions" class="clinical-entry"></article><div id="releasedReport"></div><div id="draftReport"></div>
        <label class="check-line"><input id="confirmOrder" type="checkbox">I checked the patient identity and reviewed this order, current allergies and any displayed report.</label>
        <details id="reviewRx"><summary>Pharmacist review</summary><form id="reviewRxForm"><label>Decision<select name="Decision"><option>Approved</option><option>On hold</option></select></label>${area('Reason','Review findings / reason',true)}<button>Save pharmacy review</button></form></details>
        <details id="dispenseRx"><summary>Dispense prescribed medicine</summary><button id="matchingStock" type="button">Load matching batches</button><button id="nextMatchingStock" type="button" hidden>More matching batches</button><p class="hint">Match medicine, strength, form and dispensing unit. Quantities are checked again when saved.</p>
          <form id="dispenseRxForm"><label>Available batch<select id="dispenseBatch" required></select></label>${quantity()}<button>Record dispensing</button></form><p>Dispensing prepares a billing charge. It does not record payment or medicine administration.</p></details>
        <details id="returnRx"><summary>Dispensing history and returns</summary><form id="dispensingFilter" class="toolbar">${dates('dispensing')}<button>Load dispensing entries</button></form><div id="dispensingRows" class="table-wrap"></div><button id="nextDispenses" type="button" hidden>Next dispensing entries</button>
          <form id="returnRxForm"><label>Dispensing entry<select id="returnDispense" required></select></label>${quantity()}${area('Reason','Reason for return',true)}<button>Record return to quarantine</button></form><p>Returned medicines are quarantined. They do not replenish usable stock or reopen the prescription.</p></details>
        <details id="specimenWork"><summary>Specimen handling</summary><form id="specimenForm">${input('SpecimenLabel','Specimen label reference','required maxlength="40"')}<label>Decision<select name="Decision"><option>Collected</option><option>Rejected</option></select></label>${area('Note','Collection or rejection details',true)}<button>Record specimen</button></form></details>
        <details id="reportWork"><summary>Enter or correct investigation report</summary><form id="reportForm">${area('Text','Findings, results, units and applicable reference ranges',true,12000)}${area('Reason','Reason for correcting an earlier report')}<label class="check-line"><input name="Critical" type="checkbox">Critical result requiring clinician acknowledgement</label><button>Save report for verification</button></form></details>
        <div id="verifyWork" class="toolbar"><button id="verifyReport" type="button">Verify latest report</button><span class="hint">A second authorised officer verifies the report.</span></div>
        <details id="releaseWork"><summary>Release verified report</summary><form id="releaseForm">${area('Communication','For a critical result: who was contacted, how and when')}<button>Release verified report</button></form></details>
        <details id="ackWork"><summary>Acknowledge critical result</summary><button id="loadCriticalAlerts" type="button">Load pending critical results</button><div id="criticalAlerts"></div><button id="nextCriticalAlerts" type="button" hidden>Next pending results</button><form id="ackForm"><label>Released critical report<select id="criticalReport" required></select></label>${area('Note','Acknowledgement and follow-up recorded',true)}<button>Acknowledge released result</button></form></details>
        <details id="cancelWork"><summary>Cancel unfulfilled order or remaining quantity</summary><form id="cancelOrderForm">${area('Reason','Reason for cancellation',true)}<button>Cancel remaining order</button></form></details>
        <details><summary>Order history</summary><form id="orderHistoryFilter" class="toolbar">${dates('orderHistory')}<button>Load history</button></form><div id="orderHistoryRows"></div><button id="nextOrderHistory" type="button" hidden>Next history entries</button>
          <button id="loadReleasedHistory" type="button">Load released reports for these dates</button><div id="releasedHistoryRows"></div><button id="nextReleasedHistory" type="button" hidden>Next released reports</button></details>
      </section>
      <section id="stockWorkspace" hidden><h3>Pharmacy inventory</h3><details><summary>Receive a medicine batch</summary><form id="receiveStockForm"><div class="form-grid">${medicine()}${input('BatchNumber','Manufacturer batch number','required maxlength="120"')}${input('ExpiryDate','Expiry date','type="date" required')}${quantity()}${input('UnitPrice','Selling price per dispensing unit (₦)','type="number" min="0" step="0.01" required')}${input('Supplier','Supplier','required maxlength="160"')}${input('ReceiptReference','Supplier invoice / receipt reference','required maxlength="160"')}${input('LineReference','Invoice line reference','required maxlength="60"')}</div><button>Receive batch</button></form></details>
        <details><summary>Find medicine batches and stock movements</summary><form id="stockSearchForm"><div class="form-grid">${medicine()}</div><button>Find matching batches</button></form><div id="stockRows" class="table-wrap"></div><button id="nextStock" type="button" hidden>Next batches</button>
          <form id="stockHistoryFilter" class="toolbar"><label>Batch<select id="stockHistoryBatch" required></select></label>${dates('stockHistory')}<button>Load stock movements</button></form><div id="stockHistoryRows"></div><button id="nextStockHistory" type="button" hidden>Next movements</button>
          <form id="quarantineStockForm"><h4>Quarantine stock from the selected batch</h4>${quantity()}${area('Reason','Reason (for example, recall, damage or receipt correction)',true)}<button>Move stock to quarantine</button></form></details>
      </section>`;
    let issue=null,current=null,scope=null,rows=[],orderCursor=null,orderRange=null,orderKind=null,batches=[],stockCursor=null,stockQuery=null,dispenses=[],dispenseCursor=null,dispenseRange=null,historyCursor=null,historyRange=null,stockHistoryCursor=null,stockHistoryQuery=null;
    let alerts=[],alertCursor=null,releasedCursor=null,releasedRange=null;
    const dirty=new Set(),editForms=['issueOrderForm','reviewRxForm','dispenseRxForm','returnRxForm','specimenForm','reportForm','releaseForm','ackForm','cancelOrderForm','receiveStockForm','quarantineStockForm'];
    editForms.forEach(id=>$(id).addEventListener('input',()=>{dirty.add(id);if(id==='reportForm')$('confirmOrder').checked=false;permissions();}));
    window.addEventListener('beforeunload',event=>{if(dirty.size){event.preventDefault();event.returnValue='';}});
    async function confirmLeave(except='',includeStock=true){
      if(![...dirty].some(id=>id!==except&&(includeStock||!['receiveStockForm','quarantineStockForm'].includes(id))))return true;
      return window.DynamaxDialogs.confirm({title:'Unsaved hospital entries',message:'Discard the unsaved entries before continuing?',confirmText:'Discard edits'});
    }
    const kinds=()=>['Prescription','Laboratory','Imaging'].filter(kind=>can('orders.read')||can(kind==='Prescription'?'pharmacy.work':kind==='Laboratory'?'laboratory.work':'imaging.work'));
    function permissions(){
      const available=kinds(),previous=$('ordersKind').value;$('ordersKind').innerHTML=available.map(kind=>`<option>${kind}</option>`).join('');if(available.includes(previous))$('ordersKind').value=previous;
      document.querySelector('[data-tab=orders]').hidden=!available.length;$('stockWorkspace').hidden=!can('pharmacy.work');
      $('receiveStockForm').querySelectorAll('input,button').forEach(el=>el.disabled=!writable('pharmacy.work'));
      $('quarantineStockForm').querySelectorAll('input,textarea,button').forEach(el=>el.disabled=!writable('pharmacy.work'));
      const o=current?.order,rx=o?.Kind==='Prescription',worker=o&&writable(o.Kind==='Laboratory'?'laboratory.work':o.Kind==='Imaging'?'imaging.work':'pharmacy.work');
      const active=o&&o.Status!=='Cancelled';
      const visible={reviewRx:rx&&worker&&active&&o.Status!=='Dispensed',dispenseRx:rx&&worker&&['Ready to dispense','Partially dispensed'].includes(o.Status),returnRx:rx&&can('pharmacy.work'),
        specimenWork:o?.Kind==='Laboratory'&&worker&&['Requested','Specimen collected','Specimen rejected'].includes(o.Status),reportWork:!rx&&worker&&active,
        verifyWork:!rx&&worker&&o?.Status==='Result draft',releaseWork:!rx&&worker&&o?.Status==='Verified',ackWork:writable('orders.create')&&o?.CriticalNeedsAcknowledgement,
        cancelWork:writable('orders.create')&&current?.canCancel&&active&&!o.ReleasedReportId&&o.Status!=='Dispensed'};
      for(const [id,show] of Object.entries(visible))$(id).hidden=!show;
      $('verifyReport').disabled=!current?.canVerify||dirty.has('reportForm');
      $('returnRxForm').querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=!writable('pharmacy.work'));
      $('printSpecimen').hidden=o?.Kind!=='Laboratory';
      $('loadReleasedHistory').hidden=!o||rx;
      if(issue)$('issueOrderForm').querySelector('button').disabled=!writable('orders.create');
    }
    function clear(){
      issue=current=scope=null;rows=[];batches=[];dispenses=[];alerts=[];releasedCursor=releasedRange=alertCursor=orderCursor=orderRange=orderKind=stockCursor=stockQuery=dispenseCursor=dispenseRange=historyCursor=historyRange=stockHistoryCursor=stockHistoryQuery=null;dirty.clear();
      $('releasedHistoryRows').replaceChildren();$('nextReleasedHistory').hidden=true;
      $('orders').querySelectorAll('form').forEach(form=>form.reset());
      ['ordersRows','issueIdentity','issueAllergies','orderIdentity','orderAllergies','orderFreshness','orderInstructions','releasedReport','draftReport','dispensingRows','orderHistoryRows','stockRows','stockHistoryRows','dispenseBatch','returnDispense','stockHistoryBatch','criticalAlerts','criticalReport'].forEach(id=>$(id).replaceChildren());
      ['issueOrderPanel','orderPanel','nextOrders','nextStock','nextMatchingStock','nextDispenses','nextOrderHistory','nextStockHistory'].forEach(id=>$(id).hidden=true);
      $('confirmOrder').checked=$('confirmIssue').checked=false;issueKind();
    }
    function issueKind(){const rx=$('issueKind').value==='Prescription';$('prescriptionFields').hidden=$('prescriptionFields').disabled=!rx;$('investigationFields').hidden=$('investigationFields').disabled=rx;$('issueOrderForm').elements.Specimen.required=$('issueKind').value==='Laboratory';}
    $('issueKind').onchange=issueKind;
    async function openVisit(visit){
      if(!await confirmLeave('',false))return;
      clearOrder();issue=await api('orderVisitContext',{PatientId:visit.PatientId,VisitId:visit.VisitId});
      $('issueOrderForm').reset();dirty.delete('issueOrderForm');issueKind();$('issueOrderPanel').hidden=false;
      $('issueIdentity').textContent=`${issue.patient.DisplayName} · ${issue.patient.HospitalNumber} · DOB ${issue.patient.DateOfBirth||'Not recorded'}`;
      $('issueAllergies').textContent=`Allergies: ${issue.care.AllergyStatus} ${issue.care.Allergies||''}`;navigate('orders');status('Prescribing context loaded. Review the patient and current allergies.');
    }
    function clearOrder(){
      current=scope=null;dispenses=[];alerts=[];releasedCursor=releasedRange=alertCursor=dispenseCursor=historyCursor=null;
      $('releasedHistoryRows').replaceChildren();$('nextReleasedHistory').hidden=true;
      $('orderPanel').querySelectorAll('form').forEach(form=>{form.reset();dirty.delete(form.id);});
      ['orderIdentity','orderAllergies','orderInstructions','draftReport','releasedReport','dispensingRows','returnDispense','orderHistoryRows','dispenseBatch','criticalAlerts','criticalReport'].forEach(id=>$(id).replaceChildren());
      $('nextCriticalAlerts').hidden=$('nextMatchingStock').hidden=true;
      $('orderPanel').hidden=true;$('confirmOrder').checked=false;
    }
    const version=()=>({...scope,Revision:current.order.Revision,CareRevision:current.care.Revision,ConfirmPatient:$('confirmOrder').checked});
    function requireConfirm(){if(!$('confirmOrder').checked)throw Error('Confirm the patient and displayed information before continuing.');}
    const reportHtml=(row,title)=>row?`<article class="clinical-entry"><h3>${esc(title)}${row.Critical?' · Critical result':''}</h3><p>${esc(row.ActorName)} · ${esc(date(row.CreatedAt))} WAT</p><p class="record-text">${esc(row.Text)}</p>${row.Reason?`<p>Correction: ${esc(row.Reason)}</p>`:''}</article>`:'';
    async function loadOrder(nextScope=scope){
      const data=await api('orderDetails',nextScope);clearOrder();current=data;scope={OrderId:data.order.OrderId,PatientId:data.patient.PatientId};
      const o=data.order;$('orderPanel').hidden=false;
      // Keep the loaded list in step with this fresh record without another query.
      const index=rows.findIndex(row=>row.OrderId===o.OrderId);
      if(index>=0){Object.assign(rows[index],{Status:o.Status,CriticalNeedsAcknowledgement:o.CriticalNeedsAcknowledgement});
        const cell=$('ordersRows').querySelector(`[data-open-order="${index}"]`)?.closest('tr')?.children[3];
        if(cell)cell.innerHTML=`${esc(o.Status)}${o.CriticalNeedsAcknowledgement?'<strong> · Critical acknowledgement due</strong>':''}`;
      }
      $('orderIdentity').textContent=`${data.patient.DisplayName} · ${data.patient.HospitalNumber} · DOB ${data.patient.DateOfBirth||'Not recorded'} · ${o.OrderNumber} · ${o.Status}`;
      $('orderAllergies').textContent=`Current allergies: ${data.care.AllergyStatus} ${data.care.Allergies||''}`;
      $('orderInstructions').innerHTML=`<h3>${esc(o.Kind)} · ${esc(o.PrescriberName)}</h3>${pairs(o.Fields)}${o.Kind==='Prescription'?`<p>Dispensed: ${o.DispensedQuantity} · Returned: ${o.ReturnedQuantity}</p><p>Pharmacy review: ${esc(o.PharmacyReview||'Pending')} · ${esc(o.ReviewReason||'')}</p>`:''}${o.CancelReason?`<p>Cancelled: ${esc(o.CancelReason)}</p>`:''}`;
      $('releasedReport').innerHTML=reportHtml(data.releasedReport,'Released report')+(o.CriticalNeedsAcknowledgement?'<p class="care-amendment-note">Critical result awaits clinician acknowledgement.</p>':'');
      $('draftReport').innerHTML=data.latestReport?.ReportId!==o.ReleasedReportId?reportHtml(data.latestReport,o.Status==='Verified'?'Verified — awaiting release':'Draft — not released'):'';
      if(data.latestReport){$('reportForm').elements.Text.value=data.latestReport.Text;$('reportForm').elements.Critical.checked=data.latestReport.Critical;}
      $('orderFreshness').textContent=`Loaded ${date(new Date().toISOString())} WAT. Refresh to see another officer’s changes.`;
      $('nextDispenses').hidden=$('nextOrderHistory').hidden=true;permissions();
    }
    async function openOrder(order){if(!await confirmLeave('',false))return;$('issueOrderPanel').hidden=true;issue=null;dirty.delete('issueOrderForm');await loadOrder(order);navigate('orders');status('Order loaded.');}
    $('issueOrderForm').onsubmit=event=>{event.preventDefault();run(async()=>{
      if(!await confirmLeave('issueOrderForm',false))return;
      const data=fields($('issueOrderForm')),saved=await api('createOrder',{PatientId:issue.patient.PatientId,VisitId:issue.visit.VisitId,VisitRevision:issue.visit.Revision,CareRevision:issue.care.Revision,
        Kind:$('issueKind').value,Prescription:data,Investigation:data,ConfirmPatient:$('confirmIssue').checked},true);
      dirty.delete('issueOrderForm');$('issueOrderForm').reset();$('issueOrderPanel').hidden=true;issue=null;await loadOrder(saved);status('Order signed and issued.');
    });};
    $('closeIssue').onclick=()=>run(async()=>{if(!await confirmLeave('',false))return;$('issueOrderForm').reset();dirty.delete('issueOrderForm');issue=null;$('issueOrderPanel').hidden=true;});
    $('refreshOrder').onclick=()=>run(async()=>{if(!await confirmLeave('',false))return;await loadOrder();status('Order refreshed.');});
    $('closeOrder').onclick=()=>run(async()=>{if(await confirmLeave('',false))clearOrder();});
    async function listOrders(next=null){
      if(!next){orderRange={fromDate:$('ordersFrom').value,toDate:$('ordersTo').value};orderKind=$('ordersKind').value;}
      const data=await api('listOrders',{Kind:orderKind,DateRange:orderRange,...(next?{Cursor:next}:{})});rows=data.orders;orderCursor=data.next;
      $('ordersRows').innerHTML=`<table><thead><tr><th>Patient</th><th>Order</th><th>Service / medicine</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((o,i)=>`<tr><td>${esc(o.PatientName)}<br>${esc(o.HospitalNumber)}</td><td>${esc(o.OrderNumber)}<br>${esc(date(o.CreatedAt))}</td><td>${esc(o.Service)}</td><td>${esc(o.Status)}${o.CriticalNeedsAcknowledgement?'<strong> · Critical acknowledgement due</strong>':''}</td><td><button type="button" data-open-order="${i}">Open order</button></td></tr>`).join('')||'<tr><td colspan="5">No orders in this period.</td></tr>'}</tbody></table>`;
      $('ordersRows').querySelectorAll('[data-open-order]').forEach(button=>button.onclick=()=>run(()=>openOrder(rows[Number(button.dataset.openOrder)])));
      $('nextOrders').hidden=!orderCursor;status('Selected order period loaded. Loaded rows remain available while switching tasks.');
    }
    $('ordersFilter').onsubmit=event=>{event.preventDefault();run(()=>listOrders());};$('nextOrders').onclick=()=>run(()=>listOrders(orderCursor));
    function bind(formId,action,payload,message,confirm=true){$(formId).onsubmit=event=>{event.preventDefault();run(async()=>{
      if(confirm)requireConfirm();if(!await confirmLeave(formId,false))return;
      const saved=await api(action,{...version(),...payload()},true);dirty.delete(formId);
      if(saved.Unchanged){status('No changes to save.');return;}
      if(['dispensePrescription','returnDispensedMedicine'].includes(action)){batches=[];$('stockRows').textContent='Stock changed. Reload matching batches for current balances.';$('stockHistoryBatch').replaceChildren();$('nextStock').hidden=true;}
      await loadOrder();status(message);
    });};}
    bind('reviewRxForm','reviewPrescription',()=>fields($('reviewRxForm')),'Pharmacy review recorded.');
    bind('dispenseRxForm','dispensePrescription',()=>{const batch=batches.find(row=>row.BatchId===$('dispenseBatch').value);if(!batch)throw Error('Load and select a matching batch.');return {...fields($('dispenseRxForm')),BatchId:batch.BatchId,BatchRevision:batch.Revision};},'Dispensing recorded. Stock and billing charge updated.');
    bind('returnRxForm','returnDispensedMedicine',()=>{const row=dispenses.find(r=>r.DispenseId===$('returnDispense').value);if(!row)throw Error('Load and select the original dispensing entry.');return {...fields($('returnRxForm')),DispenseId:row.DispenseId,DispenseRevision:row.Revision};},'Return recorded in quarantine. Original dispensing preserved.');
    bind('specimenForm','recordSpecimen',()=>fields($('specimenForm')),'Specimen handling recorded.');
    bind('reportForm','recordInvestigationReport',()=>({...fields($('reportForm')),Critical:$('reportForm').elements.Critical.checked}),'Report saved for independent verification.');
    bind('releaseForm','releaseInvestigationReport',()=>({...fields($('releaseForm')),ReportId:current.order.LatestReportId}),'Verified report released.');
    bind('ackForm','acknowledgeCriticalResult',()=>({...fields($('ackForm')),ReportId:$('criticalReport').value}),'Critical result acknowledged.');
    async function loadAlerts(next=null){const data=await api('pendingCriticalAlerts',{...scope,...(next?{Cursor:next}:{})});alerts=next?[...alerts,...data.alerts]:data.alerts;alertCursor=data.next;
      $('criticalAlerts').innerHTML=alerts.map(row=>reportHtml(row.report,`Released critical result · ${date(row.CreatedAt)}`)).join('');
      $('criticalReport').innerHTML=alerts.map(row=>`<option value="${esc(row.ReportId)}">${esc(date(row.CreatedAt))} · ${esc(row.report.ActorName)} · ${esc(row.report.Text.slice(0,80))}</option>`).join('');$('nextCriticalAlerts').hidden=!alertCursor;status('Pending critical results loaded.');}
    $('loadCriticalAlerts').onclick=()=>run(()=>loadAlerts());$('nextCriticalAlerts').onclick=()=>run(()=>loadAlerts(alertCursor));
    bind('cancelOrderForm','cancelOrder',()=>fields($('cancelOrderForm')),'Remaining order cancelled. Records preserved.',false);
    $('verifyReport').onclick=()=>run(async()=>{requireConfirm();if(dirty.has('reportForm'))throw Error('Save the report changes before verification.');if(!await confirmLeave('',false))return;await api('verifyInvestigationReport',{...version(),ReportId:current.order.LatestReportId},true);await loadOrder();status('Report independently verified.');});
    $('printSpecimen').onclick=()=>{const o=current.order,p=current.patient;$('cardPrint').classList.remove('billing-print');$('cardPrint').innerHTML=`<h2>Laboratory specimen</h2><strong>${esc(o.OrderNumber)}</strong><p>${esc(p.DisplayName)} · ${esc(p.HospitalNumber)}</p><p>DOB ${esc(p.DateOfBirth||'Not recorded')}</p><p>${esc(o.Fields.Service)} · ${esc(o.Fields.Specimen)}</p>`;window.print();};
    async function loadStock(query,next=null){
      if(!next){stockQuery=query;batches=[];}
      const data=await api('stockBatches',{...stockQuery,...(next?{Cursor:next}:{})});batches=[...new Map([...batches,...data.batches].map(b=>[b.BatchId,b])).values()];stockCursor=data.next;
      $('dispenseBatch').innerHTML=current?.order.Kind==='Prescription'?batches.filter(b=>b.MedicineKey===current.order.Fields.MedicineKey).map(b=>`<option value="${b.BatchId}" ${b.Expired||b.OnHand<=0?'disabled':''}>${esc(b.BatchNumber)} · ${b.OnHand} ${esc(b.Unit)} · expiry ${esc(b.ExpiryDate)}</option>`).join(''):'';
      $('stockHistoryBatch').innerHTML=batches.map(b=>`<option value="${esc(b.BatchId)}">${esc(b.Medicine)} · ${esc(b.BatchNumber)}</option>`).join('');
      $('stockRows').innerHTML=`<table><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>On hand</th><th>Quarantined</th></tr></thead><tbody>${batches.map(b=>`<tr><td>${esc(b.Medicine)} · ${esc(b.Strength)} · ${esc(b.Form)}</td><td>${esc(b.BatchNumber)}</td><td>${esc(b.ExpiryDate)}${b.Expired?' · Expired':''}</td><td>${b.OnHand} ${esc(b.Unit)}</td><td>${b.Quarantined}</td></tr>`).join('')||'<tr><td colspan="5">No matching batches.</td></tr>'}</tbody></table>`;
      $('nextStock').hidden=!stockCursor;$('nextMatchingStock').hidden=!stockCursor||!batches.some(b=>b.MedicineKey===current?.order.Fields.MedicineKey);status('Matching batches loaded. Stock is checked again when dispensing.');
    }
    $('matchingStock').onclick=()=>run(()=>loadStock({Medicine:current.order.Fields}));
    $('nextMatchingStock').onclick=()=>run(()=>loadStock(stockQuery,stockCursor));
    $('stockSearchForm').onsubmit=event=>{event.preventDefault();run(()=>loadStock({Medicine:fields($('stockSearchForm'))}));};$('nextStock').onclick=()=>run(()=>loadStock(stockQuery,stockCursor));
    $('receiveStockForm').onsubmit=event=>{event.preventDefault();run(async()=>{
      await api('receiveMedicine',{Stock:fields($('receiveStockForm'))},true);dirty.delete('receiveStockForm');$('receiveStockForm').reset();batches=[];$('stockRows').replaceChildren();$('dispenseBatch').replaceChildren();$('stockHistoryBatch').replaceChildren();$('nextStock').hidden=true;status('Medicine batch received. Reload matching batches for current balances.');
    });};
    $('quarantineStockForm').onsubmit=event=>{event.preventDefault();run(async()=>{
      const batch=batches.find(b=>b.BatchId===$('stockHistoryBatch').value);if(!batch)throw Error('Find and select the batch first.');
      await api('quarantineStock',{BatchId:batch.BatchId,Revision:batch.Revision,...fields($('quarantineStockForm'))},true);
      $('quarantineStockForm').reset();dirty.delete('quarantineStockForm');batches=[];$('stockRows').textContent='Stock changed. Reload matching batches for current balances.';$('stockHistoryBatch').replaceChildren();$('dispenseBatch').replaceChildren();$('nextStock').hidden=$('nextMatchingStock').hidden=true;status('Stock moved to quarantine. Original stock movements preserved.');
    });};
    async function dispensing(next=null){
      if(!next){dispenseRange={fromDate:$('dispensingFrom').value,toDate:$('dispensingTo').value};dispenses=[];}
      const data=await api('dispensingHistory',{...scope,DateRange:dispenseRange,...(next?{Cursor:next}:{})});dispenses=[...dispenses,...data.dispenses];dispenseCursor=data.next;
      $('dispensingRows').innerHTML=`<table><thead><tr><th>When</th><th>Officer / batch</th><th>Dispensed</th><th>Returned</th></tr></thead><tbody>${dispenses.map(d=>`<tr><td>${esc(date(d.CreatedAt))}</td><td>${esc(d.ActorName)} · ${esc(d.BatchNumber)}</td><td>${d.Quantity} ${esc(d.Unit)}</td><td>${d.ReturnedQuantity}</td></tr>`).join('')}</tbody></table>`;
      $('returnDispense').innerHTML=dispenses.filter(d=>d.ReturnedQuantity<d.Quantity).map(d=>`<option value="${esc(d.DispenseId)}">${esc(d.BatchNumber)} · ${esc(date(d.CreatedAt))} · ${d.Quantity-d.ReturnedQuantity} returnable</option>`).join('');$('nextDispenses').hidden=!dispenseCursor;status('Dated dispensing entries loaded.');
    }
    $('dispensingFilter').onsubmit=event=>{event.preventDefault();run(()=>dispensing());};$('nextDispenses').onclick=()=>run(()=>dispensing(dispenseCursor));
    const historyRows=(rows,type)=>rows.map(row=>`<article class="clinical-entry"><h3>${esc(row.Action||row.Type)}</h3><p>${esc(row.ActorName)} · ${esc(date(row.CreatedAt))} WAT</p>${pairs(type==='stock'?{Quantity:row.Quantity,Quarantined:row.QuarantinedQuantity||0,Supplier:row.Supplier||'',Receipt:row.ReceiptReference||''}:{Decision:row.Decision||'',Quantity:row.Quantity||'',Reason:row.Reason||row.Note||row.Communication||''})}</article>`).join('')||'<p>No entries in the selected period.</p>';
    async function orderHistory(next=null){if(!next)historyRange={fromDate:$('orderHistoryFrom').value,toDate:$('orderHistoryTo').value};const data=await api('orderHistory',{...scope,DateRange:historyRange,...(next?{Cursor:next}:{})});historyCursor=data.next;if(!next)$('orderHistoryRows').replaceChildren();$('orderHistoryRows').insertAdjacentHTML('beforeend',historyRows(data.events));$('nextOrderHistory').hidden=!historyCursor;status('Dated order history loaded.');}
    $('orderHistoryFilter').onsubmit=event=>{event.preventDefault();run(()=>orderHistory());};$('nextOrderHistory').onclick=()=>run(()=>orderHistory(historyCursor));
    async function releasedHistory(next=null){if(!next)releasedRange={fromDate:$('orderHistoryFrom').value,toDate:$('orderHistoryTo').value};const data=await api('releasedReportHistory',{...scope,DateRange:releasedRange,...(next?{Cursor:next}:{})});releasedCursor=data.next;if(!next)$('releasedHistoryRows').replaceChildren();$('releasedHistoryRows').insertAdjacentHTML('beforeend',data.reports.map(row=>reportHtml(row,`Released ${date(row.ReleasedAt)} · verified by ${row.VerifiedBy}`)).join('')||'<p>No released reports in this period.</p>');$('nextReleasedHistory').hidden=!releasedCursor;status('Released report history loaded. Earlier versions are preserved.');}
    $('loadReleasedHistory').onclick=()=>run(()=>releasedHistory());$('nextReleasedHistory').onclick=()=>run(()=>releasedHistory(releasedCursor));
    async function stockHistory(next=null){if(!next)stockHistoryQuery={BatchId:$('stockHistoryBatch').value,DateRange:{fromDate:$('stockHistoryFrom').value,toDate:$('stockHistoryTo').value}};const data=await api('stockHistory',{...stockHistoryQuery,...(next?{Cursor:next}:{})});stockHistoryCursor=data.next;if(!next)$('stockHistoryRows').replaceChildren();$('stockHistoryRows').insertAdjacentHTML('beforeend',historyRows(data.movements,'stock'));$('nextStockHistory').hidden=!stockHistoryCursor;status('Dated stock movements loaded.');}
    $('stockHistoryFilter').onsubmit=event=>{event.preventDefault();run(()=>stockHistory());};$('nextStockHistory').onclick=()=>run(()=>stockHistory(stockHistoryCursor));
    function selectTask(task){const kind={pharmacy:'Prescription',laboratory:'Laboratory',imaging:'Imaging'}[task];if(kind&&kinds().includes(kind))$('ordersKind').value=kind;}
    return {openVisit,clear,permissions,confirmLeave,selectTask};
  }};
})();
