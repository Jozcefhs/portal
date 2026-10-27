(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  let state = {}, selected = null, busy = false, session = false, patientCursor = null, visitCursor = null, lastSearch = null, lastVisitRange = null;
  let scanController = null, recordEpoch = 0, clinical = null, orders = null, billing = null, inpatients = null, loadedBranch = '';
  const pending = new Map();
  const status = (message, bad = false) => { $('status').textContent = message; $('status').className = bad ? 'bad' : 'good'; };
  const can = name => state.capabilities?.includes(name);
  const formValues = form => Object.fromEntries([...form.elements].filter(field => field.name).map(field => [field.name,field.value]));
  const writable = name => can(name) && !state.readOnly;
  function clearRecords() {
    recordEpoch++; scanController?.abort(); selected = null;
    clinical?.clear();
    orders?.clear();
    billing?.clear();
    inpatients?.clear();
    ['patientForm','cardForm','checkInForm','searchForm','visitForm'].forEach(id => $(id).reset());
    ['matches','visitRows','cardPrint','patientTitle','patientIdentity','cardStatus'].forEach(id => $(id).replaceChildren());
    $('duplicateReason').value = ''; $('patientPanel').hidden = true;
    $('morePatients').hidden = $('moreVisits').hidden = true;
    pending.clear(); lastSearch = lastVisitRange = null; patientCursor = visitCursor = null;
  }
  async function fetchJson(url, body, branch = '') {
    const epoch = recordEpoch;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { method: body ? 'POST' : 'GET', credentials:'same-origin', cache:'no-store', signal:controller.signal,
        headers:{'Content-Type':'application/json', ...(branch ? {'X-Dynamax-Branch':branch} : {})}, ...(body ? {body:JSON.stringify(body)} : {}) });
      const data = await response.json();
      if (epoch !== recordEpoch) throw Object.assign(new Error('The workspace changed. Repeat the request in the current workspace.'), { stale: true });
      if (response.status === 401) expire('Your staff session has expired. Sign in again.');
      if (!response.ok || data.ok === false) throw new Error(data.message || 'The server did not confirm this operation.');
      return data;
    } finally { clearTimeout(timer); }
  }
  function expire(message) { session = false; state = {}; clearRecords(); $('workspace').hidden = true; status(message, true); }
  const idle = window.DynamaxStaffIdleSession.create({
    renew: async activityAgeMs => fetchJson('/api/staff-session', {action:'activity', activityAgeMs}),
    onToken: () => {}, onExpire: expire
  });
  ['pointerdown','keydown','input','change','wheel','touchstart'].forEach(name => document.addEventListener(name, event => idle.activity(event), {capture:true,passive:true}));
  document.addEventListener('visibilitychange', () => idle.check());
  window.addEventListener('pagehide', () => { scanController?.abort(); clearRecords(); });
  async function api(action, extra = {}, write = false) {
    const payload = {action, BranchId:$('branch').value, ...extra};
    const key = JSON.stringify(payload), RequestId = write ? pending.get(key) || crypto.randomUUID() : crypto.randomUUID();
    if (write) pending.set(key, RequestId);
    const result = await fetchJson('/api/staff-hospital', {...payload, RequestId}, $('branch').value);
    if (write) pending.delete(key);
    return result;
  }
  function permissions() {
    document.querySelectorAll('[data-write]').forEach(el => { el.hidden = !writable(el.dataset.write); });
    document.querySelector('[data-tab="reception"]').hidden = !can('visits.read');
    document.querySelector('[data-tab="care"]').hidden = !can('clinical.read');
    $('patientForm').querySelectorAll('input,select').forEach(el => { el.disabled = !writable('patients.write'); });
    clinical?.permissions();
    orders?.permissions();
    billing?.permissions();
    inpatients?.permissions();
  }
  async function run(work) {
    if (busy) return; busy = true;
    const enabled = [...document.querySelectorAll('button,input,select,textarea')].filter(el => !el.disabled&&!el.closest('dialog')); enabled.forEach(el => { el.disabled = true; });
    try { await work(); } catch(error) { if (!error.stale) status(error.name === 'AbortError' ? 'The connection timed out. Retry the same action; its request reference is retained.' : error.message, true); }
    finally { busy = false; enabled.filter(el => el.isConnected).forEach(el => { el.disabled = false; }); permissions(); }
  }
  async function loadAccess() {
    $('workspace').hidden = true;
    const data = await fetchJson('/api/staff-session');
    if (!data.authenticated || data.user.edition !== 'hospital') throw new Error('Sign in to a Hospital staff workspace to continue.');
    idle.start({username:data.user.username, session:data.session}); session = true;
    const previous = $('branch').value || new URLSearchParams(location.search).get('branch');
    // Resolve fresh branch-specific role policies after selecting the branch.
    state = await fetchJson('/api/staff-hospital', {action:'state'});
    $('branch').innerHTML = state.branches.map(row => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
    if (state.branches.some(row => row.id === previous)) $('branch').value = previous;
    if (!$('branch').value) throw new Error('No hospital branch is assigned to this account.');
    state = await api('state'); loadedBranch = $('branch').value; permissions(); $('workspace').hidden = false;
    status('Hospital reception ready. Search for a patient or choose dates to load visits.');
  }
  function showTab(name) { for(const id of ['patients','reception','care','orders','billing','inpatients'])$(id).hidden=name!==id; }
  document.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => showTab(button.dataset.tab); });
  $('refresh').onclick = () => run(async () => { if(!await clinical.confirmLeave()||!await orders.confirmLeave()||!await billing.confirmLeave()||!await inpatients.confirmLeave())return; clearRecords(); await loadAccess(); });
  $('branch').onchange = () => run(async () => {
    if(!await clinical.confirmLeave()||!await orders.confirmLeave()||!await billing.confirmLeave()||!await inpatients.confirmLeave()){$('branch').value=loadedBranch;return;}
    clearRecords(); state = {}; state = await api('state'); loadedBranch=$('branch').value; permissions(); status('Branch changed. Search or load this branch’s visits.');
  });
  function renderMatches(data) {
    patientCursor = data.next; $('morePatients').hidden = !patientCursor;
    $('matches').innerHTML = `<table><thead><tr><th>Patient</th><th>Hospital number</th><th>Date of birth</th><th>NFC card</th><th></th></tr></thead><tbody>${data.patients.map(row => `<tr><td>${esc(row.DisplayName)}</td><td>${esc(row.HospitalNumber)}</td><td>${esc(row.DateOfBirth || 'Not recorded')}</td><td>${esc(row.CardStatus)}</td><td><button type="button" data-patient="${esc(row.PatientId)}">Open record</button></td></tr>`).join('') || '<tr><td colspan="5">No matching patients in this branch.</td></tr>'}</tbody></table>`;
    $('matches').querySelectorAll('[data-patient]').forEach(button => { button.onclick = () => run(() => openPatient(button.dataset.patient)); });
  }
  async function search(cursor = null) {
    if (!cursor) lastSearch = {[$('searchMode').value]:$('searchValue').value.trim()};
    renderMatches(await api('search', {...lastSearch, ...(cursor ? {Cursor:cursor} : {})})); status('Patient search complete.');
  }
  $('searchForm').onsubmit = event => {event.preventDefault(); run(() => search());};
  $('morePatients').onclick = () => run(() => search(patientCursor));
  $('searchMode').onchange = () => { $('searchValue').value = ''; $('searchValue').placeholder = $('searchMode').value === 'CardUid' ? 'Focus here and tap the NFC reader' : $('searchMode').value === 'HospitalNumber' ? 'H-…' : 'Enter at least two letters of the surname'; $('searchValue').focus(); };
  function editPatient(row = null) {
    scanController?.abort();
    selected = row; $('patientForm').reset(); $('cardForm').reset(); $('patientPanel').hidden = false; $('existingPatient').hidden = !row; $('printCard').hidden = !row;
    $('duplicateReview').hidden = Boolean(row); $('duplicateReason').value = '';
    $('patientTitle').textContent = row ? row.DisplayName : 'Register patient';
    $('patientIdentity').textContent = row ? `${row.HospitalNumber} · ${row.Status}` : 'Check the patient register before creating another record.';
    for (const field of $('patientForm').elements) if (field.name && row) field.value = row[field.name] || '';
    $('cardStatus').textContent = row ? `${row.CardStatus}${row.CardLast4 ? ` · card ending ${row.CardLast4}` : ''}` : '';
    $('revokeCard').hidden = !row || row.CardStatus !== 'Active'; permissions();
  }
  async function openPatient(patientId) { editPatient((await api('details', {PatientId:patientId})).patient); status('Patient registration loaded.'); }
  $('newPatient').onclick = () => editPatient(); $('closePatient').onclick = () => {
    scanController?.abort(); selected = null; $('patientPanel').hidden = true;
    ['patientForm','cardForm','checkInForm'].forEach(id => $(id).reset());
    ['patientTitle','patientIdentity','cardStatus','cardPrint'].forEach(id => $(id).replaceChildren());
    $('duplicateReason').value = '';
  };
  $('patientForm').onsubmit = event => { event.preventDefault(); run(async () => {
    const Patient = formValues($('patientForm'));
    const saved = await api('savePatient', {Patient, DuplicateReviewReason:$('duplicateReason').value, ...(selected ? {PatientId:selected.PatientId,Revision:selected.Revision} : {})}, true);
    if(saved.Unchanged){status('No patient changes to save.');return;}
    await openPatient(saved.PatientId); status('Patient registration saved.');
  }); };
  $('cardForm').onsubmit = event => {event.preventDefault(); run(async () => {
    await api('assignCard', {...formValues($('cardForm')),PatientId:selected.PatientId,Revision:selected.Revision}, true);
    await openPatient(selected.PatientId); status('NFC card assignment saved.');
  });};
  $('revokeCard').onclick = () => run(async () => {
    await api('revokeCard', {PatientId:selected.PatientId,Revision:selected.Revision,Reason:$('cardReason').value}, true);
    await openPatient(selected.PatientId); status('NFC card revoked. Patient records are preserved.');
  });
  async function scan(target, lookup = false) {
    if (lookup) $('searchMode').value = 'CardUid';
    // run() temporarily disables controls; focus the keyboard-reader target after it unlocks them.
    setTimeout(() => { if (session) target.focus(); }, 0);
    if (!('NDEFReader' in window)) {status('Tap a USB keyboard-mode NFC reader into the focused field. Direct browser scanning is unavailable on this device.'); return;}
    scanController?.abort(); const controller = new AbortController(); scanController = controller;
    const reader = new NDEFReader(), timer = setTimeout(() => controller.abort(), 15000);
    controller.signal.addEventListener('abort', () => clearTimeout(timer), {once:true});
    reader.onreading = event => {
      if (controller.signal.aborted || !session) return;
      const uid = String(event.serialNumber || '').replace(/[:\s-]/g,'').toUpperCase();
      if (!/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(uid)) {status('This device did not expose a compatible card UID. Use the desktop or USB reader.',true);return;}
      target.value = uid; controller.abort(); status('NFC card read.'); if (lookup) run(() => search());
    };
    reader.onreadingerror = () => status('The card could not be read. Try the USB or desktop NFC reader.',true);
    await reader.scan({signal:controller.signal}); status('Hold the NFC card near this device.');
  }
  $('scanLookup').onclick = () => run(() => scan($('searchValue'),true)); $('scanAssign').onclick = () => run(() => scan($('cardUid')));
  $('checkInForm').onsubmit = event => {event.preventDefault();run(async () => {
    await api('checkIn',{PatientId:selected.PatientId,Department:$('checkInForm').elements.Department.value},true);
    status('Patient checked in. The visit is available in Reception visits.');
  });};
  async function loadVisits(cursor = null) {
    if (!cursor) lastVisitRange = {fromDate:$('visitFrom').value,toDate:$('visitTo').value};
    const data = await api('visits',{DateRange:lastVisitRange,...(cursor ? {Cursor:cursor} : {})});
    visitCursor = data.next; $('moreVisits').hidden = !visitCursor;
    $('visitRows').innerHTML = `<table><thead><tr><th>Patient</th><th>Department</th><th>Arrival (WAT)</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.visits.map((row,index) => `<tr><td>${esc(row.PatientName)}<br>${esc(row.HospitalNumber)}</td><td>${esc(row.Department)}</td><td>${esc(new Date(row.CreatedAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}))}</td><td>${esc(row.Status)}${row.ClinicalState?`<br><small>${esc(row.ClinicalState)}</small>`:''}</td><td>${can('inpatient.read')?`<button data-inpatient-visit="${index}">${row.AdmissionId?'Open admission':'Ward admission'}</button>`:''}${can('billing.read')||can('hmo.work')?`<button data-billing-visit="${index}">Open billing / HMO</button>`:''}${can('clinical.read')?`<button data-care="${index}">Open care record</button>`:''}${writable('orders.create') && ['Waiting','In progress'].includes(row.Status)?`<button data-issue-order="${index}">Prescribe / request investigation</button>`:''}${writable('visits.write') && ['Waiting','In progress'].includes(row.Status) ? `<button data-visit="${index}" data-status="In progress">Start visit</button><button data-visit="${index}" data-status="Completed">Complete reception visit</button><button data-visit="${index}" data-status="Cancelled">Cancel visit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">No visits in this period.</td></tr>'}</tbody></table>`;
    $('visitRows').querySelectorAll('[data-inpatient-visit]').forEach(button=>{button.onclick=()=>run(()=>inpatients.openVisit(data.visits[Number(button.dataset.inpatientVisit)]));});
    $('visitRows').querySelectorAll('[data-billing-visit]').forEach(button=>{button.onclick=()=>run(()=>billing.openVisit(data.visits[Number(button.dataset.billingVisit)]));});
    $('visitRows').querySelectorAll('[data-issue-order]').forEach(button=>{button.onclick=()=>run(()=>orders.openVisit(data.visits[Number(button.dataset.issueOrder)]));});
    $('visitRows').querySelectorAll('[data-care]').forEach(button=>{button.onclick=()=>run(()=>clinical.open(data.visits[Number(button.dataset.care)]));});
    $('visitRows').querySelectorAll('[data-visit]').forEach(button => {button.onclick = () => run(async () => {
      const row = data.visits[Number(button.dataset.visit)], Reason = button.dataset.status === 'Cancelled' ? window.prompt('Reason for cancelling this visit') : '';
      if (Reason === null) return;
      await api('updateVisit',{VisitId:row.VisitId,Revision:row.Revision,Status:button.dataset.status,Reason},true);
      await loadVisits(); status('Reception visit updated.');
    });}); status('Selected visit period loaded.');
  }
  $('visitForm').onsubmit = event => {event.preventDefault();run(() => loadVisits());}; $('moreVisits').onclick = () => run(() => loadVisits(visitCursor));
  $('printCard').onclick = () => {
    if (!selected) return;
    $('cardPrint').classList.remove('billing-print'); $('cardPrint').innerHTML = `<h2>Hospital patient card</h2><p><strong>${esc(selected.DisplayName)}</strong></p><p>${esc(selected.HospitalNumber)}</p><p>NFC identification · ${esc(selected.CardStatus)}</p>`; window.print();
  };
  clinical=window.DynamaxHospitalClinical.create({api,run,can,writable,status,navigate:showTab});
  orders=window.DynamaxHospitalOrders.create({api,run,can,writable,status,navigate:showTab});
  billing=window.DynamaxHospitalBilling.create({api,run,can,writable,status,navigate:showTab});
  inpatients=window.DynamaxHospitalInpatients.create({api,run,can,writable,status,navigate:showTab});
  inpatients.onCare(row=>clinical.open(row));inpatients.onBilling(row=>billing.openVisit(row));
  run(async () => { await loadAccess(); const task=new URLSearchParams(location.search).get('task');
    if(task==='inpatients'&&can('inpatient.read'))showTab('inpatients');
    if (['reception','triage','consultations'].includes(task) && can('visits.read')) showTab('reception');
    if(['billing','hmo'].includes(task)&&(can('billing.read')||can('hmo.work')))showTab('billing');
    if(['orders','pharmacy','laboratory','imaging'].includes(task)&&['orders.read','pharmacy.work','laboratory.work','imaging.work'].some(can)){orders.selectTask(task);showTab('orders');}
  });
})();
