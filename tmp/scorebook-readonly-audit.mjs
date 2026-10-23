// Read-only diagnosis. Projected fields only; output contains counts, never student names or marks.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), {requireAuth} = require('./requireAuth.js'), {Client} = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
assert(account, 'Existing CLI sign-in required');
await requireAuth({project, ...account});
const client = new Client({urlPrefix:'https://firestore.googleapis.com', apiVersion:'v1'});
const base = `/projects/${project}/databases/(default)/documents`;
const scope = ['BranchId','SchoolSection','SessionId','TermId','ClassId','SubjectId'];
const fields = {
  academicSessions: ['SessionId','Name','Status'],
  academicTerms: ['TermId','SessionId','Name','Status'],
  academicClasses: ['ClassId','Name','Status'],
  academicSubjects: ['SubjectId','Name','Status'],
  academicStudentMemberships: [...scope,'StudentRef','ArmId','SubjectIds','Status'],
  academicCbtTests: [...scope,'CbtTestId','Status','TestTitle','AssessmentComponentId','MaximumScore','LocalDownloadedAt','UpdatedAt'],
  academicScoreSheets: [...scope,'SheetId','ArmId','Status','LastSavedAt','UpdatedAt','LastScoreSyncId','AssessmentComponents'],
  academicScoreSyncBatches: [...scope,'SyncId','SheetId','ArmId','BatchId','SourceTestId','ImportedRows','RejectedCount','RejectedScores','Status','ReceiptVersion','AffectedScoreIds','SynchronizedAt'],
  academicStudentScores: [...scope,'ScoreId','SheetId','ArmId','SourceType','SourceId','ComponentScores','UpdatedAt']
};
const readTime = new Date(Date.now()-5000).toISOString();
async function query(collection) {
  assert(Object.hasOwn(fields, collection));
  const all = []; let startAfterName = '';
  for (let page=0;page<50;page++) {
    const {endpoint,structuredQuery} = buildStructuredQuery(collection, {select:fields[collection],
      filters:[{field:'BranchId',op:'==',value:'main'}],orderBy:[{field:'__name__'}],limit:500,
      ...(startAfterName?{startAfterName}:{})});
    assert(endpoint.endsWith(':runQuery'));
    const response = await client.post(`${base}/${endpoint}`,{structuredQuery,readTime},{resolveOnHTTPError:true});
    const entries = Array.isArray(response.body)?response.body:[response.body];
    if(response.status>=400 || entries.some(r=>r?.error)) throw new Error(`Read failed: ${collection}, ${response.status}`);
    const docs = entries.filter(r=>r.document).map(r=>r.document);
    all.push(...docs.map(firestoreDocumentToObject));
    if(docs.length<500) return all;
    startAfterName=docs.at(-1).name;
  }
  throw new Error('Read safety limit reached');
}
const data = {};
// Three bounded concurrent reads; no database writes or exam reads.
const collections = Object.keys(fields);
for(let offset=0;offset<collections.length;offset+=3) {
  await Promise.all(collections.slice(offset,offset+3).map(async key => {data[key]=await query(key);}));
}
const session = data.academicSessions.find(s=>s.Name==='2026/2027');
assert(session,'Expected session missing');
const term = data.academicTerms.find(t=>t.SessionId===session.SessionId && /first/i.test(t.Name));
assert(term,'Expected term missing');
const inScope = r=>r.SessionId===session.SessionId && r.TermId===term.TermId && r.SchoolSection==='secondary';
const scores = data.academicStudentScores.filter(inScope), sheets=data.academicScoreSheets.filter(inScope), batches=data.academicScoreSyncBatches.filter(inScope), tests=data.academicCbtTests.filter(inScope);
const byId = rows=>Object.fromEntries(rows.map(r=>[r.SubjectId||r.ClassId,r.Name]));
const subjects = byId(data.academicSubjects), classes=byId(data.academicClasses);
const keys = [...new Set([...scores,...sheets,...batches,...tests].map(r=>`${r.ClassId}|${r.SubjectId}`))].sort();
const scoreMap = new Map(scores.map(s=>[s.ScoreId,s]));
const memberships=data.academicStudentMemberships.filter(inScope);
const legacyRosterChecks=batches.filter(b=>Number(b.ImportedRows)===0&&Number(b.RejectedCount)>0).map(b=>{
  const refs=(b.RejectedScores||[]).map(r=>String(r.StudentRef||'').trim().toLowerCase());
  const roster=memberships.filter(m=>m.ClassId===b.ClassId&&m.ArmId===b.ArmId&&String(m.Status).toLowerCase()==='active'&&(m.SubjectIds||[]).includes(b.SubjectId));
  const accepted=new Set(roster.map(m=>String(m.StudentRef).trim().toLowerCase()));
  return {class:classes[b.ClassId],subject:subjects[b.SubjectId],arm:b.ArmId.split('__').at(-1),
    rejectedRows:refs.length,currentlyOutsideRoster:refs.filter(ref=>!accepted.has(ref)).length};
});
const summary = keys.map(key=>{
  const [classId,subjectId]=key.split('|'), matches=r=>r.ClassId===classId&&r.SubjectId===subjectId;
  const ss=scores.filter(matches), bs=batches.filter(matches), sh=sheets.filter(matches);
  return {class:classes[classId]||classId,subject:subjects[subjectId]||subjectId,
    tests:tests.filter(matches).length,sheets:sh.length,scoreRecords:ss.length,
    recordedCells:ss.reduce((n,s)=>n+(s.ComponentScores||[]).reduce((k,c)=>k+(c.Parts||[c]).filter(v=>['Numeric','Absent','Exempt'].includes(v.State)).length,0),0),
    batches:bs.length,v2Batches:bs.filter(b=>Number(b.ReceiptVersion)===2).length,
    reportedImports:bs.reduce((n,b)=>n+Number(b.ImportedRows||0),0),
    reportedRejections:bs.reduce((n,b)=>n+Number(b.RejectedCount||0),0),
    receiptMissingScoreReferences:bs.reduce((n,b)=>n+(b.AffectedScoreIds||[]).filter(id=>!scoreMap.has(id)||scoreMap.get(id).SheetId!==b.SheetId).length,0),
    lastScoreUpdate:ss.map(s=>s.UpdatedAt).sort().at(-1)||null,
    lastBatch:bs.map(b=>b.SynchronizedAt).sort().at(-1)||null};
});
console.log(JSON.stringify({readTime,session:session.Name,term:term.Name,
  legacyRosterChecks,
  counts:Object.fromEntries(Object.entries(data).map(([key,rows])=>[key,rows.length])),
  summary:summary.filter(s=>s.batches||s.scoreRecords),
  versions:[...new Set(batches.map(b=>String(b.ReceiptVersion)))],
  rejectionCodes:[...new Set(batches.flatMap(b=>(b.RejectedScores||[]).map(r=>r.Code)))],
  latestBatches:batches.sort((a,b)=>String(b.SynchronizedAt).localeCompare(String(a.SynchronizedAt))).slice(0,10).map(b=>({
    class:classes[b.ClassId],subject:subjects[b.SubjectId],version:b.ReceiptVersion||null,
    imported:b.ImportedRows,rejected:b.RejectedCount,status:b.Status,time:b.SynchronizedAt})),
  contexts:tests.filter(t=>['History','Basic Technology','Geography'].includes(subjects[t.SubjectId])).slice(0,10).map(t=>({
    ...Object.fromEntries(scope.map(k=>[k,t[k]])),subjectName:subjects[t.SubjectId],className:classes[t.ClassId],
    ArmId:sheets.find(s=>s.ClassId===t.ClassId)?.ArmId,MaximumScore:t.MaximumScore,AssessmentComponentId:t.AssessmentComponentId})),
  savedSchemes:sheets.filter(s=>['Mathematics','Technical Drawing','Computer Studies'].includes(subjects[s.SubjectId])).slice(0,3).map(s=>({subject:subjects[s.SubjectId],components:s.AssessmentComponents}))},null,2));
