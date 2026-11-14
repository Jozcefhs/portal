import {clean,fail,id} from './hospital-model.js';
import {historyDateRange} from './history-date-range.js';

export const queueSnapshot=row=>Object.fromEntries(['VisitId','PatientId','BranchId','Status','QueueCalledAt','QueueCalledBy','QueueStartedAt','QueueFinishedAt','ClosedAt'].map(key=>[key,row[key]||'']));
export function clinicQueueRow(row){
  // Reception needs identity and timing, never consultation notes or diagnoses.
  return {...Object.fromEntries(['VisitId','PatientId','PatientName','HospitalNumber','BranchId','Department','Status','CreatedAt','AppointmentId','AppointmentClinician','AppointmentClinicianName','AppointmentStartAt','AppointmentEndAt','QueueCalledAt','QueueCalledBy','QueueStartedAt','QueueFinishedAt','ClosedAt'].map(key=>[key,row[key]||''])),
    QueueLabel:row.Status==='Waiting'?(row.QueueCalledAt?'Called':'Waiting'):row.Status==='In progress'?(row.QueueFinishedAt?'Awaiting checkout':'In progress'):row.Status,
    Revision:row.__updateTime};
}
export function createHospitalClinicQueues(ctx){
  const {env,db,collection,capabilities,branch,clock,actor,condition,strip,eq,operation,auditWrite,page}=ctx;
  const allowed=()=>{if(!capabilities.includes('visits.read'))fail('Your role cannot view clinic queues.',403);};
  const writable=mode=>{
    allowed();
    if(!capabilities.includes('visits.write')&&!capabilities.includes(mode==='Start'?'consultations.write':'triage.write')&&!(mode!=='Start'&&capabilities.includes('consultations.write')))fail('Your role cannot perform this queue action.',403);
  };
  async function visit(body,BranchId){
    const row=await db.getDocument(env,collection('Visits'),id(body.VisitId));
    if(!row||row.BranchId!==BranchId)fail('This visit is not available in this branch.',404);
    if(row.PatientId!==body.PatientId)fail('The selected patient does not match this visit.',409);
    return row;
  }
  function dates(body){
    const range=historyDateRange(body.DateRange),start=new Date(`${range.fromDate}T00:00:00+01:00`),end=new Date(`${range.toDate}T00:00:00+01:00`);end.setTime(end.getTime()+86400000);
    if(end-start>31*86400000)fail('Choose no more than 31 days of completed queue history.');
    return [{field:'CreatedAt',op:'>=',value:start.toISOString()},{field:'CreatedAt',op:'<',value:end.toISOString()}];
  }
  return {
    async clinicQueue(body){
      allowed();const BranchId=await branch(body),View=clean(body.View)||'Active',Department=clean(body.Department);
      if(!['Active','Waiting','In progress','Completed','Cancelled'].includes(View))fail('Choose a queue status.');
      if(Department.length>120)fail('The department is too long.');
      const filters=[eq('BranchId',BranchId),View==='Active'?{field:'Status',op:'in',value:['Waiting','In progress']}:eq('Status',View)];
      if(Department)filters.push(eq('Department',Department));
      if(['Completed','Cancelled'].includes(View))filters.push(...dates(body));
      const result=await page('Visits',filters,'CreatedAt',body);
      return {ok:true,visits:result.rows.map(clinicQueueRow),next:result.next,ServerNow:clock()};
    },
    async clinicQueueAction(body){
      const Action=clean(body.Action);if(!['Call','Return','Start'].includes(Action))fail('Choose a queue action.');
      writable(Action);const BranchId=await branch(body),Reason=clean(body.Reason);
      if(Reason.length>500||Action==='Return'&&Reason.length<5)fail('Enter a reason (5 to 500 characters) for returning the patient to waiting.');
      if(body.ConfirmPatient!==true)fail('Confirm the patient and hospital number first.');
      return operation(body,'clinicQueueAction',async key=>{
        const old=await visit(body,BranchId);
        if(body.Revision!==old.__updateTime)fail('This visit changed. Refresh the queue before continuing.',409);
        if(Action==='Start'&&old.AppointmentClinician&&old.AppointmentClinician!==actor&&!capabilities.includes('visits.write'))fail('This appointment belongs to another clinician.',403);
        if(Action==='Start'&&old.Status==='In progress'||Action==='Call'&&old.Status==='Waiting'&&old.QueueCalledAt||Action==='Return'&&old.Status==='Waiting'&&!old.QueueCalledAt)return {writes:[],result:{VisitId:old.VisitId,Unchanged:true}};
        if(old.Status!=='Waiting')fail('Only a waiting patient can be called, returned or started. Completed records are retained.',409);
        const now=clock(),next={...strip(old),UpdatedAt:now,UpdatedBy:actor};
        if(Action==='Call')Object.assign(next,{QueueCalledAt:now,QueueCalledBy:actor});
        if(Action==='Return')Object.assign(next,{QueueCalledAt:'',QueueCalledBy:''});
        if(Action==='Start')Object.assign(next,{Status:'In progress',QueueStartedAt:old.QueueStartedAt||now});
        return {writes:[{collectionPath:collection('Visits'),documentId:old.VisitId,data:next,currentDocument:condition(old)},
          {collectionPath:collection('ClinicQueueEvents'),documentId:key,currentDocument:{exists:false},data:{EventId:key,VisitId:old.VisitId,PatientId:old.PatientId,BranchId,Action,Reason,CreatedAt:now,Actor:actor,Before:queueSnapshot(old),After:queueSnapshot(next)}},
          auditWrite(key,`Clinic queue: ${Action.toLowerCase()}`,BranchId,{}, {VisitId:old.VisitId,EntityId:old.VisitId,EntityType:'Clinic visit',SubjectName:old.PatientName,Subject:old.PatientName,Before:queueSnapshot(old),After:queueSnapshot(next),Reason})],result:{VisitId:old.VisitId}};
      });
    },
    async clinicQueueHistory(body){
      allowed();const BranchId=await branch(body),row=await visit(body,BranchId);
      const result=await page('ClinicQueueEvents',[eq('BranchId',BranchId),eq('VisitId',row.VisitId)],'CreatedAt',body);
      return {ok:true,entries:result.rows.map(r=>strip(r)),next:result.next};
    }
  };
}
