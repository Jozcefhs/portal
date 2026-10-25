import { buildStructuredQuery } from '../functions/lib/firestore.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  academicCbtRetentionActivationWrites, assertAcademicTermRetentionEdit,
  processAcademicCbtPaperRetention, assertAcademicCbtRetentionUrls, CBT_PAPER_CLEANUP_JOBS
} from '../functions/lib/academic-cbt-paper-retention.js';

const scope={BranchId:'main',SchoolSection:'secondary'};
const closed={...scope,RecordId:'term1',TermId:'term1',SessionId:'session',Status:'Closed',
  StartDate:'2026-01-01',EndDate:'2026-03-31',__updateTime:'term-v1'};
const active={...scope,RecordId:'term2',TermId:'term2',SessionId:'session',Status:'Active',
  StartDate:'2026-04-01',EndDate:'2026-07-31'};
const timestamp='2026-04-01T08:00:00Z';
const env={ORGANISATION_EDITION:'school',DYNAMAX_WORKSPACE_ID:'school'};
const url=(id,part='question-paper')=>`r2://dynamax-documents/v1/school/school/academic-cbt/main/secondary/${id}/${part}/upload.pdf`;
const paper=(id,overrides={})=>({...scope,RecordId:id,CbtTestId:id,TermId:'term1',SessionId:'session',
  PaperFiles:[{Url:url(id)}],PaperUrl:url(id),TheoryPaperFiles:[{Url:url(id,'theory-paper')}],
  AnswerKey:['A','B'],StudentRefs:['S1'],PackageDigest:'keep-digest',LocalDownloadedAt:'keep-download',
  Status:'Scheduled',...overrides});

async function harness(rows=[]) {
  const queue=await academicCbtRetentionActivationWrites(active,{Status:'Planned'},[closed],'Principal',timestamp);
  const store=new Map(); let revision=1;
  const put=(collection,id,row)=>store.set(`${collection}/${id}`,{...structuredClone(row),__id:id,
    __name:`projects/test/databases/(default)/documents/${collection}/${id}`,__updateTime:`v${revision++}`});
  for(const w of queue)put(w.collectionPath,w.documentId,w.data);
  for(const row of rows)put('academicCbtTests',row.CbtTestId,row);
  put('academicStudentScores','score',{Score:87});put('academicResults','result',{Grade:'A'});
  const writes=[],deleted=[],queries=[];
  let failDelete='',loseCommit=false;
  const db={
    getDocument:async(_env,collection,id)=>structuredClone(store.get(`${collection}/${id}`)||null),
    queryCollection:async(_env,collection,query)=>{
      buildStructuredQuery(collection, query); // Validate the real Firestore query contract.
      queries.push({collection,query});
      return [...store.entries()].filter(([key])=>key.startsWith(`${collection}/`)).map(([,r])=>structuredClone(r))
        .filter(r=>(query.filters||[]).every(f=>r[f.field]===f.value))
        .filter(r=>!query.startAfterName||r.__name>query.startAfterName).sort((a,b)=>a.__name.localeCompare(b.__name))
        .slice(0,query.limit);
    },
    batchCommitDocuments:async(_env,batch)=>{
      for(const w of batch){
        const old=store.get(`${w.collectionPath}/${w.documentId}`);
        if((w.exists===false&&old)||(w.updateTime&&old?.__updateTime!==w.updateTime))throw Object.assign(new Error('Conflict'),{status:409});
      }
      writes.push(structuredClone(batch));
      for(const w of batch)put(w.collectionPath,w.documentId,w.data);
      if(loseCommit&&batch.some(w=>w.collectionPath==='academicManagementAudit')){
        loseCommit=false;throw new Error('Lost commit response');
      }
    },
    deleteStoredDocument:async(_env,reference)=>{deleted.push(reference);if(reference===failDelete)throw new Error('Temporary R2 failure');}
  };
  return {store,writes,deleted,queries,db,put,
    job:()=>[...store.values()].find(r=>r.JobId&&r.Status),
    term:()=>store.get('academicTerms/term1'),
    run:()=>processAcademicCbtPaperRetention(env,{db}),
    fail:reference=>{failDelete=reference;},lose:()=>{loseCommit=true;}};
}

test('only next-term activation queues earlier closed terms in the same branch and section',async()=>{
  const candidates=[closed,...[
    {TermId:'open',Status:'Active'}, {TermId:'planned',Status:'Planned'}, {TermId:'archived',Status:'Archived'},
    {TermId:'future',EndDate:'2027-01-01'}, {TermId:'overlap',EndDate:active.StartDate},
    {TermId:'branch',BranchId:'other'}, {TermId:'primary',SchoolSection:'primary'},
    {TermId:'pending',CbtPaperCleanupStatus:'Pending'}, {TermId:'done',CbtPaperCleanupStatus:'Complete'}
  ].map(p=>({...closed,...p}))];
  const writes=await academicCbtRetentionActivationWrites(active,{Status:'Planned'},candidates,'Principal',timestamp);
  assert.equal(writes.length,2);assert.equal(writes[1].data.TermId,'term1');
  assert.equal(writes[0].updateTime,'term-v1');assert.equal(writes[1].exists,false);
  for(const status of ['Planned','Closed'])assert.deepEqual(await academicCbtRetentionActivationWrites({...active,Status:status},null,[closed],'Principal',timestamp),[]);
  assert.deepEqual(await academicCbtRetentionActivationWrites(active,active,[closed],'Principal',timestamp),[]);
  await assert.rejects(academicCbtRetentionActivationWrites(active,null,[{...closed,__updateTime:''}],'Principal',timestamp));
});

test('cleanup removes only paper files and retains original test, score, result and answer history',async()=>{
  const before=paper('test1');const h=await harness([before]);
  const result=await h.run();assert.equal(result.ok,true);assert.equal(result.cleaned,1);
  assert.deepEqual(h.deleted,[url('test1'),url('test1','theory-paper')]);
  assert.equal(h.term().CbtPaperCleanupStatus,'Complete');
  const saved=h.store.get('academicCbtTests/test1');
  for(const key of ['AnswerKey','StudentRefs','PackageDigest','LocalDownloadedAt','Status'])assert.deepEqual(saved[key],before[key]);
  assert.equal(saved.PaperUrl,'');assert.equal(saved.PaperFiles.length,0);
  assert.equal(saved.CloudPaperRemovalStatus,'Complete');
  assert.equal(h.store.get('academicStudentScores/score').Score,87);
  assert.equal(h.store.get('academicResults/result').Grade,'A');
  assert.ok(h.writes.every(batch=>batch.every(w=>!['academicStudentScores','academicResults'].includes(w.collectionPath))));
  assert.equal([...h.store.keys()].filter(k=>k.startsWith('academicManagementAudit/')).length,1);
  const count=h.deleted.length;await h.run();assert.equal(h.deleted.length,count);
});

test('storage failure keeps retry URLs and does not claim cleanup completion',async()=>{
  const h=await harness([paper('test1')]);h.fail(url('test1','theory-paper'));
  const result=await h.run();assert.equal(result.ok,false);
  assert.equal(h.job().Status,'Pending');assert.equal(h.job().PendingUrls.length,2);
  assert.equal(h.term().CbtPaperCleanupStatus,'Pending');
  assert.equal(h.store.get('academicCbtTests/test1').PaperUrl,url('test1'));
  assert.match(h.job().LastError,/R2/);
  h.fail('');assert.equal((await h.run()).ok,true);
  assert.equal(h.job().FilesRemoved,2);assert.equal(h.job().Status,'Complete');
});

test('lost commit responses and repeated scheduler calls do not duplicate audit or counts',async()=>{
  const h=await harness([paper('test1')]);h.lose();
  await h.run();await h.run();
  assert.equal(h.job().FilesRemoved,2);assert.equal(h.job().TestsCleaned,1);
  assert.equal([...h.store.keys()].filter(k=>k.startsWith('academicManagementAudit/')).length,1);
});

test('open or moved terms stop cleanup before any storage deletion',async()=>{
  for(const patch of [{Status:'Active'},{SessionId:'other'},{SchoolSection:'primary'},{CbtPaperCleanupJobId:'other'}]){
    const h=await harness([paper('test1')]);h.put('academicTerms','term1',{...h.term(),...patch});
    assert.equal((await h.run()).ok,false);assert.equal(h.deleted.length,0);
  }
});

test('open terms, other branches, sections and sessions keep their paper files',async()=>{
  const h=await harness([paper('first'),paper('other-term',{TermId:'term2'}),paper('other-session',{SessionId:'other'}),
    paper('other-branch',{BranchId:'other'}),paper('primary',{SchoolSection:'primary'})]);
  await h.run();await h.run();
  assert.deepEqual(h.deleted,[url('first'),url('first','theory-paper')]);
  for(const name of ['other-term','other-session','other-branch','primary'])assert.equal(h.store.get(`academicCbtTests/${name}`).PaperUrl,url(name));
});

test('large terms are processed in bounded pages and resume without skipping tests',async()=>{
  const h=await harness(Array.from({length:14},(_,i)=>paper(`test${String(i).padStart(2,'0')}`)));
  const first=await h.run();assert.equal(first.cleaned,5);assert.equal(h.job().Status,'Pending');
  await h.run();await h.run();
  assert.equal(h.job().Status,'Complete');assert.equal(h.job().TestsCleaned,14);assert.equal(h.job().FilesRemoved,28);
  assert.equal(new Set(h.deleted).size,28);
  assert.ok(h.queries.every(q=>q.query.limit<=5));
});

test('late-entry and split-paper files are included without modifying attempts',async()=>{
  const h=await harness([paper('original'),paper('late',{LateEntryParentId:'original',PaperMode:'split',AnswerKey:['B']})]);
  assert.equal((await h.run()).cleaned,2);
  assert.equal(h.store.get('academicCbtTests/late').LateEntryParentId,'original');
  assert.deepEqual(h.store.get('academicCbtTests/late').AnswerKey,['B']);
});

test('storage ownership validation rejects foreign workspace, test, category and legacy URLs',()=>{
  const row=paper('test1');assert.doesNotThrow(()=>assertAcademicCbtRetentionUrls(env,row,[url('test1')]));
  for(const reference of [url('someone-else'),url('test1').replace('/school/school/','/school/other/'),
    url('test1').replace('/academic-cbt/','/receipts/'),url('test1').replace('/main/','/other/'),'https://example.com/old.pdf']){
    assert.throws(()=>assertAcademicCbtRetentionUrls(env,row,[reference]));
  }
});

test('unsafe paper references fail closed and remain available for review',async()=>{
  const h=await harness([paper('test1',{PaperUrl:url('other-test')})]);
  assert.equal((await h.run()).ok,false);assert.equal(h.deleted.length,0);
  assert.equal(h.store.get('academicCbtTests/test1').PaperUrl,url('other-test'));
});

test('pending cleanup blocks reopening, archiving or moving a term but not harmless name edits',()=>{
  const pending={...closed,CbtPaperCleanupStatus:'Pending'};
  assert.doesNotThrow(()=>assertAcademicTermRetentionEdit(pending,{...pending,Name:'Renamed'}));
  for(const patch of [{Status:'Active'},{Status:'Archived'},{SessionId:'new'},{StartDate:'2020-01-01'}])
    assert.throws(()=>assertAcademicTermRetentionEdit(pending,{...pending,...patch}),{code:'ACADEMIC_CBT_RETENTION_CONFLICT'});
  assert.doesNotThrow(()=>assertAcademicTermRetentionEdit({...pending,CbtPaperCleanupStatus:'Complete'},{...pending,Status:'Active'}));
});

test('term activation commits cleanup reservations together and scheduler is authenticated and school-only',async()=>{
  const management=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
  const save=management.slice(management.indexOf('export async function saveAcademicManagementRecord('),management.indexOf('function uniqueStudentReferences('));
  assert.ok(save.indexOf('academicCbtRetentionActivationWrites')<save.indexOf('await batchCommitDocuments'));
  assert.match(save,/assertAcademicTermRetentionEdit/);
  const scheduler=await readFile(new URL('../functions/api/notification-scheduler.js',import.meta.url),'utf8');
  assert.ok(scheduler.indexOf('requireSchedulerAuthorization(context.env')<scheduler.indexOf('await processAcademicCbtPaperRetention'));
  assert.match(scheduler,/attendanceOnly \|\| identity.edition !== 'school'/);
});
