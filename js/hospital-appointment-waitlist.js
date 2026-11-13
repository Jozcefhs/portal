(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const input=(name,label,extra='')=>`<label>${label}<input name="${name}" ${extra}></label>`;
  const dates=p=>`<label>From<input id="${p}From" type="date"></label><label>To<input id="${p}To" type="date"></label>`;
  const table=(headers,rows)=>`<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${headers.length}">No requests on this page.</td></tr>`}</tbody></table>`;
  window.DynamaxHospitalAppointmentWaitlist={create({api,run,writable,status,cached,dirty,leave,invalidate,getPatient,book,openAppointment}){
    let entry=null,person=null,next=null,historyNext=null,printed='';
    $('appointments').insertAdjacentHTML('beforeend',`<section id="awSection"><h2>Appointment waitlist</h2>
      <p>Keep requests awaiting a suitable clinic slot. To add a patient, open their registration and choose Book appointment, then Add to waitlist.</p>
      <form id="awListForm" class="toolbar"><label>Status<select id="awStatus"><option>Waiting</option><option>Booked</option><option>Cancelled</option></select></label>
        <span id="awDates" class="toolbar" hidden>${dates('awList')}</span><button>Load waitlist</button><button type="button" id="awRefresh">Refresh waitlist</button><button type="button" id="awPrintList" hidden>Preview / print loaded page</button></form>
      <p class="hint">Waiting requests include earlier dates. Up to 30 per page; completed requests require dates. Opening this screen does not load history.</p>
      <div id="awList" class="table-wrap"></div><button id="awNext" hidden>Next requests</button>
      <section id="awDetail" hidden><h3 id="awIdentity"></h3><p id="awSummary"></p>
        <div class="toolbar"><button id="awBook" type="button">Book this waiting request</button><button id="awOpenBooking" type="button" hidden>Open saved appointment</button><button id="awPrint" type="button">Preview / print request</button><button id="awClose" type="button" class="secondary">Close request</button></div>
        <form id="awEditor"><div class="form-grid">${input('Reference','Permanent waitlist reference','required maxlength="40"')}${input('Department','Receiving department','required maxlength="120"')}
          ${input('PreferredFrom','Preferred from (WAT)','type="date" required')}${input('PreferredTo','Preferred to (WAT)','type="date" required')}
          ${input('Clinician','Preferred doctor’s staff username (optional)','maxlength="120"')}${input('Note','Scheduling note (optional)','maxlength="1000"')}
          ${input('Reason','Reason for changing preferences','maxlength="1000"')}</div>
          <label class="nurse-check"><input name="ConfirmPatient" type="checkbox" required>I have checked the patient and hospital number</label><button>Save waiting request</button></form>
        <form id="awCancel"><h3>Cancel waiting request</h3>${input('Reason','Cancellation reason','required minlength="5" maxlength="1000"')}
          <label class="nurse-check"><input name="ConfirmPatient" type="checkbox" required>I have checked the patient and request</label><button>Cancel waiting request</button></form>
        <section id="awHistorySection"><h3>Request history</h3><form id="awHistoryForm" class="toolbar">${dates('awHist')}<button>Load request history</button><button id="awHistoryRefresh" type="button">Refresh history</button><button id="awPrintHistory" type="button" hidden>Preview / print loaded history</button></form><div id="awHistory" class="table-wrap"></div><button id="awHistoryNext" hidden>Next history</button></section>
      </section></section>`);
    const values=id=>Object.fromEntries([...$(id).elements].filter(e=>e.name).map(e=>[e.name,e.type==='checkbox'?e.checked:e.value]));
    const range=p=>({fromDate:$(p+'From').value,toDate:$(p+'To').value});
    const scope=()=>({WaitlistId:entry.WaitlistId,PatientId:entry.PatientId,Revision:entry.Revision});
    const print=(title,html)=>{const area=$('cardPrint');area.className='billing-print';area.innerHTML=`<h2>${esc(title)}</h2><p>Branch: ${esc($('branch').selectedOptions[0]?.textContent||$('branch').value)}</p>${html}`;window.print();};
    function reset(form){$(form).reset();dirty.delete(form);}
    function permissions(){const edit=writable('appointments.write'),waiting=!entry||entry.Status==='Waiting';
      $('apJoinWaitlist').hidden=!getPatient()||!edit;$('awEditor').hidden=!person||!edit||!waiting;
      $('awCancel').hidden=!entry||!waiting||!edit;$('awBook').hidden=!entry||!waiting||!edit;
      $('awOpenBooking').hidden=!entry?.AppointmentId;$('awHistorySection').hidden=!entry;$('awPrint').hidden=!entry;
    }
    function show(){
      $('awDetail').hidden=false;$('awIdentity').textContent=`${person.DisplayName||person.PatientName} · ${person.HospitalNumber}`;
      $('awSummary').textContent=entry?`${entry.Reference} · ${entry.Status} · ${entry.Department} · ${entry.PreferredFrom} to ${entry.PreferredTo} · ${entry.ClinicianName||'Any available doctor'}${entry.ClosureReason?' · '+entry.ClosureReason:''}`:'New waiting request';
      reset('awEditor');reset('awCancel');const fields=$('awEditor').elements;
      for(const name of ['Reference','Department','PreferredFrom','PreferredTo','Clinician','Note'])fields[name].value=entry?.[name]||'';
      fields.Reference.readOnly=fields.Department.readOnly=!!entry;fields.Reason.required=!!entry;
      $('awHistory').replaceChildren();$('awHistoryNext').hidden=$('awPrintHistory').hidden=true;permissions();$('awDetail').scrollIntoView({block:'start'});
    }
    async function open(row){if(!await leave())return;const r=await api('appointmentWaitlistDetails',{WaitlistId:row.WaitlistId,PatientId:row.PatientId});entry=r.entry;person=r.patient;show();status('Current waiting request loaded.');}
    function invalidateLists(){next=historyNext=null;printed='';for(const id of ['awList','awHistory'])$(id).replaceChildren();for(const id of ['awNext','awHistoryNext','awPrintList','awPrintHistory'])$(id).hidden=true;}
    async function list(cursor=null,refresh=false){
      const Status=$('awStatus').value,r=await cached('appointmentWaitlist',{Status,...(Status==='Waiting'?{}:{DateRange:range('awList')}),...(cursor?{Cursor:cursor}:{})},refresh);
      next=r.next;$('awNext').hidden=!next;
      const rows=r.entries.map((e,i)=>`<tr><td>${esc(e.PatientName)}<br>${esc(e.HospitalNumber)}</td><td>${esc(e.Department)}<br>${esc(e.ClinicianName||'Any available doctor')}</td><td>${esc(e.PreferredFrom)} to ${esc(e.PreferredTo)}</td><td>${esc(e.Status)}<br>${esc(e.Reference)}</td><td><button data-aw-open="${i}">Open request</button></td></tr>`).join('');
      $('awList').innerHTML=table(['Patient','Clinic preference','Preferred dates','Status / reference',''],rows);
      $('awList').querySelectorAll('[data-aw-open]').forEach(b=>b.onclick=()=>run(()=>open(r.entries[b.dataset.awOpen])));
      const copy=$('awList').cloneNode(true);copy.querySelectorAll('button').forEach(b=>b.remove());printed=copy.innerHTML;$('awPrintList').hidden=false;status('Selected waitlist page loaded.');
    }
    async function history(cursor=null,refresh=false){
      const r=await cached('appointmentWaitlistHistory',{...scope(),DateRange:range('awHist'),...(cursor?{Cursor:cursor}:{})},refresh);historyNext=r.next;$('awHistoryNext').hidden=!r.next;
      $('awHistory').innerHTML=table(['When / officer','Action / reason','Saved preferences'],r.entries.map(e=>`<tr><td>${esc(new Date(e.CreatedAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}))} WAT<br>${esc(e.UpdatedByName)}</td><td>${esc(e.Type)}<br>${esc(e.Reason)}</td><td>${esc(e.Snapshot.PreferredFrom)} to ${esc(e.Snapshot.PreferredTo)}<br>${esc(e.Snapshot.ClinicianName||'Any available doctor')}<br>${esc(e.Snapshot.Note)}</td></tr>`).join(''));
      $('awPrintHistory').hidden=false;status('Selected waiting request history loaded.');
    }
    $('awListForm').onsubmit=e=>{e.preventDefault();run(()=>list());};$('awRefresh').onclick=()=>run(()=>list(null,true));$('awNext').onclick=()=>run(()=>list(next));
    $('awListForm').onchange=()=>{const dated=$('awStatus').value!=='Waiting';$('awDates').hidden=!dated;for(const x of ['awListFrom','awListTo'])$(x).required=dated;invalidateLists();};
    $('apJoinWaitlist').onclick=()=>run(async()=>{if(!await leave())return;entry=null;person=getPatient();show();status('Enter this patient’s waiting request.');});
    $('awEditor').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!await leave('awEditor'))return;const {ConfirmPatient,Reason,...Waitlist}=values('awEditor');
      const r=await api('saveAppointmentWaitlist',{...(entry?scope():{PatientId:person.PatientId}),Waitlist,ConfirmPatient,Reason},true);
      dirty.delete('awEditor');invalidate();await open(r);status(r.Unchanged?'This waiting request is already saved.':'Waiting request saved.');
    });};
    $('awCancel').onsubmit=e=>{e.preventDefault();run(async()=>{if(!await leave('awCancel'))return;const r=await api('cancelAppointmentWaitlist',{...scope(),...values('awCancel')},true);dirty.delete('awCancel');invalidate();await open(r);status('Waiting request cancelled; its history is retained.');});};
    $('awBook').onclick=()=>run(()=>book(entry,person));$('awOpenBooking').onclick=()=>run(()=>openAppointment({PatientId:entry.PatientId,AppointmentId:entry.AppointmentId}));
    $('awClose').onclick=()=>run(async()=>{if(!await leave())return;entry=person=null;$('awDetail').hidden=true;});
    $('awHistoryForm').onsubmit=e=>{e.preventDefault();run(()=>history());};$('awHistoryRefresh').onclick=()=>run(()=>history(null,true));$('awHistoryNext').onclick=()=>run(()=>history(historyNext));
    $('awHistoryForm').onchange=()=>{$('awHistory').replaceChildren();$('awHistoryNext').hidden=$('awPrintHistory').hidden=true;};
    $('awPrintList').onclick=()=>print('Appointment waitlist — loaded page',printed);
    $('awPrint').onclick=()=>print('Appointment waiting request',`<h3>${esc($('awIdentity').textContent)}</h3><p>${esc($('awSummary').textContent)}</p><p>${esc(entry.Note)}</p>`);
    $('awPrintHistory').onclick=()=>print('Waiting request — loaded history',`<h3>${esc($('awIdentity').textContent)}</h3>${$('awHistory').innerHTML}`);
    for(const form of ['awEditor','awCancel'])$(form).oninput=()=>dirty.add(form);
    return {permissions,invalidate:invalidateLists,clear(){entry=person=null;invalidateLists();$('awDetail').hidden=true;$('awIdentity').textContent=$('awSummary').textContent='';$('awDates').hidden=true;for(const id of ['awListFrom','awListTo'])$(id).required=false;}};
  }};
})();
