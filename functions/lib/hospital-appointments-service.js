import {clean,fail,id,digest,stable,patientSummary,patientName} from './hospital-model.js';
import {field,dateFilters,watDay} from './hospital-orders-model.js';
import {assignedStaffBranches} from './staff-branch-access.js';
import {availabilityFields,appointmentTimes,appointmentReference,withinAvailability} from './hospital-appointments-model.js';

export function createHospitalAppointmentsService(ctx){
  const {env,user,db,collection,requireCapability,branch,patient,clock,actor,condition,strip,eq,auditWrite,auditRead,operation,page}=ctx;
  const keyFor=(...parts)=>digest(JSON.stringify(parts));
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const view=row=>({...strip(row),Revision:row.__updateTime});
  const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
  const stamp=()=>({UpdatedAt:clock(),UpdatedBy:actor,UpdatedByName:clean(user.displayName)||actor});
  const revision=(row,value)=>{if(!value||row.__updateTime!==value)fail('This appointment or schedule changed. Refresh before saving.',409);};
  const confirm=body=>{if(body.ConfirmPatient!==true)fail('Confirm the patient and hospital number.');};
  const auditDates=body=>({FromDate:clean(body.DateRange?.fromDate),ToDate:clean(body.DateRange?.toDate)});
  function publicSchedule(row){const {Bookings,...result}=view(row);return {...result,BookedCount:(Bookings||[]).length};}
  async function clinician(username,BranchId){
    const matches=await db.queryCollection(env,'staffUsers',{filters:[eq('UsernameKey',username)],limit:2}),u=matches[0],allowed=u?assignedStaffBranches(u):[];
    if(matches.length!==1||clean(u.Username).toLowerCase()!==username||!['Doctor','Medical Director'].includes(u.Role)
      ||!['true','yes','1'].includes(String(u.Active??true).toLowerCase())||clean(u.OrganisationEdition||u.OrganizationEdition).toLowerCase()!=='hospital'
      ||allowed!==null&&!allowed.includes(BranchId))fail('Choose an active Doctor or Medical Director assigned to this branch.');
    return clean(u.DisplayName)||username;
  }
  async function scheduleFor(ScheduleId,BranchId){const row=await read('AppointmentSchedules',ScheduleId);if(!row||row.BranchId!==BranchId)fail('Choose a clinic schedule in this branch.',404);return row;}
  async function current(body){
    const BranchId=await branch(body),row=await read('Appointments',body.AppointmentId);
    if(!row||row.BranchId!==BranchId||row.PatientId!==body.PatientId)fail('Choose this patient’s appointment in the selected branch.',404);
    return {BranchId,row,person:await patient(row.PatientId,BranchId)};
  }
  const event=(key,row,Type,Reason='')=>write('AppointmentEvents',key,{EventId:key,AppointmentId:row.AppointmentId,PatientId:row.PatientId,
    BranchId:row.BranchId,Type,Reason,Snapshot:strip(row),CreatedAt:clock(),...stamp()},null);
  // Reuse theatre's resource/day guards so a doctor or patient cannot be booked
  // in clinic and theatre concurrently. Return no other patient's identifiers.
  async function reservations(old,next){
    const defs=new Map();
    for(const row of [old,next].filter(Boolean))for(const resource of [`patient:${row.PatientId}`,`clinician:${row.Clinician}`]){
      const day=watDay(row.StartAt);defs.set(JSON.stringify([resource,day]),{resource,day});
    }
    return Promise.all([...defs.values()].map(async ({resource,day})=>{
      const key=await keyFor('booking',resource,day),saved=await read('TheatreReservations',key);
      const Entries=(saved?.Entries||[]).filter(e=>e.CaseId!==`appointment:${old?.AppointmentId}`);
      if(next&&watDay(next.StartAt)===day&&[`patient:${next.PatientId}`,`clinician:${next.Clinician}`].includes(resource)){
        if(Entries.some(e=>e.StartAt<next.EndAt&&e.EndAt>next.StartAt))fail('The patient or clinician already has an overlapping appointment or procedure. Choose another time.',409);
        if(Entries.length>=96)fail('This resource has reached its daily booking limit. Choose another day.',409);
        Entries.push({CaseId:`appointment:${next.AppointmentId}`,StartAt:next.StartAt,EndAt:next.EndAt});
      }
      return write('TheatreReservations',key,{Resource:resource,Day:day,Entries},saved);
    }));
  }
  async function scheduleWrites(old,next,newSchedule){
    const schedules=new Map();if(newSchedule)schedules.set(newSchedule.ScheduleId,newSchedule);
    if(old&&!schedules.has(old.ScheduleId))schedules.set(old.ScheduleId,await scheduleFor(old.ScheduleId,old.BranchId));
    return [...schedules.values()].map(saved=>{
      const Bookings=(saved.Bookings||[]).filter(e=>e.AppointmentId!==old?.AppointmentId);
      if(next&&next.ScheduleId===saved.ScheduleId){
        if(!withinAvailability(saved,next))fail('Choose a time inside this doctor’s active clinic availability.',409);
        if(Bookings.length>=96)fail('This clinic has reached its daily appointment limit.',409);
        Bookings.push({AppointmentId:next.AppointmentId,StartAt:next.StartAt,EndAt:next.EndAt});
      }
      return write('AppointmentSchedules',saved.ScheduleId,{...strip(saved),Bookings},saved);
    });
  }
  const identity=row=>({AppointmentId:row.AppointmentId,PatientId:row.PatientId,...(row.VisitId?{VisitId:row.VisitId}:{})});
  return {
    async appointmentSchedules(body){
      requireCapability('appointments.read');const BranchId=await branch(body),filters=[eq('BranchId',BranchId),...dateFilters(body.DateRange,'DayStartAt')];
      const r=await page('AppointmentSchedules',filters,'DayStartAt',body);
      return {ok:true,schedules:r.rows.map(publicSchedule),next:r.next};
    },
    async saveAppointmentSchedule(body){
      requireCapability('appointments.configure');const BranchId=await branch(body);
      if(user.role==='Doctor'&&clean(body.Schedule?.Clinician).toLowerCase()!==actor.toLowerCase())fail('Doctors may change only their own clinic availability.',403);
      return operation(body,'saveAppointmentSchedule',async key=>{
        const fields=availabilityFields(body.Schedule,clock());
        const ScheduleId=await keyFor('clinic',BranchId,fields.Clinician,fields.Day),old=await read('AppointmentSchedules',ScheduleId);
        if(body.ScheduleId&&body.ScheduleId!==ScheduleId)fail('The clinician and date identify this schedule. Create a separate schedule for another day.');
        if(old)revision(old,body.Revision);
        if(old&&same(Object.fromEntries(Object.keys(fields).map(k=>[k,old[k]])),fields))return {writes:[],result:{ScheduleId,Unchanged:true}};
        if((old?.Bookings||[]).some(row=>!withinAvailability(fields,row)))fail('Reschedule or cancel the affected appointments before reducing this clinic’s availability.',409);
        const ClinicianName=await clinician(fields.Clinician,BranchId);
        const row={...strip(old),...fields,ScheduleId,BranchId,ClinicianName,Bookings:old?.Bookings||[],CreatedAt:old?.CreatedAt||clock(),...stamp()};
        return {writes:[write('AppointmentSchedules',ScheduleId,row,old),write('AppointmentScheduleEvents',key,{...publicSchedule(row),Revision:'',EventId:key,CreatedAt:clock()},null),
          auditWrite(key,'Save clinic availability',BranchId,{}, {ScheduleId,ClinicianName,Day:fields.Day})],result:{ScheduleId}};
      });
    },
    async saveAppointment(body){
      requireCapability('appointments.write');const BranchId=await branch(body);confirm(body);
      const Reference=appointmentReference(body.Booking?.Reference),Reason=field(body,'Reason',1000);
      return operation(body,'saveAppointment',async key=>{
        const times=appointmentTimes(body.Booking,clock());
        const AppointmentId=await keyFor('appointment',BranchId,Reference),old=await read('Appointments',AppointmentId);
        if(body.AppointmentId&&body.AppointmentId!==AppointmentId)fail('The permanent booking reference cannot be changed.');
        if(old&&old.PatientId!==body.PatientId)fail('This booking reference is already used. Choose another reference.',409);
        const [person,schedule]=await Promise.all([patient(body.PatientId,BranchId),scheduleFor(body.ScheduleId,BranchId)]);
        if(person.Status!=='Active')fail('This patient registration is not active.',409);
        const FollowUpVisitId=clean(body.FollowUpVisitId);
        const selected={...times,Reference,PatientId:person.PatientId,ScheduleId:schedule.ScheduleId,FollowUpVisitId};
        if(old&&old.Status==='Scheduled'&&same(Object.fromEntries(Object.keys(selected).map(k=>[k,old[k]||''])),selected))return {writes:[],result:{...identity(old),Unchanged:true}};
        if(old){revision(old,body.Revision);if(old.Status!=='Scheduled')fail('Only scheduled appointments can be rescheduled.',409);
          if(old.FollowUpVisitId!==FollowUpVisitId)fail('The original follow-up visit link cannot be changed.');
          if(Reason.length<5)fail('Record the reason for rescheduling.');}
        else if(body.AppointmentId)fail('This appointment no longer matches the saved reference.',409);
        if(!old&&FollowUpVisitId){const visit=await read('Visits',FollowUpVisitId);if(!visit||visit.PatientId!==person.PatientId||visit.BranchId!==BranchId)fail('Choose a previous visit for this patient and branch.',404);}
        const ClinicianName=await clinician(schedule.Clinician,BranchId);
        const row={...strip(old),...selected,AppointmentId,BranchId,PatientName:patientName(person),HospitalNumber:person.HospitalNumber,
          Clinician:schedule.Clinician,ClinicianName,Department:schedule.Department,Status:'Scheduled',CreatedAt:old?.CreatedAt||clock(),...stamp()};
        const [locks,schedules]=await Promise.all([reservations(old,row),scheduleWrites(old,row,schedule)]);
        return {writes:[...locks,...schedules,write('Appointments',AppointmentId,row,old),event(key,row,old?'Rescheduled':'Booked',Reason),
          auditWrite(key,old?'Reschedule appointment':'Book appointment',BranchId,person,{AppointmentId})],result:identity(row)};
      });
    },
    async appointmentRegister(body){
      requireCapability('appointments.read');const BranchId=await branch(body),r=await page('Appointments',[eq('BranchId',BranchId),...dateFilters(body.DateRange,'StartAt')],'StartAt',body);
      await auditRead(body,'View appointment register',BranchId,{}, {ResultCount:r.rows.length,...auditDates(body)});
      return {ok:true,appointments:r.rows.map(view),next:r.next};
    },
    async appointmentDetails(body){
      requireCapability('appointments.read');const c=await current(body),lock=c.row.VisitId?null:await read('OpenVisits',await keyFor(c.BranchId,c.row.PatientId));
      const visitId=c.row.VisitId||lock?.VisitId,visit=visitId?await read('Visits',visitId):null;
      if(visit&&(visit.PatientId!==c.row.PatientId||visit.BranchId!==c.BranchId))fail('Review this patient’s visit reference.',409);
      await auditRead(body,'View appointment',c.BranchId,c.person,{AppointmentId:c.row.AppointmentId});
      return {ok:true,appointment:view(c.row),patient:patientSummary(c.person),visit:visit?{VisitId:visit.VisitId,PatientId:visit.PatientId,BranchId:visit.BranchId,
        Status:visit.Status,Department:visit.Department,Revision:visit.__updateTime}:null};
    },
    async closeAppointment(body){
      requireCapability('appointments.write');await branch(body);confirm(body);
      if(!['Cancelled','Not attended'].includes(body.Status))fail('Choose Cancelled or Not attended.');
      const Reason=field(body,'Reason',1000,true);if(Reason.length<5)fail('Record a reason for closing this booking.');
      return operation(body,'closeAppointment',async key=>{
        const c=await current(body),{row}=c;
        if(row.Status===body.Status&&row.ClosureReason===Reason)return {writes:[],result:{...identity(row),Unchanged:true}};
        revision(row,body.Revision);if(row.Status!=='Scheduled')fail('This appointment is no longer scheduled.',409);
        if(body.Status==='Not attended'&&row.EndAt>clock())fail('Wait until the appointment has ended before recording non-attendance.');
        const next={...strip(row),Status:body.Status,ClosureReason:Reason,...stamp()};
        const [locks,schedules]=await Promise.all([reservations(row,null),scheduleWrites(row,null)]);
        return {writes:[...locks,...schedules,write('Appointments',row.AppointmentId,next,row),event(key,next,body.Status,Reason),
          auditWrite(key,body.Status==='Cancelled'?'Cancel appointment':'Record appointment non-attendance',c.BranchId,c.person,{AppointmentId:row.AppointmentId})],result:identity(next)};
      });
    },
    async checkInAppointment(body){
      requireCapability('appointments.write');requireCapability('visits.write');await branch(body);confirm(body);
      return operation(body,'checkInAppointment',async key=>{
        const c=await current(body),{row,person,BranchId}=c;
        if(row.Status==='Arrived')return {writes:[],result:{...identity(row),Unchanged:true}};
        revision(row,body.Revision);if(row.Status!=='Scheduled'||person.Status!=='Active')fail('Choose an active patient’s scheduled appointment.',409);
        if(watDay(clock())!==watDay(row.StartAt))fail('Check in on the scheduled WAT date, or reschedule the appointment first.');
        const lockId=await keyFor(BranchId,row.PatientId),lock=await read('OpenVisits',lockId);
        let visit=null;
        if(lock?.VisitId){
          if(body.UseExistingVisit!==true||body.VisitId!==lock.VisitId)fail('This patient already has an open visit. Refresh and explicitly link it to this appointment.',409);
          visit=await read('Visits',lock.VisitId);
          if(!visit||visit.PatientId!==row.PatientId||visit.BranchId!==BranchId||!['Waiting','In progress'].includes(visit.Status))fail('Reload the patient’s open visit.',409);
          revision(visit,body.VisitRevision);
          if(visit.AppointmentId&&visit.AppointmentId!==row.AppointmentId)fail('The open visit already belongs to another appointment.',409);
        }else if(body.UseExistingVisit===true)fail('The previous open visit has changed. Refresh this appointment.',409);
        const VisitId=visit?.VisitId||await keyFor('appointment-visit',row.AppointmentId);
        const next={...strip(row),Status:'Arrived',VisitId,ArrivedAt:clock(),...stamp()};
        const visitRow={...(visit?strip(visit):{VisitId,PatientId:row.PatientId,PatientName:patientName(person),HospitalNumber:person.HospitalNumber,
          BranchId,Department:row.Department,Status:'Waiting',CreatedAt:clock(),CreatedBy:actor}),AppointmentId:row.AppointmentId,AppointmentClinician:row.Clinician,...stamp()};
        return {writes:[write('Appointments',row.AppointmentId,next,row),write('Visits',VisitId,visitRow,visit),
          write('OpenVisits',lockId,{PatientId:row.PatientId,VisitId},lock),event(key,next,'Checked in'),
          auditWrite(key,'Check in appointment',BranchId,person,{AppointmentId:row.AppointmentId,VisitId})],result:identity(next)};
      });
    },
    async appointmentHistory(body){
      requireCapability('appointments.read');const filters=dateFilters(body.DateRange),c=await current(body);
      const r=await page('AppointmentEvents',[eq('BranchId',c.BranchId),eq('AppointmentId',c.row.AppointmentId),...filters],'CreatedAt',body);
      await auditRead(body,'View appointment history',c.BranchId,c.person,{AppointmentId:c.row.AppointmentId,ResultCount:r.rows.length,...auditDates(body)});
      return {ok:true,entries:r.rows.map(view),next:r.next};
    }
  };
}
