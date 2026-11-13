import test from 'node:test';
import assert from 'node:assert/strict';
import vm from './helpers/module-policy-vm.mjs';
import {readFile} from 'node:fs/promises';
import * as scorebook from '../functions/lib/academic-scorebook.js';
import * as review from '../functions/lib/academic-component-review.js';
import {safeScopeId} from '../functions/lib/school-scope.js';
import {ACADEMIC_MANAGEMENT_COLLECTIONS as collections} from '../functions/lib/academic-management.js';

const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
const admin=await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
const scope={BranchId:'garden',SchoolSection:'primary',SessionId:'session',TermId:'term',ClassId:'grade',ArmId:'arm',SubjectId:'math'};
const policy={Assessment:{Components:[
  {Id:'ca1',Name:'CA1',MaximumScore:100,WeightPercentage:20,Required:true,SourceMode:'any'},
  {Id:'exam',Name:'Exam',MaximumScore:100,WeightPercentage:80,Required:true,SourceMode:'any'}
],GradeBands:[{Grade:'A',MinimumPercentage:0,MaximumPercentage:100,Classification:'pass'}]}};

function fixture({split=false,midterm={Enabled:true,ComponentIds:['ca1']}}={}) {
  const db=new Map(), commits=[], submissions=[], reads=[];let revision=0, race=null;
  const put=(collection,id,data)=>db.set(`${collection}/${id}`,{...structuredClone(data),__updateTime:`v${++revision}`});
  const rows=col=>[...db].filter(([key])=>key.startsWith(`${col}/`)).map(([,row])=>structuredClone(row));
  const assessment=structuredClone(policy);
  if(split)Object.assign(assessment.Assessment.Components[0],{ScoreEntryMode:'objective-theory',ObjectiveMaximumScore:40,TheoryMaximumScore:60,ObjectiveSourceMode:'any',TheorySourceMode:'manual'});
  const scheme=scorebook.academicAssessmentScheme(assessment,{RevisionId:'scheme'});scheme.MidTerm=midterm;
  for(const ref of ['one','two','pending'])put(collections.studentMemberships,ref,{...scope,RecordId:ref,StudentRef:ref,SubjectIds:['math'],Status:'Active'});
  put(collections.studentScores,'other',{ScoreId:'other',SheetId:'other-sheet',StudentRef:'other',RawScore:91});
  const batch=async(_env,writes)=>{
    race?.();race=null;
    for(const w of writes){const previous=db.get(`${w.collectionPath}/${w.documentId}`);
      if(w.exists===false&&previous || w.updateTime&&previous?.__updateTime!==w.updateTime)throw Object.assign(new Error('Concurrent update'),{status:409});
    }
    for(const w of writes){const previous=db.get(`${w.collectionPath}/${w.documentId}`);put(w.collectionPath,w.documentId,w.updateMask?{...previous,...w.data}:w.data);}
    commits.push(structuredClone(writes));return {};
  };
  const ctx=vm.createContext({...scorebook,...review,safeScopeId,crypto,TextEncoder,structuredClone,console,
    batchCommitDocuments:batch,commitAcademicSubmission:async(env,_context,_user,input,_kind,writes)=>{submissions.push(structuredClone(input));return batch(env,writes);}});
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,''),ctx);
  const teacher=ctx.academicWebActor({username:'teacher',role:'Teacher',edition:'school',branchId:'garden',allowedSections:['academics']});
  ctx.academicScoreSheetContext=async(_env,user,input,capability,keys)=>{
    reads.push(keys);const permissions=ctx.requireCapability(user,capability);
    assert.equal(input.BranchId,'garden');
    const state=Object.fromEntries(Object.entries(collections).map(([key,col])=>[key,rows(col)]));
    return {permissions,scope:{branchId:'garden',section:'primary'},state,SheetId:'sheet',existing:state.scoreSheets.find(row=>row.SheetId==='sheet'),
      scheme,activeScheme:scheme,session:{SessionId:'session'},term:{TermId:'term'},schoolClass:{ClassId:'grade'},arm:{ArmId:'arm'},subject:{SubjectId:'math'},
      allocation:{TeacherUsername:'teacher'},roster:state.studentMemberships};
  };
  const sheet=()=>rows(collections.scoreSheets)[0];
  const payload=()=>({...scope,SheetId:'sheet',SheetRevisionToken:sheet()?.__updateTime});
  const score=ref=>rows(collections.studentScores).find(row=>row.SheetId==='sheet'&&row.StudentRef===ref);
  const save=async(entries,user=teacher)=>ctx.saveAcademicScoreDraft({},user,{...payload(),Rows:entries.map(([StudentRef,ComponentScores])=>({StudentRef,ComponentScores,RevisionToken:score(StudentRef)?.__updateTime}))});
  const lock=()=>ctx.lockAcademicRecordedScores({},teacher,payload());
  const submit=()=>ctx.submitAcademicMidTermScores({},teacher,payload());
  return {ctx,teacher,put,rows,db,commits,submissions,reads,scheme,sheet,score,payload,save,lock,submit,setRace:fn=>race=fn};
}
const cell=(ComponentId,RawScore)=>({ComponentId,State:'Numeric',RawScore});
const plain=v=>JSON.parse(JSON.stringify(v));

test('web save remains editable; all submission routes require locks; midterm leaves missing classmates pending',async()=>{
  const f=fixture(),other=f.rows(collections.studentScores)[0];
  await f.save([['one',[cell('ca1',0)]],['two',[cell('ca1',70)]]]);
  assert.deepEqual(f.score('one').LockedScoreCellIds,[]);
  await f.save([['two',[cell('ca1',75)]]]);assert.equal(f.score('two').ComponentScores[0].RawScore,75);
  await assert.rejects(f.submit(),{code:'ACADEMIC_SCORE_LOCK_REQUIRED'});
  await assert.rejects(f.ctx.changeAcademicScoreSheetStatus({},f.teacher,{...f.payload(),ComponentId:'ca1',Status:'Submitted'}),{code:'ACADEMIC_SCORE_LOCK_REQUIRED'});
  const n=f.commits.length;await f.save([['two',[cell('ca1',75)]]]);assert.equal(f.commits.length,n,'unchanged saves have no writes/audit');
  await f.lock();assert.deepEqual(f.score('one').LockedScoreCellIds,['ca1']);
  const count=f.commits.length;await f.lock();assert.equal(f.commits.length,count,'lock retry is a no-op');
  await assert.rejects(f.save([['two',[cell('ca1',80)]]]),{code:'ACADEMIC_SCORE_CELL_LOCKED'});
  await f.submit();assert.equal(f.sheet().Status,'Draft');
  assert.equal(f.sheet().ComponentReviews.ca1.Status,'Submitted');
  assert.equal(f.sheet().ComponentReviews.ca1.CompleteCount,2);
  assert.deepEqual(f.sheet().ComponentReviews.ca1.PendingStudentRefs,['pending']);
  assert.equal(f.sheet().ComponentReviews.exam,undefined);
  assert.equal(f.submissions[0].ComponentId,'midterm:ca1','deadline checkout cannot collide with whole-sheet submission');
  const after=f.commits.length;await f.submit();assert.equal(f.commits.length,after);
  assert.deepEqual(f.rows(collections.studentScores).find(row=>row.ScoreId==='other'),other);
  assert.ok(f.reads.filter(Boolean).every(keys=>!keys.includes('scoreImports')&&!keys.includes('scoreSyncBatches')));
});

test('full-term submission requires locks while incomplete students stay pending',async()=>{
  const f=fixture();await f.save([['one',[cell('ca1',45),cell('exam',80)]],['two',[cell('ca1',70)]]]);
  const submit=()=>f.ctx.changeAcademicScoreSheetStatus({},f.teacher,{...f.payload(),Status:'Submitted'});
  await assert.rejects(submit(),{code:'ACADEMIC_SCORE_LOCK_REQUIRED'});await f.lock();await submit();
  assert.equal(f.sheet().Status,'Submitted');assert.deepEqual(f.sheet().PendingStudentRefs,['two','pending']);
  assert.equal(f.score('one').ComponentScores[1].RawScore,80);
});

test('split tests lock each part; explicit zero, absent and exempt are not missing',async()=>{
  const f=fixture({split:true});
  await f.save([['one',[{ComponentId:'ca1',Parts:[{PartId:'objective',State:'Numeric',RawScore:0},{PartId:'theory',State:'Absent'}]}]],
    ['two',[{ComponentId:'ca1',Parts:[{PartId:'objective',State:'Exempt'},{PartId:'theory',State:'Numeric',RawScore:20}]}]]]);
  await assert.rejects(f.submit(),{code:'ACADEMIC_SCORE_LOCK_REQUIRED'});await f.lock();
  assert.deepEqual(f.score('one').LockedScoreCellIds,['ca1:objective','ca1:theory']);await f.submit();
  assert.equal(f.sheet().ComponentReviews.ca1.CompleteCount,2);
});

test('legacy locked records remain valid; approved midterm tests are not demoted or resubmitted',async()=>{
  const f=fixture();await f.save([['one',[cell('ca1',55)]]],{...f.teacher}); // spread retains web Symbol
  const score=f.score('one');delete score.LockedScoreCellIds;delete score.LockedComponentIds;
  f.put(collections.studentScores,score.ScoreId,score);
  await f.submit();const sheet=f.sheet();sheet.ComponentReviews.ca1.Status='Approved';f.put(collections.scoreSheets,'sheet',sheet);
  const n=f.commits.length;await f.submit();assert.equal(f.sheet().ComponentReviews.ca1.Status,'Approved');assert.equal(f.commits.length,n);
});

test('midterm submission uses active policy, ignores caller component selection, and never submits a future exam',async()=>{
  for(const midterm of [{Enabled:false,ComponentIds:['ca1']},{Enabled:true,ComponentIds:[]},{Enabled:true,ComponentIds:['unknown']}]){
    const f=fixture({midterm});await f.save([['one',[cell('ca1',50)]]]);await f.lock();const n=f.commits.length;
    await assert.rejects(f.submit());assert.equal(f.commits.length,n);
  }
  const f=fixture();await f.save([['one',[cell('ca1',50),cell('exam',80)]]]);await f.lock();
  await f.ctx.submitAcademicMidTermScores({},f.teacher,{...f.payload(),ComponentIds:['exam'],ComponentId:'exam'});
  assert.equal(f.sheet().ComponentReviews.exam,undefined);
});

test('corrections must be explicitly relocked; concurrent save cannot silently lock different marks',async()=>{
  const f=fixture();await f.save([['one',[cell('ca1',40)]]]);await f.lock();
  f.put(collections.scoreSheets,'sheet',{...f.sheet(),ScoreEditingReactivated:true,ScoreEditingReactivationReason:'Approved correction'});
  await f.save([['one',[cell('ca1',45)]]]);assert.equal(f.sheet().ScoreEditingReactivated,true);
  await assert.rejects(f.submit(),{code:'ACADEMIC_SCORE_LOCK_REQUIRED'});
  const n=f.commits.length;f.setRace(()=>f.put(collections.scoreSheets,'sheet',{...f.sheet(),UpdatedBy:'concurrent teacher'}));
  await assert.rejects(f.lock(),{code:'ACADEMIC_WRITE_CONFLICT'});assert.equal(f.commits.length,n);
  assert.deepEqual(f.score('one').LockedScoreCellIds,[]);await f.lock();assert.equal(f.sheet().ScoreEditingReactivated,false);await f.submit();
});

test('non-score roles cannot save, lock or submit and duplicate scores cannot be locked',async()=>{
  const f=fixture();const other={...f.teacher,role:'Accounts'};
  for(const action of ['saveAcademicScoreDraft','lockAcademicRecordedScores','submitAcademicMidTermScores'])await assert.rejects(f.ctx[action]({},other,f.payload()),{status:403});
  await f.save([['one',[cell('ca1',50)]]]);f.put(collections.studentScores,'duplicate',{...f.score('one'),ScoreId:'duplicate'});
  await assert.rejects(f.lock(),{code:'ACADEMIC_SCORE_DUPLICATE'});
});

test('save/lock button states distinguish editable drafts, legacy locks and active correction access',()=>{
  const ctx=vm.createContext({});vm.runInContext(admin.match(/function academicScoreActionState\([\s\S]*?\n}/)[0],ctx);
  const draft={Status:'Draft'},marks=[{ComponentScores:[cell('ca1',0)],LockedScoreCellIds:[]}];
  assert.equal(ctx.academicScoreActionState(draft,marks).canSubmit,false);
  assert.equal(ctx.academicScoreActionState(draft,[{...marks[0],LockedScoreCellIds:['ca1']}]).canSubmit,true);
  assert.equal(ctx.academicScoreActionState({...draft,ScoreEditingReactivated:true},[{...marks[0],LockedScoreCellIds:['ca1']}]).canSubmit,false);
  assert.equal(ctx.academicScoreActionState(draft,[]).canSubmit,false);
});

test('duplicate records remain untouched and pending without blocking a ready classmate',async()=>{
  const f=fixture();await f.save([['one',[cell('ca1',50)]],['two',[cell('ca1',60)]]]);
  f.put(collections.studentScores,'duplicate',{...f.score('one'),ScoreId:'duplicate'});
  const duplicates=f.rows(collections.studentScores).filter(row=>row.StudentRef==='one');
  await f.lock();await f.submit();assert.equal(f.sheet().ComponentReviews.ca1.CompleteCount,1);
  assert.deepEqual(f.rows(collections.studentScores).filter(row=>row.StudentRef==='one'),duplicates);
  assert.ok(f.sheet().ComponentReviews.ca1.PendingStudentRefs.includes('one'));
});

test('allocation shortcut loads only on explicit click and reuses an already open allocation form',async()=>{
  const calls=[],tasks=[];let mounted=false;
  const ctx=vm.createContext({academicManagementData:{permissions:{canAllocateClassStudents:true}},academicManagementView:'scorebook',academicManagementTaskViews:{},
    panelEl:{querySelector:()=>mounted?{scrollIntoView(){},querySelector(){return null;}}:null},
    loadAcademicManagement:async options=>{calls.push(plain(options));mounted=true;},showAcademicManagementTask:(...args)=>tasks.push(args)});
  vm.runInContext(admin.match(/async function openAcademicStudentAllocation\([\s\S]*?\n}/)[0],ctx);
  assert.equal(calls.length,0);await ctx.openAcademicStudentAllocation();assert.deepEqual(calls,[{records:true}]);
  assert.equal(ctx.academicManagementTaskViews.students,'allocate');await ctx.openAcademicStudentAllocation();assert.equal(calls.length,1);assert.deepEqual(tasks,[['students','allocate']]);
});
