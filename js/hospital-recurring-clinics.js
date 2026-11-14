(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dates=p=>`<label>From<input id="${p}From" type="date" required></label><label>To<input id="${p}To" type="date" required></label>`;
  const range=p=>({fromDate:$(p+'From').value,toDate:$(p+'To').value});
  const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${heads.length}">No records on this page.</td></tr>`}</tbody></table>`;
  const windows=rows=>(rows||[]).map(w=>`${esc(w.From)}–${esc(w.To)}`).join(', ');
  window.DynamaxHospitalRecurringClinics={create({api,run,writable,status,cached,dirty,leave,invalidate}){
    let entry=null,preview=null,next=null,historyNext=null;
    $('apSchedulesSection').insertAdjacentHTML('afterend',`<details id="rcSection"><summary>Recurring clinic schedules</summary>
      <p>Save a weekly pattern, preview up to 31 days, then create missing clinic days. Existing availability and bookings stay intact.</p>
      <form id="rcListForm" class="toolbar"><label>Templates<select id="rcActive"><option value="true">Active</option><option value="false">Inactive</option></select></label><button>Load templates</button><button id="rcRefresh" type="button">Refresh templates</button><button id="rcNew" type="button">New recurring clinic</button></form>
      <div id="rcList" class="table-wrap"></div><button id="rcNext" hidden>Next templates</button>
      <section id="rcDetail" hidden><h3 id="rcTitle"></h3>
        <p class="hint">Changes affect future generation only. Use Doctor availability to change an existing clinic day.</p>
        <form id="rcEditor"><fieldset id="rcFields"><legend>Weekly clinic pattern · WAT</legend><div class="form-grid">
          <label>Permanent reference<input name="Reference" maxlength="40" required></label><label>Clinic name<input name="Name" maxlength="120" required></label>
          <label>Doctor’s staff username<input name="Clinician" maxlength="120" required></label><label>Receiving department<input name="Department" maxlength="120" required></label>
          <label>Status<select name="Active"><option value="true">Active</option><option value="false">Inactive</option></select></label>
          <label>Patient self-booking<select name="SelfBookingEnabled"><option value="false">Disabled</option><option value="true">Enabled</option></select></label><label>Patient slot length (minutes)<input name="SlotMinutes" type="number" min="5" max="120" step="5" value="30" required></label>
          <label>Availability windows (WAT)<textarea name="Windows" rows="3" placeholder="09:00-12:00&#10;13:00-16:00" required></textarea><small>One HH:MM-HH:MM window per line.</small></label>
        </div><fieldset class="rc-weekdays"><legend>Repeat every week on</legend>${weekdays.map((name,i)=>`<label class="nurse-check"><input type="checkbox" name="Weekdays" value="${i}">${name}</label>`).join('')}</fieldset>
        <label id="rcReasonLabel">Reason for change<input name="Reason" maxlength="1000" minlength="5"></label></fieldset>
        <div class="toolbar"><button id="rcSave">Save clinic template</button><button type="button" id="rcReload">Refresh this template</button><button type="button" id="rcClose" class="secondary">Close template</button></div></form>
        <section id="rcGeneration"><h3>Create clinic days</h3><form id="rcPreviewForm" class="toolbar">${dates('rcGen')}<button>Preview clinic dates</button></form>
          <p class="hint">Only the checked weekdays will be created. Review dates labelled Needs review in Doctor availability; they will be skipped here.</p>
          <div id="rcPreview" class="table-wrap"></div><p id="rcSummary" role="status"></p>
          <div class="toolbar"><button id="rcGenerate" hidden>Create missing clinic days</button><button id="rcPrint" hidden>Preview / print dates</button></div></section>
        <section id="rcHistorySection"><h3>Template history</h3><form id="rcHistoryForm" class="toolbar">${dates('rcHist')}<button>Load template history</button><button type="button" id="rcHistoryRefresh">Refresh history</button></form><div id="rcHistory" class="table-wrap"></div><button id="rcHistoryNext" hidden>Next history</button><button id="rcPrintHistory" hidden>Preview / print history</button></section>
      </section></details>`);
    function clearPreview(){preview=null;$('rcPreview').replaceChildren();$('rcSummary').textContent='';$('rcGenerate').hidden=$('rcPrint').hidden=true;}
    function invalidateLists(){next=historyNext=null;$('rcList').replaceChildren();$('rcHistory').replaceChildren();$('rcNext').hidden=$('rcHistoryNext').hidden=$('rcPrintHistory').hidden=true;clearPreview();}
    function permissions(){const write=writable('appointments.configure');$('rcNew').hidden=$('rcSave').hidden=!write;$('rcFields').disabled=!write;$('rcGeneration').hidden=!entry?.TemplateId||!entry.Active||!write;$('rcHistorySection').hidden=$('rcReload').hidden=!entry?.TemplateId;}
    function show(){
      const f=$('rcEditor');f.reset();dirty.delete('rcEditor');clearPreview();$('rcHistory').replaceChildren();$('rcHistoryNext').hidden=$('rcPrintHistory').hidden=true;
      for(const key of ['Reference','Name','Clinician','Department'])f.elements[key].value=entry?.[key]||'';
      f.elements.SelfBookingEnabled.value=String(entry?.SelfBookingEnabled===true);f.elements.SlotMinutes.value=entry?.SlotMinutes||30;f.elements.Reference.readOnly=!!entry?.TemplateId;f.elements.Active.value=String(entry?.Active??true);f.elements.Windows.value=(entry?.Windows||[]).map(w=>`${w.From}-${w.To}`).join('\n');
      f.querySelectorAll('[name=Weekdays]').forEach(e=>{e.checked=(entry?.Weekdays||[]).includes(Number(e.value));});
      f.elements.Reason.required=!!entry?.TemplateId;$('rcReasonLabel').hidden=!entry?.TemplateId;
      $('rcTitle').textContent=entry?.Name||'New recurring clinic';$('rcDetail').hidden=false;$('rcSection').open=true;permissions();
    }
    async function open(row){if(!await leave())return;entry=(await api('clinicTemplateDetails',{TemplateId:row.TemplateId})).template;show();status('Current clinic template loaded.');}
    async function list(cursor=null,refresh=false){
      const r=await cached('clinicTemplates',{Active:$('rcActive').value==='true',...(cursor?{Cursor:cursor}:{})},refresh);next=r.next;$('rcNext').hidden=!next;
      $('rcList').innerHTML=table(['Clinic / doctor','Department / weekdays','Windows (WAT)',''],r.templates.map((t,i)=>`<tr><td>${esc(t.Name)}<br>${esc(t.ClinicianName)}</td><td>${esc(t.Department)}<br>${t.Weekdays.map(d=>weekdays[d]).join(', ')}</td><td>${windows(t.Windows)}</td><td><button data-rc-open="${i}">Open template</button></td></tr>`).join(''));
      $('rcList').querySelectorAll('[data-rc-open]').forEach(b=>b.onclick=()=>run(()=>open(r.templates[b.dataset.rcOpen])));status('Selected clinic templates loaded.');
    }
    async function history(cursor=null,refresh=false){
      const r=await cached('clinicTemplateHistory',{TemplateId:entry.TemplateId,DateRange:range('rcHist'),...(cursor?{Cursor:cursor}:{})},refresh);historyNext=r.next;$('rcHistoryNext').hidden=!historyNext;
      $('rcHistory').innerHTML=table(['When / officer','Action / reason','Saved pattern'],r.entries.map(e=>`<tr><td>${esc(new Date(e.CreatedAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}))} WAT<br>${esc(e.UpdatedByName)}</td><td>${esc(e.Type)}<br>${esc(e.Reason)}${e.Type==='Clinic days generated'?`<br>${esc(e.DateRange.fromDate)} to ${esc(e.DateRange.toDate)} · ${e.Created} created · ${e.Existing} existing · ${e.Conflicts} need review`:''}</td><td>${esc(e.Snapshot.Name)} · ${esc(e.Snapshot.ClinicianName)}<br>${e.Snapshot.Weekdays.map(d=>weekdays[d]).join(', ')} · ${windows(e.Snapshot.Windows)}<br>${e.Snapshot.Active?'Active':'Inactive'}</td></tr>`).join(''));
      $('rcPrintHistory').hidden=false;status('Selected clinic template history loaded.');
    }
    const print=(title,html)=>{const target=$('cardPrint');target.className='billing-print';target.innerHTML=`<h2>${esc(title)}</h2><p>${esc(entry?.Name)} · ${esc(entry?.ClinicianName)} · ${esc(entry?.Department)}</p>${html}`;window.print();};
    $('rcListForm').onsubmit=e=>{e.preventDefault();run(()=>list());};$('rcRefresh').onclick=()=>run(()=>list(null,true));$('rcNext').onclick=()=>run(()=>list(next));$('rcActive').onchange=()=>{$('rcList').replaceChildren();$('rcNext').hidden=true;next=null;};
    $('rcNew').onclick=()=>run(async()=>{if(!await leave())return;entry=null;show();status('Enter a recurring clinic pattern.');});
    $('rcReload').onclick=()=>run(()=>open(entry));
    $('rcClose').onclick=()=>run(async()=>{if(!await leave())return;entry=null;clearPreview();$('rcDetail').hidden=true;});
    $('rcEditor').oninput=()=>{dirty.add('rcEditor');clearPreview();};
    $('rcEditor').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!await leave('rcEditor'))return;const f=$('rcEditor').elements,Template={};
      for(const k of ['Reference','Name','Clinician','Department'])Template[k]=f[k].value;
      Template.SelfBookingEnabled=f.SelfBookingEnabled.value==='true';Template.SlotMinutes=Number(f.SlotMinutes.value);Template.Active=f.Active.value==='true';Template.Weekdays=[...$('rcEditor').querySelectorAll('[name=Weekdays]:checked')].map(e=>Number(e.value));
      Template.Windows=f.Windows.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{const m=line.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);if(!m)throw Error('Use one HH:MM-HH:MM window per line.');return {From:m[1],To:m[2]};});
      const r=await api('saveClinicTemplate',{...(entry?.TemplateId?{TemplateId:entry.TemplateId,Revision:entry.Revision}:{}),Template,Reason:f.Reason.value},true);
      dirty.delete('rcEditor');invalidate();await open(r);status(r.Unchanged?'This clinic template is already saved.':'Recurring clinic template saved.');
    });};
    $('rcPreviewForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(dirty.has('rcEditor'))throw Error('Save the clinic template before previewing its dates.');if(!await leave())return;clearPreview();
      const DateRange=range('rcGen'),r=await api('previewClinicTemplate',{TemplateId:entry.TemplateId,Revision:entry.Revision,DateRange});preview={...r.preview,DateRange};
      $('rcPreview').innerHTML=table(['Clinic date (WAT)','Outcome','Saved / proposed availability','Bookings'],preview.entries.map(d=>`<tr><td>${esc(d.Day)}</td><td>${esc(d.Status)}</td><td>${esc(d.Department)} · ${d.Active?'Active':'Inactive'}<br>${windows(d.Windows)}</td><td>${d.BookedCount}</td></tr>`).join(''));
      $('rcSummary').textContent=`${preview.Create} to create · ${preview.Existing} already available · ${preview.Conflicts} need review. Existing clinic days will be kept.`;
      $('rcGenerate').hidden=!preview.Create;$('rcPrint').hidden=false;status('Clinic date preview ready.');
    });};
    $('rcPreviewForm').oninput=clearPreview;
    $('rcGenerate').onclick=()=>run(async()=>{
      if(!preview||dirty.has('rcEditor'))throw Error('Preview the saved clinic pattern again.');if(!await leave())return;
      if(!await window.DynamaxDialogs.confirm({title:'Create clinic days',message:`Create ${preview.Create} clinic day(s)? ${preview.Existing} existing day(s) and ${preview.Conflicts} conflicting day(s) will be kept unchanged.`,confirmText:'Create clinic days'}))return;
      try{const r=await api('generateClinicTemplate',{TemplateId:entry.TemplateId,Revision:entry.Revision,DateRange:preview.DateRange,PreviewToken:preview.Token,ConfirmGeneration:true},true);
        invalidate();await open(r);status(`${r.Created} clinic days created. ${r.Existing} already available; ${r.Conflicts} need review. Load Doctor availability to use the saved days.`);
      }catch(error){throw error;} // Keep the same request available after a lost response.
    });
    $('rcHistoryForm').onsubmit=e=>{e.preventDefault();run(()=>history());};$('rcHistoryRefresh').onclick=()=>run(()=>history(null,true));$('rcHistoryNext').onclick=()=>run(()=>history(historyNext));
    $('rcHistoryForm').onchange=()=>{$('rcHistory').replaceChildren();$('rcHistoryNext').hidden=$('rcPrintHistory').hidden=true;};
    $('rcPrint').onclick=()=>print('Clinic date preview',`<p>${esc(preview.DateRange.fromDate)} to ${esc(preview.DateRange.toDate)} · ${esc($('rcSummary').textContent)}</p>${$('rcPreview').innerHTML}`);
    $('rcPrintHistory').onclick=()=>print('Clinic template — loaded history',$('rcHistory').innerHTML);
    return {permissions,invalidate:invalidateLists,clear(){entry=null;invalidateLists();$('rcDetail').hidden=true;$('rcTitle').textContent='';}};
  }};
})();
