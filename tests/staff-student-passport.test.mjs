import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [api, admin, css] = await Promise.all([
  readFile(new URL('../functions/api/staff-student-passport.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../css/style.css', import.meta.url), 'utf8')
]);
const recordsDesk = await readFile(new URL('../functions/lib/records-desk.js', import.meta.url), 'utf8');

test('staff passport upload is authenticated, scoped and stored privately', () => {
  assert.match(api, /requireStaffSession/);
  assert.match(api, /allowedSections[^\n]+includes\('students'\)/);
  assert.match(api, /listSchoolCollection\(env, 'students'/);
  assert.match(api, /branchId: user\.branchId/);
  assert.match(api, /schoolSectionAccess: user\.schoolSectionAccess/);
  assert.match(api, /putStoredDocument/);
  assert.match(api, /upsertSchoolDocument\(env, 'students'/);
  assert.doesNotMatch(api, /delete updated\.__scopePath/);
  assert.match(api, /applicationPassportThumbnails/);
  assert.match(api, /deleteStoredDocument/);
});

test('student profiles can upload passports and search rows hydrate their thumbnails', () => {
  assert.match(admin, /data-student-passport-choose/);
  assert.match(admin, /\/api\/staff-student-passport/);
  assert.match(admin, /function hydrateStudentPassportThumbnails/);
  assert.match(admin, /data-student-passport-thumb/);
  assert.match(admin, /record\.passportPhotoAvailable/);
  assert.match(recordsDesk, /passportPhotoAvailable/);
  assert.match(css, /\.student-passport-preview/);
  assert.match(css, /\.student-search-passport/);
});
