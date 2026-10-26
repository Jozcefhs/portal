(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format((v||0)/100);
  const date=v=>new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Lagos'});
  const input=(name,label,attrs='')=>`<label>${label}<input name="${name}" ${attrs}></label>`;
  const amount=()=>input('Amount','Amount (NGN)','required type="number" min="0.01" max="10000000" step="0.01"');
  const reference=label=>input('Reference',label,'required maxlength="160"');
  const reason=()=>'<label>Reason<textarea name="Reason" required maxlength="2000"></textarea></label>';
  const dates=prefix=>`<label>From<input id="${prefix}From" type="date" required></label><label>To<input id="${prefix}To" type="date" required></label>`;
  const values=f=>Object.fromEntries([...f.elements].filter(e=>e.name&&e.type!=='checkbox').map(e=>[e.name,e.value]));
  const range=prefix=>({fromDate:$(prefix+'From').value,toDate:$(prefix+'To').value});
  const table=(heads,rows,empty='No records in the selected period.')=>`<table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${heads.length}">${esc(empty)}</td></tr>`}</tbody></table>`;
  window.DynamaxHospitalFunds={create({api,run,can,writable,status,onChange,onOpen}){
    $('billFundsHost').innerHTML=`<details id="fundWorkspace"><summary>Deposits, prepayments and HMO remittances</summary>
      <p>Record one advance receipt, then apply it to the relevant invoices. Unused money remains available on that receipt. Allocations stay within the selected branch.</p>
      <details id="fundReceive"><summary>Receive a deposit or HMO remittance</summary>
        <label>Receipt type<select id="fundReceiveKind"><option value="Patient">Patient deposit / prepayment</option><option value="Hmo">HMO remittance / advance</option></select></label>
        <form id="fundPatientFind" class="toolbar">${input('HospitalNumber','Patient hospital number','required maxlength="30" placeholder="H-…"')}<button>Verify patient</button></form><p id="fundPatientIdentity" class="care-identity" hidden></p>
        <form id="fundReceiveForm"><div class="form-grid"><label id="fundInsurerLabel" hidden>Insurer name (as on its invoices)<input name="Insurer" maxlength="160" disabled required></label>${amount()}<label>Payment method<select name="Method"><option>Cash</option><option>Bank transfer</option></select></label>${reference('Original receipt / bank-transfer reference')}</div>
          <label class="check-line"><input id="fundReceiveConfirm" type="checkbox" required>I checked the patient or insurer and confirmed the money received.</label><button>Record advance receipt</button></form>
      </details>
      <form id="fundRegister" class="toolbar">${dates('fundList')}<label>Receipt type<select id="fundListKind"><option value="Patient">Patient deposits</option><option value="Hmo">HMO remittances</option></select></label><button>Load advance receipts</button><button id="fundListRefresh" type="button">Refresh period</button></form>
      <p id="fundListNote" class="hint">No advance history requested.</p><div id="fundRows" class="table-wrap"></div><button id="fundPrev" type="button" hidden>Previous receipts</button><button id="fundNext" type="button" hidden>Next receipts</button>
      <section id="fundPanel" hidden><h3 id="fundTitle"></h3><p id="fundBalance"></p><div class="toolbar"><button id="fundRefresh" type="button">Refresh receipt</button><button id="fundPrint" type="button">Print advance receipt</button></div>
        <details id="fundAllocate"><summary>Apply this receipt to invoices</summary><p>Find invoices by their printed invoice numbers. A patient deposit pays that patient’s share; an HMO remittance pays approved claims for the same insurer. Up to 20 invoices per batch.</p>
          <form id="fundInvoiceFind" class="toolbar">${input('InvoiceNumber','Invoice number','required maxlength="40" placeholder="HI-…"')}<button>Find invoice</button></form><div id="fundFound"></div>
          <form id="fundAllocateForm"><div id="fundCart" class="table-wrap"></div><p id="fundCartTotal"></p>${reference('Allocation reference (remittance schedule or deposit use)')}<label class="check-line"><input id="fundAllocateConfirm" type="checkbox" required>I checked the selected invoices and allocation amounts.</label><button>Apply selected allocations</button></form>
        </details>
        <details id="fundHistory"><summary>Receipt history and allocations</summary><form id="fundHistoryForm" class="toolbar">${dates('fundHistory')}<button>Load history</button><button id="fundLoadAllocations" type="button">Load invoice allocations</button><button id="fundHistoryRefresh" type="button">Refresh selected history</button></form><div id="fundHistoryRows" class="table-wrap"></div><button id="fundHistoryNext" type="button" hidden>Next history page</button>
          <div id="fundAllocationRows" class="table-wrap"></div><button id="fundAllocationNext" type="button" hidden>Next allocations</button>
          <form id="fundReturnForm" hidden><h4>Return allocation to the advance receipt</h4><p id="fundReturnInfo"></p>${amount()}${reference('Allocation correction reference')}${reason()}<label class="check-line"><input id="fundReturnConfirm" type="checkbox" required>I checked this allocation and the effect on the invoice balance.</label><button>Return allocation to available balance</button></form>
        </details>
        <details id="fundRefund"><summary>Refund unused money</summary><p>This records a refund from the original receipt account. It does not initiate a bank transfer. Allocated money must be returned to this receipt before it can be refunded.</p>
          <form id="fundRefundForm">${amount()}${reference('Refund receipt / bank reference')}${reason()}<label class="check-line"><input id="fundRefundConfirm" type="checkbox" required>I checked the recipient and confirmed the refund.</label><button>Record refund of unused funds</button></form>
        </details>
      </section></details>`;
    let fund=null,person=null,found=null,returning=null,dirty=false,cart=[],pages=[],pageIndex=0,listPayload=null;
    const cache=new Map();
    const submit=(id,fn)=>$(id).onsubmit=e=>{e.preventDefault();run(fn);};
    const cached=async(action,payload,force=false)=>{const k=JSON.stringify([action,payload]);if(force)cache.delete(k);if(!cache.has(k))cache.set(k,await api(action,payload));return cache.get(k);};
    $('billFundsHost').addEventListener('input',e=>{if(e.target.closest('#fundReceiveForm,#fundAllocateForm,#fundReturnForm,#fundRefundForm'))dirty=true;});
    async function confirmLeave(){return !dirty||await window.DynamaxDialogs.confirm({title:'Unsaved advance receipt changes',message:'Discard these unsaved receipt or allocation changes?',confirmText:'Discard edits'});}
    function invalidate(){cache.clear();pages=[];pageIndex=0;$('fundRows').replaceChildren();$('fundPrev').hidden=$('fundNext').hidden=true;$('fundListNote').textContent='Records changed. Refresh the selected period for current balances.';}
    function permissions(){
      $('fundReceive').hidden=$('fundAllocate').hidden=!writable('billing.collect');$('fundRefund').hidden=!writable('billing.refund');
      if(!writable('billing.refund'))$('fundReturnForm').hidden=true;
      $('fundListKind').querySelector('[value=Patient]').disabled=!can('billing.read');if(!can('billing.read'))$('fundListKind').value='Hmo';
    }
    function clear(){fund=person=found=returning=null;cart=[];pages=[];pageIndex=0;listPayload=null;dirty=false;cache.clear();
      $('billFundsHost').querySelectorAll('form').forEach(f=>f.reset());$('billFundsHost').querySelectorAll('details').forEach(e=>e.open=false);
      for(const id of ['fundRows','fundTitle','fundBalance','fundFound','fundCart','fundCartTotal','fundHistoryRows','fundAllocationRows','fundReturnInfo','fundPatientIdentity'])$(id).replaceChildren();
      for(const id of ['fundPanel','fundReturnForm','fundPrev','fundNext','fundHistoryNext','fundAllocationNext','fundPatientIdentity'])$(id).hidden=true;
      $('fundListNote').textContent='No advance history requested.';receiveKind();
    }
    function receiveKind(){const patient=$('fundReceiveKind').value==='Patient';$('fundPatientFind').hidden=!patient;$('fundPatientIdentity').hidden=!patient||!person;
      $('fundInsurerLabel').hidden=patient;$('fundReceiveForm').elements.Insurer.disabled=patient;$('fundReceiveConfirm').checked=false;}
    $('fundReceiveKind').onchange=receiveKind;
    $('fundPatientFind').elements.HospitalNumber.oninput=()=>{person=null;$('fundPatientIdentity').hidden=true;$('fundReceiveConfirm').checked=false;};
    submit('fundPatientFind',async()=>{person=(await api('hospitalDepositPatient',values($('fundPatientFind')))).patient;$('fundPatientIdentity').textContent=`${person.DisplayName} · ${person.HospitalNumber}`;$('fundPatientIdentity').hidden=false;status('Patient verified for prepayment.');});
    submit('fundReceiveForm',async()=>{const Kind=$('fundReceiveKind').value;if(Kind==='Patient'&&!person)throw Error('Verify the patient hospital number first.');
      const fields=values($('fundReceiveForm'));if(Kind==='Patient')delete fields.Insurer;
      const saved=await api('receiveHospitalFunds',{Kind,...fields,...(Kind==='Patient'?{PatientId:person.PatientId}:{}),ConfirmPatient:$('fundReceiveConfirm').checked},true);
      dirty=false;invalidate();onChange();$('fundReceiveForm').reset();receiveKind();$('fundReceive').open=false;await open(saved.FundId,true);status(saved.Unchanged?'This advance receipt is already recorded.':'Advance receipt recorded.');});
    async function list(cursor=null,force=false){if(force)cache.clear();if(!cursor){listPayload={Kind:$('fundListKind').value,DateRange:range('fundList')};pages=[];pageIndex=0;}
      const data=await cached('hospitalFunds',{...listPayload,...(cursor?{Cursor:cursor}:{})},force);pages[pageIndex]=data;renderList(data);status('Selected advance period loaded.');}
    function renderList(data){$('fundRows').innerHTML=table(['Receipt / date','Patient or insurer','Received','Available',''],data.rows.map((r,i)=>`<tr><td>${esc(r.ReceiptNumber)}<br>${esc(date(r.CreatedAt))}</td><td>${esc(r.PatientName||r.Insurer)}<br>${esc(r.HospitalNumber||r.Reference)}</td><td>${esc(money(r.AmountCents))}</td><td>${esc(money(r.AvailableCents))}</td><td><button type="button" data-fund-open="${i}">Open receipt</button></td></tr>`));
      $('fundRows').querySelectorAll('[data-fund-open]').forEach(b=>b.onclick=()=>run(()=>open(data.rows[+b.dataset.fundOpen].FundId)));
      $('fundListNote').textContent=`Page ${pageIndex+1}: ${data.rows.length} receipts. Loaded pages are retained; this is not an all-time balance.`;
      $('fundPrev').hidden=pageIndex===0;$('fundNext').hidden=!data.next;$('fundPrev').onclick=()=>renderList(pages[--pageIndex]);
      $('fundNext').onclick=()=>run(async()=>{if(pages[pageIndex+1])renderList(pages[++pageIndex]);else{pageIndex++;await list(data.next);}});
    }
    submit('fundRegister',()=>list());$('fundListRefresh').onclick=()=>run(()=>list(null,true));
    async function open(FundId,force=false){if(!await confirmLeave())return;const data=await cached('hospitalFundDetails',{FundId},force);fund=data.fund;dirty=false;cart=[];found=returning=null;
      $('fundWorkspace').open=true;$('fundPanel').hidden=false;onOpen();$('fundTitle').textContent=`${fund.ReceiptNumber} · ${fund.PatientName||fund.Insurer}${fund.HospitalNumber?' · '+fund.HospitalNumber:''}`;
      $('fundBalance').textContent=`Received ${money(fund.AmountCents)} · applied ${money(fund.AppliedCents)} · refunded ${money(fund.RefundedCents)} · available ${money(fund.AvailableCents)}. ${fund.Method} · ${fund.Reference}`;
      for(const id of ['fundFound','fundHistoryRows','fundAllocationRows','fundReturnInfo'])$(id).replaceChildren();
      for(const id of ['fundReturnForm','fundHistoryNext','fundAllocationNext'])$(id).hidden=true;
      for(const id of ['fundInvoiceFind','fundAllocateForm','fundReturnForm','fundRefundForm'])$(id).reset();renderCart();permissions();status('Advance receipt loaded.');
    }
    $('fundRefresh').onclick=()=>run(()=>open(fund.FundId,true));
    $('fundPrint').onclick=()=>{if(!fund)return;$('cardPrint').classList.add('billing-print');$('cardPrint').innerHTML=`<h2>Hospital advance receipt ${esc(fund.ReceiptNumber)}</h2><p>${esc(fund.PatientName||fund.Insurer)} · ${esc(fund.HospitalNumber)}</p><p>${esc(date(fund.CreatedAt))} · ${esc(fund.Method)} · ${esc(fund.Reference)}</p><p>Received ${esc(money(fund.AmountCents))}</p><p>Applied ${esc(money(fund.AppliedCents))} · refunded ${esc(money(fund.RefundedCents))} · available ${esc(money(fund.AvailableCents))}</p><p>Allocations are recorded separately. Balance reflects this loaded receipt.</p>`;window.print();};
    submit('fundInvoiceFind',async()=>{if(!fund)return;found=(await api('hospitalFundInvoice',{FundId:fund.FundId,...values($('fundInvoiceFind'))})).invoice;
      $('fundFound').innerHTML=`<p>${esc(found.InvoiceNumber)} · ${esc(found.PatientName)} · ${esc(found.HospitalNumber)}<br>Outstanding ${esc(money(found.BalanceCents))}${found.ClaimStatus?' · claim '+esc(found.ClaimStatus):''}</p><button type="button" id="fundAddInvoice">Add to allocation batch</button>`;
      $('fundAddInvoice').disabled=found.BalanceCents<=0||(fund.Kind==='Hmo'&&!['Approved','Partially settled'].includes(found.ClaimStatus));
      $('fundAddInvoice').onclick=()=>{if(cart.length>=20){status('Apply this batch before adding more than 20 invoices.',true);return;}if(cart.some(r=>r.InvoiceId===found.InvoiceId)){status('This invoice is already selected.',true);return;}cart.push({...found,Amount:(found.BalanceCents/100).toFixed(2)});dirty=true;renderCart();};status('Invoice found for allocation.');});
    function renderCart(){
      $('fundCart').innerHTML=table(['Invoice / patient','Outstanding','Apply (NGN)',''],cart.map((r,i)=>`<tr><td>${esc(r.InvoiceNumber)}<br>${esc(r.PatientName)}</td><td>${esc(money(r.BalanceCents))}</td><td><input aria-label="Amount for ${esc(r.InvoiceNumber)}" data-fund-amount="${i}" type="number" min="0.01" step="0.01" max="${r.BalanceCents/100}" value="${esc(r.Amount)}" required></td><td><button type="button" data-fund-remove="${i}">Remove</button></td></tr>`),'No invoices selected. Find an invoice to add it.');
      $('fundCart').querySelectorAll('[data-fund-amount]').forEach(e=>e.oninput=()=>{cart[+e.dataset.fundAmount].Amount=e.value;dirty=true;cartTotal();});
      $('fundCart').querySelectorAll('[data-fund-remove]').forEach(b=>b.onclick=()=>{cart.splice(+b.dataset.fundRemove,1);dirty=true;renderCart();});cartTotal();
    }
    function cartTotal(){const total=cart.reduce((n,r)=>n+Math.round(Number(r.Amount||0)*100),0);$('fundCartTotal').textContent=`${cart.length} invoices · selected ${money(total)} · receipt available ${money(fund?.AvailableCents||0)}`;}
    submit('fundAllocateForm',async()=>{if(!fund||!cart.length)throw Error('Find and select the invoices first.');const saved=await api('allocateHospitalFunds',{FundId:fund.FundId,Revision:fund.Revision,Reference:$('fundAllocateForm').elements.Reference.value,
      Allocations:cart.map(r=>({InvoiceId:r.InvoiceId,Revision:r.Revision,Amount:r.Amount})),ConfirmPatient:$('fundAllocateConfirm').checked},true);await changed(saved,'Advance allocated to selected invoices.');});
    async function changed(saved,message){dirty=false;if(!saved.Unchanged){invalidate();onChange();}await open(fund.FundId,true);status(saved.Unchanged?'Already recorded; no further changes written.':message);}
    async function history(cursor=null,force=false){if(!fund)return;const data=await cached('hospitalFundHistory',{FundId:fund.FundId,DateRange:range('fundHistory'),...(cursor?{Cursor:cursor}:{})},force);
      $('fundHistoryRows').innerHTML=table(['Date','Action','Officer','Amount / reference'],data.rows.map(r=>`<tr><td>${esc(date(r.CreatedAt))}</td><td>${esc(r.Action)}</td><td>${esc(r.ActorName)}</td><td>${esc(money(r.AmountCents))}<br>${esc(r.Reference)}</td></tr>`));$('fundHistoryNext').hidden=!data.next;$('fundHistoryNext').onclick=()=>run(()=>history(data.next));status('Advance history loaded.');}
    submit('fundHistoryForm',()=>history());$('fundHistoryRefresh').onclick=()=>run(async()=>{const hasAllocations=$('fundAllocationRows').hasChildNodes(),hasHistory=$('fundHistoryRows').hasChildNodes();cache.clear();if(hasHistory||!hasAllocations)await history(null,true);if(hasAllocations)await allocations();});
    async function allocations(cursor=null){if(!fund)return;const data=await cached('hospitalFundAllocations',{FundId:fund.FundId,DateRange:range('fundHistory'),...(cursor?{Cursor:cursor}:{})});
      $('fundAllocationRows').innerHTML=table(['Invoice / patient','Applied','Returned','Reference',''],data.rows.map((r,i)=>`<tr><td>${esc(r.InvoiceNumber)}<br>${esc(r.PatientName)}</td><td>${esc(money(r.AmountCents))}</td><td>${esc(money(r.ReturnedToFundCents))}</td><td>${esc(r.AllocationReference)}</td><td>${writable('billing.refund')&&r.AmountCents>(r.ReturnedToFundCents||0)?`<button type="button" data-fund-return="${i}">Review allocation return</button>`:''}</td></tr>`));
      $('fundAllocationNext').hidden=!data.next;$('fundAllocationNext').onclick=()=>run(()=>allocations(data.next));
      $('fundAllocationRows').querySelectorAll('[data-fund-return]').forEach(b=>b.onclick=()=>run(async()=>{if(!await confirmLeave())return;const payment=data.rows[+b.dataset.fundReturn],inv=(await api('hospitalInvoiceDetails',{InvoiceId:payment.InvoiceId,PatientId:payment.PatientId})).invoice;
        returning={payment,invoice:inv};$('fundReturnForm').reset();$('fundReturnForm').hidden=false;$('fundReturnInfo').textContent=`${payment.InvoiceNumber} · ${payment.PatientName} · remaining allocation ${money(payment.AmountCents-(payment.ReturnedToFundCents||0))}. Returning money reopens this part of the invoice balance; it does not issue a cash refund.`;dirty=false;status('Allocation reviewed for return.');}));status('Dated advance allocations loaded.');
    }
    $('fundLoadAllocations').onclick=()=>run(()=>allocations());
    submit('fundReturnForm',async()=>{if(!fund||!returning)throw Error('Review the original allocation first.');const saved=await api('returnHospitalAllocation',{FundId:fund.FundId,Revision:fund.Revision,
      PaymentId:returning.payment.PaymentId,PaymentRevision:returning.payment.Revision,InvoiceRevision:returning.invoice.Revision,...values($('fundReturnForm')),ConfirmPatient:$('fundReturnConfirm').checked},true);await changed(saved,'Allocation returned to the receipt balance.');});
    submit('fundRefundForm',async()=>{if(!fund)return;const saved=await api('refundHospitalFunds',{FundId:fund.FundId,Revision:fund.Revision,...values($('fundRefundForm')),ConfirmPatient:$('fundRefundConfirm').checked},true);await changed(saved,'Unused advance refunded.');});
    window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
    return {permissions,clear,confirmLeave,invalidate,open};
  }};
})();
