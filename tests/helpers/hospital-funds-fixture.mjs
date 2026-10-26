import {billingFixture,mapping,plan} from './hospital-billing-fixture.mjs';
import {request,profile} from './hospital-fixture.mjs';
export const fundMapping={...mapping,PatientDeposit:'2320',HmoPrepayment:'2330'};
export async function fundsFixture(){
  const f=await billingFixture();
  for(const Code of ['2320','2330','2340'])f.store.set(`chartOfAccounts/${Code}`,{Code,Name:'Advance liability',Type:'Liability',Active:'YES',__id:Code,__updateTime:`account-${Code}`});
  const config=(await f.admin.billingSettings(request())).settings;
  await f.admin.saveBillingSettings(request({Settings:fundMapping,Revision:config.Revision}));
  const fund=FundId=>f.rows('Funds').find(r=>r.FundId===FundId);
  const invoice=InvoiceId=>f.rows('Invoices').find(r=>r.InvoiceId===InvoiceId);
  const receive=(extra={})=>f.cashier.receiveHospitalFunds(request({Kind:'Patient',PatientId:f.scope.PatientId,Amount:'200',Method:'Bank transfer',Reference:crypto.randomUUID(),ConfirmPatient:true,...extra}));
  const fundBody=(receipt,extra={})=>request({FundId:receipt.FundId,Revision:fund(receipt.FundId).__updateTime,ConfirmPatient:true,...extra});
  const allocations=(receipt,rows,extra={})=>fundBody(receipt,{Reference:crypto.randomUUID(),Allocations:rows.map(([inv,Amount])=>({InvoiceId:inv.InvoiceId,Revision:invoice(inv.InvoiceId).__updateTime,Amount})),...extra});
  async function approve(inv){for(const Status of ['Submitted','Approved']){const row=invoice(inv.InvoiceId),claim=f.rows('Claims').find(r=>r.InvoiceId===inv.InvoiceId);
    await f.hmo.updateHmoClaim(request({InvoiceId:inv.InvoiceId,PatientId:row.PatientId,Revision:claim.__updateTime,Status,Reference:'INSURER-APPROVED',Note:'Verified insurer response',ConfirmPatient:true}));}}
  async function coveredInvoice(scope=f.scope){
    let p=(await f.hmo.findHmoPlans(request({Code:plan.Code}))).plan;
    if(!p){await f.hmo.saveHmoPlan(request({Plan:plan}));p=(await f.hmo.findHmoPlans(request({Code:plan.Code}))).plan;}
    let coverage=(await f.hmo.billingVisit(request(scope))).coverage;
    if(!coverage){await f.hmo.saveHmoEligibility(request({...scope,PlanId:p.PlanId,PlanRevision:p.Revision,ConfirmPatient:true,Eligibility:{MemberNumber:scope.PatientId,Authorization:'AUTH',VerificationNote:'Verified by staff',From:'2026-10-01',To:'2026-12-31'}}));coverage=(await f.hmo.billingVisit(request(scope))).coverage;}
    const {ChargeId}=await f.charge(scope),inv=await f.cashier.issueHospitalInvoice(request({...scope,ChargeIds:[ChargeId],UseHmo:true,EligibilityRevision:coverage.Revision,ConfirmPatient:true}));await approve(inv);return inv;
  }
  async function otherPatient(visit=true){const {PatientId}=await f.register({Patient:{...profile,FirstName:'Second'}});return visit?{PatientId,...await f.service.checkIn(request({PatientId,Department:'Outpatients'}))}:{PatientId};}
  const returnBody=(receipt,PaymentId,extra={})=>{const payment=f.rows('Payments').find(r=>r.PaymentId===PaymentId);return fundBody(receipt,{PaymentId,PaymentRevision:payment.__updateTime,InvoiceRevision:invoice(payment.InvoiceId).__updateTime,Amount:'10',Reference:crypto.randomUUID(),Reason:'Correct allocation',...extra});};
  return {...f,fund,invoice,receive,fundBody,allocations,approve,coveredInvoice,otherPatient,returnBody};
}
