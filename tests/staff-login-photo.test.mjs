import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createStaffSession, readStaffSession } from '../functions/lib/staff-auth.js';

const authSource = await readFile(new URL('../functions/lib/staff-auth.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const mfaSource = await readFile(new URL('../functions/lib/staff-mfa.js', import.meta.url), 'utf8');
const passkeySource = await readFile(new URL('../functions/api/staff-passkey.js', import.meta.url), 'utf8');
const imageSource = await readFile(new URL('../functions/lib/staff-profile-image.js', import.meta.url), 'utf8');
const photo = 'data:image/webp;base64,U0FWRUQtUEhPVE8=';
const user = { __id: 'staff-47', Username: 'staff.one', LoginUsername: 'renamed.login',
  DisplayName: 'Staff One', Role: 'Super Admin', Active: true, ProfilePhotoDataUrl: '' };
const clean = value => String(value ?? '').trim();

function finalizer(record = user, image = photo) {
  const imageReads = [];
  const writes = [];
  const context = vm.createContext({
    TextEncoder, crypto, Date,
    clean, lower: value => clean(value).toLowerCase(),
    findStaffUserRecord: async () => record,
    publicUser: row => ({ username: row.Username || row.username, displayName: row.DisplayName || row.displayName,
      profilePhotoUrl: row.ProfilePhotoDataUrl || row.profilePhotoUrl || '', role: row.Role || row.role }),
    loadStaffProfileImage: async (env, stored, identity) => {
      imageReads.push({ env, stored, identity });
      return image ? { ProfilePhotoDataUrl: image } : null;
    },
    patchDocumentFields: async (...args) => writes.push(args),
    upsertDocument: async (...args) => writes.push(args),
  });
  const start = authSource.indexOf('export async function finalizeStaffAuthentication(');
  const end = authSource.indexOf('export async function verifyStaffApprovalPassword(', start);
  vm.runInContext(authSource.slice(start, end).replaceAll('export ', ''), context);
  return { context, imageReads, writes };
}

test('successful password, biometric and MFA sign-ins return the saved photo before the browser opens the workspace', async () => {
  for (const source of ['Web Password', 'Web Passkey', 'Web MFA TOTP', 'Web MFA Recovery', 'Web MFA Passkey']) {
    const { context, imageReads } = finalizer();
    const result = await context.finalizeStaffAuthentication({}, user.Username, source);
    assert.equal(result.profilePhotoUrl, photo, source);
    assert.equal(imageReads.length, 1, source);
    assert.equal(imageReads[0].stored.__id, 'staff-47');
    assert.equal(imageReads[0].identity.username, user.Username);
  }
});

test('biometric and MFA completion retain the photo from the common authenticated identity', async () => {
  const { context } = finalizer();
  assert.equal((await context.authenticateStaffPasskey({}, user.Username)).profilePhotoUrl, photo);
  context.createStaffSession = async () => 'signed-token';
  context.staffAccessFor = async () => ({ edition: 'church' });
  context.staffUserForAccess = (identity, access) => ({ ...identity, ...access });
  context.staffSessionCookie = token => token;
  const start = mfaSource.indexOf('async function completedSession(');
  const end = mfaSource.indexOf('export async function completeStaffMfaPasskeyLogin(', start);
  vm.runInContext(mfaSource.slice(start, end), context);
  const completed = await context.completedSession({}, user.Username, 'Web MFA TOTP');
  assert.equal(completed.user.profilePhotoUrl, photo);
  assert.equal(completed.sessionToken, 'signed-token');
  assert.match(passkeySource, /const user = await authenticateStaffPasskey\(env, stored.Username\)/);
  assert.match(passkeySource, /user: \{ \.\.\.user, \.\.\.access \}/);
});

test('inactive or missing staff cannot trigger a photo read; no-photo users retain their fallback', async () => {
  for (const record of [null, { ...user, Active: 'NO' }]) {
    const { context, imageReads } = finalizer(record);
    assert.equal(await context.finalizeStaffAuthentication({}, user.Username), null);
    assert.equal(imageReads.length, 0);
  }
  const { context } = finalizer(user, '');
  assert.equal((await context.finalizeStaffAuthentication({}, user.Username)).profilePhotoUrl, '');
});

test('the environment administrator and legacy inline photos are retained', async () => {
  const { context, imageReads } = finalizer(null);
  const env = { ADMIN_WEB_USERNAME: 'configured.admin' };
  const result = await context.finalizeStaffAuthentication(env, 'configured.admin');
  assert.equal(result.profilePhotoUrl, photo);
  assert.equal(imageReads[0].identity.username, 'configured.admin');
  const legacy = finalizer({ ...user, ProfilePhotoDataUrl: photo }, '');
  assert.equal((await legacy.context.finalizeStaffAuthentication({}, user.Username)).profilePhotoUrl, photo);
});

test('shared photo lookup uses the canonical document first and stays scoped to each request', async () => {
  const reads = [];
  const context = vm.createContext({ getDocument: async (env, collection, id) => {
    reads.push([env.tenant, collection, id]);
    return id === 'staff-47' ? { ProfilePhotoDataUrl: `${photo}-${env.tenant}` } : null;
  } });
  vm.runInContext(imageSource.replace(/^import .*;\r?\n/gm, '').replaceAll('export ', ''), context);
  const [one, two] = await Promise.all([
    context.loadStaffProfileImage({ tenant: 'one' }, user, { username: user.Username }),
    context.loadStaffProfileImage({ tenant: 'two' }, user, { username: user.Username }),
  ]);
  assert.equal(one.ProfilePhotoDataUrl, `${photo}-one`);
  assert.equal(two.ProfilePhotoDataUrl, `${photo}-two`);
  assert.deepEqual(reads, [['one', 'staffProfileImages', 'staff-47'], ['two', 'staffProfileImages', 'staff-47']]);
});

test('legacy photo lookup tries only known staff aliases; missing or unavailable photos do not block login', async () => {
  const reads = [];
  const context = vm.createContext({ getDocument: async (_env, collection, id) => {
    assert.equal(collection, 'staffProfileImages');
    reads.push(id);
    if (id === 'staff-47') throw new Error('temporary read error');
    return id === 'renamed.login' ? { ProfilePhotoDataUrl: photo } : null;
  } });
  vm.runInContext(imageSource.replace(/^import .*;\r?\n/gm, '').replaceAll('export ', ''), context);
  const result = await context.loadStaffProfileImage({}, user, { username: user.Username });
  assert.equal(result.ProfilePhotoDataUrl, photo);
  assert.deepEqual(reads, ['staff-47', 'staff.one', 'renamed.login']);
  context.getDocument = async () => { throw new Error('unavailable'); };
  assert.equal(await context.loadStaffProfileImage({}, user), null);
});

test('profile data never enters the signed token even when returned at login', async () => {
  const env = { STAFF_SESSION_SECRET: 'test-only-profile-photo-session-key' };
  const token = await createStaffSession(env, { username: user.Username, role: 'Super Admin', profilePhotoUrl: photo });
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
  assert.equal('profilePhotoUrl' in payload, false);
  const restored = await readStaffSession(env, new Request('https://example.test/api/staff-session', {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(restored.username, user.Username);
  assert.equal(restored.profilePhotoUrl, '');
});

test('the initial login photo replaces initials immediately without a second session request', async () => {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
  const context = vm.createContext({ clean, staffBearerToken: '',
    staffAvatarImage: node('image'), staffAvatarFallback: node('fallback'),
    document: { getElementById: node },
    sessionRequest: () => { throw new Error('An extra session request was made'); },
  });
  const render = adminSource.slice(adminSource.indexOf('function renderProfilePhoto('), adminSource.indexOf('function openStaffProfile('));
  const confirm = adminSource.slice(adminSource.indexOf('async function confirmFreshStaffSession('), adminSource.indexOf('function mergeDashboardResponse('));
  vm.runInContext(render + confirm, context);
  const authenticated = await finalizer().context.finalizeStaffAuthentication({}, user.Username);
  const signedIn = await context.confirmFreshStaffSession(authenticated, 'fresh-token');
  context.renderProfilePhoto(signedIn.profilePhotoUrl, signedIn.displayName);
  assert.equal(node('image').src, photo);
  assert.equal(node('image').hidden, false);
  assert.equal(node('fallback').hidden, true);
  context.renderProfilePhoto('', 'Another User');
  assert.equal(node('image').hidden, true);
  assert.equal(node('fallback').textContent, 'A');
});
