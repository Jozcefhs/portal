import {fail,id,patientName} from './hospital-model.js';
import {field} from './hospital-orders-model.js';
import {clinicalAccessVersion} from './hospital-clinical-source.js';
import {eq,threadView,messageView,activeRecipient,inboxFilters,messagePage,requireThreadRevision} from './hospital-messages-model.js';

export function createHospitalMessages(ctx){
  const {env,db,collection,requireCapability,branch,patient,clock,actor,condition,strip,operation,auditWrite,user}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  async function scope(body,start=false){requireCapability(start?'consultations.write':'clinical.read');return branch(body);}
  async function thread(body){const BranchId=await scope(body),row=await read('PortalThreads',body.ThreadId);if(!row||row.BranchId!==BranchId)fail('Conversation not found in this branch.',404);return row;}
  async function authority(row){const p=await patient(row.PatientId,row.BranchId),g=await read('PortalGrants',row.GrantId);return {p,g,active:activeRecipient(g,p,clock(),row)};}
  const entry=(key,row,Text)=>({MessageId:key,ThreadId:row.ThreadId,PatientId:row.PatientId,BranchId:row.BranchId,GrantId:row.GrantId,
    Sequence:String(row.MessageCount).padStart(10,'0'),Sender:'Care team',SenderName:user.displayName||actor,Actor:actor,Text,CreatedAt:clock()});
  return {
    async messageRecipients(body){const BranchId=await scope(body,true),p=await patient(body.PatientId,BranchId);
      return {ok:true,...await messagePage(ctx,'PortalGrants',[eq('BranchId',BranchId),eq('PatientId',p.PatientId)],'CreatedAt',body,
        g=>({GrantId:g.GrantId,RecipientName:g.RecipientName,Kind:g.Kind,Relationship:g.Relationship,Status:g.Status,AccessUntil:g.AccessUntil,Revision:g.__updateTime,Available:activeRecipient(g,p,clock(),{BranchId})}))};},
    async messageInbox(body){const BranchId=await scope(body);return {ok:true,...await messagePage(ctx,'PortalThreads',inboxFilters(body,[eq('BranchId',BranchId)]),'UpdatedAt',body,threadView)};},
    async messageThread(body){const row=await thread(body),a=await authority(row);return {ok:true,thread:threadView(row),CanReply:row.Status==='Open'&&a.active,
      AccessMessage:a.active?'':'Recipient access expired, was revoked or reissued. Open a new conversation after verifying consent.',
      ...await messagePage(ctx,'PortalMessages',[eq('BranchId',row.BranchId),eq('ThreadId',row.ThreadId)],'Sequence',body,messageView)};},
    async startMessageThread(body){
      await scope(body,true);const Subject=field(body,'Subject',160,true),Text=field(body,'Text',4000,true),Reason=field(body,'Reason',1000,true);
      if(body.ConfirmConsent!==true)fail('Confirm the named recipient is authorised to discuss this patient’s care.');
      return operation(body,'startMessageThread',async key=>{
        const BranchId=await scope(body,true),p=await patient(body.PatientId,BranchId),g=await read('PortalGrants',body.GrantId);
        if(!activeRecipient(g,p,clock(),{BranchId})||g.__updateTime!==body.GrantRevision)fail('Recipient access changed. Reload and verify the recipient before starting.',409);
        const row={ThreadId:key,PatientId:p.PatientId,PatientName:patientName(p),HospitalNumber:p.HospitalNumber,BranchId,GrantId:g.GrantId,
          GrantAccessVersion:clinicalAccessVersion(g),RecipientName:g.RecipientName,RecipientKind:g.Kind,Subject,Status:'Open',LastSender:'Care team',MessageCount:1,CreatedAt:clock(),UpdatedAt:clock()};
        return {writes:[write('PortalThreads',key,row,null),write('PortalMessages',key,entry(key,row,Text),null),
          write('PortalMessageEvents',key,{EventId:key,ThreadId:key,PatientId:p.PatientId,BranchId,Action:'Open conversation',Reason,Actor:actor,CreatedAt:clock()},null),
          write('PortalGrants',g.GrantId,strip(g),g),write('Patients',p.PatientId,strip(p),p),
          auditWrite(key,'Open patient conversation',BranchId,p,{ThreadId:key,RecipientName:g.RecipientName,Reason})],result:{ThreadId:key}};
      });
    },
    async replyMessageThread(body){await scope(body);const Text=field(body,'Text',4000,true);
      return operation(body,'replyMessageThread',async key=>{
        const old=await thread(body),a=await authority(old);if(old.Status!=='Open'||!a.active)fail('This conversation is closed or recipient access changed.',409);requireThreadRevision(old,body);
        const row={...strip(old),MessageCount:old.MessageCount+1,LastSender:'Care team',UpdatedAt:clock()};
        return {writes:[write('PortalThreads',row.ThreadId,row,old),write('PortalMessages',key,entry(key,row,Text),null),
          write('PortalGrants',a.g.GrantId,strip(a.g),a.g),write('Patients',a.p.PatientId,strip(a.p),a.p)],result:{ThreadId:row.ThreadId}};
      });
    },
    async closeMessageThread(body){await scope(body);const Reason=field(body,'Reason',1000,true);if(!['Open','Closed'].includes(body.Status))fail('Choose open or closed.');
      return operation(body,'closeMessageThread',async key=>{
        const old=await thread(body);if(old.Status===body.Status)return {writes:[],result:{Unchanged:true,ThreadId:old.ThreadId}};
        requireThreadRevision(old,body);const a=await authority(old);
        if(body.Status==='Open'&&!a.active)fail('Recipient access changed. Verify consent and open a new conversation.',409);
        const row={...strip(old),Status:body.Status,UpdatedAt:clock()},writes=[write('PortalThreads',row.ThreadId,row,old),
          write('PortalMessageEvents',key,{EventId:key,ThreadId:row.ThreadId,PatientId:row.PatientId,BranchId:row.BranchId,Action:'Change conversation status',Before:old.Status,After:row.Status,Reason,Actor:actor,CreatedAt:clock()},null),
          auditWrite(key,'Change patient conversation status',row.BranchId,a.p,{ThreadId:row.ThreadId,Before:old.Status,After:row.Status,Reason})];
        if(body.Status==='Open')writes.push(write('PortalGrants',a.g.GrantId,strip(a.g),a.g),write('Patients',a.p.PatientId,strip(a.p),a.p));
        return {writes,result:{ThreadId:row.ThreadId}};
      });
    }
  };
}
