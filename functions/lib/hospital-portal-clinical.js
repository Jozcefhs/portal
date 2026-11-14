import {clean,fail,id,digest} from './hospital-model.js';
import {field} from './hospital-orders-model.js';
import {clinicalAccessVersion,clinicalTypes,clinicalSource} from './hospital-clinical-source.js';

export const publicationKey=(type,parentId,grantId)=>digest(JSON.stringify(['clinical-portal',type,parentId,grantId]));
export function publicationView(row){return row?{DocumentId:row.DocumentId,Status:row.Status,SourceId:row.SourceId,PublishedAt:row.PublishedAt,UpdatedAt:row.UpdatedAt,Revision:row.__updateTime}:null;}
export function createHospitalPortalClinical(ctx){
  const {env,db,collection,requireCapability,branch,patient,clock,actor,condition,strip,operation,auditWrite}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  async function scope(body){const type=body.DocumentType,config=clinicalTypes[type];if(!config)fail('Choose a clinical document type.');requireCapability(config.capability);
    const BranchId=await branch(body),person=await patient(body.PatientId,BranchId),parentId=id(body.ParentId);return {type,BranchId,person,parentId};}
  const source=c=>clinicalSource({read,type:c.type,parentId:c.parentId,patientId:c.person.PatientId,branchId:c.BranchId});
  async function recipient(c,body){const GrantId=id(body.GrantId),grant=await read('PortalGrants',GrantId);
    if(!grant||grant.PatientId!==c.person.PatientId||grant.BranchId!==c.BranchId)fail('Choose a portal recipient for this patient.',404);
    const key=await publicationKey(c.type,c.parentId,GrantId),old=await read('PortalClinicalDocuments',key);return {grant,key,old};}
  return {
    async clinicalPortalContext(body){
      const c=await scope(body),s=await source(c),scopeKey=await digest(JSON.stringify([c.type,c.parentId,c.BranchId,c.person.PatientId]));
      const options={filters:[{field:'BranchId',op:'==',value:c.BranchId},{field:'PatientId',op:'==',value:c.person.PatientId}],orderBy:[{field:'__name__'}],limit:31};
      if(body.Cursor){if(body.Cursor.scope!==scopeKey)fail('Reload recipients for this record.');options.startAfterName=`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection('PortalGrants')}/${id(body.Cursor.id)}`;}
      const rows=await db.queryCollection(env,collection('PortalGrants'),options),shown=rows.slice(0,30);
      return {ok:true,ready:s.ready,message:s.message||'',SourceId:s.sourceId||'',SourceRevision:s.source?.__updateTime||'',ParentRevision:s.parent.__updateTime,
        recipients:shown.map(g=>({GrantId:g.GrantId,RecipientName:g.RecipientName,Kind:g.Kind,Relationship:g.Relationship,Status:g.Status,AccessUntil:g.AccessUntil,Revision:g.__updateTime})),
        next:rows.length>30?{scope:scopeKey,id:shown.at(-1).__id}:null};
    },
    async clinicalPortalSharing(body){const c=await scope(body),{grant,old}=await recipient(c,body);return {ok:true,publication:publicationView(old),AccessChanged:!!old&&old.GrantAccessVersion!==clinicalAccessVersion(grant)};},
    async publishClinicalPortalDocument(body){
      await scope(body);if(body.ConfirmClinicalReview!==true||body.ConfirmConsent!==true)fail('Confirm clinical review and this named recipientâ€™s authority to receive this medical document.');
      const Reason=field(body,'Reason',1000,true);
      return operation(body,'publishClinicalPortalDocument',async key=>{
        const c=await scope(body),s=await source(c);if(!s.ready)fail(s.message,409);
        const r=await recipient(c,body),g=r.grant;
        if(c.person.Status!=='Active'||!['Invited','Active'].includes(g.Status)||g.AccessUntil<=clock())fail('The patient and recipient access must be active and unexpired.',409);
        if(s.sourceId!==body.SourceId||s.source.__updateTime!==body.SourceRevision||s.parent.__updateTime!==body.ParentRevision||g.__updateTime!==body.GrantRevision)fail('The source or recipient changed. Reload and review before sharing.',409);
        if(r.old?.Status==='Published'&&r.old.SourceId===s.sourceId&&r.old.GrantAccessVersion===clinicalAccessVersion(g))return {writes:[],result:{Unchanged:true,DocumentId:r.key}};
        if((r.old?.__updateTime||'')!==(body.Revision||''))fail('Sharing changed. Reload its status before publishing.',409);
        const row={DocumentId:r.key,DocumentType:c.type,ParentId:c.parentId,SourceId:s.sourceId,PatientId:c.person.PatientId,BranchId:c.BranchId,
          GrantId:g.GrantId,GrantAccessVersion:clinicalAccessVersion(g),RecipientName:g.RecipientName,RecipientKind:g.Kind,Status:'Published',Title:s.title,Number:s.number,
          CreatedAt:r.old?.CreatedAt||clock(),PublishedAt:clock(),UpdatedAt:clock(),PublishedBy:actor};
        const event={EventId:key,DocumentId:r.key,PatientId:c.person.PatientId,BranchId:c.BranchId,GrantId:g.GrantId,RecipientName:g.RecipientName,Action:'Publish clinical portal document',
          Before:r.old?{Status:r.old.Status,SourceId:r.old.SourceId,GrantAccessVersion:r.old.GrantAccessVersion}:null,After:{Status:row.Status,SourceId:row.SourceId,GrantAccessVersion:row.GrantAccessVersion},Reason,Actor:actor,CreatedAt:clock()};
        // CAS guards the exact signed source, its current parent and recipient. No
        // clinical content changes, charges, notifications or new sessions occur.
        return {writes:[write('PortalClinicalDocuments',r.key,row,r.old),write('PortalClinicalEvents',key,event,null),
          write(clinicalTypes[c.type].parent,c.parentId,strip(s.parent),s.parent),write(clinicalTypes[c.type].source,s.sourceId,strip(s.source),s.source),
          write('PortalGrants',g.GrantId,strip(g),g),write('Patients',c.person.PatientId,strip(c.person),c.person),
          auditWrite(key,event.Action,c.BranchId,c.person,{DocumentId:r.key,SourceId:s.sourceId,RecipientName:g.RecipientName,Reason})],result:{DocumentId:r.key}};
      });
    },
    async withdrawClinicalPortalDocument(body){
      await scope(body);const Reason=field(body,'Reason',1000,true);
      return operation(body,'withdrawClinicalPortalDocument',async key=>{
        const c=await scope(body),r=await recipient(c,body);if(!r.old||r.old.Status==='Withdrawn')return {writes:[],result:{Unchanged:true}};
        if(r.old.__updateTime!==body.Revision)fail('Sharing changed. Reload before withdrawing.',409);
        const row={...strip(r.old),Status:'Withdrawn',UpdatedAt:clock(),WithdrawnBy:actor};
        return {writes:[write('PortalClinicalDocuments',r.key,row,r.old),write('PortalClinicalEvents',key,{EventId:key,DocumentId:r.key,PatientId:c.person.PatientId,BranchId:c.BranchId,GrantId:r.grant.GrantId,
          Action:'Withdraw clinical portal document',Before:{Status:r.old.Status,SourceId:r.old.SourceId},After:{Status:'Withdrawn',SourceId:r.old.SourceId},Reason,Actor:actor,CreatedAt:clock()},null),
          auditWrite(key,'Withdraw clinical portal document',c.BranchId,c.person,{DocumentId:r.key,RecipientName:r.grant.RecipientName,Reason})],result:{Withdrawn:true}};
      });
    }
  };
}
