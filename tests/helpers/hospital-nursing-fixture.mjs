import {inpatientFixture,inpatientActors,period} from './hospital-inpatient-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
import {hospitalRoleModules} from '../../functions/lib/hospital-catalog.js';
import {env,request} from './hospital-fixture.mjs';
import {rx,medicine} from './hospital-orders-fixture.mjs';
export {period};
export const chartFields={Kind:'Observations',ObservedAt:'2026-10-26T12:00:00.000Z',Measurements:{TemperatureC:36.7,PulseBpm:78},Notes:'Recorded bedside observations'};
export const handoverFields={ShiftStart:'2026-10-26T08:00:00.000Z',ShiftEnd:'2026-10-26T20:00:00.000Z',Recipient:'receiver',Situation:'Recorded situation',Background:'Recorded background',Assessment:'Recorded assessment',Recommendations:'Recorded plan',OutstandingTasks:'Recorded pending tasks'};
export const nursingActors={...inpatientActors,receiver:{...inpatientActors.nurse,username:'receiver',displayName:'Receiving nurse'},director:{...inpatientActors.doctor,role:'Medical Director',username:'director',displayName:'Medical Director',allowedSections:hospitalRoleModules('Medical Director')},pharmacist:{...inpatientActors.nurse,role:'Pharmacist',username:'pharmacist',allowedSections:hospitalRoleModules('Pharmacist')}};
export async function nursingFixture({medication=true}={}){
  const f=await inpatientFixture();for(const [name,user] of Object.entries(nursingActors))f[name]=createHospitalService(env,user,f.db);
  f.store.set('staffUsers/receiver',{__id:'receiver',__updateTime:'receiver-v1',Username:'receiver',UsernameKey:'receiver',Role:'Nurse',DisplayName:'Receiving nurse',OrganisationEdition:'hospital',Active:true,BranchAccess:'selected',BranchIds:['main']});
  const admission=await f.clerk.admitHospitalPatient(f.admitBody(f.scope,f.initialBed));
  const nScope={AdmissionId:admission.AdmissionId,PatientId:f.scope.PatientId};
  f.nBody=(extra={})=>{const a=f.rows('Admissions')[0],v=f.rows('Visits')[0],care=f.rows('CareSummaries')[0];return request({...nScope,AdmissionRevision:a.__updateTime,VisitRevision:v.__updateTime,CareRevision:care?.__updateTime||'',ConfirmPatient:true,...extra});};
  f.plan=DueAt=>f.nurse.planMedicationDose(f.nBody({OrderId:f.order.OrderId,OrderRevision:f.rows('Orders')[0].__updateTime,DueAt:DueAt||'2026-10-26T12:00:00Z'}));
  f.doseBody=(dose,extra={})=>{const d=f.rows('MedicationDoses').find(r=>r.DoseId===dose.DoseId),s=f.rows('Dispenses')[0];return f.nBody({DoseId:d.DoseId,Revision:d.__updateTime,OrderRevision:f.rows('Orders')[0].__updateTime,Outcome:'Given',AdministeredAt:'2026-10-26T12:00:00Z',DispenseId:s?.DispenseId,DispenseRevision:s?.__updateTime,Quantity:1,ConfirmMedicationReview:true,...extra});};
  if(medication){
    const c=await f.doctor.orderVisitContext(request(f.scope));f.order=await f.doctor.createOrder(request({...f.scope,Kind:'Prescription',Prescription:rx,VisitRevision:c.visit.Revision,CareRevision:c.care.Revision,ConfirmPatient:true}));
    f.pharmacyBody=async extra=>{const c=await f.pharmacist.orderDetails(request(f.order));return request({...f.order,Revision:c.order.Revision,CareRevision:c.care.Revision,ConfirmPatient:true,...extra});};
    await f.pharmacist.reviewPrescription(await f.pharmacyBody({Decision:'Approved',Reason:'Verified prescription'}));
    const stock=await f.pharmacist.receiveMedicine(request({Stock:{...medicine,Quantity:20,BatchNumber:'NURSE-LOT',ExpiryDate:'2027-12-31',Supplier:'Synthetic supplier',ReceiptReference:'NURSE-RECEIPT',LineReference:'1',UnitPrice:'10.00'}}));
    await f.pharmacist.dispensePrescription(await f.pharmacyBody({BatchId:stock.BatchId,BatchRevision:f.rows('MedicineBatches')[0].__updateTime,Quantity:10}));
  }
  return {...f,nScope,admission};
}
