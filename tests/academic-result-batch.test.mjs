import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {defaultAcademicPolicy} from '../functions/lib/academic-policy.js';
import {calculateAcademicTermResultDrafts,calculateAcademicMidTermResultDrafts} from '../functions/lib/academic-term-results.js';
import {planAcademicResultBatch} from '../functions/lib/academic-result-batch.js';
const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
function fixture(type='Mid-Term'){
  const scope={BranchId:'main',SchoolSection:'secondary',SessionId:'s',TermId:'t',ClassId:'c',ArmId:'a',ResultType:type};
  const policy=defaultAcademicPolicy();policy.Position.Mode='none';policy.Promotion.Mode='manual-review';
  policy.ResultAccess.VisibilityMode='current-term';policy.ResultAccess.FinancialClearance.Mode='none';
  policy.Assessment.Components=[{Id:'ca',Name:'CA1',MaximumScore:100,WeightPercentage:100,Required:true}];
  policy.Assessment.GradeBands=[{Grade:'A',MinimumPercentage:0,MaximumPercentage:100}];policy.MidTerm={Enabled:true,ComponentIds:['ca']};
  const state={sessions:[{SessionId:'s'}],terms:[{SessionId:'s',TermId:'t'}],classes:[{ClassId:'c',Name:'Grade 7'}],
    arms:[{ClassId:'c',ArmId:'a',Name:'Brilliance'}],subjects:[{SubjectId:'math',Name:'Mathematics'}],
    studentMemberships:['good','pending','changed','published'].map(StudentRef=>({...scope,MembershipId:`m-${StudentRef}`,StudentRef,Status:'Active',SubjectIds:['math'],__updateTime:'membership-v1'})),
    scoreSheets:[{...scope,SheetId:'sheet',SubjectId:'math',Status:'Approved',AssessmentRevisionId:'revision',__updateTime:'sheet-v1'}],
    studentScores:['good','pending','changed','published'].map(StudentRef=>({...scope,SheetId:'sheet',StudentRef,SubjectId:'math',AssessmentRevisionId:'revision',
      CompletionStatus:'Complete',Percentage:75,WeightedTotal:75,ComponentScores:[{ComponentId:'ca',State:'Numeric',RawScore:75}]}))};
  const calculated=(type==='Mid-Term'?calculateAcademicMidTermResultDrafts:calculateAcademicTermResultDrafts)({...scope,Policy:policy,
    Memberships:state.studentMemberships,ScoreSheets:state.scoreSheets,StudentScores:state.studentScores,Subjects:state.subjects,ResultIdFor:m=>`r-${m.StudentRef}`});
  assert.equal(calculated.Ready,true);
  state.termResults=calculated.Results.map(row=>({...row,...scope,SubjectSelectionSnapshot:{SubjectIds:['math']},__updateTime:'v1',
    ...(row.StudentRef==='published'?{Status:'Published',PublicationStatus:'Published',PublishedAt:'2026-10-26T10:00:00Z'}:{})}));
  state.studentScores=state.studentScores.filter(row=>row.StudentRef!=='pending');
  state.studentScores.find(row=>row.StudentRef==='changed').ComponentScores[0].RawScore=40;
  state.studentScores.find(row=>row.StudentRef==='changed').Percentage=40;
  const items=state.termResults.map(row=>({ResultId:row.ResultId,RevisionToken:'v1'}));
  return {state,scope,items};
}
test('saved untaught mid-term subjects remain excluded without inventing scores or changing enrolment',()=>{
  const f=fixture(),member=f.state.studentMemberships[0];member.SubjectIds.push('trade');
  f.state.subjects.push({SubjectId:'trade',Name:'Computer Hardware and GSM Repairs'});
  const result=calculateAcademicMidTermResultDrafts({...f.scope,Memberships:[member],ScoreSheets:f.state.scoreSheets,
    StudentScores:f.state.studentScores,Subjects:f.state.subjects,Policy:f.state.termResults[0].PolicySnapshot,
    NotTaughtSubjectIds:['trade'],NotTaughtReason:'Lessons have not started',ResultIdFor:()=> 'r-good'});
  assert.equal(result.Ready,true);
  f.state.termResults[0]={...result.Results[0],...f.scope,__updateTime:'v1',SubjectSelectionSnapshot:{SubjectIds:['math','trade']}};
  const before=structuredClone(f.state),plan=planAcademicResultBatch(f.state,f.scope,[f.items[0]],'ReviewApprovePublish');
  assert.equal(plan.outcomes[0].Outcome,'Updated');assert.equal(plan.outcomes[0].result.Subjects.length,1);
  assert.equal(plan.outcomes[0].result.NotTaughtSubjects[0].SubjectId,'trade');assert.deepEqual(f.state,before);
});
for(const type of ['Mid-Term','End of Term'])test(`${type}: incomplete and changed marks remain pending while complete results follow every selected stage`,()=>{
  const f=fixture(type),before=structuredClone(f.state);
  const plan=planAcademicResultBatch(f.state,f.scope,f.items,'ReviewApprovePublish');
  assert.deepEqual(plan.changes.find(row=>row.previous.StudentRef==='good').stages,['Reviewed','Approved','Published']);
  assert.equal(plan.outcomes.find(row=>row.StudentRef==='pending').Outcome,'Pending');
  assert.equal(plan.outcomes.find(row=>row.StudentRef==='changed').Outcome,'Pending');
  assert.equal(plan.outcomes.find(row=>row.StudentRef==='published').Outcome,'Already complete');
  assert.ok(!plan.changes.some(row=>row.previous.StudentRef==='published'));assert.deepEqual(f.state,before);
});
test('revision conflicts, foreign scope, withdrawn results and missing prior approval do not advance',()=>{
  const f=fixture();f.items[0].RevisionToken='stale';
  assert.equal(planAcademicResultBatch(f.state,f.scope,f.items,'Reviewed').outcomes[0].Outcome,'Conflict');
  f.items[0].RevisionToken='v1';
  assert.equal(planAcademicResultBatch(f.state,f.scope,f.items,'Published').outcomes[0].Outcome,'Not eligible');
  for(const change of [{BranchId:'other'},{SchoolSection:'primary'},{SessionId:'old'},{TermId:'old'},{ClassId:'other'},{ArmId:'other'},{ResultType:'End of Term'}]){
    assert.equal(planAcademicResultBatch(f.state,{...f.scope,...change},f.items,'Reviewed').changes.length,0);
  }
  f.state.termResults[0].Status='Withdrawn';assert.equal(planAcademicResultBatch(f.state,f.scope,f.items,'ReviewApprovePublish').outcomes[0].Outcome,'Not eligible');
});
test('absent/duplicate placements and recorded pending flags remain pending without changing saved snapshots',()=>{
  for(const mode of ['absent','duplicate','flag']){
    const f=fixture();let related=[];
    if(mode==='absent')f.state.studentMemberships=f.state.studentMemberships.filter(row=>row.StudentRef!=='good');
    if(mode==='duplicate')related=[{...f.state.studentMemberships[0],MembershipId:'duplicate',ArmId:'other'}];
    if(mode==='flag')f.state.termResults[0].CalculationPending=true;
    const plan=planAcademicResultBatch(f.state,f.scope,[f.items[0]],'ReviewApprovePublish',related);
    assert.equal(plan.outcomes[0].Outcome,'Pending',mode);assert.equal(plan.changes[0]?.stages.length||0,0);
  }
});
function endpointFixture(){
  const f=fixture(),writes=[],notified=[],reads=[];let serial=0;
  const context=vm.createContext({planAcademicResultBatch,
    clean:value=>String(value??'').trim(),lower:value=>String(value??'').trim().toLowerCase(),
    failure:(message,status=400)=>Object.assign(new Error(message),{status}),requireWritableSubscription:user=>{if(user.readOnly)throw new Error('Read only');},
    requireCapability:(user,capability)=>{if(!user[capability])throw Object.assign(new Error('Forbidden'),{status:403});},
    uniqueIds:values=>[...new Set(values)],assertReference:(row,message)=>{if(!row)throw new Error(message);return row;},
    findById:(rows,id)=>rows.find(row=>[row.ResultId,row.ArmId].includes(id)),scopedAcademicRows:rows=>rows,
    academicOperationalContext:async(_e,_u,_i,_c,options)=>{reads.push(options);return {scope:{branchId:'main',section:'secondary'},state:f.state};},
    queryCollectionPages:async()=>f.state.studentMemberships,loadAcademicCalculationScores:async()=>f.state.studentScores,
    ACADEMIC_MANAGEMENT_COLLECTIONS:{studentMemberships:'academicStudentMemberships',termResults:'academicResults',resultEvents:'academicResultEvents'},
    nowIso:()=>`2026-10-26T12:00:${String(serial++).padStart(2,'0')}Z`,actorName:()=> 'Reviewer',actorUsername:()=> 'reviewer',
    academicResultEventWrite:(_user,result,event)=>({collectionPath:'academicResultEvents',documentId:`event-${serial++}`,data:{ResultEventId:`event-${serial}`,ResultId:result.ResultId,EventType:event,Status:result.Status}}),
    auditWrite:()=>({collectionPath:'academicManagementAudit',documentId:'audit',data:{}}),withoutMetadata:row=>structuredClone(row),
    writePrecondition:(row,token)=>{assert.equal(row.__updateTime,token);return {updateTime:token};},
    academicResultBatchRecipients:async(_e,_s,rows)=>{reads.push({recipients:rows.map(row=>row.StudentRef)});return [];},
    notifyAcademicResultLifecycle:async(_e,_u,_s,rows)=>{notified.push(rows);return {warnings:0};},
    publicRecord:row=>({...row,RevisionToken:row.__updateTime}),
    commitAcademicResultBatch:async(_e,batch,_scope,evidence)=>{
      assert.ok(evidence.refs.every(ref=>ref!=='published'));writes.push(...batch);
      const receipts=batch.map((_w,index)=>({updateTime:`commit-${index}`}));
      batch.forEach((write,index)=>{if(write.collectionPath==='academicResults'){
        const row=f.state.termResults.find(row=>row.ResultId===write.documentId);Object.assign(row,write.data,{__updateTime:receipts[index].updateTime});
      }});return {writeResults:receipts};
    }});
  const method=source.match(/export async function batchChangeAcademicResultStatus\([\s\S]*?\n}/)[0];vm.runInContext(method.replace('export ',''),context);
  return {...f,context,writes,notified,reads,user:{canReviewResults:true,canPublishResults:true}};
}
test('server commits ready results and pending metadata, emits one batch audit, returns saved revisions, and retries without duplicate history',async()=>{
  const f=endpointFixture(),before=structuredClone(f.state);
  const input={...f.scope,Status:'ReviewApprovePublish',Items:f.items};
  const response=await f.context.batchChangeAcademicResultStatus({},f.user,input);
  assert.equal(response.batchResults.filter(row=>row.Outcome==='Updated').length,1);
  assert.equal(response.batchResults.filter(row=>row.Outcome==='Pending').length,2);
  assert.equal(f.writes.filter(row=>row.collectionPath==='academicManagementAudit').length,1);
  assert.deepEqual(f.writes.filter(row=>row.collectionPath==='academicResultEvents'&&row.data.ResultId==='r-good').map(row=>row.data.EventType),['REVIEWED','APPROVED','PUBLISHED']);
  assert.ok(!f.writes.some(row=>/StudentScores|StudentMemberships|ScoreSheets/.test(row.collectionPath)));
  assert.equal(response.batchResults.find(row=>row.ResultId==='r-good').result.RevisionToken,'commit-0');
  for(const ref of ['pending','changed']){
    const row=f.state.termResults.find(row=>row.StudentRef===ref);assert.equal(row.CalculationPending,true);
    assert.deepEqual(row.Subjects,before.termResults.find(row=>row.StudentRef===ref).Subjects);
  }
  assert.deepEqual(f.state.studentScores,before.studentScores);assert.deepEqual(structuredClone(f.state.studentMemberships),before.studentMemberships);
  const writeCount=f.writes.length;
  await f.context.batchChangeAcademicResultStatus({},f.user,{...input,Items:f.state.termResults.map(row=>({ResultId:row.ResultId,RevisionToken:row.__updateTime}))});
  assert.equal(f.writes.length,writeCount);assert.equal(f.reads[0].scoreReadScope.ArmId,'a');
  assert.ok(!f.reads[0].stateKeys.includes('resultEvents'));assert.ok(!f.reads[0].stateKeys.includes('studentAttendance'));
});
test('batch enforces permissions, explicit classroom/type, and payload limits before reading',async()=>{
  const f=endpointFixture(),input={...f.scope,Status:'Reviewed',Items:f.items};
  await assert.rejects(f.context.batchChangeAcademicResultStatus({}, {},input),{status:403});
  await assert.rejects(f.context.batchChangeAcademicResultStatus({}, {canPublishResults:true},{...input,Status:'ReviewApprovePublish'}),{status:403});
  await assert.rejects(f.context.batchChangeAcademicResultStatus({}, {...f.user,readOnly:true},input),/Read only/);
  for(const change of [{Items:[]},{Items:Array(26).fill(f.items[0])},{ArmId:''},{ResultType:''},{Status:'Locked'}])await assert.rejects(f.context.batchChangeAcademicResultStatus({},f.user,{...input,...change}));
  assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);
});

test('a placement or subject edit between context loading and the focused membership read cannot publish the old snapshot',async()=>{
  for(const changes of [{SubjectIds:['math','new-subject']},{ArmId:'another-classroom'},{Status:'Archived'}]){
    const f=endpointFixture();
    f.context.queryCollectionPages=async()=>f.state.studentMemberships.map(row=>row.StudentRef==='good'
      ? {...row,...changes,__updateTime:'membership-v2'}:row);
    const response=await f.context.batchChangeAcademicResultStatus({},f.user,{...f.scope,Status:'ReviewApprovePublish',Items:[f.items[0]]});
    assert.equal(response.batchResults[0].Outcome,'Pending');assert.equal(response.batchResults[0].result.Status,'Calculated Draft');
    assert.ok(!f.writes.some(row=>row.data.EventType==='PUBLISHED'));
  }
});
