(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.DynamaxHospitalPortalAccess={create({api,run,writable,status,getPatient}){
    let rows=[],cursor=null,target=null,invitation='';
    $('bookPatientAppointment').insertAdjacentHTML('afterend',`<button type="button" id="hpAccessOpen" data-write="patients.write">Patient / guardian portal access</button>
      <section id="hpAccessPanel" hidden class="portal-access-panel"><h3>Patient and guardian financial access</h3>
      <p>Authorise each recipient separately. Access is limited to this patient’s invoices and receipts in the selected branch. NFC cards and booking links do not grant access.</p>
      <div class="actions"><a href="/hospital-portal.html" target="_blank" rel="noopener noreferrer">Open patient portal</a><button type="button" id="hpAccessRefresh">Refresh access</button><button type="button" id="hpAccessClose">Close</button></div>
      <div id="hpAccessRows"></div><button id="hpAccessMore" type="button" hidden>Next recipients</button>
      <form id="hpAccessForm"><h4 id="hpAccessHeading">Authorise a recipient</h4><div class="grid">
        <label>Recipient<select name="Kind"><option>Patient</option><option>Guardian</option></select></label>
        <label>Recipient’s full name<input name="RecipientName" maxlength="160" required></label>
        <label>Verified email or phone<input name="Contact" maxlength="160" required></label>
        <label>Relationship to patient<input name="Relationship" maxlength="80" placeholder="Self, parent, legal guardian…"></label>
        <label>Access until<input type="date" name="AccessUntil" required></label>
        <label>Authority / reason<input name="Reason" maxlength="500" required placeholder="Patient consent or verified guardian authority"></label></div>
        <label><input type="checkbox" name="ConfirmIdentity" required> I verified this recipient’s identity.</label>
        <label><input type="checkbox" name="ConfirmAuthority" required> The patient consents, or I verified the guardian’s authority to access financial documents.</label>
        <p>Replacing an invitation signs this recipient out on every device and requires a new password.</p>
        <div class="actions"><button type="submit">Create private invitation</button><button type="button" id="hpAccessNew">New recipient</button></div>
      </form><div id="hpAccessInvitation" hidden><label>Private activation link — share only with this recipient<input id="hpAccessLink" readonly></label><p id="hpAccessExpiry"></p></div></section>`);
    const form=$('hpAccessForm');
    function reset(){target=null;invitation='';form.reset();const d=new Date();d.setUTCFullYear(d.getUTCFullYear()+1);form.elements.AccessUntil.value=d.toISOString().slice(0,10);
      for(const name of ['Kind','RecipientName','Contact','Relationship'])form.elements[name].disabled=false;
      $('hpAccessHeading').textContent='Authorise a recipient';$('hpAccessInvitation').hidden=true;$('hpAccessLink').value='';}
    function clear(){rows=[];cursor=null;reset();$('hpAccessPanel').hidden=true;$('hpAccessRows').replaceChildren();$('hpAccessMore').hidden=true;}
    function permissions(){const allowed=writable('patients.write');$('hpAccessOpen').hidden=!allowed;if(!allowed)clear();if(target)for(const name of ['Kind','RecipientName','Contact','Relationship'])form.elements[name].disabled=true;}
    function render(){
      $('hpAccessRows').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>Recipient</th><th>Status / expiry</th><th>Access</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.RecipientName)}<br>${esc(r.Kind)} · ${esc(r.Relationship)}<br>${esc(r.Contact)}</td><td>${esc(r.Status)}<br>${esc(r.AccessUntil.slice(0,10))}</td><td><button type="button" data-reinvite="${i}">Replace invitation</button> <button type="button" data-revoke="${i}" ${r.Status==='Revoked'?'disabled':''}>Revoke access</button></td></tr>`).join('')}</tbody></table></div>`:'<p>No portal recipients have been authorised for this patient in this branch.</p>';
      $('hpAccessMore').hidden=!cursor;
      $('hpAccessRows').querySelectorAll('[data-reinvite]').forEach(b=>b.onclick=()=>{reset();target=rows[Number(b.dataset.reinvite)];for(const k of ['Kind','RecipientName','Contact','Relationship']){form.elements[k].value=target[k];form.elements[k].disabled=true;}$('hpAccessHeading').textContent=`Replace access — ${target.RecipientName}`;form.scrollIntoView({block:'nearest'});});
      $('hpAccessRows').querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>run(async()=>{const row=rows[Number(b.dataset.revoke)],Reason=window.prompt(`Reason for revoking access for ${row.RecipientName}`);if(!Reason?.trim())return;
        await api('revokePatientPortalAccess',{PatientId:getPatient().PatientId,GrantId:row.GrantId,Revision:row.Revision,Reason},true);reset();await load();status('Portal access revoked. Existing sessions can no longer load documents.');}));
    }
    async function load(next=null){const person=getPatient();if(!person)return;const data=await api('patientPortalAccess',{PatientId:person.PatientId,...(next?{Cursor:next}:{})});rows=data.grants;cursor=data.next;render();}
    $('hpAccessOpen').onclick=()=>run(async()=>{clear();$('hpAccessPanel').hidden=false;await load();status('Patient portal access loaded.');});
    $('hpAccessRefresh').onclick=()=>run(async()=>{reset();await load();status('Portal access refreshed.');});$('hpAccessMore').onclick=()=>run(()=>load(cursor));
    $('hpAccessClose').onclick=clear;$('hpAccessNew').onclick=reset;
    form.onsubmit=e=>{e.preventDefault();run(async()=>{
      if(!getPatient())return;invitation ||= Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
      const body={PatientId:getPatient().PatientId,InvitationToken:invitation,AccessUntil:form.elements.AccessUntil.value,Reason:form.elements.Reason.value,
        ConfirmIdentity:form.elements.ConfirmIdentity.checked,ConfirmAuthority:form.elements.ConfirmAuthority.checked,...(target?{GrantId:target.GrantId,Revision:target.Revision}:
        Object.fromEntries(['Kind','RecipientName','Contact','Relationship'].map(k=>[k,form.elements[k].value])))};
      const saved=await api('issuePatientPortalAccess',body,true),link=new URL('/hospital-portal.html',location.origin);link.hash=new URLSearchParams({code:saved.AccessCode,invite:invitation}).toString();
      reset();$('hpAccessLink').value=link.href;$('hpAccessExpiry').textContent=`Activate before ${new Date(saved.InvitationExpiresAt).toLocaleString()}. This invitation can be used once.`;$('hpAccessInvitation').hidden=false;
      await load();status('Private portal invitation ready. Share it only with the verified recipient.');
    });};
    reset();return {clear,permissions};
  }};
})();
