import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { recoverStaffSecurity } from '../functions/lib/staff-security-recovery.js';
import { credentialStateId } from '../functions/lib/staff-credential-state.js';
import { hashStaffPassword } from '../functions/lib/staff-auth.js';
import { evaluateStaffMfaRequirement, totpCodeForSecret } from '../functions/lib/staff-mfa.js';
import { assignedStaffBranches } from '../functions/lib/staff-branch-access.js';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const unmodule = source => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');
const sources = Object.fromEntries(await Promise.all(['staff-credential-state', 'staff-auth', 'staff-mfa'].map(async name => [name, await read(`functions/lib/${name}.js`)])));
const passkeySource = await read('functions/api/staff-passkey.js'), apiSource = await read('functions/api/staff-mfa.js');
const clone = value => value == null ? null : structuredClone(value);
const actor = { username: 'owner', loginUsername: 'owner-login', displayName: 'Owner', role: 'Super Admin', edition: 'school', BranchAccess: 'all', canSwitchBranches: true, branchId: 'main' };
const body = { targetUsername: 'teacher', currentPassword: 'admin-secret', reason: 'Lost phone', operationId: 'recovery-operation-0001' };

async function fixture() {
  const env = { FIREBASE_PROJECT_ID: 'fixture', STAFF_SESSION_SECRET: 'test-secret-only', ADMIN_WEB_USERNAME: 'admin' };
  const docs = new Map(), batches = [], reads = [], hooks = {}; let version = 0;
  const put = (collection, id, data) => docs.set(`${collection}/${id}`, { ...clone(data), __id: id, __updateTime: `v${++version}` });
  const original = { Username: 'teacher', UsernameKey: 'teacher', LoginUsername: 'teacher-login', LoginUsernameKey: 'teacher-login', Active: true,
    Role: 'Teacher', BranchId: 'main', OrganisationEdition: 'school', TabAccess: ['academics'], ApprovalEnabled: false, PasswordSetupRequired: '', ...await hashStaffPassword('staff-secret') };
  put('staffUsers', 'legacy%2F teacher', original);
  put('staffPasskeys', 'phone', { Username: 'teacher', UsernameKey: 'teacher', CredentialId: 'phone-key', PublicKey: 'AQI', Counter: 0, Active: true });
  put('staffMfaProfiles', 'teacher', { Username: 'teacher', UsernameKey: 'teacher', TotpActive: true, TotpCiphertext: 'encrypted', TotpIv: 'iv', RecoveryCodeHashes: ['hash'], PendingTotpCiphertext: 'pending', PendingTotpIv: 'pending-iv', PendingTotpExpiresAt: '2099-01-01' });
  put('settings', 'staffMfaPolicy', { Mode: 'OPTIONAL', RequiredRoles: [] }); put('invoices', 'history', { Amount: 12345 });
  const db = {
    getDocument: async (_env, collection, id) => { reads.push(`${collection}/${id}`); return clone(docs.get(`${collection}/${id}`)); },
    queryCollectionPages: async (_env, collection, options) => { reads.push(`${collection}:query`); return [...docs.entries()].filter(([key, row]) => key.startsWith(`${collection}/`) && options.filters.some(filter => row[filter.field] === filter.value)).map(([, row]) => clone(row)); },
    batchCommitLiteralDocuments: async (_env, writes) => {
      if (hooks.beforeCommit) await hooks.beforeCommit(writes);
      for (const w of writes) { const old = docs.get(`${w.collectionPath}/${w.documentId}`); if (w.exists === false && old || w.updateTime && old?.__updateTime !== w.updateTime) throw Object.assign(new Error('Concurrent write'), { status: 412 }); }
      batches.push(clone(writes));
      for (const w of writes) put(w.collectionPath, w.documentId, w.updateMask ? { ...docs.get(`${w.collectionPath}/${w.documentId}`), ...clone(w.data) } : w.data);
      if (hooks.afterCommit) await hooks.afterCommit(writes);
    },
    verifyStaffApprovalPassword: async (_env, username, password) => username === 'owner' && password === 'admin-secret'
  };
  db.queryCollection = db.queryCollectionPages;
  db.findOneByField = async (_env, collection, field, value) => clone([...docs.entries()].find(([key, row]) => key.startsWith(`${collection}/`) && row[field] === value)?.[1]);
  db.deleteDocumentIfCurrent = async (_env, collection, id, current) => { if (docs.get(`${collection}/${id}`)?.__updateTime !== current.__updateTime) throw Object.assign(new Error('Conflict'), { status: 412 }); docs.delete(`${collection}/${id}`); };
  db.patchDocumentFieldsIfCurrent = async (_env, collection, id, data, current) => {
    await db.batchCommitLiteralDocuments(env, [{ collectionPath: collection, documentId: id, data, updateMask: Object.keys(data), updateTime: current.__updateTime }]);
    if (hooks.afterUsage && collection === 'staffPasskeys') await hooks.afterUsage();
  };
  db.upsertDocument = async (_env, collection, id, data) => put(collection, id, data);
  db.patchDocumentFields = async (_env, collection, id, data) => put(collection, id, { ...docs.get(`${collection}/${id}`), ...data });
  const common = { crypto, Date, TextEncoder, TextDecoder, Uint8Array, btoa, atob, Response, Request, Headers, URL, console, assignedStaffBranches, ...db };
  const epoch = vm.createContext(common); vm.runInContext(unmodule(sources['staff-credential-state']), epoch);
  const auth = vm.createContext({ ...common, staffCredentialEpochCurrent: epoch.staffCredentialEpochCurrent, requisitionEditGrant: () => false, externalAuditAccessExpired: () => false });
  vm.runInContext(unmodule(sources['staff-auth']), auth);
  auth.findStaffUserRecord = async () => clone(docs.get('staffUsers/legacy%2F teacher')); auth.loadStaffProfileImage = async () => ({}); auth.staffUserForRequest = async (_env, user) => user;
  const mfa = vm.createContext({ ...common, staffCredentialEpochCurrent: epoch.staffCredentialEpochCurrent, staffCredentialWriteGuard: epoch.staffCredentialWriteGuard,
    QRCode: { create: () => ({ modules: { size: 1, get: () => false } }) }, verifyStaffApprovalPassword: async () => true, recoverStaffSecurity,
    requireStaffSession: async () => ({ username: 'teacher', authEpoch: '' }) });
  vm.runInContext(unmodule(sources['staff-mfa']), mfa);
  const passkeys = vm.createContext({ ...common, credentialStateId, staffCredentialWriteGuard: epoch.staffCredentialWriteGuard,
    requireStaffSession: async () => ({ username: 'teacher', authEpoch: '' }),
    verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { newCounter: 1 } }),
    verifyRegistrationResponse: async () => ({ verified: true, registrationInfo: { credential: { id: 'new-key', publicKey: new Uint8Array([1, 2]), counter: 0 } } }),
    authenticateStaffPasskey: auth.authenticateStaffPasskey, staffAccessFor: async () => ({}), createStaffSession: auth.createStaffSession, staffSessionCookie: auth.staffSessionCookie });
  vm.runInContext(unmodule(passkeySource), passkeys);
  const reset = (input = {}, user = actor) => recoverStaffSecurity(env, user, { ...body, ...input }, db);
  return { env, docs, put, original, batches, reads, hooks, db, epoch, auth, mfa, passkeys, reset };
}

test('recovery atomically revokes factors, sessions and approval proofs, preserving password, permissions and business history', async () => {
  const f = await fixture(), old = await f.auth.createStaffSession(f.env, { username: 'teacher', role: 'Teacher' });
  const proof = await f.auth.createStaffApprovalProof(f.env, { username: 'teacher' }); const result = await f.reset();
  assert.equal(result.revokedPasskeys, 1); assert.equal(result.sessionsRevoked, true); assert.equal(result.reEnrollmentRequired, false); assert.equal(f.batches.length, 1);
  const target = f.docs.get('staffUsers/legacy%2F teacher');
  for (const key of ['PasswordHash', 'Salt', 'Username', 'LoginUsername', 'Role', 'TabAccess', 'ApprovalEnabled']) assert.deepEqual(target[key], f.original[key]);
  assert.equal(f.docs.get('staffPasskeys/phone').Active, false); const profile = f.docs.get('staffMfaProfiles/teacher');
  assert.equal(profile.TotpActive, false); assert.equal(profile.TotpCiphertext, ''); assert.deepEqual(profile.RecoveryCodeHashes, []); assert.equal(profile.PendingTotpCiphertext, '');
  assert.equal(f.docs.get('invoices/history').Amount, 12345); assert.ok(f.reads.every(path => !path.startsWith('invoices')));
  assert.equal(await f.auth.readStaffSession(f.env, new Request('https://fixture.test', { headers: { Authorization: `Bearer ${old}` } })), null);
  assert.equal(await f.auth.readStaffApprovalProof(f.env, new Request('https://fixture.test', { headers: { 'X-DIGC-Approval-Proof': proof } }), 'teacher'), false);
  const token = await f.auth.createStaffSession(f.env, target);
  assert.equal((await f.auth.readStaffSession(f.env, new Request('https://fixture.test', { headers: { Authorization: `Bearer ${token}` } }))).username, 'teacher');
});

test('required MFA and mandatory auditor protection still require replacement enrollment after password verification', async () => {
  for (const [mode, role] of [['REQUIRED_ALL', 'Teacher'], ['OPTIONAL', 'External Auditor']]) {
    const f = await fixture(); f.put('settings', 'staffMfaPolicy', { Mode: mode }); f.docs.get('staffUsers/legacy%2F teacher').Role = role;
    assert.equal((await f.reset()).reEnrollmentRequired, true);
    assert.equal(evaluateStaffMfaRequirement({ Mode: mode }, f.docs.get('staffMfaProfiles/teacher'), 0, { role }).enrollmentRequired, true);
  }
});

test('lost-response replay returns one result before factor reads and preserves newly enrolled replacement methods', async () => {
  const f = await fixture(); let lost = true;
  f.hooks.afterCommit = async () => { if (lost) { lost = false; throw new Error('Response lost'); } }; await assert.rejects(f.reset(), /Response lost/);
  f.put('staffPasskeys', 'replacement', { Username: 'teacher', UsernameKey: 'teacher', Active: true }); f.reads.length = 0;
  const result = await f.reset(); assert.equal(result.alreadyCompleted, true); assert.equal(result.replay, true);
  assert.equal(f.docs.get('staffPasskeys/replacement').Active, true); assert.equal(f.batches.length, 1);
  assert.equal(f.reads.some(path => path.startsWith('staffPasskeys') || path.startsWith('staffMfaProfiles')), false);
  assert.equal([...f.docs.keys()].filter(key => key.startsWith('staffSecurityAudit/')).length, 1);
  await assert.rejects(f.reset({ reason: 'Different reason' }), /already used/);
});

test('roles, subscriptions, canonical self aliases, invalid targets and conflicting ownership reject without writes', async () => {
  for (const [input, user, configure] of [
    [{}, { ...actor, role: 'Accounts Officer' }], [{}, { ...actor, BranchAccess: 'selected', BranchIds: ['main'] }],
    [{}, { ...actor, subscriptionReadOnly: true }], [{}, { ...actor, subscriptionActive: false }], [{ currentPassword: 'wrong' }, actor],
    [{ targetUsername: 'orphan' }, actor], [{ operationId: '' }, actor], [{ reason: '' }, actor],
    [{ targetUsername: 'teacher-login' }, { ...actor, username: 'teacher' }],
    [{}, actor, f => { f.docs.get('staffUsers/legacy%2F teacher').Active = false; }],
    [{}, actor, f => { f.docs.get('staffUsers/legacy%2F teacher').OrganisationEdition = 'faith'; }],
    [{}, actor, f => { f.docs.get('staffPasskeys/phone').Username = 'another'; }], [{}, actor, f => { f.docs.get('staffMfaProfiles/teacher').Username = 'another'; }],
    [{}, actor, f => f.put('staffUsers', 'duplicate', { ...f.original })]
  ]) {
    const f = await fixture(); if (configure) configure(f); if (user.username === 'teacher') f.db.verifyStaffApprovalPassword = async () => true;
    await assert.rejects(f.reset(input, user)); assert.equal(f.batches.length, 0);
  }
  const f = await fixture(); delete f.docs.get('staffPasskeys/phone').UsernameKey; await f.reset(); assert.equal(f.docs.get('staffPasskeys/phone').Active, false);
});

test('operation reuse cannot change target or administrator', async () => {
  const f = await fixture(); await f.reset(); f.put('staffUsers', 'other', { ...f.original, Username: 'other', UsernameKey: 'other', LoginUsername: 'other-login', LoginUsernameKey: 'other-login' });
  await assert.rejects(f.reset({ targetUsername: 'other' }), /already used/); f.db.verifyStaffApprovalPassword = async () => true;
  await assert.rejects(f.reset({}, { ...actor, username: 'second-owner' }), /already used/); assert.equal(f.batches.length, 1);
});

test('account, factor and concurrent enrollment revisions prevent partial recovery', async () => {
  for (const path of ['staffUsers/legacy%2F teacher', 'staffPasskeys/phone', 'staffMfaProfiles/teacher']) {
    const f = await fixture(); f.hooks.beforeCommit = async () => { f.hooks.beforeCommit = null; f.docs.get(path).__updateTime = 'changed'; };
    await assert.rejects(f.reset(), /changed during recovery/); assert.equal(f.docs.get('staffPasskeys/phone').Active, true); assert.equal(f.batches.length, 0);
  }
  const f = await fixture(); f.hooks.beforeCommit = async () => { f.hooks.beforeCommit = null;
    const guard = await f.epoch.staffCredentialWriteGuard(f.env, 'teacher', '');
    await f.db.batchCommitLiteralDocuments(f.env, [{ collectionPath: 'staffPasskeys', documentId: 'concurrent', exists: false, data: { Username: 'teacher', Active: true } }, guard]); };
  await assert.rejects(f.reset(), /changed during recovery/); assert.equal(f.docs.get('staffPasskeys/concurrent').Active, true); assert.equal(f.docs.get('staffPasskeys/phone').Active, true);
});

test('old passkey proof cannot acquire the recovery epoch after its usage counter updates', async () => {
  const f = await fixture(); f.put('staffPasskeyChallenges', 'login', { Type: 'authentication', Challenge: 'challenge', ExpiresAt: '2099-01-01' });
  f.hooks.afterUsage = async () => { f.hooks.afterUsage = null; await f.reset(); };
  const response = await f.passkeys.verifyAuthentication(new Request('https://fixture.test'), f.env, { ceremonyId: 'login', credential: { id: 'phone-key' } });
  assert.equal(response.status, 401); assert.equal(f.docs.get('staffPasskeys/phone').Active, false);
});

test('registration racing recovery cannot create a late key; a fresh session cannot reuse the old ceremony', async () => {
  const f = await fixture(); f.put('staffPasskeyChallenges', 'register', { Type: 'registration', UsernameKey: 'teacher', AuthEpoch: '', Challenge: 'challenge', ExpiresAt: '2099-01-01' });
  f.hooks.beforeCommit = async writes => { if (writes.some(row => row.collectionPath === 'staffPasskeys' && row.exists === false)) { f.hooks.beforeCommit = null; await f.reset(); } };
  await assert.rejects(f.passkeys.verifyRegistration(new Request('https://fixture.test'), f.env, { ceremonyId: 'register', credential: {} }), /Concurrent write/);
  assert.equal([...f.docs.values()].some(row => row.CredentialId === 'new-key'), false);
  f.put('staffPasskeyChallenges', 'old', { Type: 'registration', UsernameKey: 'teacher', AuthEpoch: '', Challenge: 'challenge', ExpiresAt: '2099-01-01' });
  f.passkeys.requireStaffSession = async () => ({ username: 'teacher', authEpoch: f.docs.get('staffUsers/legacy%2F teacher').PasswordRecoveryEpoch });
  assert.equal((await f.passkeys.verifyRegistration(new Request('https://fixture.test'), f.env, { ceremonyId: 'old', credential: {} })).status, 403);
});

test('TOTP setup cannot resurrect cleared secrets and old enrollment tickets cannot mutate a new epoch', async () => {
  const f = await fixture(); f.hooks.beforeCommit = async writes => { if (writes.some(row => row.collectionPath === 'staffMfaProfiles' && row.data.PendingTotpCiphertext)) { f.hooks.beforeCommit = null; await f.reset(); } };
  await assert.rejects(f.mfa.beginTotpSetup(f.env, { user: { username: 'teacher', authEpoch: '' }, viaTicket: false }), /Concurrent write/);
  assert.equal(f.docs.get('staffMfaProfiles/teacher').TotpActive, false); assert.equal(f.docs.get('staffMfaProfiles/teacher').TotpCiphertext, '');
  await assert.rejects(f.mfa.confirmTotpSetup(f.env, { user: { Username: 'teacher' }, viaTicket: true, challenge: { AuthEpoch: '' } }, '123456'), /security changed/);
});

test('replacement authenticator enrollment works after recovery', async () => {
  const f = await fixture(); await f.reset(); const current = { user: { username: 'teacher', authEpoch: f.docs.get('staffUsers/legacy%2F teacher').PasswordRecoveryEpoch }, viaTicket: false };
  const setup = await f.mfa.beginTotpSetup(f.env, current), code = await totpCodeForSecret(setup.secret.replace(/\s/g, ''));
  const completed = await f.mfa.confirmTotpSetup(f.env, current, code, 'staff-secret');
  assert.equal(completed.recoveryCodes.length, 10); assert.equal(f.docs.get('staffMfaProfiles/teacher').TotpActive, true); assert.equal(f.docs.get('staffPasskeys/phone').Active, false);
});

test('replacement passkey registration succeeds under the new epoch and survives a replay of the previous recovery', async () => {
  const f = await fixture(); await f.reset();
  const authEpoch = f.docs.get('staffUsers/legacy%2F teacher').PasswordRecoveryEpoch;
  f.passkeys.requireStaffSession = async () => ({ username: 'teacher', authEpoch });
  f.put('staffPasskeyChallenges', 'replacement', { Type: 'registration', UsernameKey: 'teacher', AuthEpoch: authEpoch,
    Challenge: 'challenge', ExpiresAt: '2099-01-01' });
  assert.equal((await f.passkeys.verifyRegistration(new Request('https://fixture.test'), f.env,
    { ceremonyId: 'replacement', credential: {} })).status, 200);
  assert.equal((await f.reset()).alreadyCompleted, true);
  assert.equal([...f.docs.values()].find(row => row.CredentialId === 'new-key').Active, true);
  assert.equal(f.docs.get('staffPasskeys/phone').Active, false);
});

test('reset during authenticator confirmation cannot restore it, and pending pre-reset MFA challenges expire', async () => {
  const f = await fixture(), current = { user: { username: 'teacher', authEpoch: '' }, viaTicket: false };
  const setup = await f.mfa.beginTotpSetup(f.env, current), code = await totpCodeForSecret(setup.secret.replace(/\s/g, ''));
  const ticket = 'x'.repeat(40), challengeId = await f.mfa.tokenDocumentId(ticket);
  f.put('staffMfaChallenges', challengeId, { Username: 'teacher', UsernameKey: 'teacher', AuthEpoch: '',
    Methods: ['totp'], Attempts: 0, ExpiresAt: '2099-01-01' });
  f.hooks.beforeCommit = async writes => { if (writes.some(row => row.collectionPath === 'staffMfaProfiles' && row.data.TotpActive === true)) {
    f.hooks.beforeCommit = null; await f.reset();
  } };
  await assert.rejects(f.mfa.confirmTotpSetup(f.env, current, code, 'staff-secret'), /Concurrent write/);
  assert.equal(f.docs.get('staffMfaProfiles/teacher').TotpActive, false);
  assert.equal(f.docs.get('staffMfaProfiles/teacher').TotpCiphertext, '');
  await assert.rejects(f.mfa.readStaffMfaLoginChallenge(f.env, ticket), /expired/);
});

test('old session cannot upgrade epoch during account reload; password recovery does not invalidate a retained legacy passkey', async () => {
  const f = await fixture(), token = await f.auth.createStaffSession(f.env, { username: 'teacher', role: 'Teacher' });
  f.auth.findStaffUserRecord = async () => { await f.reset(); return clone(f.docs.get('staffUsers/legacy%2F teacher')); };
  await assert.rejects(f.auth.requireStaffSession(f.env, new Request('https://fixture.test', { headers: { Authorization: `Bearer ${token}` } })), /security changed/);
  const legacy = await fixture(); legacy.docs.get('staffUsers/legacy%2F teacher').PasswordRecoveryEpoch = 'password-recovered';
  legacy.put('staffCredentialRevocations', await credentialStateId('teacher'), { Epoch: 'password-recovered' });
  legacy.put('staffPasskeyChallenges', 'login', { Type: 'authentication', Challenge: 'challenge', ExpiresAt: '2099-01-01' });
  assert.equal((await legacy.passkeys.verifyAuthentication(new Request('https://fixture.test'), legacy.env, { ceremonyId: 'login', credential: { id: 'phone-key' } })).status, 200);
});

test('successful/replayed reset marks its atomic audit handled; denied requests remain auditable', async () => {
  const context = vm.createContext({ Response, Headers, requireFirestoreEnv: () => {}, readJsonBody: request => request.json(), adminResetStaffMfa: async () => ({ replay: true, alreadyCompleted: true, message: 'Recovered' }) });
  vm.runInContext(unmodule(apiSource), context);
  const call = () => ({ env: {}, data: {}, request: new Request('https://fixture.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'admin-reset' }) }) });
  const success = call(); assert.equal((await context.onRequestPost(success)).status, 200); assert.equal(success.data.securityAuditHandled, true);
  context.adminResetStaffMfa = async () => { throw Object.assign(new Error('Denied'), { status: 403 }); };
  const denied = call(); assert.equal((await context.onRequestPost(denied)).status, 403); assert.equal(denied.data.securityAuditHandled, undefined);
});
