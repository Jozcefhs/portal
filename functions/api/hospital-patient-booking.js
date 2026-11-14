import {readJsonBody} from '../lib/request-security.js';
import {hospitalPatientBookingAction} from '../lib/hospital-patient-booking.js';

export async function onRequestPost({request,env,data}){
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  try{
    if(request.headers.get('Origin')!==new URL(request.url).origin)return Response.json({ok:false,message:'Open the personal booking page to continue.'},{status:403,headers});
    const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''),body=await readJsonBody(request,{maxBytes:4096});
    // Successful mutations own an atomic audit. Browsing does not write logs or
    // persist bearer tokens; security failures remain available to middleware.
    const result=await hospitalPatientBookingAction(env,token,body);if(data)data.securityAuditHandled=true;
    return Response.json(result,{headers});
  }catch(error){const status=Number(error.status||500);return Response.json({ok:false,message:status>=500?'Booking could not finish. Retry the same action; an existing booking will not be duplicated.':error.message},{status,headers});}
}
