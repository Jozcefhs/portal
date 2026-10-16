import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { commitWithReadChecks } from '../functions/lib/firestore-checked-commit.js';
import { objectToFirestoreFields } from '../functions/lib/firestore.js';
const base='https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents';
const name='projects/test/databases/(default)/documents/ledger/original';
const checks=[{collectionPath:'ledger',documentId:'original',updateTime:'r1'}];
const writes=[{collectionPath:'ledger',documentId:'refund',exists:false,data:{Credit:3500}}];
function fixture(transform=x=>x) {
  const calls=[];
  return {calls,deps:{ token:async()=>'test-token',base:()=>base,fetch:async(url,init)=>{
    const body=JSON.parse(init.body); calls.push({url,body});
    return {ok:true,json:async()=>transform([{transaction:'test-transaction'},{found:{name,updateTime:'r1'}}])};
  },commit:async(_e,w,o)=>{calls.push({writes:w,options:o});return {ok:true};}}};
}
test('read-write transaction locks evidence and commits only new/adjusted documents, not original receipts',async()=>{
  const f=fixture(); await commitWithReadChecks({},writes,checks,f.deps);
  assert.deepEqual(f.calls[0].body.newTransaction,{readWrite:{}});
  assert.deepEqual(f.calls[0].body.documents,[name]);
  assert.deepEqual(f.calls[1].options,{transaction:'test-transaction'});
  assert.deepEqual(f.calls[1].writes,writes);
});
test('changed, missing, duplicate and incomplete evidence aborts and rolls back without committing',async()=>{
  for(const transform of [rows=>[rows[0],{found:{name,updateTime:'r2'}}],rows=>[rows[0],{missing:name}],
    rows=>[rows[0]],rows=>[...rows,rows[1]]]) {
    const f=fixture(transform); await assert.rejects(commitWithReadChecks({},writes,checks,f.deps));
    assert(!f.calls.some(c=>c.writes)); assert(f.calls.at(-1).url.endsWith(':rollback'));
  }
});
test('commit conflicts are not swallowed or retried against changed evidence',async()=>{
  const f=fixture(); f.deps.commit=async()=>{throw new Error('Conflict');};
  await assert.rejects(commitWithReadChecks({},writes,checks,f.deps),/Conflict/);
  assert(f.calls.at(-1).url.endsWith(':rollback'));
});
test('batch commit forwards the read transaction while preserving existing conditional write behavior',async()=>{
  const source=await readFile(new URL('../functions/lib/firestore.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function batchWritePrecondition'),source.indexOf('export async function batchCommitLiteralDocuments')).replaceAll('export ','');
  const bodies=[];
  const commit=vm.runInNewContext(`${code}\nbatchCommitDocuments`,{clean:v=>String(v??'').trim(),getFirestoreAccessToken:async()=>'test',firestoreBaseUrl:()=>base,
    objectToFirestoreFields,fetch:async(_url,init)=>{bodies.push(JSON.parse(init.body));return{ok:true,json:async()=>({writeResults:[]})};}});
  await commit({},writes,{transaction:'test-transaction'}); await commit({},writes);
  assert.equal(bodies[0].transaction,'test-transaction'); assert(!Object.hasOwn(bodies[1],'transaction'));
  assert.deepEqual(bodies[0].writes[0].currentDocument,{exists:false});
});
