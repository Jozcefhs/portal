import {secureTextEqual} from '../lib/backend-security.js';
import {readJsonBody} from '../lib/request-security.js';
import {requiredDeploymentIdentity} from '../lib/deployment-identity.js';
import {processHospitalReminderSchedule} from '../lib/hospital-reminder-runner.js';

export async function onRequestPost({env,request,data}){
  const headers={'Cache-Control':'no-store'};
  // Scheduled processing has its own per-reminder audit events, including uncertain outcomes.
  try{
    const secret=String(env.HOSPITAL_REMINDER_SCHEDULER_SECRET||''),supplied=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    if(!secret||!supplied||!secureTextEqual(secret,supplied))return Response.json({ok:false,message:'Scheduler authentication required.'},{status:401,headers});
    if(data)data.securityAuditHandled=true;
    const body=await readJsonBody(request,{maxBytes:1024}),identity=requiredDeploymentIdentity(env);
    if(identity.edition!=='hospital'||body.expectedWorkspaceId!==identity.workspaceId)return Response.json({ok:false,message:'Scheduler workspace mismatch.'},{status:409,headers});
    const result=await processHospitalReminderSchedule(env);return Response.json(result,{status:result.ok?200:503,headers});
  }catch{return Response.json({ok:false,message:'Reminder processing could not finish. Claimed sends will not be repeated automatically.'},{status:503,headers});}
}
