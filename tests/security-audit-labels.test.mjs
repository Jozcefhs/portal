import test from 'node:test';
import assert from 'node:assert/strict';
import { securityAuditDisplayLabels } from '../functions/lib/security-audit-labels.js';
const student='student__main__secondary__session__2026-2027__dca-25-0138';
const schoolClass='class__main__secondary__grade-9';
const subject='subject__main__secondary__che';
const docs = {
  [`academicStudentMemberships/${student}`]:{StudentRef:'DCA/25/0138',BranchId:'main',SchoolSection:'secondary'},
  ['schoolBranches/main/sections/secondary/students/DCA-25-0138']:{ApplicantName:'Sample Learner',BranchId:'main',SchoolSection:'secondary'},
  [`academicClasses/${schoolClass}`]:{Name:'Grade 9',BranchId:'main'},
  [`academicSubjects/${subject}`]:{Name:'Chemistry',BranchId:'main'}
};
function db(records=docs) {
  const calls=[];
  return {calls, db:{getDocuments:async(_env,path,ids)=>{calls.push({path,ids});return ids.map(id=>records[`${path}/${id}`]||null);},
    getSchoolStructure:async()=>({Branches:[{Id:'main',Name:'Main Branch'}]})}};
}
test('audit names use bounded deduplicated lookups and preserve the original evidence',async()=>{
  const h=db(); const rows=[{BranchId:'main',Subject:student,EntityId:student,Details:`${student} | transfer`,Summary:`Affected ${student}.`},
    {BranchId:'main',Subject:schoolClass,EntityId:schoolClass,Details:subject}];
  const before=structuredClone(rows), result=await securityAuditDisplayLabels({},rows,{db:h.db});
  assert.deepEqual(rows,before); assert.equal(result[0].Subject,student);
  assert.equal(result[0].SubjectDisplay,'Sample Learner (DCA/25/0138)');
  assert.equal(result[0].SummaryDisplay,'Affected Sample Learner (DCA/25/0138).');
  assert.equal(result[1].SubjectDisplay,'Grade 9'); assert.equal(result[1].DetailsDisplay,'Chemistry');
  assert.equal(result[1].BranchDisplay,'Main Branch');
  assert.ok(h.calls.every(call=>call.ids.length===1)); assert.equal(h.calls.length,4);
});
test('unavailable and cross-branch names never leak another branch or prevent reading the audit',async()=>{
  const h=db({...docs,[`academicSubjects/${subject}`]:{Name:'Private Name',BranchId:'other'}});
  const rows=[{BranchId:'main',Subject:subject}];
  const result=await securityAuditDisplayLabels({},rows,{db:h.db});
  assert.equal(result[0].SubjectDisplay,'Subject record (name unavailable)');
  assert.doesNotMatch(result[0].SubjectDisplay,/Private|__/);
  assert.deepEqual(await securityAuditDisplayLabels({},[],{db:h.db}),[]);
});
