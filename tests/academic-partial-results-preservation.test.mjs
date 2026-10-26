import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {defaultAcademicPolicy} from '../functions/lib/academic-policy.js';
import {calculateAcademicTermResultDrafts,calculateAcademicMidTermResultDrafts,ACADEMIC_TERM_RESULT_STATUSES} from '../functions/lib/academic-term-results.js';
const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
function fixture(){
  const policy=defaultAcademicPolicy();policy.Position.Mode='exact-overall';policy.MidTerm={Enabled:true,ComponentIds:['ca']};
  policy.Assessment.Components=[{Id:'ca',Name:'CA1',MaximumScore:100,WeightPercentage:100,Required:true}];
  policy.Assessment.GradeBands=[{Grade:'A',MinimumPercentage:0,MaximumPercentage:100}];
  const period={SessionId:'s1',TermId:'t1',ClassId:'c1',ArmId:'a1',ResultType:'Mid-Term'};
  const state={studentMemberships:['good','pending','published'].map(StudentRef=>({...period,StudentRef,SubjectIds:['math'],Status:'Active'})),
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
    calculateAcademicTermResultDrafts,calculateAcademicMidTermResultDrafts,ACADEMIC_TERM_RESULT_STATUSES,
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
  return {state,sandbox,writes,period};
}
test('partial calculation preserves published snapshots, pending draft marks and every source score',async()=>{
  const f=fixture(),before=structuredClone(f.state);
  const response=await f.sandbox.calculateAcademicResultsForType({}, {},{...f.period,AllowPartialResults:true,RevisionTokens:{'result-pending':'draft-v1'}},'Mid-Term');
  assert.equal(response.resultCalculationPreserved,1);assert.equal(response.resultCalculationPending[0].StudentRef,'pending');
  const results=f.writes.filter(row=>row.collectionPath==='academicResults');assert.equal(results.length,2);
  const calculated=results.find(row=>row.documentId==='result-good');assert.equal(calculated.data.OverallAverage,75);assert.equal(calculated.data.CalculationPending,false);
  const pending=results.find(row=>row.documentId==='result-pending');assert.equal(pending.data.CalculationPending,true);
  assert.deepEqual(Array.from(pending.updateMask),['CalculationPending','CalculationPendingIssues']);assert.equal('Subjects' in pending.data,false);
  assert.ok(!f.writes.some(row=>row.documentId==='result-published'||/Scores|Memberships/.test(row.collectionPath)));
  assert.deepEqual(f.state,before);
});
test('a retained pending draft cannot be reviewed, approved or published',async()=>{
  const f=fixture();f.state.termResults[1].CalculationPending=true;
  for(const Status of ['Reviewed','Approved','Published','Locked']){
    await assert.rejects(f.sandbox.changeAcademicTermResultStatus({}, {},{ResultIds:['result-pending'],Status}),/pending incomplete assessments/);
  }
  assert.equal(f.writes.length,0);
});
test('old all-or-nothing requests never overwrite an existing published result',async()=>{
  const f=fixture();await assert.rejects(f.sandbox.calculateAcademicResultsForType({}, {},f.period,'Mid-Term'),/Published result/);
  assert.equal(f.writes.length,0);
});

test('when everyone remaining is incomplete, existing drafts are marked pending without creating empty results',async()=>{
  const f=fixture();f.state.studentScores=[];
  const response=await f.sandbox.calculateAcademicResultsForType({}, {},{...f.period,AllowPartialResults:true,RevisionTokens:{'result-pending':'draft-v1'}},'Mid-Term');
  assert.equal(response.resultCalculationPending.length,2);
  const results=f.writes.filter(row=>row.collectionPath==='academicResults');
  assert.equal(results.length,1);assert.equal(results[0].documentId,'result-pending');assert.equal(results[0].data.CalculationPending,true);
  assert.equal('Subjects' in results[0].data,false);assert.equal(f.state.termResults[0].Status,'Published');
});
