import {clean,fail} from './hospital-model.js';

export const PORTAL_COOKIE='__Host-dynamax-hospital-portal';
export const PORTAL_SESSION_MS=30*60*1000;
export const portalToken=value=>/^[a-f0-9]{64}$/.test(clean(value))?clean(value):fail('This access link is invalid. Contact Reception.',401);
export const portalCode=value=>/^HP-[a-f0-9]{64}$/i.test(clean(value))?clean(value).slice(3).toLowerCase():fail('Check your portal access code and password.',401);
export const portalCodeFor=id=>`HP-${id.toUpperCase()}`;
export const portalSecret=env=>clean(env.HOSPITAL_PORTAL_SECRET||env.STAFF_SESSION_SECRET||env.BACKEND_SHARED_SECRET)||fail('Patient portal access is not configured.',503);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const encoder=new TextEncoder();
export async function portalHmac(env,value){
  const key=await crypto.subtle.importKey('raw',encoder.encode(portalSecret(env)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(`hospital-portal-v1:${value}`)));
}
export async function portalPassword(env,password,salt){
  if(typeof password!=='string'||password.length<12||password.length>128)fail('Use a password of 12 to 128 characters.');
  // A server-side pepper protects database-only exports. The iteration count is
  // within the Workers Web Crypto limit; this version is never silently lowered.
  const peppered=await portalHmac(env,`password:${password}`);
  const Salt=salt||hex(crypto.getRandomValues(new Uint8Array(16)));
  const key=await crypto.subtle.importKey('raw',encoder.encode(peppered),'PBKDF2',false,['deriveBits']);
  const PasswordHash=hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(Salt),iterations:100000},key,256));
  return {Salt,PasswordHash,PasswordVersion:1};
}
export function portalGrantView(row){
  return {GrantId:row.GrantId,AccessCode:portalCodeFor(row.GrantId),Kind:row.Kind,RecipientName:row.RecipientName,Contact:row.Contact,
    Relationship:row.Relationship,Status:row.Status,AccessUntil:row.AccessUntil,InvitationExpiresAt:row.InvitationExpiresAt,
    CreatedAt:row.CreatedAt,UpdatedAt:row.UpdatedAt,Revision:row.__updateTime};
}
