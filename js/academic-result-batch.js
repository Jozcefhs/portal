const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stages=['Calculated Draft','Reviewed','Approved','Published','Locked'];

export function openAcademicResultBatch({results,memberships,label,title,request,scope,permissions,isCurrent=()=>true,onSaved=()=>{}}) {
  const dialog=document.createElement('dialog');dialog.className='academic-test-review-dialog academic-batch-review-dialog';
  dialog.setAttribute('aria-label','Batch review, approve and publish results');
  const actions=[...(permissions.canReviewResults?[['Reviewed','Review drafts'],['Approved','Approve reviewed results']]:[]),
    ...(permissions.canPublishResults?[['Published','Publish approved results']]:[]),
    ...(permissions.canReviewResults&&permissions.canPublishResults?[['ReviewApprovePublish','Review, approve and publish ready results']]:[])];
  dialog.innerHTML=`<header><div><small>${esc(title)}</small><h2>Batch review, approve and publish results</h2></div><button type="button" data-close>Close</button></header>
    <p>Choose the report type, action and students. Complete results can proceed while students with missing assessments remain pending. Publishing makes results available only to parents permitted by the academic policy.</p>
    <div class="academic-batch-controls"><label>Report type<select data-type><option>Mid-Term</option><option>End of Term</option></select></label>
    <label>Action<select data-action aria-label="Action">${actions.map(([value,name])=>`<option value="${value}">${esc(name)}</option>`).join('')}</select></label>
    <label>Find student<input type="search" data-search placeholder="Name or admission number"></label></div>
    <p data-pending class="muted"></p><button type="button" class="secondary" data-select>Select eligible visible students</button><button type="button" class="secondary" data-clear>Clear selection</button>
    <div class="admin-table-wrap" data-list></div><p data-status role="status" aria-live="polite"></p><button type="button" data-apply>Apply to selected students</button>`;
  const type=dialog.querySelector('[data-type]'),action=dialog.querySelector('[data-action]'),search=dialog.querySelector('[data-search]');
  const apply=dialog.querySelector('[data-apply]'),message=dialog.querySelector('[data-status]');
  type.value=results.some(row=>row.ResultType==='Mid-Term')?'Mid-Term':'End of Term';
  const selected=new Set(),outcomes=new Map();let busy=false;
  const reportRows=()=>results.filter(row=>(row.ResultType||'End of Term')===type.value);
  const visible=()=>reportRows().filter(row=>`${label(row)} ${row.StudentRef}`.toLowerCase().includes(search.value.toLowerCase()));
  const eligible=row=>{
    if(row.CalculationPending||row.SubjectChangeRecalculationRequired)return false;
    const index=stages.indexOf(row.Status);
    return action.value==='ReviewApprovePublish'?index>=0&&index<3:index===stages.indexOf(action.value)-1;
  };
  function render(){
    const rows=reportRows(),missing=memberships.filter(row=>!rows.some(result=>result.StudentRef===row.StudentRef));
    const pending=rows.filter(row=>row.CalculationPending||row.SubjectChangeRecalculationRequired);
    dialog.querySelector('[data-pending]').textContent=`${pending.length} results pending assessments or recalculation; ${missing.length} students have no calculated ${type.value.toLowerCase()} result. They will not block eligible students. Calculate their complete results when ready.`;
    dialog.querySelector('[data-list]').innerHTML=`<table class="admin-table"><thead><tr><th>Select</th><th>Student</th><th>Current status</th><th>Outcome</th></tr></thead><tbody>${visible().map(row=>`<tr>
      <td><input type="checkbox" data-result="${esc(row.ResultId)}" aria-label="Select ${esc(label(row))}"${selected.has(row.ResultId)?' checked':''}${busy||!eligible(row)?' disabled':''}></td>
      <td>${esc(label(row))}<small>${esc(row.StudentRef)}</small></td><td>${esc(row.CalculationPending?'Pending assessments':row.SubjectChangeRecalculationRequired?'Recalculation required':row.Status)}</td>
      <td>${esc(outcomes.get(row.ResultId)||'')}</td></tr>`).join('')||'<tr><td colspan="4">No calculated results match this selection.</td></tr>'}</tbody></table>`;
    const verb={Reviewed:'Review',Approved:'Approve',Published:'Publish',ReviewApprovePublish:'Review, approve and publish'}[action.value]||'Process';
    apply.textContent=`${verb} selected (${selected.size})`;apply.disabled=busy||!selected.size;
    dialog.querySelectorAll('[data-type],[data-action],[data-search],[data-close],[data-select],[data-clear]').forEach(el=>el.disabled=busy);
  }
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  type.onchange=action.onchange=()=>{selected.clear();outcomes.clear();message.textContent='';render();};search.oninput=render;
  dialog.querySelector('[data-select]').onclick=()=>{visible().filter(eligible).forEach(row=>selected.add(row.ResultId));render();};
  dialog.querySelector('[data-clear]').onclick=()=>{selected.clear();render();};
  dialog.querySelector('[data-list]').onchange=event=>{const id=event.target.dataset.result;if(id){if(event.target.checked)selected.add(id);else selected.delete(id);render();}};
  apply.onclick=async()=>{
    if(busy||!selected.size)return;
    if(!isCurrent()){message.textContent='The branch, classroom, user or academic period changed. Close this window and reopen it.';return;}
    const chosen=reportRows().filter(row=>selected.has(row.ResultId)&&eligible(row));
    busy=true;outcomes.clear();render();const counts={Updated:0,Pending:0,'Already complete':0,Other:0};let warnings=0;
    try{
      for(let offset=0;offset<chosen.length;offset+=25){
        if(!isCurrent())throw new Error('The workspace changed. Remaining students were not processed.');
        message.textContent=`Checking students ${offset+1}–${Math.min(offset+25,chosen.length)} of ${chosen.length}…`;
        const items=chosen.slice(offset,offset+25).map(row=>({ResultId:row.ResultId,RevisionToken:row.RevisionToken}));
        const response=await request('batchChangeAcademicResultStatus',{...scope,Status:action.value,ResultType:type.value,Items:items});
        const confirmed=new Set((Array.isArray(response.batchResults)?response.batchResults:[]).map(row=>row.ResultId));
        if(!Array.isArray(response.batchResults)||response.batchResults.length!==items.length||confirmed.size!==items.length
          ||items.some(row=>!confirmed.has(row.ResultId)))throw new Error('The server did not confirm every selected student. Refresh before continuing.');
        for(const outcome of response.batchResults){
          outcomes.set(outcome.ResultId,outcome.message);counts[outcome.Outcome in counts?outcome.Outcome:'Other']++;
          selected.delete(outcome.ResultId);
          if(outcome.result){const index=results.findIndex(row=>row.ResultId===outcome.ResultId);if(index>=0)results[index]=outcome.result;}
        }
        warnings+=response.notificationWarnings||0;if(isCurrent())onSaved(response);render();
      }
      message.textContent=`${counts.Updated} advanced; ${counts.Pending} pending; ${counts['Already complete']} already complete; ${counts.Other} need attention.${warnings?` ${warnings} parent notifications need checking; saved publication statuses are shown above.`:''}`;
    }catch(error){message.textContent=`${counts.Updated} confirmed. ${error.message||'The batch could not be confirmed.'} Unconfirmed selections are retained; retrying does not repeat completed stages.`;}
    finally{busy=false;render();}
  };
  document.body.appendChild(dialog);dialog.showModal();render();return dialog;
}
