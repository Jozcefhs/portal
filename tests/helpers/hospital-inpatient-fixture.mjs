import {fixture,actor,env,request,profile} from './hospital-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
import {hospitalRoleModules} from '../../functions/lib/hospital-catalog.js';
export const inpatientActors=Object.fromEntries(Object.entries({admin:'Hospital Administrator',clerk:'Registration Officer',doctor:'Doctor',nurse:'Nurse',cashier:'Hospital Cashier'}).map(([name,role])=>[name,{...actor,role,username:name,displayName:`Test ${name}`,allowedSections:hospitalRoleModules(role)}]));
export const discharge={Disposition:'Home',Diagnosis:'Clinician recorded diagnosis',Course:'Clinician recorded course',Treatment:'Clinician recorded treatment',FollowUp:'Clinician recorded follow-up'};
export const period={fromDate:'2026-10-26',toDate:'2026-10-26'};
export async function inpatientFixture(){
  const f=fixture(inpatientActors.clerk);
  for(const [name,user] of Object.entries(inpatientActors))f[name]=createHospitalService(env,user,f.db);
  f.ward=async(Code='WARD-1',Name='General ward')=>{
    const r=await f.admin.saveHospitalWard(request({Ward:{Code,Name,Active:true}}));return f.rows('Wards').find(w=>w.WardId===r.WardId);
  };
  f.bed=async(ward,Code='BED-1')=>{const r=await f.admin.saveHospitalBed(request({WardId:ward.WardId,Bed:{Code,Name:Code,Active:true}}));return f.rows('Beds').find(b=>b.BedId===r.BedId);};
  f.newVisit=async(name='Patient')=>{const p=await f.clerk.savePatient(request({Patient:{...profile,LastName:name}}));const v=await f.clerk.checkIn(request({PatientId:p.PatientId,Department:'Outpatients'}));return {PatientId:p.PatientId,VisitId:v.VisitId};};
  f.admitBody=(scope,bed)=>request({...scope,BedId:bed.BedId,BedRevision:bed.__updateTime,VisitRevision:f.rows('Visits').find(v=>v.VisitId===scope.VisitId).__updateTime,ResponsibleClinician:'Dr Test',ConfirmPatient:true});
  f.body=(admission,extra={})=>{const a=f.rows('Admissions').find(r=>r.AdmissionId===(admission.AdmissionId||admission));return request({AdmissionId:a.AdmissionId,PatientId:a.PatientId,Revision:a.__updateTime,VisitRevision:f.rows('Visits').find(v=>v.VisitId===a.VisitId).__updateTime,ConfirmPatient:true,...extra});};
  f.sign=admission=>f.doctor.signHospitalDischarge(f.body(admission,{Summary:discharge,ConfirmClinicalReview:true}));
  const ward=await f.ward(),bed=await f.bed(ward),scope=await f.newVisit();
  return {...f,initialWard:ward,initialBed:bed,scope};
}
