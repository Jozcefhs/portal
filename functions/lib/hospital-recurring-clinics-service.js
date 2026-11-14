import {clean,fail,id,digest,stable} from './hospital-model.js';
import {field,dateOnly,dateFilters,watDay} from './hospital-orders-model.js';
import {availabilityFields,appointmentReference} from './hospital-appointments-model.js';

// Templates produce ordinary clinic days. Existing days are never overwritten.
export function createHospitalRecurringClinicsService(ctx,{clinician}){
  const {env,user,db,collection,requireCapability,branch,clock,actor,condition,strip,eq,auditWrite,operation,page}=ctx;
  const keyFor=(...parts)=>digest(JSON.stringify(parts));
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const view=row=>({...strip(row),Revision:row.__updateTime});
  const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
  const stamp=()=>({UpdatedAt:clock(),UpdatedBy:actor,UpdatedByName:clean(user.displayName)||actor});
  const own=row=>{if(user.role==='Doctor'&&row.Clinician!==actor.toLowerCase())fail('Doctors may change only their own clinic templates.',403);};
  const revision=(row,value)=>{if(!value||value!==row.__updateTime)fail('This clinic template changed. Open it again before continuing.',409);};
  const event=(key,row,Type,extra={})=>write('ClinicTemplateEvents',key,{EventId:key,TemplateId:row.TemplateId,BranchId:row.BranchId,Type,
    Snapshot:strip(row),CreatedAt:clock(),...stamp(),...extra},null);
  function fields(input){
    const {Day,DayStartAt,...availability}=availabilityFields({...input,Day:watDay(clock())},clock());
    const days=input?.Weekdays;
    if(!Array.isArray(days)||!days.length||days.length>7||days.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(days).size!==days.length)fail('Select one or more different weekdays.');
    return {...availability,Reference:appointmentReference(input.Reference),Name:field(input,'Name',120,true),Weekdays:[...days].sort((a,b)=>a-b)};
  }
  async function current(body){
    const BranchId=await branch(body),row=await read('ClinicTemplates',body.TemplateId);
    if(!row||row.BranchId!==BranchId)fail('Choose a clinic template in this branch.',404);
    return {BranchId,row};
  }
  async function scopedPage(name,filters,sort,body){
    const scope=await keyFor(name,filters,sort);
    if(body.Cursor&&body.Cursor.scope!==scope)fail('This page belongs to different clinic filters. Load the first page.');
    const r=await page(name,filters,sort,body);return {...r,next:r.next?{...r.next,scope}:null};
  }
  function daysFor(row,range){
    const from=dateOnly(range?.fromDate),to=dateOnly(range?.toDate),start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');
    if(from<watDay(clock())||end<start||end-start>30*86400000||end>Date.parse(clock())+366*86400000)fail('Choose today or future clinic dates, at most 31 days at a time and within the next year.');
    const days=[];for(let at=start;at<=end;at+=86400000)if(row.Weekdays.includes(new Date(at).getUTCDay()))days.push(new Date(at).toISOString().slice(0,10));
    return days;
  }
  async function preview(row,range){
    if(!row.Active)fail('This clinic template is inactive. Activate it before generating clinic days.',409);
    const days=daysFor(row,range);
    // At most 31 exact schedule reads; no appointment or patient scans.
    const entries=await Promise.all(days.map(async Day=>{
      const ScheduleId=await keyFor('clinic',row.BranchId,row.Clinician,Day),old=await read('AppointmentSchedules',ScheduleId);
      const matches=old&&old.Active===true&&old.Department===row.Department&&same(old.Windows,row.Windows)&&(old.SelfBookingEnabled===true)===(row.SelfBookingEnabled===true)&&(old.SlotMinutes||30)===(row.SlotMinutes||30);
      return {Day,ScheduleId,Status:old?(matches?'Already available':'Needs review'):'Create',
        Department:old?.Department||row.Department,Windows:old?.Windows||row.Windows,Active:old?.Active??true,BookedCount:(old?.Bookings||[]).length};
    }));
    const counts={Create:0,Existing:0,Conflicts:0};for(const e of entries)counts[e.Status==='Create'?'Create':e.Status==='Already available'?'Existing':'Conflicts']++;
    // Covers the reviewed configuration and availability, without exposing booking IDs.
    const Token=await keyFor(strip(row),range,entries);
    return {entries,...counts,Token};
  }
  return {
    async clinicTemplates(body){
      requireCapability('appointments.read');const BranchId=await branch(body);
      if(typeof body.Active!=='boolean')fail('Choose active or inactive clinic templates.');
      const r=await scopedPage('ClinicTemplates',[eq('BranchId',BranchId),eq('Active',body.Active)],'Name',body);
      return {ok:true,templates:r.rows.map(view),next:r.next};
    },
    async clinicTemplateDetails(body){requireCapability('appointments.read');const {row}=await current(body);return {ok:true,template:view(row)};},
    async saveClinicTemplate(body){
      requireCapability('appointments.configure');const BranchId=await branch(body);
      own({Clinician:clean(body.Template?.Clinician).toLowerCase()});
      return operation(body,'saveClinicTemplate',async key=>{
        const data=fields(body.Template),TemplateId=await keyFor('clinic-template',BranchId,data.Reference),old=await read('ClinicTemplates',TemplateId);
        if(body.TemplateId&&body.TemplateId!==TemplateId)fail('The template reference is permanent. Create another template for a different reference.');
        if(!old&&body.TemplateId)fail('This template no longer matches the saved reference.',409);
        if(old)own(old);
        if(old&&same(Object.fromEntries(Object.keys(data).map(k=>[k,old[k]])),data))return {writes:[],result:{TemplateId,Unchanged:true}};
        const Reason=field(body,'Reason',1000);
        if(old){revision(old,body.Revision);if(Reason.length<5)fail('Record the reason for changing this template.');}
        const ClinicianName=await clinician(data.Clinician,BranchId),row={...strip(old),...data,TemplateId,BranchId,ClinicianName,CreatedAt:old?.CreatedAt||clock(),...stamp()};
        return {writes:[write('ClinicTemplates',TemplateId,row,old),event(key,row,old?'Changed':'Created',{Reason}),
          auditWrite(key,'Save recurring clinic template',BranchId,{}, {TemplateId,Reference:data.Reference,Reason})],result:{TemplateId}};
      });
    },
    async previewClinicTemplate(body){
      requireCapability('appointments.configure');const {row}=await current(body);own(row);revision(row,body.Revision);
      return {ok:true,preview:await preview(row,body.DateRange)};
    },
    async generateClinicTemplate(body){
      requireCapability('appointments.configure');await branch(body);
      if(body.ConfirmGeneration!==true)fail('Confirm the preview before creating clinic days.');
      return operation(body,'generateClinicTemplate',async key=>{
        const {BranchId,row}=await current(body);own(row);revision(row,body.Revision);
        const p=await preview(row,body.DateRange);
        if(!body.PreviewToken||body.PreviewToken!==p.Token)fail('Clinic availability changed since this preview. Preview the dates again.',409);
        const result={TemplateId:row.TemplateId,Created:p.Create,Existing:p.Existing,Conflicts:p.Conflicts};
        if(!p.Create)return {writes:[],result:{...result,Unchanged:true}};
        const ClinicianName=await clinician(row.Clinician,BranchId),writes=[];
        for(const entry of p.entries.filter(e=>e.Status==='Create')){
          const data={...availabilityFields({...row,Day:entry.Day},clock()),ScheduleId:entry.ScheduleId,BranchId,ClinicianName,
            TemplateId:row.TemplateId,TemplateReference:row.Reference,TemplateRevision:row.__updateTime,Bookings:[],CreatedAt:clock(),...stamp()};
          const eventKey=await keyFor(key,entry.Day),{Bookings,...snapshot}=data;
          writes.push(write('AppointmentSchedules',entry.ScheduleId,data,null),write('AppointmentScheduleEvents',eventKey,{...snapshot,BookedCount:0,Revision:'',EventId:eventKey,CreatedAt:clock()},null));
        }
        // One conditional template write prevents an edit/deactivation racing generation.
        const next={...strip(row),LastGeneratedAt:clock(),LastGeneratedRange:body.DateRange,...stamp()};
        writes.push(write('ClinicTemplates',row.TemplateId,next,row),event(key,next,'Clinic days generated',{DateRange:body.DateRange,...result,
          ScheduleIds:p.entries.filter(e=>e.Status==='Create').map(e=>e.ScheduleId)}),auditWrite(key,'Generate recurring clinic days',BranchId,{},result));
        return {writes,result};
      });
    },
    async clinicTemplateHistory(body){
      requireCapability('appointments.read');const BranchId=await branch(body),TemplateId=id(body.TemplateId);
      const r=await scopedPage('ClinicTemplateEvents',[eq('BranchId',BranchId),eq('TemplateId',TemplateId),...dateFilters(body.DateRange)],'CreatedAt',body);
      return {ok:true,entries:r.rows.map(view),next:r.next};
    }
  };
}
