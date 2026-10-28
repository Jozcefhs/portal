import {fixture,actor,env,request} from './hospital-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
import {hospitalRoleModules} from '../../functions/lib/hospital-catalog.js';
export const referralActors=Object.fromEntries(Object.entries({doctor:'Doctor',receiving:'Doctor',nurse:'Nurse',admin:'Hospital Administrator',reception:'Registration Officer'})
  .map(([username,role])=>[username,{...actor,username,role,displayName:`Test ${username}`,allowedSections:hospitalRoleModules(role)}]));
referralActors.receiving={...referralActors.receiving,assignedBranchIds:['north'],activeBranchId:'north'};
export const referralPeriod={fromDate:'2026-10-26',toDate:'2026-10-26'};
export async function referralsFixture(){
  const f=fixture();for(const [name,user]of Object.entries(referralActors))f[name]=createHospitalService(env,user,f.db);
  const registered=await f.register();f.PatientId=registered.PatientId;const v=await f.service.checkIn(request({PatientId:f.PatientId,Department:'Outpatients'}));f.VisitId=v.VisitId;
  f.store.set('staffUsers/receiving',{__id:'receiving',__updateTime:'staff-1',Username:'receiving',UsernameKey:'receiving',Role:'Doctor',DisplayName:'Dr Receiving',Active:true,OrganisationEdition:'hospital',BranchAccess:'selected',BranchIds:['north']});
  f.prepare=()=>f.doctor.referralContext(request({PatientId:f.PatientId,VisitId:f.VisitId}));
  f.signBody=async(extra={})=>{const c=await f.prepare();return request({PatientId:f.PatientId,VisitId:f.VisitId,VisitRevision:c.visit.Revision,CareRevision:c.CareRevision,ConfirmPatient:true,ConfirmClinicalReview:true,
    Referral:{Kind:'Internal',TargetBranchId:'north',Recipient:'receiving',Department:'Medicine',Urgency:'Routine',Reason:'Specialist opinion requested',Summary:'Synthetic clinical summary',Instructions:'Review then follow up'},...extra});};
  f.sign=async extra=>f.doctor.signReferral(await f.signBody(extra));
  f.actionBody=(row,extra={})=>{const r=f.rows('Referrals').find(r=>r.ReferralId===(row.ReferralId||row));return request({BranchId:'north',ReferralId:r.ReferralId,PatientId:r.PatientId,Revision:r.__updateTime,Action:'Acknowledge',Reason:'Accepted by receiving clinician',ConfirmPatient:true,ConfirmSharedCare:true,...extra});};
  f.reset=()=>{f.reads.length=f.queries.length=f.commits.length=0;};return f;
}
