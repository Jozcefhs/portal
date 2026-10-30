(() => {
  'use strict';
  let busy=false;
  const status=document.getElementById('recoveryStatus');
  async function submit(form,action){
    if(busy)return;const data=Object.fromEntries(new FormData(form));
    if(action==='reset'&&data.password!==data.confirmPassword){status.textContent='The new passwords do not match.';return;}
    busy=true;const buttons=[...document.querySelectorAll('button[type=submit]')];buttons.forEach(b=>b.disabled=true);status.textContent=action==='request'?'Requesting recovery code...':'Resetting password...';
    try{const response=await fetch('/api/parent-password-recovery',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,action})});const result=await response.json();if(!response.ok||!result.ok)throw Error(result.message||'Recovery is temporarily unavailable.');if(action==='reset')form.reset();status.textContent=result.message;status.scrollIntoView({block:'nearest',behavior:'smooth'});}
    catch(error){status.textContent=error instanceof TypeError?'The connection failed. If you submitted a reset, try signing in with the new password before requesting another code.':error.message;}
    finally{busy=false;buttons.forEach(b=>b.disabled=false);}
  }
  for(const [id,action]of [['requestRecoveryForm','request'],['resetPasswordForm','reset']])document.getElementById(id).addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,action);});
})();
