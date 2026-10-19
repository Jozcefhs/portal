// Read-only, projected academic metadata; no questions, answers or student names.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), {requireAuth} = require('./requireAuth.js'), {Client} = require('./apiv2.js');
const project = 'school-management-suite-27064', account = auth.getProjectDefaultAccount(process.cwd());
assert(account, 'Existing CLI sign-in required');
await requireAuth({project, ...account});
const client = new Client({urlPrefix:'https://firestore.googleapis.com', apiVersion:'v1'});
const base = `/projects/${project}/databases/(default)/documents`;
const fields = {
  academicClasses: ['ClassId','Name','SchoolStage','Status','BranchId','SchoolSection'],
  academicSessions: ['SessionId','Name','Status','BranchId','SchoolSection'],
  academicTerms: ['TermId','SessionId','Name','Status','BranchId','SchoolSection'],
  academicCbtTests: ['CbtTestId','ClassId','SessionId','TermId','SubjectId','StudentRefs','RosterCount','Status','CreatedAt','UpdatedAt','LocalDownloadedAt','BranchId','SchoolSection'],
  academicStudentMemberships: ['StudentRef','ClassId','SessionId','TermId','SubjectIds','Status','UpdatedAt','BranchId','SchoolSection']
};
const readTime = new Date(Date.now()-5000).toISOString();
async function query(collection) {
  assert(Object.hasOwn(fields, collection));
  const all = []; let startAfterName = '';
  for (let page=0;page<30;page++) {
    const {endpoint,structuredQuery} = buildStructuredQuery(collection, {select:fields[collection], filters:[{field:'BranchId',op:'==',value:'main'}], orderBy:[{field:'__name__'}],limit:500,...(startAfterName?{startAfterName}:{})});
    assert(endpoint.endsWith(':runQuery'));
    const response = await client.post(`${base}/${endpoint}`,{structuredQuery,readTime},{resolveOnHTTPError:true});
    const entries = Array.isArray(response.body)?response.body:[response.body];
    if(response.status>=400 || entries.some(r=>r?.error)) throw new Error(`Read failed: ${collection}, ${response.status}`);
    const docs = entries.filter(r=>r.document).map(r=>r.document);
    all.push(...docs.map(firestoreDocumentToObject));
    if(docs.length<500) return all;
    startAfterName=docs.at(-1).name;
  }
  throw new Error('Read limit reached');
}
const [classes,sessions,terms,tests,memberships] = await Promise.all(Object.keys(fields).map(query));
const active = r => String(r.Status||'Active').toLowerCase()==='active';
const summary=[];
for(const c of classes.filter(c=>active(c)&&c.SchoolStage==='junior-secondary')) {
  for(const session of sessions.filter(s=>s.Name==='2026/2027')) {
    for(const term of terms.filter(t=>t.SessionId===session.SessionId)) {
      const records=memberships.filter(m=>active(m)&&m.ClassId===c.ClassId&&m.SessionId===session.SessionId&&m.TermId===term.TermId);
      const currentRefs=new Set(records.map(m=>m.StudentRef));
      const scheduled=tests.filter(t=>t.ClassId===c.ClassId&&t.SessionId===session.SessionId&&t.TermId===term.TermId);
      if(!scheduled.length) continue;
      summary.push({class:c.Name,session:session.Name,term:term.Name,currentStudents:currentRefs.size,tests:scheduled.map(t=>{
        const refs=new Set(t.StudentRefs||[]);
        return {subject:t.SubjectId,status:t.Status,savedCount:t.RosterCount,currentSubjectCount:new Set(records.filter(m=>(m.SubjectIds||[]).includes(t.SubjectId)).map(m=>m.StudentRef)).size,
          currentNotInSaved:[...currentRefs].filter(ref=>!refs.has(ref)).length,savedNotInCurrent:[...refs].filter(ref=>!currentRefs.has(ref)).length,
          created:t.CreatedAt,updated:t.UpdatedAt,downloaded:Boolean(t.LocalDownloadedAt)};
      })});
    }
  }
}
console.log(JSON.stringify({readTime,summary},null,2));
