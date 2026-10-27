import {clean,fail} from './hospital-model.js';
import {field} from './hospital-orders-model.js';

export function nursingTime(value,now,{future=false}={}){
  const raw=clean(value),day=raw.slice(0,10),date=new Date(`${day}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)||!Number.isFinite(Date.parse(raw))||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day
    ||(!future&&Date.parse(raw)>Date.parse(now)+300000))fail('Enter a valid recorded time with timezone, not in the future.');
  return new Date(raw).toISOString();
}
export function nursingChart(input,now){
  const Kind=field(input,'Kind',30,true),ObservedAt=nursingTime(input?.ObservedAt,now),Notes=field(input,'Notes',8000);
  if(!['Observations','Fluid balance','Nursing note'].includes(Kind))fail('Choose a nursing chart type.');
  const Measurements={};
  const keys=Kind==='Observations'?['TemperatureC','PulseBpm','RespirationsPerMinute','SystolicMmHg','DiastolicMmHg','SpO2Percent','PainScore']:
    Kind==='Fluid balance'?['IntakeMl','OutputMl']:[];
  for(const key of keys){
    const raw=input?.Measurements?.[key];if(raw===undefined||raw===null||raw==='')continue;
    if(!['string','number'].includes(typeof raw)||!Number.isFinite(Number(raw))||Number(raw)<0||Number(raw)>1000000
      ||(key==='SpO2Percent'&&Number(raw)>100)||(key==='PainScore'&&Number(raw)>10))fail(`Enter a valid ${key} measurement in the displayed unit.`);
    Measurements[key]=Number(raw);
  }
  if(('SystolicMmHg' in Measurements)!==('DiastolicMmHg' in Measurements))fail('Record both blood-pressure measurements.');
  if(!Object.keys(Measurements).length&&!Notes)fail('Enter a measurement or a nursing note.');
  return {Kind,ObservedAt,Notes,Measurements};
}
export function handoverFields(input,now){
  const ShiftStart=nursingTime(input?.ShiftStart,now),ShiftEnd=nursingTime(input?.ShiftEnd,now,{future:true});
  if(Date.parse(ShiftEnd)<=Date.parse(ShiftStart)||Date.parse(ShiftEnd)-Date.parse(ShiftStart)>24*3600000)fail('Choose a shift lasting no more than 24 hours.');
  const Recipient=field(input,'Recipient',120,true).toLowerCase();
  if(!/^[a-z0-9._@-]+$/.test(Recipient))fail('Enter the receiving officer’s staff username.');
  return {ShiftStart,ShiftEnd,Recipient,...Object.fromEntries(['Situation','Background','Assessment','Recommendations','OutstandingTasks'].map(k=>[k,field(input,k,4000,true)]))};
}
export const NURSING_OUTCOMES=['Given','Withheld','Refused','Unavailable','Omitted'];
