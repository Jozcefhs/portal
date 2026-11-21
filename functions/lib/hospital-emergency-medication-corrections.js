import {digest,fail,id,clean} from './hospital-model.js';
import {field,quantity,qty,watDay} from './hospital-orders-model.js';
import {observationTime} from './hospital-clinical-model.js';

export function emergencyMedicationCorrections({env,db,collection,branch,requireCapability,operation,auditRead,auditWrite,actor,user,clock,condition,strip,page,emergencyReference,arrivalId}){
  const read=(name,key)=>db.getDocument(env,collection(name),key);
  const write=(name,key,data,prior)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(prior)});
  async function scope(body,branchId,ref){
    const rid=await arrivalId(branchId,ref);
    const band=await read('EmergencyArrivals',rid);
    if(!band || band.BranchId!==branchId || band.Reference!==ref)fail('Wristband unavailable in this branch.',404);
    if(band.Status==='Identified'){
      if(!band.PatientId || !band.VisitId || body.PatientId!==band.PatientId || body.VisitId!==band.VisitId)
        fail('Open the identified patient visit to correct this entry.',409);
    }else if(band.Status!=='Awaiting identification' || body.PatientId || body.VisitId)fail('Verify the selected wristband and visit.',409);
    const entry=await read('EmergencyCareEntries',id(body.EntryId));
    if(!entry || entry.Type!=='Medication administration' || entry.ArrivalId!==rid || entry.BranchId!==branchId || entry.Reference!==ref)
      fail('Choose the original medication administration for this wristband.',404);
    return {rid,band,entry,branchId,ref};
  }
  async function current(c){
    // Single-field index, newest signed version only. Older doses need no backfill.
    const prefix=c.entry.EntryId+'|';
    const [latest]=await db.queryCollection(env,collection('EmergencyCareEntries'),{filters:[
      {field:'DoseVersionKey',op:'>=',value:prefix},{field:'DoseVersionKey',op:'<',value:prefix+'~'}
    ],orderBy:[{field:'DoseVersionKey',direction:'DESCENDING'}],limit:1});
    if(latest && (latest.Type!=='Medication administration correction' || latest.OriginalEntryId!==c.entry.EntryId || latest.ArrivalId!==c.rid || latest.BranchId!==c.branchId || latest.OrderId!==c.entry.OrderId))
      fail('Review the signed correction linkage.',409);
    return latest||c.entry;
  }
  function belongs(supply,c){
    return supply && supply.OrderId===c.entry.OrderId && supply.BranchId===c.branchId && supply.PatientId===c.rid &&
      supply.EmergencyArrivalId===c.rid && supply.EmergencyReference===c.ref;
  }
  function authorised(){requireCapability('clinical.read');requireCapability('nursing.write');}
  return {
    async emergencyMedicationCorrection(body){
      requireCapability('clinical.read');
      if(body.LoadLots===true)requireCapability('nursing.write');
      const branchId=await branch(body),ref=emergencyReference(body.Reference);
      const c=await scope(body,branchId,ref);
      if(body.LoadLots===true){
        const result=await page('Dispenses',[{field:'BranchId',op:'==',value:branchId},{field:'OrderId',op:'==',value:c.entry.OrderId}],'CreatedAt',body);
        await auditRead(body,'Review dispensed lots for emergency correction',branchId,{PatientId:c.band.PatientId||''},{Reference:ref,EntryId:c.entry.EntryId});
        return {ok:true,lots:result.rows.filter(s=>belongs(s,c)).map(s=>({DispenseId:s.DispenseId,BatchNumber:s.BatchNumber,ExpiryDate:s.ExpiryDate})),next:result.next};
      }
      const last=await current(c);
      await auditRead(body,'Review emergency medication correction',branchId,{PatientId:c.band.PatientId||''},{Reference:ref,EntryId:c.entry.EntryId});
      return {ok:true,Version:last.EntryId,Content:last.Content,lots:last.Allocations,HospitalNumber:c.band.HospitalNumber||''};
    },
    async correctEmergencyMedication(body){
      authorised();const branchId=await branch(body),ref=emergencyReference(body.Reference);
      if(body.ConfirmedReference!==ref)fail('Confirm the wristband reference before signing.');
      const Reason=field(body,'Reason',2000,true),Note=field(body,'Note',2000);
      if(!Array.isArray(body.Lots) || body.Lots.length>30 || ((body.Lots.length===0)!==(body.ConfirmZero===true)))
        fail('Select the corrected lots or confirm that no dose was given.');
      const desired=new Map();
      for(const part of body.Lots){
        const key=id(part?.DispenseId);if(desired.has(key))fail('Each dispensing entry can appear only once.');
        desired.set(key,quantity(part.Quantity));
      }
      if(!body.ObservedAt)fail('Enter the administration time.');
      const observed=observationTime(body.ObservedAt,clock()),minute=Math.floor(Date.parse(observed)/60000);
      return operation(body,'correctEmergencyMedication',async key=>{
        const c=await scope(body,branchId,ref),last=await current(c);
        if(last.EntryId!==body.Version)fail('A newer version is available. Reload the entry before signing.',409);
        const priorLots=new Map(last.Allocations.map(l=>[l.DispenseId,l]));
        const changedTime=observed!==last.Content.ObservedAt;
        const changed=[...new Set([...priorLots.keys(),...desired.keys()])].filter(k=>(priorLots.get(k)?.Quantity||0)!==(desired.get(k)||0));
        if(!changed.length && !changedTime && Note===(last.Content.Note||''))return {writes:[],result:{EntryId:last.EntryId,Unchanged:true}};
        const now=clock();
        if(minute>Math.floor(Date.parse(c.band.IdentifiedAt||now)/60000))fail('Verify the time against the wristband care period.',409);
        const writes=[];
        if(desired.size && (changedTime || !priorLots.size)){
          const slot=await digest(JSON.stringify(['emergency-dose',c.rid,c.entry.OrderId,minute]));
          if(slot!==c.entry.EntryId){
            const existing=await read('EmergencyCareEntries',slot);
            if(existing && (existing.Type!=='Medication time reservation' || existing.OriginalEntryId!==c.entry.EntryId || existing.ArrivalId!==c.rid || existing.OrderId!==c.entry.OrderId))fail('Another administration already uses that time.',409);
            if(!existing)writes.push(write('EmergencyCareEntries',slot,{Type:'Medication time reservation',OriginalEntryId:c.entry.EntryId,
              OrderId:c.entry.OrderId,ArrivalId:c.rid,BranchId:branchId,Reference:ref},null));
          }
        }
        const ids=changedTime?[...new Set([...changed,...desired.keys()])]:changed;
        const supplies=await Promise.all(ids.map(k=>read('Dispenses',k)));
        const allocations=new Map(priorLots);
        for(const [i,k] of ids.entries()){
          const s=supplies[i];if(!belongs(s,c))fail('The selected dispensed lot does not belong to this wristband prescription.',409);
          const old=priorLots.get(k)?.Quantity||0,next=desired.get(k)||0,used=qty(s.AdministeredQuantity||0);
          const adjusted=qty(used+next-old);
          if(used<old || adjusted<0 || adjusted>qty(s.Quantity-(s.ReturnedQuantity||0)))fail('The corrected dose exceeds the remaining dispensed supply. Review the lot.',409);
          if(next && (Math.floor(Date.parse(s.CreatedAt)/60000)>minute || s.ExpiryDate<=watDay(observed)))fail('Verify the time against dispensing and expiry.',409);
          if(next)allocations.set(k,{DispenseId:k,BatchNumber:s.BatchNumber,ExpiryDate:s.ExpiryDate,Quantity:next});
          else allocations.delete(k);
          if(next!==old)writes.push(write('Dispenses',k,{...strip(s),AdministeredQuantity:adjusted},s));
        }
        const lots=[...allocations.values()],unit=c.entry.Content.Given.split(' ').slice(1).join(' ');
        const Given=qty(lots.reduce((total,l)=>total+l.Quantity,0))+' '+unit;
        const sequence=(c.band.CareSequence||0)+1,seq=String(sequence).padStart(12,'0');
        const content={OrderNumber:c.entry.Content.OrderNumber,Medicine:c.entry.Content.Medicine,PreviousQuantity:last.Content.Given,Given,
          PreviousBatches:last.Content.Batches,Batches:lots.map(l=>l.BatchNumber+' ('+l.Quantity+' '+unit+')').join(', ')||'None',
          PreviousTime:last.Content.ObservedAt,ObservedAt:observed,PreviousNote:last.Content.Note||'',Note,Reason};
        writes.push(write('EmergencyCareEntries',key,{EntryId:key,OriginalEntryId:c.entry.EntryId,PreviousEntryId:last.EntryId,
          Type:'Medication administration correction',BranchId:branchId,Reference:ref,ArrivalId:c.rid,OrderId:c.entry.OrderId,
          ...(c.band.PatientId?{PatientId:c.band.PatientId,VisitId:c.band.VisitId}:{}),
          DoseVersionKey:c.entry.EntryId+'|'+seq,TimelineKey:c.rid+'|'+seq,Sequence:sequence,Allocations:lots,Content:content,
          AuthorUsername:actor,AuthorName:clean(user.displayName)||actor,SignedAt:now},null),
          write('EmergencyArrivals',c.rid,{...strip(c.band),CareSequence:sequence},c.band),
          auditWrite(key,'Sign emergency medication correction',branchId,{PatientId:c.band.PatientId||''},{EntryId:key,OriginalEntryId:c.entry.EntryId,Reference:ref,OrderId:c.entry.OrderId}));
        return {writes,result:{EntryId:key,Sequence:sequence}};
      });
    }
  };
}
