import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { findStaffLoginUser, findStaffUser } from '../functions/lib/staff-auth.js';
import { staffProfileImageIds } from '../functions/api/staff-session.js';

const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const sessionApi = fs.readFileSync(new URL('../functions/api/staff-session.js', import.meta.url), 'utf8');
const staffAuth = fs.readFileSync(new URL('../functions/lib/staff-auth.js', import.meta.url), 'utf8');
const backendApi = fs.readFileSync(new URL('../functions/api/backend.js', import.meta.url), 'utf8');

test('signed-in identity opens the current user profile editor', () => {
  assert.match(adminHtml, /id="staffProfileTrigger"[\s\S]*?aria-label="Edit my profile"/);
  assert.match(adminHtml, /id="staffProfileDialog"/);
  assert.match(adminJs, /profileTrigger\.addEventListener\('click', openStaffProfile\)/);
});

test('saved profile pictures replace the initials avatar', () => {
  assert.match(adminHtml, /id="staffAvatarImage"/);
  assert.match(adminJs, /staffAvatarImage\.hidden = !photo/);
  assert.match(adminJs, /staffAvatarFallback\.hidden = Boolean\(photo\)/);
  assert.match(staffAuth, /profilePhotoUrl: clean\(user\.ProfilePhotoDataUrl/);
});

test('staff can update only their own display profile through the authenticated session', () => {
  assert.match(sessionApi, /action === 'updateprofile'/);
  assert.match(sessionApi, /const sessionUser = await readStaffSession/);
  assert.match(sessionApi, /const photo = profilePhoto\(body\.profilePhotoDataUrl\)/);
  assert.match(sessionApi, /await batchUpsertDocuments\(env/);
  assert.match(sessionApi, /collectionPath: 'staffProfileImages'/);
  assert.match(sessionApi, /ProfilePhotoDataUrl: photo/);
  assert.match(sessionApi, /createStaffSession\(env, refreshedUser\)/);
});

test('staff profile lookup accepts either the stored username or its database document id', () => {
  const rows = [{
    __id: 'admin',
    Username: 'DIGC Super Admin',
    DisplayName: 'DIGC Super Admin'
  }];
  assert.equal(findStaffUser(rows, 'DIGC Super Admin'), rows[0]);
  assert.equal(findStaffUser(rows, 'ADMIN'), rows[0]);
});

test('profile pictures reload from the canonical staff document after a new login', () => {
  assert.deepEqual(
    staffProfileImageIds(
      { __id: 'admin', Username: 'DIGC Super Admin', LoginUsername: 'admin' },
      { username: 'DIGC Super Admin', loginUsername: 'admin' }
    ),
    ['admin', 'digc-super-admin']
  );
  assert.match(sessionApi, /const staffRecord = await findStaffUserRecord\(env, user\.username\)\.catch\(\(\) => null\)/);
  assert.match(sessionApi, /loadStaffProfileImage\(env, staffRecord \|\| \{\}, user\)/);
});

test('dashboard hydration does not erase the separately loaded profile picture', () => {
  assert.match(adminHtml, /js\/admin\.js\?v=20260815-applied-arm-guidance/);
  assert.match(adminJs, /const dashboardUser = data\.user \|\| \{\}/);
  assert.match(
    adminJs,
    /profilePhotoUrl: clean\(dashboardUser\.profilePhotoUrl\) \|\| clean\(currentUser\?\.profilePhotoUrl\)/
  );
});

test('the authenticated environment super admin can bootstrap a missing database profile', () => {
  assert.match(sessionApi, /function environmentAdminProfile\(env, sessionUser\)/);
  assert.match(sessionApi, /sessionUser\.role !== 'Super Admin'/);
  assert.match(sessionApi, /findStaffUserRecord\(env, sessionUser\.username\)\.catch\(\(\) => null\)\s*\|\| environmentAdminProfile\(env, sessionUser\)/);
});

test('staff can securely change their own login details from the web profile', () => {
  assert.match(adminHtml, /id="staffLoginDetailsForm"/);
  assert.match(adminHtml, /id="staffProfileLoginUsername"[\s\S]*?autocomplete="username"/);
  assert.match(adminHtml, /id="staffProfileCurrentPassword"[\s\S]*?autocomplete="current-password"/);
  assert.match(adminJs, /action: 'updateLoginDetails'/);
  assert.match(sessionApi, /action === 'updatelogindetails'/);
  assert.match(sessionApi, /verifyStaffApprovalPassword\(env, sessionUser\.username, currentPassword\)/);
  assert.match(sessionApi, /That login username is already in use/);
  assert.match(sessionApi, /newPassword && newPassword\.length < 6/);
  assert.match(sessionApi, /newPassword \? await hashStaffPassword\(newPassword\) : \{\}/);
  assert.match(sessionApi, /LoginUsernameKey: lower\(loginUsername\)/);
  assert.match(sessionApi, /Action: 'UPDATE OWN LOGIN DETAILS'/);
  assert.match(sessionApi, /createStaffSession\(env, refreshedUser\)/);
});

test('self-service login settings are shared by school and religious-organisation editions', () => {
  const profileOpener = adminJs.match(/function openStaffProfile\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(profileOpener, /staffProfileLoginUsername/);
  assert.doesNotMatch(profileOpener, /schoolEdition|isFaith|isOrganisationOperations/);
  assert.match(adminHtml, /accessing organisation records/);
});

test('login usernames remain separate from immutable staff identity', () => {
  const user = { __id: 'staff-one', Username: 'staff.one', LoginUsername: 'new.login' };
  assert.equal(findStaffLoginUser([user], 'new.login'), user);
  assert.equal(findStaffLoginUser([user], 'staff.one'), null);
  assert.match(staffAuth, /loginUsername: clean\(user\.LoginUsername/);
  assert.match(staffAuth, /findStaffLoginRecord\(env, wanted\)/);
  assert.match(staffAuth, /findOneByField\(env, 'staffUsers', 'UsernameKey', wanted\)/);
  assert.match(staffAuth, /UsernameKey: lower\(legacy\.Username \|\| legacy\.username \|\| legacy\.__id\)/);
  assert.match(staffAuth, /const legacyProfile = organizationProfile\s*\? null\s*:\s*await getDocument\(env, 'settings', 'schoolProfile'\)/);
  assert.match(staffAuth, /findOneByField\(env, 'staffUsers', 'LoginUsernameKey', wanted\)/);
  assert.match(staffAuth, /legacy\?\.__id && !clean\(legacy\.LoginUsernameKey\)/);
  assert.match(staffAuth, /patchDocumentFields\(env, 'staffUsers', legacy\.__id/);
  assert.match(staffAuth, /!configuredHasPassword && wanted === envUsername/);
  assert.match(staffAuth, /if \(user\)[\s\S]*?return verifyDesktopPassword\(user, password\)/);
  assert.match(backendApi, /LoginUsername: loginUsername/);
  assert.match(backendApi, /UsernameKey: lower\(username\)/);
  assert.match(backendApi, /LoginUsernameKey: lower\(loginUsername\)/);
  assert.match(backendApi, /That login username is already assigned to another staff account/);
});

test('ordinary password changes cannot bypass current-password verification', () => {
  assert.match(sessionApi, /if \(!sessionUser\.mustChangePassword\)[\s\S]*?Use Edit Profile to change your login details/);
});
