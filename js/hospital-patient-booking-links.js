(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  window.DynamaxHospitalPatientBookingLinks={create({api,run,writable,status,getPatient}){
    let accessToken='',link=null,patientId='';
    $('apJoinWaitlist').insertAdjacentHTML('afterend','<button id="pbOpen">Patient self-booking link</button>');
    $('apBookingForm').insertAdjacentHTML('beforebegin',`<section id="pbPanel" hidden><h3>Personal patient booking link</h3>
      <p>For this patient or their authorised guardian only. Valid for seven days in the selected branch. Issuing a new link replaces the old one; existing appointments remain.</p>
      <p id="pbStatus" role="status"></p><form id="pbIssueForm"><label class="nurse-check"><input name="ConfirmPatient" type="checkbox" required>I have verified the patient or authorised guardian</label>
        <button>Issue personal booking link</button><button id="pbRevoke" type="button" class="secondary" hidden>Disable booking link</button><button id="pbClose" type="button" class="secondary">Close</button></form>
      <div id="pbShare" hidden><label>Copy and share privately with this patient<textarea id="pbLink" rows="3" readonly></textarea></label><button id="pbCopy" type="button">Copy personal link</button>
        <p class="hint">This link permits one booking and changes to that booking. Clinics must have Patient self-booking enabled. No message is sent automatically.</p></div></section>`);
    function show(){ $('pbStatus').textContent=link?`${link.Status} · expires ${new Date(link.ExpiresAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'})} WAT${link.HasBooking?' · existing booking retained':''}`:'No personal booking link has been issued.';$('pbRevoke').hidden=!link||link.Status!=='Active'; }
    function clear(){accessToken='';link=null;patientId='';$('pbPanel').hidden=$('pbShare').hidden=true;$('pbLink').value='';$('pbStatus').textContent='';$('pbIssueForm').reset();}
    function permissions(){$('pbOpen').hidden=!writable('appointments.write');if(!writable('appointments.write'))clear();}
    $('pbOpen').onclick=()=>run(async()=>{clear();patientId=getPatient().PatientId;link=(await api('patientBookingLinkStatus',{PatientId:patientId})).link;show();$('pbPanel').hidden=false;$('pbPanel').scrollIntoView({block:'start'});});
    $('pbIssueForm').onsubmit=e=>{e.preventDefault();run(async()=>{
      accessToken ||= token();const result=await api('issuePatientBookingLink',{PatientId:patientId,AccessToken:accessToken,ConfirmPatient:$('pbIssueForm').elements.ConfirmPatient.checked},true);
      link={Status:'Active',ExpiresAt:result.ExpiresAt,HasBooking:link?.HasBooking};show();$('pbLink').value=`${location.origin}/hospital-booking.html#access=${accessToken}`;
      $('pbShare').hidden=false;accessToken='';$('pbIssueForm').reset();status('Personal booking link ready. Share it privately with this patient or authorised guardian.');
    });};
    $('pbRevoke').onclick=()=>run(async()=>{await api('revokePatientBookingLink',{PatientId:patientId},true);link={...link,Status:'Revoked'};$('pbLink').value='';$('pbShare').hidden=true;accessToken='';show();status('Booking link disabled. The appointment and earlier records are retained.');});
    $('pbClose').onclick=clear;
    $('pbCopy').onclick=()=>run(async()=>{await navigator.clipboard.writeText($('pbLink').value);status('Personal link copied. Share it only with this patient or authorised guardian.');});
    return {clear,contextChanged:clear,permissions};
  }};
})();
