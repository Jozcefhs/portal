import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import * as policy from '../functions/lib/academic-policy.js';
import {safeScopeId} from '../functions/lib/school-scope.js';
import {calculateAcademicTermResultDrafts,calculateAcademicMidTermResultDrafts} from '../functions/lib/academic-term-results.js';
const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
const admin=await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
const row=data=>({BranchId:'main',SchoolSection:'secondary',Status:'Active',...data});
const actor={edition:'school',role:'Super Admin',username:'reviewer',branchId:'main',allowedSections:['academics'],schoolSectionAccess:'secondary'};
const input={SchoolSection:'secondary',BranchId:'main',SessionId:'s1',TermId:'t1',ClassId:'c1',ArmId:'a0',View:'results'};
function fixture(){
  const p=policy.defaultAcademicPolicy();p.Position.Mode='exact-overall';p.ResultAccess.VisibilityMode='current-term';
  p.ResultAccess.FinancialClearance.Mode='none';p.Promotion.Mode='manual-review';p.MidTerm={Enabled:true,ComponentIds:['ca1']};
  p.Assessment.Components=[{Id:'ca1',Name:'CA1',MaximumScore:100,WeightPercentage:100,Required:true}];
  p.Assessment.GradeBands=[{Grade:'A',MinimumPercentage:0,MaximumPercentage:100}];
  const calls=[],records={academicSessions:[row({SessionId:'s1',Name:'2026/2027'})],academicTerms:[row({SessionId:'s1',TermId:'t1',Name:'First Term'})],
    academicClasses:[row({ClassId:'c1',Name:'Grade 7'})],academicSubjects:[],academicArms:[],academicStudentMemberships:[],
    academicScoreSheets:[],academicStudentScores:[],academicStudentAttendance:[],academicResults:[],
    academicSchoolCalendars:[row({SessionId:'s1',TermId:'t1'}),row({SessionId:'old',TermId:'old'})]};
  for(let s=0;s<16;s++)records.academicSubjects.push(row({SubjectId:`subject-${s}`,Name:`Subject ${s}`}));
  for(let arm=0;arm<10;arm++){
    const ArmId=`a${arm}`;records.academicArms.push(row({ClassId:'c1',ArmId,Name:`Arm ${arm}`}));
    for(let student=0;student<28;student++){
      const StudentRef=`TEST/${arm}/${student}`;
      records.academicStudentMemberships.push(row({...input,ArmId,StudentRef,SubjectIds:records.academicSubjects.map(s=>s.SubjectId)}));
      for(let day=0;day<40;day++)for(const TermId of ['t1','old'])records.academicStudentAttendance.push(row({...input,ArmId,TermId,StudentRef,Mode:'Daily',Status:'Present'}));
      for(let subject=0;subject<16;subject++)records.academicStudentScores.push(row({...input,ArmId,StudentRef,SheetId:`sheet-${arm}-${subject}`,
        SubjectId:`subject-${subject}`,AssessmentRevisionId:'r1',CompletionStatus:'Complete',Percentage:student,WeightedTotal:student,
        ComponentScores:[{ComponentId:'ca1',State:'Numeric',RawScore:student}]}));
    }
    for(let subject=0;subject<16;subject++)records.academicScoreSheets.push(row({...input,ArmId,SheetId:`sheet-${arm}-${subject}`,SubjectId:`subject-${subject}`,Status:'Approved',AssessmentRevisionId:'r1'}));
    records.academicResults.push(row({...input,ArmId,ResultId:`result-${arm}`}));
  }
  // Old scores remain discoverable through SheetId even without classroom metadata.
  delete records.academicStudentScores[0].ArmId;
  const query=async(_env,collection,options={})=>{
    const found=(records[collection]||[]).filter(row=>(options.filters||[]).every(filter=>filter.op==='in'?filter.value.includes(row[filter.field]):row[filter.field]===filter.value));
    calls.push({collection,options,count:found.length});return structuredClone(found);
  };
  const context=vm.createContext({...policy,safeScopeId,TextEncoder,TextDecoder,crypto:webcrypto,
    getSchoolStructure:async()=>({ActiveBranchId:'main',Branches:[{Id:'main'}],Sections:['secondary']}),enforceActorBranch:(_user,branch)=>branch,
    queryCollection:query,queryCollectionPages:query,
    getDocument:async()=>{throw new Error('Calculation must not load profile directories or workspace settings');},
    loadAcademicPolicyView:async()=>({ActivePolicy:p,Sources:[{RevisionId:'r1'}]})});
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,''),context);
  return {context,calls,records};
}

test('calculation reads only one classroom and term, not branch attendance, other arms or lifecycle history',async()=>{
  const f=fixture();const before=structuredClone(f.records);
  const result=await f.context.academicTermResultContext({},actor,{...input});
  assert.equal(result.state.studentMemberships.length,28);
  assert.equal(result.state.scoreSheets.length,16);assert.equal(result.state.studentScores.length,448);
  assert.equal(result.state.studentAttendance.length,1120);assert.equal(result.state.termResults.length,1);
  assert.equal(result.state.schoolCalendars.length,1);
  assert.equal(result.state.studentScores[0].ArmId,undefined);assert.equal(result.state.studentScores[0].ComponentScores[0].RawScore,0);
  for(const collection of ['academicStudentMemberships','academicScoreSheets','academicResults','academicStudentAttendance']){
    const query=f.calls.find(call=>call.collection===collection);
    assert.deepEqual(Array.from(query.options.filters,filter=>[filter.field,filter.value]),[['BranchId','main'],['SessionId','s1'],['TermId','t1'],['ClassId','c1'],['ArmId','a0']]);
  }
  assert.ok(!f.calls.some(call=>['academicResultEvents','academicTeacherAllocations','students','staffUsers'].includes(call.collection)));
  const marks=f.calls.filter(call=>call.collection==='academicStudentScores');assert.equal(marks.length,2);
  assert.equal(marks.reduce((sum,call)=>sum+call.count,0),448);assert.equal(new Set(marks.map(call=>call.options.readTime)).size,1);
  assert.ok(marks.every(call=>call.options.filters[0].field==='SheetId'&&call.options.filters[0].value.length<=10));
  // The narrower reads must produce identical marks, attendance, ranks and comments.
  const calculation={...input,Policy:result.policy,Subjects:f.records.academicSubjects};
  for(const calculate of [calculateAcademicTermResultDrafts,calculateAcademicMidTermResultDrafts]){
    const full=calculate({...calculation,Memberships:f.records.academicStudentMemberships,ScoreSheets:f.records.academicScoreSheets,
      StudentScores:f.records.academicStudentScores,Attendance:f.records.academicStudentAttendance});
    const focused=calculate({...calculation,Memberships:result.state.studentMemberships,ScoreSheets:result.state.scoreSheets,
      StudentScores:result.state.studentScores,Attendance:result.state.studentAttendance});
    assert.equal(full.Ready,true);assert.equal(full.Results.length,28);assert.deepEqual(focused,full);
  }
  assert.deepEqual(f.records,before);
});

test('calculation rejects missing selectors before reads and fails rather than using a partial marks page',async()=>{
  const f=fixture();
  for(const key of ['SessionId','TermId','ClassId','ArmId'])await assert.rejects(f.context.academicTermResultContext({},actor,{...input,[key]:''}),/Choose a class/);
  assert.equal(f.calls.length,0);
  f.context.queryCollectionPages=async()=>{throw new Error('database page failed');};
  await assert.rejects(f.context.loadAcademicCalculationScores({}, {branchId:'main',section:'secondary'},[{SheetId:'sheet'}]),/database page failed/);
});

test('mid-term math ignores other classrooms and preserved students instead of processing their component scores',()=>{
  const p=policy.defaultAcademicPolicy();p.Position.Mode='none';p.MidTerm={Enabled:true,ComponentIds:['ca']};
  p.Assessment.Components=[{Id:'ca',Name:'CA1',MaximumScore:100,WeightPercentage:100,Required:true}];
  p.Assessment.GradeBands=[{Grade:'A',MinimumPercentage:0,MaximumPercentage:100}];
  const score={SheetId:'selected-sheet',StudentRef:'student',SubjectId:'math',AssessmentRevisionId:'r1',ComponentScores:[{ComponentId:'ca',State:'Numeric',RawScore:75}]};
  const poison=()=>{throw new Error('Unrequested marks were processed');};
  const result=calculateAcademicMidTermResultDrafts({...input,Policy:p,Memberships:[{...input,StudentRef:'student',SubjectIds:['math']}],
    ScoreSheets:[{...input,SheetId:'selected-sheet',SubjectId:'math',AssessmentRevisionId:'r1',Status:'Draft'}],
    StudentScores:[score,{SheetId:'other-sheet',StudentRef:'student',get ComponentScores(){return poison();}},
      {SheetId:'selected-sheet',StudentRef:'already-published',get ComponentScores(){return poison();}}]});
  assert.equal(result.Ready,true);assert.equal(result.Results[0].OverallAverage,75);
});

test('saved result updates merge into the loaded workspace without another request or losing other classrooms',async()=>{
  let summaryInvalidations=0;
  const calls=[],context=vm.createContext({clean:v=>String(v??'').trim(),selectedBranchId:'main',currentUser:{},academicManagementView:'results',
    window:{DynamaxAcademicWorkflow:{clearBranchSummary:()=>{summaryInvalidations++;}}},
    academicManagementData:{termResults:[{ResultId:'unchanged',Status:'Published'},{ResultId:'changed',RevisionToken:'old'}],
      resultEvents:[{ResultEventId:'old-event'}],students:[{StudentRef:'keep'}]},
    staffFetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return {status:200,json:async()=>({ok:true,partialAcademicManagement:true,
      resultCalculationUpdate:{results:[{ResultId:'changed',RevisionToken:'committed',OverallAverage:75}],events:[{ResultEventId:'new-event'}]}})};}});
  for(const name of ['academicManagementRequest','mergeAcademicScorebookSnapshot','mergeAcademicResultCalculation']){
    vm.runInContext(admin.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`))[0],context);
  }
  const result=await context.academicManagementRequest('calculateAcademicMidTermResults',{ResultResponseMode:'delta'});
  assert.equal(calls.length,1);assert.equal(result.termResults.length,2);assert.equal(result.termResults[0].Status,'Published');
  assert.equal(result.termResults[1].RevisionToken,'committed');assert.equal(result.students[0].StudentRef,'keep');
  assert.equal(result.resultEvents.length,2);
  assert.equal(summaryInvalidations,1,'recalculation invalidates publication counts without loading them again');
  const replay=context.mergeAcademicResultCalculation(result,result.resultCalculationUpdate);assert.equal(replay.resultEvents.length,2);
});
