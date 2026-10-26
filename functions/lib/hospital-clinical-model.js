import {clean,fail} from './hospital-model.js';

function text(input,key,limit=8000){
  const value=clean(input?.[key]);
  if(value.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail(`${key} is too long or contains invalid characters.`);
  return value;
}
export function triageFields(input={},now){
  const Complaint=text(input,'Complaint'),NursingNotes=text(input,'NursingNotes');
  if(!Complaint)fail('Record the presenting complaint.');
  const Urgency=text(input,'Urgency',40),AllergyStatus=text(input,'AllergyStatus',40),Allergies=text(input,'Allergies',2000);
  if(!['Not assessed','Routine','Urgent','Emergency'].includes(Urgency))fail('Choose the urgency assessed by the attending officer.');
  if(!['Unknown','No known allergies','Known allergies'].includes(AllergyStatus))fail('Record whether allergies are known, absent or not yet established.');
  if(AllergyStatus==='Known allergies'&&!Allergies)fail('Record the known allergies and reactions.');
  if(AllergyStatus!=='Known allergies'&&Allergies)fail('Select Known allergies when recording an allergy.');
  const Vitals={};
  for(const key of ['TemperatureC','PulseBpm','RespirationsPerMinute','SystolicMmHg','DiastolicMmHg','SpO2Percent','WeightKg','HeightCm']){
    const raw=input.Vitals?.[key];if(raw===undefined||raw===null||(typeof raw==='string'&&!raw.trim()))continue;
    if(!['number','string'].includes(typeof raw)||!Number.isFinite(Number(raw))||Number(raw)<0||Number(raw)>10000
      ||(key==='SpO2Percent'&&Number(raw)>100))fail(`Enter a valid numeric ${key} measurement in the displayed unit.`);
    Vitals[key]=Number(raw);
  }
  if(('SystolicMmHg' in Vitals)!==('DiastolicMmHg' in Vitals))fail('Record both systolic and diastolic blood pressure, or leave both blank.');
  const ObservedAt=clean(input.ObservedAt)||now;
  const day=ObservedAt.slice(0,10),calendarDate=new Date(`${day}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(ObservedAt)||!Number.isFinite(Date.parse(ObservedAt))
    ||!Number.isFinite(calendarDate.getTime())||calendarDate.toISOString().slice(0,10)!==day
    ||Date.parse(ObservedAt)>Date.parse(now)+300000)fail('Enter a valid observation time, including its timezone, that is not in the future.');
  return {Complaint,NursingNotes,Urgency,AllergyStatus,Allergies,Vitals,ObservedAt:new Date(ObservedAt).toISOString()};
}
export function consultationFields(input={},signing=false){
  const result=Object.fromEntries(['History','Examination','Assessment','Plan','FollowUp','Referral'].map(key=>[key,text(input,key)]));
  if(signing&&['History','Assessment','Plan'].some(key=>!result[key]))fail('Complete the history, assessment and treatment plan before signing.');
  if(!Object.values(result).some(Boolean))fail('Enter consultation notes before saving.');
  return result;
}
export function amendmentFields(input={}){
  const Reason=text(input,'Reason',1000),Text=text(input,'Text');
  if(Reason.length<5||!Text)fail('Record the amendment and a clear reason. The signed original will be retained.');
  return {Reason,Text};
}
