import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {buildStructuredQuery, firestoreDocumentToObject} from '../functions/lib/firestore.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), {requireAuth} = require('./requireAuth.js'), {Client} = require('./apiv2.js');
const project='school-management-suite-27064', account=auth.getProjectDefaultAccount(process.cwd());
assert(account, 'Existing CLI sign-in required');
await requireAuth({project,...account});
const client=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const day='2026-10-19', zone='Africa/Lagos';
const clean=v=>String(v??'').trim(), lower=v=>clean(v).toLowerCase();
const localDay=v=>!v||!Number.isFinite(Date.parse(v))?'':new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const active=r=>lower(r.Status||'Active')==='active';
async function query(collection, select, filters=[{field:'BranchId',op:'==',value:'main'}]) {
  let cursor='', all=[];
  do {
    const {endpoint,structuredQuery}=buildStructuredQuery(collection,{select,filters,limit:500,orderBy:[{field:'__name__'}],...(cursor?{startAfterName:cursor}:{})});
    const response=await client.post(`/projects/${project}/databases/(default)/documents${endpoint.startsWith(':')?'':'/'}${endpoint}`,{structuredQuery},{resolveOnHTTPError:true});
    if(response.status>=400) throw new Error(`Read failed ${collection}: ${response.status} ${JSON.stringify(response.body?.error?.message)}`);
    const docs=response.body.filter(r=>r.document).map(r=>r.document);
    all.push(...docs.map(firestoreDocumentToObject));
    cursor=docs.length===500?docs.at(-1).name:'';
  }while(cursor);
  return all;
}
const [classes,subjects,tests,memberships,allocations]=await Promise.all([
  query('academicClasses',['ClassId','Name','SchoolStage','Status','SchoolSection']),
  query('academicSubjects',['SubjectId','Name','Status','SchoolSection']),
  query('academicCbtTests',['Title','ClassId','SessionId','TermId','SubjectId','SubjectName','TeacherUsername','StudentRefs','RosterCount','Status','LocalDownloadedAt','LocalPackageIssuedAt','LocalPackageRevision','CloudPaperRemovedAt','PackageRevision','SchoolSection','NumberOfQuestions','MaximumScore','ObjectiveMaximumScore','PaperFiles','PaperUrl','PaperFileName','PaperByteLength','PaperMode','TheoryPaperFiles','TheoryPaperUrl','StartsAt','EndsAt','DurationMinutes','AssessmentComponentId']),
  query('academicStudentMemberships',['StudentRef','ClassId','SessionId','TermId','SubjectIds','CoreSubjectIds','CurriculumStatus','ArmId','Status','SchoolSection']),
  query('academicTeacherAllocations',['ClassId','SubjectId','TeacherUsername','AllocationRole','Status','SessionId','TermId'])
]);
const period=t=>clean(t.SessionId).includes('2026-2027')&&clean(t.TermId).includes('first-term');
const name=t=>t.SubjectName||subjects.find(s=>s.SubjectId===t.SubjectId)?.Name||t.SubjectId;
const math=tests.filter(t=>(process.argv.includes('--all-today')?localDay(t.StartsAt)===day:/math/i.test(`${name(t)} ${t.Title}`))&&period(t)&&lower(t.Status)!=='superseded');
if(process.argv.includes('--assignment-gaps')) {
  const gaps=math.filter(t=>name(t)==='Mathematics').map(t=>{
    const cls=classes.find(c=>c.ClassId===t.ClassId)||{};
    const rows=memberships.filter(m=>active(m)&&m.ClassId===t.ClassId&&m.SessionId===t.SessionId&&m.TermId===t.TermId&&!m.SubjectIds?.includes(t.SubjectId));
    const reasons={}; for(const r of rows) { const reason=clean(r.CurriculumStatus)||'Not recorded'; reasons[reason]=(reasons[reason]||0)+1; }
    return {class:cls.Name,stage:cls.SchoolStage,withoutMathAssignment:rows.length,withoutAnySubjects:rows.filter(r=>!r.SubjectIds?.length).length,reasons};
  });
  console.log(JSON.stringify({date:day,gaps},null,2)); process.exit(0);
}
const summaries=math.map(t=>{
  const c=classes.find(c=>c.ClassId===t.ClassId)||{};
  const currentRows=memberships.filter(m=>active(m)&&m.SessionId===t.SessionId&&m.TermId===t.TermId&&m.ClassId===t.ClassId&&(c.SchoolStage==='junior-secondary'||m.SubjectIds?.includes(t.SubjectId)));
  const allClass=new Set(memberships.filter(m=>active(m)&&m.SessionId===t.SessionId&&m.TermId===t.TermId&&m.ClassId===t.ClassId).map(m=>lower(m.StudentRef)));
  const current=new Set(currentRows.map(m=>lower(m.StudentRef))), saved=new Set((t.StudentRefs||[]).map(lower));
  const missing=[...current].filter(r=>!saved.has(r)), stale=[...saved].filter(r=>!current.has(r));
  const files=t.PaperFiles?.length?t.PaperFiles:t.PaperUrl?[{Url:t.PaperUrl,FileName:t.PaperFileName}]:[];
  const allocation=allocations.some(a=>active(a)&&lower(a.AllocationRole)==='subject teacher'&&a.SessionId===t.SessionId&&a.TermId===t.TermId&&a.ClassId===t.ClassId&&a.SubjectId===t.SubjectId&&lower(a.TeacherUsername)===lower(t.TeacherUsername));
  return {id:t.RecordId||t.CbtTestId,title:t.Title,subject:name(t),class:c.Name||t.ClassId,stage:c.SchoolStage,section:c.SchoolSection,date:localDay(t.StartsAt),startsAt:t.StartsAt,endsAt:t.EndsAt,status:t.Status,saved:saved.size,currentEligible:current.size,currentClass:allClass.size,missingCount:missing.length,staleCount:stale.length,missing,stale,teacherAllocationValid:allocation,rosterLocked:!!(t.LocalDownloadedAt||t.LocalPackageIssuedAt),downloadedAt:t.LocalDownloadedAt||'',issuedAt:t.LocalPackageIssuedAt||'',cloudRemoved:!!t.CloudPaperRemovedAt,paperCount:files.length,files,questions:t.NumberOfQuestions,score:t.MaximumScore,revision:t.PackageRevision,localRevision:t.LocalPackageRevision};
});
const today=tests.filter(t=>period(t)&&lower(t.Status)==='scheduled'&&localDay(t.StartsAt)===day);
if(process.argv.includes('--all-today')) {
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),date:day,total:today.length,rosterGaps:summaries.filter(t=>t.missingCount||t.staleCount).map(({title,saved,currentEligible,missingCount,staleCount,rosterLocked})=>({title,saved,currentEligible,missingCount,staleCount,rosterLocked}))},null,2));
  process.exit(0);
}
console.log(JSON.stringify({checkedAt:new Date().toISOString(),date:day,timezone:zone,totalScheduledToday:today.length,math:summaries,classes:classes.filter(active).map(c=>({name:c.Name,stage:c.SchoolStage,section:c.SchoolSection,currentStudents:new Set(memberships.filter(m=>active(m)&&period(m)&&m.ClassId===c.ClassId).map(m=>lower(m.StudentRef))).size,testsToday:today.filter(t=>t.ClassId===c.ClassId).length,mathTestsToday:summaries.filter(t=>t.class===c.Name&&t.date===day&&lower(t.status)==='scheduled').length}))},null,2));
