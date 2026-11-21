(() => {
  'use strict';
  const el = (tag, text = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  function button(label, handler) {
    const node = el('button',label);
    node.type = 'button';
    node.onclick = handler;
    return node;
  }
  function triageContent(fields) {
    const {Complaint,NursingNotes,Urgency,AllergyStatus,Allergies,ObservedAt,...measurements} = fields;
    const Vitals = Object.fromEntries(Object.entries(measurements).filter(([,v])=>v !== ''));
    return {Complaint,NursingNotes,Urgency,AllergyStatus,Allergies,Vitals,ObservedAt};
  }
  function medicationEditor(scope,entry,{api,run,status},saved){
    const host=el('section'),form=el('form'),intro=el('p'),lots=el('div');
    const selected=new Map();
    let revision,cursor,unit;
    const request={Reference:scope.Reference,OrderId:entry.OrderId};
    const more=button('More dispensed lots',()=>run(()=>load(true)));
    const toggle=button('Record medication given',()=>run(()=>load(false)));
    async function load(append){
      const data=await api('emergencyMedicationSupplies',{...request,...(append?{Cursor:cursor}:{})});
      if(!host.isConnected)return;
      if(append && revision!==data.Revision)throw Error('The wristband changed. Close and reopen the medication form.');
      if(!append){selected.clear();lots.replaceChildren();form.reset();}
      revision=data.Revision;cursor=data.next;
      const rx=data.Prescription;unit=rx.Unit;
      intro.textContent=[data.OrderNumber,rx.Medicine,rx.Strength,rx.Form,rx.Dose,rx.Route,rx.Frequency,rx.Duration,rx.Instructions,
        'Allergies: '+[data.Allergies.Status,data.Allergies.Details].filter(Boolean).join(' - ')].filter(Boolean).join(' / ');
      for(const lot of data.lots){
        if(!lot.Available || selected.has(lot.DispenseId))continue;
        const label=el('label','Batch '+lot.BatchNumber+' / expires '+lot.ExpiryDate+' / available '+lot.Available+' '+rx.Unit);
        const input=el('input');input.type='number';input.min='0';input.step='0.001';input.max=String(lot.Available);
        input.placeholder='Quantity given';label.append(input);lots.append(label);
        selected.set(lot.DispenseId,{lot,input});
      }
      more.hidden=!cursor;form.hidden=false;toggle.hidden=true;
      if(!selected.size)lots.textContent='No unused supply on the loaded page.';
      form.querySelector('[type=submit]').disabled=!selected.size;
    }
    const title=el('h4','Medication given on '+scope.Reference);
    const inputs=el('div');inputs.className='form-grid';lots.className='form-grid';
    inputs.innerHTML='<label>Given at (WAT)<input name="ObservedAt" type="datetime-local" required></label><label>Wristband on patient<input name="ConfirmedReference" required maxlength="40" autocomplete="off"></label><label>Administration note (optional)<textarea name="Note" maxlength="2000"></textarea></label>';
    const sign=el('button','Sign administration');sign.type='submit';
    form.append(title,intro,lots,more,inputs,sign,button('Close medication form',()=>{form.hidden=true;toggle.hidden=false;}));
    form.onsubmit=event=>{
      event.preventDefault();
      run(async()=>{
        const Lots=[...selected.values()].filter(({input})=>Number(input.value)>0).map(({lot,input})=>({
          DispenseId:lot.DispenseId,Revision:lot.Revision,Quantity:input.value
        }));
        if(!Lots.length)throw Error('Enter the quantity given from each lot used.');
        const ConfirmedReference=form.elements.ConfirmedReference.value.trim().toUpperCase();
        if(ConfirmedReference!==scope.Reference)throw Error('The entered wristband does not match the selected prescription.');
        const data={...request,Lots,Revision:revision,ConfirmedReference,
          ObservedAt:form.elements.ObservedAt.value+'+01:00',Note:form.elements.Note.value.trim()};
        const confirm=await window.DynamaxDialogs.confirm({title:'Sign medication administration',
          message:'Record '+Lots.reduce((sum,lot)=>Math.round((sum+Number(lot.Quantity))*1000)/1000,0)+' '+unit+' of '+entry.Content.Service+' for wristband '+ConfirmedReference+'?',
          confirmText:'Sign administration'});
        if(!confirm || !form.isConnected)return;
        const result=await api('signEmergencyMedication',data,true);
        saved(result);status('Medication administration signed for '+scope.Reference+'.');
      });
    };
    form.hidden=true;host.append(toggle,form);return host;
  }
  function correctionEditor(scope,entry,{api,run,status},canSign,onSigned){
    const host=el('section'),form=el('form'),identity=el('p'),lots=el('div');
    const request={...scope,EntryId:entry.OriginalEntryId||entry.EntryId};
    const amounts=new Map();
    let version,cursor,priorTime,inputTime;
    if(!canSign){
      const latest=el('p');
      const show=button('View current signed dose',()=>run(async()=>{
        const data=await api('emergencyMedicationCorrection',request);
        latest.textContent=[data.Content.Medicine,data.Content.Given,'Given at '+new Date(data.Content.ObservedAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'})+' WAT',data.Content.Note,data.Content.Reason].filter(Boolean).join(' / ');
      }));
      host.append(show,latest);return host;
    }
    const toggle=button('Review or correct dose',()=>run(async()=>{
      const data=await api('emergencyMedicationCorrection',request);
      if(!host.isConnected)return;
      form.reset();amounts.clear();lots.replaceChildren();cursor=null;version=data.Version;
      identity.textContent=[scope.Reference,data.HospitalNumber,data.Content.Medicine,data.Content.OrderNumber,'Currently signed: '+data.Content.Given].filter(Boolean).join(' / ');
      for(const lot of data.lots)addLot(lot);
      priorTime=data.Content.ObservedAt;
      inputTime=new Date(Date.parse(priorTime)+3600000).toISOString().slice(0,16);
      form.elements.ObservedAt.value=inputTime;
      form.elements.Note.value=data.Content.Note||'';
      more.textContent='Choose other dispensed lots';more.hidden=false;
      form.hidden=false;toggle.hidden=true;
    }));
    function addLot(lot){
      if(amounts.has(lot.DispenseId))return;
      const label=el('label','Batch '+lot.BatchNumber+' / expiry '+lot.ExpiryDate+' / dispensing '+lot.DispenseId.slice(-8));
      const input=el('input');input.type='number';input.min='0';input.max='1000000';input.step='0.001';
      input.value=String(lot.Quantity||0);input.required=true;
      label.append(input);lots.append(label);amounts.set(lot.DispenseId,input);
    }
    const more=button('Choose other dispensed lots',()=>run(async()=>{
      const data=await api('emergencyMedicationCorrection',{...request,LoadLots:true,...(cursor?{Cursor:cursor}:{})});
      if(!form.isConnected)return;
      for(const lot of data.lots)addLot(lot);
      cursor=data.next;more.hidden=!cursor;more.textContent='More dispensed lots';
    }));
    const inputs=el('div');inputs.className=lots.className='form-grid';
    inputs.innerHTML='<label>Given at (WAT)<input type="datetime-local" name="ObservedAt" required></label><label>Corrected administration note<textarea name="Note" maxlength="2000"></textarea></label><label>Reason for correction<textarea name="Reason" maxlength="2000" required></textarea></label><label>Confirm wristband reference<input name="ConfirmedReference" maxlength="40" required autocomplete="off"></label><label><input type="checkbox" name="ConfirmZero"> I confirm that no dose was given</label>';
    const sign=el('button','Review correction');sign.type='submit';
    form.append(el('h4','Correct signed medication administration'),identity,el('p','Enter the corrected quantity for each lot. Set a lot to zero to remove its usage from this dose.'),lots,more,inputs,sign,
      button('Close correction',()=>{form.hidden=true;toggle.hidden=false;}));
    form.onsubmit=event=>{
      event.preventDefault();run(async()=>{
        const fields=form.elements;
        const Lots=[...amounts].filter(([,input])=>Number(input.value)>0).map(([DispenseId,input])=>({DispenseId,Quantity:input.value}));
        const ConfirmZero=fields.ConfirmZero.checked;
        if((Lots.length===0)!==ConfirmZero)throw Error('Confirm no dose was given only when all quantities are zero.');
        const ConfirmedReference=fields.ConfirmedReference.value.trim().toUpperCase();
        if(ConfirmedReference!==scope.Reference)throw Error('The entered wristband does not match this dose.');
        const data={...request,Version:version,Lots,ConfirmZero,ConfirmedReference,
          Note:fields.Note.value.trim(),Reason:fields.Reason.value.trim(),
          ObservedAt:fields.ObservedAt.value===inputTime?priorTime:fields.ObservedAt.value+'+01:00'};
        const total=Lots.reduce((sum,l)=>Math.round((sum+Number(l.Quantity))*1000)/1000,0);
        const ok=await window.DynamaxDialogs.confirm({title:'Sign medication correction',message:identity.textContent+' / corrected total: '+total+' / reason: '+data.Reason,confirmText:'Sign correction'});
        if(!ok || !form.isConnected)return;
        const result=await api('correctEmergencyMedication',data,true);
        if(result.Unchanged){status('The entered dose matches the current signed version.');return;}
        onSigned(result);status('Medication correction signed for '+scope.Reference+'.');
      });
    };
    form.hidden=true;host.append(toggle,form);return host;
  }
  function attach(host, scope, {api,run,writable,status,issueOrder,openOrder}) {
    const panel = el('section');
    let sequence, cursor;
    const list = el('div');
    const more = button('Next signed entries',()=>run(()=>load(cursor)));
    const refresh = button('Refresh signed entries',()=>run(()=>load(null)));
    const editor = el('div');
    const open = button('Open care for '+scope.Reference,()=>run(async()=>{
      await load(null);
      open.hidden = true;
      panel.hidden = false;
    }));
    panel.hidden = true;
    async function load(after) {
      const data = await api('emergencyCareHistory',{...scope,...(after ? {Cursor:after} : {})});
      sequence = data.sequence;
      cursor = data.next;
      more.hidden = !cursor;
      list.replaceChildren();
      for(const entry of data.entries){
        list.insertAdjacentHTML('beforeend',window.DynamaxHospitalClinical.entryMarkup(entry.Type==='Medication administration'?{...entry,Type:'Medication administration (original)'}:entry));
        if(entry.Type==='Medication administration' || entry.OriginalEntryId){
          list.append(correctionEditor(scope,entry,{api,run,status},writable('nursing.write'),result=>{
            sequence=result.Sequence;more.hidden=true;list.textContent='Correction signed. Refresh signed entries to view the history.';
          }));
        }
        if(!scope.VisitId && entry.Type==='Prescription order' && writable('nursing.write')){
          list.append(medicationEditor(scope,entry,{api,run,status},result=>{
            sequence=result.Sequence;more.hidden=true;
            list.textContent='Dose signed. Refresh signed entries to view the medication record.';
          }));
        }
        if(entry.OrderId && openOrder){
          list.append(button('Open '+entry.Content.OrderNumber,()=>run(()=>openOrder({OrderId:entry.OrderId,PatientId:scope.PatientId||data.arrivalId}))));
        }
      }
      if (!data.entries.length) list.textContent = 'No signed entries for this wristband.';
    }
    function addEditor(type) {
      const section = el('details');
      section.append(el('summary','Record '+type.toLowerCase()));
      let form;
      if (type === 'Triage') {
        form = document.getElementById('triageForm').cloneNode(true);
        form.removeAttribute('id');
        form.reset();
        for (const control of form.elements) control.disabled = false;
        form.querySelector('button').remove();
      } else {
        form = el('form');
        form.innerHTML = '<div class="form-grid"><label>Treatment given<textarea name="Treatment" required maxlength="8000"></textarea></label><label>Response or reassessment<textarea name="Response" maxlength="8000"></textarea></label><label>Given at (WAT)<input type="datetime-local" name="ObservedAt"></label></div>';
      }
      const sign = el('button','Review and sign '+type.toLowerCase());
      sign.type = 'submit';
      form.append(sign);
      form.onsubmit = event => {
        event.preventDefault();
        run(async()=>{
          const fields = Object.fromEntries([...form.elements].filter(e=>e.name).map(e=>[e.name,e.value]));
          fields.ObservedAt = fields.ObservedAt ? fields.ObservedAt+'+01:00' : '';
          const confirmed = await window.DynamaxDialogs.confirm({title:'Sign '+type.toLowerCase(),message:'Confirm the wristband on the patient reads '+scope.Reference+'. This entry will be retained under that reference.',confirmText:'Sign for '+scope.Reference});
          if (!confirmed || !form.isConnected) return;
          const saved = await api('signEmergencyCare',{...scope,Type:type,ConfirmedReference:scope.Reference,Sequence:sequence,
            Content:type === 'Triage' ? triageContent(fields) : fields},true);
          sequence = saved.Sequence;
          form.reset();
          section.open = false;
          more.hidden = true;
          list.textContent = type+' signed. Refresh signed entries to review the wristband history.';
          status(type+' signed for '+scope.Reference+'.');
        });
      };
      section.append(form);
      editor.append(section);
    }
    if (!scope.VisitId) {
      if(writable('orders.create')&&issueOrder) editor.append(button('Issue medication or investigation order',()=>run(()=>issueOrder(scope))));
      if (writable('triage.write')) addEditor('Triage');
      if (writable('consultations.write') || writable('nursing.write')) addEditor('Treatment');
    }
    panel.append(el('h4','Care for wristband '+scope.Reference),editor,list,more,refresh);
    host.append(open,panel);
  }
  window.DynamaxEmergencyCare = {attach};
})();
