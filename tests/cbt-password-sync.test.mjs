import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { hashStudentPassword, verifyStudentPasswordHash, studentLoginCredentialCollection, studentLoginCredentialId } from '../functions/lib/student-login-credentials.js';

const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
const endpoint=source.slice(source.indexOf('export async function syncLocalCbtStudentPasswords('),source.indexOf('export async function grantAcademicResultClearance(')).replace('export ','');
function fixture(){
  const saved=new Map();let revision=0, conflict=false;
  const ctx=vm.createContext({Date,Set,Number,Promise,clean:v=>String(v??'').trim(),lower:v=>String(v??'').trim().toLowerCase(),
    nowIso:()=>new Date().toISOString(),statusActive:r=>r.Status==='Active',actorName:()=> 'ICT officer',
    failure:(message,status,code)=>Object.assign(new Error(message),{status,code}),
    academicOperationalContext:async()=>({permissions:{canReviewScores:true},scope:{branchId:'main',section:'secondary'},session:{SessionId:'s'},term:{TermId:'t'},
      state:{studentMemberships:[{StudentRef:'DCA/1',SessionId:'s',TermId:'t',Status:'Active'}]}}),
    studentLoginCredentialCollection,studentLoginCredentialId,
    getDocuments:async(_env,_col,ids)=>ids.map(id=>structuredClone(saved.get(id)||null)),
    auditWrite:()=>({collectionPath:'audit',documentId:'audit',data:{}}),
    commitAcademicBatch:async(_env,writes)=>{
      if(conflict) throw Object.assign(new Error('Credential changed'),{code:'ACADEMIC_WRITE_CONFLICT'});
      for(const w of writes.filter(w=>w.collectionPath!=='audit')){
        const prev=saved.get(w.documentId); assert.ok(w.exists===false ? !prev : prev?.__updateTime===w.updateTime);
      }
      for(const w of writes.filter(w=>w.collectionPath!=='audit')) saved.set(w.documentId,{...w.data,__updateTime:`r${++revision}`});
    }});
  vm.runInContext(endpoint,ctx);
  return {saved,ctx,conflict:()=>{conflict=true;},post:rows=>ctx.syncLocalCbtStudentPasswords({}, {}, {PasswordUpdates:rows})};
}
test('a CBT password synchronizes to a verifiable online credential; retries do not overwrite newer passwords',async()=>{
  const f=fixture(),id=await studentLoginCredentialId('DCA/1');
  const first={StudentRef:'DCA/1',Password:await hashStudentPassword('first-pass'),PasswordChangedAt:'2026-10-19T10:00:00Z'};
  assert.deepEqual(Array.from((await f.post([first])).synchronizedStudentRefs),['DCA/1']);
  assert.equal(await verifyStudentPasswordHash(f.saved.get(id),'first-pass'),true);
  const before=JSON.stringify([...f.saved]); await f.post([first]); assert.equal(JSON.stringify([...f.saved]),before);
  const next={...first,Password:await hashStudentPassword('newer-pass'),PasswordChangedAt:'2026-10-19T11:00:00Z'};
  await f.post([next]); const updated=JSON.stringify([...f.saved]);
  assert.deepEqual(Array.from((await f.post([first])).supersededStudentRefs),['DCA/1']);
  assert.equal(JSON.stringify([...f.saved]),updated);
  assert.equal(await verifyStudentPasswordHash(f.saved.get(id),'newer-pass'),true);
});
test('password sync retains scope, verifier validation and concurrent-change guards',async()=>{
  const f=fixture(),row={StudentRef:'DCA/1',Password:await hashStudentPassword('secure-pass')};
  await assert.rejects(f.post([{...row,StudentRef:'OTHER'}]),{code:'ACADEMIC_CBT_PASSWORD_STUDENT_FORBIDDEN'});
  await assert.rejects(f.post([{...row,Password:{PasswordHash:'plaintext'}}]),{code:'ACADEMIC_CBT_PASSWORD_VERIFIER_INVALID'});
  assert.equal(f.saved.size,0);f.conflict();
  await assert.rejects(f.post([row]),{code:'ACADEMIC_WRITE_CONFLICT'});assert.equal(f.saved.size,0);
});
