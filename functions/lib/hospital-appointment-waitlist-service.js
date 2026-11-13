import {clean,fail,id,digest,stable,nameKey,patientSummary,patientName} from './hospital-model.js';
import {field,dateOnly,dateFilters,watDay} from './hospital-orders-model.js';
import {appointmentReference} from './hospital-appointments-model.js';

export function createHospitalAppointmentWaitlistService(ctx,{clinician}){
  const {env,user,db,collection,requireCapability,branch,patient,clock,actor,condition,strip,eq,auditWrite,auditRead,operation,page}=ctx;
  const keyFor=(...parts)=>digest(JSON.stringify(parts));
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const view=row=>({...strip(row),Revision:row.__updateTime});
  const stamp=()=>({UpdatedAt:clock(),UpdatedBy:actor,UpdatedByName:clean(user.displayName)||actor});
  const revision=(row,value)=>{if(!value||row.__updateTime!==value)fail('This waitlist request changed. Refresh before saving.',409);};
  const confirm=body=>{if(body.ConfirmPatient!==true)fail('Confirm the patient and hospital number.');};
  const guardKey=row=>keyFor('appointment-waiting',row.BranchId,row.PatientId,nameKey(row.Department));
  const event=(key,row,Type,Reason='')=>write('AppointmentWaitlistEvents',key,{EventId:key,WaitlistId:row.WaitlistId,PatientId:row.PatientId,
    BranchId:row.BranchId,Type,Reason,Snapshot:strip(row),CreatedAt:clock(),...stamp()},null);
  async function current(body){
    const BranchId=await branch(body),row=await read('AppointmentWaitlist',body.WaitlistId);
    if(!row||row.BranchId!==BranchId||row.PatientId!==body.PatientId)fail('Choose this patient’s waitlist request in the selected branch.',404);
    return {BranchId,row,person:await patient(row.PatientId,BranchId)};
  }
  function preferences(input){
    const PreferredFrom=dateOnly(input?.PreferredFrom),PreferredTo=dateOnly(input?.PreferredTo);
    if(PreferredTo<PreferredFrom||PreferredTo<watDay(clock())||Date.parse(PreferredTo)-Date.parse(PreferredFrom)>366*86400000||Date.parse(PreferredTo)-Date.parse(clock())>366*86400000)fail('Choose a valid preferred date range ending within the next year.');
    return {PreferredFrom,PreferredTo,Clinician:field(input,'Clinician',120).toLowerCase(),Note:field(input,'Note',1000)};
  }
  async function scopedPage(name,filters,fieldName,body){
    const scope=await keyFor(name,filters,fieldName);
    if(body.Cursor&&body.Cursor.scope!==scope)fail('This page cursor belongs to different waitlist filters. Load the first page.');
    const result=await page(name,filters,fieldName,body);
    return {...result,next:result.next?{...result.next,scope}:null};
  }
  async function waitingGuard(row){
    const key=await guardKey(row),guard=await read('AppointmentWaitlistGuards',key);
    if(!guard||guard.WaitlistId!==row.WaitlistId)fail('The waiting request has changed. Refresh before continuing.',409);
    return {key,guard};
  }
  return {
    // These writes join the appointment, capacity and resource guards in ONE commit.
    async prepareBooking(body,old,selected,schedule,person,key){
      if(!body.WaitlistId)return {writes:[],WaitlistId:old?.WaitlistId||''};
      const row=await read('AppointmentWaitlist',body.WaitlistId);
      if(!row||row.BranchId!==schedule.BranchId||row.PatientId!==person.PatientId)fail('Choose this patient’s waitlist request in the selected branch.',404);
      if(row.Status==='Booked'){
        if(old?.AppointmentId===row.AppointmentId&&old.WaitlistId===row.WaitlistId)return {writes:[],WaitlistId:row.WaitlistId};
        fail('This waiting request already has an appointment. Open the saved booking instead.',409);
      }
      if(old||row.Status!=='Waiting')fail('Only a waiting request can become a new appointment.',409);
      revision(row,body.WaitlistRevision);
      if(nameKey(row.Department)!==nameKey(schedule.Department)||(row.Clinician&&row.Clinician!==schedule.Clinician))fail('Choose a clinic matching the saved department and preferred doctor, or edit the waiting request first.',409);
      const day=watDay(selected.StartAt);
      if(day<row.PreferredFrom||day>row.PreferredTo)fail('Choose a date within the patient’s saved preferred dates, or edit the waiting request first.',409);
      const {key:guardId,guard}=await waitingGuard(row),AppointmentId=await keyFor('appointment',row.BranchId,selected.Reference);
      const next={...strip(row),Status:'Booked',AppointmentId,BookedAt:clock(),...stamp()};
      return {WaitlistId:row.WaitlistId,writes:[write('AppointmentWaitlist',row.WaitlistId,next,row),
        write('AppointmentWaitlistGuards',guardId,{...strip(guard),WaitlistId:'',...stamp()},guard),event(key,next,'Booked')]};
    },
    methods:{
      async appointmentWaitlist(body){
        requireCapability('appointments.read');const BranchId=await branch(body),Status=body.Status||'Waiting';
        if(!['Waiting','Booked','Cancelled'].includes(Status))fail('Choose Waiting, Booked or Cancelled.');
        const fieldName=Status==='Waiting'?'CreatedAt':'UpdatedAt';
        const filters=[eq('BranchId',BranchId),eq('Status',Status),...(Status==='Waiting'?[]:dateFilters(body.DateRange,fieldName))];
        const r=await scopedPage('AppointmentWaitlist',filters,fieldName,body);
        await auditRead(body,'View appointment waitlist',BranchId,{}, {Status,ResultCount:r.rows.length});
        return {ok:true,entries:r.rows.map(view),next:r.next};
      },
      async appointmentWaitlistDetails(body){
        requireCapability('appointments.read');const c=await current(body);
        await auditRead(body,'View waiting request',c.BranchId,c.person,{WaitlistId:c.row.WaitlistId});
        return {ok:true,entry:view(c.row),patient:patientSummary(c.person)};
      },
      async saveAppointmentWaitlist(body){
        requireCapability('appointments.write');const BranchId=await branch(body);confirm(body);
        return operation(body,'saveAppointmentWaitlist',async key=>{
          const Reference=appointmentReference(body.Waitlist?.Reference),Department=field(body.Waitlist,'Department',120,true),fields={Reference,Department,...preferences(body.Waitlist)};
          const WaitlistId=await keyFor('appointment-waitlist',BranchId,Reference),old=await read('AppointmentWaitlist',WaitlistId);
          if(body.WaitlistId&&body.WaitlistId!==WaitlistId)fail('The permanent waitlist reference cannot be changed.');
          if(old&&(old.PatientId!==body.PatientId||old.Department!==Department))fail('This reference already belongs to a saved patient and department.',409);
          if(!old&&body.WaitlistId)fail('This waiting request no longer matches the reference.',409);
          const person=await patient(body.PatientId,BranchId);if(person.Status!=='Active')fail('This patient registration is not active.',409);
          if(old?.Status!=='Waiting'&&old)fail('This request is already booked or cancelled. Its history is retained.',409);
          if(old&&JSON.stringify(stable(Object.fromEntries(Object.keys(fields).map(k=>[k,old[k]||'']))))===JSON.stringify(stable(fields)))return {writes:[],result:{WaitlistId,PatientId:person.PatientId,Unchanged:true}};
          const Reason=field(body,'Reason',1000);
          if(old){revision(old,body.Revision);if(Reason.length<5)fail('Record the reason for changing the waiting request.');}
          const ClinicianName=fields.Clinician?await clinician(fields.Clinician,BranchId):'';
          const next={...strip(old),...fields,WaitlistId,BranchId,PatientId:person.PatientId,PatientName:patientName(person),HospitalNumber:person.HospitalNumber,
            ClinicianName,Status:'Waiting',CreatedAt:old?.CreatedAt||clock(),...stamp()};
          const guardId=old?null:await guardKey(next),guard=old?null:await read('AppointmentWaitlistGuards',guardId);
          if(guard?.WaitlistId&&guard.WaitlistId!==WaitlistId)fail('This patient already has a waiting request for this department. Open that request instead.',409);
          return {writes:[write('AppointmentWaitlist',WaitlistId,next,old),...(old?[]:[write('AppointmentWaitlistGuards',guardId,{BranchId,PatientId:person.PatientId,Department,WaitlistId,...stamp()},guard)]),
            event(key,next,old?'Preferences changed':'Added',Reason),auditWrite(key,old?'Change appointment preferences':'Add appointment waitlist',BranchId,person,{WaitlistId,Reason})],result:{WaitlistId,PatientId:person.PatientId}};
        });
      },
      async cancelAppointmentWaitlist(body){
        requireCapability('appointments.write');await branch(body);confirm(body);
        const Reason=field(body,'Reason',1000,true);if(Reason.length<5)fail('Record the reason for cancelling the waiting request.');
        return operation(body,'cancelAppointmentWaitlist',async key=>{
          const c=await current(body),{row}=c;
          if(row.Status==='Cancelled'&&row.ClosureReason===Reason)return {writes:[],result:{WaitlistId:row.WaitlistId,PatientId:row.PatientId,Unchanged:true}};
          revision(row,body.Revision);if(row.Status!=='Waiting')fail('Only a waiting request can be cancelled here. Use the appointment for an existing booking.',409);
          const {key:guardId,guard}=await waitingGuard(row),next={...strip(row),Status:'Cancelled',ClosureReason:Reason,...stamp()};
          return {writes:[write('AppointmentWaitlist',row.WaitlistId,next,row),write('AppointmentWaitlistGuards',guardId,{...strip(guard),WaitlistId:'',...stamp()},guard),event(key,next,'Cancelled',Reason),
            auditWrite(key,'Cancel appointment waitlist',c.BranchId,c.person,{WaitlistId:row.WaitlistId,Reason})],result:{WaitlistId:row.WaitlistId,PatientId:row.PatientId}};
        });
      },
      async appointmentWaitlistHistory(body){
        requireCapability('appointments.read');const dates=dateFilters(body.DateRange),c=await current(body);
        const r=await scopedPage('AppointmentWaitlistEvents',[eq('BranchId',c.BranchId),eq('WaitlistId',c.row.WaitlistId),...dates],'CreatedAt',body);
        await auditRead(body,'View waiting request history',c.BranchId,c.person,{WaitlistId:c.row.WaitlistId,ResultCount:r.rows.length});
        return {ok:true,entries:r.rows.map(view),next:r.next};
      }
    }
  };
}
