import {requireFirestoreEnv} from '../lib/firestore.js';
import {consumeRequestAllowance,readJsonBody} from '../lib/request-security.js';
import {requestParentPasswordRecovery,resetParentPassword,parentRecoveryEmail,PARENT_RECOVERY_MESSAGE} from '../lib/parent-password-recovery.js';
import {clearParentSessionCookie} from '../lib/parent-auth.js';
const reply=(body,status=200,extra={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...extra}});
export async function onRequestPost(context){
  try{
    const {request,env}=context,origin=request.headers.get('Origin');
    if(origin&&origin!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({ok:false,message:'Open recovery from the parent portal sign-in page.'},403);
    if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return reply({ok:false,message:'A JSON request is required.'},415);
    requireFirestoreEnv(env);const body=await readJsonBody(request,{maxBytes:4096}),action=body.action||'request';if(!['request','reset'].includes(action))return reply({ok:false,message:'Choose a valid recovery action.'},400);
    const rate=await consumeRequestAllowance(env,request,{scope:`parent-password-recovery-${action}`,maximum:action==='request'?8:20,windowSeconds:900});if(!rate.allowed)return reply({ok:false,message:'Too many attempts. Please wait 15 minutes before trying again.'},429);
    if(action==='request'){const email=parentRecoveryEmail(body.email);context.waitUntil(requestParentPasswordRecovery(env,email).catch(()=>console.error(JSON.stringify({event:'parent_password_recovery_delivery_failed'}))));return reply({ok:true,message:PARENT_RECOVERY_MESSAGE});}
    await resetParentPassword(env,body.code,body.password);return reply({ok:true,message:'Password reset. Return to the parent portal and sign in with your new password.'},200,{'Set-Cookie':clearParentSessionCookie()});
  }catch(error){const status=[400,413,429].includes(Number(error.status))?Number(error.status):503;return reply({ok:false,message:status===400?error.message:'Recovery could not be confirmed. If you submitted a reset, try signing in with the new password first. Otherwise try again later or contact the school.'},status);}
}
