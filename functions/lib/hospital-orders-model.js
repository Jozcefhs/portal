import {clean,fail,nameKey,digest} from './hospital-model.js';
import {historyDateRange} from './history-date-range.js';

export function field(input,key,max=2000,required=false){
  const raw=input?.[key];
  if(raw!==undefined&&typeof raw!=='string')fail(`Enter valid ${key}.`);
  const value=clean(raw);
  if(value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||(required&&!value))fail(`Enter ${key} (maximum ${max} characters).`);
  return value;
}
export function quantity(value){
  if(!['number','string'].includes(typeof value)||!/^\d+(?:\.\d{1,3})?$/.test(String(value))||!Number.isFinite(Number(value))||Number(value)<=0||Number(value)>1000000)fail('Enter a positive quantity with at most three decimal places.');
  return Number(value);
}
export const qty=value=>Math.round(value*1000)/1000;
// Integer arithmetic keeps fractional stock quantities and cumulative credits exact.
export function chargeCents(amount,unitPriceCents){return Number((BigInt(Math.round(amount*1000))*BigInt(unitPriceCents)+500n)/1000n);}
export function cumulativeCredit(totalCents,returned,totalQuantity){
  const denominator=BigInt(Math.round(totalQuantity*1000)),numerator=BigInt(totalCents)*BigInt(Math.round(returned*1000));
  return Number((2n*numerator+denominator)/(2n*denominator));
}
export function money(value){
  if(!['number','string'].includes(typeof value)||!/^\d+(?:\.\d{1,2})?$/.test(String(value))||Number(value)>10000000)fail('Enter a non-negative unit price with at most two decimal places.');
  return Math.round(Number(value)*100);
}
export function dateOnly(value){
  return historyDateRange({fromDate:value,toDate:value}).fromDate;
}
export const watDay=value=>new Date(Date.parse(value)+3600000).toISOString().slice(0,10);
export function dateFilters(input,fieldName='CreatedAt'){
  const range=historyDateRange(input),start=new Date(`${range.fromDate}T00:00:00+01:00`),end=new Date(`${range.toDate}T00:00:00+01:00`);
  end.setTime(end.getTime()+86400000);
  if(end-start>93*86400000)fail('Choose a period of no more than 93 days.');
  return [{field:fieldName,op:'>=',value:start.toISOString()},{field:fieldName,op:'<',value:end.toISOString()}];
}
export async function medicine(input){
  const details=Object.fromEntries(['Medicine','Strength','Form','Unit'].map(key=>[key,field(input,key,160,true)]));
  return {...details,MedicineKey:await digest(JSON.stringify(Object.values(details).map(nameKey)))};
}
export async function prescription(input){
  return {...await medicine(input),...Object.fromEntries(['Dose','Route','Frequency','Duration'].map(key=>[key,field(input,key,200,true)])),
    Quantity:quantity(input?.Quantity),Instructions:field(input,'Instructions',2000)};
}
export function investigation(input){
  const Kind=field(input,'Kind',30,true);
  if(!['Laboratory','Imaging'].includes(Kind))fail('Choose Laboratory or Imaging.');
  const Priority=field(input,'Priority',30,true);
  if(!['Routine','Urgent'].includes(Priority))fail('Choose Routine or Urgent.');
  return {Kind,Service:field(input,'Service',200,true),Indication:field(input,'Indication',2000,true),Priority,
    Specimen:field(input,'Specimen',200,Kind==='Laboratory')};
}
export function allergySnapshot(care){return {Status:care?.AllergyStatus||'Unknown',Details:care?.Allergies||'',RecordedAt:care?.AllergyRecordedAt||'',RecordedBy:care?.AllergyRecordedBy||''};}
