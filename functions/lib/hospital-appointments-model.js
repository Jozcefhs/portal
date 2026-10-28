import {clean,fail} from './hospital-model.js';
import {field,dateOnly,watDay} from './hospital-orders-model.js';

export const appointmentReference=value=>/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(clean(value).toUpperCase())
  ? clean(value).toUpperCase() : fail('Enter a permanent booking reference of 3–40 letters, numbers, hyphens or underscores.');
const minutes=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):fail('Enter an availability time in HH:MM format.');
export function availabilityFields(input,now){
  const Day=dateOnly(input?.Day),Clinician=field(input,'Clinician',120,true).toLowerCase();
  if(Day<watDay(now)||Date.parse(`${Day}T00:00:00+01:00`)>Date.parse(now)+366*86400000)fail('Choose today or a date within the next year.');
  if(typeof input?.Active!=='boolean')fail('Choose whether this clinic is active.');
  if(!Array.isArray(input.Windows)||input.Windows.length<1||input.Windows.length>12)fail('Enter between one and twelve availability windows.');
  const Windows=input.Windows.map(row=>({From:field(row,'From',5,true),To:field(row,'To',5,true)})).sort((a,b)=>a.From.localeCompare(b.From));
  for(let i=0;i<Windows.length;i++){
    if(minutes(Windows[i].From)>=minutes(Windows[i].To)||i&&Windows[i].From<Windows[i-1].To)fail('Availability windows must be ordered, non-overlapping and end after they start.');
  }
  return {Day,Clinician,Department:field(input,'Department',120,true),Active:input.Active,Windows,DayStartAt:new Date(`${Day}T00:00:00+01:00`).toISOString()};
}
export function appointmentTimes(input,now){
  const fields={};
  for(const key of ['StartAt','EndAt']){
    const value=field(input,key,24,true);
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('Choose appointment times to the minute.');
    fields[key]=value;
  }
  if(fields.StartAt<=now||Date.parse(fields.StartAt)>Date.parse(now)+366*86400000)fail('Choose a future appointment within the next year.');
  const duration=Date.parse(fields.EndAt)-Date.parse(fields.StartAt);
  if(duration<=0||duration>12*3600000||watDay(fields.StartAt)!==watDay(fields.EndAt))fail('An appointment must end later on the same WAT date and last no more than twelve hours.');
  return fields;
}
export function withinAvailability(schedule,row){
  return schedule.Active&&watDay(row.StartAt)===schedule.Day&&schedule.Windows.some(window=>
    row.StartAt>=new Date(`${schedule.Day}T${window.From}:00+01:00`).toISOString()&&row.EndAt<=new Date(`${schedule.Day}T${window.To}:00+01:00`).toISOString());
}
