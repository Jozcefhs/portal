import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { STUDENT_STATUSES } from '../functions/lib/student-academic-status.js';
import { applicationLinkedToStudent, enrolledApplication } from '../functions/lib/student-status-links.js';
const source=await readFile(new URL('../functions/api/backend.js',import.meta.url),'utf8');
const clean=value=>String(value??'').trim(), lower=value=>clean(value).toLowerCase();

function fixture() {
  const scope={BranchId:'garden',SchoolSection:'primary'}, calls=[], saves=[];
  const app={...scope,__id:'APP-1',__scopePath:'schoolBranches/garden/sections/primary/applications',__updateTime:'app1',
    ApplicationReference:'APP/1',AdmissionNo:'S/1',Status:'Enrolled',Enrolled:'YES'};
  const student={...scope,__id:'S-1',__updateTime:'p1',ApplicationReference:'APP/1',AdmissionNo:'S/1',Status:'Active',
    ClassName:'Grade 1',ClassArm:'Merit',AcademicSession:'2026/2027',Term:'First Term'};
  const c=vm.createContext({clean,lower,STUDENT_STATUSES,applicationLinkedToStudent,enrolledApplication,
    nowIso:()=>new Date().toISOString(),pick:(row,fields)=>fields.map(field=>row[field]).find(value=>value!==undefined)||'',
    yesNo:value=>value==='YES'?'YES':'NO',
    identityRecordBranch:row=>row.BranchId,identityRecordSection:row=>row.SchoolSection,
    requestedStudentScope:body=>({branchId:body.BranchId,schoolSectionAccess:body.SchoolSection}),
    schoolOperationsScope:body=>({branchId:body.BranchId,schoolSectionAccess:body.SchoolSection}),
    applicationIdFrom:body=>body.ApplicationReference,
    applicationNotFound:()=>Object.assign(new Error('Not found'),{status:404}),
    findApplication:async(_env,id,requested)=>{calls.push(['application',id,requested]);return app;},
    findStudentByAccountRef:async(_env,id,requested)=>{calls.push(['student',id,requested]);return student;},
    saveStudent:async(_env,row,options)=>{saves.push({row,options});return {...row,__academicStatusMembershipCount:1};},
    saveApplication:async()=>{throw new Error('Linked status must not use a separate application write.');},
    assertEntranceScoresUnchanged:()=>{}, configuredClassNames:async()=>[],canonicalConfiguredClass:clean});
  for(const name of ['saveLinkedApplicationStudentStatus','updateApplicationStatus','updateApplicationDetails','updateStudentStatus']) {
    vm.runInContext(source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}`))[0],c);
  }
  return {c,app,student,calls,saves,body:{...scope,ApplicationReference:'APP/1',AccountRef:'S/1',Status:'Expelled'}};
}

for(const action of ['updateApplicationStatus','updateApplicationDetails']) test(`${action} invokes one canonical atomic status workflow in the selected branch`,async()=>{
  const f=fixture(); await f.c[action]({},f.body);
  assert.equal(f.saves.length,1);
  assert.equal(f.saves[0].row.Status,'Expelled');
  assert.equal(f.saves[0].options.updateTime,'p1');
  assert.equal(f.saves[0].options.applicationStatusUpdate.before.__updateTime,'app1');
  assert.equal(f.calls.find(call=>call[0]==='student')[2].branchId,'garden');
  assert.equal(f.calls.find(call=>call[0]==='student')[2].schoolSectionAccess,'primary');
  assert.equal(f.calls[0][2].branchId,'garden');
});

test('Accounts status action explicitly reconciles same-status legacy memberships and keeps the effective date',async()=>{
  const f=fixture(); Object.assign(f.student,{Status:'Expelled',StatusEffectiveDate:'2026-10-01',StatusReason:'Recorded decision'});
  await f.c.updateStudentStatus({},f.body);
  assert.equal(f.saves[0].options.synchronizeStudentStatus,true);
  assert.equal(f.saves[0].row.StatusEffectiveDate,'2026-10-01');
  assert.equal(f.saves[0].row.StatusReason,'Recorded decision');
});

test('status routes reject stale revisions, wrong-branch links and simultaneous placement changes',async()=>{
  for(const problem of ['revision','scope','placement']) {
    const f=fixture();
    if(problem==='revision') f.body.RevisionToken='stale';
    if(problem==='scope') f.student.BranchId='main';
    if(problem==='placement') f.body.ClassArm='Different arm';
    await assert.rejects(f.c.updateApplicationStatus({},f.body),{status:409});
    assert.equal(f.saves.length,0);
  }
});

test('missing enrolled learner does not downgrade to an independent application status write',async()=>{
  const f=fixture(); f.c.findStudentByAccountRef=async()=>null;
  await assert.rejects(f.c.updateApplicationStatus({},f.body),{status:409});
  assert.equal(f.saves.length,0);
});
