import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {academicCbtLateEntryPlan as plan, academicCbtLateEntryRecord as record, sameCbtAssessmentPeriod, academicCbtAllStudentRefs} from '../functions/lib/academic-cbt-late-entry.js';
import {academicCbtRosterAdditionPlan} from '../functions/lib/academic-cbt-roster-additions.js';
import {commitAcademicCbtLateEntry} from '../functions/lib/academic-cbt-late-entry-commit.js';
import {copyAcademicCbtLateEntryPapers} from '../functions/lib/academic-cbt-late-entry-papers.js';
import {objectToFirestoreFields} from '../functions/lib/firestore.js';
import {academicManagementCapabilities} from '../functions/lib/academic-management.js';

const scope={SessionId:'session',TermId:'term',ClassId:'grade7',SubjectId:'math',BranchId:'main',SchoolSection:'secondary'};
const original={...scope,CbtTestId:'original',__id:'original',__updateTime:'r1',Status:'Scheduled',
  Title:'CA1 Maths',AssessmentComponentId:'ca1',AssessmentComponentName:'CA1',StudentRefs:['old'],
  StartsAt:'2020-01-01',DurationMinutes:30,PaperUrl:'r2://paper',PackageDigest:'digest',
  TeacherUsername:'teacher',AnswerKey:['A'],LocalDownloadedAt:'yesterday',LocalPackageIssuedAt:'yesterday'};
const input={CbtTestId:'original',...scope,StartsAt:'2099-01-01T09:00:00Z'};
const member=(StudentRef,patch={})=>({...scope,StudentRef,MembershipId:StudentRef,__id:StudentRef,__updateTime:'m1',Status:'Active',SubjectIds:[],...patch});

test('late entry excludes all previous candidates, superseded siblings and recorded marks; preserves original',()=>{
  const source=structuredClone(original), before=structuredClone(source);
  const tests=[source,{...source,CbtTestId:'sibling',StudentRefs:['other'],Status:'Superseded'}];
  const scores=['Numeric','Absent','Exempt'].map((State,i)=>({...scope,StudentRef:`marked${i}`,ComponentScores:[{ComponentId:'ca1',State}]}));
  scores.push({...scope,StudentRef:'split',ComponentScores:[{ComponentId:'ca1',Parts:[{State:'Numeric'}]}]});
  const roster=['old','new','other','marked0','marked1','marked2','split'].map(ref=>member(ref));
  const result=plan(source,roster,tests,scores,input);
  assert.deepEqual(result.StudentRefs,['new']); assert.equal(result.Excluded.length,6);
  assert.equal(result.EndsAt,'2099-01-01T09:30:00.000Z'); assert.deepEqual(source,before);
  const child=record(source,result,'child','ict','now');
  assert.equal(child.LateEntryParentId,'original'); assert.equal(child.PackageRevision,1);
  for(const key of ['AnswerKey','SubjectId','AssessmentComponentId','DurationMinutes']) assert.deepEqual(child[key],source[key]);
  for(const key of ['LocalDownloadedAt','LocalPackageIssuedAt','__updateTime','PackageDigest']) assert.equal(child[key],undefined);
  assert.deepEqual(plan(source,roster,[...tests,child],scores,input).StudentRefs,[]);
});

test('only reviewed selection, canonical references and unambiguous active memberships qualify',()=>{
  const roster=[member('new'),member('other')];
  assert.deepEqual(plan(original,roster,[original],[],{...input,StudentRefs:[' NEW ','new']}).StudentRefs,['new']);
  assert.throws(()=>plan(original,roster,[],[],{...input,StudentRefs:['old']}),{code:'ACADEMIC_CBT_LATE_ENTRY_CHANGED'});
  assert.deepEqual(plan(original,roster,[],[],input,Date.now(),[...roster,member('new',{ClassId:'other'})]).StudentRefs,['other']);
  assert.deepEqual(plan(original,roster,[{...original,AssessmentComponentId:'ca2',AssessmentComponentName:'CA2',StudentRefs:['new']}],[],input).StudentRefs,['new','other']);
});

test('future unused originals, children, removed papers, invalid dates and oversized selections fail closed',()=>{
  for(const patch of [{Status:'Superseded'},{LateEntryParentId:'parent'},{CloudPaperRemovedAt:'removed'},
    {PaperUrl:'',PaperFiles:[]},{DurationMinutes:0},{PaperMode:'split',TheoryDurationMinutes:0},
    {LocalDownloadedAt:'',LocalPackageIssuedAt:'',StartsAt:'2099-02-01'}]) {
    assert.throws(()=>plan({...original,...patch},[member('new')],[],[],input));
  }
  for(const StartsAt of ['invalid','2020-01-01']) assert.throws(()=>plan(original,[member('new')],[],[],{...input,StartsAt}));
  assert.throws(()=>plan(original,Array.from({length:1001},(_,i)=>member(String(i))),[],[],input));
});

function transactionFixture(state, change={}) {
  const calls=[],commits=[];
  const collections={academicStudentMemberships:'studentMemberships',academicCbtTests:'cbtTests',academicStudentScores:'studentScores'};
  return {calls,commits,deps:{token:async()=> 'token',base:()=> 'https://firestore.test/documents',
    fetch:async(url,init)=>{
      const body=JSON.parse(init.body);calls.push({url,body});
      if(url.endsWith(':rollback'))return Response.json({});
      const collection=body.structuredQuery.from[0].collectionId, key=collections[collection];
      const rows=change[key]??state[key];
      return Response.json([{transaction:'tx'},...rows.map(row=>({document:{name:`projects/p/databases/(default)/documents/${collection}/${row.__id}`,
        updateTime:row.__updateTime,fields:objectToFirestoreFields(row)}}))]);
    },commit:async(_env,writes,options)=>{commits.push({writes,options});return {writeResults:[]};}}};
}
test('transaction protects roster, source/sibling packages and marks without rewriting history',async()=>{
  const state={studentMemberships:[member('new')],cbtTests:[original],studentScores:[]};
  const f=transactionFixture(state), writes=[{documentId:'child',exists:false,data:{}}];
  await commitAcademicCbtLateEntry({},writes,original,state,input.StartsAt,f.deps);
  assert.equal(f.calls.length,3); assert.deepEqual(f.calls[0].body.newTransaction,{readWrite:{}});
  assert.equal(f.calls[0].body.structuredQuery.where.fieldFilter.field.fieldPath,'SessionId');
  assert.equal(f.calls[1].body.transaction,'tx'); assert.deepEqual(f.commits,[{writes,options:{transaction:'tx'}}]);
  for(const change of [{studentMemberships:[]},{studentMemberships:[...state.studentMemberships,member('new',{__id:'duplicate',ClassId:'other'})]},
    {cbtTests:[{...original,__updateTime:'r2'}]}, {cbtTests:[original,{...original,__id:'child'}]},
    {studentScores:[{...scope,__id:'score',__updateTime:'s1'}]}]) {
    const race=transactionFixture(state,change);
    await assert.rejects(commitAcademicCbtLateEntry({},writes,original,state,input.StartsAt,race.deps),{code:'ACADEMIC_CBT_LATE_ENTRY_CHANGED'});
    assert.equal(race.commits.length,0); assert.ok(race.calls.at(-1).url.endsWith(':rollback'));
    const adding=transactionFixture(state,change);
    await assert.rejects(commitAcademicCbtLateEntry({},writes,original,state,'2020-01-01',{...adding.deps,addOnlyRoster:true}),
      {code:'ACADEMIC_CBT_LATE_ENTRY_CHANGED'});
    assert.equal(adding.commits.length,0);
  }
  const adding=transactionFixture(state);
  await commitAcademicCbtLateEntry({},writes,original,state,'2020-01-01',{...adding.deps,addOnlyRoster:true});
  assert.equal(adding.commits.length,1,'Additions preserve an existing schedule instead of demanding a new future sitting');
});

test('paper copies verify bytes and use independent, retry-stable storage keys',async()=>{
  const bytes=new TextEncoder().encode('paper');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const file={Url:'r2://original',FileName:'math.pdf',MimeType:'application/pdf',Digest:digest};
  const calls=[], deps={get:async()=>({object:{size:bytes.length,arrayBuffer:async()=>bytes.buffer}}),
    put:async(_env,payload)=>{calls.push(payload);return {reference:`r2://${payload.ownerId}/${payload.documentType}/${payload.operationId}`};}};
  const source={...original,PaperMode:'split',PaperFiles:[file],TheoryPaperFiles:[file]};
  const copied=await copyAcademicCbtLateEntryPapers({},source,'child',deps);
  assert.notEqual(copied.PaperUrl,file.Url); assert.notEqual(copied.TheoryPaperUrl,copied.PaperUrl);
  assert.equal(copied.PaperDigest,digest); assert.equal(copied.PaperByteLength,bytes.length);
  assert.deepEqual(await copyAcademicCbtLateEntryPapers({},source,'child',deps),copied);
  assert.equal(source.PaperFiles[0].Url,'r2://original');
  await assert.rejects(copyAcademicCbtLateEntryPapers({},{...source,PaperFiles:[{...file,Digest:'bad'}]},'child',deps),/digest/);
  assert.equal(calls.length,4);
});

const managementSource=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
function apiFixture(stage='junior-secondary') {
  let loseCommitResponse=false;
  const members=[member('old'),member('new'),member('senior',{SubjectIds:['math']})], tests=[structuredClone(original)], scores=[], writes=[];
  const state={studentMemberships:members,cbtTests:tests,classes:[{...scope,Status:'Active',SchoolStage:stage}],
    subjects:[{...scope,Status:'Active'}],teacherAllocations:[{...scope,Status:'Active',AllocationRole:'Subject Teacher',TeacherUsername:'teacher'}]};
  const clean=v=>String(v??'').trim();
  const ctx=vm.createContext({crypto,TextEncoder,Uint8Array,Date,clean,lower:v=>clean(v).toLowerCase(),
    ACADEMIC_CBT_STATE_KEYS:[],ACADEMIC_MANAGEMENT_COLLECTIONS:{studentScores:'scores',cbtTests:'tests'},
    academicCbtLateEntryPlan:plan,academicCbtLateEntryRecord:record,sameCbtAssessmentPeriod,
    academicCbtRosterAdditionPlan,academicCbtAllStudentRefs,
    effectiveAcademicSection:r=>r.SchoolSection || 'secondary',
    academicOperationalContext:async(_env,user,payload)=>{
      const permissions=academicManagementCapabilities(user);
      if(!permissions.canCreateCbt||user.subscriptionReadOnly)throw Object.assign(new Error('Forbidden'),{status:403});
      assert.equal(payload.SchoolSection,'secondary');
      return {permissions,state:structuredClone(state),scope:{section:'secondary'},session:{SessionId:'session'},term:{TermId:'term'}};
    },failure:(message,status,code)=>Object.assign(new Error(message),{status,code}),
    findById:(rows,id)=>rows.find(r=>[r.CbtTestId,r.ClassId,r.SubjectId].includes(id)),
    assertReference:r=>{assert.ok(r);return r;},statusActive:r=>r.Status==='Active',
    actorUsername:u=>u.username,actorName:u=>u.username,nowIso:()=>new Date().toISOString(),
    academicAssessmentForPeriod:async()=>({Ready:true}),recordId:r=>r.__id,
    academicId:(...parts)=>parts.join('-'),queryCollection:async()=>structuredClone(scores),
    publicRecord:r=>({...r,RevisionToken:r.__updateTime}),withoutMetadata:r=>r,
    writePrecondition:(r,token)=>{assert.equal(token,r.__updateTime);return {updateTime:token};},
    copyAcademicCbtLateEntryPapers:async()=>({PaperUrl:'r2://child'}),academicCbtPackageDigest:async()=> 'child-digest',
    auditWrite:()=>({collectionPath:'audit',data:{}}),
    getDocument:async(_env,_collection,id)=>tests.find(r=>r.CbtTestId===id),
    commitAcademicCbtLateEntry:async(_env,batch)=>{writes.push(batch);
      const row={...batch[0].data,__id:batch[0].documentId,__updateTime:`c${writes.length}`};
      if(batch[0].updateTime) {
        const index=tests.findIndex(r=>r.CbtTestId===batch[0].documentId);
        assert.equal(tests[index].__updateTime,batch[0].updateTime); tests[index]=row;
      } else tests.push(row);
      if(loseCommitResponse)throw Object.assign(new Error('Response lost'),{status:503});return {writeResults:[{updateTime:'c1'}]};}
  });
  for(const [start,end] of [['function academicCbtAuthority(','async function academicCbtPackageDigest('],
    ['export async function createAcademicCbtLateEntry(','export async function rescheduleAcademicCbtTest(']]) {
    vm.runInContext(managementSource.slice(managementSource.indexOf(start),managementSource.indexOf(end)).replace(/^export /gm,''),ctx);
  }
  const actor={username:'teacher',role:'Teacher',edition:'school',allowedSections:['academics'],branchId:'main'};
  return {members,tests,scores,writes,actor,loseResponse:()=>{loseCommitResponse=true;},
    call:(payload=input,post=false,user=actor)=>ctx.createAcademicCbtLateEntry({},user,payload,post),
    add:(payload=input,post=false,user=actor)=>ctx.addAcademicCbtRosterStudents({},user,payload,post),
    getAdditions:(payload=input,user=actor)=>ctx.getAcademicCbtRosterAdditions({},user,payload)};
}
test('review/create is authorised, idempotent and preserves source; stale membership selection rejected',async()=>{
  const f=apiFixture(), before=structuredClone(f.tests[0]);
  const review=(await f.call()).lateEntryReview;
  assert.deepEqual(Array.from(review.StudentRefs),['new','senior']);assert.equal(f.writes.length,0);
  const payload={...input,...review};const first=await f.call(payload,true);const retry=await f.call(payload,true);
  assert.equal(first.cbtTest.CbtTestId,retry.cbtTest.CbtTestId);assert.equal(f.writes.length,1);
  assert.deepEqual(f.tests[0],before);assert.deepEqual(Array.from(f.writes[0],w=>w.collectionPath),['tests','audit']);
  assert.equal(f.writes[0][0].exists,false);
  assert.deepEqual(Array.from((await f.call()).lateEntryReview.StudentRefs),[]);
  await assert.rejects(f.call(input,false,{...f.actor,username:'other'}),{code:'ACADEMIC_CBT_OWNER_FORBIDDEN'});
  await assert.rejects(f.call(input,false,{...f.actor,subscriptionReadOnly:true}),{status:403});
  const stale=apiFixture();const p=(await stale.call()).lateEntryReview;
  stale.members[1].__updateTime='changed';
  await assert.rejects(stale.call({...input,...p},true),{code:'ACADEMIC_CBT_LATE_ENTRY_CHANGED'});assert.equal(stale.writes.length,0);
});
test('senior late entry respects subjects and excludes posted marks before creation',async()=>{
  const f=apiFixture('senior-secondary');
  assert.deepEqual(Array.from((await f.call()).lateEntryReview.StudentRefs),['senior']);
  f.scores.push({...scope,StudentRef:'senior',ComponentScores:[{ComponentId:'ca1',State:'Numeric',RawScore:80}]});
  assert.deepEqual(Array.from((await f.call()).lateEntryReview.StudentRefs),[]);
});

test('legacy memberships and score sections use the existing school-section mapping',async()=>{
  const f=apiFixture();delete f.members[1].SchoolSection;
  f.members.push(member('new',{__id:'other',ClassId:'another',SchoolSection:undefined}));
  f.scores.push({...scope,SchoolSection:undefined,StudentRef:'senior',ComponentScores:[{ComponentId:'ca1',State:'Numeric'}]});
  assert.deepEqual(Array.from((await f.call()).lateEntryReview.StudentRefs),[]);
});

test('lost commit responses recover the saved child without duplicate creation or truncated storage IDs',async()=>{
  const f=apiFixture();const review=(await f.call()).lateEntryReview;f.loseResponse();
  const response=await f.call({...input,...review},true);
  assert.equal(response.ok,true);assert.equal(f.writes.length,1);
  assert.ok(response.cbtTest.CbtTestId.length<96);
  assert.ok(response.cbtTest.CbtTestId.endsWith(review.PreviewToken));
  assert.equal((await f.call({...input,...review},true)).cbtTest.CbtTestId,response.cbtTest.CbtTestId);
  assert.equal(f.writes.length,1);
});

test('each original has a distinct preview identity and large score histories never produce partial eligibility',async()=>{
  const f=apiFixture(), first=(await f.call()).lateEntryReview;
  f.tests[0].CbtTestId='different';
  const second=(await f.call({...input,CbtTestId:'different'})).lateEntryReview;
  assert.notEqual(first.PreviewToken,second.PreviewToken);
  f.scores.push(...Array.from({length:10001},()=>({...scope})));
  await assert.rejects(f.call({...input,CbtTestId:'different'}),{code:'ACADEMIC_CBT_LATE_ENTRY_HISTORY_LIMIT'});
});

test('downloaded roster additions preserve base package and are reviewed, repeat-safe and readable by both servers',async()=>{
  const f=apiFixture(), before=structuredClone(f.tests[0]);
  const review=(await f.add()).rosterReview;
  assert.deepEqual(Array.from(review.Added),['new','senior']); assert.equal(f.writes.length,0);
  const payload={...input,...review};
  const result=await f.add(payload,true); await f.add(payload,true);
  assert.equal(f.writes.length,1); assert.equal(f.tests.length,1);
  assert.deepEqual(Array.from(result.cbtTest.StudentRefs),before.StudentRefs);
  for(const key of ['PackageDigest','PackageRevision','StartsAt','DurationMinutes','AnswerKey','LocalDownloadedAt','PaperUrl']) {
    assert.deepEqual(result.cbtTest[key],before[key]);
  }
  assert.equal(result.cbtTest.RosterCount,3); assert.equal(result.cbtTest.RosterRevision,1);
  assert.equal(result.cbtTest.RosterDigest.length,64);
  assert.equal(f.writes[0][0].updateTime,'r1');
  for(let server=0;server<2;server++) {
    const row=(await f.getAdditions()).rosterPackage;
    assert.deepEqual(Array.from(row.StudentRefs),['new','old','senior']); assert.equal(row.RosterRevision,1);
  }
  assert.equal((await f.add()).rosterReview.Added.length,0);
  assert.equal((await f.call()).lateEntryReview.StudentRefs.length,0,'Added students cannot also receive a late-entry retake');
});

test('an uncertain additions response can be retried without duplicate candidates or another audit',async()=>{
  const f=apiFixture(); const review=(await f.add()).rosterReview; f.loseResponse();
  await assert.rejects(f.add({...input,...review},true),/Response lost/);
  const retry=await f.add({...input,...review},true);
  assert.equal(retry.cbtTest.RosterCount,3); assert.equal(f.writes.length,1);
  assert.equal(retry.cbtTest.RosterRevision,1);
});

test('additions use current junior/senior eligibility and exclude sibling candidates, marks and ambiguous memberships',async()=>{
  const f=apiFixture('senior-secondary');
  assert.deepEqual(Array.from((await f.add()).rosterReview.Added),['senior']);
  f.tests.push({...original,CbtTestId:'late',__id:'late',StudentRefs:[],AdditionalStudentRefs:['senior']});
  assert.equal((await f.add()).rosterReview.Added.length,0);
  f.tests.pop(); f.scores.push({...scope,StudentRef:'senior',ComponentScores:[{ComponentId:'ca1',State:'Numeric'}]});
  assert.equal((await f.add()).rosterReview.Added.length,0);
  f.scores.pop(); f.members.push(member('senior',{MembershipId:'duplicate',__id:'duplicate',ClassId:'other'}));
  assert.equal((await f.add()).rosterReview.Added.length,0);
});

test('late-entry children can receive add-only updates without inheriting the parent additions',async()=>{
  const f=apiFixture();
  f.tests[0].LateEntryParentId='parent';
  const review=(await f.add()).rosterReview;
  assert.equal(review.Added.length,2); await f.add({...input,...review},true);
  assert.equal(f.tests[0].LateEntryParentId,'parent');
  const child=record({...original,AdditionalStudentRefs:['existing'],RosterRevision:4,RosterDigest:'old'},{
    StudentRefs:['new'],StartsAt:'2099-01-01',EndsAt:'2099-01-02'
  },'child','ict','now');
  assert.equal(child.AdditionalStudentRefs,undefined); assert.equal(child.RosterRevision,undefined);
});

test('stale reviews, wrong owner, period and read-only accounts cannot add students',async()=>{
  const f=apiFixture();
  const p=(await f.add()).rosterReview;
  f.members[1].__updateTime='changed';
  await assert.rejects(f.add({...input,...p},true),{code:'ACADEMIC_CBT_ROSTER_CHANGED'});
  await assert.rejects(f.add(input,false,{...f.actor,username:'other'}),{code:'ACADEMIC_CBT_OWNER_FORBIDDEN'});
  await assert.rejects(f.getAdditions(input,{...f.actor,username:'other'}),{code:'ACADEMIC_CBT_OWNER_FORBIDDEN'});
  await assert.rejects(f.add(input,true,{...f.actor,subscriptionReadOnly:true}),{status:403});
  f.tests[0].TermId='another';
  await assert.rejects(f.add(),{code:'ACADEMIC_CBT_TEST_NOT_FOUND'});
  await assert.rejects(f.getAdditions(),{code:'ACADEMIC_CBT_TEST_NOT_FOUND'});
  assert.equal(f.writes.length,0);
});

test('additions fail closed for unissued/archived tests, oversized lists and incomplete history',async()=>{
  const f=apiFixture();
  f.tests[0].LocalDownloadedAt=''; f.tests[0].LocalPackageIssuedAt='';
  await assert.rejects(f.add(),{code:'ACADEMIC_CBT_ROSTER_ADDITION_INVALID'});
  f.tests[0].LocalDownloadedAt='issued'; f.tests[0].Status='Archived';
  await assert.rejects(f.add(),{code:'ACADEMIC_CBT_ROSTER_ADDITION_INVALID'});
  f.tests[0].Status='Scheduled'; f.scores.push(...Array.from({length:10001},()=>({...scope})));
  await assert.rejects(f.add(),/complete eligibility/);
  assert.throws(()=>academicCbtRosterAdditionPlan(original,Array.from({length:1000},(_,i)=>member(`new${i}`)),[],[]),{status:413});
  assert.equal(f.writes.length,0);
});
