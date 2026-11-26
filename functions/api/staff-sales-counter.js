import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { salesCounter } from '../lib/sales-counter.js';

export async function onRequestPost({env,request}) {
  try {
    const user=await requireStaffSession(env,request);
    const body=await readJsonBody(request,{maxBytes:64*1024});
    return Response.json(await salesCounter(env,user,body),{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    return Response.json({message:error.message},{status:error.status||500,headers:{'Cache-Control':'no-store'}});
  }
}
