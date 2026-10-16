import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { admissionYearIntakePlan, admissionYearIntakeFingerprint } from '../functions/lib/student-intake-bulk.js';
import { schoolSectionFor } from '../functions/lib/school-scope.js';
import { securityAuditAction } from '../functions/lib/security-audit.js';

const source = (await readFile(new URL('../functions/api/staff-students.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace('export async function onRequestPost', 'async function onRequestPost');
const actor = { username: 'reviewer', displayName: 'Intake reviewer', role: 'Super Admin', edition: 'school',
  branchId: 'main', schoolSectionAccess: 'All', allowedSections: ['students', 'accounts'] };
const student = (n = 1, extra = {}) => ({ __id: `s${n}`, __updateTime: 'revision-1',
  __scopePath: 'schoolBranches/main/sections/secondary/students', AdmissionNo: `DCA/26/${n}`,
  BranchId: 'main', SchoolSection: 'secondary', ClassName: 'Grade 8', EnrollmentCategory: 'Returning',
  AcademicSession: '2026/2027', Term: 'First Term', AcademicProgress: 'Repeating', ...extra });

test('request audit labels distinguish preview from applying the all-class intake correction', () => {
  const label = action => securityAuditAction({ pathname: '/api/staff-students', method: 'POST', body: { action } });
  assert.match(label('previewIntakeCorrection'), /^Preview first term intake classification across all classes by admission year$/i);
  assert.match(label('applyIntakeCorrection'), /^Mark matching first term students as new intake across all classes$/i);
});

function fixture(rows = [student()], user = actor, failCommit = false) {
  let records = structuredClone(rows);
  const writes = [], reads = [];
  const handler = vm.runInNewContext(`${source}\nonRequestPost`, {
    Response, crypto, Date, TextEncoder,
    requireFirestoreEnv: () => {}, requireStaffSession: async () => user,
    readJsonBody: request => request.json(), admissionYearIntakePlan, admissionYearIntakeFingerprint, schoolSectionFor,
    listSchoolCollection: async (_env, collection, scope) => { reads.push({ collection, scope }); return records; },
    batchCommitDocuments: async (_env, batch) => {
      if (failCommit) throw Object.assign(new Error('Concurrent change; review again.'), { status: 409 });
      writes.push(...structuredClone(batch));
      for (const entry of batch.filter(item => item.collectionPath !== 'staffRecordsAudit')) {
        const record = records.find(item => item.__id === entry.documentId && item.__scopePath === entry.collectionPath);
        assert.equal(entry.updateTime, record.__updateTime);
        Object.assign(record, entry.data, { __updateTime: 'revision-2' });
      }
    }
  });
  return { writes, reads, records, async call(action, extra = {}) {
    const response = await handler({ env: {}, request: { json: async () => ({ action, AcademicSession: '2026/2027', ...extra }) } });
    return { status: response.status, noStore: response.headers.get('Cache-Control'), data: await response.json() };
  } };
}

test('preview/apply covers every class and section, preserves finances, and repeat apply is a no-op', async () => {
  const f = fixture([student(), student(2, { ClassName: 'Primary 5', SchoolSection: 'primary', __scopePath: 'schoolBranches/main/sections/primary/students' }),
    student(3, { AdmissionNo: 'DCA/25/3' }), student(4, { BranchId: 'annex' }), student(5, { Term: 'Second Term' })]);
  const preview = await f.call('previewIntakeCorrection');
  assert.equal(preview.status, 200);
  assert.equal(preview.noStore, 'no-store');
  assert.equal(preview.data.toChange, 2);
  assert.equal(f.writes.length, 0);
  const applied = await f.call('applyIntakeCorrection', { PreviewToken: preview.data.previewToken });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.updated, 2);
  assert.equal(applied.data.remaining, 0);
  assert.equal(f.writes.length, 4);
  const audits = f.writes.filter(item => item.collectionPath === 'staffRecordsAudit');
  assert.equal(audits.length, 2);
  for (const audit of audits) {
    assert.equal(audit.exists, false);
    assert.match(audit.data.Summary, /First Term 2026\/2027/);
    assert.equal(audit.data.ActorUsername, 'reviewer');
    assert.equal(audit.data.Before.EnrollmentCategory, 'Returning');
    assert.equal(audit.data.After.EnrollmentCategory, 'New Intake');
  }
  for (const write of f.writes.filter(item => item.collectionPath !== 'staffRecordsAudit')) {
    assert.deepEqual(write.updateMask, ['EnrollmentCategory', 'IntakeCorrectedAt', 'IntakeCorrectedBy']);
    assert.equal(write.updateTime, 'revision-1');
  }
  assert.ok(f.records.every(item => item.AcademicProgress === 'Repeating'));
  assert.equal(f.records[2].EnrollmentCategory, 'Returning');
  assert.equal((await f.call('applyIntakeCorrection', { PreviewToken: preview.data.previewToken })).data.updated, 0);
  assert.equal(f.writes.length, 4);
});

test('permission, edition, branch, read-only and old cached Grade 7 requests fail closed', async () => {
  for (const overrides of [{ role: 'Teacher' }, { edition: 'church' }, { branchId: '' }, { branchId: 'all' },
    { subscriptionReadOnly: true }, { allowedSections: ['students'] }, { allowedSections: ['accounts'] }]) {
    const f = fixture([student()], { ...actor, ...overrides });
    assert.ok([400, 403].includes((await f.call('applyIntakeCorrection')).status));
    assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  assert.equal((await f.call('applyGrade7Intake')).status, 409);
  assert.equal((await f.call('previewGrade7Intake')).status, 409);
  assert.equal(f.reads.length, 0);
});

test('section access, stale previews, missing revisions and database races cannot bypass guards', async () => {
  const f = fixture([student(), student(2, { SchoolSection: 'primary', ClassName: 'Primary 5' })], { ...actor, schoolSectionAccess: 'primary' });
  assert.equal((await f.call('previewIntakeCorrection')).data.toChange, 1);
  assert.equal((await f.call('applyIntakeCorrection', { PreviewToken: 'stale' })).status, 409);
  assert.equal(f.writes.length, 0);
  for (const broken of ['__id', '__scopePath', '__updateTime']) {
    const invalid = fixture([student(1, { [broken]: '' })]);
    const preview = await invalid.call('previewIntakeCorrection');
    assert.equal(preview.data.missingRevision, 1);
    assert.equal((await invalid.call('applyIntakeCorrection', { PreviewToken: preview.data.previewToken })).status, 409);
    assert.equal(invalid.writes.length, 0);
  }
  const race = fixture([student()], actor, true);
  const preview = await race.call('previewIntakeCorrection');
  assert.equal((await race.call('applyIntakeCorrection', { PreviewToken: preview.data.previewToken })).status, 409);
  assert.equal(race.writes.length, 0);
});

test('large corrections use bounded atomic batches and a fresh preview before continuing', async () => {
  const f = fixture(Array.from({ length: 103 }, (_, index) => student(index + 1)));
  const first = await f.call('previewIntakeCorrection');
  assert.equal((await f.call('applyIntakeCorrection', { PreviewToken: first.data.previewToken })).data.remaining, 3);
  assert.equal(f.writes.length, 200);
  assert.equal((await f.call('applyIntakeCorrection', { PreviewToken: first.data.previewToken })).status, 409);
  const second = await f.call('previewIntakeCorrection');
  assert.equal((await f.call('applyIntakeCorrection', { PreviewToken: second.data.previewToken })).data.updated, 3);
  assert.equal(f.writes.length, 206);
});
