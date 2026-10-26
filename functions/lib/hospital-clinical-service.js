import {clean,fail,id,patientSummary} from './hospital-model.js';
import {triageFields,consultationFields,amendmentFields} from './hospital-clinical-model.js';
import {historyDateRange} from './history-date-range.js';

export function createHospitalClinicalService(context){
  const {env,user,db,collection,capabilities,requireCapability,branch,patient,clock,actor,condition,strip,eq,
    auditWrite,auditRead,operation,page}=context;
  const read=(name,key)=>db.getDocument(env,collection(name),key);
  const write=(name,key,data,previous)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(previous)});
  const publicRow=row=>row?{...strip(row),Revision:row.__updateTime}:null;
  const publicEntry=row=>row?{...publicRow(row),CanAmend:['Triage','Consultation'].includes(row.Type)
    &&(row.AuthorUsername===actor||user.role==='Medical Director')
    &&capabilities.includes(row.Type==='Triage'?'triage.write':'consultations.write')}:null;
  async function encounter(body,editable=false){
    const branchId=await branch(body),visit=await read('Visits',id(body.VisitId));
    if(!visit||visit.BranchId!==branchId)fail('This visit is not available in the selected branch.',404);
    if(clean(body.PatientId)!==visit.PatientId)fail('The selected patient does not match this visit.',409);
    const person=await patient(visit.PatientId,branchId);
    if(editable&&(person.Status!=='Active'||!['Waiting','In progress'].includes(visit.Status)))fail('This visit is closed or the patient registration is inactive. Signed records can be amended separately.',409);
    const [record,care,draft]=await Promise.all([read('Encounters',visit.VisitId),read('CareSummaries',visit.PatientId),read('Consultations',visit.VisitId)]);
    if([record,draft].some(row=>row&&(row.PatientId!==visit.PatientId||row.BranchId!==branchId)))fail('Review this encounter’s patient references before continuing.',409);
    if(care&&care.PatientId!==visit.PatientId)fail('Review this patient’s care-summary reference before continuing.',409);
    return {branchId,visit,person,record,care,draft};
  }
  function checkVersions(body,current){
    for(const [field,row] of [['VisitRevision',current.visit],['EncounterRevision',current.record],['CareRevision',current.care]]){
      if(clean(body[field])!==clean(row?.__updateTime))fail('The visit, allergies or clinical record changed. Refresh the care record before saving.',409);
    }
  }
  function checkDraft(body,draft){
    if(draft?.Status==='Signed')fail('This consultation is signed. Add an amendment to retain the original.',409);
    if(draft&&draft.AuthorUsername!==actor)fail('Another clinician owns this consultation draft. The original author must complete it.',403);
    if(clean(body.DraftRevision)!==clean(draft?.__updateTime))fail('The consultation draft changed. Refresh before saving.',409);
  }
  function entry(key,current,Type,Content,extra={}){
    return {EntryId:key,VisitId:current.visit.VisitId,PatientId:current.visit.PatientId,BranchId:current.branchId,
      Type,Content,Status:'Signed',CreatedAt:clock(),SignedAt:clock(),AuthorUsername:actor,
      AuthorName:clean(user.displayName)||actor,AuthorRole:user.role,...extra};
  }
  function progress(current,updates={},careUpdates={}){
    const {visit,record,care}=current,timestamp=clock();
    const recordNext={...strip(record),EncounterId:visit.VisitId,VisitId:visit.VisitId,PatientId:visit.PatientId,
      BranchId:current.branchId,CreatedAt:record?.CreatedAt||timestamp,UpdatedAt:timestamp,UpdatedBy:actor,...updates};
    return [write('Encounters',visit.VisitId,recordNext,record),
      // This version also serializes concurrent allergy changes across visits.
      write('CareSummaries',visit.PatientId,{AllergyStatus:'Unknown',Allergies:'',...strip(care),PatientId:visit.PatientId,
        LastClinicalActivityAt:timestamp,...careUpdates},care),
      write('Visits',visit.VisitId,{...strip(visit),ClinicalState:recordNext.ClinicalState||visit.ClinicalState||'Care started',UpdatedAt:timestamp},visit)];
  }
  return {
    async clinicalContext(body){
      requireCapability('clinical.read');const current=await encounter(body),{record,draft,care,person,visit,branchId}=current;
      const latest=await Promise.all([record?.LatestTriageId,record?.LatestConsultationId,record?.LatestAmendmentId].map(key=>key?read('ClinicalEntries',key):null));
      if(latest.some(row=>row&&(row.PatientId!==person.PatientId||row.VisitId!==visit.VisitId||row.BranchId!==branchId)))fail('Review this encounter’s signed-entry references.',409);
      await auditRead(body,'View clinical encounter',branchId,person,{VisitId:visit.VisitId});
      const ownDraft=capabilities.includes('consultations.write')&&(!draft||draft.AuthorUsername===actor);
      return {ok:true,patient:patientSummary(person),visit:publicRow(visit),encounter:publicRow(record),
        care:publicRow(care)||{AllergyStatus:'Unknown',Allergies:'',Revision:''},latestTriage:publicEntry(latest[0]),latestConsultation:publicEntry(latest[1]),latestAmendment:publicEntry(latest[2]),
        draft:ownDraft?publicRow(draft):null,canEditDraft:ownDraft&&draft?.Status!=='Signed',draftStatus:draft?.Status||'Not started',
        draftOwner:clean(draft?.AuthorName)};
    },
    async clinicalHistory(body){
      requireCapability('clinical.read');const range=historyDateRange(body.DateRange);
      const start=new Date(`${range.fromDate}T00:00:00+01:00`),end=new Date(`${range.toDate}T00:00:00+01:00`);end.setTime(end.getTime()+86400000);
      if(end-start>93*86400000)fail('Choose a clinical-history period of no more than 93 days.');
      const {visit,person,branchId}=await encounter(body);
      const result=await page('ClinicalEntries',[eq('BranchId',branchId),eq('VisitId',visit.VisitId),
        {field:'CreatedAt',op:'>=',value:start.toISOString()},{field:'CreatedAt',op:'<',value:end.toISOString()}],'CreatedAt',body);
      if(result.rows.some(row=>row.PatientId!==person.PatientId))fail('Review this encounter’s clinical-entry references.',409);
      await auditRead(body,'View dated clinical entries',branchId,person,{VisitId:visit.VisitId,FromDate:range.fromDate,ToDate:range.toDate,ResultCount:result.rows.length});
      return {ok:true,entries:result.rows.map(publicEntry),next:result.next};
    },
    async recordTriage(body){
      requireCapability('triage.write');await branch(body);const fields=triageFields(body.Triage,clock());
      return operation(body,'recordTriage',async key=>{
        const current=await encounter(body,true);checkVersions(body,current);
        const row=entry(key,current,'Triage',fields);
        return {writes:[...progress(current,{LatestTriageId:key,ClinicalState:current.draft?.Status==='Signed'?'Consultation signed':'Triage recorded'},
          {AllergyStatus:fields.AllergyStatus,Allergies:fields.Allergies,AllergyRecordedAt:clock(),AllergyRecordedBy:actor}),
          write('ClinicalEntries',key,row,null),auditWrite(key,'Record triage',current.branchId,current.person,{VisitId:current.visit.VisitId,EntryId:key})],
          result:{VisitId:current.visit.VisitId,PatientId:current.person.PatientId,EntryId:key}};
      });
    },
    async saveConsultation(body){
      requireCapability('consultations.write');await branch(body);const Notes=consultationFields(body.Notes);
      return operation(body,'saveConsultation',async key=>{
        const current=await encounter(body,true);checkVersions(body,current);checkDraft(body,current.draft);
        if(current.draft&&Object.entries(Notes).every(([key,value])=>clean(current.draft.Notes?.[key])===value))return {writes:[],result:{VisitId:current.visit.VisitId,PatientId:current.person.PatientId,Unchanged:true}};
        const draft={...strip(current.draft),ConsultationId:current.visit.VisitId,PatientId:current.person.PatientId,BranchId:current.branchId,
          VisitId:current.visit.VisitId,Status:'Draft',Notes,CreatedAt:current.draft?.CreatedAt||clock(),UpdatedAt:clock(),
          AuthorUsername:actor,AuthorName:clean(user.displayName)||actor};
        return {writes:[...progress(current,{ClinicalState:'Consultation draft'}),write('Consultations',draft.ConsultationId,draft,current.draft),
          auditWrite(key,'Save consultation draft',current.branchId,current.person,{VisitId:current.visit.VisitId})],result:{VisitId:current.visit.VisitId,PatientId:current.person.PatientId}};
      });
    },
    async signConsultation(body){
      requireCapability('consultations.write');await branch(body);
      if(body.ConfirmPatient!==true)fail('Confirm the patient identity and current allergy information before signing.');
      return operation(body,'signConsultation',async key=>{
        const current=await encounter(body,true);checkVersions(body,current);checkDraft(body,current.draft);
        if(!current.draft)fail('Save the consultation draft before signing.');
        const Notes=consultationFields(current.draft.Notes,true);
        const row=entry(key,current,'Consultation',Notes,{AllergySnapshot:{Status:current.care?.AllergyStatus||'Unknown',Details:current.care?.Allergies||'',
          RecordedAt:current.care?.AllergyRecordedAt||'',ReviewedBy:actor},TriageEntryId:current.record?.LatestTriageId||''});
        return {writes:[...progress(current,{ClinicalState:'Consultation signed',LatestConsultationId:key}),write('ClinicalEntries',key,row,null),
          write('Consultations',current.visit.VisitId,{...strip(current.draft),Status:'Signed',SignedAt:clock(),SignedEntryId:key},current.draft),
          auditWrite(key,'Sign consultation',current.branchId,current.person,{VisitId:current.visit.VisitId,EntryId:key})],
          result:{VisitId:current.visit.VisitId,PatientId:current.person.PatientId,EntryId:key}};
      });
    },
    async amendClinicalEntry(body){
      requireCapability('clinical.read');await branch(body);const fields=amendmentFields(body.Amendment);
      return operation(body,'amendClinicalEntry',async key=>{
        const current=await encounter(body);checkVersions(body,current);
        const original=await read('ClinicalEntries',id(body.EntryId));
        if(!original||original.VisitId!==current.visit.VisitId||original.PatientId!==current.person.PatientId||original.BranchId!==current.branchId
          ||!['Triage','Consultation'].includes(original.Type))fail('Choose an original signed entry from this encounter.',404);
        requireCapability(original.Type==='Triage'?'triage.write':'consultations.write');
        if(original.AuthorUsername!==actor&&user.role!=='Medical Director')fail('Only the original author or Medical Director may amend this entry.',403);
        const row=entry(key,current,'Amendment',fields,{TargetEntryId:original.EntryId,TargetType:original.Type});
        return {writes:[...progress(current,{LatestAmendmentId:key,AmendmentCount:Number(current.record?.AmendmentCount||0)+1}),write('ClinicalEntries',key,row,null),
          auditWrite(key,'Amend signed clinical entry',current.branchId,current.person,{VisitId:current.visit.VisitId,EntryId:key,OriginalEntryId:original.EntryId})],
          result:{VisitId:current.visit.VisitId,PatientId:current.person.PatientId,EntryId:key}};
      });
    }
  };
}
