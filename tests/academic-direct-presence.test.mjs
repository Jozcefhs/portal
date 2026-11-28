import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('async function getIndividualPresence('), source.indexOf('export async function handleAcademicManagementAction('));
const scope = { branchId: 'garden', section: 'primary' };
const period = { SessionId: 'session', TermId: 'term' };
const pupil = { StudentRef: 'P/12', StudentName: 'Alex Doe' };
const common = { ...period, BranchId: 'garden', SchoolSection: 'primary', ClassId: 'c', ArmId: 'a', Mode: 'Daily' };
function fixture(permissions) {
  const reads = [];
  const records = [common, { ...common, ArmId: 'b' }, { ...common, BranchId: 'other' }, { ...common, Mode: 'Period' },
    { ...common, SchoolSection: 'secondary' }, { ...common, TermId: 'old' }].map(row => ({ ...row, StudentRef: 'P/12' }));
  const profiles = [pupil, {...pupil, StudentRef: 'P/123'}];
  const query = runInNewContext(code + '\ngetIndividualPresence', {
    requireCapability: () => permissions, academicScope: () => scope, clean: x => String(x ?? '').trim(),
    lower: x => String(x ?? '').toLowerCase(), failure: message => new Error(message),
    ACADEMIC_MANAGEMENT_COLLECTIONS: {studentAttendance:'attendance', studentMemberships:'memberships'},
    displayStudents: x => x, loadPeople: () => ({students: profiles}), actorUsername: () => 'teacher', statusActive: () => true,
    loadScopedAcademicState: () => ({teacherAllocations:[{...common, TeacherUsername:'teacher',AllocationRole:'Form Teacher'}]}),
    academicResultBatchRecipients: () => profiles, effectiveAcademicSection: row => row.SchoolSection,
    scopedAcademicRows: rows => rows.filter(r => r.SchoolSection === scope.section),
    getDocument: () => null,
    queryCollectionPages: (_, key, {filters}) => {
      reads.push(key);
      const input = key === 'memberships' ? [{...common, StudentRef:'P/12'}] : [...records,{...common,StudentRef:'P/123'}];
      return input.filter(r => filters.every(f => f.op === 'in' ? f.value.includes(r[f.field]) : r[f.field] === f.value));
    }
  });
  return { run: (params, directory) => query({}, {}, {...period,...params}, directory), reads };
}
test('direct search keeps namesakes distinct and reads no attendance until a pupil is chosen', async () => {
  const {run,reads} = fixture({});
  assert.deepEqual(Array.from((await run({},true)).pupils,p=>p.StudentRef), ['P/12','P/123']);
  assert.deepEqual(reads, []);
  const report = await run({StudentRef:'p/12'},false);
  assert.equal(report.records.length,2);
  assert.ok(report.records.every(r=>r.StudentRef==='P/12'));
  assert.deepEqual(reads,['attendance']);
});
test('direct daily history respects teacher membership and classroom, and excludes finance access', async () => {
  const {run} = fixture({teacherView:true});
  assert.equal((await run({},true)).pupils.length,1);
  assert.equal((await run({StudentRef:'P/12'},false)).records.length,1);
  assert.equal((await run({StudentRef:'P/123'},false)).records.length,0);
  await assert.rejects(fixture({financeView:true}).run({},true), /cannot view/);
});
