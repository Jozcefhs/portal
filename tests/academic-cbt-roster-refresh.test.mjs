import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {academicCbtRosterRefreshPlan, academicManagementCapabilities} from '../functions/lib/academic-management.js';

const source = await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
const clean = value=>String(value??'').trim(), lower = value=>clean(value).toLowerCase();
const original = { CbtTestId:'test', RecordId:'test', __updateTime:'r1', BranchId:'main',SchoolSection:'secondary',
  SessionId:'session',TermId:'term',ClassId:'class',SubjectId:'maths',TeacherUsername:'teacher',Status:'Scheduled',
  StartsAt:'2099-01-01T08:00:00Z',EndsAt:'2099-01-01T09:00:00Z',StudentRefs:['old','retained'],RosterCount:2,
  PackageRevision:1,PackageDigest:'original-digest',PaperUrl:'unchanged-paper',AnswerKey:['A'],DurationMinutes:60 };
const actor = {username:'teacher',role:'Teacher',edition:'school',allowedSections:['academics'],branchId:'main'};
function fixture(stage='junior-secondary') {
  let record=structuredClone(original), sequence=1;
  const period = {SessionId:'session',TermId:'term',ClassId:'class',SchoolSection:'secondary',Status:'Active'};
  const members = [
    {...period,MembershipId:'retained',StudentRef:'retained',SubjectIds:['maths'],__updateTime:'m1'},
    {...period,MembershipId:'new',StudentRef:'new',SubjectIds:[],__updateTime:'m2'},
    {...period,MembershipId:'old',StudentRef:'old',SubjectIds:['maths'],ClassId:'other',__updateTime:'m3'},
    {...period,MembershipId:'inactive',StudentRef:'inactive',SubjectIds:['maths'],Status:'Withdrawn',__updateTime:'m4'}
  ];
  const commits=[]; let beforeCommit=null;
  const state = { classes:[{...period,SchoolStage:stage}], subjects:[{...period,SubjectId:'maths'}],
    teacherAllocations:[{...period,SubjectId:'maths',AllocationRole:'Subject Teacher',TeacherUsername:'teacher'}],studentMemberships:members };
  const ctx = vm.createContext({clean,lower,crypto,TextEncoder,Date,Uint8Array,ACADEMIC_CBT_STATE_KEYS:[],
    ACADEMIC_MANAGEMENT_COLLECTIONS:{cbtTests:'academicCbtTests'},academicCbtRosterRefreshPlan,
    failure:(message,status,code)=>Object.assign(new Error(message),{status,code}),
    academicOperationalContext:async (_env,user,input)=>{
      assert.equal(user.branchId,'main'); assert.equal(input.SchoolSection,'secondary');
      const permissions=academicManagementCapabilities(user);
      if(!permissions.canCreateCbt||user.subscriptionReadOnly) throw Object.assign(new Error('Forbidden'),{status:403});
      return {permissions,scope:{section:'secondary'},state:{...structuredClone(state),cbtTests:[structuredClone(record)]},session:{SessionId:'session'},term:{TermId:'term'}};
    },
    findById:(rows,id)=>rows.find(r=>[r.ClassId,r.SubjectId,r.CbtTestId].includes(id)),
    assertReference:r=>{assert.ok(r);return r;},statusActive:r=>r.Status==='Active',
    actorUsername:u=>u.username,actorName:u=>u.username,nowIso:()=>new Date().toISOString(),
    academicAssessmentForPeriod:async()=>({Ready:true}),
    academicCbtPackageDigest:async r=>JSON.stringify([r.StudentRefs,r.PackageRevision,r.StartsAt]),
    withoutMetadata:r=>Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('__'))),
    publicRecord:r=>({...r,RevisionToken:r.__updateTime}),
    writePrecondition:(r,token)=>{assert.equal(token,r.__updateTime);return {updateTime:token};},
    auditWrite:(_u,action,_entity,r,details)=>({collectionPath:'academicAudit',documentId:'audit',data:{action,CbtTestId:r.CbtTestId,details}}),
    loadAcademicCbtPapers:async()=>[{FileName:'paper.pdf',FileBase64:'fixture'}],
    commitAcademicBatch:async(_env,writes)=>{
      beforeCommit?.(); beforeCommit=null;
      if(writes[0].updateTime!==record.__updateTime) throw Object.assign(new Error('Conflict'),{status:409});
      commits.push(structuredClone(writes)); record={...structuredClone(writes[0].data),__updateTime:`r${++sequence}`};
      return {writeResults:[{updateTime:record.__updateTime}]};
    }
  });
  ctx.commitAcademicCbtRoster = (...args)=>ctx.commitAcademicBatch(args[0],args[1]);
  for(const [start,end] of [
    ['function academicCbtAuthority(','async function academicCbtPackageDigest('],
    ['export async function refreshAcademicCbtRoster(','export async function rescheduleAcademicCbtTest('],
    ['export async function downloadAcademicCbtTestPackage(','export async function prepareLocalCbtIdentityPackage(']
  ]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)).replace(/^export /gm,''),ctx);
  const input={SchoolSection:'secondary',SessionId:'session',TermId:'term',CbtTestId:'test'};
  return {members,commits,record:()=>structuredClone(record),patch:patch=>{record={...record,...patch};},
    conflict:()=>{beforeCommit=()=>{record.__updateTime='concurrent';};},
    race:patch=>{beforeCommit=()=>{record={...record,...patch,__updateTime:'concurrent'};};},
    preview:(user=actor,patch={})=>ctx.refreshAcademicCbtRoster({},user,{...input,...patch}),
    post:(review,user=actor)=>ctx.refreshAcademicCbtRoster({},user,{...input,...review},true),
    download:()=>ctx.downloadAcademicCbtTestPackage({},actor,input),
    acknowledge:patch=>ctx.acknowledgeAcademicCbtImport({},actor,{...input,PackageRevision:1,RevisionToken:'r1',...patch})};
}

test('reviewed junior refresh adds current students, removes transfers and preserves paper/schedule', async()=>{
  const f=fixture(), preview=await f.preview();
  assert.equal(f.commits.length,0);
  assert.deepEqual(Array.from(preview.rosterReview.Added),['new']);
  assert.deepEqual(Array.from(preview.rosterReview.Removed),['old']);
  const result=await f.post(preview.rosterReview);
  assert.equal(result.cbtTest.RosterCount,2);
  assert.equal(result.cbtTest.PackageRevision,2);
  for(const key of ['PaperUrl','AnswerKey','StartsAt','EndsAt','DurationMinutes']) assert.deepEqual(result.cbtTest[key],original[key]);
  assert.deepEqual(f.commits[0].map(w=>w.collectionPath),['academicCbtTests','academicAudit']);
  await assert.rejects(f.post(preview.rosterReview),{code:'ACADEMIC_CBT_ROSTER_CHANGED'});
  const current=await f.preview(); await f.post(current.rosterReview);
  assert.equal(f.commits.length,1,'Reconfirming an unchanged roster is a no-op');
});

test('senior refresh respects selected subjects after transfers',async()=>{
  const f=fixture('senior-secondary');
  const p=await f.preview(); assert.deepEqual(Array.from(p.rosterReview.StudentRefs),['retained']);
  f.members[1].SubjectIds=['maths']; f.members[1].__updateTime='changed';
  await assert.rejects(f.post(p.rosterReview),{code:'ACADEMIC_CBT_ROSTER_CHANGED'});
  const fresh=await f.preview(); await f.post(fresh.rosterReview);
  assert.deepEqual(f.record().StudentRefs,['new','retained']);
});

test('preview is scope/owner protected and blocks started, ended, downloaded and issued tests',async()=>{
  const f=fixture();
  await assert.rejects(f.preview({...actor,username:'other'}),{code:'ACADEMIC_CBT_OWNER_FORBIDDEN'});
  await assert.rejects(f.preview({...actor,allowedSections:[]}),{status:403});
  await assert.rejects(f.preview({...actor,subscriptionReadOnly:true}),{status:403});
  await assert.rejects(f.preview(actor,{CbtTestId:'other'}),{code:'ACADEMIC_CBT_TEST_NOT_FOUND'});
  for(const patch of [{Status:'Superseded'},{StartsAt:'2020-01-01'},{StartsAt:'invalid'},{LocalDownloadedAt:'done'},{LocalPackageIssuedAt:'issued'}]){
    const blocked=fixture(); blocked.patch(patch);
    await assert.rejects(blocked.preview(),{code:'ACADEMIC_CBT_ROSTER_LOCKED'});
    assert.equal(blocked.commits.length,0);
  }
  f.patch({TermId:'other'}); await assert.rejects(f.preview(),{code:'ACADEMIC_CBT_TEST_NOT_FOUND'});
});

test('stale review and concurrent download never overwrite the test',async()=>{
  const f=fixture(); const p=await f.preview();
  f.members[0].__updateTime='updated';
  await assert.rejects(f.post(p.rosterReview),{code:'ACADEMIC_CBT_ROSTER_CHANGED'});
  const fresh=await f.preview(); f.conflict();
  await assert.rejects(f.post(fresh.rosterReview),{status:409}); assert.equal(f.commits.length,0);
});

test('download locks the roster before releasing a package and returns the new revision for acknowledgement',async()=>{
  const f=fixture(); const before=f.record(); const p=await f.preview(); const response=await f.download();
  assert.ok(f.record().LocalPackageIssuedAt);
  assert.equal(response.cbtPackage.RevisionToken,'r2');
  assert.equal(response.cbtPackage.PackageRevision,before.PackageRevision);
  assert.deepEqual(response.cbtPackage.StudentRefs,before.StudentRefs);
  await assert.rejects(f.post(p.rosterReview),{code:'ACADEMIC_CBT_ROSTER_LOCKED'});
  await f.download(); assert.equal(f.commits.length,1,'Retry does not issue a second lock/audit');
  const racing=fixture(); racing.conflict();
  await assert.rejects(racing.download(),{status:409}); assert.equal(racing.commits.length,0);
});

test('roster refresh deduplicates references and rejects an empty roster',()=>{
  const p=academicCbtRosterRefreshPlan(original,[{StudentRef:'retained'},{StudentRef:'retained'}]);
  assert.equal(p.RosterCount,1);
  assert.throws(()=>academicCbtRosterRefreshPlan(original,[]),{code:'ACADEMIC_CBT_ROSTER_EMPTY'});
});

test('two centres can download the same locked package with the complete eligible roster',async()=>{
  const f=fixture();
  f.race({LocalPackageIssuedAt:'issued-by-other-centre'});
  const downloaded=await f.download();
  assert.deepEqual(downloaded.cbtPackage.StudentRefs,original.StudentRefs);
  assert.equal(downloaded.cbtPackage.RevisionToken,'concurrent');
  assert.equal(f.commits.length,0,'The other centre already froze the package');
  const second=await f.download();
  assert.deepEqual(second.cbtPackage.StudentRefs,original.StudentRefs);
  for(const changed of [{PackageRevision:2},{PackageDigest:'different'},{StudentRefs:['new']},{CloudPaperRemovedAt:'removed'}]) {
    const blocked=fixture(); blocked.race({LocalPackageIssuedAt:'issued',...changed});
    await assert.rejects(blocked.download(),{status:409});
  }
});

test('independent and simultaneous server import acknowledgements preserve the test and roster',async()=>{
  const f=fixture(); await f.download();
  await f.acknowledge({LocalPackageDigest:'server-a-local-digest'});
  const first=f.record();
  f.conflict();
  await f.acknowledge({LocalPackageDigest:'server-b-local-digest'});
  const second=f.record();
  assert.equal(second.LocalDownloadedAt,first.LocalDownloadedAt);
  assert.deepEqual(second.StudentRefs,original.StudentRefs);
  for(const field of ['PackageRevision','PackageDigest','PaperUrl','AnswerKey','StartsAt','EndsAt'])
    assert.deepEqual(second[field],original[field]);
  const count=f.commits.length;
  f.race({PackageRevision:2});
  await assert.rejects(f.acknowledge({LocalPackageDigest:'old'}),{code:'ACADEMIC_CBT_PACKAGE_CHANGED'});
  assert.equal(f.commits.length,count,'A genuine package revision change is not acknowledged');
});

test('browser refresh requires a preview confirmation, displays changes and submits its token',async()=>{
  const ui=await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
  assert.match(ui,/data-academic-cbt-refresh-roster/);
  assert.match(ui,/previewAcademicCbtRoster/);
  assert.match(ui,/items:\[\.\.\.review.Added.map/);
  assert.match(ui,/if \(!confirmed\) return;/);
  assert.match(ui,/PreviewToken:review.PreviewToken, RevisionToken:review.RevisionToken/);
});
