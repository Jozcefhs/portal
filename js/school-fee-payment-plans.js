const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/\s+/g, ' ');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('en-NG', { style:'currency', currency:'NGN' }).format(Number(value) || 0);
const identity = rule => JSON.stringify([key(rule.Name),key(rule.AcademicSession),key(rule.Term)]);
const samePlan = (left,right) => identity(left)===identity(right)&&left.Mode===right.Mode
  && Number(left.Value||0)===Number(right.Value||0)
  && (left.PercentageBasis||'Total school fees')===(right.PercentageBasis||'Total school fees')
  && Number(left.InstallmentCount||0)===Number(right.InstallmentCount||0)
  && JSON.stringify(left.DueDates||[])===JSON.stringify(right.DueDates||[]);
const caches = new WeakMap();
const modes = ['Existing fee-item rules','Full payment','Percentage','Fixed minimum','Equal installments'];

// An illustrative local calculation only; checkout always uses the server's current quote.
export function paymentPlanExample(rule, total, credited, today = new Date().toISOString().slice(0,10)) {
  const cents=value=>{const match=/^(\d+)(?:\.(\d{0,2}))?$/.exec(String(value||'0'));if(!match)throw Error('Use non-negative amounts with at most two decimal places.');const amount=Number(BigInt(match[1])*100n+BigInt((match[2]||'').padEnd(2,'0')));if(!Number.isSafeInteger(amount))throw Error('Enter smaller example amounts.');return amount;};
  const base = cents(total), paid = cents(credited);
  const balance = Math.max(0,base-paid), schedule=[];
  if (!Number.isSafeInteger(base) || !Number.isSafeInteger(paid)) throw Error('Enter valid example amounts.');
  let minimum=balance;
  if(rule.Mode==='Existing fee-item rules') return { balance:balance/100,minimum:null,schedule };
  if(rule.Mode==='Percentage') minimum=Number((BigInt(rule.PercentageBasis==='Outstanding balance'?balance:base)*BigInt(cents(rule.Value))+9999n)/10000n);
  if(rule.Mode==='Fixed minimum') minimum=cents(rule.Value);
  if(rule.Mode==='Equal installments') {
    const count=Number(rule.InstallmentCount); let cumulative=0;
    if(!Number.isInteger(count)||count<2||count>12)throw Error('Choose between 2 and 12 installments.');
    for(let index=0;index<count;index++){
      const amount=index===count-1?base-cumulative:Math.floor(base/count); cumulative+=amount;
      schedule.push({number:index+1,dueDate:rule.DueDates?.[index]||'',amount:amount/100,cumulativeAmount:cumulative/100,remainingAmount:Math.max(0,Math.min(amount,cumulative-paid))/100});
    }
    const first=schedule.find(row=>row.remainingAmount>0),due=schedule.filter(row=>row.dueDate&&row.dueDate<=today);
    const dueBalance=due.length?Math.max(0,Math.round(due.at(-1).cumulativeAmount*100)-paid):0;
    minimum=dueBalance||Math.round((first?.remainingAmount||0)*100);
  }
  return { balance:balance/100,minimum:Math.min(balance,Math.max(0,minimum))/100,schedule };
}

export async function openSchoolFeePaymentPlans(request, { isCurrent=()=>true, scopeOwner, branchId='', readOnly=false }={}) {
  const existing=document.getElementById('schoolFeePaymentPlansDialog');
  if(existing?.open){existing.focus();return;}
  existing?.remove();
  const dialog=document.createElement('dialog');dialog.id='schoolFeePaymentPlansDialog';
  dialog.setAttribute('aria-label','Total school-fee part-payment plans');
  dialog.style.cssText='box-sizing:border-box;width:min(760px,96vw);max-height:94dvh;overflow:auto;border:1px solid #ccdbea;border-radius:16px;padding:0';
  dialog.innerHTML=`<form style="margin:0"><div style="padding:20px"><h2>Part-payment plans</h2><p>Choose how families may pay their total school fees. Individual fee-item rules, optional services and wallet top-ups remain separate.</p><p data-branch class="muted"></p>
    <fieldset disabled data-editor style="border:0;padding:0;min-width:0"><label style="display:block;margin:12px 0">Saved plan<select aria-label="Saved plan" name="SavedPlan" style="width:100%"><option value="">New plan</option></select></label>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:12px">
    <label>Billing category<input aria-label="Billing category" name="Name" list="partPaymentCategories" value="All" maxlength="100" required style="width:100%;box-sizing:border-box"><datalist id="partPaymentCategories"></datalist></label>
    <label>Academic session<input name="AcademicSession" value="All" placeholder="All or 2026/2027" maxlength="40" required style="width:100%;box-sizing:border-box"></label>
    <label>Term<select aria-label="Term" name="Term" style="width:100%"><option>All</option><option>First Term</option><option>Second Term</option><option>Third Term</option></select></label>
    <label>Plan type<select aria-label="Plan type" name="Mode" style="width:100%">${modes.map(mode=>`<option>${mode}</option>`).join('')}</select></label>
    <label data-value-label>Minimum value<input name="Value" type="number" min="0.01" max="100000000" step="0.01" value="25" style="width:100%;box-sizing:border-box"></label>
    <label data-percentage>Percentage basis<select aria-label="Percentage basis" name="PercentageBasis" style="width:100%"><option>Total school fees</option><option>Outstanding balance</option></select></label>
    <label data-count>Number of installments<input name="InstallmentCount" type="number" min="2" max="12" step="1" value="3" style="width:100%;box-sizing:border-box"></label></div>
    <label data-date-toggle style="display:flex;align-items:center;gap:8px;margin-top:14px"><input name="UseDueDates" type="checkbox" style="width:auto;min-height:0;flex:0 0 auto;margin:0"><span>Set installment due dates</span></label><div data-dates style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:12px;margin-top:12px"></div>
    <p>All applies to every billing category or period in this branch. A more specific matching plan takes precedence. Choose All for both session and term, or specify both. Dated plans require a specific academic session and term.</p>
    <p>Percentage and fixed minimum plans allow a larger payment up to the remaining balance. Equal installments use confirmed payments and credit towards each installment. Saving a plan does not create charges or change existing payments.</p>
    <fieldset style="margin:16px 0;border:1px solid #ccdbea;border-radius:8px;min-width:0"><legend>Try an example — no records are changed</legend><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:12px"><label>Total school fees after discounts<input name="ExampleTotal" type="number" min="0" step="0.01" value="100000" style="width:100%;box-sizing:border-box"></label><label>Already paid or credited<input name="ExampleCredit" type="number" min="0" step="0.01" value="0" style="width:100%;box-sizing:border-box"></label></div><div data-example style="overflow:auto" aria-live="polite"></div></fieldset>
    </fieldset><p role="status" aria-live="polite">Loading plans…</p></div>
    <div style="position:sticky;bottom:0;background:#fff;border-top:1px solid #ccdbea;padding:12px;display:flex;flex-wrap:wrap;gap:8px;z-index:1"><button type="submit" data-save style="flex:1 1 190px;min-height:44px;white-space:normal" disabled>Save part-payment plan</button><button type="button" data-reload style="min-height:44px">Reload settings</button><button type="button" data-close style="min-height:44px">Close</button></div></form>`;
  document.body.append(dialog);dialog.showModal();
  const form=dialog.querySelector('form'),fields=form.elements,editor=form.querySelector('[data-editor]'),status=form.querySelector('[role=status]');
  const save=form.querySelector('[data-save]'),reload=form.querySelector('[data-reload]'),dates=form.querySelector('[data-dates]');
  let rules=[],categories=['All'],recordVersion='',busy=false,loaded=false;
  const active=()=>isCurrent()&&dialog.isConnected&&dialog.open;
  const scopedCache=scopeOwner&&(typeof scopeOwner==='object'||typeof scopeOwner==='function')?(caches.get(scopeOwner)||new Map()):null;
  if(scopedCache)caches.set(scopeOwner,scopedCache);
  const remember=()=>scopedCache?.set(branchId,{rules:structuredClone(rules),categories:[...categories],recordVersion});
  const setBusy=value=>{busy=value;editor.disabled=value||!loaded;save.disabled=value||!loaded||readOnly;reload.disabled=value;};
  const setOptions=()=>{
    fields.SavedPlan.innerHTML='<option value="">New plan</option>'+rules.map(rule=>`<option value="${esc(identity(rule))}">${esc(`${rule.Name} · ${rule.AcademicSession} · ${rule.Term} — ${rule.Mode}`)}</option>`).join('');
    form.querySelector('datalist').innerHTML=[...new Set(['All',...categories])].map(value=>`<option value="${esc(value)}"></option>`).join('');
  };
  function plan(){return {Name:fields.Name.value.trim(),AcademicSession:fields.AcademicSession.value.trim(),Term:fields.Term.value,Mode:fields.Mode.value,
    Value:['Percentage','Fixed minimum'].includes(fields.Mode.value)?fields.Value.value:0,PercentageBasis:fields.Mode.value==='Percentage'?fields.PercentageBasis.value:'Total school fees',
    InstallmentCount:fields.Mode.value==='Equal installments'?Number(fields.InstallmentCount.value):0,
    DueDates:fields.Mode.value==='Equal installments'&&fields.UseDueDates.checked?[...dates.querySelectorAll('input')].map(input=>input.value):[]};}
  function preview(){
    const target=form.querySelector('[data-example]');
    try{const rule=plan(),example=paymentPlanExample(rule,fields.ExampleTotal.value,fields.ExampleCredit.value);
      target.innerHTML=`<p>Example outstanding: <strong>${money(example.balance)}</strong>. ${example.minimum===null?'The applicable existing fee-item rules determine the minimum.':`Example next minimum: <strong>${money(example.minimum)}</strong>. You may pay more, up to the balance.`}</p>`+
      (example.schedule.length?`<table style="width:100%;font-size:12px"><thead><tr><th>Installment</th><th>Due date</th><th>Amount</th><th>Remaining</th></tr></thead><tbody>${example.schedule.map(row=>`<tr><td>${row.number}</td><td>${esc(row.dueDate||'Not scheduled')}</td><td>${money(row.amount)}</td><td>${money(row.remainingAmount)}</td></tr>`).join('')}</tbody></table>`:'');
    }catch(error){target.textContent=error.message;}
  }
  function controls(presetDates){
    const mode=fields.Mode.value,hasValue=['Percentage','Fixed minimum'].includes(mode),count=mode==='Equal installments';
    form.querySelector('[data-value-label]').hidden=!hasValue;fields.Value.disabled=!hasValue;fields.Value.required=hasValue;fields.Value.max=mode==='Percentage'?'100':'100000000';
    form.querySelector('[data-percentage]').hidden=mode!=='Percentage';form.querySelector('[data-count]').hidden=!count;fields.InstallmentCount.disabled=!count;
    form.querySelector('[data-date-toggle]').hidden=!count;dates.hidden=!count||!fields.UseDueDates.checked;
    const old=presetDates||[...dates.querySelectorAll('input')].map(input=>input.value),number=Number(fields.InstallmentCount.value);
    dates.innerHTML=count&&fields.UseDueDates.checked?Array.from({length:Math.max(0,Math.min(12,number||0))},(_,index)=>`<label>Installment ${index+1} due<input type="date" value="${esc(old[index]||'')}" required style="width:100%;box-sizing:border-box"></label>`).join(''):'';
    preview();
  }
  fields.SavedPlan.onchange=()=>{
    const rule=rules.find(row=>identity(row)===fields.SavedPlan.value)||{Name:'All',AcademicSession:'All',Term:'All',Mode:modes[0],Value:25,InstallmentCount:3};
    for(const name of ['Name','AcademicSession','Term','Mode','Value','PercentageBasis','InstallmentCount'])fields[name].value=rule[name]??(name==='PercentageBasis'?'Total school fees':'');
    if(Number(fields.InstallmentCount.value)<2)fields.InstallmentCount.value='3';fields.UseDueDates.checked=Boolean(rule.DueDates?.length);controls(rule.DueDates||[]);
  };
  fields.Mode.onchange=()=>controls();fields.InstallmentCount.onchange=()=>controls();fields.UseDueDates.onchange=()=>controls();
  form.addEventListener('input',event=>{if(event.target!==fields.SavedPlan)preview();});
  async function load(force=false){
    if(busy||!active())return;setBusy(true);
    try{const data=!force&&scopedCache?.get(branchId)||await request({action:'list'});if(!active())return;
      rules=data.rules||[];categories=data.categories||['All'];recordVersion=data.recordVersion||'';loaded=true;remember();setOptions();
      const selected=rules.find(row=>identity(row)===identity(plan()));
      if(selected){fields.SavedPlan.value=identity(selected);fields.SavedPlan.onchange();}
      form.querySelector('[data-branch]').textContent=`Branch: ${data.branchId||branchId}. Total school fees only.`;
      status.textContent=readOnly?'Read-only access. Saved plans can be reviewed.':'Choose a saved plan or configure a new category and period. Loaded settings are retained until Reload settings.';controls();
    }catch(error){if(active())status.textContent=error.message;}finally{setBusy(false);}
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||readOnly||!loaded||!active()||!form.reportValidity())return;
    const rule=plan();
    if((key(rule.AcademicSession)==='all')!==(key(rule.Term)==='all')){status.textContent='Choose both a specific session and term, or All for both.';return;}
    if(rule.DueDates.length&&(key(rule.AcademicSession)==='all'||key(rule.Term)==='all')){status.textContent='Choose a specific session and term for dated installments.';return;}
    if(rule.DueDates.some((date,index)=>!/^\d{4}-\d{2}-\d{2}$/.test(date)||index>0&&date<=rule.DueDates[index-1])){status.textContent='Use a different, later due date for each installment.';return;}
    if(rules.some(saved=>samePlan(saved,rule))){status.textContent='This part-payment plan is already saved.';return;}
    setBusy(true);status.textContent='Saving part-payment plan…';
    try{const data=await request({action:'save',...rule,recordVersion});if(!active())return;
      rules=[...rules.filter(row=>identity(row)!==identity(data.rule)),data.rule];recordVersion=data.recordVersion||recordVersion;remember();setOptions();fields.SavedPlan.value=identity(data.rule);status.textContent=data.message||'Part-payment plan saved. Charges and payments are unchanged.';
    }catch(error){if(active()){scopedCache?.delete(branchId);status.textContent=`${error.message} Reload settings before retrying if the save was not confirmed.`;}}
    finally{setBusy(false);}
  };
  reload.onclick=()=>load(true);form.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});controls();await load();
}
