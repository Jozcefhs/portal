import {getDocument,queryCollection,batchCommitLiteralDocuments} from './firestore.js';
import {getSchoolStructure} from './school-scope.js';
import {configuredStaffBranches} from './staff-branch-context.js';
import {staffAccessFor} from './staff-auth.js';
import {requiredDeploymentIdentity} from './deployment-identity.js';
import {hospitalCollectionPath} from './hospital-storage.js';
import {createHospitalAppointmentsService} from './hospital-appointments-service.js';
import {clean,fail,id,digest,stable,patientName} from './hospital-model.js';
import {dateOnly,watDay} from './hospital-orders-model.js';
import {bookingToken,patientBookingView,selfBookingSlots} from './hospital-self-booking-model.js';

const strip=row=>Object.fromEntries(Object.entries(row||{}).filter(([key])=>!key.startsWith('__')));
const condition=row=>row?{updateTime:row.__updateTime||fail('Refresh before continuing.',409)}:{exists:false};
const eq=(field,value)=>({field,op:'==',value});
const unavailable=()=>fail('This booking link is invalid or no longer available. Ask Reception for a new link.',401);

// Only these narrowly scoped actions are public. No staff session, arbitrary patient
// lookup, clinical fields, charges or receipt creation are exposed by the link.
export async function hospitalPatientBookingAction(env,token,body,overrides={}){
  const identity=requiredDeploymentIdentity(env);
  if(identity.edition!=='hospital')fail('Patient booking is available only in the Hospital edition.',403);
  if(!['context','clinics','slots','book','cancel'].includes(body.action))fail('Choose a valid patient booking action.');
  if(['PatientId','BranchId','AppointmentId','Reference','EndAt','FollowUpVisitId','WaitlistId'].some(k=>k in body))fail('Use the patient and branch belonging to this personal link.',403);
  const db={getDocument,queryCollection,batchCommitLiteralDocuments,getSchoolStructure,...overrides};
  const collection=name=>hospitalCollectionPath(env,name),keyFor=(...parts)=>digest(JSON.stringify(parts));
  const clock=()=>(overrides.now?overrides.now():new Date()).toISOString();
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const LinkId=await digest(bookingToken(token)),link=await read('PatientBookingLinks',LinkId);
  if(!link||link.Status!=='Active'||link.ExpiresAt<=clock())unavailable();
  const [access,person]=await Promise.all([read('PatientBookingAccess',link.AccessId),read('Patients',link.PatientId)]);
  if(access?.LinkId!==LinkId||access.PatientId!==link.PatientId||access.BranchId!==link.BranchId||!person||person.Status!=='Active'||!person.AccessBranchIds?.includes(link.BranchId))unavailable();
  const [entitlement,structure]=await Promise.all([
    (overrides.staffAccessFor||staffAccessFor)(env,{username:'system:hospital-patient-booking',role:'Hospital Administrator',branchAccess:'all'}),db.getSchoolStructure(env)]);
  if(entitlement.edition!=='hospital'||entitlement.subscriptionActive===false||!entitlement.allowedSections?.includes('hospitalReception'))fail('Online appointments are temporarily unavailable. Please contact Reception.',403);
  const selectedBranch=configuredStaffBranches(structure).find(b=>clean(b.id).toLowerCase()===link.BranchId);
  if(!selectedBranch)unavailable();
  const actor=`patient:${person.PatientId}`,user={username:actor,displayName:patientName(person),role:'Patient self-service'};
  let saved;
  async function appointment(){
    if(saved!==undefined)return saved;
    saved=link.AppointmentId?await read('Appointments',link.AppointmentId):null;
    if(saved&&(saved.PatientId!==person.PatientId||saved.BranchId!==link.BranchId))unavailable();
    if(link.AppointmentId&&!saved)fail('Reception needs to review this booking reference.',409);
    return saved;
  }
  const publicClinic=row=>({ScheduleId:row.ScheduleId,Day:row.Day,ClinicianName:row.ClinicianName,Department:row.Department,SlotMinutes:row.SlotMinutes||30});
  function day(value){const d=dateOnly(value);if(d<watDay(clock())||Date.parse(d+'T00:00:00Z')>Date.parse(clock())+90*86400000)fail('Choose today or a clinic date within the next 90 days.');return d;}
  async function schedule(){
    const s=await read('AppointmentSchedules',body.ScheduleId);
    if(!s||s.BranchId!==link.BranchId||s.Active!==true||s.SelfBookingEnabled!==true)fail('This clinic is not available for patient booking. Refresh available clinics.',409);
    day(s.Day);return s;
  }
  if(body.action==='context')return {ok:true,patient:{DisplayName:patientName(person),HospitalNumber:person.HospitalNumber},branch:{Name:selectedBranch.name||selectedBranch.id},
    ExpiresAt:link.ExpiresAt,Today:watDay(clock()),ReadOnly:entitlement.subscriptionReadOnly===true,appointment:patientBookingView(await appointment())};
  if(body.action==='clinics'){
    const Day=day(body.Day),filters=[eq('BranchId',link.BranchId),eq('Day',Day),eq('Active',true),eq('SelfBookingEnabled',true)];
    const scope=await keyFor(LinkId,Day);let cursor={};
    if(body.Cursor){if(body.Cursor.scope!==scope)fail('Load the first page for this clinic date.');cursor.startAfterName=`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection('AppointmentSchedules')}/${id(body.Cursor.id)}`;}
    const rows=await db.queryCollection(env,collection('AppointmentSchedules'),{filters,orderBy:[{field:'__name__'}],limit:31,...cursor}),shown=rows.slice(0,30);
    return {ok:true,clinics:shown.map(publicClinic),next:rows.length>30?{id:shown.at(-1).__id,scope}:null};
  }
  if(body.action==='slots'){
    const s=await schedule(),old=await appointment(),blocked=[];
    for(const resource of [`patient:${person.PatientId}`,`clinician:${s.Clinician}`]){
      const lock=await read('TheatreReservations',await keyFor('booking',resource,s.Day));
      const entries=(lock?.Entries||[]).filter(e=>e.CaseId!==`appointment:${old?.AppointmentId}`);
      if(entries.length>=96)return {ok:true,clinic:publicClinic(s),slots:[]};blocked.push(...entries);
    }
    return {ok:true,clinic:publicClinic(s),slots:selfBookingSlots(s,clock(),blocked,old?.AppointmentId)};
  }
  if(entitlement.subscriptionReadOnly===true)fail('Online changes are temporarily unavailable. Please contact Reception.',403);
  if(body.ConfirmBooking!==true)fail('Confirm the appointment action before continuing.');
  const requestId=id(body.RequestId),opId=await keyFor(LinkId,body.action,requestId),fingerprint=await digest(JSON.stringify(stable(body)));
  async function receipt(){const row=await read('Operations',opId);if(!row)return null;if(row.Fingerprint!==fingerprint)fail('This request reference was used for different details.',409);return {ok:true,...row.Result,replayed:true};}
  const replay=await receipt();if(replay)return replay;
  const old=await appointment();
  if(old&&(old.Status!=='Scheduled'||old.StartAt<=clock()))fail('This appointment can no longer be changed online. Contact Reception.',409);
  if(old&&old.__updateTime!==body.Revision)fail('This booking changed. Refresh your appointment before continuing.',409);
  let s,booking;
  if(body.action==='book'){
    s=await schedule();const slot=selfBookingSlots(s,clock(),[],old?.AppointmentId).find(v=>v.StartAt===body.StartAt);
    if(!slot)fail('That slot is no longer available. Refresh times and choose another.',409);
    booking={Reference:link.Reference,...slot};
  }else if(!old)fail('There is no appointment to cancel.',409);
  const cacheDb={...db,getDocument:async(e,path,key)=>path===collection('AppointmentSchedules')&&key===s?.ScheduleId?s:db.getDocument(e,path,key)};
  const ctx={env,user,db:cacheDb,collection,clock,actor,condition,strip,eq,
    requireCapability:cap=>{if(cap!=='appointments.write')fail('This action is not available to patients.',403);},
    branch:async b=>{if(b.BranchId!==link.BranchId)unavailable();return link.BranchId;},
    patient:async(p,b)=>{if(p!==person.PatientId||b!==link.BranchId)unavailable();return person;},
    auditWrite:(key,Action,BranchId)=>write('Audit',key,{Action,Module:'Hospital',BranchId,CreatedAt:clock(),Timestamp:clock(),Outcome:'Success',
      Username:actor,ActorName:patientName(person),ActorRole:'Patient self-service',SubjectId:person.PatientId,SubjectName:patientName(person),Source:'Patient booking',SourcePlatform:'Web'},null),
    operation:async(_body,action,work)=>{
      try{
        const {writes,result}=await work(opId);
        if(!writes.length&&result?.Unchanged)return {ok:true,...result};
        const next={...strip(link),AppointmentId:result.AppointmentId,UpdatedAt:clock(),UpdatedBy:actor};
        writes.push(write('PatientBookingLinks',LinkId,next,link),write('Patients',person.PatientId,strip(person),person),
          write('Operations',opId,{Fingerprint:fingerprint,Result:{Saved:true},CreatedAt:clock(),Actor:actor,Action:action},null));
        await db.batchCommitLiteralDocuments(env,writes);return {ok:true,Saved:true};
      }catch(error){if(Number(error.status)===409){const completed=await receipt();if(completed)return completed;fail('This appointment or slot changed. Refresh before trying again.',409);}throw error;}
    }};
  const service=createHospitalAppointmentsService(ctx),args={BranchId:link.BranchId,PatientId:person.PatientId,RequestId:requestId,ConfirmPatient:true,
    ...(old?{AppointmentId:old.AppointmentId,Revision:body.Revision}:{}),Reason:clean(body.Reason).slice(0,1000)};
  if(body.action==='cancel')return service.closeAppointment({...args,Status:'Cancelled'});
  return service.saveAppointment({...args,ScheduleId:s.ScheduleId,Booking:booking,FollowUpVisitId:old?.FollowUpVisitId||''});
}
