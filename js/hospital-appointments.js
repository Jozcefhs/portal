(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const values=id=>Object.fromEntries([...$(id).elements].filter(e=>e.name).map(e=>[e.name,e.value]));
  const wat=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):'';
  const local=v=>v?new Date(Date.parse(v)+3600000).toISOString().slice(0,16):'';
  const iso=v=>{if(!v)throw Error('Choose appointment times in WAT.');return new Date(`${v}:00+01:00`).toISOString();};
  const input=(name,label,extra='')=>`<label>${label}<input name="${name}" ${extra}></label>`;
  const dates=p=>`<label>From<input id="${p}From" type="date" required></label><label>To<input id="${p}To" type="date" required></label>`;
  const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${heads.length}">No records on this page.</td></tr>`}</tbody></table>`;
  window.DynamaxHospitalAppointments={create({api,run,can,writable,status,navigate}){
    let context=null,person=null,sourceVisit=null,schedule=null,editingSchedule=null;
    const cache=new Map(),dirty=new Set(),cursors={};
    $('appointments').innerHTML=`<h2>Appointments and clinic availability</h2><p>Book from a patient’s registration, or choose Follow-up appointment on an existing visit. Choose dates before loading records.</p>
      <details id="apSchedulesSection"><summary>Doctor availability</summary>
        <form id="apSchedulesForm" class="toolbar">${dates('apSched')}<button>Load clinic schedules</button><button type="button" id="apRefreshSchedules">Refresh schedules</button><button type="button" id="apNewSchedule">New clinic schedule</button></form>
        <div id="apSchedules" class="table-wrap"></div><button id="apSchedulesNext" hidden>Next schedules</button>
        <form id="apScheduleEditor" hidden><h3 id="apScheduleTitle">Clinic schedule</h3><div class="form-grid">
          ${input('Clinician','Doctor’s staff username','maxlength="120" required')}${input('Day','Clinic date (WAT)','type="date" required')}${input('Department','Receiving department','maxlength="120" required')}
          <label>Status<select name="Active"><option value="true">Active</option><option value="false">Inactive</option></select></label>
          <label>Availability windows (WAT)<textarea name="Windows" placeholder="09:00-12:00&#10;13:00-16:00" rows="3" required></textarea><small>One HH:MM-HH:MM window per line. Saved appointments must remain within the windows.</small></label>
        </div><button>Save clinic schedule</button><button type="button" id="apCloseSchedule" class="secondary">Close schedule editor</button></form>
      </details>
      <section><h3>Appointment register</h3><form id="apRegisterForm" class="toolbar">${dates('apReg')}<button>Load appointments</button><button type="button" id="apRefreshRegister">Refresh appointments</button></form>
        <p class="hint">Appointment dates, up to 30 records per page. Loaded pages remain available while you change tasks. Refresh for changes made by other staff.</p>
        <div id="apRegister" class="table-wrap"></div><button id="apRegisterNext" hidden>Next appointments</button></section>
      <section id="apPatient" hidden><div class="care-identity"><h2 id="apName"></h2><p id="apIdentity"></p></div><p id="apSummary"></p>
        <div class="toolbar"><button id="apRefresh">Refresh appointment</button><button id="apClose" class="secondary">Close appointment</button><button id="apReception">Reception visits</button></div>
        <form id="apBookingForm"><h3>Book / reschedule appointment</h3><p id="apScheduleChoice">Choose a clinic from Doctor availability above.</p><button type="button" id="apChooseSchedule">Choose clinic schedule</button>
          <div class="form-grid">${input('Reference','Permanent booking reference','maxlength="40" required')}${input('StartAt','Appointment start (WAT)','type="datetime-local" required')}${input('EndAt','Appointment end (WAT)','type="datetime-local" required')}</div>
          ${input('Reason','Reason for rescheduling','maxlength="1000"')}<label class="nurse-check"><input name="ConfirmPatient" type="checkbox" required>I have checked the patient and hospital number</label><button>Save appointment</button></form>
        <form id="apArrivalForm"><h3>Arrival / check-in</h3><p id="apExistingVisit"></p>
          <label class="nurse-check" id="apLinkExisting"><input name="UseExistingVisit" type="checkbox">Link the displayed open visit to this appointment</label>
          <label class="nurse-check"><input name="ConfirmPatient" type="checkbox" required>I have checked the arriving patient and hospital number</label><button>Check in appointment</button></form>
        <form id="apClosureForm"><h3>Close an unarrived booking</h3><label>Outcome<select name="Status"><option>Cancelled</option><option>Not attended</option></select></label>${input('Reason','Reason','maxlength="1000" minlength="5" required')}
          <label class="nurse-check"><input name="ConfirmPatient" type="checkbox" required>I have checked the patient and booking</label><button>Record outcome</button></form>
        <section id="apHistorySection"><h3>Appointment history</h3><form id="apHistoryForm" class="toolbar">${dates('apHist')}<button>Load appointment history</button><button type="button" id="apRefreshHistory">Refresh history</button></form><div id="apHistory" class="table-wrap"></div><button id="apHistoryNext" hidden>Next history</button></section>
      </section>`;
    const range=p=>({fromDate:$(p+'From').value,toDate:$(p+'To').value});
    const checked=(form,name)=>$(form).querySelector(`[name=${name}]`).checked;
    const scope=()=>({PatientId:person.PatientId,...(context?{AppointmentId:context.appointment.AppointmentId,Revision:context.appointment.Revision}:{})});
    async function cached(action,args,refresh=false){const key=JSON.stringify([action,args]);if(refresh)cache.delete(key);if(!cache.has(key)){cache.set(key,await api(action,args));if(cache.size>40)cache.delete(cache.keys().next().value);}return cache.get(key);}
    function invalidate(){cache.clear();for(const key of Object.keys(cursors))delete cursors[key];for(const id of ['apSchedules','apRegister','apHistory'])$(id).replaceChildren();for(const id of ['apSchedulesNext','apRegisterNext','apHistoryNext'])$(id).hidden=true;}
    function permissions(){
      document.querySelector('[data-tab=appointments]').hidden=!can('appointments.read');
      $('apNewSchedule').hidden=!writable('appointments.configure');$('apScheduleEditor').hidden=editingSchedule===null||!writable('appointments.configure');
      const active=!context||context.appointment.Status==='Scheduled';
      $('apBookingForm').hidden=!person||!active||!writable('appointments.write');
      $('apArrivalForm').hidden=!context||!active||!writable('appointments.write')||!writable('visits.write');
      $('apClosureForm').hidden=!context||!active||!writable('appointments.write');
      $('apHistorySection').hidden=!context;$('apRefresh').hidden=!context;
    }
    async function confirmLeave(except=''){return ![...dirty].some(f=>f!==except)||await window.DynamaxDialogs.confirm({title:'Unsaved appointment changes',message:'Discard unsaved appointment or availability changes?',confirmText:'Discard changes'});}
    async function leave(except=''){if(!await confirmLeave(except))return false;for(const form of [...dirty])if(form!==except){$(form).reset();dirty.delete(form);}return true;}
    function reset(form){$(form).reset();dirty.delete(form);}
    function scheduleLabel(row){return `${row.ClinicianName} · ${row.Day} · ${row.Department} · ${row.Windows.map(w=>`${w.From}–${w.To}`).join(', ')} WAT`;}
    function showPerson(){
      $('apPatient').hidden=false;$('apName').textContent=person.DisplayName||person.PatientName;
      $('apIdentity').textContent=`${person.HospitalNumber}${sourceVisit?' · Follow-up of an existing visit':''}`;
      $('apSummary').textContent=context?`${context.appointment.Reference} · ${context.appointment.Status} · ${wat(context.appointment.StartAt)} · ${context.appointment.ClinicianName}`:'New appointment';
      $('apScheduleChoice').textContent=schedule?scheduleLabel(schedule):context?`${context.appointment.ClinicianName} · ${context.appointment.Department}. Choose a clinic schedule to reschedule.`:'Choose a clinic from Doctor availability above.';
      const existing=context?.visit&&['Waiting','In progress'].includes(context.visit.Status)&&context.appointment.Status==='Scheduled';
      $('apExistingVisit').textContent=existing?`Open visit: ${context.visit.Department} · ${context.visit.Status}. Confirm linking it below.`:'Arrival creates one reception visit for this appointment.';
      $('apLinkExisting').hidden=!existing;$('apLinkExisting').querySelector('input').required=!!existing;
      permissions();
    }
    async function openPatient(row,visit=null){
      if(!await leave())return;
      context=null;person=row;sourceVisit=visit; schedule=null;
      for(const form of ['apBookingForm','apArrivalForm','apClosureForm'])reset(form);
      $('apBookingForm').elements.Reference.readOnly=false;
      $('apHistory').replaceChildren();$('apHistoryNext').hidden=true;showPerson();navigate('appointments');
      $('apSchedulesSection').open=true;status('Choose the doctor’s clinic schedule for this patient.');
    }
    async function openAppointment(row){
      if(!await leave())return;
      const next=await api('appointmentDetails',{PatientId:row.PatientId,AppointmentId:row.AppointmentId});
      context=next;person=next.patient;sourceVisit=next.appointment.FollowUpVisitId?{VisitId:next.appointment.FollowUpVisitId}:null;schedule=null;
      for(const form of ['apBookingForm','apArrivalForm','apClosureForm'])reset(form);
      const fields=$('apBookingForm').elements;fields.Reference.value=next.appointment.Reference;fields.Reference.readOnly=true;
      fields.StartAt.value=local(next.appointment.StartAt);fields.EndAt.value=local(next.appointment.EndAt);
      $('apHistory').replaceChildren();$('apHistoryNext').hidden=true;showPerson();navigate('appointments');status('Current appointment loaded.');
    }
    async function schedules(cursor=null,refresh=false){
      const r=await cached('appointmentSchedules',{DateRange:range('apSched'),...(cursor?{Cursor:cursor}:{})},refresh);cursors.schedules=r.next;$('apSchedulesNext').hidden=!r.next;
      $('apSchedules').innerHTML=table(['Date / doctor','Department / availability (WAT)','Status',''],r.schedules.map((s,i)=>`<tr><td>${esc(s.Day)}<br>${esc(s.ClinicianName)}</td><td>${esc(s.Department)}<br>${s.Windows.map(w=>`${esc(w.From)}–${esc(w.To)}`).join(', ')}</td><td>${s.Active?'Active':'Inactive'} · ${s.BookedCount} booked</td><td>${writable('appointments.configure')?`<button data-ap-edit="${i}">Edit schedule</button>`:''}${person&&s.Active&&writable('appointments.write')?`<button data-ap-select="${i}">Use this clinic</button>`:''}</td></tr>`).join(''));
      $('apSchedules').querySelectorAll('[data-ap-edit]').forEach(b=>b.onclick=()=>run(()=>editSchedule(r.schedules[b.dataset.apEdit])));
      $('apSchedules').querySelectorAll('[data-ap-select]').forEach(b=>b.onclick=()=>{
        schedule=r.schedules[b.dataset.apSelect];$('apScheduleChoice').textContent=scheduleLabel(schedule);
        const fields=$('apBookingForm').elements;
        if(!context){fields.StartAt.value=`${schedule.Day}T${schedule.Windows[0].From}`;fields.EndAt.value='';}
        dirty.add('apBookingForm');$('apBookingForm').scrollIntoView({block:'start'});
      });status('Selected clinic dates loaded.');
    }
    async function editSchedule(row={}){
      if(!await leave())return;editingSchedule=row;reset('apScheduleEditor');const form=$('apScheduleEditor');
      for(const key of ['Clinician','Day','Department'])form.elements[key].value=row[key]||'';
      form.elements.Active.value=String(row.Active??true);form.elements.Windows.value=(row.Windows||[]).map(w=>`${w.From}-${w.To}`).join('\n');
      form.elements.Clinician.readOnly=form.elements.Day.readOnly=!!row.ScheduleId;permissions();$('apSchedulesSection').open=true;
    }
    $('apNewSchedule').onclick=()=>run(()=>editSchedule());
    $('apCloseSchedule').onclick=()=>run(async()=>{if(!await leave())return;editingSchedule=null;reset('apScheduleEditor');permissions();});
    $('apScheduleEditor').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!await leave('apScheduleEditor'))return;const v=values('apScheduleEditor');
      const Windows=v.Windows.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{const m=line.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);if(!m)throw Error('Use one HH:MM-HH:MM window per line.');return {From:m[1],To:m[2]};});
      await api('saveAppointmentSchedule',{...(editingSchedule?.ScheduleId?{ScheduleId:editingSchedule.ScheduleId,Revision:editingSchedule.Revision}:{}),Schedule:{Clinician:v.Clinician,Day:v.Day,Department:v.Department,Active:v.Active==='true',Windows}},true);
      reset('apScheduleEditor');editingSchedule=null;schedule=null;invalidate();permissions();status('Clinic availability saved. Load schedules to see the updated list.');
    });};
    $('apBookingForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!await leave('apBookingForm'))return;if(!schedule)throw Error('Choose a clinic from Doctor availability before saving.');const v=values('apBookingForm');
      const r=await api('saveAppointment',{...scope(),ScheduleId:schedule.ScheduleId,FollowUpVisitId:sourceVisit?.VisitId||'',Booking:{Reference:v.Reference,StartAt:iso(v.StartAt),EndAt:iso(v.EndAt)},Reason:v.Reason,ConfirmPatient:checked('apBookingForm','ConfirmPatient')},true);
      dirty.delete('apBookingForm');invalidate();await openAppointment(r);status(r.Unchanged?'This appointment is already saved.':'Appointment saved.');
    });};
    $('apArrivalForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!await leave('apArrivalForm'))return;const r=await api('checkInAppointment',{...scope(),ConfirmPatient:checked('apArrivalForm','ConfirmPatient'),UseExistingVisit:checked('apArrivalForm','UseExistingVisit'),VisitId:context.visit?.VisitId||'',VisitRevision:context.visit?.Revision||''},true);
      dirty.delete('apArrivalForm');invalidate();await openAppointment(r);status('Arrival saved. The linked visit is available in Reception visits.');
    });};
    $('apClosureForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!await leave('apClosureForm'))return;const v=values('apClosureForm'),r=await api('closeAppointment',{...scope(),Status:v.Status,Reason:v.Reason,ConfirmPatient:checked('apClosureForm','ConfirmPatient')},true);
      dirty.delete('apClosureForm');invalidate();await openAppointment(r);status('Appointment outcome recorded. Earlier records remain in history.');
    });};
    async function register(cursor=null,refresh=false){
      const r=await cached('appointmentRegister',{DateRange:range('apReg'),...(cursor?{Cursor:cursor}:{})},refresh);cursors.register=r.next;$('apRegisterNext').hidden=!r.next;
      $('apRegister').innerHTML=table(['Appointment (WAT)','Patient','Doctor / department','Status',''],r.appointments.map((a,i)=>`<tr><td>${esc(wat(a.StartAt))}<br>${esc(wat(a.EndAt))}</td><td>${esc(a.PatientName)}<br>${esc(a.HospitalNumber)}</td><td>${esc(a.ClinicianName)}<br>${esc(a.Department)}</td><td>${esc(a.Status)}</td><td><button data-ap-open="${i}">Open appointment</button></td></tr>`).join(''));
      $('apRegister').querySelectorAll('[data-ap-open]').forEach(b=>b.onclick=()=>run(()=>openAppointment(r.appointments[b.dataset.apOpen])));status('Selected appointment dates loaded.');
    }
    async function history(cursor=null,refresh=false){
      const r=await cached('appointmentHistory',{...scope(),DateRange:range('apHist'),...(cursor?{Cursor:cursor}:{})},refresh);cursors.history=r.next;$('apHistoryNext').hidden=!r.next;
      $('apHistory').innerHTML=table(['When (WAT)','Action / officer','Saved booking'],r.entries.map(e=>`<tr><td>${esc(wat(e.CreatedAt))}</td><td>${esc(e.Type)}<br>${esc(e.UpdatedByName)}</td><td>${esc(wat(e.Snapshot.StartAt))} · ${esc(e.Snapshot.ClinicianName)}<br>${esc(e.Reason)}</td></tr>`).join(''));status('Selected appointment history loaded.');
    }
    for(const [name,fn,prefix,target] of [['Schedules',schedules,'apSched','apSchedules'],['Register',register,'apReg','apRegister'],['History',history,'apHist','apHistory']]){
      $(`ap${name}Form`).onsubmit=e=>{e.preventDefault();run(()=>fn());};$(`apRefresh${name}`).onclick=()=>run(()=>fn(null,true));$(`ap${name}Next`).onclick=()=>run(()=>fn(cursors[name.toLowerCase()]));
      $(`ap${name}Form`).onchange=()=>{$(target).replaceChildren();$(`ap${name}Next`).hidden=true;};
    }
    $('apChooseSchedule').onclick=()=>{$('apSchedulesSection').open=true;$('apSchedulesSection').scrollIntoView({block:'start'});};
    $('apRefresh').onclick=()=>run(()=>openAppointment(context.appointment));$('apReception').onclick=()=>navigate('reception');
    $('apClose').onclick=()=>run(async()=>{if(!await leave())return;context=person=sourceVisit=schedule=null;$('apPatient').hidden=true;});
    for(const f of ['apScheduleEditor','apBookingForm','apArrivalForm','apClosureForm'])$(f).oninput=()=>dirty.add(f);
    window.addEventListener('beforeunload',e=>{if(dirty.size){e.preventDefault();e.returnValue='';}});
    function clear(){context=person=sourceVisit=schedule=editingSchedule=null;dirty.clear();invalidate();$('appointments').querySelectorAll('form').forEach(f=>f.reset());$('apPatient').hidden=$('apScheduleEditor').hidden=true;for(const name of ['apName','apIdentity','apSummary','apExistingVisit','apScheduleChoice'])$(name).replaceChildren();}
    permissions();return {permissions,confirmLeave,clear,openPatient,openVisit:row=>openPatient(row,row)};
  }};
})();
