import {fail} from './hospital-model.js';
import {field,watDay} from './hospital-orders-model.js';
import {nursingTime} from './hospital-nursing-model.js';
export function theatreReference(value){const code=String(value||'').trim().toUpperCase();if(!/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(code))fail('Use a theatre or procedure reference of up to 30 letters, digits, hyphens or underscores.');return code;}
export function bookingFields(input,now){
  const StartAt=nursingTime(input?.StartAt,now,{future:true}),EndAt=nursingTime(input?.EndAt,now,{future:true});
  if(!StartAt.endsWith(':00.000Z')||!EndAt.endsWith(':00.000Z')||EndAt<=StartAt||Date.parse(EndAt)-Date.parse(StartAt)>24*3600000)fail('Choose booking times to the minute, lasting at most 24 hours.');
  if(Date.parse(StartAt)<Date.parse(now)-300000||Date.parse(StartAt)>Date.parse(now)+366*86400000)fail('Choose a current or future booking within one year.');
  return {Reference:theatreReference(input?.Reference),Procedure:field(input,'Procedure',200,true),SiteSide:field(input,'SiteSide',200,true),
    LeadClinician:field(input,'LeadClinician',120,true).toLowerCase(),Team:field(input,'Team',1500,true),StartAt,EndAt};
}
export function bookingDays(row){return [...new Set([watDay(row.StartAt),watDay(new Date(Date.parse(row.EndAt)-1).toISOString())])];}
export function theatreNote(kind,input){
  const fields={Preoperative:['ConsentReference','Preparation','AnaesthesiaAssessment'],Operative:['PerformedProcedure','Diagnosis','Findings','Technique','AnaesthesiaRecord','CountsAndSpecimens','ImplantsAndConsumables','Complications','RecoveryPlan'],Recovery:['Observations','Disposition','ReceivingOfficer','Handover']};
  if(!fields[kind])fail('Choose a procedure note type.');
  return Object.fromEntries(fields[kind].map(key=>[key,field(input,key,key==='Technique'?8000:4000,true)]));
}
