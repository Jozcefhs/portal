import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { prepareImportedStudentWrite } from '../functions/lib/student-profile-import.js';
import { readStudentPlacementGuards } from '../functions/lib/academic-placement-guards.js';

const path = 'schoolBranches/garden/sections/primary/students';
const profile = { BranchId: 'garden', SchoolSection: 'primary', AdmissionNo: 'DCA/1', ClassName: 'Nursery2', ClassArm: 'Merit', Status: 'Active' };
function harness() {
  const docs = new Map(), reads = [], commits = [];
  let version = 0;
  const deps = {
    getDocument: async (_env,p,id) => { reads.push([p,id]); return structuredClone(docs.get(`${p}/${id}`) || null); },
    queryCollectionPages: async (_env,p,o) => { reads.push([p,o]); return [...docs].filter(([key,row]) => key.startsWith(`${p}/`) && o.filters.every(f => f.op === 'in' ? f.value.includes(row[f.field]) : row[f.field] === f.value)).map(([key,row]) => ({ ...structuredClone(row), __id: key.split('/').at(-1) })); },
    batchUpsertDocuments: async (_env, writes) => {
      for (const w of writes) {
        const prior = docs.get(`${w.collectionPath}/${w.documentId}`);
        if ((w.updateTime && w.updateTime !== prior?.__updateTime) || (w.exists === false && prior)) throw Object.assign(new Error('Conflict'), { status: 409 });
      }
      commits.push(structuredClone(writes));
      for (const w of writes) docs.set(`${w.collectionPath}/${w.documentId}`, { ...(w.updateMask ? docs.get(`${w.collectionPath}/${w.documentId}`) : {}), ...structuredClone(w.data), __updateTime: `v${++version}` });
    }
  };
  return { docs, deps, reads, commits };
}

test('generic import keeps shared admission numbers branch-specific and preserves an existing scoped identity', async () => {
  const h = harness();
  h.docs.set('students/DCA-1', { ...profile, BranchId: 'main', SchoolSection: 'secondary', ClassName: 'Grade 7', __updateTime: 'foreign' });
  let plan = await prepareImportedStudentWrite({}, 'DCA-1', profile, h.deps);
  assert.equal(plan.write.collectionPath, path);
  assert.equal(plan.write.exists, false);
  h.docs.set(`${path}/legacy-id`, { ...profile, ParentPhone: 'old', MedicalCondition: 'preserved', __updateTime: 'p1' });
  plan = await prepareImportedStudentWrite({}, 'DCA-1', { ...profile, ParentPhone: 'new' }, h.deps);
  assert.equal(plan.write.documentId, 'legacy-id');
  assert.equal(plan.write.updateTime, 'p1');
  assert.equal(plan.write.data.MedicalCondition, 'preserved');
  assert.equal(plan.placement, null);
});

test('existing status/placement changes and ambiguous copies are blocked; identical retry plans no writes', async () => {
  const h = harness();
  h.docs.set(`${path}/DCA-1`, { ...profile, __updateTime: 'p1' });
  for (const patch of [{ Status: 'Expelled' }, { ClassArm: 'Other' }, { AcademicSession: '2027/2028' }, { AcademicClassId: 'other' }]) {
    await assert.rejects(prepareImportedStudentWrite({}, 'DCA-1', { ...profile, ...patch }, h.deps), { code: 'STUDENT_IMPORT_REVIEW_REQUIRED' });
  }
  assert.deepEqual(await prepareImportedStudentWrite({}, 'DCA-1', { ...profile, UpdatedAt: 'later' }, h.deps), { unchanged: true });
  h.docs.set('students/DCA-1', { ...profile, __updateTime: 'duplicate' });
  await assert.rejects(prepareImportedStudentWrite({}, 'DCA-1', profile, h.deps), { code: 'STUDENT_IMPORT_REVIEW_REQUIRED' });
});

test('generic importer commits profile+destination guards atomically and retries without writes', async () => {
  const h = harness();
  h.docs.set('academicClasses/c', { BranchId: 'garden', SchoolSection: 'primary', ClassId: 'c', Name: 'Nursery2', Status: 'Active', __updateTime: 'c1' });
  h.docs.set('academicArms/a', { BranchId: 'garden', SchoolSection: 'primary', ClassId: 'c', ArmId: 'a', Name: 'Merit', Status: 'Active', __updateTime: 'a1' });
  const source = await readFile(new URL('../functions/api/import-firestore.js', import.meta.url), 'utf8');
  let removeBeforeCommit = false;
  const context = vm.createContext({ Response, Request, console, ...h.deps,
    prepareImportedStudentWrite: (env,id,row) => prepareImportedStudentWrite(env,id,row,h.deps), readStudentPlacementGuards,
    requireFirestoreEnv: () => {}, verifyDesktopCredential: async () => ({ type: 'device' }),
    startRequestMetric: () => ({}), finishRequestMetric: () => {}, readJsonBody: request => request.json(),
    batchUpsertDocuments: async (env,writes) => { if (removeBeforeCommit) h.docs.delete('academicArms/a'); return h.deps.batchUpsertDocuments(env,writes); }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  const call = () => context.onRequestPost({ env: {}, request: new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ collection: 'students', rows: [profile] }) }) });
  removeBeforeCommit = true;
  assert.equal((await (await call()).json()).imported, 0);
  assert.equal(h.docs.has(`${path}/DCA-1`), false);
  h.docs.set('academicArms/a', { BranchId: 'garden', SchoolSection: 'primary', ClassId: 'c', ArmId: 'a', Name: 'Merit', Status: 'Active', __updateTime: 'a2' });
  removeBeforeCommit = false;
  assert.equal((await (await call()).json()).imported, 1);
  assert.equal(h.commits[0].length, 3);
  assert.equal((await (await call()).json()).imported, 1);
  assert.equal(h.commits.length, 1);
});

test('metadata optimization masks profile fields and fences stale revisions without restoring old status or placement', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const writes = [], row = { ...profile, __id: 'p', __scopePath: path, __updateTime: 'p1', ParentEmail: 'P@Example.org' };
  const context = vm.createContext({ requireAccountingRole: () => {}, listCollection: async () => [],
    listSchoolCollection: async (_env,collection) => collection === 'students' ? [row] : [],
    clean: value => String(value ?? '').trim(), lower: value => String(value ?? '').trim().toLowerCase(), nowIso: () => 'now',
    batchUpsertDocuments: async (_env,batch) => writes.push(...batch)
  });
  vm.runInContext(source.slice(source.indexOf('async function optimizeFirestoreData('), source.indexOf('async function getSystemHealth(')), context);
  await context.optimizeFirestoreData({}, {});
  assert.equal(writes.length, 1);
  assert.equal(writes[0].updateTime, 'p1');
  assert.deepEqual([...writes[0].updateMask], ['ParentEmailNormalized', 'OptimizationVersion', 'OptimizedAt']);
  assert.equal(writes[0].data.Status, undefined);
  assert.equal(writes[0].data.ClassName, undefined);
  Object.assign(row, writes[0].data); writes.length = 0;
  await context.optimizeFirestoreData({}, {});
  assert.equal(writes.length, 0);
});
