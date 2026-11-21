import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context={window:{}};
vm.runInNewContext(await readFile(new URL('../js/hospital-attendance.js',import.meta.url),'utf8'),context);
const {summarize}=context.window.DynamaxHospitalAttendance;
test('attendance separates attended visits, distinct patients, cancellations and unclassified visits',()=>{
  const stats=summarize([
    {department:'Clinic A',patient:'abc',status:'Waiting'},{department:' clinic   a ',patient:'abc',status:'Completed'},
    {department:'Clinic B',patient:'abc',status:'In progress'},{department:'Clinic B',patient:'other',status:'Cancelled'},
    {department:'Clinic B',status:'Old status'},{department:'',status:'Waiting'}
  ]);
  assert.equal(stats.attendance,4);assert.equal(stats.patients,1);assert.equal(stats.cancelled,1);
  assert.equal(stats.missingPatient,1);assert.equal(stats.other,1);
  assert.equal(stats.departments.length,3);assert.deepEqual(Array.from(stats.departments[0].counts),[1,0,1,0,0]);
});
test('empty attendance has no visits or patients',()=>{
  const result=summarize([]);assert.equal(result.attendance,0);assert.equal(result.patients,0);assert.equal(result.departments.length,0);
});
