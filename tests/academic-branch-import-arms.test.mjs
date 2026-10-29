import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as management from '../functions/lib/academic-management.js';
import * as outcomes from '../functions/lib/academic-session-outcomes.js';
import * as studentStatus from '../functions/lib/student-academic-status.js';
import * as schoolScope from '../functions/lib/school-scope.js';
import * as branchScope from '../functions/lib/branch-scope.js';
import { normalizeClassKey } from '../functions/lib/class-names.js';
import { formatPersonName } from '../functions/lib/person-name-format.js';
import { checkClassroomRemovals } from '../functions/lib/academic-classroom-removal.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const branch = 'garden-primary', section = 'primary';
const actor = { role: 'Super Admin', username: 'test-admin', edition: 'school', branchId: 'all', schoolSectionAccess: 'All', allowedSections: ['academics'] };
const scope = { BranchId: branch, SchoolSection: section };
const period = { SessionId: 'session', TermId: 'term' };
const reference = 'TEST/25/0204';
const profilePath = schoolScope.scopedCollectionPath('students', branch, section);
const template = (overrides = {}) => ({ ...scope, Name: 'Excellence', Code: 'EXC', Status: 'Active', DefaultCapacity: 35,
  RecordId: 'legacy-excellence', ArmTemplateId: 'legacy-excellence', __updateTime: 'v1', ...overrides });

function harness() {
  const store = new Map(), reads = [], writes = [];
  const seed = (collection, row) => { const rows = store.get(collection) || []; rows.push(clone(row)); store.set(collection, rows); };
  const rows = collection => store.get(collection) || [];
  const query = async (_env, collection, options) => {
    reads.push({ collection, options: clone(options) });
    assert.ok(options.filters.some(f => f.field === 'BranchId' && f.value === branch), 'academic reads are branch scoped');
    return clone(rows(collection).filter(row => options.filters.every(f => row[f.field] === f.value)));
  };
  for (const [key, row] of Object.entries({
    sessions: { ...scope, RecordId: 'session', SessionId: 'session', Name: '2026/2027', Status: 'Active' },
    terms: { ...scope, ...period, RecordId: 'term', Name: 'First Term', Status: 'Active' },
    classes: { ...scope, RecordId: 'class', ClassId: 'class', Code: 'GR1', Name: 'Grade 1', SchoolStage: 'primary', Status: 'Active' },
    arms: { ...scope, RecordId: 'arm', ArmId: 'arm', ClassId: 'class', Code: 'EXC', Name: 'Excellence', IsClassroom: true, Status: 'Active' }
  })) seed(management.ACADEMIC_MANAGEMENT_COLLECTIONS[key], row);
  const foreign = { AdmissionNo: reference, __id: 'TEST-25-0204', BranchId: 'main', SchoolSection: 'secondary',
    DisplayName: 'Different pupil', GuardianEmail: 'private@example.invalid', ParentAccountId: 'private-parent', ClassName: 'Grade 9', Status: 'Active' };
  seed('schoolBranches/main/sections/secondary/students', foreign);
  seed('academicStudentScores', { RecordId: 'preserved-score', BranchId: 'main', StudentRef: reference, Score: 91 });
  const context = vm.createContext({ ...management, ...outcomes, ...studentStatus, ...schoolScope, ...branchScope,
    normalizeClassKey, formatPersonName, checkClassroomRemovals, crypto: webcrypto, TextEncoder, TextDecoder,
    getSchoolStructure: async () => ({ ActiveBranchId: 'main', Branches: [{ Id: 'main' }, { Id: branch }], Sections: ['primary', 'secondary'] }),
    loadOrganizationNameProfile: async () => ({}), queryCollection: query, queryCollectionPages: query,
    listSchoolCollection: async (_env, collection, options) => {
      assert.equal(collection, 'students');
      assert.equal(options?.branchId, branch, 'never read the organisation-wide pupil register');
      assert.equal(options?.schoolSectionAccess, section);
      reads.push({ collection: profilePath });
      return clone(rows(profilePath).map(row => ({ ...row, __scopePath: profilePath })));
    },
    batchCommitDocuments: async (_env, batch) => {
      for (const write of batch) {
        const previous = rows(write.collectionPath).find(r => (r.RecordId || r.__id) === write.documentId);
        if ((write.exists === false && previous) || (write.updateTime && write.updateTime !== previous?.__updateTime)) {
          throw Object.assign(new Error('Concurrent write'), { status: 409 });
        }
      }
      for (const write of batch) {
        const list = rows(write.collectionPath), index = list.findIndex(r => (r.RecordId || r.__id) === write.documentId);
        assert.equal(write.data?.BranchId || list[index]?.BranchId, branch, 'never mutate a foreign branch');
        if (write.operation === 'delete') { list.splice(index, 1); continue; }
        const next = { ...clone(write.data), __id: write.documentId, __updateTime: 'v2' };
        if (index < 0) seed(write.collectionPath, next); else list[index] = next;
      }
      writes.push(...clone(batch));
    }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  context.bootstrapAcademicManagement = async () => ({ ok: true });
  return { context, reads, writes, store, seed, rows, foreign,
    import: (patch = {}) => context.bulkImportAcademicStudentMemberships({}, actor, { ...scope, ...period,
      Rows: [{ StudentRef: reference, FirstName: 'Primary', Surname: 'Pupil', ClassCode: 'GR1', ArmCode: 'EXC' }], ...patch }),
    create: (patch = {}) => context.bulkCreateAcademicArmTemplates({}, actor, { ...scope, ArmTemplateLines: 'Excellence | EXC | 0', ...patch }),
    apply: () => context.bulkApplyAcademicArmTemplates({}, actor, { ...scope, ClassIds: ['class'], ArmTemplateIds: ['legacy-excellence'] })
  };
}

test('CSV import isolates the same admission reference by branch and section, preserves foreign records and is retry-safe', async () => {
  const h = harness();
  h.seed('schoolBranches/garden-primary/sections/secondary/students', { ...h.foreign, BranchId: branch });
  const before = clone([...h.store.entries()]);
  const first = await h.import();
  assert.equal(first.importResult.Imported, 1);
  const profile = h.rows(profilePath)[0];
  assert.equal(profile.FirstName, 'Primary');
  assert.equal(profile.GuardianEmail, undefined);
  assert.equal(profile.ParentAccountId, undefined);
  assert.equal(profile.ProfileCompletionStatus, 'Needs completion');
  assert.equal(profile.ParentOnboardingStatus, 'PendingProfile');
  assert.equal(h.rows('academicStudentMemberships').length, 1);
  for (const [path, original] of before.filter(([p]) => p.includes('sections/secondary') || p === 'academicStudentScores')) {
    assert.deepEqual(h.rows(path), original);
  }
  const count = h.writes.length;
  assert.equal((await h.import()).importResult.Skipped, 1);
  assert.equal(h.writes.length, count, 'retry must not duplicate profiles, memberships, movement history or audits');
});

test('CSV import retains document-name collision and duplicate-row checks within its selected scope', async () => {
  const h = harness();
  h.seed(profilePath, { ...scope, __id: 'TEST-25-0204', AdmissionNo: 'TEST-25-0204', Status: 'Active' });
  await assert.rejects(h.import(), { code: 'ACADEMIC_IMPORT_STUDENT_ID_CONFLICT' });
  assert.equal(h.writes.length, 0);
  const other = harness(), row = { StudentRef: reference, FirstName: 'Pupil', Surname: 'Test', ClassCode: 'GR1' };
  await assert.rejects(other.import({ Rows: [row, row] }), /appears more than once/);
  assert.equal(other.writes.length, 0, 'invalid batch must not partially create pupils');
});

test('another branch or section cannot block creating Excellence in the selected branch', async () => {
  const h = harness();
  h.seed('academicArmTemplates', template({ BranchId: 'main', SchoolSection: 'secondary' }));
  h.seed('academicArmTemplates', template({ SchoolSection: 'secondary', RecordId: 'other-section', ArmTemplateId: 'other-section' }));
  assert.equal((await h.create()).bulkResult.Created, 1);
  assert.equal(h.rows('academicArmTemplates').length, 3);
  assert.ok(h.rows('academicArmTemplates').some(row => row.ArmTemplateId === 'arm-template__garden-primary__primary__exc'));
  const writes = h.writes.length;
  assert.equal((await h.create()).bulkResult.Skipped, 1);
  assert.equal(h.writes.length, writes);
});

test('existing Excellence is reusable despite a different proposed capacity or legacy ID, with no new writes', async () => {
  const h = harness(), original = template();
  h.seed('academicArmTemplates', original);
  const result = await h.create();
  assert.equal(result.bulkResult.Created, 0);
  assert.equal(result.bulkResult.Skipped, 1);
  assert.match(result.message, /Apply arms to classes/);
  const single = await h.context.saveAcademicManagementRecord({}, actor, { ...scope,
    RecordType: 'armTemplate', Name: 'Excellence', Code: 'EXC', DefaultCapacity: 0 });
  assert.match(single.message, /saved settings were kept/);
  assert.deepEqual(h.rows('academicArmTemplates'), [original]);
  assert.equal(h.writes.length, 0);
});

test('conflicting codes, inactive definitions and ambiguous duplicates require explicit review rather than overwrites', async () => {
  const h = harness(); h.seed('academicArmTemplates', template());
  await assert.rejects(h.create({ ArmTemplateLines: 'Excellence | OTHER | 35' }), { code: 'ACADEMIC_BULK_ARM_TEMPLATE_CONFLICT' });
  h.rows('academicArmTemplates')[0].Status = 'Inactive';
  await assert.rejects(h.create(), { code: 'ACADEMIC_ARM_TEMPLATE_INACTIVE' });
  h.seed('academicArmTemplates', template({ RecordId: 'second', ArmTemplateId: 'second' }));
  await assert.rejects(h.create(), { code: 'ACADEMIC_ARM_TEMPLATE_AMBIGUOUS' });
  assert.equal(h.writes.length, 0);
});

test('renamed identifiers and uppercase names match the current Excellence definition without confusing it with Merit', async () => {
  const h = harness();
  h.seed('academicArmTemplates', template({ Name: 'EXCELLENCE', DefaultCapacity: 25,
    RecordId: 'arm-template__garden-primary__primary__dis', ArmTemplateId: 'arm-template__garden-primary__primary__dis' }));
  h.seed('academicArmTemplates', template({ Name: 'MERIT', Code: 'MER', DefaultCapacity: 28,
    RecordId: 'arm-template__garden-primary__primary__exc', ArmTemplateId: 'arm-template__garden-primary__primary__exc' }));
  const before = clone(h.rows('academicArmTemplates'));
  assert.equal((await h.create()).bulkResult.Skipped, 1);
  const single = await h.context.saveAcademicManagementRecord({}, actor, { ...scope,
    RecordType: 'armTemplate', Name: 'Excellence', Code: 'EXC', DefaultCapacity: 0 });
  assert.match(single.message, /saved settings were kept/);
  assert.deepEqual(h.rows('academicArmTemplates'), before);
  assert.equal(h.writes.length, 0);
});

test('creating a genuinely new definition when its generated ID belongs to a renamed arm preserves both and retries safely', async () => {
  const h = harness();
  const original = template({ Name: 'MERIT', Code: 'MER', RecordId: 'arm-template__garden-primary__primary__exc',
    ArmTemplateId: 'arm-template__garden-primary__primary__exc' });
  h.seed('academicArmTemplates', original);
  assert.equal((await h.create()).bulkResult.Created, 1);
  const definitions = h.rows('academicArmTemplates');
  assert.deepEqual(definitions[0], original);
  assert.equal(definitions[1].ArmTemplateId, 'arm-template__garden-primary__primary__exc__2');
  const writes = h.writes.length;
  assert.equal((await h.create()).bulkResult.Skipped, 1);
  assert.equal(h.writes.length, writes);
});

test('applying Excellence reuses its existing classroom, including a legacy arm ID, without changing its saved settings', async () => {
  const h = harness(); h.seed('academicArmTemplates', template());
  const original = clone(h.rows('academicArms'));
  const result = await h.apply();
  assert.equal(result.bulkResult.Created, 0);
  assert.equal(result.bulkResult.Skipped, 1);
  assert.deepEqual(h.rows('academicArms'), original);
  assert.equal(h.writes.length, 0);
});

test('Delete permanently removes the unused definition and immediately frees its name and code without touching historical scores', async () => {
  const h = harness(); h.seed('academicArmTemplates', template());
  h.rows('academicArms').length = 0;
  const historicalScores = clone(h.rows('academicStudentScores'));
  const result = await h.context.deleteAcademicManagementRecord({}, actor, { ...scope,
    RecordType: 'armTemplate', RecordId: 'legacy-excellence', RevisionToken: 'v1' });
  assert.match(result.message, /deleted permanently/);
  assert.equal(h.rows('academicArmTemplates').length, 0, 'no archived/inactive catalogue copy remains');
  assert.equal((await h.create()).bulkResult.Created, 1);
  assert.equal(h.rows('academicArmTemplates').length, 1);
  assert.equal(h.rows('academicArmTemplates')[0].DefaultCapacity, 0, 'new setup uses newly requested settings');
  assert.deepEqual(h.rows('academicStudentScores'), historicalScores);
});
