import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from './helpers/module-policy-vm.mjs';
import { activeAcademicStudentRoster, academicRosterWithStudentStatuses } from '../functions/lib/academic-student-status-roster.js';
import { STUDENT_STATUSES } from '../functions/lib/student-academic-status.js';
import { buildAcademicClassScoreRegister } from '../functions/lib/academic-class-score-register.js';

const scope={BranchId:'annex',SchoolSection:'primary'}, input={SessionId:'s',TermId:'t',ClassId:'c',ArmId:'a'};
const students=STUDENT_STATUSES.map((Status,index)=>({...scope,Status,AdmissionNo:`S/${index}`,StudentRef:`S/${index}`}));
const memberships=students.map(student=>({...scope,...input,StudentRef:student.AdmissionNo,Status:'Active',SubjectIds:['math']}));
const state={sessions:[{SessionId:'s',Status:'Active'}],terms:[{SessionId:'s',TermId:'t',Status:'Active',EndDate:'2099-12-31'}]};

test('legacy active placements respect canonical learner status without writing or erasing any roster/score history',()=>{
  const prior=structuredClone(memberships);
  assert.deepEqual(activeAcademicStudentRoster(memberships,students,state).map(row=>row.StudentRef),['S/0','S/1']);
  const projection=academicRosterWithStudentStatuses(memberships,students,state);
  assert.equal(projection.length,memberships.length);
  assert.equal(projection[6].Status,'Active');
  assert.equal(projection[6].StudentStatus,'Expelled');
  assert.equal(projection[6].ActiveRosterExcluded,true);
  assert.deepEqual(memberships,prior);
});

test('same admission number in another branch/section cannot exclude an active pupil',()=>{
  const pupils=[{...students[0],Status:'Expelled',BranchId:'main'},{...students[0],Status:'Expelled',SchoolSection:'secondary'}];
  assert.equal(activeAcademicStudentRoster([memberships[0]],pupils,state).length,1);
});

test('closed-term roster and saved marks remain available for authorised historic review',()=>{
  const historical={...state,terms:[{...state.terms[0],Status:'Closed'}]};
  assert.equal(activeAcademicStudentRoster(memberships,students,historical).length,memberships.length);
  const data={...historical,classes:[{ClassId:'c',Name:'Grade 1'}],studentMemberships:memberships,students,
    subjects:[{SubjectId:'math',Name:'Mathematics'}],scoreSheets:[{...input,SheetId:'sheet',SubjectId:'math',AssessmentComponents:[{Id:'ca1',Name:'CA1'}]}],
    studentScores:[{...input,StudentRef:'S/6',SubjectId:'math',SheetId:'sheet',ComponentScores:[{ComponentId:'ca1',State:'Numeric',RawScore:82,MaximumScore:100}]}]};
  const before=structuredClone(data),report=buildAcademicClassScoreRegister(data,input);
  assert.equal(report.StudentCount,students.length);
  assert.equal(report.Rows.find(row=>row.StudentRef==='S/6').Cells[0].RawScore,82);
  assert.deepEqual(data,before);
  assert.equal(buildAcademicClassScoreRegister({...data,...state},input).StudentCount,2);
});

test('operational roster resolves only supplied classroom references and reuses profiles across subjects',async()=>{
  const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
  const reads=[];
  const context=vm.createContext({activeAcademicStudentRoster,lower:value=>String(value??'').trim().toLowerCase(),
    studentReference:row=>row.AdmissionNo,
    academicResultBatchRecipients:async(_env,scope,rows)=>{reads.push({scope,refs:rows.map(row=>row.StudentRef)});return students.filter(row=>rows.some(member=>member.StudentRef===row.AdmissionNo));}});
  vm.runInContext(source.match(/async function academicOperationalStudentRoster\([\s\S]*?\n}/)[0],context);
  const cache=new Map(), serverScope={branchId:'annex',section:'primary'};
  const first=await context.academicOperationalStudentRoster({},serverScope,{...state},memberships,cache);
  const second=await context.academicOperationalStudentRoster({},serverScope,{...state},memberships,cache);
  assert.equal(first.length,2); assert.equal(second.length,2); assert.equal(reads.length,1);
  assert.deepEqual(reads[0].refs,memberships.map(row=>row.StudentRef));
});

test('mixed-case legacy admission references share one bounded profile query and still exclude inactive learners',async()=>{
  const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8'), reads=[];
  const profile={BranchId:'annex',SchoolSection:'primary',AdmissionNo:'test/1',Status:'Expelled'};
  const context=vm.createContext({lower:value=>String(value??'').trim().toLowerCase(), clean:value=>String(value??'').trim(),
    uniqueIds:values=>[...new Set(values)],studentReference:row=>row.AdmissionNo,
    scopedCollectionPath:()=> 'schoolBranches/annex/sections/primary/students',
    queryCollectionPages:async(_env,path,options)=>{reads.push({path,options});assert.ok(options.filters[0].value.includes('test/1'));return [profile];},
    scopedAcademicRows:rows=>rows,activeAcademicStudentRoster});
  for(const name of ['academicOperationalStudentRoster','academicResultBatchRecipients']) vm.runInContext(source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}`))[0],context);
  const roster=await context.academicOperationalStudentRoster({}, {branchId:'annex',section:'primary'},state,[{...scope,...input,StudentRef:'TEST/1',Status:'Active'}]);
  assert.equal(roster.length,0); assert.equal(reads.length,1);
  assert.ok(reads[0].options.filters[0].value.length<=30);
});
