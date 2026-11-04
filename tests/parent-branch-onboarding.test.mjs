import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as branch from '../functions/lib/parent-branch-onboarding.js';
import * as onboarding from '../functions/lib/parent-onboarding.js';
import * as auth from '../functions/lib/parent-auth.js';
import { schoolSectionFor } from '../functions/lib/school-scope.js';

const env = { FIREBASE_PROJECT_ID: 'synthetic-school', DYNAMAX_WORKSPACE_ID: 'synthetic-workspace',
  ORGANISATION_EDITION: 'school', PARENT_SESSION_SECRET: 'synthetic-not-production-secret' };
const admissionNo = 'DCA/26/001', id = 'DCA-26-001';
const path = (name = 'garden', section = 'primary') => `schoolBranches/${name}/sections/${section}/students`;
const user = { branchId: 'garden', branchName: 'Garden Primary', schoolSectionAccess: 'all',
  allowedSections: ['students'], edition: 'school', username: 'staff', role: 'Super Admin' };
const tokenFrom = link => new URLSearchParams(link.split('#')[1]).get('branchAccess');

async function fixture() {
  const docs = new Map(), reads = [], queries = [], commits = []; let revision = 0;
  const put = (collection, docId, data) => docs.set(`${collection}/${docId}`,
    structuredClone({ ...data, __id: docId, __updateTime: `v${++revision}` }));
  const getDocument = async (_env, collection, docId) => {
    reads.push(`${collection}/${docId}`);
    return structuredClone(docs.get(`${collection}/${docId}`) || null);
  };
  const queryCollection = async (_env, collection, options) => {
    queries.push({ collection, ...options });
    return [...docs.entries()].filter(([key, row]) => key.slice(0, key.lastIndexOf('/')) === collection
      && options.filters.every(filter => row[filter.field] === filter.value))
      .slice(0, options.limit).map(([, row]) => structuredClone(row));
  };
  const commit = async (_env, writes) => {
    for (const write of writes) {
      const row = docs.get(`${write.collectionPath}/${write.documentId}`);
      if (write.exists === false && row || write.updateTime && row?.__updateTime !== write.updateTime) {
        throw Object.assign(new Error('Revision conflict'), { status: 412 });
      }
    }
    commits.push(structuredClone(writes));
    for (const write of writes) put(write.collectionPath, write.documentId,
      write.updateMask ? { ...docs.get(`${write.collectionPath}/${write.documentId}`), ...write.data } : write.data);
  };
  const options = { getDocument, queryCollection, commit };
  for (const name of ['garden', 'main']) put(path(name), id, { AdmissionNo: admissionNo, BranchId: name,
    SchoolSection: 'primary', FirstName: name, Surname: 'Learner', DisplayName: `${name} Learner`,
    ProfileCompletionStatus: 'Needs completion', ParentOnboardingStatus: 'PendingProfile',
    ClassName: 'Grade 2', DateOfBirth: '2018-02-03', NIN: '00000000000', MedicalCondition: 'Private test value',
    Scores: [81, 94], Payments: [{ amount: 1200 }], CustomRecord: { keep: true } });
  const row = (name = 'garden') => structuredClone(docs.get(`${path(name)}/${id}`));
  const issue = () => branch.issueStaffBranchParentOnboarding(env, user, {}, options);
  const issued = await issue();
  const body = { admissionNo, branchInviteToken: tokenFrom(issued.onboardingPath), setupCode: issued.setupCode };
  return { docs, put, reads, queries, commits, options, row, issue, issued, body, getDocument, commit };
}

test('branch link issuance writes only one scoped invitation and a secret-free audit, not learners', async () => {
  const f = await fixture();
  assert.match(f.issued.setupCode, /^\d{10}$/);
  assert.equal(f.issued.branchId, 'garden'); assert.deepEqual(f.issued.schoolSections, ['primary', 'secondary']);
  assert.deepEqual(f.commits[0].map(w => w.collectionPath), ['parentBranchInvites', 'staffRecordsAudit']);
  assert.deepEqual(f.queries, []);
  const persisted = JSON.stringify(f.commits[0]);
  assert.ok(!persisted.includes(f.issued.setupCode)); assert.ok(!persisted.includes(f.body.branchInviteToken));
  assert.ok(!JSON.stringify(f.commits[0][1]).includes('Hash'));
});

test('matching admission numbers never cross the signed branch; begin is bounded and read-only', async () => {
  const f = await fixture(), count = f.commits.length;
  const result = await branch.beginBranchParentOnboarding(env, { ...f.body, BranchId: 'main' }, f.options);
  assert.equal(result.student.firstName, 'garden'); assert.equal(result.student.branchName, 'Garden Primary');
  assert.equal(f.commits.length, count);
  assert.deepEqual(f.queries.map(q => q.collection), [path(), path('garden', 'secondary'), 'students']);
  assert.ok(f.queries.every(q => q.limit === 10 && q.filters[0].value === admissionNo));
  for (const privateKey of ['dateOfBirth', 'studentNin', 'medicalCondition', 'parentEmail', 'parentPhone', 'residentialAddress']) {
    assert.equal(result.student[privateKey], undefined);
  }
  const claim = await branch.requireBranchParentOnboardingClaim(env, { branchClaimToken: result.branchClaimToken }, f.options);
  assert.equal(claim.student.BranchId, 'garden'); assert.equal(claim.replay, false);
});

test('wrong code, bad signature, altered purpose and foreign tenant cannot query learners', async () => {
  const f = await fixture();
  for (const body of [{ ...f.body, setupCode: '12345678' }, { ...f.body, branchInviteToken: `x${f.body.branchInviteToken}` },
    { ...f.body, branchInviteToken: '' }, { ...f.body, schoolSection: 'another' }]) {
    await assert.rejects(branch.beginBranchParentOnboarding(env, body, f.options), { status: 401 });
  }
  for (const key of ['FIREBASE_PROJECT_ID', 'DYNAMAX_WORKSPACE_ID', 'ORGANISATION_EDITION']) {
    await assert.rejects(branch.beginBranchParentOnboarding({ ...env, [key]: 'another' }, f.body, f.options), { status: 401 });
  }
  assert.deepEqual(f.queries, []);
  assert.equal(await auth.readParentOnboardingToken(env, f.body.branchInviteToken), null);
  const personal = await auth.createParentOnboardingToken(env, { branchId: 'garden' }, f.issued.expiresAt);
  await assert.rejects(branch.beginBranchParentOnboarding(env, { ...f.body, branchInviteToken: personal }, f.options), { status: 401 });
});

test('branch rotation invalidates old shared invitations and outstanding claims', async () => {
  const f = await fixture();
  const first = await branch.beginBranchParentOnboarding(env, f.body, f.options);
  await f.issue();
  await assert.rejects(branch.beginBranchParentOnboarding(env, f.body, f.options), { status: 401 });
  await assert.rejects(branch.requireBranchParentOnboardingClaim(env, { branchClaimToken: first.branchClaimToken }, f.options), { status: 401 });
  assert.deepEqual(f.row().Scores, [81, 94]);
});

test('legacy root lookup checks explicit branch and missing branch belongs to main only', async () => {
  const f = await fixture(); f.docs.delete(`${path()}/${id}`);
  f.put('students', 'main-root', { ...f.row('main'), __id: 'main-root', BranchId: undefined });
  await assert.rejects(branch.beginBranchParentOnboarding(env, f.body, f.options), { status: 401 });
  f.put('students', 'garden-root', { ...f.row('main'), BranchId: 'garden', FirstName: 'Garden legacy' });
  const result = await branch.beginBranchParentOnboarding(env, f.body, f.options);
  assert.equal(result.student.firstName, 'Garden legacy');
  const claim = await branch.requireBranchParentOnboardingClaim(env, { branchClaimToken: result.branchClaimToken }, f.options);
  assert.equal(claim.student.__scopePath, 'students'); assert.equal(claim.student.__id, 'garden-root');
});

test('same-branch duplicate identity fails closed; an allowed section may narrow but never broaden', async () => {
  const f = await fixture();
  f.put(path('garden', 'secondary'), id, { ...f.row(), SchoolSection: 'secondary', ClassName: 'Grade 8' });
  await assert.rejects(branch.beginBranchParentOnboarding(env, f.body, f.options), { status: 409 });
  assert.equal((await branch.beginBranchParentOnboarding(env, { ...f.body, schoolSection: 'primary' }, f.options)).student.className, 'Grade 2');
  const issued = await branch.issueStaffBranchParentOnboarding(env, { ...user, schoolSectionAccess: 'primary' }, {}, f.options);
  await assert.rejects(branch.beginBranchParentOnboarding(env, { ...f.body, branchInviteToken: tokenFrom(issued.onboardingPath), setupCode: issued.setupCode, schoolSection: 'secondary' }, f.options), { status: 401 });
  f.put('students', 'same-branch-copy', f.row());
  await assert.rejects(branch.beginBranchParentOnboarding(env, { ...f.body, schoolSection: 'primary' }, f.options), { status: 409 });
});

test('truncated root result and database failure cannot return partial identity', async () => {
  const f = await fixture();
  for (let i = 0; i < 10; i++) f.put('students', `other-${i}`, { ...f.row(), BranchId: 'another' });
  await assert.rejects(branch.beginBranchParentOnboarding(env, f.body, f.options), { status: 401 });
  await assert.rejects(branch.beginBranchParentOnboarding(env, f.body, { ...f.options,
    queryCollection: async () => { throw Error('Database unavailable'); } }), /Database unavailable/);
});

test('inconsistent stored branch or section cannot override the path or claim scope', async () => {
  for (const patch of [{ BranchId: 'main' }, { SchoolSection: 'secondary' }]) {
    const f = await fixture(); f.put(path(), id, { ...f.row(), ...patch });
    await assert.rejects(branch.beginBranchParentOnboarding(env, f.body, f.options), { status: 401 });
  }
  const f = await fixture();
  const began = await branch.beginBranchParentOnboarding(env, f.body, f.options);
  f.put(path(), id, { ...f.row(), BranchId: 'main' });
  await assert.rejects(branch.requireBranchParentOnboardingClaim(env, { branchClaimToken: began.branchClaimToken }, f.options), { status: 401 });
});

test('expired signed invitations and claims fail before learner reads', async () => {
  const f = await fixture();
  const original = await auth.readParentBranchOnboardingToken(env, f.body.branchInviteToken);
  const expired = await auth.createParentBranchOnboardingToken(env, original, '2000-01-01');
  f.reads.length = 0;
  await assert.rejects(branch.beginBranchParentOnboarding(env, { ...f.body, branchInviteToken: expired }, f.options), { status: 401 });
  assert.deepEqual(f.reads, []); assert.deepEqual(f.queries, []);
  const began = await branch.beginBranchParentOnboarding(env, f.body, f.options);
  const claim = await auth.readParentBranchOnboardingToken(env, began.branchClaimToken, true);
  const expiredClaim = await auth.createParentBranchOnboardingToken(env, claim, '2000-01-01', true);
  f.reads.length = 0;
  await assert.rejects(branch.requireBranchParentOnboardingClaim(env, { branchClaimToken: expiredClaim }, f.options), { status: 401 });
  assert.deepEqual(f.reads, []);
});

test('a main-branch invitation may use a missing-branch legacy row without selecting another branch', async () => {
  const f = await fixture(); f.docs.delete(`${path('main')}/${id}`);
  f.put('students', 'old-main', { ...f.row(), BranchId: undefined, FirstName: 'Legacy main' });
  f.put('students', 'old-garden', { ...f.row(), FirstName: 'Legacy garden' });
  const issued = await branch.issueStaffBranchParentOnboarding(env, { ...user, branchId: 'main', branchName: 'Main Branch' }, {}, f.options);
  const result = await branch.beginBranchParentOnboarding(env, { ...f.body,
    branchInviteToken: tokenFrom(issued.onboardingPath), setupCode: issued.setupCode }, f.options);
  assert.equal(result.student.firstName, 'Legacy main');
  assert.equal(result.student.branchName, 'Main Branch');
});

test('every established parent linkage, completed profile and claimed learner is excluded from group setup', () => {
  const base = { ParentOnboardingStatus: 'PendingProfile', ProfileCompletionStatus: 'Needs completion' };
  assert.equal(branch.branchOnboardingEligible(base), true);
  for (const key of ['ParentEmail', 'VerificationEmail', 'Email', 'FatherEmail', 'MotherEmail', 'GuardianEmail', 'parentEmail', 'guardianemail']) {
    assert.equal(branch.branchOnboardingEligible({ ...base, [key]: 'saved@example.test' }), false, key);
  }
  for (const patch of [{ ParentOnboardingStatus: 'AwaitingPassword' }, { ParentOnboardingStatus: 'Complete' },
    { ParentOnboardingProfileCompletedAt: '2026-11-01' }, { ParentOnboardingCompletedAt: '2026-11-01' }, { ProfileCompletionStatus: 'Complete' },
    { ApplicationReference: 'existing-application' }, { applicationId: 'existing-application' }, { ParentEmails: ['linked@example.test'] }]) {
    assert.equal(branch.branchOnboardingEligible({ ...base, ...patch }), false);
  }
});

test('staff issuance rejects all-branch, unsupported scope, read-only and non-school accounts before database reads', async () => {
  const f = await fixture(); f.reads.length = 0;
  for (const change of [{ branchId: '' }, { branchId: '*' }, { branchId: 'all' }, { schoolSectionAccess: 'another' },
    { edition: 'faith' }, { allowedSections: [] }, { subscriptionReadOnly: true }]) {
    await assert.rejects(branch.issueStaffBranchParentOnboarding(env, { ...user, ...change }, {}, f.options), { status: 403 });
  }
  assert.deepEqual(f.reads, []);
});

async function publicApi(f) {
  const source = (await readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '')
    .replace(/^export \{[^}]+\} from [^;]+;\r?$/gm, '').replace(/^export /gm, '');
  const api = vm.createContext({ console, crypto, Date, Response, Headers, TextEncoder, URL,
    readJsonBody: request => request.json(), consumeRequestAllowance: async () => ({ allowed: true }),
    onboardingStatus: onboarding.onboardingStatus, schoolSectionFor,
    beginBranchParentOnboarding: (e, body) => branch.beginBranchParentOnboarding(e, body, f.options),
    requireBranchParentOnboardingClaim: (e, body) => branch.requireBranchParentOnboardingClaim(e, body, f.options),
    requireParentOnboardingStudent: (e, body) => onboarding.requireParentOnboardingStudent(e, body, f.options),
    parentOnboardingPasswordStep: onboarding.parentOnboardingPasswordStep,
    finishParentOnboardingPassword: (e, body) => onboarding.finishParentOnboardingPassword(e, body, f.options),
    getDocument: f.getDocument, getParentCredential: (_e, email) => f.getDocument(env, 'parentCredentials', email),
    effectiveBranchProfile: () => ({}), batchCommitLiteralDocuments: f.commit,
    parentSessionCookie: auth.parentSessionCookie,
    createParentSession: (e, email, o) => auth.createParentSession(e, email, { ...o, getCredential: () => f.getDocument(e, 'parentCredentials', email) })
  });
  vm.runInContext(source, api);
  return body => api.onRequestPost({ env, request: new Request('https://school.test/api/parent-dashboard', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
}

const profile = { firstName: 'Garden', surname: 'Learner', gender: 'Female', dateOfBirth: '2018-02-03',
  studentType: 'Day Student', parentName: 'Test Parent', parentEmail: 'new@example.test', confirmParentEmail: 'new@example.test',
  parentPhone: '0000', residentialAddress: 'Synthetic address', emergencyContactName: 'Parent', emergencyContactPhone: '0000' };

test('public flow completes only signed learner, preserves records and optional private fields, and retries without duplicate writes', async () => {
  const f = await fixture(), post = await publicApi(f), other = f.row('main');
  const response = await post({ action: 'beginBranchParentOnboarding', ...f.body });
  assert.equal(response.status, 200); const began = await response.json();
  const request = { action: 'completeParentOnboardingProfile', admissionNo, branchClaimToken: began.branchClaimToken,
    BranchId: 'main', ScopePath: path('main'), profile: { ...profile, BranchId: 'main' } };
  const results = await Promise.all([post(request), post(request)]);
  assert.equal(results.filter(item => item.status === 200).length, 1);
  assert.equal(results.filter(item => item.status === 409).length, 1);
  const setup = await results.find(item => item.status === 200).json();
  assert.equal(setup.passwordChangeRequired, true); assert.equal(f.row().ParentOnboardingStatus, 'AwaitingPassword');
  assert.deepEqual(f.row('main'), other); assert.deepEqual(f.row().Scores, [81, 94]);
  assert.deepEqual(f.row().Payments, [{ amount: 1200 }]); assert.deepEqual(f.row().CustomRecord, { keep: true });
  assert.equal(f.row().NIN, '00000000000'); assert.equal(f.row().MedicalCondition, 'Private test value');
  const count = f.commits.length;
  const replay = await post(request); assert.equal(replay.status, 200); assert.equal((await replay.json()).passwordChangeRequired, true);
  assert.equal(f.commits.length, count);
  assert.equal((await post({ action: 'beginBranchParentOnboarding', ...f.body })).status, 401);
  const password = await post({ action: 'completeParentPasswordSetup', passwordSetupToken: setup.passwordSetupToken,
    newPassword: 'NewPrivatePassword9', confirmPassword: 'NewPrivatePassword9' });
  assert.equal(password.status, 200); assert.equal(f.row().ParentOnboardingStatus, 'Complete');
  assert.equal(await auth.verifyParentPasswordHash(f.docs.get('parentCredentials/new@example.test'), 'NewPrivatePassword9'), true);
  assert.deepEqual(f.row('main'), other);
  assert.equal((await post({ action: 'beginBranchParentOnboarding', ...f.body })).status, 401);
});

test('changed learner revisions and different claims cannot overwrite a parent claim; existing credentials remain intact', async () => {
  const f = await fixture(), post = await publicApi(f);
  const began = await branch.beginBranchParentOnboarding(env, f.body, f.options);
  const second = await branch.beginBranchParentOnboarding(env, f.body, f.options);
  f.put('parentCredentials', 'new@example.test', { Email: 'new@example.test', ...await auth.hashParentPassword('ExistingPrivate9') });
  const request = { action: 'completeParentOnboardingProfile', branchClaimToken: began.branchClaimToken, admissionNo, profile };
  assert.equal((await post(request)).status, 200);
  assert.equal(f.row().ParentOnboardingStatus, 'Complete');
  assert.equal((await post({ ...request, branchClaimToken: second.branchClaimToken })).status, 401);
  assert.equal(await auth.verifyParentPasswordHash(f.docs.get('parentCredentials/new@example.test'), 'ExistingPrivate9'), true);
  const secondFixture = await fixture();
  const original = await branch.beginBranchParentOnboarding(env, secondFixture.body, secondFixture.options);
  secondFixture.put(path(), id, { ...secondFixture.row(), FirstName: 'Staff updated' });
  await assert.rejects(branch.requireBranchParentOnboardingClaim(env, { branchClaimToken: original.branchClaimToken }, secondFixture.options), { status: 401 });
});
