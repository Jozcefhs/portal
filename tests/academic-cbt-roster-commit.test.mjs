import test from 'node:test';
import assert from 'node:assert/strict';
import {commitAcademicCbtRoster} from '../functions/lib/academic-cbt-roster-commit.js';
import {objectToFirestoreFields} from '../functions/lib/firestore.js';
const scope = {ClassId:'class',SessionId:'session',TermId:'term',BranchId:'main',StartsAt:'2099-01-01'};
const row = {...scope,MembershipId:'one',__id:'one',__updateTime:'r1'};
const base = 'https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents';
const doc = r=>({name:`projects/test/databases/(default)/documents/academicStudentMemberships/${r.__id}`,updateTime:r.__updateTime,fields:objectToFirestoreFields(r)});
function fixture(rows=[row], failCommit=false) {
  const calls=[],commits=[];
  return {calls,commits,dependencies:{token:async()=> 'fixture',base:()=>base,
    fetch:async(url,init)=>{
      const body=JSON.parse(init.body);calls.push({url,body});
      if(url.endsWith(':rollback')) return Response.json({});
      return Response.json([{transaction:'locked'},...rows.map(r=>({document:doc(r)}))]);
    },commit:async(_env,writes,options)=>{
      if(failCommit)throw Object.assign(new Error('Concurrent update'),{status:409});
      commits.push({writes,options});return {writeResults:[]};
    }} };
}
test('CBT commit locks query evidence without rewriting memberships',async()=>{
  const f=fixture(), writes=[{collectionPath:'academicCbtTests',documentId:'test',updateTime:'t1',data:{}}];
  await commitAcademicCbtRoster({},writes,scope,[row],f.dependencies);
  assert.deepEqual(f.calls[0].body.newTransaction,{readWrite:{}});
  assert.equal(f.calls[0].body.structuredQuery.where.fieldFilter.field.fieldPath,'ClassId');
  assert.equal(f.calls[0].body.structuredQuery.limit,5001);
  assert.deepEqual(f.commits,[{writes,options:{transaction:'locked'}}]);
});
test('concurrent incoming/outgoing students, edits and commit races abort without partial changes',async()=>{
  for(const rows of [[],[row,{...row,__id:'two',MembershipId:'two'}],[{...row,__updateTime:'new'}]]) {
    const f=fixture(rows);
    await assert.rejects(commitAcademicCbtRoster({},[],scope,[row],f.dependencies),{code:'ACADEMIC_CBT_ROSTER_CHANGED'});
    assert.equal(f.commits.length,0);assert.ok(f.calls.at(-1).url.endsWith(':rollback'));
  }
  const race=fixture([row],true);
  await assert.rejects(commitAcademicCbtRoster({},[],scope,[row],race.dependencies),{status:409});
  assert.ok(race.calls.at(-1).url.endsWith(':rollback'));
});
test('large class histories and tests crossing their start time fail closed',async()=>{
  const f=fixture(Array.from({length:5001},(_,i)=>({...row,__id:String(i)})));
  await assert.rejects(commitAcademicCbtRoster({},[],scope,[row],f.dependencies),{status:409});
  assert.equal(f.commits.length,0);
  const started=fixture();
  await assert.rejects(commitAcademicCbtRoster({},[],{...scope,StartsAt:'2020-01-01'},[row],started.dependencies),{status:409});
});
