import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { hashStaffPassword } from '../functions/lib/staff-auth.js';
import { requiredDeploymentIdentity } from '../functions/lib/deployment-identity.js';
import { externalAuditAccessExpired } from '../functions/lib/external-audit.js';
import { normalizeRecoveryEmail } from '../functions/lib/staff-password-recovery.js';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const unmodule = source => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');
const recoverySource = await read('functions/lib/staff-password-recovery.js');
const epochSource = await read('functions/lib/staff-credential-state.js');
const authSource = await read('functions/lib/staff-auth.js');
const apiSource = await read('functions/api/staff-password-recovery.js');
const mfaSource = await read('functions/lib/staff-mfa.js');

async function fixture(edition = 'school', overrides = {}) {
  const env = { FIREBASE_PROJECT_ID: 'fixture', DYNAMAX_WORKSPACE_ID: 'tenant-one', ORGANISATION_EDITION: edition, STAFF_SESSION_SECRET: 'test-only-not-live' };
  let version = 0;
  const docs = new Map();
  const emails = [], batches = [];
  const clone = value => value == null ? null : structuredClone(value);
  const put = (path, id, data) => docs.set(`${path}/${id}`, { ...clone(data), __id: id, __updateTime: `v${++version}` });
  const original = { Username: 'teacher', LoginUsername: 'my.login', DisplayName: 'Fixture Teacher',
    RecoveryEmail: 'teacher@example.test', Active: true, Role: 'Teacher', BranchId: 'east',
    OrganisationEdition: edition, ApprovalEnabled: false, TabAccess: ['academics'],
    ...await hashStaffPassword('old-test-password'), ...overrides };
  put('staffUsers', 'legacy-id', original);
  const database = {
    getDocument: async (_env, path, id) => clone(docs.get(`${path}/${id}`)),
    batchCommitLiteralDocuments: async (_env, writes) => {
      for (const w of writes) {
        const existing = docs.get(`${w.collectionPath}/${w.documentId}`);
        if (w.exists === false && existing || w.updateTime && existing?.__updateTime !== w.updateTime) {
          throw Object.assign(new Error('Concurrent update'), { status: 412 });
        }
      }
      batches.push(clone(writes));
      for (const w of writes) {
        const data = w.updateMask ? { ...docs.get(`${w.collectionPath}/${w.documentId}`), ...clone(w.data) } : w.data;
        put(w.collectionPath, w.documentId, data);
      }
    }
  };
  const common = { crypto, Date, TextEncoder, TextDecoder, Uint8Array, btoa, atob, console, ...database };
  const epoch = vm.createContext(common);
  vm.runInContext(unmodule(epochSource), epoch);
  const context = vm.createContext({ ...common, credentialStateId: epoch.credentialStateId,
    hashStaffPassword, requiredDeploymentIdentity, externalAuditAccessExpired,
    findStaffLoginRecord: async (_env, login) => clone([...docs.values()].find(row => row.LoginUsername === login)),
    escapeEmailHtml: value => value, sendConfiguredEmail: async (_env, message) => emails.push(message) });
  vm.runInContext(unmodule(recoverySource), context);
  const auth = vm.createContext({ ...common, staffCredentialEpochCurrent: epoch.staffCredentialEpochCurrent,
    requisitionEditGrant: () => false });
  vm.runInContext(unmodule(authSource), auth);
  const api = vm.createContext({ ...common, Response, URL, requireFirestoreEnv: () => {},
    consumeRequestAllowance: async () => ({ allowed: true }), readJsonBody: request => request.json(),
    requestStaffPasswordRecovery: context.requestStaffPasswordRecovery, resetStaffPassword: context.resetStaffPassword,
    RECOVERY_REQUEST_MESSAGE: 'Generic request acknowledgement' });
  vm.runInContext(unmodule(apiSource), api);
  const mfa = vm.createContext({ ...common, staffCredentialEpochCurrent: epoch.staffCredentialEpochCurrent });
  vm.runInContext(unmodule(mfaSource), mfa);
  const request = (body, headers = {}) => new Request('https://tenant.test/api/staff-password-recovery', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
  });
  const pending = [];
  const post = body => api.onRequestPost({ env, request: request(body), waitUntil: promise => pending.push(promise) });
  const code = () => emails.at(-1)?.textContent.match(/[a-f0-9]{48}/)[0];
  return { env, docs, put, emails, batches, original, context, epoch, auth, api, mfa, post, request, pending, code };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: recovery accepts 6–128 characters and rejects out-of-range passwords without consuming the code`, async () => {
    for (const length of [6, 128]) {
      const f = await fixture(edition);
      await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
      for (const password of ['', 'a'.repeat(5), 'a'.repeat(129), 123456, null]) {
        const response = await f.post({ action:'reset', code:f.code(), password });
        assert.equal(response.status,400);
        assert.match((await response.json()).message,/between 6 and 128/);
        assert.equal(f.docs.get('staffUsers/legacy-id').PasswordHash,f.original.PasswordHash);
        assert.equal(f.batches.filter(writes=>writes.length===4).length,0);
      }
      const password = 'a'.repeat(length);
      const response = await f.post({action:'reset',code:f.code(),password});
      assert.equal(response.status,200);
      const saved = f.docs.get('staffUsers/legacy-id');
      const verifier = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'PBKDF2'},false,['deriveBits']);
      const hash = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(saved.Salt),iterations:saved.PasswordIterations},verifier,256);
      assert.equal(Buffer.from(hash).toString('hex'),saved.PasswordHash);
      assert.equal(f.batches.filter(writes=>writes.length===4).length,1);
      await assert.rejects(f.context.resetStaffPassword(f.env,f.code(),password),/already used/);
    }
  });

  test(`${edition}: recovery updates only credentials, preserves permissions and revokes old sessions`, async () => {
    const f = await fixture(edition);
    const oldSession = await f.auth.createStaffSession(f.env, { username: 'teacher', role: 'Teacher' });
    const oldProof = await f.auth.createStaffApprovalProof(f.env, { username: 'teacher' });
    await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
    assert.equal(f.emails.length, 1);
    assert.equal(f.emails[0].toEmail, 'teacher@example.test');
    const code = f.code();
    assert.ok(!JSON.stringify([...f.docs]).includes(code));
    await f.context.resetStaffPassword(f.env, code, 'new-test-password');
    const saved = f.docs.get('staffUsers/legacy-id');
    assert.notEqual(saved.PasswordHash, f.original.PasswordHash);
    for (const key of ['Username', 'LoginUsername', 'Role', 'BranchId', 'TabAccess', 'ApprovalEnabled', 'RecoveryEmail']) {
      assert.deepEqual(saved[key], f.original[key]);
    }
    assert.equal(saved.MustChangePassword, false);
    const request = new Request('https://tenant.test', { headers: { Authorization: `Bearer ${oldSession}` } });
    assert.equal(await f.auth.readStaffSession(f.env, request), null);
    assert.equal(await f.auth.readStaffApprovalProof(f.env, new Request('https://tenant.test', {
      headers: { 'X-DIGC-Approval-Proof': oldProof }
    }), 'teacher'), false);
    await assert.rejects(f.auth.createStaffSession(f.env, { username: 'teacher' }), /password changed/);
    const newSession = await f.auth.createStaffSession(f.env, saved);
    assert.equal((await f.auth.readStaffSession(f.env, new Request('https://tenant.test', {
      headers: { Authorization: `Bearer ${newSession}` }
    }))).username, 'teacher');
    await assert.rejects(f.context.resetStaffPassword(f.env, code, 'another-test-password'), /already used/);
    assert.equal([...f.docs.keys()].filter(key => key.startsWith('staffSecurityAudit/')).length, 1);
    assert.equal(f.batches.at(-1).length, 4);
  });
}

test('only the saved login-account email is used; HR contacts and ineligible accounts send nothing', async () => {
  for (const fields of [{ RecoveryEmail: '', Email: 'hr@example.test', WorkEmail: 'hr@example.test',
    Employment: { WorkEmail: 'hr@example.test' } }, { Active: false },
    { OrganisationEdition: 'faith' }, { Role: 'External Auditor', AuditExpiresAt: '2020-01-01' }]) {
    const f = await fixture('school', fields);
    await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
    assert.equal(f.emails.length, 0);
  }
  const f = await fixture();
  await f.context.requestStaffPasswordRecovery(f.env, 'not-found');
  await f.context.requestStaffPasswordRecovery(f.env, 'teacher'); // Alias must be used.
  assert.equal(f.emails.length, 0);
});

test('saved account emails need no administrator verification and requests cannot choose another address', async () => {
  for (const edition of ['school', 'faith', 'organization']) {
    const f = await fixture(edition, { RecoveryEmailVerified: false, RecoveryEmailVerifiedBy: '',
      WorkEmail: 'hr@example.test', Employment: { WorkEmail: 'hr@example.test' } });
    f.put('hrEmployees', 'teacher', { Username: 'teacher', WorkEmail: 'hr@example.test' });
    const response = await f.post({ username: 'my.login', email: 'attacker@example.test', RecoveryEmail: 'attacker@example.test' });
    assert.equal(response.status, 200);
    await Promise.all(f.pending);
    assert.equal(f.emails.length, 1);
    assert.equal(f.emails[0].toEmail, 'teacher@example.test');
    await f.context.resetStaffPassword(f.env, f.code(), 'new-test-password');
    assert.notEqual(f.docs.get('staffUsers/legacy-id').PasswordHash, f.original.PasswordHash);
    assert.equal(f.docs.get('hrEmployees/teacher').WorkEmail, 'hr@example.test');
  }
});

test('changing and later restoring a login email never revives an older code', async () => {
  const f = await fixture();
  await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
  // Same address after two password-confirmed edits; the change stamp must still invalidate the old code.
  f.docs.get('staffUsers/legacy-id').RecoveryEmailChangedAt = '2026-10-18T12:00:00Z';
  await assert.rejects(f.context.resetStaffPassword(f.env, f.code(), 'new-test-password'), /invalid/);
  assert.equal(f.docs.get('staffUsers/legacy-id').PasswordHash, f.original.PasswordHash);
});

test('cooldown and concurrent requests cannot send repeated emails', async () => {
  const f = await fixture();
  await Promise.all([f.context.requestStaffPasswordRecovery(f.env, 'my.login'), f.context.requestStaffPasswordRecovery(f.env, 'my.login')]);
  await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
  assert.equal(f.emails.length, 1);
});

test('concurrent resets consume a code once with one atomic password/audit/revocation commit', async () => {
  const f = await fixture();
  await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
  const results = await Promise.allSettled([1, 2].map(() => f.context.resetStaffPassword(f.env, f.code(), 'new-test-password')));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(f.batches.filter(writes => writes.length === 4).length, 1);
});

test('changed credentials, recovery email, expiry, disabled accounts and wrong tenants reject codes', async () => {
  for (const change of ['password', 'email', 'disabled', 'expired', 'workspace', 'edition']) {
    const f = await fixture();
    await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
    const row = f.docs.get('staffUsers/legacy-id');
    if (change === 'password') row.PasswordHash = 'changed';
    if (change === 'email') row.RecoveryEmail = 'changed@example.test';
    if (change === 'disabled') row.Active = false;
    if (change === 'expired') [...f.docs].find(([key]) => key.startsWith('staffPasswordRecovery/'))[1].ExpiresAt = '2020-01-01';
    if (change === 'workspace') f.env.DYNAMAX_WORKSPACE_ID = 'tenant-two';
    if (change === 'edition') f.env.ORGANISATION_EDITION = 'faith';
    await assert.rejects(f.context.resetStaffPassword(f.env, f.code(), 'new-test-password'), /invalid/);
    assert.equal(f.batches.filter(writes => writes.length === 4).length, 0);
  }
});

test('pending MFA challenges from before the reset cannot be used afterwards', async () => {
  const f = await fixture();
  const challenge = await f.mfa.tokenDocumentId('a'.repeat(48));
  f.put('staffMfaChallenges', challenge, { Username: 'teacher', AuthEpoch: '', Attempts: 0, ExpiresAt: new Date(Date.now() + 60_000).toISOString() });
  await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
  await f.context.resetStaffPassword(f.env, f.code(), 'new-test-password');
  await assert.rejects(f.mfa.readStaffMfaLoginChallenge(f.env, 'a'.repeat(48)), /expired/);
});

test('API gives identical non-enumerating acknowledgements and rejects cross-origin/rate-limited requests', async () => {
  const f = await fixture();
  const found = await f.post({ username: 'my.login' }), absent = await f.post({ username: 'missing' });
  assert.deepEqual(await found.json(), await absent.json());
  await Promise.all(f.pending);
  assert.equal(f.emails.length, 1);
  const denied = await f.api.onRequestPost({ env: f.env, request: f.request({ username: 'my.login' }, { Origin: 'https://evil.test' }) });
  assert.equal(denied.status, 403);
  f.api.consumeRequestAllowance = async () => ({ allowed: false });
  assert.equal((await f.post({ username: 'my.login' })).status, 429);
});

test('no response leaks provider errors; recovery email validation rejects header injection', async () => {
  assert.throws(() => normalizeRecoveryEmail('a@example.test\r\nBcc:attacker@example.test'), /valid/);
  const f = await fixture();
  f.api.resetStaffPassword = async () => { throw new Error('SECRET provider response'); };
  const response = await f.post({ action: 'reset', code: 'a'.repeat(48), password: 'test-password-new' });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('SECRET'));
});

test('credential state read failures fail closed and requests do not change passwords', async () => {
  const f = await fixture();
  const token = await f.auth.createStaffSession(f.env, { username: 'teacher' });
  await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
  assert.equal(f.docs.get('staffUsers/legacy-id').PasswordHash, f.original.PasswordHash);
  f.epoch.getDocument = async () => { throw new Error('Database unavailable'); };
  await assert.rejects(f.auth.readStaffSession(f.env, new Request('https://tenant.test', {
    headers: { Authorization: `Bearer ${token}` }
  })), /Database unavailable/);
});

test('an administrator edit between validation and commit aborts the complete reset', async () => {
  const f = await fixture();
  await f.context.requestStaffPasswordRecovery(f.env, 'my.login');
  const commit = f.context.batchCommitLiteralDocuments;
  f.context.batchCommitLiteralDocuments = async (env, writes) => {
    f.put('staffUsers', 'legacy-id', { ...f.docs.get('staffUsers/legacy-id'), Active: false });
    return commit(env, writes);
  };
  await assert.rejects(f.context.resetStaffPassword(f.env, f.code(), 'new-test-password'), /invalid/);
  assert.equal(f.docs.get('staffUsers/legacy-id').PasswordHash, f.original.PasswordHash);
  assert.equal([...f.docs.keys()].filter(key => key.startsWith('staffCredentialRevocations/')).length, 0);
  assert.equal([...f.docs.keys()].filter(key => key.startsWith('staffSecurityAudit/')).length, 0);
});

test('recovery UI and backup rules keep secrets out of URLs, storage, HR and portable backups', async () => {
  const [html, js, backup, admin, desktopBackend] = await Promise.all([
    read('staff-password-recovery.html'), read('js/staff-password-recovery.js'), read('functions/lib/organization-backup.js'),
    read('admin.html'), read('functions/api/backend.js')]);
  assert.match(admin, /href="staff-password-recovery.html"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /New password \(6–128 characters\)/);
  for (const id of ['newPassword','confirmPassword']) {
    const field = html.match(new RegExp(`<input id="${id}"[^>]+>`))?.[0];
    assert.match(field, /minlength="6"/);
    assert.match(field, /maxlength="128"/);
  }
  assert.doesNotMatch(js, /localStorage|sessionStorage|location\.search|innerHTML/);
  for (const collection of ['staffPasswordRecovery', 'staffPasswordRecoveryLimits', 'staffCredentialRevocations']) assert.ok(backup.includes(`'${collection}'`));
  assert.match(desktopBackend, /const recoveryEmail = normalizeRecoveryEmail\(incoming.RecoveryEmail \?\? existing\?\.RecoveryEmail\)/);
  assert.match(desktopBackend, /RecoveryEmailChangedAt: lower\(existing\?\.RecoveryEmail\) === recoveryEmail/);
});
