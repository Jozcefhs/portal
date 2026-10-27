import {clean,fail,id,digest,stable,patientSummary,patientName} from './hospital-model.js';
import {field,quantity,qty,dateFilters,allergySnapshot,watDay} from './hospital-orders-model.js';
import {assignedStaffBranches} from './staff-branch-access.js';
import {nursingTime,nursingChart,handoverFields,NURSING_OUTCOMES} from './hospital-nursing-model.js';

export function createHospitalNursingService(ctx){
  const {env,user,db,collection,requireCapability,branch,patient,clock,actor,condition,strip,eq,auditWrite,auditRead,operation,page}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const view=row=>row?{...strip(row),Revision:row.__updateTime}:null;
  const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
  const stamp=()=>({RecordedAt:clock(),RecordedBy:actor,RecordedByName:clean(user.displayName)||actor});
  const revision=(row,value)=>{if(clean(value)!==clean(row?.__updateTime))fail('This nursing record changed. Refresh before continuing.',409);};
  const confirm=body=>{if(body.ConfirmPatient!==true)fail('Confirm the patient and hospital number.');};
  const owns=row=>{if(row.RecordedBy!==actor&&user.role!=='Medical Director')fail('Only the original author or Medical Director may correct this record.',403);};
  async function current(body,writing=false,closed=false){
    const BranchId=await branch(body),admission=await read('Admissions',body.AdmissionId);
    if(!admission||admission.BranchId!==BranchId)fail('Choose an admission in this branch.',404);
    if(admission.PatientId!==clean(body.PatientId))fail('The patient does not match this admission.',409);
    const [person,visit,care]=await Promise.all([patient(admission.PatientId,BranchId),read('Visits',admission.VisitId),read('CareSummaries',admission.PatientId)]);
    if(!visit||visit.PatientId!==person.PatientId||visit.BranchId!==BranchId||visit.AdmissionId!==admission.AdmissionId||care&&care.PatientId!==person.PatientId)fail('Review this admission’s patient and visit references.',409);
    if(writing){
      confirm(body);revision(admission,body.AdmissionRevision);revision(visit,body.VisitRevision);
      if(!closed&&(admission.Status!=='Admitted'||!['Waiting','In progress'].includes(visit.Status)))fail('This admission is closed. Only attributable corrections and handover acknowledgements remain available.',409);
    }
    return {BranchId,admission,person,visit,care};
  }
  const scope=c=>({AdmissionId:c.admission.AdmissionId,PatientId:c.person.PatientId,VisitId:c.visit.VisitId,BranchId:c.BranchId,
    PatientName:patientName(c.person),HospitalNumber:c.person.HospitalNumber,WardId:c.admission.WardId,WardName:c.admission.WardName,BedName:c.admission.BedName});
  function touch(c,key){
    return [write('Admissions',c.admission.AdmissionId,{...strip(c.admission),LastNursingEventId:key},c.admission),
      ...(c.admission.Status==='Admitted'?[write('Visits',c.visit.VisitId,{...strip(c.visit),LastNursingEventId:key,DischargeApprovalId:''},c.visit)]:[])];
  }
  function event(key,c,Type,RecordId,Snapshot,Reason=''){
    return write('NursingEvents',key,{EventId:key,...scope(c),Type,RecordId,Snapshot,Reason,CreatedAt:clock(),...stamp()},null);
  }
  const result=(c,extra={})=>({AdmissionId:c.admission.AdmissionId,PatientId:c.person.PatientId,...extra});
  function belongs(row,c,label){if(!row||row.AdmissionId!==c.admission.AdmissionId||row.PatientId!==c.person.PatientId||row.BranchId!==c.BranchId)fail(`Choose ${label} for this admission.`,404);}
  async function orderFor(c,OrderId){
    const order=await read('Orders',OrderId);
    if(!order||order.BranchId!==c.BranchId||order.PatientId!==c.person.PatientId||order.VisitId!==c.visit.VisitId||order.Kind!=='Prescription')fail('Choose a prescription for this patient’s visit.',404);
    return order;
  }
  function validOrder(order){if(order.Status==='Cancelled'||order.Status==='On hold'||order.PharmacyReview==='On hold')fail('This prescription is cancelled or on hold. Ask the clinician or pharmacist to review it.',409);}
  const publicSupply=row=>({DispenseId:row.DispenseId,BatchNumber:row.BatchNumber,ExpiryDate:row.ExpiryDate,Quantity:row.Quantity,ReturnedQuantity:row.ReturnedQuantity||0,
    AdministeredQuantity:row.AdministeredQuantity||0,Unit:row.Unit,CreatedAt:row.CreatedAt,Revision:row.__updateTime});
  async function supplyFor(c,order,key){
    const row=await read('Dispenses',key);
    if(!row||row.OrderId!==order.OrderId||row.PatientId!==c.person.PatientId||row.BranchId!==c.BranchId)fail('Choose dispensed supply for this prescription and patient.',404);
    return row;
  }
  return {
    async nursingContext(body){
      requireCapability('nursing.read');const c=await current(body);
      await auditRead(body,'View inpatient nursing record',c.BranchId,c.person,{AdmissionId:c.admission.AdmissionId});
      return {ok:true,actorUsername:actor,canCorrectAny:user.role==='Medical Director',patient:patientSummary(c.person),admission:view(c.admission),visit:view(c.visit),care:view(c.care)||{AllergyStatus:'Unknown',Allergies:'',Revision:''}};
    },
    async nursingRegister(body){
      requireCapability('nursing.read');const maps={Charts:['NursingCharts','ObservedAt'],Doses:['MedicationDoses','DueAt'],Handovers:['NursingHandovers','ShiftStart'],History:['NursingEvents','CreatedAt']};
      const def=maps[body.Kind];if(!def)fail('Choose a nursing register.');const dates=dateFilters(body.DateRange,def[1]),c=await current(body);
      const rows=await page(def[0],[eq('BranchId',c.BranchId),eq('AdmissionId',c.admission.AdmissionId),...dates],def[1],body);
      await auditRead(body,`View dated nursing ${body.Kind.toLowerCase()}`,c.BranchId,c.person,{AdmissionId:c.admission.AdmissionId,DateRange:body.DateRange,ResultCount:rows.rows.length});
      return {ok:true,entries:rows.rows.map(view),next:rows.next};
    },
    async saveNursingChart(body){
      requireCapability('nursing.write');await branch(body);const fields=nursingChart(body.Chart,clock());
      return operation(body,'saveNursingChart',async key=>{
        const c=await current(body,true,Boolean(body.ChartId));
        if(fields.ObservedAt<c.admission.CreatedAt||c.admission.DischargedAt&&fields.ObservedAt>c.admission.DischargedAt)fail('The observation must fall within this admission.');
        const ChartId=await digest(JSON.stringify([c.admission.AdmissionId,fields.Kind,fields.ObservedAt]));
        const old=await read('NursingCharts',ChartId);let Reason='';
        if(body.ChartId){if(body.ChartId!==ChartId)fail('Keep the original chart type and observation time when correcting it.');belongs(old,c,'a chart');revision(old,body.Revision);owns(old);
          if(same(old.Content,fields))return {writes:[],result:{...result(c,{ChartId}),Unchanged:true}};Reason=field(body,'Reason',1000,true);
        }else if(old)fail('A chart already exists for this type and observation time. Open it to record a correction.',409);
        const row={...(old?strip(old):scope(c)),ChartId,Content:fields,ObservedAt:fields.ObservedAt,CreatedAt:old?.CreatedAt||clock(),...stamp(),OriginalAuthor:old?.OriginalAuthor||actor};
        return {writes:[...touch(c,key),write('NursingCharts',ChartId,row,old),event(key,c,old?'Correct nursing chart':'Record nursing chart',ChartId,row,Reason),
          auditWrite(key,old?'Correct nursing chart':'Record nursing chart',c.BranchId,c.person,{AdmissionId:c.admission.AdmissionId,ChartId})],result:result(c,{ChartId})};
      });
    },
    async nursingPrescriptions(body){
      requireCapability('nursing.read');const dates=dateFilters(body.DateRange),c=await current(body);
      const rows=await page('Orders',[eq('BranchId',c.BranchId),eq('VisitId',c.visit.VisitId),eq('Kind','Prescription'),...dates],'CreatedAt',body);
      await auditRead(body,'View nursing prescriptions',c.BranchId,c.person,{AdmissionId:c.admission.AdmissionId,DateRange:body.DateRange});
      return {ok:true,orders:rows.rows.map(row=>({OrderId:row.OrderId,Fields:row.Fields,Status:row.Status,CreatedAt:row.CreatedAt,PrescriberName:row.PrescriberName})),next:rows.next};
    },
    async nursingMedication(body){
      requireCapability('nursing.read');const c=await current(body),dose=body.DoseId?await read('MedicationDoses',body.DoseId):null;
      if(body.DoseId)belongs(dose,c,'a medication dose');const order=await orderFor(c,dose?.OrderId||body.OrderId);
      await auditRead(body,'View nursing medication instructions',c.BranchId,c.person,{AdmissionId:c.admission.AdmissionId,OrderId:order.OrderId});
      return {ok:true,order:view(order),dose:view(dose)};
    },
    async nursingSupplies(body){
      requireCapability('nursing.read');const dates=dateFilters(body.DateRange),c=await current(body),order=await orderFor(c,body.OrderId);
      const rows=await page('Dispenses',[eq('BranchId',c.BranchId),eq('OrderId',order.OrderId),...dates],'CreatedAt',body);
      await auditRead(body,'View nursing dispensed supply',c.BranchId,c.person,{OrderId:order.OrderId,DateRange:body.DateRange});
      return {ok:true,supplies:rows.rows.map(publicSupply),next:rows.next};
    },
    async planMedicationDose(body){
      requireCapability('nursing.write');await branch(body);const DueAt=nursingTime(body.DueAt,clock(),{future:true});
      return operation(body,'planMedicationDose',async key=>{
        const c=await current(body,true),order=await orderFor(c,body.OrderId);validOrder(order);revision(order,body.OrderRevision);
        if(DueAt<c.admission.CreatedAt||Date.parse(DueAt)>Date.parse(clock())+31*86400000)fail('Choose a dose time within this admission and the next 31 days.');
        if(!DueAt.endsWith(':00.000Z'))fail('Choose a dose time to the minute.');
        const DoseId=await digest(JSON.stringify([c.admission.AdmissionId,order.OrderId,DueAt]));
        if(await read('MedicationDoses',DoseId))fail('This prescription already has a dose at this time. Open the existing entry.',409);
        const row={...scope(c),DoseId,OrderId:order.OrderId,Prescription:order.Fields,Prescriber:order.PrescriberName,DueAt,Status:'Pending',CreatedAt:clock(),...stamp()};
        return {writes:[...touch(c,key),write('MedicationDoses',DoseId,row,null),event(key,c,'Plan medication dose',DoseId,row),auditWrite(key,'Plan medication dose',c.BranchId,c.person,{DoseId})],result:result(c,{DoseId})};
      });
    },
    async recordMedicationDose(body){
      requireCapability('nursing.write');await branch(body);const Outcome=body.Outcome;
      if(!NURSING_OUTCOMES.includes(Outcome))fail('Choose a medication administration outcome.');
      const AdministeredAt=nursingTime(body.AdministeredAt,clock()),Note=field(body,'Note',2000,Outcome!=='Given'),Quantity=Outcome==='Given'?quantity(body.Quantity):0;
      return operation(body,'recordMedicationDose',async key=>{
        const c=await current(body,true,body.Correction===true),dose=await read('MedicationDoses',body.DoseId);belongs(dose,c,'a dose');revision(dose,body.Revision);
        const correction=dose.Status!=='Pending';let Reason='';
        if(correction){if(body.Correction!==true)fail('This dose is already recorded. Use an attributable correction.',409);owns(dose);Reason=field(body,'Reason',1000,true);}
        else if(body.Correction===true)fail('This pending dose has no administration to correct.');
        if(AdministeredAt<c.admission.CreatedAt||c.admission.DischargedAt&&AdministeredAt>c.admission.DischargedAt)fail('The administration time must fall within this admission.');
        const nextFields={Status:Outcome,AdministeredAt,Quantity,DispenseId:Outcome==='Given'?id(body.DispenseId):'',Note};
        if(correction&&same(Object.fromEntries(Object.keys(nextFields).map(k=>[k,dose[k]])),nextFields))return {writes:[],result:{...result(c,{DoseId:dose.DoseId}),Unchanged:true}};
        const order=await orderFor(c,dose.OrderId),supplies=new Map();
        if(dose.Status==='Given')supplies.set(dose.DispenseId,await supplyFor(c,order,dose.DispenseId));
        if(Outcome==='Given'){
          if(body.ConfirmMedicationReview!==true)fail('Confirm the prescription, patient, dose, route, time, allergies and supplied medicine.');
          revision(c.care,body.CareRevision);revision(order,body.OrderRevision);validOrder(order);
          if(order.PharmacyReview!=='Approved'||order.ReviewedAllergies!==await digest(JSON.stringify(allergySnapshot(c.care))))fail('A pharmacist must review this prescription against the current allergy information.',409);
          if(!supplies.has(body.DispenseId))supplies.set(body.DispenseId,await supplyFor(c,order,body.DispenseId));
          const supply=supplies.get(body.DispenseId);revision(supply,body.DispenseRevision);
          if(AdministeredAt<supply.CreatedAt)fail('The recorded administration precedes this dispensing entry. Choose the supply actually used.',409);
          if(supply.ExpiryDate<=watDay(AdministeredAt))fail('This supplied batch was expired at the recorded administration time.',409);
        }
        const updates=[];
        for(const [sid,supply] of supplies){
          const used=qty((supply.AdministeredQuantity||0)-(dose.Status==='Given'&&dose.DispenseId===sid?dose.Quantity:0)+(Outcome==='Given'&&body.DispenseId===sid?Quantity:0));
          if(used<0||used>qty(supply.Quantity-(supply.ReturnedQuantity||0)))fail('Administration exceeds the remaining dispensed supply, or a correction conflicts with a return.',409);
          if(used!==(supply.AdministeredQuantity||0))updates.push(write('Dispenses',sid,{...strip(supply),AdministeredQuantity:used},supply));
        }
        const supplied=Outcome==='Given'?supplies.get(body.DispenseId):null;
        const row={...strip(dose),...nextFields,...stamp(),AllergySnapshot:allergySnapshot(c.care),AdministrationLocation:dose.AdministrationLocation||{WardId:c.admission.WardId,WardName:c.admission.WardName,BedName:c.admission.BedName},SupplySnapshot:supplied?{BatchNumber:supplied.BatchNumber,ExpiryDate:supplied.ExpiryDate,Unit:supplied.Unit}:null,LastEventId:key};
        return {writes:[...touch(c,key),...updates,write('MedicationDoses',dose.DoseId,row,dose),
          write('CareSummaries',c.person.PatientId,{...strip(c.care),PatientId:c.person.PatientId,AllergyStatus:c.care?.AllergyStatus||'Unknown',Allergies:c.care?.Allergies||'',LastAdministrationEventId:key},c.care),
          event(key,c,correction?'Correct medication administration':'Record medication administration',dose.DoseId,row,Reason),auditWrite(key,correction?'Correct medication administration':'Record medication administration',c.BranchId,c.person,{DoseId:dose.DoseId})],result:result(c,{DoseId:dose.DoseId})};
      });
    },
    async saveNursingHandover(body){
      requireCapability('nursing.write');await branch(body);const fields=handoverFields(body.Handover,clock());
      if(fields.Recipient===actor.toLowerCase())fail('Choose a different receiving officer.');
      return operation(body,'saveNursingHandover',async key=>{
        const c=await current(body,true),HandoverId=await digest(JSON.stringify([c.admission.AdmissionId,fields.ShiftStart,fields.ShiftEnd]));
        if(fields.ShiftEnd<c.admission.CreatedAt)fail('The handover shift must overlap this admission.');
        const old=await read('NursingHandovers',HandoverId);let Reason='';
        if(body.HandoverId){if(body.HandoverId!==HandoverId)fail('Keep the original shift dates when revising a handover.');belongs(old,c,'a handover');revision(old,body.Revision);owns(old);
          if(same(old.Content,fields))return {writes:[],result:{...result(c,{HandoverId}),Unchanged:true}};
          if(old.Status==='Acknowledged')fail('An acknowledged handover is retained. Record a new handover for the next shift.',409);Reason=field(body,'Reason',1000,true);
        }else if(old)fail('A handover already exists for this admission and shift. Open it to revise.',409);
        const users=await db.queryCollection(env,'staffUsers',{filters:[eq('UsernameKey',fields.Recipient)],limit:2});
        const recipient=users[0],assigned=recipient?assignedStaffBranches(recipient):[];
        if(users.length!==1||clean(recipient.Username).toLowerCase()!==fields.Recipient||!['Nurse','Doctor','Medical Director'].includes(recipient.Role)
          ||!['true','yes','1'].includes(String(recipient.Active??true).toLowerCase())||clean(recipient.OrganisationEdition||recipient.OrganizationEdition).toLowerCase()!=='hospital'
          ||assigned!==null&&!assigned.includes(c.BranchId))fail('Choose an active clinical officer assigned to this Hospital branch.',400);
        const row={...scope(c),HandoverId,Content:fields,Recipient:fields.Recipient,RecipientName:clean(recipient.DisplayName)||fields.Recipient,
          ShiftStart:fields.ShiftStart,ShiftEnd:fields.ShiftEnd,Status:'Awaiting acknowledgement',AllergySnapshot:allergySnapshot(c.care),CreatedAt:old?.CreatedAt||clock(),...stamp()};
        return {writes:[...touch(c,key),write('NursingHandovers',HandoverId,row,old),event(key,c,old?'Revise nursing handover':'Send nursing handover',HandoverId,row,Reason),
          auditWrite(key,old?'Revise nursing handover':'Send nursing handover',c.BranchId,c.person,{HandoverId})],result:result(c,{HandoverId})};
      });
    },
    async acknowledgeNursingHandover(body){
      requireCapability('nursing.write');await branch(body);const Note=field(body,'Note',2000,true);
      if(!['Acknowledged','Clarification requested'].includes(body.Decision))fail('Acknowledge receipt or request clarification.');
      return operation(body,'acknowledgeNursingHandover',async key=>{
        const c=await current(body,true,true),row=await read('NursingHandovers',body.HandoverId);belongs(row,c,'a handover');revision(row,body.Revision);
        if(row.Recipient!==actor.toLowerCase()||row.RecordedBy===actor)fail('Only the named receiving officer can acknowledge this handover.',403);
        if(row.Status!=='Awaiting acknowledgement')fail('This version has already received a response. Ask the sender to revise it if needed.',409);
        const next={...strip(row),Status:body.Decision,ResponseNote:Note,RespondedBy:actor,RespondedByName:clean(user.displayName)||actor,RespondedAt:clock()};
        return {writes:[...touch(c,key),write('NursingHandovers',row.HandoverId,next,row),event(key,c,'Respond to nursing handover',row.HandoverId,next),auditWrite(key,'Respond to nursing handover',c.BranchId,c.person,{HandoverId:row.HandoverId})],result:result(c,{HandoverId:row.HandoverId})};
      });
    },
    async nursingInbox(body){
      requireCapability('nursing.read');const dates=dateFilters(body.DateRange,'ShiftStart'),BranchId=await branch(body);
      const rows=await page('NursingHandovers',[eq('BranchId',BranchId),eq('Recipient',actor.toLowerCase()),...dates],'ShiftStart',body);
      await auditRead(body,'View dated incoming nursing handovers',BranchId,{}, {DateRange:body.DateRange,ResultCount:rows.rows.length});
      return {ok:true,entries:rows.rows.map(view),next:rows.next};
    }
  };
}
