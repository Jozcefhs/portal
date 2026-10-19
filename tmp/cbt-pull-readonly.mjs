import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), {requireAuth} = require('./requireAuth.js'), {Client} = require('./apiv2.js');
const project = 'school-management-suite-27064', account = auth.getProjectDefaultAccount(process.cwd());
assert(account, 'Existing CLI sign-in required');
await requireAuth({project, ...account});
const client = new Client({urlPrefix:'https://firestore.googleapis.com', apiVersion:'v1'});
if(process.argv.includes('--audit')) {
  const {structuredQuery}=buildStructuredQuery('platformSecurityAudit',{filters:[{field:'Timestamp',op:'>=',value:'2026-10-18T23:00:00Z'}],orderBy:[{field:'Timestamp',direction:'DESCENDING'}],limit:1000,select:['Timestamp','Action','HttpStatus','Details','DurationMs']});
  const response=await client.post(`/projects/${project}/databases/(default)/documents:runQuery`,{structuredQuery},{resolveOnHTTPError:true});
  if(response.status>=400) throw new Error(`Audit read failed: ${response.status}`);
  const rows=response.body.filter(r=>r.document).map(r=>firestoreDocumentToObject(r.document)).filter(r=>/c.?b.?t|identity.package/i.test(r.Action));
  console.log(JSON.stringify(rows.slice(0,55),null,2));
  process.exit(0);
}
const fields = {
  academicClasses: ['ClassId','Name','SchoolStage','Status','SchoolSection'],
  academicCbtTests: ['Title','ClassId','SessionId','TermId','SubjectId','SubjectName','TeacherUsername','StudentRefs','RosterCount','Status','LocalDownloadedAt','CloudPaperRemovedAt','PackageRevision','SchoolSection','NumberOfQuestions','MaximumScore','ObjectiveMaximumScore','PaperFiles','PaperByteLength'],
  academicStudentMemberships: ['StudentRef','ClassId','SessionId','TermId','SubjectIds','Status','SchoolSection']
};
async function query(collection) {
  const {structuredQuery} = buildStructuredQuery(collection,{select:fields[collection],filters:[{field:'BranchId',op:'==',value:'main'}]});
  const response=await client.post(`/projects/${project}/databases/(default)/documents:runQuery`,{structuredQuery},{resolveOnHTTPError:true});
  if(response.status>=400) throw new Error(`Read failed ${collection}: ${response.status}`);
  return response.body.filter(r=>r.document).map(r=>firestoreDocumentToObject(r.document));
}
const [classes,tests,memberships]=await Promise.all(Object.keys(fields).map(query));
if(process.argv.includes('--math-paper')) {
  console.log(JSON.stringify(tests.filter(t=>t.SubjectName==='Mathematics').map(t=>({title:t.Title,files:t.PaperFiles})),null,2));
  process.exit(0);
}
const active=r=>String(r.Status||'Active').toLowerCase()==='active';
console.log(JSON.stringify({count:tests.length,tests:tests.filter(t=>t.SessionId.includes('2026-2027')&&t.TermId.includes('first-term')&&t.Status!=='Superseded').map(t=>{
  const c=classes.find(c=>c.ClassId===t.ClassId)||{};
  const current=new Set(memberships.filter(m=>active(m)&&m.SessionId===t.SessionId&&m.TermId===t.TermId&&m.ClassId===t.ClassId&&(c.SchoolStage==='junior-secondary'||m.SubjectIds?.includes(t.SubjectId))).map(m=>m.StudentRef.toLowerCase()));
  const saved=new Set((t.StudentRefs||[]).map(r=>r.toLowerCase()));
  return {title:t.Title,questions:t.NumberOfQuestions,score:t.ObjectiveMaximumScore||t.MaximumScore,downloaded:Boolean(t.LocalDownloadedAt),stale:[...saved].filter(r=>!current.has(r)).length,missing:[...current].filter(r=>!saved.has(r)).length};
})},null,2));
