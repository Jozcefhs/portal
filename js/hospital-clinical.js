(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):'Not recorded';
  const measures={TemperatureC:'Temperature (°C)',PulseBpm:'Pulse (beats/min)',RespirationsPerMinute:'Respiratory rate (breaths/min)',
    SystolicMmHg:'Systolic pressure (mmHg)',DiastolicMmHg:'Diastolic pressure (mmHg)',SpO2Percent:'Oxygen saturation (%)',WeightKg:'Weight (kg)',HeightCm:'Height (cm)'};
  const values=form=>Object.fromEntries([...form.elements].filter(field=>field.name).map(field=>[field.name,field.value]));
  function entryMarkup(row){
    if(!row)return '';
    const fields=Object.entries(row.Content||{}).filter(([key])=>key!=='Vitals').map(([key,value])=>`<dt>${esc(key.replace(/([a-z])([A-Z])/g,'$1 $2'))}</dt><dd>${esc(key==='ObservedAt'?date(value):value||'Not recorded')}</dd>`).join('');
    const vitals=row.Content?.Vitals?`<div class="care-vitals">${Object.entries(measures).map(([key,label])=>`<div><small>${label}</small><strong>${esc(row.Content.Vitals[key]??'Not recorded')}</strong></div>`).join('')}</div>`:'';
    return `<article class="clinical-entry"><h3>${esc(row.Type)} · ${esc(row.AuthorName)}</h3><p class="hint">Signed ${esc(date(row.SignedAt))} WAT${row.Type==='Amendment'?` · Amendment to ${esc(row.TargetType)} entry`:''}</p>${vitals}<dl>${fields}</dl></article>`;
  }
  window.DynamaxHospitalClinical={create({api,run,can,writable,status,navigate}){
    let current=null,scope=null,entries=[],cursor=null,range=null;
    const dirty=new Set();
    async function confirmLeave(except=''){
      if(![...dirty].some(id=>id!==except))return true;
      return window.DynamaxDialogs.confirm({title:'Unsaved clinical entries',message:'There are unsaved entries in this clinical record. Discard those edits and continue?',confirmText:'Discard edits'});
    }
    window.addEventListener('beforeunload',event=>{if(dirty.size){event.preventDefault();event.returnValue='';}});
    ['triageForm','consultationForm','amendmentForm'].forEach(id=>$(id).addEventListener('input',()=>{dirty.add(id);if(id==='consultationForm')$('confirmCareIdentity').checked=false;permissions();}));
    const closed=()=>current&&!['Waiting','In progress'].includes(current.visit.Status);
    const versions=()=>({...scope,VisitRevision:current.visit.Revision,EncounterRevision:current.encounter?.Revision||'',CareRevision:current.care.Revision||'',DraftRevision:current.draft?.Revision||''});
    function permissions(){
      const draftWritable=!!current&&!closed()&&writable('consultations.write')&&current.canEditDraft;
      $('triageEditor').hidden=!current||closed()||!writable('triage.write');
      $('consultationEditor').hidden=!current||!can('consultations.write');
      $('consultationForm').querySelectorAll('textarea,button').forEach(el=>el.disabled=!draftWritable);
      $('confirmCareIdentity').disabled=!draftWritable||!current?.draft;
      $('signConsultation').disabled=!draftWritable||!current?.draft||dirty.has('consultationForm')||!$('confirmCareIdentity').checked;
      const candidates=[...new Map([current?.latestTriage,current?.latestConsultation,...entries].filter(row=>row?.CanAmend).map(row=>[row.EntryId,row])).values()];
      const previous=$('amendEntry').value;
      $('amendEntry').innerHTML=candidates.map(row=>`<option value="${esc(row.EntryId)}">${esc(`${row.Type} · ${row.AuthorName} · ${date(row.SignedAt)}`)}</option>`).join('');
      if(candidates.some(row=>row.EntryId===previous))$('amendEntry').value=previous;
      $('amendmentEditor').hidden=!candidates.length||!(writable('triage.write')||writable('consultations.write'));
    }
    function clear(){
      current=null;scope=null;entries=[];cursor=range=null;dirty.clear();
      ['triageForm','consultationForm','amendmentForm','clinicalHistoryForm'].forEach(id=>$(id).reset());
      ['careName','careIdentity','careVisit','careAllergies','careFreshness','latestClinical','consultationOwner','clinicalEntries','amendEntry'].forEach(id=>$(id).replaceChildren());
      $('confirmCareIdentity').checked=false;$('carePanel').hidden=true;$('careEmpty').hidden=false;$('moreClinical').hidden=true;
    }
    function render(){
      const p=current.patient;$('carePanel').hidden=false;$('careEmpty').hidden=true;
      $('careName').textContent=p.DisplayName;$('careIdentity').textContent=`${p.HospitalNumber} · DOB ${p.DateOfBirth||'Not recorded'} · ${p.Sex}`;
      $('careVisit').textContent=`${current.visit.Department} · Arrived ${date(current.visit.CreatedAt)} WAT · ${current.visit.Status}`;
      $('careAllergies').textContent=`Allergies: ${current.care.AllergyStatus}${current.care.Allergies?` — ${current.care.Allergies}`:''}`;
      $('careAllergies').dataset.status=current.care.AllergyStatus;
      $('careFreshness').textContent=`Loaded ${date(new Date().toISOString())} WAT. Refresh for changes made by another officer.`;
      $('careClosed').hidden=!closed();
      $('latestClinical').innerHTML=`${current.encounter?.AmendmentCount?`<p class="care-amendment-note">${current.encounter.AmendmentCount} amendment(s) recorded. Review the latest amendment below and load dated entries for the full sequence.</p>`:''}${entryMarkup(current.latestTriage)}${entryMarkup(current.latestConsultation)}${entryMarkup(current.latestAmendment)}`;
      $('triageForm').reset();$('triageForm').elements.AllergyStatus.value=current.care.AllergyStatus;$('triageForm').elements.Allergies.value=current.care.Allergies||'';
      $('consultationForm').reset();for(const field of $('consultationForm').elements)if(field.name)field.value=current.draft?.Notes?.[field.name]||'';
      $('consultationOwner').textContent=`${current.draftStatus}${current.draftOwner?` · ${current.draftOwner}`:''}`;
      $('amendmentForm').reset();$('confirmCareIdentity').checked=false;dirty.clear();permissions();
    }
    async function load(){current=await api('clinicalContext',scope);entries=[];cursor=range=null;$('clinicalEntries').replaceChildren();$('moreClinical').hidden=true;render();}
    async function open(visit){if(!await confirmLeave())return;clear();scope={VisitId:visit.VisitId,PatientId:visit.PatientId};await load();navigate('care');status('Clinical encounter loaded. Confirm the patient identity and allergy information.');}
    $('refreshCare').onclick=()=>run(async()=>{
      if(!await confirmLeave())return;
      await load();entries=[];cursor=null;$('clinicalEntries').replaceChildren();$('moreClinical').hidden=true;status('Clinical record refreshed.');
    });
    $('closeCare').onclick=()=>run(async()=>{
      if(!await confirmLeave())return;
      clear();navigate('reception');
    });
    $('triageForm').onsubmit=event=>{event.preventDefault();run(async()=>{
      if(!await confirmLeave('triageForm'))return;
      const fields=values($('triageForm')),Vitals=Object.fromEntries(Object.keys(measures).filter(key=>fields[key]!=='').map(key=>[key,fields[key]]));
      await api('recordTriage',{...versions(),Triage:{Complaint:fields.Complaint,NursingNotes:fields.NursingNotes,Urgency:fields.Urgency,
        AllergyStatus:fields.AllergyStatus,Allergies:fields.Allergies,Vitals,ObservedAt:fields.ObservedAt?`${fields.ObservedAt}+01:00`:''}},true);
      await load();status('Triage recorded. The signed entry is retained.');
    });};
    $('consultationForm').onsubmit=event=>{event.preventDefault();run(async()=>{
      if(!await confirmLeave('consultationForm'))return;
      await api('saveConsultation',{...versions(),Notes:values($('consultationForm'))},true);await load();status('Consultation draft saved. Review it before signing.');
    });};
    $('confirmCareIdentity').onchange=permissions;
    $('signConsultation').onclick=()=>run(async()=>{
      if(dirty.has('consultationForm')||!$('confirmCareIdentity').checked)throw new Error('Save and review the consultation before signing.');
      if(dirty.has('triageForm'))throw new Error('Record the unsaved triage observations and allergy information before signing the consultation.');
      if(!await confirmLeave())return;
      await api('signConsultation',{...versions(),ConfirmPatient:true},true);await load();status('Consultation signed. Future corrections are recorded as amendments.');
    });
    $('amendmentForm').onsubmit=event=>{event.preventDefault();run(async()=>{
      if(!await confirmLeave('amendmentForm'))return;
      await api('amendClinicalEntry',{...versions(),EntryId:$('amendEntry').value,Amendment:values($('amendmentForm'))},true);
      $('amendmentForm').reset();await load();status('Amendment saved. The signed original is preserved.');
    });};
    async function history(next=null){
      if(!next){range={fromDate:$('clinicalFrom').value,toDate:$('clinicalTo').value};entries=[];}
      const data=await api('clinicalHistory',{...scope,DateRange:range,...(next?{Cursor:next}:{})});
      entries=[...new Map([...entries,...data.entries].map(row=>[row.EntryId,row])).values()];cursor=data.next;
      $('clinicalEntries').innerHTML=entries.map(entryMarkup).join('')||'<p>No signed entries in the selected period.</p>';$('moreClinical').hidden=!cursor;permissions();
      status(`${entries.length} clinical entries loaded for this encounter. Loaded pages are retained.`);
    }
    $('clinicalHistoryForm').onsubmit=event=>{event.preventDefault();run(()=>history());};$('moreClinical').onclick=()=>run(()=>history(cursor));
    return {open,clear,permissions,confirmLeave};
  }};
})();
