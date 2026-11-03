import test from 'node:test';
import assert from 'node:assert/strict';
import {compulsoryMembershipUpdates,commitAcademicOfferingSetup} from '../functions/lib/academic-compulsory-subjects.js';
import {objectToFirestoreFields} from '../functions/lib/firestore.js';
const scope={BranchId:'garden',SchoolSection:'primary',SessionId:'session',TermId:'term',ClassId:'nursery2'};
const schoolClass={...scope,SchoolStage:'primary',Status:'Active',__name:'projects/p/databases/(default)/documents/academicClasses/nursery2',__updateTime:'v1'};
const offering={...scope,OfferingId:'offering',ArmId:'',SubjectId:'numbers',SubjectRole:'Core',Compulsory:true,Status:'Active',__name:'projects/p/databases/(default)/documents/academicSubjectOfferings/offering',__updateTime:'v1'};
const subject={SubjectId:'numbers',__name:'projects/p/databases/(default)/documents/academicSubjects/numbers',__updateTime:'v1'};
const membership={...scope,MembershipId:'member',StudentRef:'P1',ArmId:'distinction',Status:'Active',SubjectIds:[],CoreSubjectIds:[],__id:'member',__updateTime:'v1'};

test('compulsory subjects reach pupils allocated before subject setup and retries are empty',()=>{
  const before=structuredClone(membership),[change]=compulsoryMembershipUpdates([membership],[offering],[schoolClass]);
  assert.deepEqual(change.data.SubjectIds,['numbers']);assert.deepEqual(change.data.CoreSubjectIds,['numbers']);
  assert.equal(change.data.CurriculumStatus,'Complete');assert.deepEqual(membership,before);
  assert.deepEqual(compulsoryMembershipUpdates([{...membership,...change.data}],[offering],[schoolClass]),[]);
});
test('subject links are additive, preserving optional selections and prior subjects',()=>{
  const member={...membership,SubjectIds:['old','art'],CoreSubjectIds:['old'],OptionalSubjectIds:['art'],CurriculumStatus:'Subjects Not Configured',ScoreHistoryRevision:'keep'};
  const [change]=compulsoryMembershipUpdates([member],[offering],[schoolClass]);
  assert.deepEqual(change.data.SubjectIds,['old','art','numbers']);assert.deepEqual(change.data.CoreSubjectIds,['old','numbers']);
  assert.equal(change.data.OptionalSubjectIds,undefined);assert.equal(change.data.ScoreHistoryRevision,undefined);
});
test('foreign branch, section, class, period, classroom and inactive memberships remain unchanged',()=>{
  for(const mismatch of [{BranchId:'main'},{SchoolSection:'secondary'},{ClassId:'other'},{SessionId:'old'},{TermId:'next'},{Status:'Archived'}])
    assert.deepEqual(compulsoryMembershipUpdates([{...membership,...mismatch}],[offering],[schoolClass]),[]);
  assert.deepEqual(compulsoryMembershipUpdates([membership],[{...offering,ArmId:'other'}],[schoolClass]),[]);
});
test('senior choices, optional and inactive offerings are not silently assigned',()=>{
  for(const mismatch of [{SubjectRole:'Optional'},{Status:'Inactive'}])assert.deepEqual(compulsoryMembershipUpdates([membership],[{...offering,...mismatch}],[schoolClass]),[]);
  assert.deepEqual(compulsoryMembershipUpdates([membership],[offering],[{...schoolClass,SchoolStage:'senior-secondary'}]),[]);
});
test('junior secondary compulsory curriculum is applied without replacing existing choices',()=>{
  const section={SchoolSection:'secondary'};
  const [change]=compulsoryMembershipUpdates([{...membership,...section}],[{...offering,...section}],[{...schoolClass,...section,SchoolStage:'junior-secondary'}]);
  assert.deepEqual(change.data.SubjectIds,['numbers']);
});
function harness({already=false,changed=false}={}){
  const calls=[],commits=[],state={classes:[schoolClass],subjects:[subject],offerings:[offering]};
  const dependencies={token:async()=>'',base:()=> 'https://example.test/documents',
    fetch:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push({url,body});
      if(url.endsWith(':rollback'))return {ok:true,json:async()=>({})};
      if(url.endsWith(':runQuery'))return {ok:true,json:async()=>[{transaction:'tx'},{document:{name:'projects/p/databases/(default)/documents/academicStudentMemberships/member',updateTime:'v1',fields:objectToFirestoreFields({...membership,...(already?{SubjectIds:['numbers'],CoreSubjectIds:['numbers']}:{})})}}]};
      if(url.endsWith(':batchGet'))return {ok:true,json:async()=>[schoolClass,subject,offering].map(row=>({found:{name:row.__name,updateTime:changed?'v2':row.__updateTime}}))};
      throw Error('Unexpected request');
    },commit:async(_env,writes,options)=>{commits.push({writes,options});return {writeResults:writes.map(()=>({}))};}};
  return {calls,commits,state,run:writes=>commitAcademicOfferingSetup({},writes,[offering],state,{username:'admin',role:'Super Admin'},dependencies)};
}
test('setup and subject links commit together with masks, preconditions and one summary audit',async()=>{
  const h=harness(),setup={collectionPath:'academicSubjectOfferings',documentId:'new',data:{}};
  const result=await h.run([setup]);assert.equal(result.membershipsUpdated,1);assert.equal(h.commits.length,1);
  const {writes,options}=h.commits[0];assert.equal(options.transaction,'tx');assert.equal(writes[0],setup);
  const member=writes.find(row=>row.collectionPath==='academicStudentMemberships');
  assert.equal(member.updateTime,'v1');assert.deepEqual(member.updateMask,['SubjectIds','CoreSubjectIds','CurriculumStatus','UpdatedAt','UpdatedBy']);
  assert.equal(writes.filter(row=>row.collectionPath==='academicManagementAudit').length,1);
  assert.ok(writes.every(row=>!['academicStudentScores','academicScoreSheets','academicStudentMovements'].includes(row.collectionPath)));
  const query=h.calls[0].body.structuredQuery;
  assert.equal(query.from[0].collectionId,'academicStudentMemberships');
  assert.deepEqual(query.where.compositeFilter.filters.map(row=>row.fieldFilter.field.fieldPath),['BranchId','SessionId','TermId','ClassId']);
});
test('changed setup aborts without writes; repeating a fully applied setup adds no audit or writes',async()=>{
  const changed=harness({changed:true});await assert.rejects(changed.run([]),{code:'ACADEMIC_CURRICULUM_CHANGED'});
  assert.equal(changed.commits.length,0);assert.ok(changed.calls.at(-1).url.endsWith(':rollback'));
  const done=harness({already:true});const result=await done.run([]);
  assert.equal(result.membershipsUpdated,0);assert.equal(done.commits.length,0);assert.ok(done.calls.at(-1).url.endsWith(':rollback'));
});
