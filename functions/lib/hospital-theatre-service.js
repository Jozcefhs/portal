import {clean,fail,id,digest,stable,patientSummary,patientName} from './hospital-model.js';
import {field,dateFilters,allergySnapshot} from './hospital-orders-model.js';
import {assignedStaffBranches} from './staff-branch-access.js';
import {bookingFields,bookingDays,theatreReference,theatreNote} from './hospital-theatre-model.js';

export function createHospitalTheatreService(ctx){
  const {env,user,db,collection,capabilities,requireCapability,branch,patient,clock,actor,condition,strip,eq,auditWrite,auditRead,operation,page}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const view=row=>row?{...strip(row),Revision:row.__updateTime}:null;
  const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
  const stamp=()=>({RecordedAt:clock(),RecordedBy:actor,RecordedByName:clean(user.displayName)||actor});
  const revision=(row,value)=>{if(clean(row?.__updateTime)!==clean(value))fail('This procedure record changed. Refresh before saving.',409);};
  const confirm=body=>{if(body.ConfirmPatient!==true)fail('Confirm the patient and hospital number.');};
  const active=visit=>['Waiting','In progress'].includes(visit.Status);
  const keyFor=(...parts)=>digest(JSON.stringify(parts));
  const result=c=>({CaseId:c.row.CaseId,PatientId:c.person.PatientId,VisitId:c.visit.VisitId});
  function accessRooms(){if(!capabilities.includes('theatre.read')&&!capabilities.includes('theatre.configure'))fail('Your role cannot access theatre setup.',403);}
  async function roomFor(key,BranchId){const room=await read('Theatres',key);if(!room||room.BranchId!==BranchId)fail('Choose a theatre in this branch.',404);return room;}
  async function visitFor(body){
    const BranchId=await branch(body),visit=await read('Visits',body.VisitId);
    if(!visit||visit.BranchId!==BranchId||visit.PatientId!==body.PatientId)fail('Choose a visit for this patient and branch.',404);
    const [person,care]=await Promise.all([patient(visit.PatientId,BranchId),read('CareSummaries',visit.PatientId)]);
    if(care&&care.PatientId!==visit.PatientId)fail('Review the patient care reference.',409);
    return {BranchId,visit,person,care};
  }
  async function current(body,mutate=false,closed=false){
    const BranchId=await branch(body),row=await read('ProcedureCases',body.CaseId);
    if(!row||row.BranchId!==BranchId||row.PatientId!==body.PatientId)fail('Choose a procedure for this patient and branch.',404);
    const c={...await visitFor({...body,VisitId:row.VisitId}),row};
    if(mutate){confirm(body);revision(row,body.Revision);revision(c.visit,body.VisitRevision);if(!closed&&!active(c.visit))fail('This visit is closed. Only amendments or cancellation of an unstarted booking remain available.',409);}
    return c;
  }
  function touch(c,key,delta=0,extra={}){
    const PendingProcedureCount=Number(c.visit.PendingProcedureCount||0)+delta;
    if(!Number.isSafeInteger(PendingProcedureCount)||PendingProcedureCount<0)fail('Review this visit’s procedure count.',409);
    return write('Visits',c.visit.VisitId,{...strip(c.visit),PendingProcedureCount,LastProcedureEventId:key,DischargeApprovalId:'',...extra},c.visit);
  }
  function event(key,c,Type,Snapshot,Reason=''){
    return write('ProcedureEvents',key,{EventId:key,...result(c),BranchId:c.BranchId,Type,Snapshot,Reason,CreatedAt:clock(),...stamp()},null);
  }
  function audit(key,c,action){return auditWrite(key,action,c.BranchId,c.person,{CaseId:c.row.CaseId,VisitId:c.visit.VisitId});}
  async function clinician(username,BranchId){
    const rows=await db.queryCollection(env,'staffUsers',{filters:[eq('UsernameKey',username)],limit:2}),u=rows[0],assigned=u?assignedStaffBranches(u):[];
    if(rows.length!==1||clean(u.Username).toLowerCase()!==username||!['Doctor','Medical Director'].includes(u.Role)
      ||!['true','yes','1'].includes(String(u.Active??true).toLowerCase())||clean(u.OrganisationEdition||u.OrganizationEdition).toLowerCase()!=='hospital'
      ||assigned!==null&&!assigned.includes(BranchId))fail('Choose an active Doctor or Medical Director assigned to this branch.');
    return clean(u.DisplayName)||username;
  }
  // Exact resource/day documents serialize bookings; no historical overlap scan.
  async function reservations(old,next){
    const definitions=new Map();
    for(const row of [old,next].filter(Boolean))for(const day of bookingDays(row))for(const resource of [`room:${row.TheatreId}`,`patient:${row.PatientId}`,`clinician:${row.LeadClinician}`])definitions.set(JSON.stringify([resource,day]),{resource,day});
    // Patient/clinician locks span branches. Read each distinct day/resource once.
    const maps=await Promise.all([...definitions.values()].map(async item=>{const key=await keyFor('booking',item.resource,item.day);return [key,{...item,old:await read('TheatreReservations',key)}];}));
    return [...maps].map(([key,item])=>{
      const entries=(item.old?.Entries||[]).filter(e=>e.CaseId!==old?.CaseId);
      if(next&&bookingDays(next).includes(item.day)&&[`room:${next.TheatreId}`,`patient:${next.PatientId}`,`clinician:${next.LeadClinician}`].includes(item.resource)){
        if(entries.some(e=>e.StartAt<next.EndAt&&e.EndAt>next.StartAt))fail('The room, patient or lead clinician already has an overlapping booking. Choose another time.',409);
        if(entries.length>=96)fail('This resource has reached its daily booking limit. Choose another day.',409);
        entries.push({CaseId:next.CaseId,StartAt:next.StartAt,EndAt:next.EndAt});
      }
      return write('TheatreReservations',key,{Resource:item.resource,Day:item.day,Entries:entries},item.old);
    });
  }
  async function clinicalLock(c,key){return write('CareSummaries',c.person.PatientId,{...strip(c.care),PatientId:c.person.PatientId,AllergyStatus:c.care?.AllergyStatus||'Unknown',Allergies:c.care?.Allergies||'',LastProcedureReviewId:key},c.care);}
  async function activeResources(c,release=false){
    return Promise.all([`patient:${c.person.PatientId}`,`clinician:${c.row.LeadClinician}`].map(async resource=>{
      const key=await keyFor('active',resource),old=await read('TheatreActiveResources',key);
      if(release?old?.CaseId!==c.row.CaseId:!!old?.CaseId)fail('The patient or lead clinician has another active procedure, or its occupancy changed.',409);
      return write('TheatreActiveResources',key,{Resource:resource,CaseId:release?'':c.row.CaseId},old);
    }));
  }
  return {
    async theatreRooms(body){accessRooms();const BranchId=await branch(body),r=await page('Theatres',[eq('BranchId',BranchId)],'Code',body);return {ok:true,rooms:r.rows.map(row=>{const {ActiveCaseId,...publicRow}=view(row);return {...publicRow,Occupied:!!ActiveCaseId};}),next:r.next};},
    async saveTheatreRoom(body){
      requireCapability('theatre.configure');const BranchId=await branch(body),Code=theatreReference(body.Room?.Code),Name=field(body.Room,'Name',160,true),Active=body.Room?.Active===true;
      return operation(body,'saveTheatreRoom',async key=>{
        const TheatreId=await keyFor('theatre',BranchId,Code),old=await read('Theatres',TheatreId);if(old)revision(old,body.Revision);
        if(body.TheatreId&&body.TheatreId!==TheatreId)fail('Theatre codes cannot be changed.');
        if(old&&old.Name===Name&&old.Active===Active)return {writes:[],result:{TheatreId,Unchanged:true}};
        if(old?.ActiveCaseId&&!Active)fail('This theatre is occupied.',409);
        const row={...strip(old),TheatreId,BranchId,Code,Name,Active,Ready:old?.Ready??false,CreatedAt:old?.CreatedAt||clock(),...stamp()};
        return {writes:[write('Theatres',TheatreId,row,old),write('TheatreVersions',key,{...row,VersionId:key},null),auditWrite(key,'Save theatre',BranchId)],result:{TheatreId}};
      });
    },
    async prepareTheatre(body){
      requireCapability('theatre.work');const BranchId=await branch(body);if(body.ConfirmReady!==true)fail('Confirm the theatre has been prepared.');
      return operation(body,'prepareTheatre',async key=>{const room=await roomFor(body.TheatreId,BranchId);revision(room,body.Revision);if(room.ActiveCaseId||!room.Active)fail('This theatre is occupied or inactive.',409);
        if(room.Ready)return {writes:[],result:{Unchanged:true}};const next={...strip(room),Ready:true,...stamp()};
        return {writes:[write('Theatres',room.TheatreId,next,room),write('TheatreVersions',key,{...next,VersionId:key},null),auditWrite(key,'Confirm theatre preparation',BranchId)],result:{TheatreId:room.TheatreId}};});
    },
    async theatreVisit(body){requireCapability('theatre.read');const c=await visitFor(body);await auditRead(body,'View procedure visit',c.BranchId,c.person);return {ok:true,patient:patientSummary(c.person),visit:view(c.visit),care:view(c.care)};},
    async saveProcedureBooking(body){
      requireCapability('theatre.schedule');await branch(body);const fields=bookingFields(body.Booking,clock());confirm(body);
      return operation(body,'saveProcedureBooking',async key=>{
        const c=await visitFor(body);revision(c.visit,body.VisitRevision);if(!active(c.visit))fail('Choose an open visit.',409);
        const CaseId=await keyFor('procedure',c.visit.VisitId,fields.Reference),old=await read('ProcedureCases',CaseId);
        if(body.CaseId){if(body.CaseId!==CaseId||!old)fail('Keep the original procedure reference.');revision(old,body.Revision);if(old.Status!=='Scheduled')fail('Only an unstarted booking may be rescheduled.',409);}
        else if(old)fail('This procedure reference already exists for the visit. Open that record.',409);
        const room=await roomFor(body.TheatreId,c.BranchId);if(!room.Active)fail('This theatre is inactive.',409);
        if(old&&old.TheatreId===room.TheatreId&&same(Object.fromEntries(Object.keys(fields).map(k=>[k,old[k]])),fields))return {writes:[],result:{CaseId,Unchanged:true}};
        const Reason=old?field(body,'Reason',1000,true):'',LeadClinicianName=await clinician(fields.LeadClinician,c.BranchId);
        const row={...strip(old),...fields,CaseId,TheatreId:room.TheatreId,TheatreName:room.Name,LeadClinicianName,PatientId:c.person.PatientId,VisitId:c.visit.VisitId,
          AdmissionId:c.visit.AdmissionId||'',BranchId:c.BranchId,PatientName:patientName(c.person),HospitalNumber:c.person.HospitalNumber,Status:'Scheduled',PreoperativeId:'',Preoperative:null,CreatedAt:old?.CreatedAt||clock(),...stamp()};c.row=row;
        return {writes:[...await reservations(old,row),touch(c,key,old?0:1),write('Theatres',room.TheatreId,{...strip(room),LastBookingId:key},room),
          write('ProcedureCases',CaseId,row,old),event(key,c,old?'Reschedule procedure':'Book procedure',row,Reason),audit(key,c,old?'Reschedule procedure':'Book procedure')],result:result(c)};
      });
    },
    async theatreRegister(body){requireCapability('theatre.read');const dates=dateFilters(body.DateRange,'StartAt'),BranchId=await branch(body);
      const r=await page('ProcedureCases',[eq('BranchId',BranchId),...dates,...(body.VisitId?[eq('VisitId',id(body.VisitId))]:[])],'StartAt',body);
      await auditRead(body,'View dated procedure register',BranchId,{}, {DateRange:body.DateRange,ResultCount:r.rows.length});return {ok:true,cases:r.rows.map(view),next:r.next};},
    async theatreCase(body){requireCapability('theatre.read');const c=await current(body),room=await roomFor(c.row.TheatreId,c.BranchId);
      await auditRead(body,'View procedure record',c.BranchId,c.person,{CaseId:c.row.CaseId});return {ok:true,actorUsername:actor,canAmendAny:user.role==='Medical Director',procedure:view(c.row),patient:patientSummary(c.person),visit:view(c.visit),care:view(c.care),room:view(room)};},
    async theatreHistory(body){requireCapability('theatre.read');const dates=dateFilters(body.DateRange),c=await current(body),r=await page('ProcedureEvents',[eq('BranchId',c.BranchId),eq('CaseId',c.row.CaseId),...dates],'CreatedAt',body);
      await auditRead(body,'View dated procedure history',c.BranchId,c.person,{CaseId:c.row.CaseId,DateRange:body.DateRange});return {ok:true,entries:r.rows.map(view),next:r.next};},
    async cancelProcedure(body){requireCapability('theatre.schedule');await branch(body);const Reason=field(body,'Reason',1000,true);
      return operation(body,'cancelProcedure',async key=>{const c=await current(body,true,true);if(c.row.Status!=='Scheduled')fail('Only an unstarted procedure can be cancelled. Record an operative outcome for a started procedure.',409);
        const row={...strip(c.row),Status:'Cancelled',CancelledAt:clock(),CancellationReason:Reason,...stamp()};
        return {writes:[...await reservations(c.row,null),touch(c,key,-1),write('ProcedureCases',row.CaseId,row,c.row),event(key,c,'Cancel procedure',row,Reason),audit(key,c,'Cancel procedure')],result:result(c)};});},
    async recordProcedurePreoperative(body){requireCapability('theatre.work');await branch(body);const Content=theatreNote('Preoperative',body.Note);
      if(body.ConfirmChecks!==true)fail('Confirm identity, consent, procedure/site, allergies and preparation with the team.');
      return operation(body,'recordProcedurePreoperative',async key=>{const c=await current(body,true);revision(c.care,body.CareRevision);if(c.row.Status!=='Scheduled')fail('Preoperative checks require an unstarted procedure.',409);
        const AllergySnapshot=allergySnapshot(c.care),AllergyFingerprint=await digest(JSON.stringify(AllergySnapshot));
        if(c.row.PreoperativeId&&same(c.row.Preoperative?.Content,Content)&&c.row.Preoperative.AllergyFingerprint===AllergyFingerprint)return {writes:[],result:{...result(c),Unchanged:true}};
        const Reason=c.row.PreoperativeId?field(body,'Reason',1000,true):'';
        const Preoperative={Content,AllergySnapshot,AllergyFingerprint,...stamp()},row={...strip(c.row),PreoperativeId:key,Preoperative};
        return {writes:[touch(c,key),await clinicalLock(c,key),write('ProcedureCases',row.CaseId,row,c.row),event(key,c,'Record preoperative checks',Preoperative,Reason),audit(key,c,'Record preoperative checks')],result:result(c)};});},
    async startProcedure(body){requireCapability('theatre.sign');await branch(body);if(body.ConfirmTimeOut!==true)fail('Record the team time-out confirmation before starting.');
      return operation(body,'startProcedure',async key=>{const c=await current(body,true);revision(c.care,body.CareRevision);const room=await roomFor(c.row.TheatreId,c.BranchId);
        if(c.row.Status!=='Scheduled'||!c.row.PreoperativeId)fail('Complete the preoperative checks before starting this scheduled procedure.',409);
        if(c.row.LeadClinician!==actor.toLowerCase()&&user.role!=='Medical Director')fail('The named lead clinician or Medical Director must start this procedure.',403);
        if(!room.Active||!room.Ready||room.ActiveCaseId||c.visit.ActiveProcedureCaseId)fail('The theatre or patient is not available for a procedure.',409);
        if(clock()<c.row.StartAt||clock()>=c.row.EndAt)fail('Adjust the booking to the actual operating window before starting.',409);
        if(c.row.Preoperative.AllergyFingerprint!==await digest(JSON.stringify(allergySnapshot(c.care))))fail('Allergy information changed. Repeat the preoperative review.',409);
        const row={...strip(c.row),AdmissionId:c.visit.AdmissionId||c.row.AdmissionId||'',Status:'In procedure',StartedAt:clock(),StartedBy:actor,TimeOut:{...stamp(),Confirmed:true}};
        return {writes:[...await activeResources(c),touch(c,key,0,{ActiveProcedureCaseId:row.CaseId}),await clinicalLock(c,key),write('Theatres',room.TheatreId,{...strip(room),ActiveCaseId:row.CaseId,Ready:false},room),
          write('ProcedureCases',row.CaseId,row,c.row),event(key,c,'Start procedure after time-out',row.TimeOut),audit(key,c,'Start procedure after time-out')],result:result(c)};});},
    async signProcedureOperative(body){requireCapability('theatre.sign');await branch(body);const Content=theatreNote('Operative',body.Note);
      if(body.ConfirmClinicalReview!==true)fail('Confirm the operative record and recovery plan.');
      return operation(body,'signProcedureOperative',async key=>{const c=await current(body,true);if(c.row.Status!=='In procedure')fail('Choose an active procedure.',409);
        if(c.row.LeadClinician!==actor.toLowerCase()&&user.role!=='Medical Director')fail('The lead clinician or Medical Director must sign the operative record.',403);
        const Operative={Content,...stamp()},row={...strip(c.row),Status:'Recovery',EndedAt:clock(),OperativeId:key,Operative};
        return {writes:[touch(c,key),write('ProcedureCases',row.CaseId,row,c.row),event(key,c,'Sign operative record',Operative),audit(key,c,'Sign operative record')],result:result(c)};});},
    async completeProcedureRecovery(body){requireCapability('theatre.work');await branch(body);const Content=theatreNote('Recovery',body.Note);
      if(body.ConfirmHandover!==true)fail('Confirm the patient has left the theatre and handover has occurred.');
      return operation(body,'completeProcedureRecovery',async key=>{const c=await current(body,true);if(c.row.Status!=='Recovery'||c.visit.ActiveProcedureCaseId!==c.row.CaseId)fail('Complete the operative record before recovery handover.',409);
        const room=await roomFor(c.row.TheatreId,c.BranchId);if(room.ActiveCaseId!==c.row.CaseId)fail('Review the theatre occupancy before handover.',409);
        const Recovery={Content,...stamp()},row={...strip(c.row),Status:'Completed',CompletedAt:clock(),RecoveryId:key,Recovery};
        return {writes:[...await reservations(c.row,null),...await activeResources(c,true),touch(c,key,-1,{ActiveProcedureCaseId:''}),write('Theatres',room.TheatreId,{...strip(room),ActiveCaseId:'',Ready:false},room),
          write('ProcedureCases',row.CaseId,row,c.row),event(key,c,'Complete recovery and handover',Recovery),audit(key,c,'Complete recovery and handover')],result:result(c)};});},
    async amendProcedureRecord(body){requireCapability('theatre.work');await branch(body);const Kind=body.Kind,Content=theatreNote(Kind,body.Note),Reason=field(body,'Reason',1000,true);
      if(Kind==='Operative')requireCapability('theatre.sign');
      return operation(body,'amendProcedureRecord',async key=>{const c=await current(body,true,true),previous=c.row[Kind];if(!previous)fail('Choose an existing signed procedure note.',404);
        if(previous.RecordedBy!==actor&&user.role!=='Medical Director')fail('Only the author or Medical Director may amend this note.',403);
        if(same(previous.Content,Content))return {writes:[],result:{...result(c),Unchanged:true}};
        if(Kind==='Preoperative'&&c.row.Status==='Scheduled')fail('Repeat the preoperative checks to replace the current review.');
        const amended={...previous,Content,...stamp()},row={...strip(c.row),[Kind]:amended,[`${Kind}Id`]:key};
        return {writes:[touch(c,key),write('ProcedureCases',row.CaseId,row,c.row),event(key,c,`Amend ${Kind.toLowerCase()} record`,amended,Reason),audit(key,c,`Amend ${Kind.toLowerCase()} record`)],result:result(c)};});}
  };
}
