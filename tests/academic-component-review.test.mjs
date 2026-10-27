import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {academicComponentReviews,academicComponentReviewTransition} from '../functions/lib/academic-component-review.js';
import {academicAssessmentScheme,calculateAcademicStudentScore} from '../functions/lib/academic-scorebook.js';
const sheet={SheetId:'sheet',Status:'Draft',AssessmentRevisionId:'r1',__updateTime:'v1',
  AssessmentComponents:[{Id:'ca1',Name:'CA1',MaximumScore:100,WeightPercentage:20,Required:true},
    {Id:'exam',Name:'Exam',MaximumScore:100,WeightPercentage:80,Required:true}],
  GradeBands:[{Grade:'A',MinimumPercentage:0,MaximumPercentage:100}]};
const roster=[{StudentRef:'TEST/1'},{StudentRef:'TEST/2'}];
const scores=roster.map(row=>({SheetId:'sheet',StudentRef:row.StudentRef,ComponentScores:[{ComponentId:'ca1',State:'Numeric',RawScore:0}]}));
const perms={canEnterScores:true,canReviewScores:true,canApproveScores:true,canManageScoreCorrections:true};
const actor={timestamp:'2026-10-26T12:00:00Z',name:'Officer',username:'officer'};
const failure=(message,status=409,code='invalid')=>Object.assign(new Error(message),{status,code});
const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');

test('completed tests are independent of future marks for any class and subject; no input is changed',async()=>{
  const before=structuredClone({sheet,roster,scores});
  for(const ClassId of ['Grade 1','Grade 7','Grade 10','Grade 12'])for(const SubjectId of ['Financial Accounting','Math','Music','New subject']){
    const reviews=await academicComponentReviews({...sheet,ClassId,SubjectId},roster,scores);
    assert.equal(reviews[0].Complete,true);assert.equal(reviews[0].CompleteCount,2);
    assert.equal(reviews[1].Complete,false);assert.equal(reviews[1].MissingCount,2);
  }
  assert.deepEqual({sheet,roster,scores},before);
});

test('zero, absent and exempt are recorded states; missing, invalid and duplicate records block review',async()=>{
  for(const State of ['Numeric','Absent','Exempt','Missing','Incomplete']){
    const rows=scores.map(row=>({...row,ComponentScores:[{ComponentId:'ca1',State,RawScore:0}]}));
    const [review]=await academicComponentReviews(sheet,roster,rows);
    assert.equal(review.Complete,['Numeric','Absent','Exempt'].includes(State));
  }
  for(const rows of [[],[scores[0]],[...scores,scores[0]],scores.map(row=>({...row,ComponentScores:[{ComponentId:'ca1',RawScore:101}]}))]){
    assert.equal((await academicComponentReviews(sheet,roster,rows))[0].Complete,false);
  }
  assert.equal((await academicComponentReviews({...sheet,GradeBands:[]},roster,scores))[0].Complete,false);
  assert.equal((await academicComponentReviews(sheet,[],scores))[0].Complete,false);
});

test('split tests require their required parts, without confusing a zero with missing',async()=>{
  const split={...sheet,AssessmentComponents:[{...sheet.AssessmentComponents[0],ScoreEntryMode:'objective-theory',ObjectiveMaximumScore:40,TheoryMaximumScore:60},sheet.AssessmentComponents[1]]};
  const rows=scores.map(row=>({...row,ComponentScores:[{ComponentId:'ca1',Parts:[{PartId:'objective',State:'Numeric',RawScore:0}]}]}));
  assert.equal((await academicComponentReviews(split,roster,rows))[0].Complete,false);
  rows.forEach(row=>row.ComponentScores[0].Parts.push({PartId:'theory',State:'Numeric',RawScore:0}));
  assert.equal((await academicComponentReviews(split,roster,rows))[0].Complete,true);
});

test('review binds exact saved marks, roster and test definition; other tests do not invalidate it',async()=>{
  const [review]=await academicComponentReviews(sheet,roster,scores);
  const approved={...sheet,ComponentReviews:{ca1:{Status:'Approved',ScoreDigest:review.ScoreDigest,ApprovedBy:'Reviewer'}}};
  assert.equal((await academicComponentReviews(approved,roster,scores))[0].Status,'Approved');
  const unrelated=structuredClone(scores);unrelated[0].ComponentScores.push({ComponentId:'exam',State:'Numeric',RawScore:70});
  assert.equal((await academicComponentReviews(approved,roster,unrelated))[0].Status,'Approved');
  const changed=structuredClone(scores);changed[0].ComponentScores[0].RawScore=1;
  for(const [s,r,marks] of [[approved,roster,changed],[approved,roster.slice(1),scores],[{...approved,AssessmentComponents:sheet.AssessmentComponents.map(c=>({...c,MaximumScore:200}))},roster,scores]]){
    const [result]=await academicComponentReviews(s,r,marks);assert.equal(result.Status,'Draft');assert.equal(result.Stale,true);
    assert.equal(result.ReviewedBy,'');
  }
});

test('review follows role checks, current-version order and retry idempotency without advancing the term sheet',async()=>{
  const [review,missing]=await academicComponentReviews(sheet,roster,scores);
  assert.throws(()=>academicComponentReviewTransition(sheet,missing,'Submitted',perms,actor),{code:'ACADEMIC_COMPONENT_INCOMPLETE'});
  assert.throws(()=>academicComponentReviewTransition(sheet,review,'Approved',perms,actor),/Submit/);
  for(const [Status,target,key] of [['Draft','Submitted','canEnterScores'],['Submitted','Approved','canReviewScores'],['Approved','Locked','canApproveScores']]){
    const r={...review,Status};
    assert.throws(()=>academicComponentReviewTransition(sheet,r,target,{...perms,[key]:false},actor),{status:403});
    const update=academicComponentReviewTransition(sheet,r,target,perms,actor);
    assert.equal(update.Status,target);assert.equal(sheet.Status,'Draft');
    assert.equal(academicComponentReviewTransition(sheet,{...r,Status:target},target,perms,actor),null);
  }
  assert.throws(()=>academicComponentReviewTransition({...sheet,Status:'Approved'},review,'Submitted',perms,actor),/full score sheet/);
  assert.throws(()=>academicComponentReviewTransition(sheet,{...review,Status:'Approved'},'Draft',perms,actor,''),/reason/);
  assert.equal(academicComponentReviewTransition(sheet,{...review,Status:'Approved'},'Draft',perms,actor,'Correction').ReopenReason,'Correction');
  const old={...sheet,ComponentReviews:{ca1:{ApprovedBy:'Old reviewer',ApprovedAt:'old'}}};
  assert.equal(academicComponentReviewTransition(old,{...review,Stale:true},'Submitted',perms,actor).ApprovedBy,undefined);
});

function runtime(){
  const commits=[],submissions=[];
  const context={existing:structuredClone(sheet),roster,state:{studentScores:structuredClone(scores)},permissions:perms};
  const sandbox=vm.createContext({academicComponentReviews,academicComponentReviewTransition,academicAssessmentScheme,calculateAcademicStudentScore,
    clean:v=>String(v??'').trim(),lower:v=>String(v??'').toLowerCase(),failure,nowIso:()=>actor.timestamp,
    actorName:()=>actor.name,actorUsername:()=>actor.username,
    academicScoreSheetRecord:(_c,existing,_user,_time,updates)=>({...existing,...updates}),
    withoutMetadata:record=>{const {__updateTime,...rest}=record;return rest;},
    writePrecondition:(existing,token)=>{if(token!==existing.__updateTime)throw failure('Reload changed sheet',409,'ACADEMIC_WRITE_CONFLICT');return {updateTime:token};},
    ACADEMIC_MANAGEMENT_COLLECTIONS:{scoreSheets:'academicScoreSheets'},
    auditWrite:(_u,action,_type,_record,details)=>({collectionPath:'academicAuditLog',data:{Action:action,Details:details}}),
    oneOf:(value,values,fallback)=>values.find(row=>row.toLowerCase()===String(value).toLowerCase())||fallback,
    ACADEMIC_SCORE_SHEET_STATUSES:['Draft','Submitted','Approved','Locked'],
    commitAcademicSubmission:async(_e,_c,_u,_i,kind,writes)=>{submissions.push(kind);commits.push(writes);},
    commitAcademicBatch:async(_e,writes)=>commits.push(writes),crypto:webcrypto
  });
  for(const name of ['changeAcademicComponentReview','assertAcademicScoreSheetComplete'])vm.runInContext(source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}`))[0],sandbox);
  vm.runInContext(source.match(/export async function changeAcademicScoreSheetStatus\([\s\S]*?\n}/)[0].replace('export ',''),sandbox);
  return {sandbox,context,commits,submissions};
}

test('backend commits only review metadata and one audit event, preserving every score; retry writes nothing',async()=>{
  const f=runtime(),before=structuredClone(f.context.state);
  await f.sandbox.changeAcademicComponentReview({}, {},{ComponentId:'ca1',Status:'Submitted',RevisionToken:'v1'},f.context);
  assert.deepEqual(f.submissions,['scorebook']);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,2);
  const [saved,audit]=f.commits[0];assert.equal(saved.data.Status,'Draft');assert.equal(saved.updateTime,'v1');
  assert.equal(saved.data.ComponentReviews.ca1.Status,'Submitted');assert.equal(audit.data.ComponentId,'ca1');
  assert.equal(audit.data.ScoreDigest.length,64);assert.deepEqual(f.context.state,before);
  f.context.existing={...saved.data,__updateTime:'v2'};
  await f.sandbox.changeAcademicComponentReview({}, {},{ComponentId:'ca1',Status:'Submitted',RevisionToken:'v1'},f.context);
  assert.equal(f.commits.length,1,'retry must not duplicate audit history');
  await assert.rejects(f.sandbox.changeAcademicComponentReview({}, {},{ComponentId:'ca1',Status:'Approved',RevisionToken:'v1'},f.context),{code:'ACADEMIC_WRITE_CONFLICT'});
  assert.equal(f.commits.length,1);
});

test('full-term review recalculates actual saved marks, ignores stale Complete flags and rejects duplicate score rows',async()=>{
  const f=runtime();
  const fakeComplete=scores.map(row=>({...row,CompletionStatus:'Complete'}));
  await assert.rejects(f.sandbox.assertAcademicScoreSheetComplete({studentScores:fakeComplete},sheet,roster),/Exam \(2\).*Review individual tests/);
  const complete=scores.map(row=>({...row,CompletionStatus:'Incomplete',ComponentScores:[...row.ComponentScores,{ComponentId:'exam',State:'Numeric',RawScore:65}]}));
  assert.equal((await f.sandbox.assertAcademicScoreSheetComplete({studentScores:complete},sheet,roster)).length,2);
  const duplicates=await f.sandbox.assertAcademicScoreSheetComplete({studentScores:[...complete,complete[0]]},sheet,roster,{summary:true});
  assert.equal(duplicates.CompleteCount,1);assert.deepEqual(Array.from(duplicates.PendingStudentRefs),['TEST/1']);
});

test('review always leaves missing students pending without inventing or approving their marks',async()=>{
  const [review]=await academicComponentReviews(sheet,roster,[scores[0]]);
  assert.equal(review.CompleteCount,1);assert.equal(review.MissingCount,1);
  const submitted=academicComponentReviewTransition(sheet,review,'Submitted',perms,actor);
  assert.deepEqual(submitted.PendingStudentRefs,['test/2']);assert.equal(submitted.AllowPendingStudents,true);
  const saved={...sheet,ComponentReviews:{ca1:submitted}};
  const [fresh]=await academicComponentReviews(saved,roster,[scores[0]]);
  const approved=academicComponentReviewTransition(saved,fresh,'Approved',perms,actor);
  assert.equal(approved.Status,'Approved');assert.deepEqual(approved.PendingStudentRefs,['test/2']);
  const [empty]=await academicComponentReviews(sheet,roster,[]);
  assert.throws(()=>academicComponentReviewTransition(sheet,empty,'Submitted',perms,actor,'',true),/still need required marks/);
  assert.throws(()=>academicComponentReviewTransition(saved,fresh,'Approved',{},actor,'',true),/Only an academic reviewer/);
});

test('full-sheet pending mode accepts complete students only and changes no scores',async()=>{
  const f=runtime();
  const complete={...scores[0],ComponentScores:[...scores[0].ComponentScores,{ComponentId:'exam',State:'Numeric',RawScore:60}]};
  const state={studentScores:[complete,scores[1]]},before=structuredClone(state);
  const result=await f.sandbox.assertAcademicScoreSheetComplete(state,sheet,roster,{allowPending:false,summary:true});
  assert.equal(result.CompleteCount,1);assert.deepEqual(Array.from(result.PendingStudentRefs),['TEST/2']);
  assert.deepEqual(state,before);
  await assert.rejects(f.sandbox.assertAcademicScoreSheetComplete({studentScores:[]},sheet,roster,{allowPending:true}),/incomplete/);
  await assert.rejects(f.sandbox.assertAcademicScoreSheetComplete(state,sheet,[]),{code:'ACADEMIC_SCORE_SHEET_EMPTY'});
});

test('one incomplete student never blocks test or full-term submission, approval and locking across school sections and subjects',async()=>{
  for(const SchoolSection of ['nursery','primary','secondary'])for(const SubjectId of ['math','english','financial-accounting','trade'])for(const ComponentId of ['ca1','']){
    const f=runtime();
    Object.assign(f.context.existing,{SchoolSection,SubjectId,ClassId:`${SchoolSection}-class`,ArmId:'classroom'});
    f.context.state.studentScores[0].ComponentScores.push({ComponentId:'exam',State:'Numeric',RawScore:70});
    f.context.state.studentScores[1].ComponentScores=[];
    const before=structuredClone(f.context.state);
    for(const Status of ['Submitted','Approved','Locked']){
      await f.sandbox.changeAcademicScoreSheetStatus({}, {},{ComponentId,Status,AllowPendingStudents:false,RevisionToken:'v1'},f.context);
      const saved=f.commits.at(-1)[0].data;
      const review=ComponentId?saved.ComponentReviews.ca1:saved;
      assert.equal(review.Status,Status,`${SchoolSection}/${SubjectId}/${ComponentId}/${Status}`);
      assert.deepEqual(Array.from(review.PendingStudentRefs,ref=>ref.toLowerCase()),['test/2']);
      assert.ok(f.commits.at(-1).every(write=>['academicScoreSheets','academicAuditLog'].includes(write.collectionPath)));
      f.context.existing={...saved,__updateTime:'v1'};
    }
    const count=f.commits.length;
    await f.sandbox.changeAcademicScoreSheetStatus({}, {},{ComponentId,Status:'Locked',RevisionToken:'old'},f.context);
    assert.equal(f.commits.length,count);assert.deepEqual(f.context.state,before);
  }
});
