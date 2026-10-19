import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const backend = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
function harness(overrides = {}) {
  const record = { CbtTestId:'test', StartsAt:'2099-01-01T09:00:00Z', Status:'Scheduled',
    DurationMinutes:40, ObjectiveDurationMinutes:40, TheoryDurationMinutes:0, PaperMode:'single',
    AnswerKey:['A','B'], StudentRefs:['S1'], PaperFiles:[{Url:'paper'}], LocalDownloadedAt:'2026-01-01',
    PackageRevision:3, ScheduleRevision:1, ...overrides };
  const writes = [];
  let authorised = 0;
  const context = vm.createContext({
    academicOperationalContext:async () => ({state:{cbtTests:[record]}}),
    findById:(rows,id)=>rows.find(r=>r.CbtTestId===id), lower:v=>String(v||'').toLowerCase(), clean:v=>String(v||'').trim(),
    academicCbtAuthority:()=>{authorised++;}, nowIso:()=>new Date().toISOString(), actorName:()=> 'Officer',
    failure:(message,status,code)=>Object.assign(new Error(message),{status,code}),
    academicCbtPackageDigest:async r=>JSON.stringify([r.StartsAt,r.DurationMinutes,r.TheoryDurationMinutes]),
    ACADEMIC_MANAGEMENT_COLLECTIONS:{cbtTests:'tests'}, withoutMetadata:r=>r, publicRecord:r=>r,
    writePrecondition:(_r,revision)=>{assert.equal(revision,'known');return {updateTime:revision};},
    auditWrite:(_u,action,_c,_r,detail)=>({action,detail}),
    commitAcademicBatch:async (_env,batch)=>{writes.push(...batch);return {writeResults:[{updateTime:'saved'}]};}
  });
  const start = backend.indexOf('export async function rescheduleAcademicCbtTest(');
  vm.runInContext(backend.slice(start,backend.indexOf('async function deleteAcademicCbtPapers(',start)).replace('export ',''),context);
  return {record,writes,run:input=>context.rescheduleAcademicCbtTest({}, {}, {CbtTestId:'test',RevisionToken:'known',StartsAt:'2099-01-01T10:00:00Z',...input}), authorised:()=>authorised};
}
test('reschedule updates duration and revisions but preserves roster, papers and historical metadata',async()=>{
 const h=harness(); const before=JSON.stringify(h.record);
 const result=await h.run({DurationMinutes:65});
 assert.equal(h.authorised(),1); assert.equal(h.writes.length,2);
 const saved=result.CbtTest;
 assert.equal(saved.DurationMinutes,65); assert.equal(saved.ObjectiveDurationMinutes,65);
 assert.equal(saved.EndsAt,'2099-01-01T11:05:00.000Z'); assert.equal(saved.PackageRevision,4); assert.equal(saved.ScheduleRevision,2);
 for(const field of ['AnswerKey','StudentRefs','PaperFiles','LocalDownloadedAt']) assert.deepEqual(saved[field],h.record[field]);
 assert.equal(JSON.stringify(h.record),before); assert.equal(h.writes[0].updateTime,'known');
 assert.match(h.writes[1].detail,/duration 40 -> 65/);
});
test('split timers can be edited independently and legacy date-only requests retain durations',async()=>{
 const h=harness({PaperMode:'split',TheoryDurationMinutes:60});
 const legacy=await h.run({}); assert.equal(legacy.CbtTest.EndsAt,'2099-01-01T11:40:00.000Z');
 const result=await h.run({DurationMinutes:20,TheoryDurationMinutes:80});
 assert.equal(result.CbtTest.DurationMinutes,20); assert.equal(result.CbtTest.TheoryDurationMinutes,80);
 assert.equal(result.CbtTest.EndsAt,'2099-01-01T11:40:00.000Z');
});
test('invalid durations, dates and missing tests never commit',async()=>{
 for (const value of [0,-1,481,1.5,'','bad',Infinity]) {
  for (const field of ['DurationMinutes','TheoryDurationMinutes']) {
   const h=harness({PaperMode:'split',TheoryDurationMinutes:60});
   await assert.rejects(h.run({[field]:value}),/whole number/); assert.equal(h.writes.length,0);
  }
 }
 for (const input of [{StartsAt:'bad'},{StartsAt:'2000-01-01T00:00:00Z'},{CbtTestId:'missing'}]) {
  const h=harness(); await assert.rejects(h.run(input)); assert.equal(h.writes.length,0);
 }
});
test('scheduled register opts into existing local search and dialog submits durations with revision guard',()=>{
 const register=admin.slice(admin.indexOf("const register = table('Scheduled CBT Tests'"),admin.indexOf('function academicFinanceClearanceWorkspace('));
 assert.match(register,/searchable: true/); assert.match(register,/Subject, class, test type or date/);
 const dialog=admin.slice(admin.indexOf('function openAcademicCbtRescheduleDialog('),admin.indexOf('async function boundedAcademicGenerationRequest('));
 for(const field of ['DurationMinutes','TheoryDurationMinutes']) assert.match(dialog,new RegExp(`name="${field}" min="1" max="480"`));
 assert.match(dialog,/RevisionToken: record.RevisionToken/);
 assert.match(dialog,/DurationMinutes: duration/); assert.match(dialog,/TheoryDurationMinutes: theoryDuration/);
 assert.match(dialog,/TheoryDurationMinutes.disabled = !split/);
});
