import test from 'node:test';
import assert from 'node:assert/strict';
import {commitAcademicDuplicateScore} from '../functions/lib/academic-duplicate-score-commit.js';

function fixture(change=()=>{}){
  const row=(collection,id)=>({__name:`projects/test/databases/(default)/documents/${collection}/${id}`,__updateTime:'v1'});
  const evidence={queries:[
    {collection:'academicStudentMemberships',filters:[{field:'StudentRef',op:'==',value:'TEST/1'}],limit:101,rows:[row('academicStudentMemberships','m')]},
    {collection:'academicStudentScores',filters:[{field:'StudentRef',op:'==',value:'TEST/1'}],limit:21,rows:[row('academicStudentScores','old'),row('academicStudentScores','current')]},
    {collection:'academicResults',filters:[{field:'StudentRef',op:'==',value:'TEST/1'}],limit:101,rows:[]}
  ],documents:[row('academicScoreSheets','sheet')]};
  const document=r=>({name:r.__name,updateTime:r.__updateTime,fields:{SchoolSection:{stringValue:'secondary'}}});
  const calls=[],commits=[],writes=[{collectionPath:'academicStudentScores',documentId:'current',updateTime:'v1',data:{RawScore:50}}];
  const dependencies={token:async()=> 'test-token',base:()=> 'https://test.invalid/documents',fetch:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});
    if(url.endsWith(':rollback'))return {ok:true,json:async()=>({})};
    const collection=body.structuredQuery?.from[0].collectionId||'academicScoreSheets';
    const rows=structuredClone(body.structuredQuery?evidence.queries.find(q=>q.collection===collection).rows:evidence.documents);
    change(collection,rows);
    return {ok:true,json:async()=>body.structuredQuery?[{transaction:'transaction-id'},...rows.map(r=>({document:document(r)}))]:rows.map(r=>({found:document(r)}))};
  },commit:async(_env,data,options)=>{commits.push({data,options});return {writeResults:[{updateTime:'v2'}]};}};
  return {evidence,writes,calls,commits,dependencies};
}
test('resolution verifies scoped query membership and exact sheet revisions in one atomic transaction',async()=>{
  const f=fixture();await commitAcademicDuplicateScore({},f.writes,f.evidence,f.dependencies);
  assert.equal(f.commits.length,1);assert.deepEqual(f.commits[0],{data:f.writes,options:{transaction:'transaction-id'}});
  assert.deepEqual(f.calls[0].body.newTransaction,{readWrite:{}});
  assert.ok(f.calls.slice(1).every(c=>c.body.transaction==='transaction-id'));
  assert.deepEqual(f.calls[1].body.structuredQuery.select,{fields:[{fieldPath:'SchoolSection'}]});
  assert.deepEqual(f.calls.at(-1).body.mask,{fieldPaths:['SchoolSection']});
});
for(const [name,change] of [
  ['changed placement',(c,r)=>{if(c==='academicStudentMemberships')r[0].__updateTime='v2';}],
  ['changed mark',(c,r)=>{if(c==='academicStudentScores')r[0].__updateTime='v2';}],
  ['new duplicate',(c,r)=>{if(c==='academicStudentScores')r.push({...r[0],__name:r[0].__name+'-new'});}],
  ['removed score',(c,r)=>{if(c==='academicStudentScores')r.pop();}],
  ['newly published result',(c,r)=>{if(c==='academicResults')r.push({__name:'projects/test/databases/(default)/documents/academicResults/new',__updateTime:'v2'});}],
  ['new sheet approval',(c,r)=>{if(c==='academicScoreSheets')r[0].__updateTime='v2';}],
  ['missing sheet',(c,r)=>{if(c==='academicScoreSheets')r.pop();}],
  ['missing version',(c,r)=>{if(c==='academicStudentScores')delete r[0].__updateTime;}]
])test(`${name} aborts every write and rolls back`,async()=>{
  const f=fixture(change);
  await assert.rejects(commitAcademicDuplicateScore({},f.writes,f.evidence,f.dependencies),{code:'ACADEMIC_DUPLICATE_CHANGED'});
  assert.equal(f.commits.length,0);assert.ok(f.calls.at(-1).url.endsWith(':rollback'));
});
test('atomic commit failure rolls back without retrying partial writes',async()=>{
  const f=fixture();let attempts=0;f.dependencies.commit=async()=>{attempts++;throw Object.assign(Error('Concurrent write'),{status:409});};
  await assert.rejects(commitAcademicDuplicateScore({},f.writes,f.evidence,f.dependencies),{status:409});
  assert.equal(attempts,1);assert.ok(f.calls.at(-1).url.endsWith(':rollback'));
});
