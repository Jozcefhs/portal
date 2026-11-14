import {readJsonBody,consumeRequestAllowance} from '../lib/request-security.js';
import {hospitalPatientPortalAction} from '../lib/hospital-patient-portal.js';
import {PORTAL_COOKIE} from '../lib/hospital-portal-model.js';

export async function onRequestPost({request,env,data}){
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  try{
    if(request.headers.get('Origin')!==new URL(request.url).origin)return Response.json({ok:false,message:'Open the patient portal to continue.'},{status:403,headers});
    const body=await readJsonBody(request,{maxBytes:4096});
    if(['login','activate','changePassword'].includes(body.action)){
      const allowance=await consumeRequestAllowance(env,request,{scope:'hospital-portal-auth',maximum:20,windowSeconds:900});
      if(!allowance.allowed)return Response.json({ok:false,message:'Too many attempts. Wait 15 minutes and try again.'},{status:429,headers});
    }
    const token=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(PORTAL_COOKIE+'='))?.slice(PORTAL_COOKIE.length+1)||'';
    const result=await hospitalPatientPortalAction(env,token,body),{cookieToken,clearCookie,...payload}=result;
    if(cookieToken)headers['Set-Cookie']=`${PORTAL_COOKIE}=${cookieToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((Date.parse(result.ExpiresAt)-Date.now())/1000))}`;
    if(clearCookie)headers['Set-Cookie']=`${PORTAL_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
    if(data)data.securityAuditHandled=true;
    return Response.json(payload,{headers});
  }catch(error){const status=Number(error.status||500);if(status===401)headers['Set-Cookie']=`${PORTAL_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
    return Response.json({ok:false,message:status>=500?'The portal could not complete this request. Please retry or contact Reception.':error.message},{status,headers});}
}
