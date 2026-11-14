import {clean,fail,id,digest,nameKey} from './hospital-model.js';
import {field,dateOnly} from './hospital-orders-model.js';
import {portalToken,portalCodeFor,portalGrantView,portalSecret} from './hospital-portal-model.js';

export function createHospitalPortalAccess(ctx){
  const {env,db,collection,requireCapability,branch,patient,clock,actor,condition,strip,operation,auditWrite}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  async function current(body){const BranchId=await branch(body),person=await patient(body.PatientId,BranchId);return {BranchId,person};}
  const event=(key,row,Action,Reason)=>write('PortalEvents',key,{EventId:key,GrantId:row.GrantId,PatientId:row.PatientId,BranchId:row.BranchId,
    Action,Reason,Actor:actor,RecipientName:row.RecipientName,Kind:row.Kind,CreatedAt:clock()},null);
  return {
    async patientPortalAccess(body){
      requireCapability('patients.write');const {BranchId,person}=await current(body);
      const options={filters:[{field:'BranchId',op:'==',value:BranchId},{field:'PatientId',op:'==',value:person.PatientId}],orderBy:[{field:'__name__'}],limit:31};
      const scope=await digest(JSON.stringify([BranchId,person.PatientId]));
      if(body.Cursor){if(body.Cursor.scope!==scope)fail('Load access for this patient first.');options.startAfterName=`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection('PortalGrants')}/${id(body.Cursor.id)}`;}
      const rows=await db.queryCollection(env,collection('PortalGrants'),options),shown=rows.slice(0,30);
      return {ok:true,grants:shown.map(portalGrantView),next:rows.length>30?{id:shown.at(-1).__id,scope}:null};
    },
    async issuePatientPortalAccess(body){
      requireCapability('patients.write');portalSecret(env);await branch(body);
      if(body.ConfirmIdentity!==true||body.ConfirmAuthority!==true)fail('Confirm the recipient’s identity and authority to view this patient’s financial documents.');
      const Reason=field(body,'Reason',500,true),InvitationHash=await digest(portalToken(body.InvitationToken));
      const until=dateOnly(body.AccessUntil),AccessUntil=new Date(`${until}T23:59:59.999+01:00`).toISOString();
      if(AccessUntil<=clock()||Date.parse(AccessUntil)>Date.parse(clock())+367*86400000)fail('Choose an access expiry within the next year.');
      return operation(body,'issuePatientPortalAccess',async key=>{
        const {BranchId,person}=await current(body);if(person.Status!=='Active')fail('This patient registration is not active.',409);
        let old,GrantId,fields;
        if(body.GrantId){
          GrantId=id(body.GrantId);old=await read('PortalGrants',GrantId);
          if(!old||old.PatientId!==person.PatientId||old.BranchId!==BranchId)fail('This access record is not available for this patient.',404);
          if(body.Revision!==old.__updateTime)fail('Refresh access before replacing the invitation.',409);
          fields={Kind:old.Kind,RecipientName:old.RecipientName,Contact:old.Contact,Relationship:old.Relationship};
        }else{
          const Kind=body.Kind;if(!['Patient','Guardian'].includes(Kind))fail('Choose patient or authorised guardian.');
          const Contact=field(body,'Contact',160,true),RecipientName=field(body,'RecipientName',160,true);
          const Relationship=Kind==='Guardian'?field(body,'Relationship',80,true):'Self';
          GrantId=await digest(JSON.stringify(['portal',BranchId,person.PatientId,Kind,Kind==='Patient'?'self':nameKey(Contact)]));
          old=await read('PortalGrants',GrantId);
          if(old)fail('This recipient already has an access record. Refresh and use Replace invitation on that record.',409);
          fields={Kind,RecipientName,Contact,Relationship};
        }
        const next={GrantId,PatientId:person.PatientId,BranchId,...fields,AccessUntil,InvitationHash,
          InvitationExpiresAt:new Date(Math.min(Date.parse(AccessUntil),Date.parse(clock())+7*86400000)).toISOString(),
          Status:'Invited',AuthVersion:key,CreatedAt:old?.CreatedAt||clock(),UpdatedAt:clock(),UpdatedBy:actor};
        const Action=old?'Replace patient portal access':'Authorise patient portal access';
        return {writes:[write('PortalGrants',GrantId,next,old),write('Patients',person.PatientId,strip(person),person),event(key,next,Action,Reason),
          auditWrite(key,Action,BranchId,person,{GrantId,Kind:next.Kind,RecipientName:next.RecipientName,Reason})],
          result:{GrantId,AccessCode:portalCodeFor(GrantId),InvitationExpiresAt:next.InvitationExpiresAt,AccessUntil}};
      });
    },
    async revokePatientPortalAccess(body){
      requireCapability('patients.write');const Reason=field(body,'Reason',500,true);await branch(body);
      return operation(body,'revokePatientPortalAccess',async key=>{
        const {BranchId,person}=await current(body),GrantId=id(body.GrantId),old=await read('PortalGrants',GrantId);
        if(!old||old.BranchId!==BranchId||old.PatientId!==person.PatientId)fail('This access record is not available for this patient.',404);
        if(old.Status==='Revoked')return {writes:[],result:{Unchanged:true}};
        if(body.Revision!==old.__updateTime)fail('Refresh access before revoking it.',409);
        const next={...strip(old),Status:'Revoked',AuthVersion:key,InvitationHash:'',PasswordHash:'',Salt:'',UpdatedAt:clock(),UpdatedBy:actor};
        return {writes:[write('PortalGrants',GrantId,next,old),event(key,next,'Revoke patient portal access',Reason),auditWrite(key,'Revoke patient portal access',BranchId,person,{GrantId,Reason})],result:{Revoked:true}};
      });
    }
  };
}
