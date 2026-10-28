const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Lagos'}).format(new Date(value))+' WAT':'Not recorded';

export function openAcademicDuplicateScoreReview({request,scope,studentName,subjectName,testName,isCurrent=()=>true,onSaved=()=>{}}){
  const dialog=document.createElement('dialog');dialog.className='academic-test-review-dialog';
  dialog.setAttribute('aria-label','Resolve duplicate score');
  dialog.innerHTML=`<form><header><h2>Resolve duplicate score</h2><button type="button" data-close aria-label="Close">×</button></header>
    <p><strong>${esc(studentName)}</strong> · ${esc(scope.StudentRef)}<br>${esc(subjectName)} · ${esc(testName)}</p>
    <p>Choose the saved mark to use in the student’s current classroom. Both original versions remain in the audit history. Changing a mark requires the normal score review; it does not publish a result.</p>
    <div data-candidates></div><label>Reason for this decision<textarea data-reason required minlength="5" maxlength="1000" rows="3"></textarea></label>
    <p data-message role="status" aria-live="polite"></p><footer><button type="button" data-retry hidden>Reload competing marks</button><button type="button" data-close>Cancel</button><button type="submit" data-save disabled>Save resolution</button></footer></form>`;
  document.body.append(dialog);dialog.showModal();
  let review=null,busy=false;
  const form=dialog.querySelector('form'),message=dialog.querySelector('[data-message]'),save=dialog.querySelector('[data-save]');
  const selected=()=>form.querySelector('input[name="chosenScore"]:checked')?.value;
  const update=()=>{save.disabled=busy||!review||!selected()||form.querySelector('[data-reason]').value.trim().length<5;};
  const lock=value=>{busy=value;dialog.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=value);update();};
  dialog.addEventListener('close',()=>dialog.remove());
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{if(!busy)dialog.close();});
  form.addEventListener('input',update);
  async function load(){
    if(busy)return;review=null;lock(true);message.textContent='Loading competing saved marks…';dialog.querySelector('[data-retry]').hidden=true;
    try{
      if(!isCurrent())throw Error('The classroom or academic period changed. Close and reopen this review.');
      const result=await request('getAcademicDuplicateScoreReview',scope);
      if(!isCurrent())throw Error('The classroom or academic period changed. Close and reopen this review.');
      review=result.duplicateReview;
      if(!review?.RevisionToken||!Array.isArray(review.candidates))throw Error('The competing marks could not be loaded.');
      dialog.querySelector('[data-candidates]').innerHTML=`<fieldset><legend>Saved marks — choose one</legend>${review.candidates.map(row=>`<label class="duplicate-score-option"><input type="radio" name="chosenScore" value="${esc(row.ScoreId)}" ${row.Allowed?'':'disabled data-unavailable'} required><span><strong>${esc(row.State==='Numeric'?`${row.RawScore} / ${row.MaximumScore}`:row.State)}</strong> · ${esc(row.Classroom)}${row.CurrentClassroom?' (current classroom)':''}<br><small>First saved: ${esc(date(row.CreatedAt))}<br>Last saved: ${esc(date(row.UpdatedAt))}${row.UpdatedBy?` · ${esc(row.UpdatedBy)}`:''}${row.SourceType?` · ${esc(row.SourceType==='BuiltInCBT'?'CBT':row.SourceType==='ManualCorrection'?'Authorised correction':row.SourceType)}`:''}</small>${row.BlockedReason?`<br><strong>${esc(row.BlockedReason)}</strong>`:''}</span></label>`).join('')}</fieldset>`;
      message.textContent='No mark is selected automatically. Review the classroom and dates before choosing.';
    }catch(error){review=null;message.textContent=error.message||String(error);dialog.querySelector('[data-retry]').hidden=false;}
    finally{lock(false);dialog.querySelectorAll('[data-unavailable]').forEach(el=>el.disabled=true);}
  }
  dialog.querySelector('[data-retry]').onclick=load;
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!review||!form.reportValidity()||!selected())return;
    const payload={...scope,RevisionToken:review.RevisionToken,SelectedScoreId:selected(),Reason:form.querySelector('[data-reason]').value.trim()};
    lock(true);message.textContent='Saving the resolution and its audit history…';
    try{
      if(!isCurrent())throw Error('The classroom or academic period changed. Close and reopen this review.');
      const result=await request('resolveAcademicDuplicateScore',payload);
      if(result.ok!==true)throw Error(result.message||'The resolution was not confirmed.');
      message.textContent=result.message;
      if(isCurrent())await onSaved(result);dialog.close();
    }catch(error){message.textContent=error.message||String(error);dialog.querySelector('[data-retry]').hidden=false;}
    finally{lock(false);dialog.querySelectorAll('[data-unavailable]').forEach(el=>el.disabled=true);}
  };
  void load();return dialog;
}
