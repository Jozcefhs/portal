import {clean,fail,id,digest} from './hospital-model.js';
import {dateFilters} from './hospital-orders-model.js';
import {clinicalAccessVersion} from './hospital-clinical-source.js';

export const eq=(field,value)=>({field,op:'==',value});
export const strip=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!k.startsWith('__')));
export const threadView=r=>({ThreadId:r.ThreadId,Subject:r.Subject,PatientName:r.PatientName,HospitalNumber:r.HospitalNumber,
  RecipientName:r.RecipientName,RecipientKind:r.RecipientKind,Status:r.Status,LastSender:r.LastSender,
  UpdatedAt:r.UpdatedAt,CreatedAt:r.CreatedAt,MessageCount:r.MessageCount,Revision:r.__updateTime});
export const messageView=r=>({MessageId:r.MessageId,Sequence:r.Sequence,Sender:r.Sender,SenderName:r.SenderName,Text:r.Text,CreatedAt:r.CreatedAt});
export function activeRecipient(g,p,now,thread){
  return !!g&&g.PatientId===p.PatientId&&g.BranchId===thread.BranchId&&p.Status==='Active'&&p.AccessBranchIds?.includes(g.BranchId)
    &&['Invited','Active'].includes(g.Status)&&g.AccessUntil>now&&(!thread.GrantAccessVersion||thread.GrantAccessVersion===clinicalAccessVersion(g));
}
export function inboxFilters(body,filters){
  if(!['Open','Closed'].includes(body.Status))fail('Choose open conversations or dated closed history.');
  return [...filters,eq('Status',body.Status),...(body.Status==='Closed'?dateFilters({fromDate:body.From,toDate:body.To},'UpdatedAt'):[])];
}
// Every list is bounded. Cursor fingerprints prevent reuse across patient,
// recipient, branch, status or date scopes. Opening a page never writes records.
export async function messagePage({env,db,collection},name,filters,field,body,view){
  const scope=await digest(JSON.stringify([name,filters,field]));let cursor={};
  if(body.Cursor){
    if(body.Cursor.scope!==scope||typeof body.Cursor.value!=='string'||body.Cursor.value.length>128)fail('Reload this list before changing pages.');
    cursor={startAfterName:`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection(name)}/${id(body.Cursor.id)}`,startAfterFieldValue:body.Cursor.value};
  }
  const rows=await db.queryCollection(env,collection(name),{filters,limit:31,orderBy:[{field},{field:'__name__'}],...cursor}),shown=rows.slice(0,30);
  return {rows:shown.map(view),next:rows.length>30?{scope,id:shown.at(-1).__id,value:String(shown.at(-1)[field])}:null};
}
export function requireThreadRevision(row,body){if(!clean(body.Revision)||row.__updateTime!==body.Revision)fail('This conversation changed. Refresh it before sending or changing its status. Your text has been retained.',409);}
