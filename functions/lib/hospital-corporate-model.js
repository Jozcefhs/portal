import {fail} from './hospital-model.js';
import {field,money,dateOnly} from './hospital-orders-model.js';
import {code,cents} from './hospital-billing-model.js';

export function corporateFields(input={}){
  const PaymentTermsDays=Number(input.PaymentTermsDays);
  if(!Number.isInteger(PaymentTermsDays)||PaymentTermsDays<0||PaymentTermsDays>365)fail('Payment terms must be 0–365 days.');
  let CreditLimitCents=null;if(input.CreditLimit!==''&&input.CreditLimit!=null){try{CreditLimitCents=money(input.CreditLimit);}catch{fail('Enter a non-negative credit limit with at most two decimal places.');}}
  return {Code:code(input.Code),Name:field(input,'Name',160,true),ContactName:field(input,'ContactName',160),Email:field(input,'Email',200),Phone:field(input,'Phone',60),
    Address:field(input,'Address',500),Active:input.Active!==false,PaymentTermsDays,CreditLimitCents};
}
export function corporateCoverageFields(input={}){
  const From=dateOnly(input.From),To=dateOnly(input.To);if(From>To)fail('The authorisation end date must follow its start date.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(String(input.CoveragePercent))||Number(input.CoveragePercent)<=0||Number(input.CoveragePercent)>100)fail('Company coverage must be greater than 0 and at most 100 percent.');
  const AllServices=input.AllServices===true,Services=AllServices?[]:(Array.isArray(input.Services)?input.Services:[]).map(code).sort();
  if(!AllServices&&(!Services.length||Services.length>40||new Set(Services).size!==Services.length))fail('Choose all services or 1–40 distinct covered service codes.');
  return {EmployeeNumber:field(input,'EmployeeNumber',100,true),Authorization:field(input,'Authorization',160,true),VerificationNote:field(input,'VerificationNote',2000,true),
    From,To,AllServices,Services,CoverageBasisPoints:Math.round(Number(input.CoveragePercent)*100)};
}
export function splitCorporateCharge(charge,coverage){
  const gross=cents(charge.AmountCents),covered=coverage.AllServices||coverage.Services.includes(charge.ServiceCode),corporate=covered?Number((BigInt(gross)*BigInt(coverage.CoverageBasisPoints)+5000n)/10000n):0;
  return {GrossCents:gross,PatientCents:gross-corporate,HmoCents:0,CorporateCents:corporate,SourceAmountCents:gross,ServiceCode:charge.ServiceCode||'',Covered:covered};
}
export function corporateBalance(row){const value=BigInt(row.BilledCents||0)-BigInt(row.CreditedCents||0)-BigInt(row.PaidCents||0)+BigInt(row.RefundedCents||0)+BigInt(row.ReturnedCents||0),number=Number(value);if(!Number.isSafeInteger(number))fail('The corporate balance is outside the supported range.',409);return number;}
export function corporateDueDate(day,terms){const date=new Date(`${day}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+terms);return date.toISOString().slice(0,10);}
