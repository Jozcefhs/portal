import {clean,fail,id,digest,patientSummary,patientName} from './hospital-model.js';
import {field,dateFilters,allergySnapshot} from './hospital-orders-model.js';
import {configuredStaffBranches} from './staff-branch-context.js';
import {assignedStaffBranches} from './staff-branch-access.js';

export function createHospitalReferralsService(ctx){
  const {env,user,db,collection,requireCapability,branch,patient,clock,actor,condition,strip,eq,auditWrite,auditRead,operation,page}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const view=row=>({...strip(row),Revision:row.__updateTime});
  const stamp=()=>({UpdatedAt:clock(),UpdatedBy:actor});
  const revision=(row,value)=>{if(!value||value!==row?.__updateTime)fail('This referral or visit changed. Refresh before continuing.',409);};
  const confirm=body=>{if(body.ConfirmPatient!==true)fail('Confirm the patient and hospital number.');};
  const dates=body=>({FromDate:clean(body.DateRange?.fromDate),ToDate:clean(body.DateRange?.toDate)});
  async function current(body){
    requireCapability('consultations.write');const BranchId=await branch(body),row=await read('Referrals',body.ReferralId);
    if(!row||!row.AccessBranchIds.includes(BranchId)||row.PatientId!==body.PatientId
      ||BranchId!==row.BranchId&&row.Recipient!==actor.toLowerCase())fail('This referral is not available to you in this branch.',404);
    return {BranchId,row};
  }
  function event(key,row,Type,Reason){return write('ReferralEvents',key,{EventId:key,ReferralId:row.ReferralId,PatientId:row.PatientId,
    AccessBranchIds:row.AccessBranchIds,Type,Reason,Snapshot:strip(row),CreatedAt:clock(),...stamp()},null);}
  const identity=row=>({ReferralId:row.ReferralId,PatientId:row.PatientId,Status:row.Status,VisitId:row.ReceivingVisitId||row.VisitId});
  async function visitContext(body){
    requireCapability('consultations.write');const BranchId=await branch(body),visit=await read('Visits',body.VisitId);
    if(!visit||visit.BranchId!==BranchId||visit.PatientId!==body.PatientId)fail('Choose this patient’s visit in this branch.',404);
    const [person,care]=await Promise.all([patient(visit.PatientId,BranchId),read('CareSummaries',visit.PatientId)]);
    return {BranchId,visit,person,care};
  }
  return {
    async referralContext(body){
      const c=await visitContext(body),branches=configuredStaffBranches(await db.getSchoolStructure(env));
      await auditRead(body,'View referral preparation',c.BranchId,c.person);
      return {ok:true,patient:patientSummary(c.person),visit:view(c.visit),allergies:allergySnapshot(c.care||{}),CareRevision:c.care?.__updateTime||'',branches};
    },
    async signReferral(body){
      requireCapability('consultations.write');await branch(body);confirm(body);
      return operation(body,'signReferral',async key=>{
        const c=await visitContext(body);revision(c.visit,body.VisitRevision);
        if((c.care?.__updateTime||'')!==clean(body.CareRevision))fail('Allergy information changed. Refresh and review before signing.',409);
        if(c.person.Status!=='Active'||!['Waiting','In progress'].includes(c.visit.Status))fail('Choose an active patient visit to sign a referral.',409);
        const input=body.Referral||{},Kind=field(input,'Kind',20,true),Department=field(input,'Department',120,true),Urgency=field(input,'Urgency',30,true);
        if(!['Internal','External'].includes(Kind)||!['Routine','Urgent','Emergency'].includes(Urgency))fail('Choose a referral type and urgency.');
        const Reason=field(input,'Reason',2000,true),Summary=field(input,'Summary',6000,true),Instructions=field(input,'Instructions',2000);
        if(body.ConfirmClinicalReview!==true)fail('Review and confirm the referral content and allergy information before signing.');
        let TargetBranchId=c.BranchId,TargetName='',Recipient='',RecipientName='';
        if(Kind==='Internal'){
          TargetBranchId=field(input,'TargetBranchId',128,true).toLowerCase();Recipient=field(input,'Recipient',254,true).toLowerCase();
          const branches=configuredStaffBranches(await db.getSchoolStructure(env)),target=branches.find(b=>b.id===TargetBranchId);
          if(!target)fail('Choose a configured receiving branch.');TargetName=target.name;
          const matches=await db.queryCollection(env,'staffUsers',{filters:[eq('UsernameKey',Recipient)],limit:2}),u=matches[0],allowed=u?assignedStaffBranches(u):[];
          if(matches.length!==1||clean(u.Username).toLowerCase()!==Recipient||!['Doctor','Medical Director'].includes(u.Role)
            ||!['true','yes','1'].includes(String(u.Active??true).toLowerCase())||clean(u.OrganisationEdition||u.OrganizationEdition).toLowerCase()!=='hospital'
            ||allowed!==null&&!allowed.includes(TargetBranchId))fail('Choose an active Doctor or Medical Director assigned to the receiving branch.');
          RecipientName=clean(u.DisplayName)||Recipient;
        }else{TargetName=field(input,'Facility',200,true);RecipientName=field(input,'RecipientName',200);}
        const GuardId=await digest(JSON.stringify([c.visit.VisitId,Kind,TargetBranchId,TargetName.toLowerCase(),Department.toLowerCase(),Recipient]));
        const guard=await read('ReferralGuards',GuardId);
        if(guard?.Open)fail('An open referral already exists for this visit and destination. Open it from the referral register.',409);
        const row={ReferralId:key,GuardId,PatientId:c.person.PatientId,PatientName:patientName(c.person),HospitalNumber:c.person.HospitalNumber,
          DateOfBirth:c.person.DateOfBirth||'',Sex:c.person.Sex,VisitId:c.visit.VisitId,BranchId:c.BranchId,TargetBranchId,
          AccessBranchIds:[...new Set([c.BranchId,TargetBranchId])],Kind,TargetName,Department,Recipient,RecipientName,Urgency,Reason,Summary,Instructions,
          Allergies:allergySnapshot(c.care||{}),Status:'Awaiting acknowledgement',SignedAt:clock(),SignedBy:actor,SignedByName:clean(user.displayName)||actor,CreatedAt:clock(),...stamp()};
        return {writes:[write('Referrals',key,row,null),write('ReferralGuards',GuardId,{Open:true,ReferralId:key},guard),
          write('Visits',c.visit.VisitId,{...strip(c.visit),...stamp(),DischargeApprovalId:''},c.visit),
          // Serialize allergy edits without changing the clinical information.
          ...(c.care?[write('CareSummaries',c.person.PatientId,strip(c.care),c.care)]:[write('CareSummaries',c.person.PatientId,{PatientId:c.person.PatientId,AllergyStatus:'Unknown'},null)]),
          event(key,row,'Signed',''),auditWrite(key,'Sign referral',c.BranchId,c.person,{ReferralId:key,Destination:TargetName})],result:identity(row)};
      });
    },
    async referralRegister(body){
      requireCapability('consultations.write');const BranchId=await branch(body),incoming=body.Direction==='Incoming';
      const filters=incoming?[eq('TargetBranchId',BranchId),eq('Recipient',actor.toLowerCase())]:[eq('BranchId',BranchId)];
      const r=await page('Referrals',[...filters,...dateFilters(body.DateRange)],'CreatedAt',body);
      await auditRead(body,'View referral register',BranchId,{},dates(body));
      return {ok:true,referrals:r.rows.map(({Summary,Reason,Instructions,Allergies,...row})=>view(row)),next:r.next};
    },
    async referralDetails(body){
      const c=await current(body);let receivingVisit=null;
      if(c.row.Kind==='Internal'&&c.BranchId===c.row.TargetBranchId&&c.row.Recipient===actor.toLowerCase()){
        const open=await read('OpenVisits',await digest(JSON.stringify([c.BranchId,c.row.PatientId])));
        const visit=open?.VisitId?await read('Visits',open.VisitId):null;
        if(visit&&visit.PatientId===c.row.PatientId&&visit.BranchId===c.BranchId)receivingVisit={VisitId:visit.VisitId,Department:visit.Department,Status:visit.Status};
      }
      await auditRead(body,'View signed referral',c.BranchId,{PatientId:c.row.PatientId,LastName:c.row.PatientName,HospitalNumber:c.row.HospitalNumber});
      const receiving=c.row.Kind==='External'?c.BranchId===c.row.BranchId:c.BranchId===c.row.TargetBranchId&&c.row.Recipient===actor.toLowerCase();
      const actions=c.row.Status==='Awaiting acknowledgement'?[...(receiving?['Acknowledge','Decline']:[]),...(c.BranchId===c.row.BranchId?['Cancel']:[])]:c.row.Status==='Acknowledged'&&receiving?['Complete']:[];
      return {ok:true,referral:view(c.row),receivingVisit,actions};
    },
    async updateReferral(body){
      requireCapability('consultations.write');await branch(body);confirm(body);
      return operation(body,'updateReferral',async key=>{
        const c=await current(body),row=c.row,Action=clean(body.Action),Reason=field(body,'Reason',2000,true);
        revision(row,body.Revision);
        const receiving=row.Kind==='Internal'&&c.BranchId===row.TargetBranchId&&row.Recipient===actor.toLowerCase();
        const source=c.BranchId===row.BranchId;
        if(!['Acknowledge','Decline','Cancel','Complete'].includes(Action))fail('Choose a valid referral action.');
        if(Action==='Cancel'?!source:row.Kind==='Internal'?!receiving:!source)fail('Only the designated receiving clinician can acknowledge or complete this referral.',403);
        if(Action==='Complete'?row.Status!=='Acknowledged':row.Status!=='Awaiting acknowledgement')fail('This action no longer applies to the referral.',409);
        const writes=[],next={...strip(row),Status:({Acknowledge:'Acknowledged',Decline:'Declined',Cancel:'Cancelled',Complete:'Completed'})[Action],...stamp()};
        if(Action==='Acknowledge'&&row.Kind==='Internal'){
          if(body.ConfirmSharedCare!==true)fail('Confirm receiving care and sharing the patient registration with this branch.');
          const person=await read('Patients',row.PatientId);if(!person||person.Status!=='Active')fail('The patient registration is not active.',409);
          const openId=await digest(JSON.stringify([c.BranchId,row.PatientId])),open=await read('OpenVisits',openId);
          let visit=open?.VisitId?await read('Visits',open.VisitId):null;
          if(open?.VisitId&&!visit)fail('The receiving visit reference needs review before accepting this referral.',409);
          if(visit&&(!['Waiting','In progress'].includes(visit.Status)||visit.PatientId!==row.PatientId||visit.BranchId!==c.BranchId))fail('The receiving visit changed. Refresh the visit register.',409);
          if(visit&&body.ReceivingVisitId!==visit.VisitId)fail('This patient already has an open receiving-branch visit. Enter its reference to link it explicitly.',409);
          if(!visit&&body.ReceivingVisitId)fail('The selected receiving visit is no longer open.',409);
          const VisitId=visit?.VisitId||key;next.ReceivingVisitId=VisitId;next.AcknowledgedAt=clock();next.AcknowledgedBy=actor;
          const data=visit?{...strip(visit),...stamp()}:{VisitId,PatientId:row.PatientId,PatientName:row.PatientName,HospitalNumber:row.HospitalNumber,BranchId:c.BranchId,
            Department:row.Department,Status:'Waiting',CreatedAt:clock(),CreatedBy:actor,...stamp()};
          writes.push(write('Visits',VisitId,data,visit),write('OpenVisits',openId,{PatientId:row.PatientId,VisitId,BranchId:c.BranchId},open));
          writes.push(write('Patients',row.PatientId,{...strip(person),AccessBranchIds:[...new Set([...person.AccessBranchIds,c.BranchId])]},person));
        }
        if(Action==='Acknowledge'&&row.Kind==='External'){
          if(body.ConfirmExternalAcknowledgement!==true)fail('Confirm that acknowledgement was actually received from the external facility.');
          next.AcknowledgedAt=clock();next.AcknowledgedBy=actor;
        }
        if(Action==='Complete'){next.CompletedAt=clock();next.CompletedBy=actor;}
        if(Action!=='Acknowledge'){
          const guard=await read('ReferralGuards',row.GuardId);
          if(!guard||guard.ReferralId!==row.ReferralId||!guard.Open)fail('This referral state changed. Refresh before continuing.',409);
          writes.push(write('ReferralGuards',row.GuardId,{Open:false,ReferralId:row.ReferralId},guard));
        }
        writes.push(write('Referrals',row.ReferralId,next,row),event(key,next,Action,Reason),auditWrite(key,`${Action} referral`,c.BranchId,
          {PatientId:row.PatientId,LastName:row.PatientName,HospitalNumber:row.HospitalNumber},{ReferralId:row.ReferralId}));
        return {writes,result:identity(next)};
      });
    },
    async referralHistory(body){const c=await current(body),r=await page('ReferralEvents',[eq('ReferralId',c.row.ReferralId),...dateFilters(body.DateRange)],'CreatedAt',body);
      await auditRead(body,'View referral history',c.BranchId,{PatientId:c.row.PatientId,LastName:c.row.PatientName,HospitalNumber:c.row.HospitalNumber},dates(body));return {ok:true,events:r.rows.map(view),next:r.next};}
  };
}
