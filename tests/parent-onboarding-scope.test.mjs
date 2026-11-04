import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as onboarding from '../functions/lib/parent-onboarding.js';
import * as auth from '../functions/lib/parent-auth.js';
import { schoolSectionFor } from '../functions/lib/school-scope.js';

const env = { FIREBASE_PROJECT_ID: 'synthetic-school', DYNAMAX_WORKSPACE_ID: 'synthetic-workspace',
  ORGANISATION_EDITION: 'school', PARENT_SESSION_SECRET: 'synthetic-only-secret-not-production' };
const admissionNo = 'DCA/26/001';
const path = branch => `schoolBranches/${branch}/sections/primary/students`;
const id = 'DCA-26-001';
const tokenFrom = link => new URLSearchParams(link.split('#')[1]).get('access');

async function fixture() {
  const docs = new Map(), reads = [], commits = []; let revision = 0;
  const put = (collection, docId, data) => docs.set(`${collection}/${docId}`, structuredClone({ ...data, __id: docId, __updateTime: `v${++revision}` }));
  const getDocument = async (_env, collection, docId) => {
    reads.push(`${collection}/${docId}`);
    return structuredClone(docs.get(`${collection}/${docId}`) || null);
  };
  const commit = async (_env, writes) => {
    for (const w of writes) {
      const current = docs.get(`${w.collectionPath}/${w.documentId}`);
      if (w.exists === false && current || w.updateTime && current?.__updateTime !== w.updateTime) {
        throw Object.assign(new Error('Revision conflict'), { status: 412 });
      }
    }
    commits.push(structuredClone(writes));
    for (const w of writes) put(w.collectionPath, w.documentId,
      w.updateMask ? { ...docs.get(`${w.collectionPath}/${w.documentId}`), ...w.data } : w.data);
  };
  const options = { getDocument, commit };
  for (const branch of ['main', 'garden']) put(path(branch), id, {
    AdmissionNo: admissionNo, BranchId: branch, SchoolSection: 'primary', FirstName: branch,
    ParentEmail: `${branch}@example.test`, ParentOnboardingStatus: 'PendingProfile', Scores: [81, 94],
    DateOfBirth: '2018-02-03', ClassName: 'Grade 2', CustomRecord: { keep: true }
  });
  const row = (branch = 'garden', scope = path(branch)) => ({ ...structuredClone(docs.get(`${scope}/${id}`)), __scopePath: scope });
  const issue = async (branch = 'garden') => onboarding.issueParentOnboarding(env, row(branch), 'School staff', options);
  const link = await issue();
  const token = tokenFrom(link.onboardingPath);
  return { docs, reads, commits, put, row, issue, link, token, options, getDocument, commit };
}

test('same school code and admission number resolve only the signed branch with one exact read and no writes', async () => {
  const f = await fixture(); f.reads.length = 0; const count = f.commits.length;
  const row = await onboarding.requireParentOnboardingStudent(env, { admissionNo, onboardingToken: f.token }, f.options);
  assert.equal(row.BranchId, 'garden'); assert.equal(row.FirstName, 'garden');
  assert.deepEqual(f.reads, [`${path('garden')}/${id}`]); assert.equal(f.commits.length, count);
  assert.ok(!JSON.stringify(f.docs.get(`${path('garden')}/${id}`)).includes(f.token));
});

test('the common temporary password, missing proof, changed admission and tampered tokens reveal nothing and read no learners', async () => {
  const f = await fixture(); f.reads.length = 0;
  for (const body of [{ admissionNo, temporaryPassword: '12345678' }, {},
    { admissionNo: 'DCA/26/999', onboardingToken: f.token },
    { admissionNo, onboardingToken: `x${f.token}` }]) {
    await assert.rejects(onboarding.requireParentOnboardingStudent(env, body, f.options), { status: 401 });
  }
  assert.deepEqual(f.reads, []);
});

test('a token cannot be reused in a different project, workspace or edition', async () => {
  const f = await fixture(); f.reads.length = 0;
  for (const field of ['FIREBASE_PROJECT_ID', 'DYNAMAX_WORKSPACE_ID', 'ORGANISATION_EDITION']) {
    await assert.rejects(onboarding.requireParentOnboardingStudent({ ...env, [field]: 'another' }, { onboardingToken: f.token }, f.options), { status: 401 });
  }
  assert.deepEqual(f.reads, []);
});

test('expired, replaced and completed links are refused; scores and unrelated fields remain intact on reissue', async () => {
  const f = await fixture(), original = f.row();
  const next = await f.issue();
  await assert.rejects(onboarding.requireParentOnboardingStudent(env, { onboardingToken: f.token }, f.options), { status: 401 });
  assert.deepEqual(f.row().Scores, original.Scores); assert.deepEqual(f.row().CustomRecord, original.CustomRecord);
  const nextToken = tokenFrom(next.onboardingPath);
  f.put(path('garden'), id, { ...f.row(), ParentOnboardingExpiresAt: '2000-01-01' });
  await assert.rejects(onboarding.requireParentOnboardingStudent(env, { onboardingToken: nextToken }, f.options), { status: 401 });
  const expired = await auth.createParentOnboardingToken(env, onboarding.parentOnboardingIdentity(f.row()), '2000-01-01');
  f.reads.length = 0;
  await assert.rejects(onboarding.requireParentOnboardingStudent(env, { onboardingToken: expired }, f.options), { status: 401 });
  assert.deepEqual(f.reads, []);
});

test('a missing, moved or inconsistent learner never falls back to another branch with the same admission number', async () => {
  for (const mode of ['missing', 'branch', 'section', 'admission']) {
    const f = await fixture();
    if (mode === 'missing') f.docs.delete(`${path('garden')}/${id}`);
    else f.put(path('garden'), id, { ...f.row(), ...{ branch: { BranchId: 'main' }, section: { SchoolSection: 'secondary' }, admission: { AdmissionNo: 'other' } }[mode] });
    f.reads.length = 0;
    await assert.rejects(onboarding.requireParentOnboardingStudent(env, { onboardingToken: f.token }, f.options), { status: 401 });
    assert.deepEqual(f.reads, [`${path('garden')}/${id}`]);
  }
});

test('primary and secondary sections can share an admission number without crossing identities', async () => {
  const f = await fixture(), secondaryPath = 'schoolBranches/garden/sections/secondary/students';
  f.put(secondaryPath, id, { ...f.row(), SchoolSection: 'secondary', FirstName: 'Secondary learner' });
  const link = await onboarding.issueParentOnboarding(env, f.row('garden', secondaryPath), 'Staff', f.options);
  const found = await onboarding.requireParentOnboardingStudent(env, { onboardingToken: tokenFrom(link.onboardingPath) }, f.options);
  assert.equal(found.FirstName, 'Secondary learner'); assert.equal(found.__scopePath, secondaryPath);
  assert.equal(f.row().FirstName, 'garden');
});

test('legacy root profiles stay bound to their explicit branch and literal document ID', async () => {
  const f = await fixture(); f.put('students', 'legacy%20id', { ...f.row(), AdmissionNo: 'DCA/LEGACY' });
  const row = { ...f.docs.get('students/legacy%20id'), __scopePath: 'students' };
  const link = await onboarding.issueParentOnboarding(env, row, 'Staff', f.options);
  f.reads.length = 0;
  const found = await onboarding.requireParentOnboardingStudent(env, { onboardingToken: tokenFrom(link.onboardingPath) }, f.options);
  assert.equal(found.__id, 'legacy%20id'); assert.deepEqual(f.reads, ['students/legacy%20id']);
});

test('staff link issuance requires the selected row and authorized branch/section; no first matching admission fallback', async () => {
  const f = await fixture(), user = { branchId: 'garden', schoolSectionAccess: 'primary', allowedSections: ['students'], username: 'staff' };
  const body = { AccountRef: admissionNo, ScopePath: path('garden'), DocumentId: id };
  const count = f.commits.length; f.reads.length = 0;
  for (const b of [{ AccountRef: admissionNo }, { ...body, ScopePath: path('main') }, { ...body, ScopePath: 'parentCredentials' }]) {
    await assert.rejects(onboarding.issueStaffParentOnboarding(env, user, b, f.options));
  }
  assert.equal(f.commits.length, count); assert.deepEqual(f.reads, []);
  await assert.rejects(onboarding.issueStaffParentOnboarding(env, { ...user, subscriptionReadOnly: true }, body, f.options), { status: 403 });
  const issued = await onboarding.issueStaffParentOnboarding(env, user, body, f.options);
  assert.equal(issued.admissionNo, admissionNo); assert.equal(f.commits.length, count + 1);
  assert.deepEqual(f.commits.at(-1)[0].updateMask.sort(), Object.keys(f.commits.at(-1)[0].data).sort());
});

test('desktop reissue binds the selected document and directs obsolete shared-link clients to the web without reads', async () => {
  const f = await fixture();
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('async function reissueParentOnboarding'), source.indexOf('async function promoteStudents'));
  let actorReads = 0;
  const context = vm.createContext({
    clean: value => String(value ?? '').trim(),
    desktopSchoolOperationsActor: async () => { actorReads++; return { username: 'staff', branchId: 'garden', schoolSectionAccess: 'all', allowedSections: ['students'] }; },
    schoolOperationsScope: () => ({ branchId: 'garden', schoolSectionAccess: 'primary' }),
    issueStaffParentOnboarding: (e, user, body) => onboarding.issueStaffParentOnboarding(e, user, body, f.options)
  });
  vm.runInContext(handler, context);
  f.reads.length = 0; const writes = f.commits.length;
  await assert.rejects(context.reissueParentOnboarding(env, { AccountRef: admissionNo }), /web companion/);
  assert.equal(actorReads, 0); assert.equal(f.reads.length, 0); assert.equal(f.commits.length, writes);
  const issued = await context.reissueParentOnboarding(env, { AccountRef: admissionNo, ScopePath: path('garden'), DocumentId: id });
  const found = await onboarding.requireParentOnboardingStudent(env, { onboardingToken: tokenFrom(issued.onboardingPath) }, f.options);
  assert.equal(found.BranchId, 'garden'); assert.equal(found.SchoolSection, 'primary');
  assert.equal(f.commits.length, writes + 1);
  await assert.rejects(context.reissueParentOnboarding(env, { AccountRef: admissionNo, ScopePath: path('main'), DocumentId: id }), { status: 403 });
  assert.equal(f.commits.length, writes + 1);
});

test('read failures and stale reissues fail closed without replacing another learner or writing a token', async () => {
  const f = await fixture(), count = f.commits.length;
  await assert.rejects(onboarding.requireParentOnboardingStudent(env, { onboardingToken: f.token }, {
    getDocument: async () => { throw Error('Database unavailable'); }
  }), /unavailable/);
  const stale = f.row(); f.put(path('garden'), id, { ...stale, FirstName: 'New name' });
  await assert.rejects(onboarding.issueParentOnboarding(env, stale, 'staff', f.options), { status: 412 });
  assert.equal(f.commits.length, count);
});

test('first password and completion are atomic, scoped, single-use and preserve the other branch', async () => {
  const f = await fixture(), other = f.row('main');
  f.put(path('garden'), id, { ...f.row(), ParentOnboardingStatus: 'AwaitingPassword' });
  const step = await onboarding.parentOnboardingPasswordStep(env, f.row());
  const body = { passwordSetupToken: step.passwordSetupToken, newPassword: 'PrivateFamilyPass9', confirmPassword: 'PrivateFamilyPass9' };
  const results = await Promise.allSettled([onboarding.finishParentOnboardingPassword(env, body, f.options), onboarding.finishParentOnboardingPassword(env, body, f.options)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.row().ParentOnboardingStatus, 'Complete'); assert.equal(f.row().ParentOnboardingTokenHash, '');
  assert.deepEqual(f.row('main'), other); assert.deepEqual(f.row().Scores, [81, 94]);
  const credential = f.docs.get('parentCredentials/garden@example.test');
  assert.equal(await auth.verifyParentPasswordHash(credential, 'PrivateFamilyPass9'), true);
  assert.equal(f.commits.filter(w => w.some(i => i.collectionPath === 'parentCredentials')).length, 1);
  await assert.rejects(onboarding.finishParentOnboardingPassword(env, body, f.options), { status: 401 });
  await assert.rejects(onboarding.requireParentOnboardingStudent(env, { onboardingToken: f.token }, f.options), { status: 401 });
});

test('existing parent credentials cannot be overwritten by onboarding, including after a lost response', async () => {
  const f = await fixture(); f.put(path('garden'), id, { ...f.row(), ParentOnboardingStatus: 'AwaitingPassword' });
  const step = await onboarding.parentOnboardingPasswordStep(env, f.row());
  f.put('parentCredentials', 'garden@example.test', { Email: 'garden@example.test', ...await auth.hashParentPassword('ExistingPass9') });
  const before = f.row();
  await assert.rejects(onboarding.finishParentOnboardingPassword(env, { passwordSetupToken: step.passwordSetupToken, newPassword: 'DifferentPass9', confirmPassword: 'DifferentPass9' }, f.options), { status: 409 });
  assert.deepEqual(f.row(), before);
  assert.equal(await auth.verifyParentPasswordHash(f.docs.get('parentCredentials/garden@example.test'), 'ExistingPass9'), true);
});

test('password setup rejects old scopeless tokens, rotated links and forged scope before changing credentials', async () => {
  const f = await fixture(); f.put(path('garden'), id, { ...f.row(), ParentOnboardingStatus: 'AwaitingPassword' });
  const oldToken = await auth.createParentPasswordSetupToken(env, 'garden@example.test', admissionNo);
  assert.equal(await auth.readParentPasswordSetupToken(env, oldToken), null);
  const step = await onboarding.parentOnboardingPasswordStep(env, f.row()); await f.issue();
  await assert.rejects(onboarding.finishParentOnboardingPassword(env, { passwordSetupToken: step.passwordSetupToken, newPassword: 'PrivateFamilyPass9', confirmPassword: 'PrivateFamilyPass9' }, f.options), { status: 401 });
  assert.equal(f.docs.has('parentCredentials/garden@example.test'), false);
});

test('public onboarding endpoints preserve branch identity through profile save and first password creation', async () => {
  const f = await fixture();
  const source = (await readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '')
    .replace(/^export \{[^}]+\} from [^;]+;\r?$/gm, '').replace(/^export /gm, '');
  const api = vm.createContext({ console, crypto, Date, Response, Headers, TextEncoder, URL,
    readJsonBody: r => r.json(), consumeRequestAllowance: async () => ({ allowed: true }),
    onboardingStatus: onboarding.onboardingStatus, schoolSectionFor,
    requireParentOnboardingStudent: (e, b, o) => onboarding.requireParentOnboardingStudent(e, b, { ...f.options, ...o }),
    parentOnboardingPasswordStep: onboarding.parentOnboardingPasswordStep,
    finishParentOnboardingPassword: (e, b) => onboarding.finishParentOnboardingPassword(e, b, f.options),
    getDocument: f.getDocument, getParentCredential: (_e, email) => f.getDocument(env, 'parentCredentials', email),
    formatPersonName: v => `${v.FirstName} ${v.Surname}`, effectiveBranchProfile: () => ({}),
    batchCommitLiteralDocuments: f.commit,
    parentSessionCookie: auth.parentSessionCookie,
    createParentSession: (e, email, o) => auth.createParentSession(e, email, { ...o, getCredential: () => f.getDocument(e, 'parentCredentials', email) })
  });
  vm.runInContext(source, api);
  const post = body => api.onRequestPost({ env, request: new Request('https://school.test/api/parent-dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const other = f.row('main');
  let response = await post({ action: 'beginParentOnboarding', admissionNo, temporaryPassword: '12345678' });
  assert.equal(response.status, 401);
  response = await post({ action: 'beginParentOnboarding', admissionNo, onboardingToken: f.token });
  assert.equal(response.status, 200); assert.equal((await response.json()).student.firstName, 'garden');
  const body = { action: 'completeParentOnboardingProfile', onboardingToken: f.token, admissionNo,
    BranchId: 'main', ScopePath: path('main'), profile: { firstName: 'Garden', surname: 'Learner', gender: 'Female', dateOfBirth: '2018-02-03', studentType: 'Day Student', parentName: 'Parent', parentEmail: 'garden@example.test', confirmParentEmail: 'garden@example.test', parentPhone: '0000', residentialAddress: 'Synthetic test address', emergencyContactName: 'Parent', emergencyContactPhone: '0000', BranchId: 'main' } };
  response = await post(body); const setup = await response.json();
  assert.equal(response.status, 200, JSON.stringify(setup)); assert.equal(setup.passwordChangeRequired, true);
  assert.equal(f.row().BranchId, 'garden'); assert.deepEqual(f.row('main'), other);
  assert.equal((await post(body)).status, 401);
  const resume = await post({ action: 'beginParentOnboarding', admissionNo, onboardingToken: f.token });
  assert.equal((await resume.json()).passwordChangeRequired, true);
  response = await post({ action: 'completeParentPasswordSetup', passwordSetupToken: setup.passwordSetupToken, newPassword: 'PrivatePass9', confirmPassword: 'PrivatePass9' });
  assert.equal(response.status, 200); assert.match(response.headers.get('Set-Cookie'), /HttpOnly/);
  assert.equal((await response.json()).credentialEpoch, undefined);
  assert.deepEqual(f.row('main'), other); assert.deepEqual(f.row().Scores, [81, 94]);
});
