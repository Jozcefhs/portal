import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { studentLoginCredentialId, studentLoginCredentialCollection, hashStudentPassword } from '../functions/lib/student-login-credentials.js';
import { studentFaceTemplateDocumentId } from '../functions/lib/student-face-templates.js';
import { academicCbtAllStudentRefs } from '../functions/lib/academic-cbt-late-entry.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const endpoint = source.slice(source.indexOf('export async function prepareLocalCbtIdentityPackage('),
  source.indexOf('export async function syncLocalCbtStudentPasswords(')).replace('export ', '');
async function fixture(count = 3) {
  const refs = Array.from({ length: count }, (_, i) => `DCA/${i + 1}`);
  const testRecord = { CbtTestId: 'math', SessionId: 's', TermId: 't', ClassId: 'grade7', SubjectId: 'math',
    AssessmentComponentId: 'ca1', AssessmentComponentName: 'CA1', TeacherUsername: 'teacher', Status: 'Scheduled',
    StudentRefs: refs.slice(0, -1), AdditionalStudentRefs: refs.slice(-1) };
  const verifier = await hashStudentPassword('ChosenPass8');
  const credentials = new Map(await Promise.all(refs.map(async ref => [await studentLoginCredentialId(ref),
    { ...verifier, StudentRef: ref, Active: true, PasswordChangedAt: '2026-10-20T10:00:00Z' }])));
  const reads = [], envelopes = [];
  let unavailable = false, forbidden = false;
  const scope = { branchId: 'main', section: 'secondary' };
  const ctx = vm.createContext({ Set, Map, Date, Promise, Number, studentLoginCredentialId,
    studentLoginCredentialCollection, studentFaceTemplateDocumentId, academicCbtAllStudentRefs,
    clean: v => String(v ?? '').trim(), lower: v => String(v ?? '').trim().toLowerCase(),
    failure: (message, status, code) => Object.assign(new Error(message), { status, code }),
    requireWritableSubscription: () => {},
    academicOperationalContext: async (_env, _user, input, permission) => {
      assert.equal(permission, 'canCreateCbt');
      assert.equal(input.BranchId, 'main');
      return { scope, state: { cbtTests: [testRecord] }, session: { SessionId: 's' }, term: { TermId: 't' } };
    },
    academicCbtClassContext: async () => ({ scope, roster: refs.map(StudentRef => ({ StudentRef })),
      scheme: { Components: [{ Id: 'ca1', SourceMode: 'built-in-cbt' }] }, allocation: { TeacherUsername: 'teacher' } }),
    academicCbtAuthority: () => { if (forbidden) throw Object.assign(new Error('Wrong teacher or scope'), { status: 403 }); },
    findById: (rows, id) => rows.find(row => row.CbtTestId === id),
    scopedCollectionPath: (name, branch, section) => `schoolBranches/${branch}/sections/${section}/${name}`,
    listSchoolCollection: async () => refs.map(StudentRef => ({ StudentRef, BranchId: 'main', SchoolSection: 'secondary', DisplayName: StudentRef })),
    safeScopeId: v => v, schoolSectionFor: s => s.SchoolSection, studentReference: s => s.StudentRef,
    getDocuments: async (_env, collection, ids) => {
      reads.push({ collection, ids: Array.from(ids) });
      if (unavailable) throw new Error('Database temporarily unavailable');
      return ids.map(id => credentials.get(id) || null);
    },
    listCollection: () => { throw new Error('Never scan whole login collections'); },
    STUDENT_FACE_MODEL_ID: 'face-model', nowIso: () => '2026-10-21T10:00:00Z',
    encryptLocalCbtIdentityPackage: async (_key, value, aad) => { envelopes.push({ value, aad }); return { Ciphertext: 'encrypted' }; }
  });
  vm.runInContext(endpoint, ctx);
  return { refs, reads, envelopes, testRecord,
    failRead: () => { unavailable = true; }, forbid: () => { forbidden = true; },
    request: (patch = {}) => ctx.prepareLocalCbtIdentityPackage({ DYNAMAX_WORKSPACE_ID: 'school' }, {}, {
      BranchId: 'main', SchoolSection: 'secondary', SessionId: 's', TermId: 't', CbtTestId: 'math',
      ClassId: 'grade7', SubjectId: 'math', AssessmentComponentId: 'ca1', StudentRefs: refs,
      PublicKeyPem: 'public-key', ...patch
    }) };
}

test('both centres receive all saved candidates and reviewed additions with current password versions', async () => {
  const f = await fixture(350);
  for (const ServerId of ['centre-one', 'centre-two']) {
    const response = await f.request({ ServerId });
    assert.equal(response.summary.Packaged, 350);
    assert.equal(response.summary.PasswordReady, 350);
    assert.equal(response.summary.Missing.length, 0);
    assert.deepEqual(Object.keys(response.envelope), ['Ciphertext']);
  }
  assert.deepEqual(f.envelopes[0], f.envelopes[1]);
  assert.deepEqual(Array.from(f.envelopes[0].value.Identities, row => row.StudentRef), f.refs);
  assert.ok(f.envelopes[0].value.Identities.every(row => row.PasswordChangedAt === '2026-10-20T10:00:00Z'));
  assert.equal(f.reads.length, 4);
  assert.ok(f.reads.every(read => read.ids.length === 350));
});

test('login read failure is explicit, not an empty password package', async () => {
  const f = await fixture(); f.failRead();
  await assert.rejects(f.request(), /temporarily unavailable/);
  assert.equal(f.envelopes.length, 0);
});

test('test-scoped identity download retains authority, subject, period and candidate boundaries', async () => {
  for (const patch of [{ StudentRefs: ['OTHER'] }, { SubjectId: 'english' }, { ClassId: 'grade12' }, { AssessmentComponentId: 'ca2' }]) {
    const f = await fixture();
    await assert.rejects(f.request(patch), { code: 'ACADEMIC_CBT_ROSTER_FORBIDDEN' });
    assert.equal(f.reads.length, 0);
  }
  for (const patch of [{ Status: 'Superseded' }, { TermId: 'other-term' }, { SessionId: 'other-session' }]) {
    const f = await fixture(); Object.assign(f.testRecord, patch);
    await assert.rejects(f.request(), { code: 'ACADEMIC_CBT_TEST_NOT_FOUND' });
  }
  const f = await fixture(); f.forbid();
  await assert.rejects(f.request(), { status: 403 });
  assert.equal(f.reads.length, 0);
});

test('legacy clients without a test ID continue to use the current eligible class roster', async () => {
  const f = await fixture();
  assert.equal((await f.request({ CbtTestId: '' })).summary.Packaged, 3);
  await assert.rejects(f.request({ CbtTestId: '', StudentRefs: ['OTHER'] }), { code: 'ACADEMIC_CBT_ROSTER_FORBIDDEN' });
});
