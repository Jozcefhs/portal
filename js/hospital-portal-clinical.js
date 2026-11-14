(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.DynamaxHospitalClinicalSharing={create({host,api,run,status,getScope,allowed}){
    const box=document.createElement('details');box.className='clinical-sharing';host.append(box);
    box.innerHTML=`<summary>Share medical document with patient / guardian</summary><p>Only the current released result or completed, signed discharge can be shared. Select each authorised recipient separately. Sharing an invoice does not grant access to medical documents.</p><button type="button" data-load>Load recipients and release status</button><button type="button" data-next hidden>Next recipients</button><p data-ready role="status"></p><div data-editor hidden><label>Named portal recipient<select data-recipient></select></label><p data-sharing></p><form><label>Reason / consent record reference<textarea name="Reason" maxlength="1000" required rows="2"></textarea></label><label class="check-line"><input name="ConfirmClinicalReview" type="checkbox" required>I reviewed this current clinical document for patient release.</label><label class="check-line"><input name="ConfirmConsent" type="checkbox" required>I verified this named recipient’s authority and consent to receive this medical document.</label><div class="toolbar"><button data-publish>Share current document</button><button type="button" data-withdraw>Withdraw access to this document</button></div></form><p class="hint">Earlier signed versions stay in the medical record. Withdrawal stops future access; copies already printed or downloaded cannot be recalled. Reissued portal access needs fresh clinical authorisation.</p></div>`;
    const $=s=>box.querySelector(s);let loaded=null,recipient=null,sharing=null,scope=null;
    function clear(){loaded=recipient=sharing=scope=null;box.open=false;$('[data-editor]').hidden=true;$('[data-next]').hidden=true;$('[data-ready]').textContent='';$('select').replaceChildren();$('form').reset();box.hidden=!allowed();}
    function state(){const p=sharing?.publication;$('[data-sharing]').textContent=p?`${p.Status}${sharing.AccessChanged?' — recipient access was reissued; share again after checking consent':''}${p.SourceId!==loaded.SourceId?' — an earlier source version':''}`:'Not shared with this recipient.';
      $('[data-publish]').disabled=!loaded.ready||!['Invited','Active'].includes(recipient?.Status)||!allowed();$('[data-withdraw]').disabled=p?.Status!=='Published'||!allowed();}
    async function select(){recipient=loaded.recipients.find(r=>r.GrantId===$('select').value);$('form').reset();sharing=null;if(!recipient){$('[data-editor]').hidden=true;return;}
      sharing=await api('clinicalPortalSharing',{...scope,GrantId:recipient.GrantId});$('[data-editor]').hidden=false;state();}
    async function load(cursor){const chosen=recipient?.GrantId;scope=getScope();if(!scope)throw Error('Open a clinical record first.');loaded=await api('clinicalPortalContext',{...scope,...(cursor?{Cursor:cursor}:{})});
      $('[data-ready]').textContent=loaded.ready?'Current signed document is ready for clinician sharing.':loaded.message;$('[data-next]').hidden=!loaded.next;
      $('select').innerHTML=loaded.recipients.map(g=>`<option value="${esc(g.GrantId)}">${esc(g.RecipientName)} · ${esc(g.Kind)} · ${esc(g.Relationship)} · ${esc(g.Status)}</option>`).join('');
      if(!loaded.recipients.length)$('[data-ready]').textContent+=' No portal recipients. Reception must issue private patient or guardian access first.';if(loaded.recipients.some(g=>g.GrantId===chosen))$('select').value=chosen;await select();}
    $('[data-load]').onclick=()=>run(()=>load());$('[data-next]').onclick=()=>run(()=>load(loaded.next));$('select').onchange=()=>run(select);
    $('form').onsubmit=e=>{e.preventDefault();run(async()=>{if(!recipient||!loaded.ready)throw Error('Load the current document and recipient first.');const f=$('form');
      await api('publishClinicalPortalDocument',{...scope,GrantId:recipient.GrantId,GrantRevision:recipient.Revision,SourceId:loaded.SourceId,SourceRevision:loaded.SourceRevision,ParentRevision:loaded.ParentRevision,
        Revision:sharing?.publication?.Revision||'',Reason:f.elements.Reason.value,ConfirmConsent:f.elements.ConfirmConsent.checked,ConfirmClinicalReview:f.elements.ConfirmClinicalReview.checked},true);
      await load();status('Medical document shared with the selected recipient. Signed originals preserved.');});};
    $('[data-withdraw]').onclick=()=>run(async()=>{const reason=$('form').elements.Reason.value.trim();if(!reason)throw Error('Enter the reason for withdrawing this document.');
      await api('withdrawClinicalPortalDocument',{...scope,GrantId:recipient.GrantId,Revision:sharing.publication.Revision,Reason:reason},true);await select();status('Document access withdrawn. Original medical records preserved.');});
    clear();return {clear,permissions:()=>{box.hidden=!allowed();}};
  }};
})();
