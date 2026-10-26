import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultAcademicPolicy} from '../functions/lib/academic-policy.js';
import {buildAcademicResultsReadiness, loadAcademicResultsReadiness} from '../functions/lib/academic-results-readiness.js';
import {calculateAcademicTermResultDrafts, calculateAcademicMidTermResultDrafts} from '../functions/lib/academic-term-results.js';

function fixture(type = 'Mid-Term') {
  const scope = {BranchId:'main', SchoolSection:'secondary', SessionId:'s1', TermId:'t1', ClassId:'c1', ResultType:type};
  const policy = defaultAcademicPolicy();
  policy.Position.Mode = 'exact-overall';
  policy.ResultAccess.VisibilityMode = 'current-term';
  policy.ResultAccess.FinancialClearance.Mode = 'none';
  policy.Promotion.Mode = 'manual-review';
  policy.MidTerm = {Enabled:true, ComponentIds:['ca']};
  policy.Assessment.Components = [
    {Id:'ca', Name:'CA1', MaximumScore:40, WeightPercentage:40, Required:true, Order:1},
    {Id:'exam', Name:'Exam', MaximumScore:60, WeightPercentage:60, Required:true, Order:2}
  ];
  policy.Assessment.GradeBands = [{Grade:'A', MinimumPercentage:0, MaximumPercentage:100, GradePoint:5, Remark:'Pass'}];
  const row = data => ({...scope, ...data});
  const state = {
    sessions:[row({SessionId:'s1', Name:'2026/2027'})], terms:[row({TermId:'t1', Name:'First Term'})],
    classes:[row({Name:'Grade 10', SchoolStage:'Senior Secondary'})], arms:[row({ArmId:'a1', Name:'Brilliance'})],
    subjects:[{SubjectId:'math',Name:'Mathematics'}, {SubjectId:'trade',Name:'Computer Hardware and GSM Repairs',SeniorChoiceRole:'Trade'}],
    studentMemberships:[row({RecordId:'m1', StudentRef:'TEST/1', ArmId:'a1', SubjectIds:['math'],Status:'Active'})],
    scoreSheets:[row({SheetId:'sheet', ArmId:'a1', SubjectId:'math', Status:'Approved',AssessmentRevisionId:'r1'})],
    studentScores:[row({ScoreId:'score',SheetId:'sheet',StudentRef:'TEST/1',SubjectId:'math', AssessmentRevisionId:'r1',CompletionStatus:'Complete',
      Percentage:75,WeightedTotal:75,Grade:'A',ComponentScores:[{ComponentId:'ca',State:'Numeric',RawScore:30,MaximumScore:40,WeightPercentage:40},
        {ComponentId:'exam',State:'Numeric',RawScore:45,MaximumScore:60,WeightPercentage:60}]})], termResults:[]
  };
  const view = {ActivePolicy:policy, Sources:[{RevisionId:'policy-r1'}]};
  const people = [{AdmissionNo:'TEST/1',DisplayName:'Example Student'}];
  function save(status='Calculated Draft', notTaught=[]) {
    const input = {...scope,ArmId:'a1', Memberships:state.studentMemberships.filter(r=>r.Status==='Active'),ScoreSheets:state.scoreSheets,
      StudentScores:state.studentScores,Subjects:state.subjects,Policy:policy,NotTaughtSubjectIds:notTaught,NotTaughtReason:'Lessons have not started.'};
    const calculation = (type==='Mid-Term'?calculateAcademicMidTermResultDrafts:calculateAcademicTermResultDrafts)(input);
    assert.equal(calculation.Ready,true,JSON.stringify(calculation.Issues));
    state.termResults = calculation.Results.map((r,i)=>({...scope,...r,ResultId:`result-${i}`,Status:status,
      SubjectSelectionSnapshot:{SubjectIds:[...state.studentMemberships[i].SubjectIds]}}));
  }
  return {state,scope,policy,view,people,row,save,report:(related=[])=>buildAcademicResultsReadiness(state,scope,view,people,related)};
}

test('readiness is isolated to the chosen branch, section, class, session, term and result type',()=>{
  const f=fixture(); f.save('Approved');
  for(const change of [{BranchId:'north'},{SchoolSection:'primary'},{SessionId:'s2'},{TermId:'t2'},{ClassId:'c2'}]) {
    f.state.studentMemberships.push({...f.state.studentMemberships[0],...change,RecordId:JSON.stringify(change),ArmId:'missing'});
    f.state.termResults.push({...f.state.termResults[0],...change,ResultId:JSON.stringify(change)});
  }
  f.state.termResults.push({...f.state.termResults[0],ResultId:'end-term',ResultType:'End of Term'});
  const result=f.report();assert.equal(result.Counts.Students,1);assert.deepEqual(result.Blockers,[]);assert.equal(result.Status,'Ready to publish');
  assert.equal(result.Scope.ClassName,'Grade 10'); assert.equal(result.Scope.Term,'First Term');
});

test('archived broken memberships and stale curriculum flags are warnings, never current blockers',()=>{
  const f=fixture(); f.state.studentMemberships[0].CurriculumStatus='Pending curriculum';
  f.state.studentMemberships.push(f.row({RecordId:'archived',StudentRef:'TEST/1',Status:'Archived',ArmId:'deleted',SubjectIds:['deleted']}));
  f.save('Approved');
  const before=structuredClone(f.state),result=f.report();
  assert.deepEqual(result.Blockers,[]);assert.equal(result.Counts.ReadyToPublish,1);
  assert.ok(result.Warnings.some(r=>r.Code==='HISTORICAL_MEMBERSHIP'));
  assert.ok(result.Warnings.some(r=>r.Code==='SAVED_CURRICULUM_FLAG'));
  assert.deepEqual(f.state,before);assert.deepEqual(f.report(),result);
});

test('actual current placement, duplicate records and missing subject references remain blockers',()=>{
  for(const [change,code] of [[f=>f.state.studentMemberships[0].ArmId='', 'CURRENT_CLASSROOM_REQUIRED'],
    [f=>f.state.studentMemberships[0].SubjectIds=['missing'],'MISSING_SUBJECT_REFERENCE'],
    [f=>f.state.studentScores.push({...f.state.studentScores[0],ScoreId:'duplicate'}),'DUPLICATE_SCORE']]) {
    const f=fixture();change(f);assert.ok(f.report().Blockers.some(r=>r.Code===code),code);
  }
  const f=fixture();const related=[{...f.state.studentMemberships[0],RecordId:'other-class',ClassId:'c2',ArmId:'a2'}];
  assert.ok(f.report(related).Blockers.some(r=>r.Code==='DUPLICATE_CURRENT_MEMBERSHIP'));
  assert.ok(!f.report(related.map(r=>({...r,TermId:'old'}))).Blockers.length);
});

test('mid-term checks selected tests only; end-of-term keeps full-sheet requirements',()=>{
  const f=fixture();f.state.studentScores[0].ComponentScores.pop();f.state.studentScores[0].CompletionStatus='Incomplete';f.state.scoreSheets[0].Status='Draft';
  assert.deepEqual(f.report().Blockers,[]);assert.equal(f.report().NextSteps[0].Code,'CALCULATE');
  f.scope.ResultType='End of Term';assert.ok(f.report().Blockers.some(r=>r.Message.includes('Approved or Locked')));
});

test('saved untaught-subject decisions retain subject selection and scores without blocking mid-term',()=>{
  const f=fixture(); f.state.studentMemberships[0].SubjectIds.push('trade');
  assert.ok(f.report().Blockers.some(r=>r.Message.includes('Computer Hardware')),'unexplained missing tests still block');
  f.save('Approved',['trade']);const before=structuredClone(f.state),result=f.report();
  assert.deepEqual(result.Blockers,[]);assert.equal(result.Counts.ReadyToPublish,1);assert.equal(result.Counts.UntaughtSubjects,1);
  assert.match(result.UntaughtSubjects[0].Message,/Excluded from the average/);
  assert.equal(f.state.termResults[0].OverallAverage,75);assert.deepEqual(f.state,before);
  f.scope.ResultType='End of Term';assert.ok(f.report().Blockers.some(r=>r.Message.includes('Computer Hardware')));
});

test('an untaught exception cannot hide a recorded zero, absence or exemption',()=>{
  for(const State of ['Numeric','Absent','Exempt']){
    const f=fixture();f.state.studentMemberships[0].SubjectIds.push('trade');f.save('Approved',['trade']);
    f.state.scoreSheets.push(f.row({SheetId:'trade-sheet',ArmId:'a1',SubjectId:'trade',AssessmentRevisionId:'r1',Status:'Draft'}));
    f.state.studentScores.push(f.row({SheetId:'trade-sheet',StudentRef:'TEST/1',AssessmentRevisionId:'r1',ComponentScores:[{ComponentId:'ca',State,RawScore:0}]}));
    assert.ok(f.report().Blockers.some(r=>r.Message.includes('already has recorded')),State);
    assert.match(f.report().UntaughtSubjects[0].Message,/Resolve the result blockers/);
  }
});

test('workflow steps are distinct from blockers and do not claim draft results are published',()=>{
  for(const [status,step,count] of [['Calculated Draft','REVIEW',0],['Reviewed','APPROVE',0],['Approved',null,1],['Withdrawn','REOPEN',0]]){
    const f=fixture();f.save(status);const result=f.report();assert.deepEqual(result.Blockers,[]);
    assert.equal(result.NextSteps[0]?.Code,step||undefined);assert.equal(result.Counts.ReadyToPublish,count);
  }
  for(const status of ['Published','Locked']){
    const f=fixture();f.save(status);f.state.studentScores=[];f.view.Sources=[];
    assert.deepEqual(f.report().Blockers,[]);assert.equal(f.report().Counts.Published,1);
  }
});

test('changed marks, placement, subject choices or incomplete policy snapshots require correction',()=>{
  for(const [change,code] of [[f=>f.state.studentScores[0].ComponentScores[0].RawScore=20,'RESULT_MARKS_CHANGED'],
    [f=>f.state.termResults[0].ArmId='old-arm','RESULT_SUBJECTS_CHANGED'],
    [f=>f.state.termResults[0].SubjectSelectionSnapshot.SubjectIds.push('trade'),'RESULT_SUBJECTS_CHANGED'],
    [f=>f.state.termResults[0].PolicySnapshot={},'RESULT_POLICY_INCOMPLETE']]){
    const f=fixture();f.save('Approved');change(f);assert.ok(f.report().Blockers.some(r=>r.Code===code),code);
  }
  const f=fixture();f.view.Sources=[];assert.ok(f.report().Blockers.some(r=>r.Code==='CALCULATION_POLICY'));
  f.save('Approved');assert.deepEqual(f.report().Blockers,[],'valid saved policy snapshots do not require a new active revision for publication');
});

test('invalid period and empty classes cannot claim ready; aliases and timetable subjects are supported',()=>{
  const f=fixture();f.scope.TermId='wrong';assert.ok(f.report().Blockers.some(r=>r.Code==='INVALID_PERIOD'));
  f.scope.TermId='t1';f.state.studentMemberships=[];assert.ok(f.report().Blockers.some(r=>r.Code==='NO_CURRENT_STUDENTS'));
  const g=fixture();g.state.subjects[0]={Id:'math',Name:'Mathematics'};
  g.state.subjects.push({SubjectId:'activity',Name:'Activity',AssessmentCategory:'TimetableOnly'});
  g.state.studentMemberships[0].SubjectIds.push('activity');assert.deepEqual(g.report().Blockers,[]);
});

test('loader targets only selected student references and period, returns no raw marks, and never writes',async()=>{
  const f=fixture(),calls=[];f.save('Approved');
  const before=structuredClone(f.state);
  const report=await loadAcademicResultsReadiness({},f.state,f.scope,{
    read:async(_env,collection,query)=>{
      calls.push({collection,query});
      if(collection==='academicStudentMemberships')return f.state.studentMemberships;
      return [{...f.people[0],BranchId:'north'}, {...f.people[0],BranchId:'main',SchoolSection:'secondary'}];
    },readPolicy:async()=>f.view
  });
  assert.equal(report.Counts.ReadyToPublish,1);assert.match(report.NextSteps?.[0]?.RecordLabel||report.Warnings[0].RecordLabel,/Example Student/);
  assert.ok(calls.every(call=>call.query.filters.some(filter=>filter.op==='in'&&filter.value.length===1&&filter.value[0]==='TEST/1')));
  const duplicateQuery=calls.find(call=>call.collection==='academicStudentMemberships');
  assert.deepEqual(duplicateQuery.query.filters.filter(f=>f.op==='==').map(f=>[f.field,f.value]),[['BranchId','main'],['SessionId','s1'],['TermId','t1']]);
  assert.equal('studentScores' in report,false);assert.deepEqual(f.state,before);
});

test('a failed targeted read is reported instead of silently treating incomplete data as ready',async()=>{
  const f=fixture();await assert.rejects(loadAcademicResultsReadiness({},f.state,f.scope,{read:async()=>{throw new Error('index not ready');}}),/index not ready/);
});
