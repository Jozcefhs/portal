import {inpatientFixture,inpatientActors,period} from './hospital-inpatient-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
import {hospitalRoleModules} from '../../functions/lib/hospital-catalog.js';
import {env,request} from './hospital-fixture.mjs';
export {period};
export const theatreActors={...inpatientActors,director:{...inpatientActors.doctor,role:'Medical Director',username:'director',allowedSections:hospitalRoleModules('Medical Director')},other:{...inpatientActors.doctor,username:'other'}};
export const booking={Reference:'OP-001',Procedure:'Synthetic procedure',SiteSide:'Clinician recorded site',LeadClinician:'doctor',Team:'Recorded clinical team',StartAt:'2026-10-26T12:00:00Z',EndAt:'2026-10-26T14:00:00Z'};
export const preoperative={ConsentReference:'CONSENT-1',Preparation:'Recorded preparation',AnaesthesiaAssessment:'Recorded anaesthetic assessment'};
export const operative={PerformedProcedure:'Recorded procedure',Diagnosis:'Recorded diagnosis',Findings:'Recorded findings',Technique:'Recorded technique',AnaesthesiaRecord:'Recorded anaesthetic technique and monitoring',CountsAndSpecimens:'Recorded counts and specimens',ImplantsAndConsumables:'Recorded lot references; medicine administration retained separately',Complications:'Recorded outcome',RecoveryPlan:'Recorded recovery plan'};
export const recovery={Observations:'Recorded recovery observations',Disposition:'Return to ward',ReceivingOfficer:'Receiving nurse',Handover:'Recorded verbal handover'};
export async function theatreFixture(){
  const f=await inpatientFixture();for(const [name,user] of Object.entries(theatreActors))f[name]=createHospitalService(env,user,f.db);
  for(const username of ['doctor','other'])f.store.set(`staffUsers/${username}`,{__id:username,__updateTime:'staff-1',Username:username,UsernameKey:username,Role:'Doctor',DisplayName:`Dr ${username}`,Active:true,OrganisationEdition:'hospital',BranchAccess:'selected',BranchIds:['main','north']});
  f.room=async(Code='TH-1')=>{const r=await f.admin.saveTheatreRoom(request({Room:{Code,Name:`Theatre ${Code}`,Active:true}}));let row=f.rows('Theatres').find(rm=>rm.TheatreId===r.TheatreId);await f.nurse.prepareTheatre(request({TheatreId:r.TheatreId,Revision:row.__updateTime,ConfirmReady:true}));return f.rows('Theatres').find(rm=>rm.TheatreId===r.TheatreId);};
  f.theatre=await f.room();
  f.bookBody=(changes={},scope=f.scope)=>request({...scope,TheatreId:f.theatre.TheatreId,VisitRevision:f.rows('Visits').find(v=>v.VisitId===scope.VisitId).__updateTime,Booking:{...booking,...changes},ConfirmPatient:true});
  f.caseBody=(row,extra={})=>{const c=f.rows('ProcedureCases').find(v=>v.CaseId===(row.CaseId||row)),visit=f.rows('Visits').find(v=>v.VisitId===c.VisitId),care=f.rows('CareSummaries').find(v=>v.PatientId===c.PatientId);return request({CaseId:c.CaseId,PatientId:c.PatientId,Revision:c.__updateTime,VisitRevision:visit.__updateTime,CareRevision:care?.__updateTime||'',ConfirmPatient:true,...extra});};
  f.book=(changes={})=>f.doctor.saveProcedureBooking(f.bookBody(changes));
  f.preop=c=>f.nurse.recordProcedurePreoperative(f.caseBody(c,{Note:preoperative,ConfirmChecks:true}));
  f.start=c=>f.doctor.startProcedure(f.caseBody(c,{ConfirmTimeOut:true}));
  f.signOp=c=>f.doctor.signProcedureOperative(f.caseBody(c,{Note:operative,ConfirmClinicalReview:true}));
  f.complete=c=>f.nurse.completeProcedureRecovery(f.caseBody(c,{Note:recovery,ConfirmHandover:true}));
  f.finish=async c=>{await f.preop(c);await f.start(c);await f.signOp(c);await f.complete(c);};
  return f;
}
