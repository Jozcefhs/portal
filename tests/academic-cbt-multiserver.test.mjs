import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as scorebook from '../functions/lib/academic-scorebook.js';
import { safeScopeId } from '../functions/lib/school-scope.js';
import { academicCbtScoreSources } from '../functions/lib/academic-cbt-multiserver.js';
import { ACADEMIC_MANAGEMENT_COLLECTIONS as collections, academicCbtScoreBatchDigest } from '../functions/lib/academic-management.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const actor = { username:'reviewer', role:'Super Admin', edition:'school', allowedSections:['academics'], branchId:'main' };
const env = { FIREBASE_PRIVATE_KEY:'test-only-signing-material', FIREBASE_PROJECT_ID:'test', DYNAMAX_WORKSPACE_ID:'school' };
const scope = { BranchId:'main', SchoolSection:'secondary', SessionId:'session', TermId:'term', ClassId:'class', ArmId:'arm', SubjectId:'maths' };
const scheme = scorebook.academicAssessmentScheme({Assessment:{
  Components:[{Id:'exam',Name:'Exam',MaximumScore:100,WeightPercentage:100,Required:true,SourceMode:'built-in-cbt'}],
  GradeBands:[{Grade:'A',MinimumPercentage:0,MaximumPercentage:100,GradePoint:5,Classification:'pass'}]
}}, {RevisionId:'revision'});

// Exercise the real signature, validation, score merge, preparation, commit,
// idempotency and CAS paths. Only scoped storage/context IO is in-memory.
function fixture() {
  const db = new Map(), commits = [];
  let revision = 0;
  const put = (collection,id,data) => db.set(`${collection}/${id}`, {...structuredClone(data),__updateTime:`r${++revision}`});
  const rows = collection => [...db].filter(([key])=>key.startsWith(`${collection}/`)).map(([,row])=>structuredClone(row));
  for(const ref of ['DCA/001','DCA/002','DCA/003']) put(collections.studentMemberships,ref.replace('/','-'),{
    ...scope, RecordId:ref.replace('/','-'), StudentRef:ref, Status:'Active'
  });
  const ctx = vm.createContext({...scorebook, academicCbtScoreSources, safeScopeId,
    crypto, TextEncoder,TextDecoder,btoa,atob,console,structuredClone,
    getDocument:async(_env,col,id)=>structuredClone(db.get(`${col}/${id}`) || null),
    batchCommitDocuments:async(_env,writes)=>{
      for(const w of writes) {
        const previous=db.get(`${w.collectionPath}/${w.documentId}`);
        if ((w.exists===false && previous) || (w.updateTime && previous?.__updateTime!==w.updateTime))
          throw Object.assign(new Error('Concurrent update'),{status:409});
      }
      for(const w of writes) {
        const previous=db.get(`${w.collectionPath}/${w.documentId}`);
        put(w.collectionPath,w.documentId,w.updateMask ? {...previous,...w.data} : w.data);
      }
      commits.push(structuredClone(writes));
      return {writeResults:writes.map(w=>({updateTime:db.get(`${w.collectionPath}/${w.documentId}`).__updateTime}))};
    }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,''),ctx);
  ctx.academicScoreSheetContext = async(_env,user,input)=>{
    ctx.requireWritableSubscription(user);
    const permissions=ctx.requireCapability(user,'canImportScores');
    ctx.assertUserSection(user,input.SchoolSection);
    assert.equal(input.BranchId,user.branchId);
    const state=Object.fromEntries(Object.entries(collections).map(([key,col])=>[key,rows(col)]));
    return {permissions,scope:{branchId:'main',section:'secondary'},state,SheetId:'sheet',
      existing:state.scoreSheets[0],scheme,
      session:{SessionId:'session'},term:{TermId:'term'},schoolClass:{ClassId:'class'},arm:{ArmId:'arm'},subject:{SubjectId:'maths'},
      allocation:{TeacherUsername:'teacher'},roster:state.studentMemberships};
  };
  const prepare=(payload,user=actor)=>ctx.syncAcademicCbtScores(env,user,{...payload,SupportsPreparedScoreCommit:true});
  const commit=(payload,preparation,user=actor)=>prepare({...payload,ScoreSyncPreparation:preparation.scoreSyncPreparation},user);
  return {ctx,db,commits,rows,put,prepare,commit,post:async payload=>{
    const prepared=await prepare(payload); return prepared.commitRequired ? commit(payload,prepared) : prepared;
  }};
}

async function server() {
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const der=await crypto.subtle.exportKey('spki',keys.publicKey);
  const id=Buffer.from(await crypto.subtle.digest('SHA-256',der)).toString('hex').slice(0,32);
  return { id, batch:async(scores,patch={})=>{
    const payload={...scope,Version:1,BatchId:crypto.randomUUID(),ExamId:'online-test',SourceTestId:'online-test',
      AssessmentComponentId:'exam',MaximumScore:100,SourceType:'BuiltInCBT',MarkingRevision:1,ApprovalStatus:'Approved',
      Scores:scores.map(([StudentRef,RawScore,AttemptId])=>({StudentRef,State:'Numeric',RawScore,AttemptId,AttemptStatus:'Submitted',SubmittedAt:'2026-10-18T10:00:00Z'})),...patch};
    payload.BatchDigest=await academicCbtScoreBatchDigest(payload);
    payload.SigningKeyId=id;
    payload.SigningPublicKey=`-----BEGIN PUBLIC KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PUBLIC KEY-----`;
    payload.SignatureAlgorithm='RSASSA-PKCS1-v1_5-SHA256';
    payload.Signature=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(payload.BatchDigest))).toString('base64url');
    return payload;
  }};
}
const [a,b]=await Promise.all([server(),server()]);

test('ICT can prepare and commit its own signed upload without a separate reviewer',async()=>{
  const f=fixture(),ict={...actor,role:'ICT',username:'ict-officer'};
  const payload=await a.batch([['DCA/001',81,'ict-attempt']]);
  const prepared=await f.prepare(payload,ict);
  assert.equal(prepared.commitRequired,true);
  const posted=await f.commit(payload,prepared,ict);
  assert.equal(posted.scoreSyncReceipt.ImportedRows,1);
  assert.equal(f.rows(collections.studentScores)[0].ComponentScores[0].RawScore,81);
});

test('independent servers merge different students into one scorebook without absence or centre assignments',async()=>{
  const f=fixture();
  const first=await a.batch([['DCA/001',81,'a1']]),second=await b.batch([['DCA/002',92,'b1']]);
  await f.post(first); await f.post(second);
  const scores=f.rows(collections.studentScores);
  assert.deepEqual(scores.map(r=>r.StudentRef).sort(),['DCA/001','DCA/002']);
  assert.deepEqual(scores.map(r=>r.ComponentScores[0].RawScore),[81,92]);
  assert.deepEqual(scores.map(r=>r.CbtScoreSources[0].SigningKeyId),[a.id,b.id]);
  assert.equal(f.rows(collections.scoreSyncBatches).length,2);
  assert.equal(f.rows(collections.scoreSheets)[0].RosterCount,3);
  const snapshot=JSON.stringify([...f.db]);
  await f.post(first); await f.post(second);
  assert.equal(JSON.stringify([...f.db]),snapshot,'Retries change no records or counts');
});

test('a second attempt is rejected per student while the other student posts, with duplicate-safe receipts',async()=>{
  for(const [origin,score,attempt] of [[b,81,'b1'],[b,70,'b2'],[a,81,'a2']]) {
    const f=fixture(); await f.post(await a.batch([['DCA/001',81,'a1']]));
    const original=JSON.stringify(f.rows(collections.studentScores)[0]);
    const duplicate=await origin.batch([['DCA/002',90,'new'],['DCA/001',score,attempt]]);
    const receipt=(await f.post(duplicate)).scoreSyncReceipt;
    assert.equal(receipt.ImportedRows,1); assert.equal(receipt.RejectedCount,1);
    assert.equal(receipt.RejectedScores[0].StudentRef,'DCA/001');
    assert.equal(JSON.stringify(f.rows(collections.studentScores).find(r=>r.StudentRef==='DCA/001')),original);
    assert.equal(f.rows(collections.studentScores).find(r=>r.StudentRef==='DCA/002').ComponentScores[0].RawScore,90);
    const snapshot=JSON.stringify([...f.db]);
    await f.post(duplicate);
    assert.equal(JSON.stringify([...f.db]),snapshot);
  }
});

test('concurrent centres reprepare against the latest sheet and never lose other results',async()=>{
  const f=fixture(),first=await a.batch([['DCA/001',81,'a1']]),second=await b.batch([['DCA/002',92,'b1']]);
  const [pa,pb]=await Promise.all([f.prepare(first),f.prepare(second)]);
  await f.commit(first,pa);
  await assert.rejects(f.commit(second,pb),{code:'ACADEMIC_WRITE_CONFLICT'});
  await f.post(second);
  assert.equal(f.rows(collections.studentScores).length,2);
  await f.commit(first,pa); // lost-success-response retry finds the committed receipt
  assert.equal(f.commits.length,2);
});

test('same-student concurrent preparations conflict on retry rather than overwrite',async()=>{
  const f=fixture(),first=await a.batch([['DCA/001',81,'a1']]),second=await b.batch([['DCA/001',81,'b1']]);
  const [pa,pb]=await Promise.all([f.prepare(first),f.prepare(second)]);
  await f.commit(first,pa);
  await assert.rejects(f.commit(second,pb),{code:'ACADEMIC_WRITE_CONFLICT'});
  const sheet=JSON.stringify(f.rows(collections.scoreSheets)), scores=JSON.stringify(f.rows(collections.studentScores));
  const result=await f.post(second);
  assert.equal(result.scoreSyncReceipt.ImportedRows,0); assert.equal(result.scoreSyncReceipt.RejectedCount,1);
  assert.equal(JSON.stringify(f.rows(collections.scoreSheets)),sheet);
  assert.equal(JSON.stringify(f.rows(collections.studentScores)),scores);
  assert.equal(f.rows(collections.studentScores)[0].CbtScoreSources[0].SigningKeyId,a.id);
});

test('genuine same-attempt marking corrections retain existing approval and cell-lock requirements',async()=>{
  const f=fixture(); await f.post(await a.batch([['DCA/001',81,'a1']]));
  const correction=await a.batch([['DCA/001',82,'a1']],{MarkingRevision:2});
  await assert.rejects(f.post(correction),{code:'ACADEMIC_SCORE_CELL_LOCKED'});
  f.put(collections.scoreSheets,'sheet',{...f.rows(collections.scoreSheets)[0],ScoreEditingReactivated:true});
  await f.post(correction);
  assert.equal(f.rows(collections.studentScores)[0].ComponentScores[0].RawScore,82);
  assert.equal(f.rows(collections.scoreSheets)[0].ScoreEditingReactivated,false);
});

test('server signature, reviewer permission, scope, roster and prepared membership checks still apply',async()=>{
  const f=fixture(),payload=await a.batch([['DCA/001',81,'a1']]);
  await assert.rejects(f.prepare({...payload,SigningKeyId:b.id}),{code:'ACADEMIC_CBT_SIGNATURE_INVALID'});
  await assert.rejects(f.prepare({...payload,Signature:payload.Signature.slice(4)}),{code:'ACADEMIC_CBT_SIGNATURE_INVALID'});
  await assert.rejects(f.prepare({...payload,Scores:[{...payload.Scores[0],RawScore:99}]}),{code:'ACADEMIC_CBT_SCORE_DIGEST_INVALID'});
  await assert.rejects(f.prepare(payload,{...actor,allowedSections:[],role:'Vendor'}),{status:403});
  await assert.rejects(f.post(await a.batch([['DCA/999',81,'x']])),{code:'ACADEMIC_CBT_SCORE_BATCH_INVALID'});
  const prepared=await f.prepare(payload);
  await assert.rejects(f.commit(payload,prepared,{...actor,schoolSectionAccess:'primary'}),{code:'ACADEMIC_SECTION_FORBIDDEN'});
  await assert.rejects(f.commit(payload,prepared,{...actor,branchId:'other'}),{code:'ACADEMIC_BRANCH_FORBIDDEN'});
  await assert.rejects(f.commit(payload,prepared,{...actor,subscriptionReadOnly:true}),{code:'SUBSCRIPTION_READ_ONLY'});
  f.put(collections.studentMemberships,'DCA-001',{...f.rows(collections.studentMemberships)[0],ArmId:'other'});
  await assert.rejects(f.commit(payload,prepared),{code:'ACADEMIC_WRITE_CONFLICT'});
  assert.equal(f.rows(collections.studentScores).length,0);
});

test('an existing batch ID cannot be reused by a different signing server',async()=>{
  const f=fixture(),first=await a.batch([['DCA/001',81,'a1']]); await f.post(first);
  const clone=await b.batch([['DCA/001',81,'a1']],{BatchId:first.BatchId});
  assert.equal(clone.BatchDigest,first.BatchDigest);
  await assert.rejects(f.post(clone),{code:'ACADEMIC_CBT_SYNC_KEY_REUSED'});
});

test('a concurrent batch-ID collision from another signer is not mistaken for a successful retry',async()=>{
  const f=fixture(),first=await a.batch([['DCA/001',81,'a1']]);
  const clone=await b.batch([['DCA/001',81,'a1']],{BatchId:first.BatchId});
  const [pa,pb]=await Promise.all([f.prepare(first),f.prepare(clone)]);
  await f.commit(first,pa);
  await assert.rejects(f.commit(clone,pb),{code:'ACADEMIC_WRITE_CONFLICT'});
  assert.equal(f.rows(collections.scoreSyncBatches)[0].SigningKeyId,a.id);
});

test('legacy provenance permits original-server compatibility but protects existing manual or other-server results',()=>{
  const previous={SheetId:'sheet',ScoreId:'score',ComponentScores:[{ComponentId:'exam',State:'Numeric',RawScore:80}]};
  const component=scheme.Components[0],row={StudentRef:'DCA/001',AttemptId:'a1'},input={SourceTestId:'test'};
  const history=[{SourceType:'BuiltInCBT',SheetId:'sheet',AssessmentComponentId:'exam',AffectedScoreIds:['score'],SigningKeyId:a.id,SourceTestId:'test'}];
  const result=academicCbtScoreSources(previous,component,row,input,a.id,'sync',history);
  assert.equal(result[0].AttemptId,'a1');
  assert.throws(()=>academicCbtScoreSources(previous,component,row,input,b.id,'sync',history),{code:'ACADEMIC_CBT_SYNC_ATTEMPT_CONFLICT'});
  assert.throws(()=>academicCbtScoreSources(previous,component,row,input,a.id,'sync',[]),{code:'ACADEMIC_CBT_SYNC_ATTEMPT_CONFLICT'});
  assert.throws(()=>academicCbtScoreSources(null,component,{...row,AttemptId:''},input,a.id,'sync'),{code:'ACADEMIC_CBT_SYNC_ATTEMPT_REQUIRED'});
});

test('split-paper provenance protects only the objective cell and preserves other component sources',()=>{
  const previous={ComponentScores:[{ComponentId:'exam',Parts:[{PartId:'theory',State:'Numeric',RawScore:20}]}],
    CbtScoreSources:[{CellId:'ca',SigningKeyId:b.id,AttemptId:'older'}]};
  const result=academicCbtScoreSources(previous,{Id:'exam',ScoreEntryMode:'objective-theory'},
    {StudentRef:'DCA/001',AttemptId:'a1'},{ExamId:'exam'},a.id,'sync');
  assert.equal(result.length,2);
  assert.equal(result[0].CellId,'ca');
  assert.equal(result[1].CellId,'exam:objective');
  assert.equal(previous.ComponentScores[0].Parts[0].RawScore,20);
});
