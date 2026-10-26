import {fixture,actor,env,request} from './hospital-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
export const medicine={Medicine:'Synthetic medicine',Strength:'Test strength',Form:'Tablet',Unit:'tablet'};
export const rx={...medicine,Dose:'Clinician-entered dose',Route:'Clinician-entered route',Frequency:'Clinician-entered frequency',Duration:'Clinician-entered duration',Quantity:10};
export const actors={
  doctor:{...actor,role:'Doctor',username:'doctor',displayName:'Doctor Example',allowedSections:['hospitalPatients','hospitalReception','hospitalOrders','hospitalConsultations','hospitalTriage']},
  pharmacist:{...actor,role:'Pharmacist',username:'pharmacist',displayName:'Pharmacist Example',allowedSections:['hospitalPatients','hospitalReception','hospitalPharmacy']},
  laboratory:{...actor,role:'Laboratory Scientist',username:'lab-author',displayName:'Laboratory Author',allowedSections:['hospitalPatients','hospitalReception','hospitalLaboratory']},
  verifier:{...actor,role:'Laboratory Scientist',username:'lab-verifier',displayName:'Laboratory Verifier',allowedSections:['hospitalPatients','hospitalReception','hospitalLaboratory']},
  imaging:{...actor,role:'Radiographer',username:'imaging-author',displayName:'Imaging Author',allowedSections:['hospitalPatients','hospitalReception','hospitalImaging']},
  imagingVerifier:{...actor,role:'Radiographer',username:'imaging-verifier',displayName:'Imaging Verifier',allowedSections:['hospitalPatients','hospitalReception','hospitalImaging']}
};
export async function ordersFixture(){
  const f=fixture(),{PatientId}=await f.register(),{VisitId}=await f.service.checkIn(request({PatientId,Department:'Outpatients'}));
  const services=Object.fromEntries(Object.entries(actors).map(([key,user])=>[key,createHospitalService(env,user,f.db)]));
  const scope={PatientId,VisitId};
  async function create(Kind='Prescription',fields={}){
    const c=await services.doctor.orderVisitContext(request(scope));
    return services.doctor.createOrder(request({...scope,Kind,VisitRevision:c.visit.Revision,CareRevision:c.care.Revision,
      ConfirmPatient:true,Prescription:{...rx,...fields},Investigation:{Service:'Synthetic investigation',Indication:'Clinician request',Specimen:'Labelled specimen',Priority:'Routine',...fields}}));
  }
  async function body(order,extra={},service=services.pharmacist){
    const c=await service.orderDetails(request(order));
    return request({...order,Revision:c.order.Revision,CareRevision:c.care.Revision,ConfirmPatient:true,...extra});
  }
  const receive=(extra={})=>services.pharmacist.receiveMedicine(request({Stock:{...medicine,Quantity:20,BatchNumber:'TEST-LOT',ExpiryDate:'2027-12-31',Supplier:'Synthetic supplier',ReceiptReference:crypto.randomUUID(),LineReference:'1',UnitPrice:'12.50',...extra}}));
  return {...f,...services,scope,create,body,receive};
}
