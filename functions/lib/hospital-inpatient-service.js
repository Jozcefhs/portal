import {clean,fail,id,digest,patientName,patientSummary,stable} from './hospital-model.js';
import {inpatientText,inpatientCode,inpatientDates,dischargeFields} from './hospital-inpatient-model.js';

export function createHospitalInpatientService(context){
  const {env,user,db,collection,capabilities,requireCapability,branch,patient,clock,actor,condition,strip,eq,auditWrite,auditRead,operation,page}=context;
  const read=(name,key)=>db.getDocument(env,collection(name),key);
  const write=(name,key,data,previous)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(previous)});
  const view=row=>row?{...strip(row),Revision:row.__updateTime}:null;
  const version=(row,value)=>{if(clean(value)!==clean(row?.__updateTime))fail('This record changed. Refresh before saving.',409);};
  const confirm=body=>{if(body.ConfirmPatient!==true)fail('Confirm the patient and hospital number before continuing.');};
  const open=visit=>['Waiting','In progress'].includes(visit.Status);
  async function wardFor(wardId,branchId){
    const ward=await read('Wards',id(wardId));
    if(!ward||ward.BranchId!==branchId)fail('This ward is not available in the selected branch.',404);
    return ward;
  }
  async function bedFor(bedId,branchId){
    const bed=await read('Beds',id(bedId));
    if(!bed||bed.BranchId!==branchId)fail('This bed is not available in the selected branch.',404);
    return {bed,ward:await wardFor(bed.WardId,branchId)};
  }
  function available(bed,ward){
    if(!ward.Active||!bed.Active||bed.Ready===false)fail('This ward or bed is unavailable. Choose a bed that staff have marked ready.',409);
    if(bed.AdmissionId)fail('This bed is occupied. Refresh availability and choose another bed.',409);
  }
  async function visitFor(body,branchId){
    const visit=await read('Visits',id(body.VisitId));
    if(!visit||visit.BranchId!==branchId)fail('This visit is not available in the selected branch.',404);
    if(visit.PatientId!==clean(body.PatientId))fail('The selected patient does not match this visit.',409);
    return {visit,person:await patient(visit.PatientId,branchId)};
  }
  async function current(body,editable=false){
    const branchId=await branch(body),admission=await read('Admissions',id(body.AdmissionId));
    if(!admission||admission.BranchId!==branchId)fail('This admission is not available in the selected branch.',404);
    const {visit,person}=await visitFor({...body,VisitId:admission.VisitId},branchId);
    if(admission.PatientId!==person.PatientId)fail('Review the admission patient reference.',409);
    if(editable){
      version(admission,body.Revision);confirm(body);
      if(admission.Status!=='Admitted'||!open(visit)||visit.AdmissionId!==admission.AdmissionId)fail('This admission is no longer open. Refresh its record.',409);
    }
    return {branchId,admission,visit,person};
  }
  const changed=(row,fields)=>JSON.stringify(stable(fields))!==JSON.stringify(stable(Object.fromEntries(Object.keys(fields).map(k=>[k,row?.[k]]))));
  function movement(key,c,Type,extra={}){
    return write('AdmissionEvents',key,{EventId:key,AdmissionId:c.admission.AdmissionId,PatientId:c.person.PatientId,
      PatientName:patientName(c.person),HospitalNumber:c.person.HospitalNumber,VisitId:c.visit.VisitId,BranchId:c.branchId,
      Type,CreatedAt:clock(),Actor:actor,ActorName:clean(user.displayName)||actor,...extra},null);
  }
  function countWard(ward,delta){
    const count=Number(ward.OccupiedBeds||0)+delta;
    if(!Number.isSafeInteger(count)||count<0)fail('Review this ward’s occupancy before continuing.',409);
    return write('Wards',ward.WardId,{...strip(ward),OccupiedBeds:count,UpdatedAt:clock()},ward);
  }
  async function occupied(c){
    const {bed,ward}=await bedFor(c.admission.BedId,c.branchId),lock=await read('OpenAdmissions',c.person.PatientId);
    if(bed.AdmissionId!==c.admission.AdmissionId||lock?.AdmissionId!==c.admission.AdmissionId||bed.WardId!==c.admission.WardId)fail('The admission or bed assignment changed. Refresh before continuing.',409);
    return {bed,ward,lock};
  }
  return {
    async inpatientWards(body){
      requireCapability('inpatient.read');const branchId=await branch(body);
      const result=await page('Wards',[eq('BranchId',branchId)],'Code',body);
      return {ok:true,wards:result.rows.map(view),next:result.next};
    },
    async inpatientWard(body){
      requireCapability('inpatient.read');return {ok:true,ward:view(await wardFor(body.WardId,await branch(body)))};
    },
    async saveHospitalWard(body){
      requireCapability('inpatient.configure');const branchId=await branch(body),Code=inpatientCode(body.Ward?.Code);
      const fields={Code,Name:inpatientText(body.Ward?.Name,'ward name'),Active:body.Ward?.Active!==false};
      return operation(body,'saveHospitalWard',async key=>{
        const wardId=await digest(JSON.stringify([branchId,Code])),row=await read('Wards',wardId);
        if(body.WardId&&id(body.WardId)!==wardId)fail('Ward codes cannot be changed.');
        version(row,body.Revision);
        if(row&&!changed(row,fields))return {writes:[],result:{Unchanged:true,WardId:wardId}};
        if(!fields.Active&&row?.OccupiedBeds>0)fail('Transfer or discharge the patients before deactivating this ward.',409);
        const next={...strip(row),...fields,WardId:wardId,BranchId:branchId,OccupiedBeds:row?.OccupiedBeds||0,CreatedAt:row?.CreatedAt||clock(),UpdatedAt:clock(),UpdatedBy:actor};
        return {writes:[write('Wards',wardId,next,row),write('WardVersions',key,{...next,VersionId:key},null),auditWrite(key,'Save hospital ward',branchId,{}, {Subject:fields.Name})],result:{WardId:wardId}};
      });
    },
    async inpatientBeds(body){
      requireCapability('inpatient.read');const branchId=await branch(body),ward=await wardFor(body.WardId,branchId);
      const result=await page('Beds',[eq('BranchId',branchId),eq('WardId',ward.WardId)],'Code',body);
      await auditRead(body,'View ward bed occupancy',branchId,{}, {WardId:ward.WardId,Subject:ward.Name,ResultCount:result.rows.length});
      return {ok:true,ward:view(ward),beds:result.rows.map(view),next:result.next};
    },
    async saveHospitalBed(body){
      requireCapability('inpatient.configure');const branchId=await branch(body),Code=inpatientCode(body.Bed?.Code);
      const fields={Code,Name:inpatientText(body.Bed?.Name,'bed name'),Active:body.Bed?.Active!==false};
      return operation(body,'saveHospitalBed',async key=>{
        const ward=await wardFor(body.WardId,branchId),bedId=await digest(JSON.stringify([ward.WardId,Code])),row=await read('Beds',bedId);
        if(body.BedId&&id(body.BedId)!==bedId)fail('A bed’s ward and code cannot be changed. Create a different bed instead.');
        version(row,body.Revision);
        if(row&&!changed(row,fields))return {writes:[],result:{Unchanged:true,BedId:bedId}};
        if(!fields.Active&&row?.AdmissionId)fail('An occupied bed cannot be deactivated.',409);
        const next={...strip(row),...fields,BedId:bedId,WardId:ward.WardId,BranchId:branchId,Ready:row?.Ready!==false,AdmissionId:row?.AdmissionId||'',CreatedAt:row?.CreatedAt||clock(),UpdatedAt:clock(),UpdatedBy:actor};
        return {writes:[write('Beds',bedId,next,row),write('BedVersions',key,{...next,VersionId:key},null),auditWrite(key,'Save hospital bed',branchId,{}, {Subject:`${ward.Name} / ${fields.Name}`})],result:{BedId:bedId}};
      });
    },
    async prepareHospitalBed(body){
      requireCapability('inpatient.admit');const branchId=await branch(body);
      if(body.ConfirmReady!==true)fail('Confirm that the bed has been prepared and is ready for the next patient.');
      return operation(body,'prepareHospitalBed',async key=>{
        const {bed,ward}=await bedFor(body.BedId,branchId);version(bed,body.Revision);
        if(bed.AdmissionId||!bed.Active)fail('Only an unoccupied active bed can be marked ready.',409);
        if(bed.Ready!==false)return {writes:[],result:{Unchanged:true,BedId:bed.BedId}};
        const next={...strip(bed),Ready:true,PreparedAt:clock(),PreparedBy:actor,UpdatedAt:clock()};
        return {writes:[write('Beds',bed.BedId,next,bed),write('BedVersions',key,{...next,VersionId:key,Action:'Bed prepared'},null),
          auditWrite(key,'Mark hospital bed ready',branchId,{}, {Subject:`${ward.Name} / ${bed.Name}`})],result:{BedId:bed.BedId}};
      });
    },
    async inpatientVisit(body){
      requireCapability('inpatient.read');const branchId=await branch(body),{visit,person}=await visitFor(body,branchId);
      await auditRead(body,'View admission visit',branchId,person,{VisitId:visit.VisitId});
      return {ok:true,visit:view(visit),patient:patientSummary(person)};
    },
    async admitHospitalPatient(body){
      requireCapability('inpatient.admit');const branchId=await branch(body);confirm(body);
      const ResponsibleClinician=inpatientText(body.ResponsibleClinician,'responsible clinician');
      return operation(body,'admitHospitalPatient',async key=>{
        const {visit,person}=await visitFor(body,branchId);version(visit,body.VisitRevision);
        if(!open(visit)||visit.AdmissionId||person.Status!=='Active')fail('Use the patient’s open visit without an existing admission.',409);
        const lock=await read('OpenAdmissions',person.PatientId);
        if(lock?.AdmissionId)fail('This patient already has an open admission. Open that admission instead.',409);
        const {bed,ward}=await bedFor(body.BedId,branchId);version(bed,body.BedRevision);available(bed,ward);
        const visitLock=await read('OpenVisits',await digest(JSON.stringify([branchId,person.PatientId])));
        if(visitLock?.VisitId!==visit.VisitId)fail('This is not the patient’s current open visit.',409);
        const admission={AdmissionId:key,PatientId:person.PatientId,PatientName:patientName(person),HospitalNumber:person.HospitalNumber,
          BranchId:branchId,VisitId:visit.VisitId,WardId:ward.WardId,WardName:ward.Name,BedId:bed.BedId,BedName:bed.Name,
          ResponsibleClinician,Status:'Admitted',CreatedAt:clock(),UpdatedAt:clock(),AdmittedBy:actor};
        const c={admission,person,visit,branchId};
        return {writes:[write('Admissions',key,admission,null),write('OpenAdmissions',person.PatientId,{AdmissionId:key,PatientId:person.PatientId,BranchId:branchId},lock),
          write('Beds',bed.BedId,{...strip(bed),AdmissionId:key,PatientId:person.PatientId,PatientName:patientName(person),HospitalNumber:person.HospitalNumber,UpdatedAt:clock()},bed),countWard(ward,1),
          write('Visits',visit.VisitId,{...strip(visit),AdmissionId:key,Status:'In progress',UpdatedAt:clock()},visit),
          movement(key,c,'Admitted',{ToWard:ward.Name,ToBed:bed.Name}),auditWrite(key,'Admit hospital patient',branchId,person,{VisitId:visit.VisitId,AdmissionId:key})],result:{AdmissionId:key,PatientId:person.PatientId}};
      });
    },
    async inpatientAdmissions(body){
      requireCapability('inpatient.read');const dates=inpatientDates(body.DateRange),branchId=await branch(body);
      const filters=[eq('BranchId',branchId),...dates];
      if(body.WardId){await wardFor(body.WardId,branchId);filters.push(eq('WardId',body.WardId));}
      const result=await page('Admissions',filters,'CreatedAt',body);
      await auditRead(body,'View dated hospital admissions',branchId,{}, {DateRange:body.DateRange,ResultCount:result.rows.length});
      return {ok:true,admissions:result.rows.map(view),next:result.next};
    },
    async inpatientAdmission(body){
      requireCapability('inpatient.read');const c=await current(body);
      const summary=capabilities.includes('inpatient.clinical')&&c.admission.DischargeSummaryId?await read('DischargeSummaries',c.admission.DischargeSummaryId):null;
      if(summary&&(summary.AdmissionId!==c.admission.AdmissionId||summary.PatientId!==c.person.PatientId||summary.BranchId!==c.branchId))fail('Review the discharge summary reference.',409);
      await auditRead(body,'View hospital admission',c.branchId,c.person,{AdmissionId:c.admission.AdmissionId});
      return {ok:true,admission:view(c.admission),patient:patientSummary(c.person),visit:view(c.visit),summary:view(summary)};
    },
    async transferHospitalBed(body){
      requireCapability('inpatient.admit');await branch(body);
      const Reason=inpatientText(body.Reason,'transfer reason',500);
      return operation(body,'transferHospitalBed',async key=>{
        const c=await current(body,true),old=await occupied(c);
        if(c.admission.BedId===body.BedId)return {writes:[],result:{Unchanged:true,AdmissionId:c.admission.AdmissionId}};
        const target=await bedFor(body.BedId,c.branchId);version(target.bed,body.BedRevision);available(target.bed,target.ward);
        const next={...strip(c.admission),WardId:target.ward.WardId,WardName:target.ward.Name,BedId:target.bed.BedId,BedName:target.bed.Name,UpdatedAt:clock()};
        const writes=[write('Admissions',next.AdmissionId,next,c.admission),
          write('Beds',old.bed.BedId,{...strip(old.bed),AdmissionId:'',PatientId:'',PatientName:'',HospitalNumber:'',Ready:false,UpdatedAt:clock()},old.bed),
          write('Beds',target.bed.BedId,{...strip(target.bed),AdmissionId:next.AdmissionId,PatientId:c.person.PatientId,PatientName:patientName(c.person),HospitalNumber:c.person.HospitalNumber,UpdatedAt:clock()},target.bed),
          movement(key,c,'Bed transfer',{FromWard:old.ward.Name,FromBed:old.bed.Name,ToWard:target.ward.Name,ToBed:target.bed.Name,Reason}),
          auditWrite(key,'Transfer hospital bed',c.branchId,c.person,{AdmissionId:next.AdmissionId})];
        if(old.ward.WardId!==target.ward.WardId)writes.push(countWard(old.ward,-1),countWard(target.ward,1));
        else writes.push(countWard(target.ward,0)); // Serialise ward availability changes too.
        return {writes,result:{AdmissionId:next.AdmissionId,PatientId:c.person.PatientId}};
      });
    },
    async signHospitalDischarge(body){
      requireCapability('inpatient.discharge');await branch(body);const fields=dischargeFields(body.Summary);
      if(body.ConfirmClinicalReview!==true)fail('Confirm clinical review of the patient, medications, investigations and follow-up.');
      return operation(body,'signHospitalDischarge',async key=>{
        const c=await current(body,true);version(c.visit,body.VisitRevision);
        const previous=c.admission.DischargeSummaryId?await read('DischargeSummaries',c.admission.DischargeSummaryId):null;
        if(previous&&!changed(previous,fields)&&c.visit.DischargeApprovalId===previous.SummaryId)return {writes:[],result:{Unchanged:true,AdmissionId:c.admission.AdmissionId}};
        const Reason=previous?inpatientText(body.Reason,'summary replacement reason',1000):'';
        const summary={...fields,SummaryId:key,AdmissionId:c.admission.AdmissionId,PatientId:c.person.PatientId,VisitId:c.visit.VisitId,BranchId:c.branchId,
          PreviousSummaryId:previous?.SummaryId||'',Reason,CreatedAt:clock(),SignedBy:actor,SignedByName:clean(user.displayName)||actor};
        return {writes:[write('DischargeSummaries',key,summary,null),
          write('Visits',c.visit.VisitId,{...strip(c.visit),DischargeApprovalId:key},c.visit),
          write('Admissions',c.admission.AdmissionId,{...strip(c.admission),DischargeSummaryId:key,DischargeAuthor:summary.SignedByName,DischargeSignedAt:clock(),UpdatedAt:clock()},c.admission),
          movement(key,c,'Discharge summary signed'),auditWrite(key,'Sign hospital discharge summary',c.branchId,c.person,{AdmissionId:c.admission.AdmissionId})],result:{AdmissionId:c.admission.AdmissionId,PatientId:c.person.PatientId}};
      });
    },
    async dischargeHospitalPatient(body){
      requireCapability('inpatient.admit');await branch(body);
      return operation(body,'dischargeHospitalPatient',async key=>{
        const c=await current(body,true);version(c.visit,body.VisitRevision);
        if(!c.admission.DischargeSummaryId)fail('A clinician must sign the discharge summary before the bed is released.',409);
        if(c.visit.DischargeApprovalId!==c.admission.DischargeSummaryId)fail('Clinical work changed after the discharge review. Ask the clinician to review and sign the summary again.',409);
        if(c.visit.ClinicalState&&c.visit.ClinicalState!=='Consultation signed')fail('Complete and sign the open consultation before discharge.',409);
        const {bed,ward,lock}=await occupied(c),visitLockId=await digest(JSON.stringify([c.branchId,c.person.PatientId])),visitLock=await read('OpenVisits',visitLockId);
        if(visitLock?.VisitId!==c.visit.VisitId)fail('Review this patient’s open visit before discharge.',409);
        return {writes:[write('Admissions',c.admission.AdmissionId,{...strip(c.admission),Status:'Discharged',DischargedAt:clock(),DischargedBy:actor,UpdatedAt:clock()},c.admission),
          write('Beds',bed.BedId,{...strip(bed),AdmissionId:'',PatientId:'',PatientName:'',HospitalNumber:'',Ready:false,UpdatedAt:clock()},bed),countWard(ward,-1),
          write('OpenAdmissions',c.person.PatientId,{...strip(lock),AdmissionId:''},lock),
          write('Visits',c.visit.VisitId,{...strip(c.visit),Status:'Completed',UpdatedAt:clock(),DischargedAt:clock()},c.visit),
          write('OpenVisits',visitLockId,{...strip(visitLock),VisitId:''},visitLock),
          movement(key,c,'Discharged',{FromWard:ward.Name,FromBed:bed.Name}),auditWrite(key,'Discharge hospital patient',c.branchId,c.person,{AdmissionId:c.admission.AdmissionId})],result:{AdmissionId:c.admission.AdmissionId,PatientId:c.person.PatientId}};
      });
    },
    async inpatientHistory(body){
      requireCapability('inpatient.read');const dates=inpatientDates(body.DateRange),c=await current(body);
      const clinical=body.Kind==='Summaries';if(clinical)requireCapability('inpatient.clinical');
      const result=await page(clinical?'DischargeSummaries':'AdmissionEvents',[eq('BranchId',c.branchId),eq('AdmissionId',c.admission.AdmissionId),...dates],'CreatedAt',body);
      await auditRead(body,clinical?'View dated discharge summaries':'View dated admission movements',c.branchId,c.person,{AdmissionId:c.admission.AdmissionId,DateRange:body.DateRange,ResultCount:result.rows.length});
      return {ok:true,entries:result.rows.map(view),next:result.next};
    }
  };
}
