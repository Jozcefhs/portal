import {clean,fail} from './hospital-model.js';
import {historyDateRange} from './history-date-range.js';

export function inpatientText(value,label,max=160,required=true){
  const text=clean(value);
  if((required&&!text)||text.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))fail(`Enter a valid ${label} (maximum ${max} characters).`);
  return text;
}
export function inpatientCode(value){
  const code=clean(value).toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(code))fail('Use a ward or bed code of up to 30 letters, digits, hyphens or underscores.');
  return code;
}
export function inpatientDates(value){
  const range=historyDateRange(value),start=new Date(`${range.fromDate}T00:00:00+01:00`),end=new Date(`${range.toDate}T00:00:00+01:00`);
  end.setTime(end.getTime()+86400000);
  if(end-start>93*86400000)fail('Choose an admission-history period of no more than 93 days.');
  return [{field:'CreatedAt',op:'>=',value:start.toISOString()},{field:'CreatedAt',op:'<',value:end.toISOString()}];
}
export function dischargeFields(input={}){
  const Disposition=inpatientText(input.Disposition,'discharge disposition');
  if(!['Home','Referral / transfer','Left against advice','Deceased'].includes(Disposition))fail('Choose a discharge disposition.');
  return {Disposition,Diagnosis:inpatientText(input.Diagnosis,'discharge diagnosis',2000),
    Course:inpatientText(input.Course,'clinical course',8000),Treatment:inpatientText(input.Treatment,'medication and treatment instructions',6000),
    FollowUp:inpatientText(input.FollowUp,'follow-up or receiving facility instructions',4000)};
}
