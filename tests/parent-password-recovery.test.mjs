import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {hashParentPassword,verifyParentPasswordHash} from '../functions/lib/parent-auth.js';
import {requiredDeploymentIdentity} from '../functions/lib/deployment-identity.js';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8'),unmodule=s=>s.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm,'').replace(/^export /gm,'');
const [authSource,recoverySource,apiSource]=await Promise.all(['functions/lib/parent-auth.js','functions/lib/parent-password-recovery.js','functions/api/parent-password-recovery.js'].map(read));
async function fixture(){
  const env={FIREBASE_PROJECT_ID:'test-project',DYNAMAX_WORKSPACE_ID:'test-school',ORGANISATION_EDITION:'school',PARENT_SESSION_SECRET:'test-only-parent-session-secret'},docs=new Map(),emails=[],reads=[],batches=[],pending=[];let revision=0;
  const clone=v=>v==null?null:structuredClone(v),put=(path,id,row)=>docs.set(path+'/'+id,{...clone(row),__id:id,__updateTime:`r${++revision}`});
  const getDocument=async(_env,path,id)=>{reads.push(path+'/'+id);return clone(docs.get(path+'/'+id));};
  const batchCommitLiteralDocuments=async(_env,writes)=>{for(const w of writes){const row=docs.get(w.collectionPath+'/'+w.documentId);if(w.exists===false&&row||w.updateTime&&w.updateTime!==row?.__updateTime)throw Object.assign(Error('Conflict'),{status:412});}batches.push(clone(writes));for(const w of writes)put(w.collectionPath,w.documentId,w.updateMask?{...docs.get(w.collectionPath+'/'+w.documentId),...w.data}:w.data);};
  put('parentCredentials','parent@example.com',{Email:'parent@example.com',...await hashParentPassword('OldParentPass9'),CreatedAt:'2026-01-01',CustomField:'preserve'});put('students','example',{ParentEmail:'parent@example.com',Scores:['unchanged'],BranchId:'main'});
  const common={crypto,Date,TextEncoder,TextDecoder,Uint8Array,btoa,atob,console,getDocument,batchCommitLiteralDocuments};const auth=vm.createContext(common);vm.runInContext(unmodule(authSource),auth);
  const recovery=vm.createContext({...common,getParentCredential:auth.getParentCredential,hashParentPassword,parentCredentialId:auth.parentCredentialId,requiredDeploymentIdentity,sendConfiguredEmail:async(_env,message)=>emails.push(message),escapeEmailHtml:v=>v});vm.runInContext(unmodule(recoverySource),recovery);
  const api=vm.createContext({...common,Response,URL,requireFirestoreEnv:()=>{},consumeRequestAllowance:async()=>({allowed:true}),readJsonBody:(r)=>r.json(),requestParentPasswordRecovery:recovery.requestParentPasswordRecovery,resetParentPassword:recovery.resetParentPassword,parentRecoveryEmail:recovery.parentRecoveryEmail,PARENT_RECOVERY_MESSAGE:'Generic recovery acknowledgement',clearParentSessionCookie:auth.clearParentSessionCookie});vm.runInContext(unmodule(apiSource),api);
  const request=(body,headers={})=>new Request('https://school.test/api/parent-password-recovery',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://school.test',...headers},body:JSON.stringify(body)});
  const post=body=>api.onRequestPost({env,request:request(body),waitUntil:p=>pending.push(p)}),code=()=>emails.at(-1)?.textContent.match(/[a-f0-9]{48}/)?.[0];
  return {env,docs,put,emails,reads,batches,pending,auth,recovery,api,request,post,code,batchCommitLiteralDocuments};
}
test('parent recovery sends only to the stored login email and reads no student or financial history',async()=>{
  const f=await fixture(),before=structuredClone(f.docs.get('parentCredentials/parent@example.com'));await f.recovery.requestParentPasswordRecovery(f.env,' PARENT@EXAMPLE.COM ');assert.equal(f.emails[0].toEmail,'parent@example.com');assert.match(f.code(),/^[a-f0-9]{48}$/);assert.deepEqual(f.docs.get('parentCredentials/parent@example.com'),before);assert.ok(f.reads.every(path=>path.startsWith('parent')));assert.ok(!JSON.stringify([...f.docs]).includes(f.code()));
});
test('reset atomically preserves records, uses salted passwords and invalidates old sessions',async()=>{
  const f=await fixture(),old=await f.auth.createParentSession(f.env,'parent@example.com'),session=t=>new Request('https://school.test/',{headers:{Cookie:f.auth.parentSessionCookie(t)}}),student=structuredClone(f.docs.get('students/example'));
  assert.ok(await f.auth.readParentSession(f.env,session(old)));await f.recovery.requestParentPasswordRecovery(f.env,'parent@example.com');await f.recovery.resetParentPassword(f.env,f.code(),'NewParentPass9');
  const row=f.docs.get('parentCredentials/parent@example.com');assert.ok(await verifyParentPasswordHash(row,'NewParentPass9'));assert.equal(await verifyParentPasswordHash(row,'OldParentPass9'),false);assert.equal(row.CustomField,'preserve');assert.equal(row.CreatedAt,'2026-01-01');assert.deepEqual(f.docs.get('students/example'),student);assert.equal(await f.auth.readParentSession(f.env,session(old)),null);
  assert.ok(await f.auth.readParentSession(f.env,session(await f.auth.createParentSession(f.env,'parent@example.com'))));assert.equal(f.batches.at(-1).length,3);assert.equal([...f.docs.keys()].filter(k=>k.startsWith('staffSecurityAudit/')).length,1);
});
test('a recovery code is single-use under concurrency and no reset can partially write',async()=>{
  const f=await fixture();await f.recovery.requestParentPasswordRecovery(f.env,'parent@example.com');const results=await Promise.allSettled([f.recovery.resetParentPassword(f.env,f.code(),'NewParentPass9'),f.recovery.resetParentPassword(f.env,f.code(),'SecondParentPass9')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal([...f.docs.keys()].filter(k=>k.startsWith('staffSecurityAudit/')).length,1);await assert.rejects(f.recovery.resetParentPassword(f.env,f.code(),'RetryParentPass9'),/already used/);
});
test('expired, changed-account and wrong-workspace tokens cannot reset a password',async()=>{
  for(const mode of ['expired','changed','workspace']){const f=await fixture();await f.recovery.requestParentPasswordRecovery(f.env,'parent@example.com');if(mode==='expired'){const [key,row]=[...f.docs].find(([k])=>k.startsWith('parentPasswordRecovery/'));f.put('parentPasswordRecovery',key.split('/')[1],{...row,ExpiresAt:'2020-01-01'});}if(mode==='changed'){const row=f.docs.get('parentCredentials/parent@example.com');f.put('parentCredentials','parent@example.com',{...row,SessionEpoch:'changed'});}const before=structuredClone([...f.docs]);await assert.rejects(f.recovery.resetParentPassword({...f.env,...(mode==='workspace'?{DYNAMAX_WORKSPACE_ID:'another-school'}:{})},f.code(),'NewParentPass9'),/invalid/);assert.deepEqual([...f.docs],before);}
});
test('per-account throttling limits repeat recovery mail without repeated credential reads',async()=>{
  const f=await fixture();await f.recovery.requestParentPasswordRecovery(f.env,'parent@example.com');const reads=f.reads.length,commits=f.batches.length;await f.recovery.requestParentPasswordRecovery(f.env,'parent@example.com');assert.equal(f.emails.length,1);assert.equal(f.reads.length,reads+1);assert.equal(f.batches.length,commits);
});
test('public responses do not enumerate accounts and malformed emails receive useful guidance',async()=>{
  const f=await fixture(),a=await f.post({email:'parent@example.com'}),b=await f.post({email:'unknown@example.com'});assert.deepEqual(await a.json(),await b.json());await Promise.all(f.pending);assert.equal(f.emails.length,1);const invalid=await f.post({email:'@DCA/22/1076'});assert.equal(invalid.status,400);assert.match((await invalid.json()).message,/admission number/);
});
test('recovery endpoint enforces origin, JSON, IP limits and clears the browser cookie after reset',async()=>{
  const f=await fixture();assert.equal((await f.api.onRequestPost({env:f.env,request:f.request({email:'parent@example.com'},{Origin:'https://evil.test'})})).status,403);assert.equal((await f.api.onRequestPost({env:f.env,request:f.request({},{'Content-Type':'text/plain'})})).status,415);
  f.api.consumeRequestAllowance=async()=>({allowed:false});assert.equal((await f.post({email:'parent@example.com'})).status,429);f.api.consumeRequestAllowance=async()=>({allowed:true});await f.recovery.requestParentPasswordRecovery(f.env,'parent@example.com');const reset=await f.post({action:'reset',code:f.code(),password:'NewParentPass9'});assert.equal(reset.status,200);assert.match(reset.headers.get('Set-Cookie'),/Max-Age=0/);
});
test('concurrent account changes and lost reset responses never duplicate audits or overwrite a newer credential',async()=>{
  for(const mode of ['conflict','lost']){const f=await fixture();await f.recovery.requestParentPasswordRecovery(f.env,'parent@example.com');const commit=f.batchCommitLiteralDocuments;f.recovery.batchCommitLiteralDocuments=async(...args)=>{if(mode==='conflict'){const row=f.docs.get('parentCredentials/parent@example.com');f.put('parentCredentials','parent@example.com',{...row,SessionEpoch:'admin-change'});}await commit(...args);if(mode==='lost')throw Error('Lost response');};await assert.rejects(f.recovery.resetParentPassword(f.env,f.code(),'NewParentPass9'));
    const audits=[...f.docs.keys()].filter(k=>k.startsWith('staffSecurityAudit/'));assert.equal(audits.length,mode==='lost'?1:0);assert.equal(await verifyParentPasswordHash(f.docs.get('parentCredentials/parent@example.com'),'NewParentPass9'),mode==='lost');}
});
test('invalid cookies make no database reads and valid sessions use one exact credential lookup',async()=>{
  const f=await fixture();assert.equal(await f.auth.readParentSession(f.env,new Request('https://school.test/')),null);assert.equal(f.reads.length,0);const token=await f.auth.createParentSession(f.env,'parent@example.com');const before=f.reads.length;await f.auth.readParentSession(f.env,new Request('https://school.test/',{headers:{Cookie:f.auth.parentSessionCookie(token)}}));assert.equal(f.reads.length,before+1);
});
test('recovery secrets are excluded from backups and middleware avoids a duplicate audit',async()=>{
  const backup=await read('functions/lib/organization-backup.js'),audit=await read('functions/lib/security-audit.js');assert.match(backup,/'parentPasswordRecovery'/);assert.match(backup,/'parentPasswordRecoveryLimits'/);assert.match(audit,/parent-password-recovery.*return false/);
});
test('a password change during sign-in cannot mint a session with the new credential epoch',async()=>{
  const f=await fixture();const started=Date.now()-1000;await f.recovery.requestParentPasswordRecovery(f.env,'parent@example.com');await f.recovery.resetParentPassword(f.env,f.code(),'NewParentPass9');await assert.rejects(f.auth.createParentSession(f.env,'parent@example.com',{authenticatedAfter:started}),/changed while signing in/);
});
