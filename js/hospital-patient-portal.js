(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(Number(n||0)/100);
  const date=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):'';
  let activating=false,busy=false,epoch=0,expires=0,timer,idleTimer,context=null,current=null,pages=[],pageIndex=0,authRetry=null;
  const cache=new Map(),channel=typeof BroadcastChannel==='function'?new BroadcastChannel('hospital-patient-portal'):null;
  const message=(text,bad=false)=>{$('message').textContent=text;$('message').className=bad?'bad':'good';};
  function cachePut(key,value){if(cache.size>=20)cache.delete(cache.keys().next().value);cache.set(key,value);}
  function loginMode(activation){activating=activation;$('signInTitle').textContent=activation?'Activate private access':'Sign in';$('login').textContent=activation?'Set password and activate':'Sign in';
    $('passwordLabel').textContent=activation?'Choose a password (at least 12 characters)':'Password';$('password').autocomplete=activation?'new-password':'current-password';
    for(const name of ['invitationLabel','confirmLabel','normalLogin'])$(name).hidden=!activation;$('confirmPassword').required=activation;$('invitationToken').required=activation;}
  function clear(text='Signed out.'){
    epoch++;clearTimeout(timer);clearTimeout(idleTimer);expires=0;context=current=null;pages=[];pageIndex=0;cache.clear();authRetry=null;
    for(const id of ['patientName','patientContext','recipient','records','document','loadedAt'])$(id).replaceChildren();
    $('workspace').hidden=true;$('signIn').hidden=false;$('documentPanel').hidden=true;$('loginForm').reset();$('passwordForm').reset();loginMode(false);message(text);
  }
  function logout(text='Signed out. Your documents have been cleared from this page.',broadcast=true){
    clear(text);if(broadcast)channel?.postMessage('signout');
    void fetch('/api/hospital-patient-portal',{method:'POST',credentials:'same-origin',cache:'no-store',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})}).catch(()=>{});
  }
  channel&&(channel.onmessage=()=>clear('Signed out in another tab.'));
  function activity(){clearTimeout(idleTimer);if(context)idleTimer=setTimeout(()=>logout('Session closed after 10 minutes of inactivity.'),10*60000);}
  for(const name of ['pointerdown','keydown','input'])document.addEventListener(name,activity,{passive:true});
  async function api(body){
    const captured=epoch,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    try{const response=await fetch('/api/hospital-patient-portal',{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();
      if(captured!==epoch){if(['activate','login'].includes(body.action))logout('Session closed.');throw Object.assign(new Error('Session changed.'),{stale:true});}
      if(response.status===401||response.status===403){clear(data.message);throw Object.assign(new Error(data.message),{stale:true});}
      if(!response.ok||data.ok===false)throw new Error(data.message||'The request could not finish.');return data;
    }finally{clearTimeout(timeout);}
  }
  async function run(work){if(busy)return;busy=true;const controls=[...document.querySelectorAll('button,input,select')].filter(e=>!e.disabled&&e.id!=='logout');controls.forEach(e=>e.disabled=true);message('Please wait…');
    try{if(expires&&Date.now()>=expires){logout('Your secure session expired. Sign in again.');return;}await work();}
    catch(e){if(!e.stale)message(e.name==='AbortError'?'The connection timed out. Retry the same action.':e.message,true);}
    finally{controls.forEach(e=>e.disabled=false);busy=false;}}
  async function open(){context=await api({action:'context'});expires=Date.parse(context.ExpiresAt);if(expires<=Date.now()){logout('Session expired. Sign in again.');return;}
    clearTimeout(timer);timer=setTimeout(()=>logout('Your secure session expired. Sign in again.'),expires-Date.now());activity();
    $('patientName').textContent=context.patient.DisplayName;$('patientContext').textContent=`${context.patient.HospitalNumber} · ${context.branch.Name}`;
    $('recipient').textContent=`${context.access.Kind} access: ${context.access.RecipientName} · valid until ${date(context.access.AccessUntil)}`;
    $('from').value=context.Today.slice(0,7)+'-01';$('to').value=context.Today;$('workspace').hidden=false;$('signIn').hidden=true;$('loginForm').reset();
    $('loadedAt').textContent='No financial records have been requested.';message('Signed in. Choose document dates to continue.');}
  $('loginForm').onsubmit=e=>{e.preventDefault();run(async()=>{
    if(activating&&$('password').value!==$('confirmPassword').value)throw new Error('The passwords do not match.');
    const body={action:activating?'activate':'login',AccessCode:$('accessCode').value.trim(),Password:$('password').value,...(activating?{InvitationToken:$('invitationToken').value.trim()}:{})};
    const key=JSON.stringify(body);if(authRetry?.key!==key)authRetry={key,RequestId:crypto.randomUUID()};
    await api({...body,RequestId:authRetry.RequestId});authRetry=null;await open();
  });};
  $('normalLogin').onclick=()=>{loginMode(false);$('invitationToken').value='';$('confirmPassword').value='';message('Use your portal access code and personal password.');};
  $('resume').onclick=()=>run(open);$('logout').onclick=()=>logout();
  function render(data,type){
    current={data,type};$('previous').hidden=pageIndex===0;$('next').hidden=!data.next;$('documentPanel').hidden=true;$('document').replaceChildren();
    $('loadedAt').textContent=`Page ${pageIndex+1} · ${data.rows.length} documents · loaded ${date(data.LoadedAt)} WAT. This is the selected period, not a lifetime account total.`;
    $('records').innerHTML=data.rows.length?`<div class="table-wrap"><table class="document-list"><thead><tr><th>Document / date</th><th class="money">${type==='invoices'?'Your charges':'Amount'}</th><th class="money">${type==='invoices'?'Your balance':type==='deposits'?'Unused':'Refunded / returned'}</th><th></th></tr></thead><tbody>${data.rows.map((r,i)=>`<tr><td>${esc(r.Number)}<br><span class="muted">${esc(date(r.CreatedAt))}</span>${r.IsAllocation?'<br><span class="badge">Deposit allocation — not a new payment</span>':''}</td><td class="money" data-label="${type==='invoices'?'Your charges':'Amount'}">${money(type==='invoices'?r.PatientCents-r.CreditCents:r.AmountCents)}</td><td class="money" data-label="${type==='invoices'?'Your balance':type==='deposits'?'Unused advance':'Refunded / returned'}">${money(type==='invoices'?r.BalanceCents:type==='deposits'?r.AvailableCents:r.RefundedCents+(r.ReturnedCents||0))}</td><td><button type="button" data-document="${i}" class="secondary">View / print</button></td></tr>`).join('')}</tbody></table></div>`:'<p>No documents in this date range.</p>';
    $('records').querySelectorAll('[data-document]').forEach(b=>b.onclick=()=>run(()=>showDocument(data.rows[Number(b.dataset.document)].DocumentId,type)));
  }
  async function load(refresh=false,cursor=null,index=0){
    const body={action:$('documentType').value,From:$('from').value,To:$('to').value,...(cursor?{Cursor:cursor}:{})},key=JSON.stringify(body);
    if(refresh)cache.clear();let data=cache.get(key);if(!data){data=await api(body);cachePut(key,data);}
    if(index===0)pages=[{body,key}];else pages[index]={body,key};pageIndex=index;render(data,body.action);message('Selected documents loaded.');
  }
  $('recordsForm').onsubmit=e=>{e.preventDefault();run(()=>load());};$('refresh').onclick=()=>{if($('recordsForm').reportValidity())run(()=>load(true));};
  $('next').onclick=()=>run(()=>load(false,current.data.next,pageIndex+1));
  $('previous').onclick=()=>run(async()=>{const p=pages[pageIndex-1],data=cache.get(p.key)||await api(p.body);cachePut(p.key,data);pageIndex--;render(data,p.body.action);message('Loaded page restored.');});
  for(const id of ['documentType','from','to'])$(id).onchange=()=>{current=null;pages=[];pageIndex=0;$('records').replaceChildren();$('document').replaceChildren();$('documentPanel').hidden=true;$('next').hidden=$('previous').hidden=true;$('loadedAt').textContent='Choose Load documents for this selection.';};
  async function showDocument(DocumentId,DocumentType){
    const body={action:'document',DocumentId,DocumentType},key=JSON.stringify(body);let data=cache.get(key);if(!data){data=await api(body);cachePut(key,data);}const d=data.document;
    const title=DocumentType==='invoices'?'Patient invoice':DocumentType==='deposits'?'Advance deposit receipt':d.IsAllocation?'Deposit allocation statement':'Payment receipt';
    let content='';
    if(DocumentType==='invoices')content=`<div class="table-wrap"><table class="invoice-lines"><thead><tr><th>Description</th><th class="money">Patient share</th><th class="money">HMO / corporate share</th></tr></thead><tbody>${d.Lines.map(l=>`<tr><td>${esc(l.Description)}</td><td class="money" data-label="Patient share">${money(l.PatientCents)}</td><td class="money" data-label="HMO / corporate">${money(l.HmoCents+l.CorporateCents)}</td></tr>`).join('')}</tbody></table></div><div class="totals"><p><span>Your original charges</span><b>${money(d.PatientCents)}</b></p><p><span>Credit adjustments</span><b>${money(d.CreditCents)}</b></p><p><span>Net payments / allocations</span><b>${money(d.PaidCents)}</b></p><p><span>${d.BalanceCents<0?'Patient credit':'Patient amount due'}</span><b>${money(Math.abs(d.BalanceCents))}</b></p></div><p class="muted">This balance is your share only. HMO and corporate shares are separate. Credit adjustments are reflected in the summary.</p>`;
    else content=`<div class="totals"><p><span>${d.IsAllocation?'Allocated from deposit':'Amount received'}</span><b>${money(d.AmountCents)}</b></p><p><span>Refunded</span><b>${money(d.RefundedCents)}</b></p>${DocumentType==='deposits'?`<p><span>Applied to invoices</span><b>${money(d.AppliedCents)}</b></p><p><span>Unused advance</span><b>${money(d.AvailableCents)}</b></p>`:`<p><span>Returned to deposit</span><b>${money(d.ReturnedCents)}</b></p>`}</div><p>Method: ${esc(d.Method)}</p><p>Reference: ${esc(d.Reference||'—')}</p>${d.IsAllocation?`<p>Source receipt: ${esc(d.SourceReceiptNumber)}. This allocation is not an additional cash payment.</p>`:''}`;
    $('document').innerHTML=`<div class="document-head"><h2>${esc(data.branch.Name)}</h2><h3>${title}</h3><p><b>${esc(d.Number)}</b> · ${esc(date(d.CreatedAt))} WAT</p><p>${esc(data.patient.DisplayName)} · ${esc(data.patient.HospitalNumber)}</p></div>${content}<p class="muted">Snapshot loaded ${esc(date(data.LoadedAt))} WAT. Contact the hospital if any detail is incorrect.</p>`;
    $('documentPanel').hidden=false;$('documentPanel').scrollIntoView({block:'start'});message('Document ready to view or print.');
  }
  $('print').onclick=()=>{if(context&&Date.now()<expires)window.print();else logout('Session expired. Sign in again.');};$('closeDocument').onclick=()=>{$('documentPanel').hidden=true;$('document').replaceChildren();};
  $('passwordForm').onsubmit=e=>{e.preventDefault();run(async()=>{const form=e.target;if(form.elements.Password.value!==form.elements.ConfirmPassword.value)throw new Error('The new passwords do not match.');await api({action:'changePassword',CurrentPassword:form.elements.CurrentPassword.value,Password:form.elements.Password.value,RequestId:crypto.randomUUID()});clear('Password changed. Sign in with your new password.');channel?.postMessage('signout');});};
  window.addEventListener('pagehide',()=>logout('Session closed.'));window.addEventListener('pageshow',e=>{if(e.persisted)clear('Sign in again to view your documents.');});
  const fragment=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname);$('accessCode').value=fragment.get('code')||'';
  if(fragment.has('invite')){$('invitationToken').value=fragment.get('invite');loginMode(true);}else loginMode(false);
})();
