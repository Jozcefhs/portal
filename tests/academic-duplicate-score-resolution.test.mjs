import test from 'node:test';
import assert from 'node:assert/strict';
import {academicDuplicateScoreResolution,planAcademicDuplicateCell} from '../functions/lib/academic-duplicate-score-resolution.js';
import {academicScoreCell,resolvedAcademicScoreEntry} from '../functions/lib/academic-duplicate-score-values.js';
import {buildAcademicClassScoreRegister} from '../functions/lib/academic-class-score-register.js';
import {handleAcademicManagementAction} from '../functions/lib/academic-management.js';
const scope={branchId:'main',section:'secondary'};
const period={BranchId:'main',SchoolSection:'secondary',SessionId:'session',TermId:'term',ClassId:'grade9'};
const input={...period,ArmId:'perfection',SubjectId:'music',StudentRef:'TEST/1',TestId:'ca1'};
const actor={name:'Authorised Officer',username:'officer',role:'Super Admin',timestamp:'2026-10-28T20:00:00Z'};
const cell=(score,id='ca1')=>({ComponentId:id,State:'Numeric',RawScore:score,MaximumScore:100,WeightPercentage:50,Note:''});
const record=(collection,key,data)=>({...data,__id:key,__name:`projects/test/databases/(default)/documents/${collection}/${key}`,__updateTime:'2026-10-28T10:00:00Z'});
function fixture(){
 const member=record('academicStudentMemberships','member',{...period,MembershipId:'member',ArmId:'perfection',StudentRef:'TEST/1',SubjectIds:['music'],Status:'Active'});
 const scheme=[{Id:'ca1',Name:'CA1',MaximumScore:100,WeightPercentage:50,Required:true},{Id:'exam',Name:'Exam',MaximumScore:100,WeightPercentage:50,Required:true}];
 const makeSheet=(key,arm)=>record('academicScoreSheets',key,{...period,SheetId:key,ArmId:arm,SubjectId:'music',Status:'Draft',AssessmentComponents:scheme,GradeBands:[{Minimum:0,Grade:'A'}]});
 const makeScore=(key,arm,sheet,mark)=>record('academicStudentScores',key,{...period,ScoreId:key,SheetId:sheet,SubjectId:'music',StudentRef:'TEST/1',ArmId:arm,
   ComponentScores:[cell(mark),cell(60,'exam')],CreatedAt:arm==='genius'?'2026-10-22T10:00:00Z':'2026-10-28T11:00:00Z'});
 const rows={academicStudentMemberships:[member],academicStudentScores:[makeScore('old','genius','old-sheet',50),makeScore('working','perfection','current-sheet',80)],
  academicScoreSheets:[makeSheet('old-sheet','genius'),makeSheet('current-sheet','perfection')],academicResults:[],academicManagementAudit:[],
  academicArms:[{ArmId:'genius',__id:'genius',Name:'Genius'},{ArmId:'perfection',__id:'perfection',Name:'Perfection'}]};
 const reads=[],commits=[];
 const db={queryCollection:async(_env,collection,options)=>{reads.push({collection,options});return structuredClone((rows[collection]||[]).filter(row=>options.filters.every(f=>f.op==='in'?f.value.includes(row[f.field]):row[f.field]===f.value)));},
  getDocuments:async(_env,collection,ids)=>(rows[collection]||[]).filter(row=>ids.includes(row.__id)).map(row=>structuredClone(row)),
  getDocument:async(_env,collection,key)=>structuredClone((rows[collection]||[]).find(row=>row.__id===key)||null),
  commit:async(_env,writes,evidence)=>{
    commits.push({writes:structuredClone(writes),evidence});
    for(const w of writes){const old=rows[w.collectionPath].find(r=>r.__id===w.documentId);if(w.exists===false)assert(!old);else assert.equal(w.updateTime,old.__updateTime);
      if(old)Object.assign(old,structuredClone(w.data),{__updateTime:'2026-10-28T20:00:00Z'});else rows[w.collectionPath].push(record(w.collectionPath,w.documentId,structuredClone(w.data)));}
    return {writeResults:writes.map(()=>({}))};
  }};
 return {rows,db,reads,commits,member};
}
const payload=(preview,selected='old')=>({...input,RevisionToken:preview.duplicateReview.RevisionToken,SelectedScoreId:selected,Reason:'Retain verified original test mark'});

test('preview reads only the selected student/subject, shows named classrooms and never writes',async()=>{
 const f=fixture(),before=structuredClone(f.rows);
 const review=(await academicDuplicateScoreResolution({},scope,input,actor,false,f.db)).duplicateReview;
 assert.deepEqual(review.candidates.map(r=>[r.Classroom,r.RawScore,r.CurrentClassroom]),[['Genius',50,false],['Perfection',80,true]]);
 assert.equal(review.WorkingScoreId,'working');assert.equal(review.RevisionToken.length,64);assert.equal(f.commits.length,0);
 assert.equal(f.reads.length,3);for(const read of f.reads)assert.ok(read.options.filters.some(v=>v.field==='StudentRef'));
 assert.deepEqual(f.rows,before);assert(!JSON.stringify(review).includes('ComponentScores'));
});

test('choosing the former mark corrects just its cell and preserves both records and audit snapshots',async()=>{
 const f=fixture(),before=structuredClone(f.rows),preview=await academicDuplicateScoreResolution({},scope,input,actor,false,f.db);
 const result=await academicDuplicateScoreResolution({},scope,payload(preview),actor,true,f.db);
 assert.equal(result.ok,true);assert.equal(f.commits.length,1);
 const working=f.rows.academicStudentScores[1];assert.equal(academicScoreCell(working,'ca1').RawScore,50);
 assert.deepEqual(academicScoreCell(working,'exam'),academicScoreCell(before.academicStudentScores[1],'exam'));
 assert.deepEqual(f.rows.academicStudentScores[0],before.academicStudentScores[0]);
 assert.equal(f.rows.academicStudentScores.length,2);
 const audit=f.rows.academicManagementAudit[0];assert.equal(academicScoreCell(audit.TargetBefore,'ca1').RawScore,80);
 assert.equal(academicScoreCell(audit.ScoresBefore[0],'ca1').RawScore,50);assert.equal(audit.ActorUsername,'officer');
 assert.equal(f.commits[0].evidence.queries.length,5);assert.equal(f.commits[0].evidence.documents.length,2);
 const retry=await academicDuplicateScoreResolution({},scope,payload(preview),actor,true,f.db);
 assert.equal(retry.alreadyResolved,true);assert.equal(f.commits.length,1,'retry never duplicates the audit or correction');
 const report=buildAcademicClassScoreRegister({classes:[{ClassId:'grade9'}],studentMemberships:f.rows.academicStudentMemberships,studentScores:f.rows.academicStudentScores,scoreSheets:f.rows.academicScoreSheets},input);
 assert.equal(report.Rows[0].Cells.find(c=>c.ColumnId.includes('ca1')).RawScore,50);
 assert(!JSON.stringify(report).includes('Candidates'),'internal resolution snapshots are not returned in the register');
});

test('keeping the current mark resolves the conflict without changing marks, reviews or published results',async()=>{
 const f=fixture();f.rows.academicResults.push(record('academicResults','result',{...period,StudentRef:'TEST/1',Status:'Published'}));
 f.rows.academicScoreSheets[1].Status='Approved';const before=structuredClone(f.rows);
 const preview=await academicDuplicateScoreResolution({},scope,input,actor,false,f.db);
 assert.equal(preview.duplicateReview.candidates[0].Allowed,false);assert.equal(preview.duplicateReview.candidates[1].Allowed,true);
 await academicDuplicateScoreResolution({},scope,payload(preview,'working'),actor,true,f.db);
 assert.deepEqual(f.rows.academicStudentScores[1].ComponentScores,before.academicStudentScores[1].ComponentScores);
 assert.deepEqual(f.rows.academicScoreSheets,before.academicScoreSheets);assert.deepEqual(f.rows.academicResults,before.academicResults);
 assert.equal(f.commits[0].writes.length,3);assert.equal(f.commits[0].evidence.queries.length,3);
 const report=buildAcademicClassScoreRegister({classes:[{ClassId:'grade9'}],studentMemberships:f.rows.academicStudentMemberships,studentScores:f.rows.academicStudentScores,scoreSheets:f.rows.academicScoreSheets},input);
 assert.equal(report.Rows[0].Cells.find(c=>c.ColumnId.includes('ca1')).RawScore,80);
});

test('stale revisions, forged choices, incompatible scales and changed published marks are rejected',async()=>{
 for(const change of ['revision','choice','scale','published']){
  const f=fixture(),preview=await academicDuplicateScoreResolution({},scope,input,actor,false,f.db),request=payload(preview);
  if(change==='revision')request.RevisionToken='old';
  if(change==='choice')request.SelectedScoreId='someone-else';
  if(change==='scale'){f.rows.academicStudentScores[0].ComponentScores[0].MaximumScore=20;request.RevisionToken=(await academicDuplicateScoreResolution({},scope,input,actor,false,f.db)).duplicateReview.RevisionToken;}
  if(change==='published'){f.rows.academicResults.push(record('academicResults','r',{...period,StudentRef:'TEST/1',Status:'Published'}));request.RevisionToken=(await academicDuplicateScoreResolution({},scope,input,actor,false,f.db)).duplicateReview.RevisionToken;}
  await assert.rejects(academicDuplicateScoreResolution({},scope,request,actor,true,f.db));assert.equal(f.commits.length,0,change);
 }
});

test('unpublished results become pending recalculation only for the corrected student',async()=>{
 const f=fixture();f.rows.academicResults.push(record('academicResults','mine',{...period,StudentRef:'TEST/1',Status:'Approved'}),record('academicResults','other',{...period,StudentRef:'TEST/2',Status:'Approved'}));
 const preview=await academicDuplicateScoreResolution({},scope,input,actor,false,f.db);
 await academicDuplicateScoreResolution({},scope,payload(preview),actor,true,f.db);
 assert.equal(f.rows.academicResults[0].SubjectChangeRecalculationRequired,true);assert.equal(f.rows.academicResults[1].SubjectChangeRecalculationRequired,undefined);
});

test('scope/membership conflicts and ordinary teachers cannot resolve marks',async()=>{
 const f=fixture();await assert.rejects(academicDuplicateScoreResolution({}, {...scope,branchId:'north'},input,actor,false,f.db));
 f.rows.academicStudentMemberships.push({...f.member,__id:'duplicate',ArmId:'genius'});
 await assert.rejects(academicDuplicateScoreResolution({},scope,input,actor,false,f.db));assert.equal(f.commits.length,0);
 for(const action of ['getAcademicDuplicateScoreReview','resolveAcademicDuplicateScore'])await assert.rejects(handleAcademicManagementAction({}, {role:'Teacher',allowedSections:['academics'],edition:'school'},{...input,action}),error=>error.status===403);
});

test('a resolution remains authoritative after an authorised current-mark edit but new or changed sources re-open review',()=>{
 const f=fixture(),[source,target]=f.rows.academicStudentScores;
 const candidates=[source,target].map(score=>({score,cell:academicScoreCell(score,'ca1')}));
 const plan=planAcademicDuplicateCell({target,source:target,sheet:f.rows.academicScoreSheets[1],testId:'ca1',actor,resolutionId:'receipt',candidates,reason:'Keep verified current score'});
 const entries=candidates.map(({score,cell})=>({...cell,ScoreId:score.ScoreId,ArmId:score.ArmId,Resolutions:score===target?plan.data.DuplicateScoreResolutions:undefined}));
 assert.equal(resolvedAcademicScoreEntry(entries,f.member,'ca1').ScoreId,'working');
 entries[1].RawScore=85;assert.equal(resolvedAcademicScoreEntry(entries,f.member,'ca1').RawScore,85);
 entries[0].RawScore=55;assert.equal(resolvedAcademicScoreEntry(entries,f.member,'ca1'),null);
 entries[0].RawScore=50;entries.push({...entries[0],ScoreId:'new'});assert.equal(resolvedAcademicScoreEntry(entries,f.member,'ca1'),null);
});
