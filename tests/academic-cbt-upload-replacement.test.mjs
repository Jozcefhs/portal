import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { academicCbtUploadId, academicCbtUploadMatches } from '../functions/lib/academic-management.js';
import { commitAcademicSubmission } from '../functions/lib/academic-submissions.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const target = {BranchId:'main', SchoolSection:'secondary', SessionId:'s1', TermId:'t1',
  ClassId:'grade7', SubjectId:'math', AssessmentComponentId:'ca1', AssessmentComponentName:'CA1'};
const paper = {Url:'new-paper', FileName:'paper.pdf', MimeType:'application/pdf', Digest:'a'.repeat(64), ByteLength:100, PageNumber:1};
const input = { ...target, NumberOfQuestions:1, DurationMinutes:30, OptionStyle:'ABCD',
  AnswerKey:['A'], StartsAt:'2099-01-01T09:00:00Z', PaperFiles:[paper] };
const previous = overrides => ({...target, CbtTestId:'legacy-test', RecordId:'legacy-test', Status:'Scheduled',
  TeacherUsername:'teacher', PackageRevision:2, CreatedAt:'2026-01-01', __updateTime:'revision-1',
  PaperFiles:[{...paper,Url:'old-paper'}], ...overrides});

function harness(rows = []) {
  const state = {cbtTests:structuredClone(rows)};
  const commits = [];
  const context = vm.createContext({crypto:webcrypto, TextEncoder, Uint8Array,
    academicCbtClassContext:async () => ({state:structuredClone(state), scope:{branchId:'main',section:'secondary'},
      session:{SessionId:'s1'},term:{TermId:'t1'}, schoolClass:{ClassId:'grade7',Name:'Grade 7'},
      subject:{SubjectId:'math',Name:'Mathematics'},allocation:{TeacherUsername:'teacher'},roster:[{StudentRef:'S1'}],
      scheme:{Components:[{Id:'ca1',Name:'CA1',SourceMode:'built-in-cbt',MaximumScore:100}]}}),
    clean:v=>String(v??'').trim(), lower:v=>String(v??'').trim().toLowerCase(),
    recordId:r=>r.CbtTestId||r.RecordId||'', findById:(rows,id)=>rows.find(r=>r.CbtTestId===id),
    effectiveAcademicSection:(r,s)=>r.SchoolSection||s.section,
    academicCbtOptionStyle:()=> 'ABCD',ACADEMIC_CBT_OPTION_STYLES:{ABCD:['A','B','C','D']},
    academicCbtPaperFiles:(r,type)=>r[type==='theory'?'TheoryPaperFiles':'PaperFiles']||[],
    validateAcademicCbtPaperFiles:files=>files,
    academicCbtAuthority:(_u,_c,r)=>{if(r.TeacherUsername!=='teacher')throw Object.assign(new Error('Not owner'),{status:403});},
    academicCbtPackageDigest:async r=>JSON.stringify([r.CbtTestId,r.PaperFiles,r.PackageRevision]),
    nowIso:()=>new Date().toISOString(),actorName:()=> 'Teacher',
    failure:(message,status,code)=>Object.assign(new Error(message),{status,code}),
    ACADEMIC_MANAGEMENT_COLLECTIONS:{cbtTests:'tests'},publicRecord:r=>r,
    withoutMetadata:r=>Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('__'))),
    auditWrite:()=>({collectionPath:'audit',documentId:webcrypto.randomUUID(),data:{}}),
    commitAcademicBatch:async (_env,writes)=>{
      for(const w of writes.filter(w=>w.collectionPath==='tests')){
        const old=state.cbtTests.find(r=>r.CbtTestId===w.documentId);
        if((w.exists===false&&old)||(w.updateTime&&w.updateTime!==old?.__updateTime))
          throw Object.assign(new Error('Concurrent change'),{status:409});
      }
      commits.push(writes);
      for(const w of writes.filter(w=>w.collectionPath==='tests')){
        state.cbtTests=state.cbtTests.filter(r=>r.CbtTestId!==w.documentId);
        state.cbtTests.push({...structuredClone(w.data),__updateTime:`revision-${commits.length+1}`});
      }
      return {writeResults:[{updateTime:`revision-${commits.length+1}`}]};
    }
  });
  context.commitAcademicSubmission = (env, scope, user, input, type, writes) => commitAcademicSubmission(env, scope, user, input, type, writes, {
    getDocument: async () => null, batchCommitDocuments: (...args) => context.commitAcademicBatch(...args)
  });
  vm.runInContext(source.slice(source.indexOf('function writePrecondition('),source.indexOf('function auditWrite(')),context);
  vm.runInContext(source.slice(source.indexOf('export function academicCbtUploadMatches('),
    source.indexOf('export function academicCbtRosterRefreshPlan(')).replace(/^export /gm,''),context);
  return {state,commits, validate:patch=>context.validateAcademicCbtTestInput({}, {}, {...input,...patch}),
    save:(validation,patch)=>context.saveAcademicCbtTest({}, {}, {...input,...patch},{validation})};
}

test('upload identity is independent of request, teacher, arm and schedule, but scoped to period and subject',async()=>{
  const id=await academicCbtUploadId(target);
  assert.equal(await academicCbtUploadId({...target,ClientRequestId:'other',TeacherUsername:'another',ArmId:'a2',StartsAt:'tomorrow'}),id);
  for(const field of ['BranchId','SchoolSection','SessionId','TermId','ClassId','SubjectId','AssessmentComponentName']){
    assert.notEqual(await academicCbtUploadId({...target,[field]:'other'}),id);
    assert.equal(academicCbtUploadMatches({...target,[field]:'other',...(field==='AssessmentComponentName'?{AssessmentComponentId:'other'}:{})},target),false);
  }
  assert.equal(academicCbtUploadMatches({...target,LateEntryParentId:'original'},target),false);
});

test('repeat uploads replace the same legacy record, increment revision and do not add tests',async()=>{
  const h=harness([previous()]);
  for(let i=0;i<3;i++){
    const validation=await h.validate({ClientRequestId:`request-${i}`});
    assert.equal(validation.record.CbtTestId,'legacy-test');
    const result=await h.save(validation);
    assert.equal(h.state.cbtTests.length,1);
    assert.equal(result.cbtTest.PackageRevision,3+i);
    assert.equal(result.cbtTest.CreatedAt,'2026-01-01');
    assert.match(result.message,/replaced, not duplicated/);
  }
});

test('re-upload with a different file, request and schedule replaces only the matching assessment',async()=>{
  const other = previous({CbtTestId:'ca2-existing',RecordId:'ca2-existing',AssessmentComponentId:'ca2',AssessmentComponentName:'CA2'});
  const h = harness([previous(),other]);
  const changes = {ClientRequestId:'new-request',StartsAt:'2099-02-01T09:00:00Z',
    PaperFiles:[{...paper,FileName:'corrected-French.pdf',Url:'replacement-paper'}]};
  await h.save(await h.validate(changes),changes);
  assert.equal(h.state.cbtTests.length,2);
  assert.equal(h.state.cbtTests.find(row=>row.CbtTestId==='legacy-test').PaperFiles[0].Url,'replacement-paper');
  assert.deepEqual(h.state.cbtTests.find(row=>row.CbtTestId==='ca2-existing'),other);
  assert.ok(h.commits.flat().every(write=>['tests','audit'].includes(write.collectionPath)),
    'paper replacement must not update or delete any answers, attempts, student scores or scorebooks');
});

test('a changed assessment ID with the same test name still replaces its existing paper',async()=>{
  const h = harness([previous({AssessmentComponentId:'legacy-ca1-id'})]);
  const result = await h.save(await h.validate());
  assert.equal(result.cbtTest.CbtTestId,'legacy-test');
  assert.equal(h.state.cbtTests.length,1);
});

test('simultaneous first uploads have the same ID and only one can commit',async()=>{
  const h=harness();
  const [a,b]=await Promise.all([h.validate({ClientRequestId:'a'}),h.validate({ClientRequestId:'b'})]);
  assert.equal(a.record.CbtTestId,b.record.CbtTestId);
  await h.save(a);
  await assert.rejects(h.save(b),{status:409});
  assert.equal(h.state.cbtTests.length,1);
});

test('simultaneous replacements and downloads cannot overwrite a newer revision',async()=>{
  const h=harness([previous()]);
  const [a,b]=await Promise.all([h.validate(),h.validate()]);
  await h.save(a);
  await assert.rejects(h.save(b),{status:409});
  const c=await h.validate();
  h.state.cbtTests[0].LocalPackageIssuedAt='issued-now';
  h.state.cbtTests[0].__updateTime='download-revision';
  await assert.rejects(h.save(c),{status:409});
  assert.equal(h.state.cbtTests[0].LocalPackageIssuedAt,'issued-now');
});

test('downloaded, used and late-entry-linked assessments cannot be bypassed by a new upload',async()=>{
  for(const patch of [{LocalDownloadedAt:'downloaded'},{LocalPackageIssuedAt:'issued'},{Status:'Completed'}]){
    const h=harness([previous(patch)]);
    await assert.rejects(h.validate(),{code:'ACADEMIC_CBT_ALREADY_DOWNLOADED'});
    assert.equal(h.commits.length,0);
  }
  const h=harness([previous(),previous({CbtTestId:'late',LateEntryParentId:'legacy-test'})]);
  await assert.rejects(h.validate(),{code:'ACADEMIC_CBT_ALREADY_DOWNLOADED'});
});

test('different terms and subjects are preserved; missing paper metadata does not permit duplicates',async()=>{
  const other=previous({CbtTestId:'other-term',TermId:'t2',LocalDownloadedAt:'keep'});
  const h=harness([previous({PaperFiles:[],SchoolSection:''}),other]);
  await h.save(await h.validate());
  assert.equal(h.state.cbtTests.length,2);
  assert.deepEqual(h.state.cbtTests.find(r=>r.CbtTestId==='other-term'),other);
});

test('new upload to an unused reopened test clears obsolete cloud-paper removal markers',async()=>{
  const h=harness([previous({PaperFiles:[],CloudPaperRemovedAt:'old',CloudPaperRemovalStatus:'Complete',CloudPaperCleanupJobId:'old-job'})]);
  const result=await h.save(await h.validate());
  assert.equal(result.cbtTest.CloudPaperRemovedAt,'');
  assert.equal(result.cbtTest.CloudPaperRemovalStatus,'');
  assert.equal(result.cbtTest.CloudPaperCleanupJobId,'');
  assert.equal(result.cbtTest.PaperFiles[0].Url,'new-paper');
});

test('legacy unused duplicates are superseded atomically, without touching another term',async()=>{
  const h=harness([previous(),previous({CbtTestId:'duplicate',RecordId:'duplicate',CreatedAt:'2026-02-01'})]);
  const result=await h.save(await h.validate());
  assert.deepEqual(Array.from(result.supersededCbtTestIds),['duplicate']);
  assert.equal(h.state.cbtTests.filter(r=>r.Status==='Scheduled').length,1);
  assert.equal(h.state.cbtTests.find(r=>r.CbtTestId==='duplicate').PaperFiles.length,0);
});

test('explicit edits still require the correct revision, identity and authority',async()=>{
  const h=harness([previous()]);
  await assert.rejects(h.save(await h.validate({CbtTestId:'legacy-test',RevisionToken:'stale'})),{code:'ACADEMIC_WRITE_CONFLICT'});
  const other=harness([previous({SubjectId:'english'})]);
  await assert.rejects(other.validate({CbtTestId:'legacy-test'}),{code:'ACADEMIC_CBT_UPLOAD_SCOPE_CHANGED'});
  const owner=harness([previous({TeacherUsername:'another'})]);
  await assert.rejects(owner.validate(),{status:403});
});

test('web register immediately removes replaced rows but retains late-entry sittings',()=>{
  const context=vm.createContext({clean:v=>String(v??'').trim(),academicManagementData:{cbtTests:[
    {CbtTestId:'old'},{CbtTestId:'current'},{CbtTestId:'late',LateEntryParentId:'current'}]}});
  vm.runInContext(admin.slice(admin.indexOf('function mergeAcademicCbtTest('),admin.indexOf('function openAcademicCbtLateEntryDialog(')),context);
  context.mergeAcademicCbtTest({CbtTest:{CbtTestId:'current'},supersededCbtTestIds:['old']});
  assert.deepEqual(Array.from(context.academicManagementData.cbtTests,r=>r.CbtTestId).sort(),['current','late']);
});

test('successful replacement removes old objective and theory files only after the record is committed',async()=>{
  const endpoint=await readFile(new URL('../functions/api/staff-cbt-paper.js',import.meta.url),'utf8');
  const events=[];
  const context=vm.createContext({Response,
    requiredDeploymentIdentity:()=>({edition:'school'}),requireFirestoreEnv:()=>{},requireStaffSession:async()=>({username:'teacher'}),
    readJsonBody:async()=>({Files:[{FileBase64:'synthetic'}],TheoryFiles:[{FileBase64:'synthetic'}]}),
    validateAcademicCbtTestInput:async()=>({context:{scope:{branchId:'main',section:'secondary'}},
      record:{CbtTestId:'existing',PaperMode:'split'},existing:{PaperFiles:[{Url:'old-objective'}],TheoryPaperFiles:[{Url:'old-theory'}]},
      replacementCandidates:[{PaperFiles:[{Url:'old-duplicate'}]}]}),
    validateAcademicCbtPaper:()=>({mimeType:'application/pdf',byteLength:1,fileName:'paper.pdf'}),academicCbtPaperDigest:async()=> 'digest',
    beginIdempotentRequest:async()=>({enabled:true,owner:true,documentId:'op'}),resolveDocumentStorage:async()=>({configured:true}),
    putStoredDocument:async(_env,body)=>({documentUrl:`new-${body.documentType}`}),
    saveAcademicCbtTest:async()=>{events.push('commit');return {cbtTest:{CbtTestId:'existing'},supersededCbtTestIds:['duplicate']};},
    deleteStoredDocument:async(_env,url)=>events.push(url),completeIdempotentRequest:async()=>{},failIdempotentRequest:async()=>{}
  });
  vm.runInContext(endpoint.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,''),context);
  const response=await context.onRequestPost({request:{},env:{}});
  assert.equal(response.status,200);
  assert.deepEqual(events,['commit','old-objective','old-theory','old-duplicate']);
  assert.deepEqual((await response.json()).supersededCbtTestIds,['duplicate']);
});
