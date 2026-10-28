import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {defaultAcademicPolicy} from '../functions/lib/academic-policy.js';
import {calculateAcademicTermResultDrafts,calculateAcademicMidTermResultDrafts,ACADEMIC_TERM_RESULT_STATUSES,academicTermResultTransition} from '../functions/lib/academic-term-results.js';
import {academicPolicyIssues} from '../functions/lib/academic-policy.js';
import {academicScoreMembershipGuards} from '../functions/lib/academic-management.js';
const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
function fixture(){
  const policy=defaultAcademicPolicy();policy.Position.Mode='exact-overall';policy.MidTerm={Enabled:true,ComponentIds:['ca']};
  policy.Promotion.Mode='manual-review';policy.ResultAccess.VisibilityMode='current-term';policy.ResultAccess.FinancialClearance.Mode='none';
  policy.Assessment.Components=[{Id:'ca',Name:'CA1',MaximumScore:100,WeightPercentage:100,Required:true}];
  policy.Assessment.GradeBands=[{Grade:'A',MinimumPercentage:0,MaximumPercentage:100}];
  const period={SessionId:'s1',TermId:'t1',ClassId:'c1',ArmId:'a1',ResultType:'Mid-Term'};
  const state={studentMemberships:['good','pending','published'].map(StudentRef=>({...period,StudentRef,MembershipId:`membership-${StudentRef}`,__updateTime:`membership-${StudentRef}-v1`,SubjectIds:['math'],Status:'Active'})),
    subjects:[{SubjectId:'math',Name:'Mathematics'}],scoreSheets:[{...period,SheetId:'sheet',SubjectId:'math',Status:'Draft',AssessmentRevisionId:'r1'}],
    studentScores:[{...period,SheetId:'sheet',StudentRef:'good',SubjectId:'math',AssessmentRevisionId:'r1',ComponentScores:[{ComponentId:'ca',State:'Numeric',RawScore:75}]}],
    studentAttendance:[],schoolCalendars:[],termResults:[
      {...period,ResultId:'result-published',StudentRef:'published',Status:'Published',Subjects:[{Total:90}],__updateTime:'pub-v1'},
      {...period,ResultId:'result-pending',StudentRef:'pending',Status:'Calculated Draft',Subjects:[{Total:80}],__updateTime:'draft-v1'}]};
  const context={state,scope:{branchId:'main',section:'secondary'},session:{SessionId:'s1',Name:'2026/2027'},term:{TermId:'t1',Name:'First Term'},
    schoolClass:{ClassId:'c1',Name:'Grade 10'},arm:{ArmId:'a1',Name:'Brilliance'},policy,policyRevisionIds:['r1'],policyFingerprint:'fingerprint'};
  const writes=[];
  const sandbox=vm.createContext({clean:v=>String(v??'').trim(),lower:v=>String(v??'').trim().toLowerCase(),
    failure:(message,status=409,code,extra={})=>Object.assign(new Error(message),{status,code,...extra}),statusActive:r=>r.Status==='Active',
    academicTermResultContext:async()=>context,academicOperationalContext:async()=>context,
    calculateAcademicTermResultDrafts,calculateAcademicMidTermResultDrafts,ACADEMIC_TERM_RESULT_STATUSES,academicTermResultTransition,academicPolicyIssues,academicScoreMembershipGuards,
    notifyAcademicResultLifecycle:async()=>{},
    academicTermResultId:(...args)=>`result-${args[5]}`,academicResultReference:async id=>id,
    findById:(rows,id)=>rows.find(row=>row.ResultId===id),nowIso:()=> '2026-10-26T12:00:00Z',actorName:()=> 'Reviewer',actorUsername:()=> 'reviewer',
    subjectSelection:r=>({SubjectIds:r.SubjectIds}),withoutMetadata:r=>structuredClone(r),
    writePrecondition:(existing,token)=>{if(existing){assert.equal(token,existing.__updateTime);return {updateTime:token};}return {exists:false};},
    ACADEMIC_MANAGEMENT_COLLECTIONS:{termResults:'academicResults'},
    academicResultEventWrite:(_u,result)=>({collectionPath:'academicResultEvents',documentId:result.ResultId,data:{StudentRef:result.StudentRef}}),
    auditWrite:()=>({collectionPath:'academicManagementAudit',documentId:'audit',data:{}}),
    commitAcademicBatch:async(_env,batch)=>writes.push(...batch),academicOperationalResponse:async(_e,_u,_i,_s,message)=>({ok:true,message}),
    academicTermResultIds:value=>value,academicSubjectSelectionChanged:()=>false});
  for(const name of ['calculateAcademicResultsForType','resultRevisionToken','changeAcademicTermResultStatus']){
    vm.runInContext(source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([\\s\\S]*?\\n}`))[0].replace('export ',''),sandbox);
  }
  return {state,sandbox,writes,period,context,policy};
}
test('partial calculation preserves published snapshots, pending draft marks and every source score',async()=>{
  const f=fixture(),before=structuredClone(f.state);
  const response=await f.sandbox.calculateAcademicResultsForType({}, {},{...f.period,AllowPartialResults:true,RevisionTokens:{'result-pending':'draft-v1'}},'Mid-Term');
  assert.equal(response.resultCalculationPreserved,1);assert.equal(response.resultCalculationPending[0].StudentRef,'pending');
  const results=f.writes.filter(row=>row.collectionPath==='academicResults');assert.equal(results.length,2);
  const calculated=results.find(row=>row.documentId==='result-good');assert.equal(calculated.data.OverallAverage,75);assert.equal(calculated.data.CalculationPending,false);
  const pending=results.find(row=>row.documentId==='result-pending');assert.equal(pending.data.CalculationPending,true);
  assert.deepEqual(Array.from(pending.updateMask),['CalculationPending','CalculationPendingIssues']);assert.equal('Subjects' in pending.data,false);
  assert.ok(!f.writes.some(row=>row.documentId==='result-published'||/Scores/.test(row.collectionPath)));
  const membershipWrites=f.writes.filter(row=>/Memberships/.test(row.collectionPath));
  assert.equal(membershipWrites.length,1);
  assert.equal(membershipWrites[0].documentId,'membership-good');
  assert.deepEqual(membershipWrites[0].updateMask,['ScoreHistoryRevision']);
  assert.equal(membershipWrites[0].updateTime,'membership-good-v1');
  assert.deepEqual(f.state,before);
});
test('a retained pending draft cannot be reviewed, approved or published',async()=>{
  const f=fixture();f.state.termResults[1].CalculationPending=true;
  for(const Status of ['Reviewed','Approved','Published','Locked']){
    await assert.rejects(f.sandbox.changeAcademicTermResultStatus({}, {},{ResultIds:['result-pending'],Status}),/pending incomplete assessments/);
  }
  assert.equal(f.writes.length,0);
});
test('old clients calculate ready students without overwriting a published classmate or blocking on a pending student',async()=>{
  const f=fixture();
  const response=await f.sandbox.calculateAcademicResultsForType({}, {},{...f.period,RevisionTokens:{'result-pending':'draft-v1'}},'Mid-Term');
  assert.equal(response.resultCalculationPreserved,1);
  assert.ok(f.writes.some(row=>row.documentId==='result-good'));
  assert.ok(!f.writes.some(row=>row.documentId==='result-published'));
});

test('legacy bulk review, approval, publication and locking advance ready students independently school-wide',async()=>{
  for(const section of ['nursery','primary','secondary'])for(const [current,Status] of [['Calculated Draft','Reviewed'],['Reviewed','Approved'],['Approved','Published'],['Published','Locked']]){
    const f=fixture();f.context.scope.section=section;
    f.state.termResults[1].CalculationPending=true;
    const ready={...f.period,ResultId:'result-good',StudentRef:'good',Status:current,PolicySnapshot:f.policy,__updateTime:'ready-v1',Subjects:[{Total:75}]};
    f.state.termResults.push(ready);const before=structuredClone(f.state);
    const request={ResultIds:['result-pending','result-good'],Status,RevisionTokens:{'result-good':'ready-v1'}};
    const response=await f.sandbox.changeAcademicTermResultStatus({}, {},request);
    const results=f.writes.filter(row=>row.collectionPath==='academicResults');
    assert.equal(results.length,1);assert.equal(results[0].documentId,'result-good');assert.equal(results[0].data.Status,Status);
    assert.deepEqual(results[0].data.Subjects,ready.Subjects);
    assert.equal(response.resultWorkflowOutcomes.find(row=>row.StudentRef==='pending').Outcome,'Pending');
    assert.deepEqual(f.state,before);
    f.state.termResults[2]=results[0].data;const writeCount=f.writes.length;
    await f.sandbox.changeAcademicTermResultStatus({}, {},request);
    assert.equal(f.writes.length,writeCount,'retry produces no duplicate status history');
  }
});

test('a stale selection, incomplete policy or unfinished workflow cannot stop a ready classmate publishing',async()=>{
  for(const change of [{SubjectChangeRecalculationRequired:true},{PolicySnapshot:{}},{Status:'Calculated Draft'}]){
    const f=fixture();
    f.state.termResults=[{...f.period,ResultId:'result-pending',StudentRef:'pending',Status:'Approved',PolicySnapshot:f.policy,...change},
      {...f.period,ResultId:'result-good',StudentRef:'good',Status:'Approved',PolicySnapshot:f.policy,__updateTime:'ready-v1'}];
    const response=await f.sandbox.changeAcademicTermResultStatus({}, {},{ResultIds:['result-pending','result-good'],Status:'Published',RevisionTokens:{'result-good':'ready-v1'}});
    assert.equal(response.resultWorkflowOutcomes.find(row=>row.StudentRef==='pending').Outcome,'Pending');
    assert.equal(f.writes.filter(row=>row.collectionPath==='academicResults').length,1);
    assert.ok(!f.writes.some(row=>row.documentId==='result-pending'));
  }
});

test('when everyone remaining is incomplete, existing drafts are marked pending without creating empty results',async()=>{
  const f=fixture();f.state.studentScores=[];
  const response=await f.sandbox.calculateAcademicResultsForType({}, {},{...f.period,AllowPartialResults:true,RevisionTokens:{'result-pending':'draft-v1'}},'Mid-Term');
  assert.equal(response.resultCalculationPending.length,2);
  const results=f.writes.filter(row=>row.collectionPath==='academicResults');
  assert.equal(results.length,1);assert.equal(results[0].documentId,'result-pending');assert.equal(results[0].data.CalculationPending,true);
  assert.equal('Subjects' in results[0].data,false);assert.equal(f.state.termResults[0].Status,'Published');
});

test('calculation returns committed results and revision tokens without reloading the workspace',async()=>{
  const f=fixture(),before=structuredClone(f.state);
  f.sandbox.ACADEMIC_MANAGEMENT_COLLECTIONS.resultEvents='academicResultEvents';
  f.sandbox.academicResultEventWrite=(_user,result)=>({collectionPath:'academicResultEvents',documentId:`event-${result.ResultId}`,
    data:{ResultEventId:`event-${result.ResultId}`,ResultId:result.ResultId,StudentRef:result.StudentRef}});
  f.sandbox.publicRecord=record=>({...record,RevisionToken:record.__updateTime});
  f.sandbox.commitAcademicBatch=async(_env,batch)=>{
    f.writes.push(...batch);return {writeResults:batch.map((_row,index)=>({updateTime:`commit-${index}`}))};
  };
  f.sandbox.academicOperationalResponse=()=>{throw new Error('Calculation must not reload the workspace');};
  const response=await f.sandbox.calculateAcademicResultsForType({}, {},{...f.period,ResultResponseMode:'delta',
    AllowPartialResults:true,RevisionTokens:{'result-pending':'draft-v1'}},'Mid-Term');
  assert.equal(response.ok,true);assert.equal(response.partialAcademicManagement,true);
  const results=response.resultCalculationUpdate.results;assert.equal(results.length,3);
  const preserved=results.find(row=>row.ResultId==='result-published');assert.equal(preserved.Status,'Published');
  assert.equal(preserved.RevisionToken,'pub-v1');assert.deepEqual(preserved.Subjects,before.termResults[0].Subjects);
  const calculated=results.find(row=>row.ResultId==='result-good');assert.equal(calculated.OverallAverage,75);
  const pending=results.find(row=>row.ResultId==='result-pending');assert.equal(pending.CalculationPending,true);
  assert.deepEqual(pending.Subjects,before.termResults[1].Subjects);
  for(const result of [calculated,pending]){
    const index=f.writes.findIndex(write=>write.collectionPath==='academicResults'&&write.documentId===result.ResultId);
    assert.equal(result.RevisionToken,`commit-${index}`);
  }
  assert.equal(response.resultCalculationUpdate.events.length,1);
  assert.equal(response.resultCalculationUpdate.events[0].ResultId,'result-good');
  assert.equal(response.resultCalculationUpdate.scope.ArmId,'a1');
  assert.equal(response.resultCalculationPreserved,1);assert.equal(response.resultCalculationPending.length,1);
  assert.deepEqual(f.state,before);
});


test('recalculation after an arm transfer retains the existing result ID and parent reference',async()=>{
  const f=fixture();
  f.state.termResults.push({...f.period,ResultId:'original-arm-result',ResultReference:'stable-parent-link',StudentRef:'good',
    Status:'Calculated Draft',__updateTime:'moved-v1'});
  await f.sandbox.calculateAcademicResultsForType({}, {},{...f.period,RevisionTokens:{'original-arm-result':'moved-v1','result-pending':'draft-v1'}},'Mid-Term');
  const write=f.writes.find(row=>row.documentId==='original-arm-result');
  assert.equal(write.data.ResultReference,'stable-parent-link');assert.equal(write.data.OverallAverage,75);
  assert.equal(write.updateTime,'moved-v1');assert.ok(!f.writes.some(row=>row.documentId==='result-good'));
});
