import test from 'node:test';
import assert from 'node:assert/strict';
import {commitAcademicResultBatch} from '../functions/lib/academic-result-batch-commit.js';

function fixture(change=null){
  const scope={BranchId:'main',SchoolSection:'secondary',SessionId:'session',TermId:'term',ClassId:'class',ArmId:'arm'};
  const evidence={refs:['A','B'],memberships:['A','B'].map(StudentRef=>({MembershipId:`member-${StudentRef}`,StudentRef,SchoolSection:'secondary',__updateTime:'v1'})),
    sheets:[{SheetId:'sheet',SchoolSection:'secondary',__updateTime:'v1'}]};
  const calls=[],commits=[],writes=[{collectionPath:'academicResults',documentId:'result',data:{Status:'Published'},currentDocument:{updateTime:'result-v1'}}];
  const document=(row,collection)=>({name:`projects/test/databases/(default)/documents/${collection}/${row.MembershipId||row.SheetId}`,
    updateTime:row.__updateTime,fields:{SchoolSection:{stringValue:row.SchoolSection},...(row.StudentRef?{StudentRef:{stringValue:row.StudentRef}}:{})}});
  const dependencies={token:async()=> 'test-token',base:()=> 'https://test.invalid/documents',
    fetch:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push({url,body});
      if(url.endsWith(':rollback'))return {ok:true,json:async()=>({})};
      const collection=body.structuredQuery.from[0].collectionId;
      const rows=structuredClone(collection==='academicStudentMemberships'?evidence.memberships:evidence.sheets);
      change?.(collection,rows);
      return {ok:true,json:async()=>[{transaction:'transaction-id'},...rows.map(row=>({document:document(row,collection)}))]};
    },commit:async(_env,data,options)=>{commits.push({data,options});return {writeResults:[{updateTime:'result-v2'}]};}};
  return {scope,evidence,calls,commits,writes,dependencies};
}
test('batch publication atomically verifies membership and sheet versions without rewriting scores or memberships',async()=>{
  const f=fixture(),before=structuredClone(f.evidence);
  const saved=await commitAcademicResultBatch({},f.writes,f.scope,f.evidence,f.dependencies);
  assert.equal(saved.writeResults[0].updateTime,'result-v2');assert.equal(f.commits.length,1);
  assert.deepEqual(f.commits[0],{data:f.writes,options:{transaction:'transaction-id'}});assert.deepEqual(f.evidence,before);
  assert.deepEqual(f.calls[0].body.newTransaction,{readWrite:{}});assert.equal(f.calls[1].body.transaction,'transaction-id');
  assert.ok(f.calls.every(call=>call.body.structuredQuery.limit===1001));
  const filters=f.calls[0].body.structuredQuery.where.compositeFilter.filters;
  assert.deepEqual(filters.map(row=>row.fieldFilter.field.fieldPath),['BranchId','SessionId','TermId','StudentRef']);
  assert.equal(filters.at(-1).fieldFilter.op,'IN');
});
for(const [name,change] of [
  ['marks or placement changed',(collection,rows)=>{if(collection==='academicStudentMemberships')rows[0].__updateTime='new-marks';}],
  ['new duplicate membership',(collection,rows)=>{if(collection==='academicStudentMemberships')rows.push({...rows[0],MembershipId:'duplicate'});}],
  ['membership removed',(collection,rows)=>{if(collection==='academicStudentMemberships')rows.pop();}],
  ['sheet review changed',(collection,rows)=>{if(collection==='academicScoreSheets')rows[0].__updateTime='new-review';}],
  ['new score sheet',(collection,rows)=>{if(collection==='academicScoreSheets')rows.push({...rows[0],SheetId:'another'});}],
  ['missing version',(collection,rows)=>{if(collection==='academicScoreSheets')delete rows[0].__updateTime;}]
])test(`${name} after validation prevents every write and rolls back`,async()=>{
  const f=fixture(change);
  await assert.rejects(commitAcademicResultBatch({},f.writes,f.scope,f.evidence,f.dependencies),{code:'ACADEMIC_RESULT_BATCH_CHANGED'});
  assert.equal(f.commits.length,0);assert.ok(f.calls.at(-1).url.endsWith(':rollback'));
});
test('concurrent result commit conflict rolls back and never overwrites the newer result',async()=>{
  const f=fixture();f.dependencies.commit=async()=>{throw Object.assign(new Error('Precondition failed'),{status:409});};
  await assert.rejects(commitAcademicResultBatch({},f.writes,f.scope,f.evidence,f.dependencies),{status:409});
  assert.ok(f.calls.at(-1).url.endsWith(':rollback'));
});
test('completed retry has no transaction or writes, and membership query batches stay bounded',async()=>{
  const f=fixture();assert.deepEqual(await commitAcademicResultBatch({},[],f.scope,f.evidence,f.dependencies),{writeResults:[]});
  assert.equal(f.calls.length,0);
  f.evidence.refs=Array.from({length:23},(_,i)=>`student-${i}`);f.evidence.memberships=[];
  await commitAcademicResultBatch({},f.writes,f.scope,f.evidence,f.dependencies);
  assert.equal(f.calls.length,4);
  assert.deepEqual(f.calls.slice(0,3).map(call=>call.body.structuredQuery.where.compositeFilter.filters.at(-1).fieldFilter.value.arrayValue.values.length),[10,10,3]);
});
test('query errors and truncated evidence cannot produce a partial publication',async()=>{
  for(const mode of ['error','truncated']){
    const f=fixture();
    f.dependencies.fetch=async(url,options)=>{f.calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>
      mode==='error'?[{transaction:'t'},{error:{message:'Denied'}}]:[{transaction:'t'},...Array.from({length:1001},()=>({document:{name:'x/member',updateTime:'v1',fields:{}}}))]};};
    await assert.rejects(commitAcademicResultBatch({},f.writes,f.scope,f.evidence,f.dependencies),{code:'ACADEMIC_RESULT_BATCH_CHANGED'});
    assert.equal(f.commits.length,0);assert.ok(f.calls.at(-1).url.endsWith(':rollback'));
  }
});
