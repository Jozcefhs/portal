(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const wat=v=>new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}),time=v=>new Date(v).toLocaleTimeString('en-GB',{timeZone:'Africa/Lagos',hour:'2-digit',minute:'2-digit'});
  let token='',state=null,clinic=null,next=null,busy=false,timer,epoch=0;
  const controllers=new Set();
  const cache=new Map(),pending=new Map();
  const message=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
  function clearChoice(){clinic=null;next=null;$('clinics').replaceChildren();$('slots').replaceChildren();$('slotSection').hidden=$('next').hidden=true;$('bookForm').reset();}
  function close(){epoch++;for(const c of controllers)c.abort();controllers.clear();token='';state=null;cache.clear();pending.clear();clearTimeout(timer);$('accessCode').value='';$('workspace').hidden=true;$('access').hidden=false;for(const k of ['patientName','identity','expires','bookingDetails'])$(k).replaceChildren();clearChoice();message('Private session closed. Open your personal link to return.');}
  function touch(){clearTimeout(timer);if(token)timer=setTimeout(close,20*60*1000);}
  async function api(action,args={},mutation=false){
    const key=JSON.stringify([action,args]);let request={action,...args};
    if(mutation){if(!pending.has(key))pending.set(key,{...request,RequestId:crypto.randomUUID()});request=pending.get(key);}
    const current=epoch,controller=new AbortController();controllers.add(controller);
    try{
      const response=await fetch('/api/hospital-patient-booking',{method:'POST',cache:'no-store',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(request)});
      const data=await response.json();if(current!==epoch)throw new DOMException('Private session closed','AbortError');
      if(!response.ok||!data.ok){if(response.status===401)close();if(mutation&&response.status>=400&&response.status<500&&response.status!==429)pending.delete(key);throw Error(data.message||'Could not complete this request.');}
      if(mutation){pending.delete(key);cache.clear();}touch();return data;
    }finally{controllers.delete(controller);}
  }
  async function cached(action,args,refresh=false){const key=JSON.stringify([action,args]);if(refresh)cache.delete(key);if(!cache.has(key)){cache.set(key,await api(action,args));if(cache.size>30)cache.delete(cache.keys().next().value);}return cache.get(key);}
  async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button:not(#exit)').forEach(b=>b.disabled=true);message('Please wait…');try{await fn();}catch(e){if(e.name!=='AbortError')message(e.message,true);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  async function context(){
    state=await api('context');$('access').hidden=true;$('workspace').hidden=false;$('accessCode').value='';clearChoice();
    $('patientName').textContent=state.patient.DisplayName;$('identity').textContent=`${state.patient.HospitalNumber} · ${state.branch.Name}`;$('expires').textContent=`Private link expires ${wat(state.ExpiresAt)} WAT`;
    $('day').min=state.Today;$('day').max=new Date(Date.parse(state.Today+'T00:00:00Z')+89*86400000).toISOString().slice(0,10);$('day').value ||= state.Today;
    const a=state.appointment,editable=!state.ReadOnly&&(!a||a.Status==='Scheduled'&&Date.parse(a.StartAt)>Date.now());
    $('confirmation').hidden=!a;$('chooser').hidden=!editable;$('cancelForm').hidden=!a||!editable;$('cancelForm').reset();
    $('bookingDetails').innerHTML=a?`<p><strong>${esc(a.Status)}</strong> · ${esc(a.Reference)}</p><p>${esc(wat(a.StartAt))}–${esc(time(a.EndAt))} WAT</p><p>${esc(a.ClinicianName)} · ${esc(a.Department)}</p>`:'';
    $('changeReason').hidden=!a;$('bookForm').elements.Reason.required=!!a;$('book').textContent=a?'Confirm new appointment time':'Confirm booking';$('chooseTitle').textContent=a?'Change appointment time':'Choose a clinic';
    message(state.ReadOnly?'Online changes are currently paused. Contact Reception.':a&&!editable?'Contact Reception if you need another booking or a change.':'Choose a clinic date when you are ready.');
  }
  async function clinics(cursor=null,refresh=false){
    clinic=null;$('slotSection').hidden=true;$('slots').replaceChildren();
    const r=await cached('clinics',{Day:$('day').value,...(cursor?{Cursor:cursor}:{})},refresh);next=r.next;$('next').hidden=!next;
    $('clinics').innerHTML=r.clinics.map((c,i)=>`<div class="clinic"><div><strong>${esc(c.ClinicianName)}</strong><br>${esc(c.Department)} · ${esc(c.SlotMinutes)} minutes</div><button type="button" data-clinic="${i}">Choose clinic</button></div>`).join('')||'<p>No self-booking clinics are available on this date. Try another date or contact Reception.</p>';
    $('clinics').querySelectorAll('[data-clinic]').forEach(b=>b.onclick=()=>run(()=>slots(r.clinics[b.dataset.clinic])));message('Selected clinic date loaded.');
  }
  async function slots(selected,refresh=false){
    const r=await cached('slots',{ScheduleId:selected.ScheduleId},refresh);clinic=r.clinic;$('slotSection').hidden=false;$('bookForm').reset();
    $('clinicName').textContent=`${clinic.ClinicianName} · ${clinic.Department}`;
    $('slots').innerHTML=r.slots.map(s=>`<label><input type="radio" name="StartAt" value="${esc(s.StartAt)}" required>${esc(time(s.StartAt))}–${esc(time(s.EndAt))}</label>`).join('')||'<p>No free times remain. Choose another clinic or date.</p>';
    $('book').hidden=!r.slots.length;message('Available times loaded. Your chosen time will be checked again when you confirm.');
  }
  $('accessForm').onsubmit=e=>{e.preventDefault();run(async()=>{let value=$('accessCode').value.trim();try{if(value.startsWith('https://')){const u=new URL(value);if(u.origin!==location.origin)throw Error('Use a personal link from this hospital address.');value=new URLSearchParams(u.hash.slice(1)).get('access')||'';}}catch(e){throw Error(e.message||'Use your complete personal link.');}if(!/^[a-f0-9]{64}$/.test(value))throw Error('Use the personal link issued by Reception.');token=value;cache.clear();await context();});};
  $('clinicForm').onsubmit=e=>{e.preventDefault();run(()=>clinics());};$('day').onchange=clearChoice;
  $('refreshClinics').onclick=()=>run(()=>clinics(null,true));$('next').onclick=()=>run(()=>clinics(next));$('refreshSlots').onclick=()=>run(()=>slots(clinic,true));
  $('bookForm').onsubmit=e=>{e.preventDefault();run(async()=>{const f=$('bookForm'),StartAt=new FormData(f).get('StartAt');if(!StartAt)throw Error('Choose an available time.');await api('book',{ScheduleId:clinic.ScheduleId,StartAt,Revision:state.appointment?.Revision||'',Reason:f.elements.Reason.value,ConfirmBooking:f.elements.ConfirmBooking.checked},true);await context();message('Your appointment is confirmed. You can preview or print the confirmation.');});};
  $('cancelForm').onsubmit=e=>{e.preventDefault();run(async()=>{const f=$('cancelForm');await api('cancel',{Revision:state.appointment.Revision,Reason:f.elements.Reason.value,ConfirmBooking:f.elements.ConfirmBooking.checked},true);await context();message('Appointment cancelled. Your earlier booking remains in the hospital history.');});};
  $('refresh').onclick=()=>run(async()=>{cache.clear();await context();});$('exit').onclick=close;$('print').onclick=()=>window.print();
  document.addEventListener('input',touch);window.addEventListener('pagehide',close);
  function receiveLink(){const value=new URLSearchParams(location.hash.slice(1)).get('access')||'';if(!location.hash)return;close();history.replaceState(null,'',location.pathname);$('accessCode').value=value;message('Your private link is ready. Select Open appointments.');}
  message('Open the personal booking link supplied by Reception.');receiveLink();window.addEventListener('hashchange',receiveLink);
})();
