(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const wat=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):'';
  const local=v=>new Date(Date.parse(v)+3600000).toISOString().slice(0,16);
  const dates=p=>`<label>From<input id="${p}From" type="date"></label><label>To<input id="${p}To" type="date"></label>`;
  const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${heads.length}">No reminders on this page.</td></tr>`}</tbody></table>`;
  window.DynamaxHospitalAppointmentReminders={create({api,run,writable,status,cached,dirty,leave,clearCache,getAppointment}){
    let preview=null,row=null,next=null,historyNext=null;
    $('apHistorySection').insertAdjacentHTML('beforebegin','<section id="arPrepare"><h3>Appointment reminder</h3><button id="arPreview">Preview email reminder</button><p class="hint">Uses the saved patient email after consent is confirmed. No automatic messages when a booking is opened.</p></section>');
    $('apSchedulesSection').insertAdjacentHTML('afterend',`<details id="arSection"><summary>Appointment reminders</summary>
      <form id="arListForm" class="toolbar"><label>Status<select id="arStatus">${['Queued','Sending','Accepted','Failed','Uncertain','Cancelled','Skipped'].map(s=>`<option>${s}</option>`).join('')}</select></label><span id="arDates" class="toolbar" hidden>${dates('arList')}</span><button>Load reminders</button><button id="arRefreshList" type="button">Refresh reminders</button></form>
      <p class="hint">Queued reminders are checked every five minutes. Accepted means the email provider accepted the message, not confirmed inbox delivery. Sending or uncertain messages are never retried automatically.</p>
      <div id="arList" class="table-wrap"></div><button id="arNext" hidden>Next reminders</button>
      <section id="arDetail" hidden><h3 id="arTitle"></h3><p id="arContact"></p><p id="arOutcome" role="status"></p><pre id="arText" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
        <form id="arQueueForm" hidden><label>Send at (WAT)<input name="DueAt" type="datetime-local" required></label><label class="nurse-check"><input name="Consent" type="checkbox" required>I confirmed permission to send this appointment reminder to the saved email</label><button id="arQueue">Schedule reminder</button></form>
        <div class="toolbar"><button id="arPreviewCurrent" type="button">Preview current booking</button><button id="arReload" type="button">Refresh reminder</button><button id="arSend" type="button" hidden>Process due reminder now</button><button id="arClose" type="button" class="secondary">Close reminder</button></div>
        <form id="arChangeForm" hidden><label>Action<select name="Action"></select></label><label>Reason<textarea name="Reason" minlength="5" maxlength="1000" required></textarea></label><label id="arProviderCheck" class="nurse-check"><input name="ProviderReview" type="checkbox">I checked the provider delivery log and verified this outcome</label><button>Save reminder action</button></form>
        <section id="arHistorySection" hidden><h3>Reminder history</h3><form id="arHistoryForm" class="toolbar">${dates('arHist')}<button>Load reminder history</button></form><div id="arHistory" class="table-wrap"></div><button id="arHistoryNext" hidden>Next reminder history</button></section>
      </section></details>`);
    const scope=()=>({ReminderId:row.ReminderId}),range=p=>({fromDate:$(p+'From').value,toDate:$(p+'To').value});
    function permissions(){
      $('arPrepare').hidden=!getAppointment();$('arPreviewCurrent').hidden=!row||!['Failed','Skipped','Cancelled'].includes(row.Status);$('arQueueForm').hidden=!(preview&&(!row||['Failed','Skipped'].includes(row.Status)||(row.Status==='Cancelled'&&['Queued','Failed'].includes(row.CancelledFrom)))&&!preview.blocked&&preview.connection.configured&&writable('appointments.write'));
      $('arSend').hidden=!(row?.Status==='Queued'&&writable('appointments.write'));
      const options=[];if(writable('appointments.write')&&['Queued','Failed'].includes(row?.Status))options.push(['cancel','Cancel reminder']);if(writable('appointments.write')&&row?.Status==='Failed')options.push(['retry','Retry after fixing email delivery']);
      if(writable('appointments.configure')&&['Sending','Uncertain'].includes(row?.Status))options.push(['confirm-accepted','Provider confirms acceptance'],['confirm-cancelled','Close without resending']);
      $('arChangeForm').hidden=!options.length;$('arChangeForm').elements.Action.innerHTML=options.map(([v,t])=>`<option value="${v}">${t}</option>`).join('');
      $('arProviderCheck').hidden=!['Sending','Uncertain'].includes(row?.Status);$('arHistorySection').hidden=!row;
    }
    function render(){
      const d=preview?.preview||row;$('arDetail').hidden=!d;if(!d)return;
      $('arSection').open=true;$('arTitle').textContent=`${d.PatientName} · ${d.HospitalNumber} · ${d.Reference}`;
      $('arContact').textContent=`To: ${d.ToEmail||'No saved email'} · Appointment: ${wat(d.StartAt)}`;$('arText').textContent=d.Text;
      $('arOutcome').textContent=row?`${row.Status} · Send time: ${wat(row.DueAt)} · ${row.Reason||''}${row.ProviderMessageId?' · Provider reference: '+row.ProviderMessageId:''}`:preview.blocked||(!preview.connection.configured?'Email delivery is not connected. Configure this branch’s email provider in settings.':'Review the email and confirm permission before scheduling.');
      permissions();$('arDetail').scrollIntoView({block:'start'});
    }
    function resetForm(id){$(id).reset();dirty.delete(id);}
    function clearDetail(){preview=row=null;resetForm('arQueueForm');resetForm('arChangeForm');$('arDetail').hidden=true;for(const id of ['arTitle','arContact','arText','arOutcome','arHistory'])$(id).replaceChildren();$('arHistoryNext').hidden=true;historyNext=null;}
    async function openReminder(r){if(!await leave())return;clearDetail();row=(await api('appointmentReminderDetails',{ReminderId:r.ReminderId})).reminder;render();status('Current reminder loaded.');}
    async function loadPreview(bookingRow=null){
      if(!await leave())return;const a=bookingRow||getAppointment();if(!a)throw Error('Open a saved appointment first.');clearDetail();preview=await api('appointmentReminderPreview',{AppointmentId:a.AppointmentId,PatientId:a.PatientId});row=preview.reminder;
      const due=Math.max(Date.now(),Date.parse(preview.preview.StartAt)-86400000);$('arQueueForm').elements.DueAt.value=local(new Date(due).toISOString());render();status('Appointment reminder preview ready. No email sent.');
    }
    function invalidate(){clearCache();next=null;$('arList').replaceChildren();$('arNext').hidden=true;}
    async function list(cursor=null,refresh=false){
      const Status=$('arStatus').value,r=await cached('appointmentReminders',{Status,...(['Queued','Sending','Uncertain'].includes(Status)?{}:{DateRange:range('arList')}),...(cursor?{Cursor:cursor}:{})},refresh);
      next=r.next;$('arNext').hidden=!next;$('arList').innerHTML=table(['Patient / booking','Appointment (WAT)','Send time (WAT)','Status',''],r.reminders.map((r,i)=>`<tr><td>${esc(r.PatientName)}<br>${esc(r.HospitalNumber)} · ${esc(r.Reference)}</td><td>${esc(wat(r.StartAt))}</td><td>${esc(wat(r.DueAt))}</td><td>${esc(r.Status)}</td><td><button data-ar-open="${i}">Open reminder</button></td></tr>`).join(''));
      $('arList').querySelectorAll('[data-ar-open]').forEach(b=>b.onclick=()=>run(()=>openReminder(r.reminders[b.dataset.arOpen])));status('Selected reminders loaded.');
    }
    $('arPreview').onclick=()=>run(()=>loadPreview());
    $('arPreviewCurrent').onclick=()=>run(()=>loadPreview(row));
    $('arReload').onclick=()=>run(()=>row?openReminder(row):loadPreview());
    $('arClose').onclick=()=>run(async()=>{if(await leave())clearDetail();});
    $('arQueueForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!await leave('arQueueForm'))return;const a=preview.preview,f=$('arQueueForm').elements;
      const r=await api('queueAppointmentReminder',{AppointmentId:a.AppointmentId,PatientId:a.PatientId,PreviewToken:preview.Token,...(row?{ReplaceUnsent:true,Revision:row.Revision}:{}),DueAt:new Date(f.DueAt.value+':00+01:00').toISOString(),ConfirmConsent:f.Consent.checked},true);
      resetForm('arQueueForm');invalidate();await openReminder(r);status(r.Unchanged?'This booking already has a reminder.':'Appointment reminder scheduled.');
    });};
    $('arSend').onclick=()=>run(async()=>{
      if(!await leave())return;const r=await api('sendAppointmentReminder',{...scope(),ConfirmSend:true},true);invalidate();await openReminder(row);status(r.Unchanged?'Reminder is not due or was already processed.':`Reminder processing: ${r.Status}.`);
    });
    $('arChangeForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!await leave('arChangeForm'))return;const f=$('arChangeForm').elements,r=await api('changeAppointmentReminder',{...scope(),Revision:row.Revision,Action:f.Action.value,Reason:f.Reason.value,ConfirmProviderReview:f.ProviderReview.checked},true);
      resetForm('arChangeForm');invalidate();await openReminder(r);status('Reminder action saved.');
    });};
    async function history(cursor=null){const r=await cached('appointmentReminderHistory',{...scope(),DateRange:range('arHist'),...(cursor?{Cursor:cursor}:{})});historyNext=r.next;$('arHistoryNext').hidden=!historyNext;$('arHistory').innerHTML=table(['When (WAT)','Outcome','Officer','Details'],r.entries.map(e=>`<tr><td>${esc(wat(e.CreatedAt))}</td><td>${esc(e.Type)}</td><td>${esc(e.Actor)}</td><td>${esc(e.Reason)}</td></tr>`).join(''));status('Selected reminder history loaded.');}
    $('arHistoryForm').onsubmit=e=>{e.preventDefault();run(()=>history());};$('arHistoryNext').onclick=()=>run(()=>history(historyNext));
    $('arListForm').onsubmit=e=>{e.preventDefault();run(()=>list());};$('arRefreshList').onclick=()=>run(()=>list(null,true));$('arNext').onclick=()=>run(()=>list(next));
    $('arListForm').onchange=()=>{invalidate();const closed=!['Queued','Sending','Uncertain'].includes($('arStatus').value);$('arDates').hidden=!closed;for(const el of $('arDates').querySelectorAll('input'))el.required=closed;};
    $('arHistoryForm').onchange=()=>{$('arHistory').replaceChildren();$('arHistoryNext').hidden=true;historyNext=null;};
    for(const id of ['arQueueForm','arChangeForm'])$(id).oninput=()=>dirty.add(id);
    for(const el of $('arHistoryForm').querySelectorAll('input'))el.required=true;
    return {permissions,invalidate,contextChanged:clearDetail,clear(){clearDetail();invalidate();$('arSection').open=false;}};
  }};
})();
