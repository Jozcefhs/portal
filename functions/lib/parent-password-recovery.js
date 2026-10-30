import {batchCommitLiteralDocuments,getDocument} from './firestore.js';
import {getParentCredential,hashParentPassword,parentCredentialId} from './parent-auth.js';
import {requiredDeploymentIdentity} from './deployment-identity.js';
import {sendConfiguredEmail,escapeEmailHtml} from './email-service.js';

const clean=v=>String(v??'').trim();
export const PARENT_RECOVERY_MESSAGE='If a parent password has been set for this email address, a one-time recovery code will be sent. Check your inbox and spam folder. For first-time access or a changed email address, contact the school.';
export function parentRecoveryEmail(value){const email=clean(value).toLowerCase();if(!email||email.length>254||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw Object.assign(new Error('Enter the parent email address registered with the school, not a student admission number.'),{status:400});return email;}
const condition=row=>{if(!row)return {exists:false};if(!row.__updateTime)throw Error('Account version unavailable');return {updateTime:row.__updateTime};};
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const fingerprint=row=>digest(JSON.stringify([row.Email,row.Salt,row.PasswordHash,row.PasswordChangedAt,row.SessionEpoch]));
const invalid=()=>Object.assign(new Error('This recovery code is invalid, expired or already used. Request a new code.'),{status:400});
export async function requestParentPasswordRecovery(env,value){
  const email=parentRecoveryEmail(value),identity=requiredDeploymentIdentity(env),now=Date.now();
  const rateId=await digest(`${identity.workspaceId}|${identity.edition}|${email}`),rate=await getDocument(env,'parentPasswordRecoveryLimits',rateId),current=Number(rate?.WindowUntil)>now;
  if(current&&(Number(rate.Count)>=3||now-Number(rate.LastRequestedAt)<60000))return;
  try{await batchCommitLiteralDocuments(env,[{collectionPath:'parentPasswordRecoveryLimits',documentId:rateId,...condition(rate),data:{Count:current?Number(rate.Count)+1:1,WindowUntil:current?rate.WindowUntil:now+900000,LastRequestedAt:now}}]);}
  catch(error){if([409,412].includes(Number(error.status))||error.code==='FIRESTORE_WRITE_CONFLICT')return;throw error;}
  const row=await getParentCredential(env,email);if(!row?.PasswordHash||!row.Salt)return;
  const code=Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join(''),tokenId=await digest(code);
  await batchCommitLiteralDocuments(env,[{collectionPath:'parentPasswordRecovery',documentId:tokenId,exists:false,data:{Email:email,Fingerprint:await fingerprint(row),WorkspaceId:identity.workspaceId,Edition:identity.edition,CreatedAt:new Date(now).toISOString(),ExpiresAt:new Date(now+900000).toISOString(),UsedAt:''}}]);
  // The saved login address is the only destination; the request cannot redirect recovery.
  await sendConfiguredEmail(env,{toEmail:row.Email,toName:'Parent',subject:'Parent portal password recovery',
    textContent:`A password reset was requested for your parent portal account.\n\nYour one-time code is:\n${code}\n\nPaste it into the Forgot password page you opened from your school portal. It expires in 15 minutes. Do not share it. If you did not request this, ignore this message; your password has not changed.`,
    htmlContent:`<p>A password reset was requested for your parent portal account.</p><p>Your one-time code:</p><p><strong>${escapeEmailHtml(code)}</strong></p><p>Paste it into the Forgot password page opened from your school portal. It expires in 15 minutes. Do not share it.</p><p>If you did not request this, ignore this message; your password has not changed.</p>`});
}
export async function resetParentPassword(env,value,password){
  const identity=requiredDeploymentIdentity(env),token=clean(value).toLowerCase();if(!/^[a-f0-9]{48}$/.test(token))throw invalid();
  if(typeof password!=='string'||password.length<8||password.length>128||password!==password.trim())throw Object.assign(new Error('Use 8–128 characters, with no spaces at the beginning or end.'),{status:400});
  const tokenId=await digest(token),recovery=await getDocument(env,'parentPasswordRecovery',tokenId);
  if(!recovery||recovery.UsedAt||!(Date.parse(recovery.ExpiresAt)>Date.now())||recovery.WorkspaceId!==identity.workspaceId||recovery.Edition!==identity.edition)throw invalid();
  const row=await getParentCredential(env,recovery.Email);if(!row||await fingerprint(row)!==recovery.Fingerprint)throw invalid();
  const now=new Date().toISOString(),fields={...await hashParentPassword(password),PasswordChangedAt:now,UpdatedAt:now,SessionEpoch:crypto.randomUUID()};
  try{await batchCommitLiteralDocuments(env,[
    {collectionPath:'parentCredentials',documentId:parentCredentialId(recovery.Email),...condition(row),data:fields,updateMask:Object.keys(fields)},
    {collectionPath:'parentPasswordRecovery',documentId:tokenId,...condition(recovery),data:{UsedAt:now},updateMask:['UsedAt']},
    {collectionPath:'staffSecurityAudit',documentId:`PARENT-RECOVERY-${tokenId}`,exists:false,data:{Timestamp:now,Action:'PARENT PASSWORD RECOVERED',ActorUsername:recovery.Email,Actor:recovery.Email,Role:'Parent',SourcePlatform:'Web',Details:'Registered email recovery code verified. Password replaced and prior parent sessions invalidated. Student links and records unchanged.'}}
  ]);}catch(error){if([404,409,412].includes(Number(error.status))||error.code==='FIRESTORE_WRITE_CONFLICT')throw invalid();throw error;}
}
