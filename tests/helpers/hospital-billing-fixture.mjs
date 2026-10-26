import {ordersFixture,actors} from './hospital-orders-fixture.mjs';
import {env,actor,request} from './hospital-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
export const billingActors={
  cashier:{...actor,username:'cashier',displayName:'Hospital Cashier',role:'Hospital Cashier',allowedSections:['hospitalPatients','hospitalReception','hospitalBilling']},
  hmo:{...actor,username:'hmo',displayName:'HMO Officer',role:'HMO Officer',allowedSections:['hospitalPatients','hospitalReception','hospitalHmo']},
  admin:{...actor,username:'administrator',displayName:'Hospital Administrator',role:'Hospital Administrator',allowedSections:['hospitalPatients','hospitalReception','hospitalBilling','hospitalHmo']}
};
export const mapping={PatientReceivable:'1130',HmoReceivable:'1140',Revenue:'4300',Cash:'1000',Bank:'1010'};
export const plan={Code:'HMO-TEST',Insurer:'Synthetic insurer',Name:'Synthetic plan',Active:true,Services:[{ServiceCode:'CONSULT',Name:'Consultation',Tariff:'80.00',CopayPercent:'25'}]};
export const period={fromDate:'2026-10-26',toDate:'2026-10-26'};
export async function billingFixture(){
  const f=await ordersFixture(),services=Object.fromEntries(Object.entries(billingActors).map(([k,u])=>[k,createHospitalService(env,u,f.db)]));
  for(const [k,Code]of Object.entries(mapping))f.store.set(`chartOfAccounts/${Code}`,{Code,Name:k,Type:k==='Revenue'?'Revenue':'Asset',Active:'YES',__id:Code,__updateTime:`account-${Code}`});
  await services.admin.saveBillingSettings(request({Settings:mapping}));
  async function charge(extra={}){return services.cashier.createServiceCharge(request({...f.scope,Category:'Consultation',ServiceCode:'CONSULT',Description:'Consultation',Quantity:1,UnitPrice:'100.00',Reference:crypto.randomUUID(),ConfirmPatient:true,...extra}));}
  async function cover(extra={}){
    await services.hmo.saveHmoPlan(request({Plan:{...plan,...extra}}));const p=(await services.hmo.findHmoPlans(request({Code:plan.Code}))).plan;
    await services.hmo.saveHmoEligibility(request({...f.scope,PlanId:p.PlanId,PlanRevision:p.Revision,ConfirmPatient:true,Eligibility:{MemberNumber:'MEM-1',Authorization:'AUTH-1',VerificationNote:'Staff verified with insurer',From:'2026-10-01',To:'2026-12-31'}}));
    return (await services.hmo.billingVisit(request(f.scope))).coverage;
  }
  async function issue(extra={}){const {ChargeId}=await charge();return services.cashier.issueHospitalInvoice(request({...f.scope,ChargeIds:[ChargeId],ConfirmPatient:true,...extra}));}
  async function billBody(result,extra={}){const data=await services.cashier.hospitalInvoiceDetails(request({...result,PatientId:f.scope.PatientId}));return request({InvoiceId:data.invoice.InvoiceId,PatientId:f.scope.PatientId,Revision:data.invoice.Revision,ConfirmPatient:true,...extra});}
  return {...f,...services,charge,cover,issue,billBody};
}
