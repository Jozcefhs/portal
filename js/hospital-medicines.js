(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names=['Medicine','Strength','Form','Unit'],date=value=>new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Lagos'});
  const values=form=>Object.fromEntries([...form.elements].filter(el=>el.name&&el.type!=='checkbox').map(el=>[el.name,el.value]));
  window.DynamaxHospitalMedicines={create({api,run,can,writable,status,dirty}){
    $('medicineCatalogue').innerHTML=`<details id="medicineCatalogPanel"><summary>Medicine catalogue</summary>
      <p>Reusable medicine names, strengths, forms and dispensing units for this branch. Prescribers enter the dose and directions for each patient.</p>
      <form id="medicineCatalogFilter" class="toolbar"><label>Medicine name starts with<input id="medicineCatalogQuery" maxlength="120"></label><label class="check-line"><input id="medicineCatalogInactive" type="checkbox">Include inactive medicines</label><button>Load medicines</button><button type="button" id="refreshMedicines">Refresh medicines</button><button type="button" id="newMedicine">New medicine</button></form>
      <p id="medicinePickHint" class="hint"></p><div id="medicineCatalogRows" class="table-wrap"></div><button type="button" id="nextMedicines" hidden>Next medicines</button>
      <form id="medicineItemForm" hidden><h3 id="medicineItemTitle">Medicine</h3><p class="hint">The code, name, strength, form and unit stay fixed after creation. Use a separate item for a different medicine identity.</p><div class="form-grid"><label>Permanent code<input name="Code" required maxlength="40"></label>${names.map(name=>`<label>${name==='Unit'?'Dispensing unit (tablet, bottle, mL…)':name}<input name="${name}" required maxlength="160"></label>`).join('')}<label>Handling / storage notes<textarea name="HandlingNotes" maxlength="2000" rows="3"></textarea></label><label>Reason for change<textarea name="Reason" maxlength="1000" rows="2"></textarea></label></div><label class="check-line"><input name="Active" type="checkbox" checked>Available for new use</label><button>Save medicine</button><button id="closeMedicine" type="button">Close editor</button>
      <section id="medicineHistoryPanel" hidden><h4>Saved medicine versions</h4><div class="toolbar"><label>From<input type="date" id="medicineHistoryFrom"></label><label>To<input type="date" id="medicineHistoryTo"></label><button type="button" id="loadMedicineHistory">Load saved versions</button><button type="button" id="nextMedicineHistory" hidden>Next versions</button></div><div id="medicineHistoryRows"></div></section></form></details>`;
    let rows=[],cursor=null,query=null,editor=null,target=null,historyCursor=null,historyRange=null;
    const cache=new Map(),selected=new Map(),targets={issueOrderForm:'this prescription',receiveStockForm:'this stock receipt',stockSearchForm:'this batch search'};
    const allowed=()=>can('orders.read')||can('pharmacy.work')||can('pharmacy.configure');
    const editable=()=>writable('pharmacy.work')||writable('pharmacy.configure');
    const remember=(key,value)=>{cache.delete(key);cache.set(key,value);while(cache.size>20)cache.delete(cache.keys().next().value);return value;};
    function permissions(){
      $('medicineCatalogue').hidden=!allowed();$('newMedicine').hidden=!editable();
      $('medicineItemForm').querySelector('button:not([type=button])').disabled=!editable();
      $('medicineItemForm').elements.Active.disabled=!editable();
      for(const name of ['HandlingNotes','Reason'])$('medicineItemForm').elements[name].readOnly=!editable();
    }
    function resetSelection(formId){
      selected.delete(formId);for(const name of names)$(formId).elements[name].readOnly=false;
      const label=$(`${formId}MedicineChoice`);if(label)label.textContent='Manual medicine entry.';
      if(target===formId){target=null;$('medicinePickHint').textContent='';draw();}
    }
    function selection(formId){const item=selected.get(formId);return item?{MedicineCatalogId:item.CatalogId,MedicineCatalogRevision:item.Revision}:{};}
    function draw(){
      $('medicineCatalogRows').innerHTML=`<table><thead><tr><th>Code</th><th>Medicine</th><th>Strength / form / unit</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map((row,i)=>`<tr><td>${esc(row.Code)}</td><td>${esc(row.Medicine)}<small>${esc(row.HandlingNotes)}</small></td><td>${esc(row.Strength)} · ${esc(row.Form)} · ${esc(row.Unit)}</td><td>${row.Active?'Available':'Inactive'}</td><td><button type="button" data-medicine-edit="${i}">${editable()?'Edit / history':'View / history'}</button>${target&&row.Active?`<button type="button" data-medicine-use="${i}">Use for ${esc(targets[target])}</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5">No medicines match these filters.</td></tr>'}</tbody></table>`;
      $('nextMedicines').hidden=!cursor;
      $('medicineCatalogRows').querySelectorAll('[data-medicine-edit]').forEach(button=>button.onclick=()=>run(()=>edit(rows[Number(button.dataset.medicineEdit)])));
      $('medicineCatalogRows').querySelectorAll('[data-medicine-use]').forEach(button=>button.onclick=()=>{
        if(!target)return;const form=$(target),item=rows[Number(button.dataset.medicineUse)];
        selected.set(target,{...item});for(const name of names){form.elements[name].value=item[name];form.elements[name].readOnly=true;}
        $(`${target}MedicineChoice`).textContent=`${item.Code} · ${item.Medicine}. ${item.HandlingNotes||''}`;
        if(target!=='stockSearchForm')dirty.add(target);if(target==='issueOrderForm')$('confirmIssue').checked=false;
        form.scrollIntoView({block:'start'});status('Medicine selected. Review the remaining details before saving.');
      });
    }
    async function load(next=null,refresh=false){
      if(!next)query={Query:$('medicineCatalogQuery').value,IncludeInactive:$('medicineCatalogInactive').checked};
      if(refresh)cache.clear();const payload={...query,...(next?{Cursor:next}:{})},key=JSON.stringify(payload),saved=cache.has(key);
      const data=saved?cache.get(key):remember(key,await api('medicineCatalog',payload));
      rows=next?[...rows,...data.items]:data.items;cursor=data.next;draw();
      status(saved?'Loaded medicines restored without another request.':'Medicine catalogue loaded. Refresh to check for changes.');
    }
    async function leave(){return !dirty.has('medicineItemForm')||await window.DynamaxDialogs.confirm({title:'Unsaved medicine changes',message:'Discard these unsaved catalogue changes?',confirmText:'Discard edits'});}
    async function edit(item=null){
      if(!await leave())return;editor=item;const form=$('medicineItemForm');form.reset();dirty.delete(form.id);form.hidden=false;
      for(const name of ['Code',...names,'HandlingNotes']){form.elements[name].value=item?.[name]||'';form.elements[name].readOnly=!!item&&name!=='HandlingNotes'||!editable();}
      form.elements.Active.checked=item?.Active!==false;form.elements.Active.disabled=!editable();form.elements.Reason.readOnly=!editable();
      $('medicineItemTitle').textContent=`${item?(editable()?'Edit':'View'):'New'} medicine`;
      $('medicineHistoryPanel').hidden=!item;$('medicineHistoryRows').replaceChildren();$('nextMedicineHistory').hidden=true;historyCursor=historyRange=null;permissions();
    }
    $('medicineItemForm').addEventListener('input',()=>dirty.add('medicineItemForm'));
    $('medicineCatalogFilter').onsubmit=e=>{e.preventDefault();run(()=>load());};$('refreshMedicines').onclick=()=>run(()=>load(null,true));
    $('nextMedicines').onclick=()=>run(()=>load(cursor));$('newMedicine').onclick=()=>run(()=>edit());
    $('closeMedicine').onclick=()=>run(async()=>{if(!await leave())return;dirty.delete('medicineItemForm');$('medicineItemForm').hidden=true;editor=null;});
    $('medicineItemForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      const form=$('medicineItemForm'),data=values(form),result=await api('saveMedicineCatalogItem',{Item:{...data,Active:form.elements.Active.checked},Reason:data.Reason,...(editor?{CatalogId:editor.CatalogId,Revision:editor.Revision}:{})},true);
      dirty.delete(form.id);if(result.Unchanged){status('No medicine changes to save.');return;}
      cache.clear();rows=[];cursor=null;editor=null;form.hidden=true;$('medicineCatalogRows').textContent='Medicine saved. Load medicines to see the updated catalogue.';$('nextMedicines').hidden=true;
      status('Medicine saved. Earlier versions, prescriptions and stock records are preserved.');
    });};
    async function history(next=null){
      if(!next)historyRange={fromDate:$('medicineHistoryFrom').value,toDate:$('medicineHistoryTo').value};
      const payload={CatalogId:editor.CatalogId,DateRange:historyRange,...(next?{Cursor:next}:{})},key='history:'+JSON.stringify(payload);
      const data=cache.get(key)||remember(key,await api('medicineCatalogHistory',payload));historyCursor=data.next;
      if(!next)$('medicineHistoryRows').replaceChildren();$('medicineHistoryRows').insertAdjacentHTML('beforeend',data.versions.map(row=>`<article class="clinical-entry"><h4>${esc(row.Code)} · ${esc(row.Medicine)} · ${row.Active?'Available':'Inactive'}</h4><p>${esc(date(row.CreatedAt))} · ${esc(row.UpdatedBy)}</p><p>${esc(row.Strength)} · ${esc(row.Form)} · ${esc(row.Unit)}</p><p>${esc(row.HandlingNotes)}</p><p>${esc(row.Reason)}</p></article>`).join('')||'<p>No saved versions in this period.</p>');
      $('nextMedicineHistory').hidden=!historyCursor;status('Saved medicine versions loaded for the selected dates.');
    }
    $('loadMedicineHistory').onclick=()=>run(()=>history());$('nextMedicineHistory').onclick=()=>run(()=>history(historyCursor));
    for(const formId of Object.keys(targets)){
      const form=$(formId),container=formId==='issueOrderForm'?$('prescriptionFields'):form;
      container.insertAdjacentHTML('afterbegin',`<div class="toolbar"><button type="button" id="${formId}ChooseMedicine">Choose medicine from catalogue</button><button type="button" id="${formId}ManualMedicine">Use manual medicine entry</button></div><p class="hint" id="${formId}MedicineChoice">Manual medicine entry.</p>`);
      $(`${formId}ChooseMedicine`).onclick=()=>run(async()=>{target=formId;$('medicineCatalogInactive').checked=false;$('medicineCatalogPanel').open=true;$('medicinePickHint').textContent=`Choose a medicine for ${targets[formId]}.`;await load();$('medicineCatalogPanel').scrollIntoView({block:'start'});});
      $(`${formId}ManualMedicine`).onclick=()=>{resetSelection(formId);if(formId!=='stockSearchForm')dirty.add(formId);if(formId==='issueOrderForm')$('confirmIssue').checked=false;};
    }
    function clear(){cache.clear();rows=[];cursor=query=editor=target=historyCursor=historyRange=null;for(const formId of Object.keys(targets))resetSelection(formId);$('medicineCatalogRows').replaceChildren();$('medicineHistoryRows').replaceChildren();$('medicinePickHint').textContent='';$('medicineItemForm').hidden=$('nextMedicines').hidden=$('nextMedicineHistory').hidden=true;}
    function selectTask(task){if(task==='pharmacy'&&can('pharmacy.configure')&&!can('pharmacy.work'))$('medicineCatalogPanel').open=true;}
    return {permissions,clear,selection,resetSelection,selectTask};
  }};
})();
