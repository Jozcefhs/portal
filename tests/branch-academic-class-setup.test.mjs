import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as management from '../functions/lib/academic-management.js';
import { safeScopeId, schoolSectionFor } from '../functions/lib/school-scope.js';
import { normalizeClassKey } from '../functions/lib/class-names.js';
import { branchArmNameKey, branchClassCatalogueRevisionWrite } from '../functions/lib/branch-class-catalogue.js';
import { checkClassroomRemovals } from '../functions/lib/academic-classroom-removal.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const actor = { edition: 'school', role: 'Super Admin', username: 'owner', branchId: 'area-1', schoolSectionAccess: 'all', allowedSections: ['academics'] };
const scope = { branchId: 'area-1', section: '', structure: { Sections: ['primary', 'secondary'] } };
const schoolClass = { ...management.normalizeAcademicClass({ Name: 'Nursery2', SortOrder: 20 }, { branchId: 'area-1', section: 'primary' }), __updateTime: 'class-v1' };
const arm = { ...management.normalizeAcademicArm({ ClassId: schoolClass.ClassId, Name: 'Excellence', IsClassroom: true }, { branchId: 'area-1', section: 'primary' }), __updateTime: 'arm-v1' };
const baseRow = { ClassId: schoolClass.ClassId, ClassName: schoolClass.Name, SchoolSection: 'primary', Active: 'YES', SortOrder: 20, Arms: 'Excellence', RevisionToken: 'class-v1', ArmRecords: [{ ArmId: arm.ArmId, Name: arm.Name, RevisionToken: 'arm-v1' }] };
const input = (row = {}, extra = {}) => ({ BranchId: 'area-1', CatalogueRevision: 'catalogue-v1', Classes: [{ ...baseRow, ...row }], ...extra });
const pureState = extra => ({ classes: [structuredClone(schoolClass)], arms: [structuredClone(arm)], armTemplates: [], departments: [], studentMemberships: [], ...extra });

function fixture() {
  const reads = [], commits = [];
  const records = {
    academicClasses: [structuredClone(schoolClass), { ...schoolClass, ClassId: 'other-branch-class', BranchId: 'main', __updateTime: 'foreign-class' }],
    academicArms: [structuredClone(arm)], academicArmTemplates: [], academicDepartments: [],
    academicStudentMemberships: [], academicOfferings: [], academicTeacherAllocations: [], academicSessions: [], academicTerms: [],
    academicStudentScores: [{ StudentRef: 'SHARED/1', Score: 77, ArmId: arm.ArmId }], students: []
  };
  let metadata = { BranchId: 'area-1', ClassCatalogueRevision: 'catalogue-v1', __updateTime: 'meta-v1' };
  let conflict = false;
  const query = async (_env, collection, options = {}) => {
    reads.push(collection);
    return structuredClone((records[collection] || []).filter(row => (options.filters || []).every(filter => filter.op === 'in'
      ? filter.value.includes(row[filter.field]) : row[filter.field] === filter.value)));
  };
  const context = vm.createContext({ ...management, safeScopeId, schoolSectionFor, normalizeClassKey, branchArmNameKey, branchClassCatalogueRevisionWrite,
    checkClassroomRemovals, TextEncoder, TextDecoder, crypto: webcrypto,
    getSchoolStructure: async () => ({ ActiveBranchId: 'main', Branches: [{ Id: 'main' }, { Id: 'area-1' }], Sections: ['primary', 'secondary'] }),
    enforceActorBranch: (_user, branch) => branch,
    readBranchClassCatalogueRevision: async (_env, branch) => { reads.push(`catalogue:${branch}`); return structuredClone(metadata); },
    queryCollection: query, queryCollectionPages: query,
    batchCommitDocuments: async (_env, writes) => {
      if (conflict) throw Object.assign(new Error('conflict'), { status: 412 });
      for (const write of writes) {
        const existing = write.collectionPath === 'branchSchoolSettings' ? metadata
          : (records[write.collectionPath] || []).find(row => (row.ArmId || row.ArmTemplateId || row.ClassId || row.__id) === write.documentId);
        if (write.exists === false && existing || write.updateTime && write.updateTime !== existing?.__updateTime) throw Object.assign(new Error('conflict'), { status: 412 });
      }
      commits.push(structuredClone(writes));
      for (const write of writes) {
        if (write.collectionPath === 'branchSchoolSettings') { metadata = { ...write.data, __updateTime: 'meta-v2' }; continue; }
        const rows = records[write.collectionPath] ||= [];
        const index = rows.findIndex(row => (row.ArmId || row.ArmTemplateId || row.ClassId || row.__id) === write.documentId);
        if (index >= 0) rows.splice(index, 1);
        if (write.operation !== 'delete') rows.push({ ...write.data, __id: write.documentId, __updateTime: 'record-v2' });
      }
    }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  context.loadPeople = async (_env, _user, selectedScope) => { reads.push(`students:${selectedScope.section}`); return { students: structuredClone(records.students), staff: [] }; };
  context.bootstrapAcademicManagement = async () => ({ ok: true });
  return { context, reads, commits, records, conflict: () => { conflict = true; } };
}

test('name aliases resolve existing class identity rather than create another Nursery 2', () => {
  const plan = management.planBranchAcademicClassSetup(pureState(), scope, input({ ClassId: '', ClassName: 'NURSERY 2' }));
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].record.ClassId, schoolClass.ClassId);
  assert.equal(plan.changes[0].record.LegacyDocumentId, schoolClass.LegacyDocumentId);
  assert.equal(plan.removals.length, 0);
});

test('ambiguous aliases and cross-section edits reject without selecting a duplicate', () => {
  const state = pureState({ classes: [schoolClass, { ...schoolClass, ClassId: 'duplicate', Name: 'Nursery 2' }] });
  assert.throws(() => management.planBranchAcademicClassSetup(state, scope, input({ ClassId: '', ClassName: 'NURSERY 2' })), /more than one/);
  assert.throws(() => management.planBranchAcademicClassSetup(pureState(), scope, input({ SchoolSection: 'secondary' })), /another school section/);
  assert.throws(() => management.planBranchAcademicClassSetup(pureState(), scope, input({ ClassId: 'other-branch-class' })), /no longer in this branch/);
});

test('unambiguous new classes infer section and reusable arms are shared without changing existing IDs', () => {
  const plan = management.planBranchAcademicClassSetup(pureState(), scope, { Classes: [
    { ClassName: 'Grade 1', Arms: 'Distinction' }, { ClassName: 'Grade 2', Arms: 'Distinction' }, { ClassName: 'Grade 7', Arms: '' }
  ] });
  assert.equal(plan.changes.filter(change => change.type === 'armtemplate').length, 1);
  assert.equal(plan.changes.filter(change => change.type === 'arm').length, 2);
  assert.equal(plan.changes.find(change => change.record.Name === 'Grade 7').record.SchoolStage, 'junior-secondary');
  assert.throws(() => management.planBranchAcademicClassSetup(pureState(), scope, { Classes: [{ ClassName: 'Foundation', Arms: '' }] }), /school section/);
});

test('legacy rows cannot silently remove an arm and omitted classes are preserved', () => {
  assert.throws(() => management.planBranchAcademicClassSetup(pureState(), scope, { Classes: [{ ...baseRow, Arms: '' }] }), /older desktop/);
  const plan = management.planBranchAcademicClassSetup(pureState(), scope, { Classes: [] });
  assert.equal(plan.removals.length, 0);
  assert.equal(plan.projected.classes[0].ClassId, schoolClass.ClassId);
});

test('saving an unchanged catalogue performs no writes, no pupil reads and tolerates an old revision', async () => {
  const f = fixture(), before = structuredClone(f.records);
  const result = await f.context.saveBranchAcademicClassSetup({}, actor, input({}, { CatalogueRevision: 'old' }));
  assert.equal(result.changed, false); assert.equal(f.commits.length, 0);
  assert.equal(f.reads.some(name => /Membership|Score|students:/.test(name)), false);
  assert.deepEqual(f.records, before);
  assert.equal(f.reads[0], 'catalogue:area-1');
});

test('a class label edit changes only its existing definition and one audit under the branch revision guard', async () => {
  const f = fixture(), scores = structuredClone(f.records.academicStudentScores);
  const result = await f.context.saveBranchAcademicClassSetup({}, actor, input({ ClassName: 'NURSERY 2' }));
  assert.equal(result.changed, true); assert.equal(f.commits.length, 1);
  const writes = f.commits[0];
  assert.deepEqual(writes.map(write => write.collectionPath).sort(), ['academicClasses', 'academicManagementAudit', 'branchSchoolSettings']);
  assert.equal(writes.find(write => write.collectionPath === 'academicClasses').documentId, schoolClass.ClassId);
  assert.deepEqual(f.records.academicStudentScores, scores);
  assert.equal(f.records.academicClasses.find(row => row.BranchId === 'main').Name, schoolClass.Name);
});

test('stale catalogue revision and concurrent commits fail atomically without any saved changes', async () => {
  for (const concurrent of [false, true]) {
    const f = fixture(), before = structuredClone(f.records);
    if (concurrent) f.conflict();
    await assert.rejects(f.context.saveBranchAcademicClassSetup({}, actor, input({ ClassName: 'NURSERY 2' }, concurrent ? {} : { CatalogueRevision: 'old' })), /changed/);
    assert.deepEqual(f.records, before); assert.equal(f.commits.length, 0);
  }
});

test('Settings directs unused classroom removal to Academic Management without reading pupils or changing records', async () => {
  const f = fixture(), before = structuredClone(f.records);
  await assert.rejects(f.context.saveBranchAcademicClassSetup({}, actor, input({ Arms: '' })), /through Academic Management/);
  assert.deepEqual(f.records, before); assert.equal(f.commits.length, 0);
  assert.equal(f.reads.some(name => /Membership|Score|students:/.test(name)), false);
});

test('an active membership blocks deleting its classroom, without touching placements or scores', async () => {
  const f = fixture();
  f.records.academicStudentMemberships.push({ BranchId: 'area-1', SchoolSection: 'primary', Status: 'Active', ArmId: arm.ArmId, ClassId: schoolClass.ClassId, StudentRef: 'PUPIL/1' });
  const before = structuredClone(f.records);
  await assert.rejects(f.context.saveBranchAcademicClassSetup({}, actor, input({ Arms: '' })), /through Academic Management/);
  assert.deepEqual(f.records, before); assert.equal(f.commits.length, 0);
});

test('unassigned imported pupil profiles prevent deletion of the class they still use', async () => {
  const f = fixture();
  f.records.students.push({ AdmissionNo: 'PUPIL/1', ClassName: 'Nursery 2', BranchId: 'area-1', SchoolSection: 'primary', Status: 'Active' });
  await assert.rejects(f.context.saveBranchAcademicClassSetup({}, actor, input({}, { Classes: [], DeletedClassIds: [schoolClass.ClassId] })), /through Academic Management/);
  assert.equal(f.commits.length, 0);
  assert.equal(f.reads.some(name => /Membership|Score|students:/.test(name)), false);
});

test('save requests cannot deactivate a class while it has active classrooms', async () => {
  const f = fixture();
  const before = structuredClone(f.records);
  await assert.rejects(f.context.saveBranchAcademicClassSetup({}, actor, input({ Active: 'NO' })), /through Academic Management/);
  assert.equal(f.commits.length, 0);
  assert.deepEqual(f.records, before);
  assert.equal(f.reads.some(name => /Membership|Score|students:/.test(name)), false);
});

test('web academic class creation writes the same branch guard and never global settings', async () => {
  const f = fixture();
  await f.context.saveAcademicManagementRecord({}, actor, { BranchId: 'area-1', SchoolSection: 'primary', RecordType: 'class', Name: 'Grade 1' });
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].filter(write => write.collectionPath === 'branchSchoolSettings').length, 1);
  assert.equal(f.commits[0].some(write => write.collectionPath.startsWith('settings/')), false);
});

test('ordinary and bulk academic creation reject aliases of an existing class', async () => {
  for (const bulk of [false, true]) {
    const f = fixture();
    const request = { BranchId: 'area-1', SchoolSection: 'primary', RecordType: 'class', Name: 'NURSERY 2', Classes: [{ Name: 'NURSERY 2' }] };
    await assert.rejects(bulk ? f.context.bulkCreateAcademicClasses({}, actor, request)
      : f.context.saveAcademicManagementRecord({}, actor, request), /already exists/);
    assert.equal(f.commits.length, 0);
  }
});

test('a new classroom cannot duplicate an archived reusable arm definition', () => {
  const archived = management.normalizeAcademicArmTemplate({ Name: 'Distinction', Status: 'Archived' }, { branchId: 'area-1', section: 'primary' });
  assert.throws(() => management.planBranchAcademicClassSetup(pureState({ armTemplates: [archived] }), scope, input({ Arms: 'Excellence, Distinction' })), /archived reusable definition/);
});

test('material class renames are rejected in both screens even when identity IDs remain unchanged', async () => {
  for (const settings of [false, true]) {
    const f = fixture();
    f.records.students.push({ AdmissionNo: 'PUPIL/1', ClassName: 'Nursery2', BranchId: 'area-1', SchoolSection: 'primary', Status: 'Active' });
    f.records.feeItems = [{ FeeCode: 'TUITION', ClassName: 'Nursery2', Amount: 90000, BranchId: 'area-1', Active: 'YES' }];
    const before = structuredClone(f.records);
    await assert.rejects(settings
      ? f.context.saveBranchAcademicClassSetup({}, actor, input({ ClassName: 'Reception' }))
      : f.context.saveAcademicManagementRecord({}, actor, { BranchId: 'area-1', SchoolSection: 'primary', RecordType: 'class', RecordId: schoolClass.ClassId, Name: 'Reception', RevisionToken: 'class-v1' }),
    { code: 'ACADEMIC_CLASS_RENAME_REVIEW_REQUIRED' });
    assert.deepEqual(f.records, before); assert.equal(f.commits.length, 0);
    assert.equal(f.reads.includes('feeItems'), false, 'the rejected unsupported migration performs no extra finance reads');
  }
});

test('the same class cannot receive a new arm and be deleted in one request', async () => {
  for (const identifyByName of [false, true]) {
    const f = fixture(), before = structuredClone(f.records);
    await assert.rejects(f.context.saveBranchAcademicClassSetup({}, actor, input({
      ClassId: identifyByName ? '' : schoolClass.ClassId, Arms: 'Excellence, Distinction'
    }, { DeletedClassIds: [schoolClass.ClassId] })), /saved setup and deleted/);
    assert.deepEqual(f.records, before); assert.equal(f.commits.length, 0);
  }
});

test('ordinary Add arm cannot duplicate an active or archived legacy-ID arm', async () => {
  for (const status of ['Active', 'Archived']) {
    const f = fixture();
    f.records.academicArms = [{ ...arm, RecordId: 'historical-arm-id', ArmId: 'historical-arm-id', Name: 'EXCELLENCE', Status: status }];
    const before = structuredClone(f.records);
    await assert.rejects(f.context.saveAcademicManagementRecord({}, actor, {
      BranchId: 'area-1', SchoolSection: 'primary', RecordType: 'arm', ClassId: schoolClass.ClassId, Name: 'Excellence', IsClassroom: true
    }), { code: 'ACADEMIC_ARM_AMBIGUOUS' });
    assert.deepEqual(f.records, before); assert.equal(f.commits.length, 0);
  }
});
