import {fundsFixture,fundMapping} from './hospital-funds-fixture.mjs';
import {request} from './hospital-fixture.mjs';
export const companyFields={Code:'CORP-TEST',Name:'Synthetic employer',ContactName:'Benefits officer',Email:'test@example.invalid',Phone:'08000000000',Address:'Synthetic address',Active:true,PaymentTermsDays:30,CreditLimit:'1000'};
export const coverFields={EmployeeNumber:'EMP-1',Authorization:'EMP-AUTH',VerificationNote:'Verified employer authorisation',From:'2026-10-01',To:'2026-12-31',CoveragePercent:'80',AllServices:false,Services:['CONSULT']};
export async function corporateFixture(){
  const f=await fundsFixture();for(const [Code,Type]of [['1150','Asset'],['2350','Liability']])f.store.set(`chartOfAccounts/${Code}`,{Code,Name:'Corporate account',Type,Active:'YES',__id:Code,__updateTime:`account-${Code}`});
  const config=(await f.admin.billingSettings(request())).settings;await f.admin.saveBillingSettings(request({Settings:{...fundMapping,CorporateReceivable:'1150',CorporatePrepayment:'2350'},Revision:config.Revision}));
  const result=await f.admin.saveCorporateAccount(request({Company:companyFields}));
  const company=()=>f.rows('CorporateAccounts').find(r=>r.CompanyId===result.CompanyId);
  async function coverage(scope=f.scope,extra={}){await f.admin.saveCorporateCoverage(request({...scope,CompanyId:company().CompanyId,CompanyRevision:company().__updateTime,Coverage:{...coverFields,...extra},ConfirmPatient:true}));return (await f.cashier.hospitalCorporateVisit(request(scope))).coverage;}
  async function corpInvoice(scope=f.scope,extra={}){let c=f.rows('CorporateCoverage').find(r=>r.VisitId===scope.VisitId);if(!c){await coverage(scope);c=f.rows('CorporateCoverage').find(r=>r.VisitId===scope.VisitId);}const {ChargeId}=await f.charge(scope);return f.cashier.issueHospitalInvoice(request({...scope,ChargeIds:[ChargeId],UseCorporate:true,CorporateCoverageRevision:c.__updateTime,ConfirmPatient:true,...extra}));}
  return {...f,company,coverage,corpInvoice};
}
