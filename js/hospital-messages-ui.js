(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):'';
  window.DynamaxHospitalMessages={create({host,api,run,status,staff=false,writable=()=>true,getPatient=()=>null}){
    let current=null,recipients=[],recipientCursor=null,person=null,inbox=null,pages=[],pageIndex=0;
    const cache=new Map(),pending=new Map(),$=s=>host.querySelector(s);
    host.innerHTML=`<h2>Patient messages</h2><p>Private conversations with the care team. This is not an emergency service. Contact the hospital directly for urgent care. No email or push alerts are sent; use Refresh to check replies.</p>
      <form data-inbox class="filters"><label>Conversations<select name="Status"><option>Open</option><option>Closed</option></select></label><label data-dates hidden>From<input type="date" name="From"></label><label data-dates hidden>To<input type="date" name="To"></label><button>Load conversations</button><button type="button" data-refresh>Refresh inbox</button></form>
      <p data-list-note>No conversations loaded.</p><div data-list class="table-wrap"></div><div class="actions"><button data-prev hidden>Previous page</button><button data-next hidden>Next page</button></div>
      <section data-compose hidden><h3>Open a private conversation</h3><p data-person></p><p>Verify the named recipient’s identity and authority to discuss care. Each guardian has separate access.</p><form data-new><label>Recipient<select name="GrantId" required></select></label><button type="button" data-refresh-recipients>Refresh recipients</button><button type="button" data-more-recipients hidden>More recipients</button><label>Subject<input name="Subject" maxlength="160" required></label><label>Message<textarea name="Text" maxlength="4000" rows="4" required></textarea></label><label>Consent / authority check<textarea name="Reason" maxlength="1000" rows="2" required></textarea></label><label><input type="checkbox" name="ConfirmConsent" required> I verified this recipient’s authority to discuss this patient’s care.</label><button>Start conversation</button><button type="button" data-cancel-new>Cancel</button></form></section>
      <section data-thread hidden><h3 data-title></h3><p data-meta></p><div class="actions"><button data-reload-thread>Refresh conversation</button><button data-dismiss>Close view</button></div><p data-access></p><div data-entries></div><button data-more hidden>Next messages</button><form data-reply><label>Reply<textarea name="Text" maxlength="4000" rows="4" required></textarea></label><button>Send reply</button></form>${staff?'<form data-state><label>Reason for status change<input name="Reason" maxlength="1000" required></label><button data-toggle>Close conversation</button></form>':''}</section>`;
    async function call(action,body={},write=false){
      const key=JSON.stringify([action,body]);if(write&&!pending.has(key))pending.set(key,crypto.randomUUID());
      const data=await api(action,{...body,...(write?{RequestId:pending.get(key)}:{})},write);if(write)pending.delete(key);return data;
    }
    function values(){const form=$('[data-inbox]');return {Status:form.elements.Status.value,...(form.elements.Status.value==='Closed'?{From:form.elements.From.value,To:form.elements.To.value}:{})};}
    function renderList(data){inbox=data;$('[data-list-note]').textContent=`${data.rows.length} conversations on this page. Loaded pages are retained; Refresh checks for changes.`;
      $('[data-prev]').hidden=pageIndex===0;$('[data-next]').hidden=!data.next;
      $('[data-list]').innerHTML=data.rows.length?`<table class="message-list"><thead><tr><th>Conversation</th><th>Status / updated (WAT)</th><th></th></tr></thead><tbody>${data.rows.map((r,i)=>`<tr><td>${esc(r.Subject)}${staff?`<br>${esc(r.PatientName)} · ${esc(r.HospitalNumber)}<br>${esc(r.RecipientName)} (${esc(r.RecipientKind)})`:''}</td><td>${esc(r.Status==='Closed'?'Closed':r.LastSender==='Recipient'?'Awaiting care team':'Awaiting recipient')}<br>${esc(time(r.UpdatedAt))}</td><td><button data-open="${i}">Open conversation</button></td></tr>`).join('')}</tbody></table>`:'<p>No conversations in this selection. Only conversations opened for your access are available.</p>';
      host.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>run(()=>openThread(data.rows[Number(b.dataset.open)].ThreadId)));
    }
    async function load(refresh=false,cursor=null,index=0){const body={...values(),...(cursor?{Cursor:cursor}:{})},key=JSON.stringify(body);if(refresh)cache.clear();let data=cache.get(key);
      if(!data){data=await call('messageInbox',body);if(cache.size>=10)cache.delete(cache.keys().next().value);cache.set(key,data);}if(!index)pages=[];pages[index]={body,key};pageIndex=index;renderList(data);status('Conversations loaded.');}
    function renderEntries(data,append){const html=data.rows.map(r=>`<article class="hospital-message"><strong>${esc(r.SenderName)}</strong> · ${esc(r.Sender)}<br><small>${esc(time(r.CreatedAt))} WAT</small><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.Text)}</p></article>`).join('');
      if(append)$('[data-entries]').insertAdjacentHTML('beforeend',html);else $('[data-entries]').innerHTML=html;
      $('[data-more]').hidden=!data.next;$('[data-more]').onclick=()=>run(()=>openThread(data.thread.ThreadId,data.next,true));}
    async function openThread(ThreadId,cursor=null,append=false){
      // Hide old content before rechecking authority; retain unsent text on refresh.
      const same=current?.ThreadId===ThreadId;$('[data-thread]').hidden=true;
      if(!append)$('[data-entries]').replaceChildren();if(!same)$('[data-reply]').reset();
      current=null;const data=await call('messageThread',{ThreadId,...(cursor?{Cursor:cursor}:{})});current=data.thread;
      if(inbox){inbox={...inbox,rows:inbox.rows.map(r=>r.ThreadId===ThreadId?current:r).filter(r=>r.Status===values().Status)};renderList(inbox);}
      $('[data-title]').textContent=current.Subject;$('[data-meta]').textContent=`${staff?current.PatientName+' · '+current.RecipientName+' · ':''}${current.Status} · ${current.MessageCount} messages`;
      $('[data-access]').textContent=data.AccessMessage||'';$('[data-reply]').hidden=!data.CanReply||!writable();
      if(staff){$('[data-state]').hidden=!writable();$('[data-toggle]').textContent=current.Status==='Open'?'Close conversation':'Reopen conversation';}
      renderEntries(data,append);$('[data-thread]').hidden=false;status('Conversation loaded.');
    }
    $('[data-inbox]').onsubmit=e=>{e.preventDefault();run(()=>load());};$('[data-refresh]').onclick=()=>{if($('[data-inbox]').reportValidity())run(()=>load(true));};
    $('[data-inbox]').onchange=()=>{const closed=$('[data-inbox]').elements.Status.value==='Closed';host.querySelectorAll('[data-dates]').forEach(e=>{e.hidden=!closed;e.querySelector('input').required=closed;});inbox=null;pages=[];pageIndex=0;$('[data-list]').replaceChildren();$('[data-prev]').hidden=$('[data-next]').hidden=true;};
    $('[data-next]').onclick=()=>run(()=>load(false,inbox.next,pageIndex+1));$('[data-prev]').onclick=()=>run(async()=>{const p=pages[--pageIndex],data=cache.get(p.key)||await call('messageInbox',p.body);renderList(data);status('Loaded page restored.');});
    $('[data-reload-thread]').onclick=()=>{if(current)run(()=>openThread(current.ThreadId));};$('[data-dismiss]').onclick=()=>{current=null;$('[data-thread]').hidden=true;$('[data-entries]').replaceChildren();$('[data-reply]').reset();};
    $('[data-reply]').onsubmit=e=>{e.preventDefault();if(!current)return;run(async()=>{const body={ThreadId:current.ThreadId,Revision:current.Revision,Text:$('[data-reply]').elements.Text.value};await call('replyMessageThread',body,true);$('[data-reply]').reset();cache.clear();await openThread(body.ThreadId);status('Reply sent.');});};
    if(staff)$('[data-state]').onsubmit=e=>{e.preventDefault();if(!current)return;run(async()=>{const ThreadId=current.ThreadId;await call('closeMessageThread',{ThreadId,Revision:current.Revision,Status:current.Status==='Open'?'Closed':'Open',Reason:$('[data-state]').elements.Reason.value},true);$('[data-state]').reset();cache.clear();await openThread(ThreadId);await load(true);status('Conversation status saved.');});};
    async function loadRecipients(cursor=null){const data=await call('messageRecipients',{PatientId:person.PatientId,...(cursor?{Cursor:cursor}:{})});recipients=data.rows;recipientCursor=data.next;$('[data-more-recipients]').hidden=!data.next;
      $('[data-new]').elements.GrantId.innerHTML='<option value="">Choose verified recipient</option>'+recipients.map(g=>`<option value="${esc(g.GrantId)}" ${g.Available?'':'disabled'}>${esc(g.RecipientName)} · ${esc(g.Kind)} · ${esc(g.Relationship||'')} (${esc(g.Status)})</option>`).join('');}
    $('[data-refresh-recipients]').onclick=()=>run(()=>loadRecipients());
    $('[data-more-recipients]').onclick=()=>run(()=>loadRecipients(recipientCursor));$('[data-cancel-new]').onclick=()=>{$('[data-compose]').hidden=true;$('[data-new]').reset();person=null;};
    $('[data-new]').onsubmit=e=>{e.preventDefault();run(async()=>{const f=$('[data-new]'),g=recipients.find(r=>r.GrantId===f.elements.GrantId.value);if(!g)throw Error('Choose a verified recipient.');
      const result=await call('startMessageThread',{PatientId:person.PatientId,GrantId:g.GrantId,GrantRevision:g.Revision,Subject:f.elements.Subject.value,Text:f.elements.Text.value,Reason:f.elements.Reason.value,ConfirmConsent:f.elements.ConfirmConsent.checked},true);
      f.reset();$('[data-compose]').hidden=true;cache.clear();await openThread(result.ThreadId);status('Private conversation opened.');});};
    return {async open(){if(!inbox)await load();},async compose(){const target=getPatient();if(!target)throw Error('Select an existing patient first.');if(person?.PatientId!==target.PatientId)$('[data-new]').reset();person=target;$('[data-person]').textContent=`${person.DisplayName} · ${person.HospitalNumber}`;await loadRecipients();$('[data-compose]').hidden=false;$('[data-compose]').scrollIntoView({block:'start'});},
      clear(){current=inbox=person=null;recipients=[];pages=[];pageIndex=0;cache.clear();pending.clear();host.querySelectorAll('form').forEach(f=>f.reset());host.querySelectorAll('[data-dates]').forEach(e=>{e.hidden=true;e.querySelector('input').required=false;});for(const s of ['[data-list]','[data-entries]','[data-title]','[data-meta]','[data-person]','[data-access]'])$(s).replaceChildren();$('[data-new]').elements.GrantId.replaceChildren();for(const s of ['[data-compose]','[data-thread]','[data-prev]','[data-next]'])$(s).hidden=true;$('[data-list-note]').textContent='No conversations loaded.';}};
  }};
})();
