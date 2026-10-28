import {requireFirestoreEnv} from '../lib/firestore.js';
import {requireStaffSession, readStaffAttendanceProof} from '../lib/staff-auth.js';
import {enforceActorBranch} from '../lib/branch-scope.js';
import {handleStaffMeetings, meetingProofSiteId, canManageStaffMeetings} from '../lib/staff-meetings.js';
import {readJsonBody, beginIdempotentRequest, completeIdempotentRequest, failIdempotentRequest} from '../lib/request-security.js';

export async function onRequestPost(context) {
  context.data ||= {};
  let idempotency;
  const headers={'Cache-Control':'no-store'};
  try {
    requireFirestoreEnv(context.env);
    const user=await requireStaffSession(context.env,context.request);
    const body=await readJsonBody(context.request,{maxBytes:32*1024});
    body.action=String(body.action||'').trim().toLowerCase();
    if(body.action==='save'){
      if(!canManageStaffMeetings(user)||user.subscriptionReadOnly||user.subscriptionActive===false)
        return Response.json({ok:false,message:'Meeting administration is unavailable for this account.'},{status:403,headers});
      idempotency=await beginIdempotentRequest(context.env,context.request,body,{scope:'staff-meeting-save',actor:user.username,ttlMinutes:30*24*60});
      if(idempotency.replay){context.data.securityAuditHandled=true;return Response.json(idempotency.response,{status:idempotency.status||200,headers});}
    }
    // The proof is bound to this meeting, branch, day and direction. A normal
    // work clock-in proof cannot be reused to attend a meeting.
    const identityProof=body.action==='clock'?await readStaffAttendanceProof(context.env,body.AttendanceProof,user.username,{
      siteId:meetingProofSiteId(enforceActorBranch(user,body.BranchId),body.MeetingId,body.Date),direction:String(body.Direction||'').toUpperCase()
    }):null;
    const result=await handleStaffMeetings(context.env,user,body,{
      clientIp:context.request.headers.get('CF-Connecting-IP')||'',identityProof
    });
    if(idempotency)await completeIdempotentRequest(context.env,idempotency,result,200);
    // Reads have no business side effects. Clock actions already store exactly
    // one immutable IN/OUT event atomically with attendance, including retries.
    if(body.action!=='save')context.data.securityAuditHandled=true;
    return Response.json(result,{headers});
  }catch(error){
    if(idempotency?.owner)await failIdempotentRequest(context.env,idempotency,error);
    return Response.json({ok:false,message:error.message||String(error)},{status:error.status||500,headers});
  }
}
