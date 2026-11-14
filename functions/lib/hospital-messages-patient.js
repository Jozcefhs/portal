import {fail,id,digest,stable} from './hospital-model.js';
import {field} from './hospital-orders-model.js';
import {clinicalAccessVersion} from './hospital-clinical-source.js';
import {eq,strip,threadView,messageView,inboxFilters,messagePage,requireThreadRevision} from './hospital-messages-model.js';

export async function patientMessages(ctx){
  const {read,write,commit,clock,grant,person,session,body}=ctx;
  const filters=[eq('BranchId',grant.BranchId),eq('PatientId',person.PatientId),eq('GrantId',grant.GrantId),eq('GrantAccessVersion',clinicalAccessVersion(grant))];
  if(body.action==='messageInbox')return {ok:true,...await messagePage(ctx,'PortalThreads',inboxFilters(body,filters),'UpdatedAt',body,threadView)};
  const row=await read('PortalThreads',id(body.ThreadId));
  if(!row||row.PatientId!==person.PatientId||row.BranchId!==grant.BranchId||row.GrantId!==grant.GrantId||row.GrantAccessVersion!==clinicalAccessVersion(grant))fail('This conversation is not available to your access.',404);
  if(body.action==='messageThread')return {ok:true,thread:threadView(row),CanReply:row.Status==='Open',...await messagePage(ctx,'PortalMessages',[eq('BranchId',row.BranchId),eq('ThreadId',row.ThreadId)],'Sequence',body,messageView)};
  const Text=field(body,'Text',4000,true),key=await digest(JSON.stringify(['portal-message',grant.GrantId,grant.AuthVersion,id(body.RequestId)])),Fingerprint=await digest(JSON.stringify(stable(body)));
  const replay=async()=>{const r=await read('PortalMessageReceipts',key);if(!r)return null;if(r.Fingerprint!==Fingerprint)fail('This request reference was used for different text. Refresh and try again.',409);return {ok:true,ThreadId:row.ThreadId,replayed:true};};
  const saved=await replay();if(saved)return saved;
  if(row.Status!=='Open')fail('This conversation is closed. Contact the hospital if you need further help.',409);
  requireThreadRevision(row,body);
  const next={...strip(row),MessageCount:row.MessageCount+1,LastSender:'Recipient',UpdatedAt:clock()};
  try{await commit([write('PortalThreads',row.ThreadId,next,row),write('PortalMessages',key,{MessageId:key,ThreadId:row.ThreadId,PatientId:person.PatientId,BranchId:grant.BranchId,GrantId:grant.GrantId,
    Sequence:String(next.MessageCount).padStart(10,'0'),Sender:grant.Kind,SenderName:grant.RecipientName,Actor:`portal:${grant.GrantId}`,Text,CreatedAt:clock()},null),
    write('PortalMessageReceipts',key,{Fingerprint,ThreadId:row.ThreadId,CreatedAt:clock()},null),
    // These CAS guards prevent a concurrent revocation, sign-out or identity change
    // from accepting a message after authority was removed. Browsing is read-only.
    write('PortalGrants',grant.GrantId,strip(grant),grant),write('Patients',person.PatientId,strip(person),person),write('PortalSessions',session.SessionId,strip(session),session)]);}
  catch(e){if(e.status!==409)throw e;const result=await replay();if(result)return result;fail('Access or conversation changed. Refresh before retrying; your text has been retained.',409);}
  return {ok:true,ThreadId:row.ThreadId};
}
