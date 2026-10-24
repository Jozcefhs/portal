import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { academicPermanentDeleteDependants, academicRecordInCurrentUse } from '../functions/lib/academic-management.js';
import { checkClassroomRemovals } from '../functions/lib/academic-classroom-removal.js';
const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
const clean=value=>String(value??'').trim();
const lower=value=>clean(value).toLowerCase();
const recordId=row=>row.SubjectId||row.ArmId||row.ClassId||row.DepartmentId||row.OfferingId||row.ArmTemplateId||row.AllocationId;
const collections={classes:'academicClasses',arms:'academicArms',subjects:'academicSubjects',departments:'academicDepartments',offerings:'academicSubjectOfferings',armTemplates:'academicArmTemplates',teacherAllocations:'academicTeacherAllocations'};
function runtime(type,row,patch={}) {
 const types={class:'classes',arm:'arms',subject:'subjects',department:'departments',offering:'offerings',armtemplate:'armTemplates',teacherallocation:'teacherAllocations'};
 const state={...Object.fromEntries(Object.keys(collections).map(key=>[key,[]])),studentMemberships:[],studentMovements:[],sessions:[],terms:[],...patch};
 row={BranchId:'main',SchoolSection:'secondary',Status:'Active',__updateTime:'rev1',...row};
 state[types[type]]=[...state[types[type]],row];
 const commits=[],profiles=[];
 const ctx=vm.createContext({clean,lower,recordId,academicPermanentDeleteDependants,academicRecordInCurrentUse,checkClassroomRemovals,
  requireWritableSubscription:()=>{},requireCapability:()=>{},normalizedRecordType:lower,
  RECORD_TYPES:Object.fromEntries(Object.entries(types).map(([key,val])=>[key,{collection:collections[val]}])),
  ACADEMIC_MANAGEMENT_COLLECTIONS:collections,ACADEMIC_RECORD_DEPENDENCY_STATE_KEYS:{},
  academicScope:async()=>({branchId:'main',section:'secondary'}),loadScopedAcademicState:async()=>state,
  findById:(rows,id)=>rows.find(row=>recordId(row)===id),effectiveAcademicSection:row=>row.SchoolSection,
  activeValue:value=>value===true,queryCollectionPages:async()=>state.studentMemberships,
  loadPeople:async()=>({students:profiles}),withoutMetadata:row=>Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('__'))),
  auditWrite:()=>({collectionPath:'academicAudit',data:{}}),legacyClassWrite:()=>null,
  failure:(message,status,code)=>Object.assign(new Error(message),{status,code}),
  commitAcademicBatch:async(_env,writes)=>commits.push(structuredClone(writes)),bootstrapAcademicManagement:async()=>({}),academicRecordResponseView:()=>''});
 vm.runInContext(source.slice(source.indexOf('function academicPermanentDeleteWrites('),source.indexOf('export function academicPermanentDeleteDependants(')),ctx);
 vm.runInContext(source.slice(source.indexOf('export async function deleteAcademicManagementRecord('),source.indexOf('function academicOperationalViewForCapability(')).replace('export ',''),ctx);
 return {state,profiles,commits,ctx,run:()=>ctx.deleteAcademicManagementRecord({}, {},{RecordType:type,RecordId:recordId(row),RevisionToken:'rev1'})};
}
test('past, superseded and exited references never block deleting an unused subject',()=>{
 for(const row of [{Status:'Archived'},{Status:'Transferred'},{Status:'Expelled'},{Status:'Active',SupersededByMembershipId:'new'}, {Status:'Active',SessionId:'old'},{Status:'Active',TermId:'closed'}]) {
  const state={studentMemberships:[{SubjectIds:['french'],...row}],sessions:[{SessionId:'old',EndDate:'2020-01-01'}],terms:[{TermId:'closed',Status:'Closed'}]};
  assert.equal(academicPermanentDeleteDependants(state,'subject',{SubjectId:'french'}).length,0);
 }
});
test('current use is retained for subjects, reusable arms, departments and offerings',()=>{
 for(const key of ['offerings','teacherAllocations','studentMemberships','cbtTests','timetableEntries']) {
  assert.equal(academicPermanentDeleteDependants({[key]:[{SubjectId:'math',SubjectIds:['math'],Status:'Active'}]},'subject',{SubjectId:'math'}).length,1);
 }
 assert.equal(academicPermanentDeleteDependants({arms:[{ArmTemplateId:'merit',Status:'Active'}]},'armtemplate',{ArmTemplateId:'merit'}).length,1);
});
test('subject deletion commits only the catalogue deletion and original identity audit, preserving all history',async()=>{
 const protectedRows={studentScores:[{SubjectId:'french',RawScore:88}],studentMovements:[{FromSubjectIds:['french']}],studentAttendance:[{Status:'Present'}],weeklyDiaries:[{WorkCompleted:'Original work'}]};
 const r=runtime('subject',{SubjectId:'french',Name:'French'},protectedRows);
 const before=structuredClone(r.state);
 await r.run();
 assert.deepEqual(r.state,before);
 assert.deepEqual(r.commits[0].map(w=>w.collectionPath),['academicSubjects','academicAudit']);
 assert.equal(r.commits[0][0].operation,'delete');
 assert.equal(r.commits[0][0].updateTime,'rev1');
 assert.equal(r.commits[0][1].data.DeletedRecord.Name,'French');
 assert.equal(r.commits[0][1].data.DeletedRevision,'rev1');
});
test('an empty class and its empty classrooms are permanently deleted together',async()=>{
 const r=runtime('class',{ClassId:'g11',Name:'Grade 11'}, {arms:[{ClassId:'g11',ArmId:'g11-b',Name:'Brilliance',IsClassroom:true,BranchId:'main',SchoolSection:'secondary',__updateTime:'arm-rev'}],studentScores:[{ArmId:'g11-b',Score:76}]});
 await r.run();
 assert.deepEqual(r.commits[0].filter(w=>w.operation==='delete').map(w=>w.documentId),['g11','g11-b']);
 assert.equal(r.state.studentScores[0].Score,76);
});
test('a student still assigned to a class, including a profile without membership, blocks deletion',async()=>{
 for(const profilesOnly of [false,true]) {
  const r=runtime('class',{ClassId:'g9',Name:'Grade 9'});
  if(profilesOnly) r.profiles.push({ClassName:'Grade 9',AdmissionNo:'TEST1',Status:'Active'});
  else r.state.studentMemberships.push({ClassId:'g9',StudentRef:'TEST1',Status:'Active'});
  await assert.rejects(r.run(),/active|currently used/i);
  assert.equal(r.commits.length,0);
 }
});
test('stale revisions and failed dependency reads cannot delete a record',async()=>{
 const r=runtime('subject',{SubjectId:'math',__updateTime:'new-rev'});
 await assert.rejects(r.run(),{code:'ACADEMIC_WRITE_CONFLICT'});
 assert.equal(r.commits.length,0);
 const c=runtime('arm',{ClassId:'g7',ArmId:'g7-a',IsClassroom:true},{classes:[{ClassId:'g7'}]});
 c.ctx.queryCollectionPages=async()=>{throw new Error('connection lost');};
 await assert.rejects(c.run(),/connection lost/);
 assert.equal(c.commits.length,0);
});
