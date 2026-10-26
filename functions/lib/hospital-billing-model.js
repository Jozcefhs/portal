import {fail,stable} from './hospital-model.js';
import {field,money,dateOnly} from './hospital-orders-model.js';

export const ACCOUNT_TYPES={PatientReceivable:'asset',HmoReceivable:'asset',Revenue:'revenue',Cash:'asset',Bank:'asset',PatientDeposit:'liability',HmoPrepayment:'liability'};
export const OPTIONAL_FUND_ACCOUNTS=['PatientDeposit','HmoPrepayment'];
export function amount(value){const n=money(value);if(n<=0)fail('Enter an amount greater than zero.');return n;}
export function cents(value){if(!Number.isSafeInteger(value)||value<0||value>100000000000)fail('The financial amount is outside the supported range.');return value;}
export function equal(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
export function code(value){const s=field({Code:value},'Code',60,true).toUpperCase();if(!/^[A-Z0-9_-]+$/.test(s))fail('Use letters, digits, hyphens or underscores for a code.');return s;}
export function planFields(input){
  const Insurer=field(input,'Insurer',160,true),Name=field(input,'Name',160,true),Code=code(input?.Code);
  if(!Array.isArray(input?.Services)||!input.Services.length||input.Services.length>40)fail('Enter between 1 and 40 covered services.');
  const Services=input.Services.map(row=>{
    const ServiceCode=code(row.ServiceCode),TariffCents=amount(row.Tariff),CopayPercent=Number(row.CopayPercent);
    if(!/^\d+(?:\.\d{1,2})?$/.test(String(row.CopayPercent))||CopayPercent<0||CopayPercent>100)fail('Co-payment must be between 0 and 100 percent.');
    return {ServiceCode,Name:field(row,'Name',200,true),TariffCents,CopayBasisPoints:Math.round(CopayPercent*100)};
  }).sort((a,b)=>a.ServiceCode.localeCompare(b.ServiceCode));
  if(new Set(Services.map(s=>s.ServiceCode)).size!==Services.length)fail('Each service code must be unique within a plan.');
  return {Insurer,Name,Code,Services,Active:input.Active!==false};
}
export function eligibility(input){
  const From=dateOnly(input?.From),To=dateOnly(input?.To);if(From>To)fail('The eligibility end date must follow its start date.');
  return {MemberNumber:field(input,'MemberNumber',100,true),Authorization:field(input,'Authorization',160,true),
    VerificationNote:field(input,'VerificationNote',2000,true),From,To};
}
export function splitCharge(charge,plan){
  const source=cents(charge.AmountCents),service=plan?.Services?.find(row=>row.ServiceCode===charge.ServiceCode);
  // A verified insurer tariff is the total allowed fee; an uncovered service stays self-pay.
  const gross=service?cents(Number((BigInt(service.TariffCents)*BigInt(Math.round((charge.Quantity||1)*1000))+500n)/1000n)):source;
  const patient=service?Number((BigInt(gross)*BigInt(service.CopayBasisPoints)+5000n)/10000n):gross;
  return {GrossCents:gross,PatientCents:patient,HmoCents:gross-patient,SourceAmountCents:source,ServiceCode:charge.ServiceCode||'',Covered:!!service};
}
export function balances(invoice){
  return {PatientBalanceCents:invoice.PatientCents-invoice.PatientCreditCents-netPaid(invoice,'Patient'),
    HmoBalanceCents:invoice.HmoCents-invoice.HmoCreditCents-netPaid(invoice,'Hmo')};
}
export const netPaid=(invoice,payer)=>invoice[`${payer}PaidCents`]-invoice[`${payer}RefundCents`]-(invoice[`${payer}AllocationReturnCents`]||0);
export const fundsAvailable=fund=>cents(fund.AmountCents-fund.AppliedCents-fund.RefundedCents);
export function paymentFields(input){
  if(!['Cash','Bank transfer'].includes(input.Method))fail('Choose Cash or Bank transfer. Card-terminal payments remain disabled.');
  return {AmountCents:amount(input.Amount),Method:input.Method,Reference:field(input,'Reference',160,true)};
}
