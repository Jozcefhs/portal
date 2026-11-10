import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as management from '../functions/lib/academic-management.js';
import * as studentRoster from '../functions/lib/academic-student-status-roster.js';
import * as scorebook from '../functions/lib/academic-scorebook.js';
import { safeScopeId, scopedCollectionPath } from '../functions/lib/school-scope.js';
import { normalizeClassKey } from '../functions/lib/class-names.js';
import { academicTeacherScoreClassrooms } from '../functions/lib/academic-classroom-score-register.js';

const backend = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const clean = value => String(value ?? '').trim();
const actor = { edition:'school',role:'Super Admin',username:'reviewer',allowedSections:['academics'],branchId:'main',schoolSectionAccess:'primary' };
const request = {BranchId:'main',SchoolSection:'primary',View:'classrooms',SessionId:'s',TermId:'t',WorkspaceLoadMode:'navigation'};
const row = extra => ({BranchId:'main',SchoolSection:'primary',Status:'Active',...extra});

function backendFixture() {
  const calls=[], writes=[];
  const records = {
    academicSessions:[row({SessionId:'s',Name:'2026/2027'})], academicTerms:[row({SessionId:'s',TermId:'t',Name:'First Term'})],
    academicClasses:[row({ClassId:'c1',Name:'Grade 1'}),row({ClassId:'c2',Name:'Grade 2'})],
    academicArms:[row({ClassId:'c1',ArmId:'a1',Name:'Excellence',IsClassroom:true}),row({ClassId:'c2',ArmId:'a2',Name:'Distinction',IsClassroom:true})],
    academicStudentMemberships:[row({SessionId:'s',TermId:'t',ClassId:'c1',ArmId:'a1',StudentRef:'DEMO/1'}),row({SessionId:'s',TermId:'t',ClassId:'c2',ArmId:'a2',StudentRef:'DEMO/2'})],
    academicTeacherAllocations:[row({SessionId:'s',TermId:'t',ClassId:'c1',ArmId:'a1',AllocationRole:'Assistant Teacher',TeacherUsername:'helper'})],
    'schoolBranches/main/sections/primary/students':[row({AdmissionNo:'DEMO/1',ClassName:'Grade 1',DisplayName:'First pupil'}),row({AdmissionNo:'DEMO/2',ClassName:'Grade 2',DisplayName:'Second pupil'})]
  };
  const read = async (_env,collection,options={}) => {
    calls.push({collection,options});
    return structuredClone((records[collection]||[]).filter(record=>(options.filters||[]).every(filter=>
      filter.op==='in' ? filter.value.includes(record[filter.field]) : record[filter.field]===filter.value)));
  };
  const context=vm.createContext({...management,...studentRoster,...scorebook,safeScopeId,scopedCollectionPath,normalizeClassKey,academicTeacherScoreClassrooms,TextEncoder,TextDecoder,
    getSchoolStructure:async()=>({ActiveBranchId:'main',Branches:[{Id:'main'}],Sections:['primary','secondary']}),enforceActorBranch:(_actor,branch)=>branch,
    queryCollection:read,queryCollectionPages:read,listBranchCollection:read,listSchoolCollection:read,getDocument:async()=>({}),
    batchCommitDocuments:async(_env,changes)=>writes.push(changes)});
  vm.runInContext(backend.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,''),context);
  return {context,calls,writes,records};
}

test('opening one classroom keeps every classroom available without another definition query or widening membership reads',async()=>{
  const f=backendFixture(), before=structuredClone(f.records);
  const result=await f.context.bootstrapAcademicManagement({},actor,{...request,WorkspaceLoadMode:'records',RecordClassId:'c1',RecordArmId:'a1'});
  assert.deepEqual(Array.from(result.arms,item=>item.ArmId).sort(),['a1','a2']);
  assert.deepEqual(Array.from(result.studentMemberships,item=>item.StudentRef),['DEMO/1']);
  assert.equal(result.workspaceRecordSelection.ClassId,'c1');assert.equal(result.classroomDetailsDeferred,false);
  assert.equal(f.calls.filter(call=>call.collection==='academicArms').length,1);
  assert.equal(f.calls.some(call=>/Scores|Results|Movements|Audit/.test(call.collection)),false);
  assert.deepEqual(f.records,before);assert.deepEqual(f.writes,[]);
});

test('assistant teachers still receive only their own classroom after all-definition navigation support',async()=>{
  const f=backendFixture(), user=f.context.academicWebActor({...actor,role:'Teacher',username:'helper'});
  const result=await f.context.bootstrapAcademicManagement({},user,{...request,TeacherAutoScope:true});
  assert.deepEqual(Array.from(result.arms,item=>item.ArmId),['a1']);
  assert.deepEqual(Array.from(result.studentMemberships,item=>item.StudentRef),['DEMO/1']);
  assert.equal(result.teacherWorkspace.ArmId,'a1');
  await assert.rejects(f.context.bootstrapAcademicManagement({},user,{...request,TeacherAutoScope:true,RecordArmId:'a2'}),/not assigned/);
  assert.equal(f.writes.length,0);
});

test('classroom register distinguishes unloaded rows from an empty or unstaffed classroom',()=>{
  let rendered;
  const context=vm.createContext({clean,academicManagementFilters:{section:'primary',sessionId:'s',termId:'t'},academicClassroomDraft:{},
    academicLearnerTerms:()=>({singular:'pupil',plural:'pupils',Singular:'Pupil',Plural:'Pupils'}),
    academicIsActive:()=>true,academicFind:(rows,id)=>id ? rows.find(row=>[row.ArmId,row.ClassId,row.SessionId,row.TermId].includes(id)) : undefined,
    academicManagementStaffCandidates:rows=>rows,academicLabel:(rows,id,fallback='')=>rows?.find(row=>[row.ClassId,row.Username].includes(id))?.Name||fallback,
    academicSchoolStageLabel:()=> 'Primary',escapeHtml:clean,
    table:(_title,rows,columns)=>{rendered=rows.map(row=>Object.fromEntries(columns.filter(column=>column.value).map(column=>[column.label,column.value(row)])));return '<table></table>';}});
  vm.runInContext(admin.match(/function academicClassroomWorkspace\([\s\S]*?\n}/)[0],context);
  const data={classroomDetailsDeferred:false,workspaceRecordSelection:{ClassId:'c1'},terms:[{TermId:'t',SessionId:'s'}],staff:[]};
  const rows={sessions:[{SessionId:'s'}],classes:[{ClassId:'c1',Name:'Grade 1'},{ClassId:'c2',Name:'Grade 2'}],armTemplates:[],departments:[],
    arms:[{ArmId:'a1',ClassId:'c1',Name:'Excellence',IsClassroom:true},{ArmId:'a2',ClassId:'c2',Name:'Distinction',IsClassroom:true}],
    studentMemberships:[{ArmId:'a1',SessionId:'s',TermId:'t'}],teacherAllocations:[]};
  context.academicClassroomWorkspace(data,rows);
  assert.equal(rendered[0].Pupils,1);assert.equal(rendered[0]['Form teacher'],'Not assigned');
  assert.equal(rendered[1].Pupils,'Open classroom');assert.equal(rendered[1]['Form teacher'],'Open classroom');assert.equal(rendered[1].Assistant,'Open classroom');
});

test('Open classroom loads only its selected class and arm and unknown classroom clicks perform no request',async()=>{
  const calls=[], context=vm.createContext({clean,academicManagementData:{arms:[{ArmId:'a1',ClassId:'c1',ArmTemplateId:'template'}]},
    academicFind:(rows,id)=>rows.find(row=>row.ArmId===id),academicManagementFilters:{sessionId:'s',termId:'t'},
    academicClassroomDraft:{},academicManagementView:'classrooms',academicManagementTaskViews:{},loadAcademicManagement:async options=>calls.push(options)});
  vm.runInContext(admin.match(/async function openAcademicClassroom\([\s\S]*?\n}/)[0],context);
  await context.openAcademicClassroom('missing');assert.equal(calls.length,0);
  await context.openAcademicClassroom('a1');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{records:true,classId:'c1',armId:'a1'}]);
  assert.equal(context.academicClassroomDraft.armId,'a1');assert.equal(context.academicManagementTaskViews.classrooms,'manage');
});

test('period changes request current navigation instead of repainting previous-period assignments',async()=>{
  const handlers={},calls=[];
  const context=vm.createContext({clean,document:{getElementById:id=>({addEventListener:(_event,fn)=>{handlers[id]=fn;}})},
    academicManagementFilters:{section:'primary',sessionId:'old',termId:'old-term'},academicManagementData:{terms:[{SessionId:'next',TermId:'new-term'}]},
    academicIsActive:()=>true,academicClassroomDraft:{},academicStudentAllocationDraft:{},academicResultDraft:{},academicArmSubjectDraft:{},
    academicTimetableDraft:{},academicAttendanceDraft:{},academicScorebookDraft:{},academicOutcomeDraft:{},academicAnalysisFilters:{},
    loadAcademicManagement:options=>calls.push(options)});
  const start=admin.indexOf("  document.getElementById('academicManagementSession')?.addEventListener('change'");
  const end=admin.indexOf("  panelEl.querySelectorAll('[data-academic-open-classroom]')",start);
  vm.runInContext(admin.slice(start,end),context);
  handlers.academicManagementSession({target:{value:'next'}});
  assert.equal(calls.length,1);assert.equal(context.academicManagementFilters.termId,'new-term');
  handlers.academicManagementTerm({target:{value:'third-term'}});
  assert.equal(calls.length,2);assert.equal(context.academicManagementFilters.termId,'third-term');
});

test('navigation requests do not inherit the previous selected-class load mode while a scoped mutation retains it',async()=>{
  const requests=[];
  const context=vm.createContext({clean,selectedBranchId:'main',currentUser:actor,academicManagementView:'classrooms',
    academicManagementFilters:{section:'primary',sessionId:'s',termId:'t'},academicManagementData:{workspaceRecordSelection:{ClassId:'old-class'}},window:{},
    staffFetch:async(_url,options)=>{requests.push(JSON.parse(options.body));return {status:200,json:async()=>({ok:true})};},
    mergeAcademicScorebookSnapshot:data=>data,mergeAcademicResultCalculation:data=>data});
  vm.runInContext(admin.match(/async function academicManagementRequest\([\s\S]*?\n}/)[0],context);
  await context.academicManagementRequest('bootstrap',{SchoolSection:'primary',SessionId:'s',TermId:'new-term'});
  assert.equal(requests[0].WorkspaceLoadMode,'navigation');assert.equal(requests[0].RecordClassId,undefined);
  await context.academicManagementRequest('saveAcademicArm',{SchoolSection:'primary'});
  assert.equal(requests[1].WorkspaceLoadMode,'records');assert.equal(requests[1].RecordClassId,'old-class');
});

test('a late response or error cannot replace the latest academic navigation',async()=>{
  for(const staleFails of [false,true]) {
    let firstResolve,firstReject;
    const firstReply=new Promise((resolve,reject)=>{firstResolve=resolve;firstReject=reject;});
    let requests=0;const rendered=[];
    const context=vm.createContext({clean,activeSection:'academics',academicManagementView:'classrooms',academicManagementLoadRequest:0,
      academicManagementFilters:{section:'primary',sessionId:'s',termId:'t'},academicManagementTaskViews:{},panelEl:{innerHTML:'unchanged'},
      escapeHtml:clean,academicManagementRequest:async()=>++requests===1 ? firstReply : {ok:true,workspaceSetup:true},
      renderAcademicManagement:data=>rendered.push(data)});
    vm.runInContext(admin.match(/async function loadAcademicManagement\([\s\S]*?\n}/)[0],context);
    const old=context.loadAcademicManagement();context.academicManagementView='classstaff';
    await context.loadAcademicManagement();
    if(staleFails) firstReject(new Error('Previous request failed')); else firstResolve({ok:true,stale:true});
    await old;
    assert.equal(rendered.length,1);assert.equal(rendered[0].stale,undefined);
    assert.equal(context.panelEl.innerHTML,'unchanged');
  }
});
