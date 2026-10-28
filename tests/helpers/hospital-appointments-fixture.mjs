import {fixture,actor,env,request} from './hospital-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
import {hospitalRoleModules} from '../../functions/lib/hospital-catalog.js';
export const appointmentActors=Object.fromEntries(Object.entries({reception:'Registration Officer',admin:'Hospital Administrator',doctor:'Doctor',nurse:'Nurse',cashier:'Hospital Cashier'})
  .map(([username,role])=>[username,{...actor,username,role,displayName:`Test ${role}`,allowedSections:hospitalRoleModules(role)}]));
export const clinic={Day:'2026-10-26',Clinician:'doctor',Department:'Outpatients',Active:true,Windows:[{From:'13:00',To:'18:00'}]};
export const appointment={Reference:'APT-001',StartAt:'2026-10-26T13:00:00.000Z',EndAt:'2026-10-26T13:30:00.000Z'};
export const appointmentPeriod={fromDate:'2026-10-26',toDate:'2026-10-26'};
export async function appointmentsFixture(){
  const f=fixture();let time='2026-10-26T12:00:00.000Z';f.db.now=()=>new Date(time);f.setTime=value=>{time=value;};
  for(const [name,user] of Object.entries(appointmentActors))f[name]=createHospitalService(env,user,f.db);
  f.service=f.reception;
  for(const username of ['doctor','other'])f.store.set(`staffUsers/${username}`,{__id:username,__updateTime:'staff-1',Username:username,UsernameKey:username,Role:'Doctor',DisplayName:`Dr ${username}`,Active:true,OrganisationEdition:'hospital',BranchAccess:'selected',BranchIds:['main','north']});
  const registered=await f.register();f.PatientId=registered.PatientId;
  f.schedule=async(changes={})=>f.admin.saveAppointmentSchedule(request({Schedule:{...clinic,...changes}}));
  const created=await f.schedule();f.ScheduleId=created.ScheduleId;
  f.bookBody=(changes={})=>request({PatientId:f.PatientId,ScheduleId:f.ScheduleId,ConfirmPatient:true,Booking:{...appointment,...changes}});
  f.book=changes=>f.reception.saveAppointment(f.bookBody(changes));
  f.body=(row,extra={})=>{const saved=f.rows('Appointments').find(r=>r.AppointmentId===(row.AppointmentId||row));return request({PatientId:saved.PatientId,AppointmentId:saved.AppointmentId,Revision:saved.__updateTime,ConfirmPatient:true,...extra});};
  f.reset=()=>{f.reads.length=f.queries.length=f.commits.length=0;};
  return f;
}
