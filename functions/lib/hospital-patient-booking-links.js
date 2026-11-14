import {clean,fail,id,digest} from './hospital-model.js';
import {bookingToken} from './hospital-self-booking-model.js';

export function createHospitalPatientBookingLinks(ctx){
  const {env,user,db,collection,requireCapability,branch,patient,clock,actor,condition,strip,operation,auditWrite}=ctx;
  const keyFor=(...parts)=>digest(JSON.stringify(parts));
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const stamp=()=>({UpdatedAt:clock(),UpdatedBy:actor,UpdatedByName:clean(user.displayName)||actor});
  async function current(body){
    const BranchId=await branch(body),person=await patient(body.PatientId,BranchId),AccessId=await keyFor('patient-booking',BranchId,person.PatientId);
    const access=await read('PatientBookingAccess',AccessId),link=access?.LinkId?await read('PatientBookingLinks',access.LinkId):null;
    return {BranchId,person,AccessId,access,link};
  }
  const event=(key,link,Type)=>write('PatientBookingLinkEvents',key,{EventId:key,Type,BranchId:link.BranchId,PatientId:link.PatientId,
    LinkId:link.LinkId,ExpiresAt:link.ExpiresAt,AppointmentId:link.AppointmentId||'',CreatedAt:clock(),...stamp()},null);
  return {
    async patientBookingLinkStatus(body){
      requireCapability('appointments.write');const {link}=await current(body);
      return {ok:true,link:link?{Status:link.Status,ExpiresAt:link.ExpiresAt,HasBooking:!!link.AppointmentId}:null};
    },
    async issuePatientBookingLink(body){
      requireCapability('appointments.write');await branch(body);
      if(body.ConfirmPatient!==true)fail('Confirm you have verified the patient or authorised guardian before sharing a personal booking link.');
      const token=bookingToken(body.AccessToken),LinkId=await digest(token);
      return operation(body,'issuePatientBookingLink',async key=>{
        const c=await current(body),{BranchId,person,AccessId,access,link}=c;
        if(person.Status!=='Active')fail('This patient registration is not active.',409);
        if(link?.LinkId===LinkId&&link.Status==='Active'&&link.ExpiresAt>clock())return {writes:[],result:{LinkId,ExpiresAt:link.ExpiresAt,Unchanged:true}};
        const existing=await read('PatientBookingLinks',LinkId);if(existing)fail('Generate a new personal link; this token was already issued.',409);
        const prior=link?.AppointmentId?await read('Appointments',link.AppointmentId):null;
        if(prior&&(prior.PatientId!==person.PatientId||prior.BranchId!==BranchId))fail('Review the previous booking identity with an administrator.',409);
        const keep=prior&&['Scheduled','Arrived'].includes(prior.Status);
        const row={LinkId,AccessId,BranchId,PatientId:person.PatientId,Status:'Active',ExpiresAt:new Date(Date.parse(clock())+7*86400000).toISOString(),
          AppointmentId:keep?prior.AppointmentId:'',Reference:keep?prior.Reference:`SELF-${LinkId.slice(0,24).toUpperCase()}`,CreatedAt:clock(),...stamp()};
        const writes=[write('PatientBookingLinks',LinkId,row,null),write('PatientBookingAccess',AccessId,{AccessId,BranchId,PatientId:person.PatientId,LinkId,...stamp()},access),
          // Guard registration changes without altering any patient fields.
          write('Patients',person.PatientId,strip(person),person),event(key,row,'Issued'),auditWrite(key,'Issue patient booking link',BranchId,person,{LinkId,ExpiresAt:row.ExpiresAt})];
        if(link?.Status==='Active')writes.push(write('PatientBookingLinks',link.LinkId,{...strip(link),Status:'Replaced',...stamp()},link));
        return {writes,result:{LinkId,ExpiresAt:row.ExpiresAt}};
      });
    },
    async revokePatientBookingLink(body){
      requireCapability('appointments.write');await branch(body);
      return operation(body,'revokePatientBookingLink',async key=>{
        const {BranchId,person,link}=await current(body);
        if(!link||link.Status!=='Active')return {writes:[],result:{Unchanged:true}};
        const next={...strip(link),Status:'Revoked',...stamp()};
        return {writes:[write('PatientBookingLinks',link.LinkId,next,link),event(key,next,'Revoked'),auditWrite(key,'Revoke patient booking link',BranchId,person,{LinkId:link.LinkId})],result:{Revoked:true}};
      });
    }
  };
}
