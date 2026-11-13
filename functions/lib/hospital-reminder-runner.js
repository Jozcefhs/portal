import {queryCollection} from './firestore.js';
import {hospitalCollectionPath} from './hospital-storage.js';
import {createHospitalService} from './hospital-service.js';
import {staffAccessFor,staffUserForAccess} from './staff-auth.js';
import {requiredDeploymentIdentity} from './deployment-identity.js';
import {fail} from './hospital-model.js';

export async function processHospitalReminderSchedule(env,overrides={}){
  const identity=requiredDeploymentIdentity(env);if(identity.edition!=='hospital')fail('Hospital scheduler only.',403);
  const serviceUser={username:'system:hospital-appointment-reminders',displayName:'Appointment reminder scheduler',role:'Hospital Administrator',branchAccess:'all',activeBranchId:''};
  const access=await (overrides.staffAccessFor||staffAccessFor)(env,serviceUser);
  if(access.edition!=='hospital'||access.subscriptionActive===false||access.subscriptionReadOnly===true||!access.allowedSections?.includes('hospitalReception'))return {ok:true,...identity,paused:true,checked:0};
  const now=(overrides.now?overrides.now():new Date()).toISOString();
  const rows=await (overrides.queryCollection||queryCollection)(env,hospitalCollectionPath(env,'AppointmentReminders'),{
    filters:[{field:'Status',op:'==',value:'Queued'},{field:'DueAt',op:'<=',value:now}],orderBy:[{field:'DueAt'},{field:'__name__'}],limit:5});
  const service=(overrides.createHospitalService||createHospitalService)(env,staffUserForAccess(serviceUser,access),overrides),counts={};
  for(const row of rows){
    try{const r=await service.processAppointmentReminder({BranchId:row.BranchId,ReminderId:row.ReminderId});counts[r.Status]=(counts[r.Status]||0)+1;}
    catch{counts.errors=(counts.errors||0)+1;}
  }
  return {ok:!counts.errors,...identity,checked:rows.length,counts};
}
