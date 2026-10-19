import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { objectToFirestoreFields } from '../functions/lib/firestore.js';
const source=await readFile(new URL('../functions/lib/firestore.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function batchWritePrecondition'),source.indexOf('export async function batchCommitLiteralDocuments')).replace('export ','');
function fixture(){
  const requests=[];
  const ctx=vm.createContext({TextEncoder,objectToFirestoreFields,clean:v=>String(v??'').trim(),
    getFirestoreAccessToken:async()=> 'test-only',firestoreBaseUrl:()=> 'https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents',
    fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({writeResults:[]})};}});
  vm.runInContext(body,ctx);return {requests,commit:ctx.batchCommitDocuments};
}
test('opted-in large reservations use one atomic commit retaining every version precondition',async()=>{
  const f=fixture(),writes=Array.from({length:604},(_,i)=>({collectionPath:'vendorClaimLots',documentId:`lot-${i}`,data:{ReservedCents:500},updateTime:`version-${i}`}));
  await assert.rejects(f.commit({},writes),/500 writes/);
  await f.commit({},writes,{allowLargeAtomicBatch:true});
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].writes.length,604);
  assert.equal(f.requests[0].writes[603].currentDocument.updateTime,'version-603');
});
test('large atomic writes fail before commit when document or request byte budgets would be exceeded',async()=>{
  const f=fixture();
  await assert.rejects(f.commit({},[{collectionPath:'requests',documentId:'r',data:{Notes:'x'.repeat(950*1024)}}],{allowLargeAtomicBatch:true}),{code:'DATABASE_ATOMIC_SIZE_LIMIT'});
  await assert.rejects(f.commit({},Array.from({length:11},(_,i)=>({collectionPath:'lots',documentId:`l-${i}`,data:{Notes:'x'.repeat(800*1024)}})),{allowLargeAtomicBatch:true}),{code:'DATABASE_ATOMIC_SIZE_LIMIT'});
  assert.equal(f.requests.length,0);
});
