const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Opens from the loaded workflow. Only an explicit Submit/Approve click reads
// the chosen sheets; filters and selections make no requests.
export function openAcademicBatchReview({sheets, label, request, scope, getBranchArmRows=null, isCurrent=()=>true, onSaved=()=>{}}) {
  const workflow=window.DynamaxAcademicWorkflow;
  const dialog=document.createElement('dialog');dialog.className='academic-test-review-dialog academic-batch-review-dialog';
  dialog.setAttribute('aria-label','Batch approve scores');
  const components=[...new Map(sheets.flatMap(sheet=>(sheet.AssessmentComponents||[]).map(row=>[row.Id,row.Name||'Test']))).entries()];
  dialog.innerHTML=`<header><div><small>Selected academic period</small><h2>Batch approve scores</h2></div><button type="button" data-close>Close</button></header>
    <p>Choose a test and subjects below. Submit saved marks first, then approve the submitted marks. Each sheet is checked again on the server.</p>
    <div class="academic-batch-controls"><label>Test<select data-test>${components.map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('')}<option value="">Full-term sheets</option></select></label>
    <label>Action<select data-action><option value="Approved">Approve submitted marks</option><option value="Submitted">Submit saved marks</option></select></label>
    <label>Find classroom or subject<input type="search" data-search></label></div>
    <p class="academic-batch-check">Complete students proceed; incomplete students remain pending.</p>
    <p class="muted">Missing tests, including illness or hospitalisation, stay pending. No marks are invented and no records are deleted. At least one student must have complete marks. Approved tests remain separate from full-term approval.</p>
    <div data-status-filter></div><div><button type="button" class="secondary" data-select>Select visible subjects</button><button type="button" class="secondary" data-clear>Clear selection</button></div>
    <div class="admin-table-wrap" data-list></div><p data-status role="status"></p><button type="button" data-apply>Approve selected</button>`;
  const selected=new Set(),outcomes=new Map();let busy=false;
  const test=dialog.querySelector('[data-test]'),action=dialog.querySelector('[data-action]'),search=dialog.querySelector('[data-search]');
  const apply=dialog.querySelector('[data-apply]'),message=dialog.querySelector('[data-status]');
  const scoped=()=>sheets.filter(sheet=>(!test.value||(sheet.AssessmentComponents||[]).some(row=>row.Id===test.value))
    &&label(sheet).toLowerCase().includes(search.value.toLowerCase()));
  let visibleRows=[];
  const reviewOf=sheet=>workflow.scoreReview(sheet,test.value);
  const eligible=sheet=>(!test.value||sheet.Status==='Draft')&&workflow.scoreStatus(reviewOf(sheet))===(action.value==='Approved'?'Submitted':'Draft');
  function renderList(){
    dialog.querySelector('[data-list]').innerHTML=`<table class="admin-table"><thead><tr><th>Select</th><th>Classroom / subject</th><th>Saved review</th><th>Outcome</th></tr></thead><tbody>${visibleRows.map(sheet=>{
      const review=reviewOf(sheet);
      const pending=review?.PendingStudentRefs?.length||0;
      return `<tr><td><input type="checkbox" data-sheet="${esc(sheet.SheetId)}" aria-label="Select ${esc(label(sheet))}"${selected.has(sheet.SheetId)?' checked':''}${busy||!eligible(sheet)?' disabled':''}></td><td>${esc(label(sheet))}</td><td>${workflow.badge(workflow.scoreStatus(review),review.Stale?'Changed — resubmit':review.Status||'Draft')}${pending?` · ${pending} pending`:''}</td><td>${esc(outcomes.get(sheet.SheetId)||'')}</td></tr>`;
    }).join('')||'<tr><td colspan="4">No loaded subjects match this status.</td></tr>'}</tbody></table>`;
    apply.textContent=`${action.value==='Submitted'?'Submit':'Approve'} selected (${selected.size})`;
    apply.disabled=busy||!selected.size;
    dialog.querySelectorAll('[data-close],[data-test],[data-action],[data-search],[data-select],[data-clear],[data-workflow-status],[data-workflow-stage]').forEach(el=>el.disabled=busy);
  }
  const control=workflow.mount({host:dialog.querySelector('[data-status-filter]'),getRows:scoped,
    statusOf:sheet=>workflow.scoreStatus(reviewOf(sheet)),stages:workflow.scoreStages,unit:'subject sheets',countArms:!!getBranchArmRows,
    ...(getBranchArmRows ? {getArmRows:()=>getBranchArmRows(test.value)} : {}),
    onChange:rows=>{visibleRows=rows;const visibleIds=new Set(rows.filter(eligible).map(row=>row.SheetId));for(const id of selected)if(!visibleIds.has(id))selected.delete(id);renderList();}});
  function render(){control.refresh();}
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  test.onchange=()=>{selected.clear();outcomes.clear();render();};
  action.onchange=()=>{selected.clear();outcomes.clear();render();};search.oninput=render;
  dialog.querySelector('[data-select]').onclick=()=>{visibleRows.filter(eligible).forEach(sheet=>selected.add(sheet.SheetId));render();};
  dialog.querySelector('[data-clear]').onclick=()=>{selected.clear();render();};
  dialog.querySelector('[data-list]').onchange=event=>{const id=event.target.dataset.sheet;if(id){if(event.target.checked)selected.add(id);else selected.delete(id);render();}};
  apply.onclick=async()=>{
    if(busy||!selected.size)return;
    if(!isCurrent()){message.textContent='The branch, user or academic period changed. Close this window and reopen it.';return;}
    const chosen=visibleRows.filter(sheet=>selected.has(sheet.SheetId)&&eligible(sheet));
    busy=true;outcomes.clear();render();let success=0,failed=0;
    try{
      for(let offset=0;offset<chosen.length;offset+=25){
        if(!isCurrent())throw new Error('The workspace changed. Remaining subjects were not processed.');
        message.textContent=`Checking selected subjects ${offset+1}–${Math.min(offset+25,chosen.length)} of ${chosen.length}…`;
        const result=await request('batchReviewAcademicScores',{...scope,Status:action.value,AllowPendingStudents:true,
          Items:chosen.slice(offset,offset+25).map(sheet=>({SheetId:sheet.SheetId,ClassId:sheet.ClassId,ArmId:sheet.ArmId,SubjectId:sheet.SubjectId,
            TeacherUsername:sheet.TeacherUsername,RevisionToken:sheet.RevisionToken,ComponentId:test.value}))});
        for(const row of result.batchReview||[]){
          outcomes.set(row.SheetId,row.message);if(row.ok){success++;selected.delete(row.SheetId);}else failed++;
          if(row.sheet){const index=sheets.findIndex(sheet=>sheet.SheetId===row.SheetId);if(index>=0)sheets[index]=row.sheet;if(isCurrent())onSaved(row.sheet);}
        }
        render();
      }
      message.textContent=`${success} processed; ${failed} need attention. Incomplete students remain pending. Other students can proceed to result calculation.`;
    }catch(error){message.textContent=`${success} confirmed; remaining outcomes need checking. ${error.message||'The request failed.'} Retry is safe for unchanged reviews.`;}
    finally{busy=false;render();}
  };
  document.body.appendChild(dialog);dialog.showModal();render();return dialog;
}
