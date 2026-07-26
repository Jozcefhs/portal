import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const sessionApi = fs.readFileSync(new URL('../functions/api/staff-session.js', import.meta.url), 'utf8');
const staffAuth = fs.readFileSync(new URL('../functions/lib/staff-auth.js', import.meta.url), 'utf8');

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
  assert.match(sessionApi, /ProfilePhotoDataUrl: profilePhoto\(body\.profilePhotoDataUrl\)/);
  assert.match(sessionApi, /await upsertDocument\(env, 'staffUsers', existing\.__id, updated\)/);
  assert.match(sessionApi, /createStaffSession\(env, refreshedUser\)/);
});
