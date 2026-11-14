import {clean,fail} from './hospital-model.js';

export function selfBookingFields(input={}){
  if(input.SelfBookingEnabled!==undefined&&typeof input.SelfBookingEnabled!=='boolean')fail('Choose whether patients can book this clinic.');
  const SlotMinutes=Number(input.SlotMinutes??30);
  if(!Number.isInteger(SlotMinutes)||SlotMinutes<5||SlotMinutes>120||SlotMinutes%5)fail('Patient appointment length must be 5–120 minutes in steps of five.');
  return {SelfBookingEnabled:input.SelfBookingEnabled===true,SlotMinutes};
}
export function bookingToken(value){const token=clean(value);if(!/^[a-f0-9]{64}$/.test(token))fail('This booking link is invalid or no longer available. Ask Reception for a new link.',401);return token;}
export function patientBookingView(row){
  if(!row)return null;
  return Object.fromEntries(['Reference','StartAt','EndAt','ClinicianName','Department','Status'].map(k=>[k,row[k]||'']).concat([['Revision',row.__updateTime]]));
}
export function selfBookingSlots(schedule,now,blocked=[],exceptAppointment=''){
  if(!schedule.Active||schedule.SelfBookingEnabled!==true)return [];
  const {SlotMinutes}=selfBookingFields(schedule),slots=[];
  const bookings=(schedule.Bookings||[]).filter(b=>b.AppointmentId!==exceptAppointment);
  if(bookings.length>=96)return [];
  for(const window of schedule.Windows||[]){
    const end=Date.parse(`${schedule.Day}T${window.To}:00+01:00`);
    for(let start=Date.parse(`${schedule.Day}T${window.From}:00+01:00`);start+SlotMinutes*60000<=end;start+=SlotMinutes*60000){
      const slot={StartAt:new Date(start).toISOString(),EndAt:new Date(start+SlotMinutes*60000).toISOString()};
      if(slot.StartAt<=now||[...bookings,...blocked].some(b=>b.StartAt<slot.EndAt&&b.EndAt>slot.StartAt))continue;
      slots.push(slot);
    }
  }
  return slots;
}
