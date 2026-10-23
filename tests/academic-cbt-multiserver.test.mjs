import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as scorebook from '../functions/lib/academic-scorebook.js';
import { safeScopeId } from '../functions/lib/school-scope.js';
import { academicCbtScoreSources } from '../functions/lib/academic-cbt-multiserver.js';
import { buildAcademicClassScoreRegister } from '../functions/lib/academic-class-score-register.js';
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
function fixture({ realSheetIds = false, assessment = scheme, environment = env, realContext = false } = {}) {
  const db = new Map(), commits = [], delays = [];
  let revision = 0;
  const put = (collection,id,data) => db.set(`${collection}/${id}`, {...structuredClone(data),__updateTime:`r${++revision}`});
  const rows = collection => [...db].filter(([key])=>key.startsWith(`${collection}/`)).map(([,row])=>structuredClone(row));
  for(const ref of ['DCA/001','DCA/002','DCA/003']) put(collections.studentMemberships,ref.replace('/','-'),{
    ...scope, RecordId:ref.replace('/','-'), StudentRef:ref, Status:'Active'
  });
  const ctx = vm.createContext({...scorebook, academicCbtScoreSources, safeScopeId,
    crypto, TextEncoder,TextDecoder,btoa,atob,console,structuredClone,
    setTimeout:(callback,delay)=>{ delays.push(delay); return setTimeout(callback,0); },
    getDocument:async(_env,col,id)=>structuredClone(db.get(`${col}/${id}`) || null),
    getDocuments:async(_env,col,ids)=>ids.map(id=>structuredClone(db.get(`${col}/${id}`) || null)),
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
  const mockContext = async(_env,user,input,capability='canImportScores')=>{
    ctx.requireWritableSubscription(user);
    const permissions=ctx.requireCapability(user,capability);
    ctx.assertUserSection(user,input.SchoolSection);
    assert.equal(input.BranchId,user.branchId);
    const state=Object.fromEntries(Object.entries(collections).map(([key,col])=>[key,rows(col)]));
    const SheetId=realSheetIds ? ctx.academicScoreSheetId({branchId:'main',section:'secondary'},input.SessionId,input.TermId,input.ClassId,input.ArmId,input.SubjectId) : 'sheet';
    return {permissions,scope:{branchId:'main',section:'secondary'},state,SheetId,
      existing:state.scoreSheets.find(row=>row.SheetId===SheetId),scheme:assessment,
      session:{SessionId:input.SessionId},term:{TermId:input.TermId},schoolClass:{ClassId:input.ClassId},arm:{ArmId:input.ArmId},subject:{SubjectId:input.SubjectId},
      allocation:{TeacherUsername:'teacher'},roster:state.studentMemberships};
  };
  if (realContext) {
    ctx.academicOperationalContext = mockContext;
    ctx.academicAssessmentForPeriod = async()=>assessment;
  } else ctx.academicScoreSheetContext = mockContext;
  const prepare=(payload,user=actor)=>ctx.syncAcademicCbtScores(environment,user,{...payload,SupportsPreparedScoreCommit:true});
  const commit=(payload,preparation,user=actor)=>prepare({...payload,ScoreSyncPreparation:preparation.scoreSyncPreparation},user);
  return {ctx,db,commits,delays,rows,put,prepare,commit,post:async payload=>{
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

function placementFixture() {
  const f=fixture({realContext:true,realSheetIds:true});
  f.put(collections.classes,'class',{RecordId:'class',ClassId:'class',Name:'Grade 9',Status:'Active',SchoolSection:'secondary'});
  f.put(collections.subjects,'maths',{RecordId:'maths',SubjectId:'maths',Name:'Maths',Status:'Active',SchoolSection:'secondary'});
  for (const id of ['arm','merit']) f.put(collections.arms,id,{RecordId:id,ArmId:id,ClassId:'class',Name:id,Status:'Active'});
  f.put(collections.teacherAllocations,'teacher',{...scope,RecordId:'teacher',AllocationRole:'Subject teacher',TeacherUsername:'teacher',Status:'Active'});
  return f;
}

test('current class placement resolves missing/stale arms and missing subject selections without altering membership',async()=>{
  const f=placementFixture();
  f.put(collections.studentMemberships,'DCA-001',{...scope,RecordId:'DCA-001',StudentRef:'DCA/001',ArmId:'merit',SubjectIds:[],Status:'Active'});
  f.put(collections.studentMemberships,'DCA-002',{...scope,RecordId:'DCA-002',StudentRef:'DCA/002',ArmId:'',SubjectIds:[],Status:'Active'});
  f.put(collections.studentMemberships,'DCA-003',{...scope,RecordId:'DCA-003',StudentRef:'DCA/003',ArmId:'removed-arm',SubjectIds:[],Status:'Active'});
  const before=JSON.stringify([...f.db]);
  const result=await f.ctx.resolveAcademicCbtScorePlacement(env,actor,{...scope,StudentRefs:['DCA/001','DCA/002','DCA/003','DCA/999']});
  assert.deepEqual(JSON.parse(JSON.stringify(result.scoreUploadPlacements.slice(0,3))),[
    {StudentRef:'DCA/001',Ready:true,ArmId:'merit',ClassOnly:false},
    {StudentRef:'DCA/002',Ready:true,ArmId:'',ClassOnly:true},
    {StudentRef:'DCA/003',Ready:true,ArmId:'',ClassOnly:true}]);
  assert.equal(result.scoreUploadPlacements[3].Ready,false);
  assert.equal(JSON.stringify([...f.db]),before);
  await f.post(await a.batch([['DCA/001',81,'a1']],{ArmId:'merit'}));
  await f.post(await a.batch([['DCA/002',62,'a2'],['DCA/003',73,'a3']],{ArmId:''}));
  assert.equal(f.rows(collections.studentScores).length,3);
  const data=Object.fromEntries(Object.entries(collections).map(([key,col])=>[key,f.rows(col)]));
  const register=buildAcademicClassScoreRegister(data,scope);
  assert.equal(register.Rows.find(row=>row.StudentRef==='DCA/002').Cells[0].RawScore,62);
  assert.equal(register.Rows.find(row=>row.StudentRef==='DCA/001').Cells[0].RawScore,81);
});

test('class-only scores move to a later arm on retry with no duplicate, rescore, or broken earlier receipt',async()=>{
  const f=placementFixture();
  const original=await a.batch([['DCA/001',81,'a1']],{ArmId:''});
  await f.post(original);
  const saved=f.rows(collections.studentScores)[0],id=saved.ScoreId;
  f.put(collections.studentMemberships,'DCA-001',{...f.rows(collections.studentMemberships)[0],ArmId:'merit'});
  const placed=await a.batch([['DCA/001',81,'a1']],{ArmId:'merit'});
  const receipt=(await f.post(placed)).scoreSyncReceipt;
  assert.equal(receipt.VerifiedOnline,true);
  assert.equal(f.rows(collections.studentScores).length,1);
  const moved=f.rows(collections.studentScores)[0];
  assert.equal(moved.ScoreId,id); assert.equal(moved.ArmId,'merit');
  assert.equal(moved.ComponentScores[0].RawScore,81);
  assert.equal(moved.OriginalClassOnlySheetId,saved.SheetId);
  const before=JSON.stringify([...f.db]);
  await f.post(original); await f.post(placed);
  assert.equal(JSON.stringify([...f.db]),before);
  assert.equal(f.rows(collections.scoreSheets).find(row=>!row.ArmId).EnteredCount,0);
  await assert.rejects(f.post(await b.batch([['DCA/001',99,'second-centre']],{ArmId:''})),
    {code:'ACADEMIC_CBT_SYNC_NO_SCORES_SAVED'});
  assert.equal(JSON.stringify([...f.db]),before);
});

test('an existing result in any arm rejects only its student; new marks can be held when the target sheet is closed',async()=>{
  const f=placementFixture();
  await f.post(await a.batch([['DCA/001',81,'a1']]));
  const sheet=f.rows(collections.scoreSheets)[0];
  f.put(collections.scoreSheets,sheet.SheetId,{...sheet,Status:'Submitted'});
  const placement=await f.ctx.resolveAcademicCbtScorePlacement(env,actor,{...scope,StudentRefs:['DCA/001','DCA/002']});
  assert.ok(placement.scoreUploadPlacements.every(row=>row.Ready && row.ClassOnly));
  const receipt=(await f.post(await b.batch([['DCA/001',99,'b1'],['DCA/002',63,'b2']],{ArmId:''}))).scoreSyncReceipt;
  assert.equal(receipt.ImportedRows,1); assert.equal(receipt.RejectedCount,1);
  assert.equal(f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/001').ComponentScores[0].RawScore,81);
  assert.equal(f.rows(collections.scoreSheets).find(row=>row.SheetId===sheet.SheetId).Status,'Submitted');
});

test('two centres cannot save duplicate class-only and assigned-arm scores concurrently',async()=>{
  const f=placementFixture();
  const original=await a.batch([['DCA/001',81,'a1']],{ArmId:''}), other=await b.batch([['DCA/001',99,'b1']]);
  const [pa,pb]=await Promise.all([f.prepare(original),f.prepare(other)]);
  await f.commit(original,pa);
  const response=await f.commit(other,pb), receipt=response.scoreSyncReceipt;
  assert.equal(response.automaticScoreRetries,1);
  assert.equal(receipt.ImportedRows,0); assert.equal(receipt.AlreadyRecordedCount,1);
  assert.equal(f.rows(collections.studentScores).length,1);
});

const frenchScope = { ...scope, SessionId:'session__main__secondary__2026-2027',
  TermId:'session__main__secondary__2026-2027__term__secondary__first-term',
  ClassId:'class__main__secondary__grade-9', SubjectId:'subject__main__secondary__fre',
  AssessmentComponentId:'ca1', MaximumScore:10,
  SourceTestId:'cbt-test-6df1ba297013ad79f1e8ea566d366fd6ca4986c725476fd09a4986d8562f2a30' };
const frenchEnv = { ...env, FIREBASE_PROJECT_ID:'school-management-suite-27064' };
const frenchScheme = scorebook.academicAssessmentScheme({Assessment:{
  Components:[{Id:'ca1',Name:'CA1',MaximumScore:100,WeightPercentage:10,Required:true,SourceMode:'built-in-cbt'},
    {Id:'exam',Name:'Exam',MaximumScore:100,WeightPercentage:90,Required:true,SourceMode:'built-in-cbt'}],
  GradeBands:scheme.GradeBands
}}, {RevisionId:'revision'});
function frenchFixture(options = {}) {
  const f = fixture({assessment:frenchScheme,environment:frenchEnv,...options});
  for (const row of f.rows(collections.studentMemberships)) f.put(collections.studentMemberships,row.RecordId,{...row,...frenchScope});
  return f;
}

test('authorised French upload scales /10 to /100 once and retains original signed marks and other components',async()=>{
  const f=frenchFixture();
  await f.post(await a.batch([['DCA/001',80,'exam-attempt']],{...frenchScope,AssessmentComponentId:'exam',MaximumScore:100,SourceTestId:'another-exam'}));
  const beforeExam=structuredClone(f.rows(collections.studentScores)[0].ComponentScores.find(row=>row.ComponentId==='exam'));
  const payload=await a.batch([['DCA/001',7.5,'f1'],['DCA/002',0,'f2'],['DCA/003',10,'f3']],frenchScope);
  const original=JSON.stringify(payload);
  const prepared=await f.prepare(payload);
  assert.equal(f.commits.length,1,'Preparation does not save or report success');
  const result=await f.commit(payload,prepared);
  assert.equal(JSON.stringify(payload),original,'Original signed scores are immutable');
  const receipt=result.scoreSyncReceipt;
  assert.equal(receipt.VerifiedOnline,true);
  assert.equal(receipt.VerifiedRows,3);
  assert.equal(receipt.MaximumScore,100);
  assert.equal(receipt.BatchDigest,payload.BatchDigest);
  assert.deepEqual({...receipt.ScoreConversion},{RuleId:'dca-grade9-french-ca1-2026-term1-10-to-100-v1',SourceMaximumScore:10,TargetMaximumScore:100,Factor:10});
  const saved=f.rows(collections.studentScores);
  for (const [ref,raw,target] of [['DCA/001',7.5,75],['DCA/002',0,0],['DCA/003',10,100]]) {
    const score=saved.find(row=>row.StudentRef===ref),cell=score.ComponentScores.find(row=>row.ComponentId==='ca1');
    assert.equal(cell.RawScore,target);
    const evidence=score.CbtScoreSources.find(row=>row.CellId==='ca1');
    assert.equal(evidence.OriginalRawScore,raw);
    assert.equal(evidence.OriginalBatchDigest,payload.BatchDigest);
    assert.equal(evidence.ScoreConversion.SourceMaximumScore,10);
  }
  assert.deepEqual(saved[0].ComponentScores.find(row=>row.ComponentId==='exam'),beforeExam);
  const before=JSON.stringify([...f.db]);
  await f.post(payload);
  await f.commit(payload,prepared); // Duplicate commit after a lost response.
  assert.equal(JSON.stringify([...f.db]),before);
  assert.equal(f.commits.length,2);
});

test('French conversion still rejects invalid /10 marks individually and handles absence',async()=>{
  for (const invalid of [11,-1,'bad',null]) {
    const f=frenchFixture();
    const payload=await a.batch([],{...frenchScope,Scores:[
      {StudentRef:'DCA/001',State:'Numeric',RawScore:7.25,AttemptId:'a1'},
      {StudentRef:'DCA/002',State:'Numeric',RawScore:invalid,AttemptId:'a2'},
      {StudentRef:'DCA/003',State:'Absent',RawScore:null,AttemptId:'a3'}]});
    const {scoreSyncReceipt:receipt}=await f.post(payload);
    assert.equal(receipt.ImportedRows,2); assert.equal(receipt.RejectedCount,1);
    assert.equal(receipt.RejectedScores[0].StudentRef,'DCA/002');
    assert.equal(f.rows(collections.studentScores)[0].ComponentScores.find(row=>row.ComponentId==='ca1').RawScore,72.5);
    assert.equal(f.rows(collections.studentScores)[1].CbtScoreSources[0].OriginalRawScore,null);
    await f.post(payload);
    assert.equal(f.commits.length,1);
  }
});

test('French conversion never applies to another school, period, paper, class, subject, component or source',async()=>{
  for (const [key,value] of [['FIREBASE_PROJECT_ID','another-school'],['DYNAMAX_WORKSPACE_ID','another-workspace'],
    ['SessionId','another-session'],['TermId','another-term'],['SourceTestId','another-test'],
    ['ClassId','grade-8'],['SubjectId','maths'],['AssessmentComponentId','exam'],['SourceType','ExternalCBT']]) {
    const environment={...frenchEnv},patch={...frenchScope};
    if (key in environment) environment[key]=value; else patch[key]=value;
    const f=frenchFixture({environment});
    const before=JSON.stringify([...f.db]);
    await assert.rejects(f.post(await a.batch([['DCA/001',7.5,'f1']],patch)),{code:'ACADEMIC_CBT_SCORE_BATCH_INVALID'},key);
    assert.equal(JSON.stringify([...f.db]),before);
  }
  const f=frenchFixture();
  const already100=await a.batch([['DCA/001',75,'f1']],{...frenchScope,MaximumScore:100});
  const receipt=(await f.post(already100)).scoreSyncReceipt;
  assert.equal(receipt.ScoreConversion,undefined);
  assert.equal(f.rows(collections.studentScores)[0].ComponentScores[0].RawScore,75);
  await f.post(already100); assert.equal(f.commits.length,1);
  const single10={...frenchScheme,Components:frenchScheme.Components.map(c=>c.Id==='ca1'?{...c,MaximumScore:10}:c)};
  const still10=frenchFixture({assessment:single10});
  assert.equal((await still10.post(await a.batch([['DCA/001',7.5,'f1']],frenchScope))).scoreSyncReceipt.ScoreConversion,undefined);
  assert.equal(still10.rows(collections.studentScores)[0].ComponentScores[0].RawScore,7.5);
  assert.equal(f.ctx.academicCbtUploadConversion(frenchEnv,{...frenchScope,SourceType:'BuiltInCBT'},
    {...frenchScheme.Components[0],ScoreEntryMode:'objective-theory'}),null);
});

test('French conversion requires an unchanged signed payload and verifies saved conversion evidence',async()=>{
  for (const fault of ['signature','digest','prepared']) {
    const f=frenchFixture(),p=await a.batch([['DCA/001',7.5,'f1']],frenchScope);
    if (fault==='signature') await assert.rejects(f.post({...p,Signature:'invalid'}),{code:'ACADEMIC_CBT_SIGNATURE_INVALID'});
    if (fault==='digest') await assert.rejects(f.post({...p,Scores:[{...p.Scores[0],RawScore:10}]}),{code:'ACADEMIC_CBT_SCORE_DIGEST_INVALID'});
    if (fault==='prepared') { const prepared=await f.prepare(p); await assert.rejects(f.commit({...p,MaximumScore:100},prepared),{code:'ACADEMIC_CBT_SCORE_DIGEST_INVALID'}); }
    assert.equal(f.commits.length,0);
  }
  for (const fault of ['saved-mark','original-mark','conversion','receipt']) {
    const f=frenchFixture(),p=await a.batch([['DCA/001',7.5,'f1']],frenchScope); await f.post(p);
    const score=f.rows(collections.studentScores)[0],receipt=f.rows(collections.scoreSyncBatches)[0];
    if (fault==='saved-mark') score.ComponentScores[0].RawScore=7.5;
    if (fault==='original-mark') score.CbtScoreSources[0].OriginalRawScore=8;
    if (fault==='conversion') delete score.CbtScoreSources[0].ScoreConversion;
    if (fault==='receipt') { delete receipt.ScoreConversion; f.put(collections.scoreSyncBatches,receipt.SyncId,receipt); }
    f.put(collections.studentScores,score.ScoreId,score);
    const before=JSON.stringify([...f.db]);
    await assert.rejects(f.post(p),{code:'ACADEMIC_CBT_SYNC_UNVERIFIED'});
    assert.equal(JSON.stringify([...f.db]),before);
  }
});

test('French conversion preserves the first centre result and authorised manual corrections',async()=>{
  const f=frenchFixture(),p=await a.batch([['DCA/001',7.5,'f1']],frenchScope); await f.post(p);
  const saved=JSON.stringify(f.rows(collections.studentScores)[0]);
  const second=await f.post(await b.batch([['DCA/001',10,'second-attempt'],['DCA/002',8,'f2']],frenchScope));
  assert.equal(second.scoreSyncReceipt.ImportedRows,1); assert.equal(second.scoreSyncReceipt.RejectedCount,1);
  assert.equal(JSON.stringify(f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/001')),saved);
  const request={...frenchScope,SheetId:'sheet',Reason:'Authorised correction',RevisionToken:f.rows(collections.scoreSheets)[0].__updateTime};
  await f.ctx.reactivateAcademicScoreEditing(frenchEnv,actor,request);
  await f.ctx.saveAcademicScoreDraft(frenchEnv,actor,{...frenchScope,SheetId:'sheet',SheetRevisionToken:f.rows(collections.scoreSheets)[0].__updateTime,
    Rows:[{StudentRef:'DCA/001',RevisionToken:f.rows(collections.studentScores)[0].__updateTime,ComponentScores:[{ComponentId:'ca1',RawScore:85}]}]});
  const before=JSON.stringify([...f.db]); await f.post(p);
  assert.equal(JSON.stringify([...f.db]),before);
  assert.equal(f.rows(collections.studentScores)[0].ComponentScores[0].RawScore,85);
});

test('long production-style sheet identifiers isolate the same student across subjects',async()=>{
  const f=fixture({realSheetIds:true});
  const period={SessionId:'session-main-secondary-2026-2027',TermId:'term-main-secondary-first-term',ClassId:'grade-9',ArmId:'grade-9-brilliance'};
  for(const row of f.rows(collections.studentMemberships)) f.put(collections.studentMemberships,row.RecordId,{...row,...period});
  const maths=await a.batch([['DCA/001',81,'maths-attempt']],{...period,SubjectId:'mathematics',SourceTestId:'maths-test'});
  const chemistry=await a.batch([['DCA/001',67,'chemistry-attempt']],{...period,SubjectId:'chemistry',SourceTestId:'chemistry-test'});
  await f.post(maths);
  const original=JSON.stringify(f.rows(collections.studentScores)[0]);
  const posted=await f.post(chemistry);
  assert.equal(posted.scoreSyncReceipt.ImportedRows,1);
  assert.equal(f.rows(collections.studentScores).length,2);
  assert.equal(JSON.stringify(f.rows(collections.studentScores).find(row=>row.SubjectId==='mathematics')),original);
  assert.equal(f.rows(collections.studentScores).find(row=>row.SubjectId==='chemistry').ComponentScores[0].RawScore,67);
  assert.equal(posted.scoreSyncReceipt.VerifiedOnline,true);
  assert.equal(posted.scoreSyncReceipt.VerifiedRows,1);
});

test('retrying a legacy zero-score receipt recovers the correct subject without touching Mathematics',async()=>{
  const f=fixture({realSheetIds:true});
  const period={SessionId:'session-main-secondary-2026-2027',TermId:'term-main-secondary-first-term',ClassId:'grade-9',ArmId:'grade-9-brilliance'};
  for(const row of f.rows(collections.studentMemberships)) f.put(collections.studentMemberships,row.RecordId,{...row,...period});
  const maths=await a.batch([['DCA/001',81,'maths-attempt']],{...period,SubjectId:'mathematics',SourceTestId:'maths-test'});
  await f.post(maths);
  const saved=f.rows(collections.studentScores)[0];
  const legacyScoreId=f.ctx.academicId('student-score',saved.SheetId,saved.StudentRef);
  f.db.delete(`${collections.studentScores}/${saved.ScoreId}`);
  f.put(collections.studentScores,legacyScoreId,{...saved,RecordId:legacyScoreId,ScoreId:legacyScoreId});
  const original=JSON.stringify(f.rows(collections.studentScores));
  const chemistry=await b.batch([['DCA/001',67,'chemistry-attempt']],{...period,SubjectId:'chemistry',SourceTestId:'chemistry-test'});
  const SheetId=f.ctx.academicScoreSheetId({branchId:'main',section:'secondary'},period.SessionId,period.TermId,period.ClassId,period.ArmId,'chemistry');
  const SyncId=f.ctx.academicId('score-sync',SheetId,chemistry.BatchId);
  const legacyReceipt={...scope,...period,RecordId:SyncId,SyncId,SheetId,SubjectId:'chemistry',
    BatchDigest:chemistry.BatchDigest,SigningKeyId:b.id,ImportedRows:0,RejectedCount:1,
    RejectedScores:[{StudentRef:'DCA/001'}],AffectedScoreIds:[],Status:'Committed'};
  f.put(collections.scoreSyncBatches,SyncId,legacyReceipt);
  const receiptBefore=JSON.stringify(f.db.get(`${collections.scoreSyncBatches}/${SyncId}`));
  const result=await f.post(chemistry);
  assert.equal(result.scoreSyncReceipt.ImportedRows,1);
  assert.equal(result.scoreSyncReceipt.VerifiedOnline,true);
  assert.equal(JSON.stringify(f.rows(collections.studentScores).filter(row=>row.SubjectId==='mathematics')),original);
  assert.equal(JSON.stringify(f.db.get(`${collections.scoreSyncBatches}/${SyncId}`)),receiptBefore);
  const before=JSON.stringify([...f.db]); await f.post(chemistry);
  assert.equal(JSON.stringify([...f.db]),before);
});

test('a legacy score keeps its existing identity and first-accepted attempt on retry',async()=>{
  const f=fixture({realSheetIds:true});
  const payload=await a.batch([['DCA/001',81,'a1']]);
  await f.post(payload);
  const saved=f.rows(collections.studentScores)[0];
  const oldId=f.ctx.academicId('student-score',saved.SheetId,saved.StudentRef);
  f.db.delete(`${collections.studentScores}/${saved.ScoreId}`);
  f.put(collections.studentScores,oldId,{...saved,RecordId:oldId,ScoreId:oldId});
  const second=await a.batch([['DCA/001',81,'a1'],['DCA/002',92,'a2']]);
  await f.post(second);
  assert.equal(f.rows(collections.studentScores).filter(row=>row.StudentRef==='DCA/001').length,1);
  assert.equal(f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/001').ScoreId,oldId);
  assert.equal(f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/001').ComponentScores[0].RawScore,81);
});

test('complete score identities distinguish long class, arm, subject and term suffixes',()=>{
  const f=fixture(), prefix='score-sheet__main__secondary__'+ 'session-'.repeat(9);
  const sheets=['term-1__grade-8__brilliance__maths','term-1__grade-8__brilliance__chemistry',
    'term-1__grade-8__classic__maths','term-2__grade-8__brilliance__maths'].map(tail=>prefix+tail);
  assert.equal(new Set(sheets.map(id=>f.ctx.academicId('student-score',id,'DCA/001'))).size,1,'Regression reproduces old truncation');
  assert.equal(new Set(sheets.map(id=>f.ctx.academicStudentScoreId(id,'DCA/001'))).size,4);
  const legacy={ScoreId:f.ctx.academicId('student-score',sheets[0],'DCA/001'),SheetId:sheets[0],StudentRef:'DCA/001'};
  assert.equal(f.ctx.academicExistingStudentScore([legacy],sheets[0],'dca/001').previous,legacy);
  assert.equal(f.ctx.academicExistingStudentScore([legacy],sheets[1],'DCA/001').previous,null);
  assert.throws(()=>f.ctx.academicExistingStudentScore([legacy,{...legacy,ScoreId:'another'}],sheets[0],'DCA/001'),
    {code:'ACADEMIC_SCORE_IDENTITY_AMBIGUOUS'});
});

test('altered prepared scores cannot be committed or acknowledged',async()=>{
  const f=fixture(),payload=await a.batch([['DCA/001',81,'a1']]);
  const prepared=await f.prepare(payload);
  await assert.rejects(f.commit({...payload,Scores:[{...payload.Scores[0],RawScore:99}]},prepared),
    {code:'ACADEMIC_CBT_SCORE_DIGEST_INVALID'});
  assert.equal(f.commits.length,0);
});

test('receipts cannot confirm success when saved scores cannot be read back; retry is idempotent',async()=>{
  const f=fixture(),payload=await a.batch([['DCA/001',0,'a1']]);
  const reader=f.ctx.getDocuments;
  f.ctx.getDocuments=async()=>[null];
  await assert.rejects(f.post(payload),{code:'ACADEMIC_CBT_SYNC_UNVERIFIED'});
  assert.equal(f.commits.length,1);
  f.ctx.getDocuments=reader;
  const result=await f.post(payload);
  assert.equal(result.scoreSyncReceipt.VerifiedRows,1);
  assert.equal(f.rows(collections.studentScores)[0].ComponentScores[0].RawScore,0,'A genuine zero mark is valid');
  assert.equal(f.commits.length,1);
});

test('an existing receipt alone never proves missing, wrong-subject or changed marks were saved',async()=>{
  for(const fault of ['missing','subject','value','sheet']) {
    const f=fixture(),payload=await a.batch([['DCA/001',81,'a1']]); await f.post(payload);
    const saved=f.rows(collections.studentScores)[0];
    if(fault==='missing') f.db.delete(`${collections.studentScores}/${saved.ScoreId}`);
    if(fault==='subject') f.put(collections.studentScores,saved.ScoreId,{...saved,SubjectId:'other'});
    if(fault==='value') f.put(collections.studentScores,saved.ScoreId,{...saved,ComponentScores:[{ComponentId:'exam',State:'Numeric',RawScore:99}]});
    if(fault==='sheet') f.db.delete(`${collections.scoreSheets}/sheet`);
    const before=JSON.stringify([...f.db]);
    await assert.rejects(f.post(payload),{code:'ACADEMIC_CBT_SYNC_UNVERIFIED'});
    assert.equal(JSON.stringify([...f.db]),before);
  }
});

test('authorised CBT correction is atomic, audited, relocked and protected against later uploads', async () => {
  const f=fixture(), first=await a.batch([['DCA/001',81,'a1']]); await f.post(first);
  const original=f.rows(collections.studentScores)[0];
  const save=()=>f.ctx.saveAcademicScoreDraft(env,actor,{...scope,SheetId:'sheet',
    SheetRevisionToken:f.rows(collections.scoreSheets)[0].__updateTime,
    Rows:[{StudentRef:'DCA/001',RevisionToken:f.rows(collections.studentScores)[0].__updateTime,
      ComponentScores:[{ComponentId:'exam',RawScore:90}]}]});
  await assert.rejects(save(),{code:'ACADEMIC_SCORE_CELL_LOCKED'});
  const request={...scope,SheetId:'sheet',Reason:'Answer key reviewed by the principal',RevisionToken:f.rows(collections.scoreSheets)[0].__updateTime};
  await assert.rejects(f.ctx.reactivateAcademicScoreEditing(env,{...actor,role:'Teacher'},request),error=>error.status===403);
  await f.ctx.reactivateAcademicScoreEditing(env,actor,request);
  await save();
  const corrected=f.rows(collections.studentScores)[0];
  assert.equal(corrected.ComponentScores[0].RawScore,90);
  assert.deepEqual(corrected.CbtScoreSources,original.CbtScoreSources);
  assert.equal(corrected.ManualScoreCorrections[0].Before.RawScore,81);
  assert.equal(corrected.ManualScoreCorrections[0].After.RawScore,90);
  assert.equal(f.rows(collections.scoreSheets)[0].ScoreEditingReactivated,false);
  const audit=f.rows(collections.audit).find(row=>row.Action==='CORRECT_CBT_SCORE');
  assert.equal(audit.ScoreCorrections[0].Cells[0].After.RawScore,90);
  const retry=await f.post(first); assert.equal(retry.ok,true);
  assert.equal(f.rows(collections.studentScores)[0].ComponentScores[0].RawScore,90);
  // Even another unlock cannot let an unattended upload erase the correction.
  await f.ctx.reactivateAcademicScoreEditing(env,actor,{...request,RevisionToken:f.rows(collections.scoreSheets)[0].__updateTime});
  const result=await f.post(await a.batch([['DCA/001',81,'a1'],['DCA/002',92,'a2']]));
  assert.equal(result.scoreSyncReceipt.ImportedRows,1);
  assert.equal(f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/001').ComponentScores[0].RawScore,90);
  assert.equal(f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/002').ComponentScores[0].RawScore,92);
});

test('a stale correction request cannot change either score or audit history', async () => {
  const f=fixture(); await f.post(await a.batch([['DCA/001',81,'a1']]));
  await f.ctx.reactivateAcademicScoreEditing(env,actor,{...scope,SheetId:'sheet',Reason:'Review marking',RevisionToken:f.rows(collections.scoreSheets)[0].__updateTime});
  const before=structuredClone([...f.db]);
  await assert.rejects(f.ctx.saveAcademicScoreDraft(env,actor,{...scope,SheetId:'sheet',SheetRevisionToken:'stale',
    Rows:[{StudentRef:'DCA/001',RevisionToken:f.rows(collections.studentScores)[0].__updateTime,ComponentScores:[{ComponentId:'exam',RawScore:90}]}]}),error=>error.status===409);
  assert.deepEqual([...f.db],before);
});

test('200 corrected students retain complete audit evidence in one bounded atomic commit', async () => {
  const f=fixture();
  const refs=Array.from({length:200},(_,index)=>`DCA/${String(index+1).padStart(3,'0')}`);
  for(const ref of refs) f.put(collections.studentMemberships,ref.replace('/','-'),{...scope,RecordId:ref.replace('/','-'),StudentRef:ref,Status:'Active'});
  await f.post(await a.batch(refs.map((ref,index)=>[ref,81,`attempt-${index}`])));
  await f.ctx.reactivateAcademicScoreEditing(env,actor,{...scope,SheetId:'sheet',Reason:'Verified marking correction for batch',RevisionToken:f.rows(collections.scoreSheets)[0].__updateTime});
  const Rows=f.rows(collections.studentScores).map(score=>({StudentRef:score.StudentRef,RevisionToken:score.__updateTime,ComponentScores:[{ComponentId:'exam',RawScore:90}]}));
  await f.ctx.saveAcademicScoreDraft(env,actor,{...scope,SheetId:'sheet',SheetRevisionToken:f.rows(collections.scoreSheets)[0].__updateTime,Rows});
  assert.ok(f.commits.at(-1).length<=500);
  const audited=f.rows(collections.audit).filter(row=>row.Action==='CORRECT_CBT_SCORE').flatMap(row=>row.ScoreCorrections);
  assert.equal(audited.length,200);
  assert.ok(audited.every(row=>row.Cells[0].Before.RawScore===81 && row.Cells[0].After.RawScore===90));
});

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
  assert.equal((await f.commit(second,pb)).automaticScoreRetries,1);
  assert.equal(f.rows(collections.studentScores).length,2);
  await f.commit(first,pa); // lost-success-response retry finds the committed receipt
  assert.equal(f.commits.length,2);
});

test('two simultaneous commits save separate subjects for the same student despite shared membership guards',async()=>{
  const f=fixture({realSheetIds:true});
  const first=await a.batch([['DCA/001',81,'maths']]);
  const second=await b.batch([['DCA/001',92,'english']],{SubjectId:'english'});
  const original=JSON.stringify([first,second]);
  const [pa,pb]=await Promise.all([f.prepare(first),f.prepare(second)]);
  const responses=await Promise.all([f.commit(first,pa),f.commit(second,pb)]);
  assert.ok(responses.every(row=>row.scoreSyncReceipt.VerifiedOnline && row.scoreSyncReceipt.ImportedRows===1));
  assert.equal(responses.reduce((n,row)=>n+(row.automaticScoreRetries||0),0),1);
  assert.deepEqual(f.rows(collections.studentScores).map(row=>[row.SubjectId,row.ComponentScores[0].RawScore]).sort(),
    [['english',92],['maths',81]]);
  assert.equal(JSON.stringify([first,second]),original,'No original score/signature/preparation was mutated');
  const saved=JSON.stringify([...f.db]);
  await Promise.all([f.post(first),f.post(second)]);
  assert.equal(JSON.stringify([...f.db]),saved);
});

test('simultaneous overlapping uploads preserve the first mark and save every other student',async()=>{
  const f=fixture(), first=await a.batch([['DCA/001',81,'a1'],['DCA/002',82,'a2']]);
  const second=await b.batch([['DCA/001',99,'b1'],['DCA/003',93,'b3']]);
  const [pa,pb]=await Promise.all([f.prepare(first),f.prepare(second)]);
  const responses=await Promise.all([f.commit(first,pa),f.commit(second,pb)]);
  assert.equal(responses[1].scoreSyncReceipt.AlreadyRecordedCount,1);
  assert.deepEqual(f.rows(collections.studentScores).map(row=>[row.StudentRef,row.ComponentScores[0].RawScore]).sort(),
    [['DCA/001',81],['DCA/002',82],['DCA/003',93]]);
  assert.equal(f.rows(collections.scoreSheets)[0].EnteredCount,3);
  assert.equal(f.rows(collections.scoreSyncBatches).length,2);
});

test('automatic recovery rebuilds all guarded writes through successive collisions, then reads back saved marks',async()=>{
  const f=fixture(), payload=await a.batch([['DCA/001',81,'a1']]);
  const prepared=await f.prepare(payload), commit=f.ctx.batchCommitDocuments, revisions=[];
  f.ctx.batchCommitDocuments=async(...args)=>{
    revisions.push(args[1].find(row=>row.collectionPath===collections.studentMemberships).updateTime);
    if(revisions.length<=2) {
      const member=f.rows(collections.studentMemberships)[0];
      f.put(collections.studentMemberships,member.RecordId,{...member,ScoreHistoryRevision:`other-${revisions.length}`});
    }
    return commit(...args);
  };
  const response=await f.commit(payload,prepared);
  assert.equal(response.automaticScoreRetries,2);
  assert.equal(response.scoreSyncReceipt.VerifiedRows,1);
  assert.equal(new Set(revisions).size,3,'Each attempt must use fresh revisions');
  assert.equal(f.commits.length,1);
  assert.equal(f.delays.length,2);
  assert.ok(f.delays[0]>=250 && f.delays[0]<=500);
  assert.ok(f.delays[1]>=500 && f.delays[1]<=1000);
});

test('persistent contention is bounded and never reports success or partially saves a batch',async()=>{
  const f=fixture(), payload=await a.batch([['DCA/001',81,'a1']]), prepared=await f.prepare(payload);
  const commit=f.ctx.batchCommitDocuments;
  let attempts=0;
  f.ctx.batchCommitDocuments=async(...args)=>{
    attempts++;
    const member=f.rows(collections.studentMemberships)[0];
    f.put(collections.studentMemberships,member.RecordId,{...member,ScoreHistoryRevision:`other-${attempts}`});
    return commit(...args);
  };
  await assert.rejects(f.commit(payload,prepared),{code:'ACADEMIC_WRITE_CONFLICT'});
  assert.equal(attempts,3); assert.equal(f.delays.length,2);
  assert.equal(f.commits.length,0);
  assert.equal(f.rows(collections.studentScores).length,0);
  assert.equal(f.rows(collections.scoreSyncBatches).length,0);
  f.ctx.batchCommitDocuments=commit;
  assert.equal((await f.post(payload)).scoreSyncReceipt.VerifiedRows,1);
});

test('the request recovery time budget prevents repeated expensive re-preparations',async()=>{
  const f=fixture(), payload=await a.batch([['DCA/001',81,'a1']]), prepared=await f.prepare(payload);
  let clock=0, attempts=0;
  f.ctx.Date=class extends Date { static now(){return clock;} };
  f.ctx.batchCommitDocuments=async()=>{
    attempts++; clock=13000;
    throw Object.assign(new Error('Concurrent update'),{status:409});
  };
  await assert.rejects(f.commit(payload,prepared),{code:'ACADEMIC_WRITE_CONFLICT'});
  assert.equal(attempts,1); assert.equal(f.delays.length,0);
  assert.equal(f.commits.length,0);
});

test('recovery checks current permission and does not retry a missing preparation revision',async()=>{
  const f=fixture(), payload=await a.batch([['DCA/001',81,'a1']]), prepared=await f.prepare(payload);
  const commit=f.ctx.batchCommitDocuments;
  let attempts=0;
  f.ctx.batchCommitDocuments=async(...args)=>{
    attempts++;
    const member=f.rows(collections.studentMemberships)[0];
    f.put(collections.studentMemberships,member.RecordId,{...member,ScoreHistoryRevision:'other'});
    f.ctx.academicScoreSheetContext=async()=>{throw Object.assign(new Error('Permission revoked'),{code:'ACADEMIC_FORBIDDEN',status:403});};
    return commit(...args);
  };
  await assert.rejects(f.commit(payload,prepared),{code:'ACADEMIC_FORBIDDEN'});
  assert.equal(attempts,1); assert.equal(f.commits.length,0);
  const missing=fixture();
  delete missing.db.get(`${collections.studentMemberships}/DCA-001`).__updateTime;
  await assert.rejects(missing.prepare(payload),{code:'ACADEMIC_WRITE_CONFLICT'});
  assert.equal(missing.delays.length,0); assert.equal(missing.commits.length,0);
});

test('a lost success response is recovered from its receipt without re-preparing or duplicating marks',async()=>{
  const f=fixture(), payload=await a.batch([['DCA/001',81,'a1']]), commit=f.ctx.batchCommitDocuments;
  f.ctx.batchCommitDocuments=async(...args)=>{
    await commit(...args);
    throw Object.assign(new Error('Lost acknowledgement'),{status:503});
  };
  const response=await f.post(payload);
  assert.equal(response.scoreSyncReceipt.VerifiedOnline,true);
  assert.equal(f.commits.length,1); assert.equal(f.delays.length,0);
  assert.equal(f.rows(collections.studentScores).length,1);
});

test('an out-of-roster student never blocks valid students in the same classroom, regardless of row order',async()=>{
  for (const index of [0, 1, 2]) {
    const f=fixture(), rows=[['DCA/001',81,'a1'],['DCA/002',92,'a2']];
    rows.splice(index,0,['DCA/999',67,'outside-roster']);
    const payload=await a.batch(rows), prepared=await f.prepare(payload);
    assert.equal(f.rows(collections.studentScores).length,0,'Preparation is not success');
    const receipt=(await f.commit(payload,prepared)).scoreSyncReceipt;
    assert.equal(receipt.ImportedRows,2); assert.equal(receipt.VerifiedRows,2);
    assert.equal(receipt.VerifiedOnline,true); assert.equal(receipt.RejectedCount,1);
    assert.equal(receipt.RejectedScores[0].StudentRef,'DCA/999');
    assert.equal(receipt.RejectedScores[0].Code,'ACADEMIC_CBT_SCORE_STUDENT_NOT_IN_ROSTER');
    assert.equal(receipt.AffectedScoreIds.length,2);
    assert.deepEqual(f.rows(collections.studentScores).map(row=>row.StudentRef).sort(),['DCA/001','DCA/002']);
    const snapshot=JSON.stringify([...f.db]);
    await f.post(payload);
    await f.commit(payload,prepared); // Lost acknowledgement retries the same signed preparation.
    assert.equal(JSON.stringify([...f.db]),snapshot);
    // A later different upload also retains the original accepted attempt.
    await f.post(await b.batch([['DCA/001',15,'other-centre'],['DCA/003',75,'new-student']]));
    assert.equal(f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/001').ComponentScores[0].RawScore,81);
  }
});

test('invalid marks or a missing student attempt identity are row rejections, not classroom failures',async()=>{
  for(const bad of [['DCA/002',101,'a2'],['DCA/002','not-a-mark','a2'],['DCA/002',80,'']]) {
    const f=fixture(), payload=await a.batch([bad,['DCA/001',81,'a1']]);
    const receipt=(await f.post(payload)).scoreSyncReceipt;
    assert.equal(receipt.ImportedRows,1); assert.equal(receipt.RejectedCount,1);
    assert.equal(receipt.RejectedScores[0].StudentRef,'DCA/002');
    assert.equal(receipt.RejectedScores[0].Code,bad[2]?'ACADEMIC_CBT_SCORE_STUDENT_INVALID':'ACADEMIC_CBT_SYNC_ATTEMPT_REQUIRED');
    assert.equal(f.rows(collections.studentScores)[0].StudentRef,'DCA/001');
  }
});

test('partial receipts cannot acknowledge missing, unrelated or overlapping student rejections',async()=>{
  for(const rejectedRows of [undefined,[],[{StudentRef:'DCA/998'}],[{StudentRef:'DCA/001'}],
    [{StudentRef:'DCA/999'},{StudentRef:'DCA/999'}]]) {
    const f=fixture(),payload=await a.batch([['DCA/001',81,'a1'],['DCA/999',67,'outside']]);
    await f.post(payload);
    const receipt=f.rows(collections.scoreSyncBatches)[0];
    f.put(collections.scoreSyncBatches,receipt.SyncId,{...receipt,RejectedScores:rejectedRows});
    const before=JSON.stringify([...f.db]);
    await assert.rejects(f.post(payload),{code:'ACADEMIC_CBT_SYNC_UNVERIFIED'});
    assert.equal(JSON.stringify([...f.db]),before);
  }
});

test('a locked replacement mark preserves that student but does not block another student',async()=>{
  const f=fixture(); await f.post(await a.batch([['DCA/001',81,'a1']]));
  const original=JSON.stringify(f.rows(collections.studentScores)[0]);
  const receipt=(await f.post(await a.batch([['DCA/001',82,'a1'],['DCA/002',90,'a2']],{MarkingRevision:2}))).scoreSyncReceipt;
  assert.equal(receipt.ImportedRows,1); assert.equal(receipt.RejectedCount,1);
  assert.equal(receipt.RejectedScores[0].Code,'ACADEMIC_CBT_SYNC_ATTEMPT_CONFLICT');
  assert.equal(JSON.stringify(f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/001')),original);
  assert.equal(f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/002').ComponentScores[0].RawScore,90);
});

test('12 saved and 3 verified existing scores cover all 15 students without replacing earlier marks',async()=>{
  const f=fixture();
  const refs=Array.from({length:15},(_,i)=>`DCA/${String(i+1).padStart(3,'0')}`);
  for(const ref of refs) f.put(collections.studentMemberships,ref,{...scope,RecordId:ref,StudentRef:ref,Status:'Active'});
  await f.post(await a.batch(refs.slice(0,3).map(ref=>[ref,80,`first-${ref}`])));
  const originals=JSON.stringify(f.rows(collections.studentScores));
  const payload=await b.batch(refs.map(ref=>[ref,90,`second-${ref}`]));
  const receipt=(await f.post(payload)).scoreSyncReceipt;
  assert.equal(receipt.ImportedRows,12); assert.equal(receipt.RejectedCount,3);
  assert.equal(receipt.AlreadyRecordedCount,3); assert.equal(receipt.VerifiedOnline,true);
  assert.deepEqual(Array.from(receipt.AlreadyRecordedScores,row=>row.StudentRef),refs.slice(0,3));
  assert.equal(JSON.stringify(f.rows(collections.studentScores).filter(row=>refs.slice(0,3).includes(row.StudentRef))),originals);
  const before=JSON.stringify([...f.db]);
  assert.equal((await f.post(payload)).scoreSyncReceipt.AlreadyRecordedCount,3);
  assert.equal(JSON.stringify([...f.db]),before);
  // Upgrade an older partial receipt on retry by locating and reading back its
  // saved marks. No score or historical receipt needs rewriting.
  const stored=f.rows(collections.scoreSyncBatches).find(row=>row.SyncId===receipt.SyncId);
  f.put(collections.scoreSyncBatches,stored.SyncId,{...stored,RejectedScores:stored.RejectedScores.map(({ExistingScoreId,...row})=>row)});
  const old=JSON.stringify([...f.db]);
  assert.equal((await f.post(payload)).scoreSyncReceipt.AlreadyRecordedCount,3);
  assert.equal(JSON.stringify([...f.db]),old);
});

test('all students already recorded yields a read-back receipt without writing any score or target sheet',async()=>{
  const f=placementFixture();
  await f.post(await a.batch([['DCA/001',0,'a1'],['DCA/002',75,'a2']]));
  const scores=JSON.stringify(f.rows(collections.studentScores)), sheets=JSON.stringify(f.rows(collections.scoreSheets));
  const payload=await b.batch([['DCA/001',99,'b1'],['DCA/002',99,'b2']],{ArmId:''});
  const receipt=(await f.post(payload)).scoreSyncReceipt;
  assert.equal(receipt.ImportedRows,0); assert.equal(receipt.VerifiedRows,0);
  assert.equal(receipt.AlreadyRecordedCount,2); assert.equal(receipt.VerifiedOnline,true);
  assert.equal(JSON.stringify(f.rows(collections.studentScores)),scores);
  assert.equal(JSON.stringify(f.rows(collections.scoreSheets)),sheets);
  assert.ok(f.commits.at(-1).every(write=>[collections.scoreSyncBatches,collections.audit].includes(write.collectionPath)));
  assert.equal((await f.post(payload)).scoreSyncReceipt.AlreadyRecordedCount,2);
});

test('existing-score acknowledgements require a live matching student, scope, sheet and recorded cell',async()=>{
  for(const alter of [
    score=>({...score,StudentRef:'DCA/999'}), score=>({...score,SubjectId:'other'}),
    score=>({...score,TermId:'other'}), score=>({...score,BranchId:'other'}),
    score=>({...score,ComponentScores:[{ComponentId:'another-test',State:'Numeric',RawScore:80}]}),
    score=>({...score,ComponentScores:[{ComponentId:'exam',State:'Missing',RawScore:null}]}),
    score=>({...score,ComponentScores:[{ComponentId:'exam',State:'Numeric',RawScore:101}]}),
    score=>({...score,SheetId:'missing-sheet'})
  ]) {
    const f=fixture(); await f.post(await a.batch([['DCA/001',80,'a1']]));
    const payload=await b.batch([['DCA/001',99,'b1'],['DCA/002',90,'b2']]);
    assert.equal((await f.post(payload)).scoreSyncReceipt.AlreadyRecordedCount,1);
    const saved=f.rows(collections.studentScores).find(row=>row.StudentRef==='DCA/001');
    f.put(collections.studentScores,saved.ScoreId,alter(saved));
    const receipt=(await f.post(payload)).scoreSyncReceipt;
    assert.equal(receipt.ImportedRows,1); assert.equal(receipt.AlreadyRecordedCount,0);
  }
});

test('a rejection message alone never confirms a saved score',async()=>{
  const f=fixture(),payload=await a.batch([['DCA/001',80,'a1'],['DCA/999',75,'outside']]);
  const receipt=(await f.post(payload)).scoreSyncReceipt;
  const stored=f.rows(collections.scoreSyncBatches)[0];
  f.put(collections.scoreSyncBatches,stored.SyncId,{...stored,RejectedScores:[{StudentRef:'DCA/999',
    Code:'ACADEMIC_CBT_SYNC_ATTEMPT_CONFLICT',Reason:'An earlier accepted result is preserved.',ExistingScoreId:receipt.AffectedScoreIds[0]}]});
  assert.equal((await f.post(payload)).scoreSyncReceipt.AlreadyRecordedCount,0);
});

test('theory-only and missing cells do not count as an existing Objective mark',()=>{
  const f=fixture(), sheet={...scope,SheetId:'split-sheet',AssessmentComponents:[
    {Id:'exam',ScoreEntryMode:'objective-theory',ObjectiveMaximumScore:50,TheoryMaximumScore:50}]};
  const score={...scope,StudentRef:'DCA/001',ScoreId:'split-score',SheetId:sheet.SheetId,
    ComponentScores:[{ComponentId:'exam',Parts:[{PartId:'theory',State:'Numeric',RawScore:40}]}]};
  const rejection={StudentRef:'DCA/001',Code:'ACADEMIC_CBT_SYNC_ATTEMPT_CONFLICT'};
  const input={...scope,AssessmentComponentId:'exam'};
  assert.equal(f.ctx.academicCbtExistingScoreEvidence([score],[sheet],input,rejection),null);
  score.ComponentScores[0].Parts.push({PartId:'objective',State:'Numeric',RawScore:0});
  assert.equal(f.ctx.academicCbtExistingScoreEvidence([score],[sheet],input,rejection).ScoreId,'split-score');
});

test('an all-existing receipt cannot acknowledge deleted marks on a later retry',async()=>{
  const f=fixture(); await f.post(await a.batch([['DCA/001',80,'a1']]));
  const payload=await b.batch([['DCA/001',99,'b1']]);
  assert.equal((await f.post(payload)).scoreSyncReceipt.AlreadyRecordedCount,1);
  const saved=f.rows(collections.studentScores)[0];
  f.db.delete(`${collections.studentScores}/${saved.ScoreId}`);
  await assert.rejects(f.post(payload),{code:'ACADEMIC_CBT_SYNC_UNVERIFIED'});
});

test('a saved earlier score does not hide a genuine rejection when no new marks were imported',async()=>{
  const f=fixture(); await f.post(await a.batch([['DCA/001',80,'a1']]));
  const payload=await b.batch([['DCA/001',99,'b1'],['DCA/999',75,'outside']]);
  const receipt=(await f.post(payload)).scoreSyncReceipt;
  assert.equal(receipt.ImportedRows,0); assert.equal(receipt.AlreadyRecordedCount,1);
  assert.equal(receipt.RejectedCount,2);
  assert.equal(receipt.RejectedScores.find(row=>row.StudentRef==='DCA/999').ExistingScoreId,undefined);
});

test('every-row genuine rejection is not a success and writes no marks, receipt or score sheet',async()=>{
  const f=fixture(), before=JSON.stringify([...f.db]);
  await assert.rejects(f.post(await a.batch([['DCA/999',67,'outside'],['DCA/001',101,'bad-mark']])),error=>
    error.code==='ACADEMIC_CBT_SYNC_NO_SCORES_SAVED' && error.preview.ImportedRows===0
      && error.preview.RejectedCount===2 && error.message.includes('DCA/999') && error.message.includes('DCA/001'));
  assert.equal(JSON.stringify([...f.db]),before);
});

test('malformed batch identities, wrong maxima and invalid signatures still fail the whole envelope',async()=>{
  for(const payload of [
    await a.batch([['',50,'missing-ref'],['DCA/001',81,'a1']]),
    await a.batch([['DCA/001',50,'duplicate'],['dca/001',81,'a1'],['DCA/002',92,'a2']]),
    await a.batch([['DCA/001',81,'a1'],['DCA/999',50,'outside']],{MaximumScore:50}),
    await a.batch([['DCA/001',81,'a1']],{MaximumScore:'not-a-number'}),
  ]) {
    const f=fixture();
    await assert.rejects(f.post(payload),{code:'ACADEMIC_CBT_SCORE_BATCH_INVALID'});
    assert.equal(f.commits.length,0);
  }
  const f=fixture(), payload=await a.batch([['DCA/001',81,'a1'],['DCA/999',50,'outside']]);
  await assert.rejects(f.post({...payload,Signature:payload.Signature.slice(4)}),{code:'ACADEMIC_CBT_SIGNATURE_INVALID'});
  assert.equal(f.commits.length,0);
});

test('repreparing after one student moves arms posts the others without bypassing the membership guard',async()=>{
  const f=fixture(), originalContext=f.ctx.academicScoreSheetContext;
  f.ctx.academicScoreSheetContext=async(...args)=>{
    const context=await originalContext(...args);
    return {...context,roster:context.roster.filter(row=>row.ArmId===args[2].ArmId)};
  };
  const payload=await a.batch([['DCA/001',81,'a1'],['DCA/002',92,'a2']]);
  const prepared=await f.prepare(payload);
  const member=f.rows(collections.studentMemberships).find(row=>row.StudentRef==='DCA/002');
  f.put(collections.studentMemberships,member.RecordId,{...member,ArmId:'other-arm'});
  const response=await f.commit(payload,prepared), receipt=response.scoreSyncReceipt;
  assert.equal(response.automaticScoreRetries,1);
  assert.equal(receipt.ImportedRows,1); assert.equal(receipt.RejectedScores[0].StudentRef,'DCA/002');
  assert.equal(f.rows(collections.studentScores)[0].StudentRef,'DCA/001');
});

test('same-student concurrent preparations recover automatically without overwriting',async()=>{
  const f=fixture(),first=await a.batch([['DCA/001',81,'a1']]),second=await b.batch([['DCA/001',81,'b1']]);
  const [pa,pb]=await Promise.all([f.prepare(first),f.prepare(second)]);
  await f.commit(first,pa);
  const sheet=JSON.stringify(f.rows(collections.scoreSheets)), scores=JSON.stringify(f.rows(collections.studentScores));
  const response=await f.commit(second,pb), receipt=response.scoreSyncReceipt;
  assert.equal(response.automaticScoreRetries,1);
  assert.equal(receipt.ImportedRows,0); assert.equal(receipt.AlreadyRecordedCount,1);
  assert.equal(JSON.stringify(f.rows(collections.scoreSheets)),sheet);
  assert.equal(JSON.stringify(f.rows(collections.studentScores)),scores);
  assert.equal(f.rows(collections.studentScores)[0].CbtScoreSources[0].SigningKeyId,a.id);
});

test('re-push cannot replace an existing score even after reactivating editing',async()=>{
  const f=fixture(); await f.post(await a.batch([['DCA/001',81,'a1']]));
  const correction=await a.batch([['DCA/001',82,'a1']],{MarkingRevision:2});
  const receipt=(await f.post(correction)).scoreSyncReceipt;
  assert.equal(receipt.ImportedRows,0); assert.equal(receipt.AlreadyRecordedCount,1);
  f.put(collections.scoreSheets,'sheet',{...f.rows(collections.scoreSheets)[0],ScoreEditingReactivated:true});
  assert.equal((await f.post(correction)).scoreSyncReceipt.AlreadyRecordedCount,1);
  assert.equal(f.rows(collections.studentScores)[0].ComponentScores[0].RawScore,81);
  assert.equal(f.rows(collections.scoreSheets)[0].ScoreEditingReactivated,true);
});

test('server signature, reviewer permission, scope, roster and prepared membership checks still apply',async()=>{
  const f=fixture(),payload=await a.batch([['DCA/001',81,'a1']]);
  await assert.rejects(f.prepare({...payload,SigningKeyId:b.id}),{code:'ACADEMIC_CBT_SIGNATURE_INVALID'});
  await assert.rejects(f.prepare({...payload,Signature:payload.Signature.slice(4)}),{code:'ACADEMIC_CBT_SIGNATURE_INVALID'});
  await assert.rejects(f.prepare({...payload,Scores:[{...payload.Scores[0],RawScore:99}]}),{code:'ACADEMIC_CBT_SCORE_DIGEST_INVALID'});
  await assert.rejects(f.prepare(payload,{...actor,allowedSections:[],role:'Vendor'}),{status:403});
  await assert.rejects(f.post(await a.batch([['DCA/999',81,'x']])),error=>error.code==='ACADEMIC_CBT_SYNC_NO_SCORES_SAVED'
    && error.preview.RejectedScores[0].Code==='ACADEMIC_CBT_SCORE_STUDENT_NOT_IN_ROSTER');
  const prepared=await f.prepare(payload);
  await assert.rejects(f.commit(payload,prepared,{...actor,schoolSectionAccess:'primary'}),{code:'ACADEMIC_SECTION_FORBIDDEN'});
  await assert.rejects(f.commit(payload,prepared,{...actor,branchId:'other'}),{code:'ACADEMIC_BRANCH_FORBIDDEN'});
  await assert.rejects(f.commit(payload,prepared,{...actor,subscriptionReadOnly:true}),{code:'SUBSCRIPTION_READ_ONLY'});
  const originalContext=f.ctx.academicScoreSheetContext;
  f.ctx.academicScoreSheetContext=async(...args)=>{
    const context=await originalContext(...args);
    return {...context,roster:context.roster.filter(row=>row.ArmId===args[2].ArmId)};
  };
  f.put(collections.studentMemberships,'DCA-001',{...f.rows(collections.studentMemberships)[0],ArmId:'other'});
  await assert.rejects(f.commit(payload,prepared),{code:'ACADEMIC_CBT_SYNC_NO_SCORES_SAVED'});
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
  await assert.rejects(f.commit(clone,pb),{code:'ACADEMIC_CBT_SYNC_KEY_REUSED'});
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
