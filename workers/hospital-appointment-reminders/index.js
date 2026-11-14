export async function run(env,fetcher=fetch){
  const endpoint=new URL(env.HOSPITAL_REMINDER_ENDPOINT);
  if(endpoint.protocol!=='https:'||endpoint.pathname!=='/api/hospital-appointment-reminders'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!env.HOSPITAL_REMINDER_WORKSPACE||!env.HOSPITAL_REMINDER_SCHEDULER_SECRET)throw Error('Invalid hospital reminder scheduler configuration');
  // Workers supports manual/follow, not error. Reject non-2xx below without following redirects.
  const response=await fetcher(endpoint,{method:'POST',headers:{Authorization:`Bearer ${env.HOSPITAL_REMINDER_SCHEDULER_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({expectedWorkspaceId:env.HOSPITAL_REMINDER_WORKSPACE}),signal:AbortSignal.timeout(60000),redirect:'manual'});
  if(!response.ok){await response.body?.cancel();throw Error(`Hospital reminder endpoint returned ${response.status}`);}
  // Endpoint emits aggregate counts only, never patient names, addresses or message contents.
  const result=await response.json();if(result.workspaceId!==env.HOSPITAL_REMINDER_WORKSPACE||result.edition!=='hospital'||result.ok!==true)throw Error('Unexpected hospital reminder response');
  return result;
}
export default {
  async scheduled(_event,env){const result=await run(env);console.log(JSON.stringify({checked:result.checked,paused:!!result.paused,counts:result.counts||{}}));},
  fetch(){return new Response('Scheduled appointment reminders',{status:404,headers:{'Cache-Control':'no-store'}});}
};
