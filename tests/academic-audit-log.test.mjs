import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadAcademicAuditLog, academicAuditPeriod, academicAuditRecordLabels} from '../functions/lib/academic-audit-log.js';
import {prepareSecurityAudit, shouldPersistSecurityAudit} from '../functions/lib/security-audit.js';
const scope={branchId:'main',section:'secondary',structure:{Sections:['primary','secondary']}};
const input={FromDate:'2026-10-01',ToDate:'2026-10-26'};
const row=i=>({__id:`a${i}`,__name:`projects/test/databases/(default)/documents/academicManagementAudit/a${i}`,
  Timestamp:'2026-10-26T10:00:00.000Z',BranchId:'main',SchoolSection:'secondary',Action:'RESTORE SAVED SUBJECTS',StudentRef:'TEST/1',RecordId:'student-id',Actor:'Officer'});
function fixture(rows=[]) {
  const calls=[], labels=[];
  return {calls,labels,db:{academicAuditRecordLabels:async(_env,_scope,items)=>items,queryCollection:async(...args)=>{calls.push(args);return structuredClone(rows);},
    securityAuditDisplayLabels:async(_env,items)=>{labels.push(items);return items.map(item=>({...item,SubjectDisplay:'Student name'}));}}};
}
test('dates are required and valid before a single audit read occurs',async()=>{
  for(const request of [{},{...input,FromDate:'2026-02-30'},{...input,ToDate:'2026-09-30'},{...input,ToDate:'bad'}]) {
    const f=fixture(); await assert.rejects(loadAcademicAuditLog({},scope,request,f.db)); assert.equal(f.calls.length,0);
  }
  assert.deepEqual(academicAuditPeriod({FromDate:'2026-10-26',ToDate:'2026-10-26'}),{from:'2026-10-26',to:'2026-10-26',start:'2026-10-25T23:00:00.000Z',end:'2026-10-26T22:59:59.999Z'});
});

test('attendance and score-sheet labels resolve only this page without exposing hash IDs or other sections',async()=>{
  const calls=[];
  const records={academicStudentAttendance:[{BranchId:'main',SchoolSection:'secondary',StudentRef:'TEST/1'}],
    academicScoreSheets:[{BranchId:'main',SchoolSection:'secondary',ClassId:'class__grade-10',ArmId:'arm__perfection',SubjectId:'subject__maths'}],
    'schoolBranches/main/sections/secondary/students':[{BranchId:'main',SchoolSection:'secondary',ApplicantName:'Test Student'},{BranchId:'main',SchoolSection:'primary',ApplicantName:'Other student'}]};
  const raw=[{RecordType:'studentAttendance',RecordId:'attendance-v2-hash'},{RecordType:'scoreSheet',RecordId:'score-sheet__long'},{RecordType:'studentAttendance',StudentRef:'TEST/2'}];
  const before=structuredClone(raw);
  const labels=await academicAuditRecordLabels({},scope,raw,async(_env,path,ids)=>{calls.push({path,ids});return records[path]||[];});
  assert.equal(labels[0].RecordLabel,'Test Student'); assert.equal(labels[1].RecordLabel,'class__grade-10 · arm__perfection · subject__maths');
  assert.equal(labels[2].RecordLabel,'TEST/2'); assert.equal(calls.length,3); assert.deepEqual(raw,before);
});
test('one branch/date query, bounded page and authorised names; no other module logs',async()=>{
  const rows=Array.from({length:51},(_,i)=>row(i)); rows[1].SchoolSection='primary'; rows[2].BranchId='other';
  const f=fixture(rows), before=structuredClone(rows), result=await loadAcademicAuditLog({},scope,input,f.db);
  assert.equal(f.calls.length,1); assert.equal(f.calls[0][1],'academicManagementAudit');
  const query=f.calls[0][2]; assert.equal(query.limit,51); assert.equal(query.filters[0].value,'main');
  assert.equal(query.filters[1].value,'2026-09-30T23:00:00.000Z');
  assert.equal(result.academicAudit.rows.length,48); assert.equal(f.labels[0].length,48);
  assert.equal(result.academicAudit.nextCursor.name,row(49).__name); assert.deepEqual(rows,before);
  const second=fixture([row(50)]);
  const end=await loadAcademicAuditLog({},scope,{...input,Cursor:result.academicAudit.nextCursor},second.db);
  assert.equal(second.calls[0][2].startAfterName,row(49).__name); assert.equal(end.academicAudit.nextCursor,null);
});
test('cursor cannot cross dates, branch, school section or collection',async()=>{
  const valid={context:'main|secondary|2026-10-01|2026-10-26',name:row(1).__name,timestamp:row(1).Timestamp};
  for(const cursor of [{...valid,context:'other|secondary|2026-10-01|2026-10-26'},
    {...valid,name:valid.name.replace('academicManagementAudit','students')},{...valid,timestamp:'2026-01-01T00:00:00.000Z'}]) {
    const f=fixture(); await assert.rejects(loadAcademicAuditLog({},scope,{...input,Cursor:cursor},f.db)); assert.equal(f.calls.length,0);
  }
});
test('legacy secondary records stay visible without leaking into Primary',async()=>{
  const legacy={...row(1)}; delete legacy.SchoolSection;
  assert.equal((await loadAcademicAuditLog({},scope,input,fixture([legacy]).db)).academicAudit.rows.length,1);
  assert.equal((await loadAcademicAuditLog({},{...scope,section:'primary'},input,fixture([legacy]).db)).academicAudit.rows.length,0);
});
test('reading history creates no successful audit noise; failures remain recorded',async()=>{
  const prepared=await prepareSecurityAudit(new Request('https://example.test/api/staff-academics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'getAcademicAuditLog',...input})}),'/api/staff-academics');
  assert.equal(shouldPersistSecurityAudit(prepared,null,200),false);
  for(const status of [403,500]) assert.equal(shouldPersistSecurityAudit(prepared,null,status),true);
});
test('API checks role and school scope before querying; index matches pagination',async()=>{
  const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
  assert.match(source,/action === 'getacademicauditlog'[\s\S]*?requireCapability\(user, 'canReviewScores'\)[\s\S]*?academicScope[\s\S]*?loadAcademicAuditLog/);
  const indexes=JSON.parse(await readFile(new URL('../firestore.school.indexes.json',import.meta.url),'utf8')).indexes;
  assert.ok(indexes.some(index=>index.collectionGroup==='academicManagementAudit' && index.fields[0].fieldPath==='BranchId' && index.fields[1].fieldPath==='Timestamp' && index.fields[1].order==='DESCENDING'));
});
