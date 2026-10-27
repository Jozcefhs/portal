const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function openAcademicTestReviews({sheet,payload,request,permissions,title,isCurrent=()=>true,onLoaded=()=>{}}){
  const dialog=document.createElement('dialog');dialog.className='academic-test-review-dialog';
  dialog.setAttribute('aria-label','Review individual tests');
  dialog.innerHTML=`<header><div><small>Saved assessment marks</small><h2>Review individual tests</h2><p>${esc(title)}</p></div><button type="button" data-review-close>Close</button></header>
    <p>Submit and approve complete students independently. Students with missing marks remain pending and do not block classmates. Reviews use saved marks; save changes before reviewing. Each student's full-term result still requires their required assessments.</p>
    <p data-review-message role="status"></p><div class="admin-table-wrap" data-review-content></div>`;
  dialog.querySelector('[data-review-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.appendChild(dialog);dialog.showModal();
  let busy=false,rows=[];
  const message=dialog.querySelector('[data-review-message]');
  function render(){
    const locked=sheet.Status!=='Draft';
    dialog.querySelector('[data-review-content]').innerHTML=`${locked?'<p>This full sheet is already submitted or approved. Its existing full-sheet workflow still applies.</p>':''}<table class="admin-table"><thead><tr><th>Test</th><th>Complete saved marks</th><th>Review status</th><th>Action</th></tr></thead><tbody>${rows.map(row=>{
      const target=({Draft:'Submitted',Submitted:'Approved',Approved:'Locked'})[row.Status];
      const allowed=target==='Submitted'?permissions.canEnterScores:target==='Approved'?permissions.canReviewScores:target==='Locked'?permissions.canApproveScores:false;
      const label=({Submitted:'Submit',Approved:'Approve',Locked:'Lock'})[target];
      return `<tr><td><strong>${esc(row.Name)}</strong></td><td>${row.CompleteCount} / ${row.RosterCount}${row.MissingCount?`<small>${row.MissingCount} students remain pending</small>`:''}</td><td>${esc(row.Status)}${row.Stale?'<small>Marks or roster changed — resubmit</small>':''}</td><td>${allowed?`<button type="button" data-review-id="${esc(row.ComponentId)}" data-review-target="${target}"${busy||locked||!row.CompleteCount?' disabled':''}>${label} ${esc(row.Name)}</button>`:''}${permissions.canManageScoreCorrections&&row.Status!=='Draft'?`<button type="button" class="secondary" data-review-id="${esc(row.ComponentId)}" data-review-target="Draft"${busy||locked?' disabled':''}>Reopen review</button>`:''}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  async function load(){
    if(!isCurrent())throw new Error('The school workspace changed. Close this review and reopen it in the selected branch.');
    const result=await request('getAcademicScorebookContext',payload(sheet));
    if(!dialog.isConnected||!isCurrent())return;
    sheet=result.scorebookSnapshot.sheet;rows=result.componentReviews||[];onLoaded(result);render();
  }
  dialog.addEventListener('click',async event=>{
    const button=event.target.closest('[data-review-id]');if(!button||busy)return;
    const row=rows.find(item=>item.ComponentId===button.dataset.reviewId),target=button.dataset.reviewTarget;
    let reason='';
    if(target==='Draft'){
      reason=await window.DynamaxDialogs.prompt({title:'Reopen test review',label:'Reason',required:true,confirmText:'Reopen review'});if(!reason)return;
    }
    if(!isCurrent()){message.textContent='The workspace changed. Close this review and reopen it.';return;}
    busy=true;render();message.textContent=`Updating ${row.Name}…`;
    try{
      const result=await request('changeAcademicScoreSheetStatus',payload(sheet,{ComponentId:row.ComponentId,Status:target,Reason:reason,AllowPendingStudents:true}));
      await load();message.textContent=result.message;
    }catch(error){message.textContent=error.message||'The test review could not be updated.';}
    finally{busy=false;if(dialog.isConnected)render();}
  });
  message.textContent='Checking saved tests for this classroom and subject…';
  try{await load();message.textContent='Saved marks checked. Choose the completed test to review.';}
  catch(error){message.textContent=error.message||'Test reviews could not be loaded.';}
  return dialog;
}
