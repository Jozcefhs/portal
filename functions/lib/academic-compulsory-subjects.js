import {getFirestoreAccessToken,firestoreBaseUrl,buildStructuredQuery,firestoreDocumentToObject,batchCommitDocuments} from './firestore.js';
const clean=value=>String(value??'').trim();
const active=row=>!row.Status || row.Status==='Active';
const unique=items=>[...new Set((items||[]).map(clean).filter(Boolean))];
const sameScope=(row,target)=>['BranchId','SchoolSection','SessionId','TermId','ClassId'].every(key=>clean(row[key])===clean(target[key]));

// Compulsory curriculum additions are additive. Never replace electives, old
// subjects, score history or the learner's placement when updating class setup.
export function compulsoryMembershipUpdates(memberships,offerings,classes) {
  const required=offerings.filter(offering=>{
    const schoolClass=classes.find(row=>row.ClassId===offering.ClassId && row.BranchId===offering.BranchId && row.SchoolSection===offering.SchoolSection);
    if(!schoolClass||!active(schoolClass)||!active(offering))return false;
    if(schoolClass.SchoolStage==='senior-secondary')return false;
    return schoolClass.SchoolStage==='junior-secondary' || (schoolClass.SchoolSection==='primary'
      && (offering.SubjectRole||offering.RequirementType||(offering.Compulsory===true?'Core':'Optional'))==='Core');
  });
  return memberships.filter(active).flatMap(member=>{
    const added=unique(required.filter(offering=>sameScope(offering,member)&&(!offering.ArmId||offering.ArmId===member.ArmId)).map(row=>row.SubjectId));
    if(!added.length)return [];
    const subjects=unique(member.SubjectIds),core=unique(member.CoreSubjectIds);
    const SubjectIds=unique([...subjects,...added]),CoreSubjectIds=unique([...core,...added]);
    if(SubjectIds.length===subjects.length&&CoreSubjectIds.length===core.length)return [];
    return [{member,data:{SubjectIds,CoreSubjectIds,CurriculumStatus:'Complete'},added:added.filter(id=>!subjects.includes(id))}];
  });
}

// The setup change and its existing learner rosters commit together. Query only
// selected classes/periods; transaction reads guard concurrent setup/placement
// edits without writing unchanged catalogue rows or fetching any scores.
export async function commitAcademicOfferingSetup(env,writes,offerings,state,user,dependencies={}) {
  if(!compulsoryMembershipUpdates(offerings.map(row=>({...row,SubjectIds:[],CoreSubjectIds:[]})),offerings,state.classes).length)
    return (dependencies.commit||batchCommitDocuments)(env,writes);
  const token=await (dependencies.token||getFirestoreAccessToken)(env),base=(dependencies.base||firestoreBaseUrl)(env);
  const request=dependencies.fetch||fetch,commit=dependencies.commit||batchCommitDocuments;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const fail=()=>Object.assign(new Error('The class subjects or pupil allocations changed during saving. Reload and apply the subjects again; this attempt changed no records.'),{status:409,code:'ACADEMIC_CURRICULUM_CHANGED'});
  const groups=[...new Map(offerings.map(row=>[JSON.stringify([row.BranchId,row.SchoolSection,row.SessionId,row.TermId,row.ClassId]),row])).values()];
  let transaction='';
  try{
    const members=[];
    for(const group of groups){
      const {structuredQuery}=buildStructuredQuery('academicStudentMemberships',{filters:['BranchId','SessionId','TermId','ClassId'].map(field=>({field,op:'==',value:group[field]})),limit:5001});
      const response=await request(`${base}:runQuery`,{method:'POST',headers,body:JSON.stringify({structuredQuery,...(transaction?{transaction}:{newTransaction:{readWrite:{}}})})});
      const data=await response.json();if(!transaction)transaction=clean(data.find?.(row=>row.transaction)?.transaction);
      if(!response.ok||!transaction||!Array.isArray(data)||data.some(row=>row.error))throw fail();
      const rows=data.filter(row=>row.document).map(row=>firestoreDocumentToObject(row.document));
      if(rows.length>5000)throw fail();members.push(...rows.filter(row=>sameScope(row,group)));
    }
    const affectedClasses=new Set(offerings.map(row=>row.ClassId)),affectedSubjects=new Set(offerings.map(row=>row.SubjectId)),offeringIds=new Set(offerings.map(row=>row.OfferingId));
    const guards=[...state.classes.filter(row=>affectedClasses.has(row.ClassId)),...state.subjects.filter(row=>affectedSubjects.has(row.SubjectId)),...state.offerings.filter(row=>offeringIds.has(row.OfferingId))];
    const paths=guards.map(row=>row.__name);if(paths.some(path=>!path)||guards.some(row=>!row.__updateTime))throw fail();
    const response=await request(`${base}:batchGet`,{method:'POST',headers,body:JSON.stringify({documents:paths,transaction})});
    const documents=await response.json();
    if(!response.ok||!Array.isArray(documents)||documents.some(row=>row.error)||guards.some(row=>!documents.some(item=>item.found?.name===row.__name&&item.found.updateTime===row.__updateTime)))throw fail();
    const changes=compulsoryMembershipUpdates(members,offerings,state.classes),timestamp=new Date().toISOString();
    const actor=clean(user.displayName||user.DisplayName||user.username||user.Username)||'Academic Management';
    const finalWrites=[...writes,...changes.map(({member,data})=>({collectionPath:'academicStudentMemberships',documentId:member.__id,
      data:{...data,UpdatedAt:timestamp,UpdatedBy:actor},updateMask:[...Object.keys(data),'UpdatedAt','UpdatedBy'],updateTime:member.__updateTime}))];
    if(changes.length){
      const id=`CURRICULUM-${crypto.randomUUID()}`,scope=groups[0];
      finalWrites.push({collectionPath:'academicManagementAudit',documentId:id,exists:false,data:{AuditId:id,Timestamp:timestamp,
        Action:'APPLY COMPULSORY SUBJECTS',RecordType:'offering',RecordId:id,BranchId:scope.BranchId,SchoolSection:scope.SchoolSection,SessionId:scope.SessionId,TermId:scope.TermId,
        Actor:actor,ActorUsername:clean(user.username||user.Username),ActorRole:clean(user.role||user.Role),
        Details:`Compulsory subject links added to ${changes.length} existing pupil memberships. Prior subjects, placements and scores preserved.`,
        Changes:changes.map(({member,added})=>({MembershipId:member.MembershipId,StudentRef:member.StudentRef,ClassId:member.ClassId,ArmId:member.ArmId,AddedSubjectIds:added}))}});
    }
    if(!finalWrites.length){await request(`${base}:rollback`,{method:'POST',headers,body:JSON.stringify({transaction})});return {writeResults:[],membershipsUpdated:0};}
    const result=await commit(env,finalWrites,{transaction,allowLargeAtomicBatch:true});return {...result,membershipsUpdated:changes.length};
  }catch(error){
    if(transaction)await request(`${base}:rollback`,{method:'POST',headers,body:JSON.stringify({transaction})}).catch(()=>{});
    throw error;
  }
}
