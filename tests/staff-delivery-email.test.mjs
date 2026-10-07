import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import {
  staffDeliveryEmail, executiveOfficeCapabilities, visibleExecutiveStaffRow,
  normalizeCorrespondenceDraft, EXECUTIVE_TEMPLATE_TOKENS
} from '../functions/lib/executive-correspondence.js';

const source = await readFile(new URL('../functions/lib/executive-correspondence.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

test('staff delivery prefers a valid saved email and falls back only to email-style usernames', () => {
  for (const [row, expected] of [
    [{ Username: ' Teacher@Example.com ' }, 'teacher@example.com'],
    [{ Email: ' Saved@Example.com ', Username: 'login@example.com' }, 'saved@example.com'],
    [{ StaffEmail: 'staff@example.com', Username: 'login@example.com' }, 'staff@example.com'],
    [{ Email: 'invalid', Username: 'login@example.com' }, 'login@example.com'],
    [{ email: 'saved@example.com', username: 'login@example.com' }, 'saved@example.com'],
    [{ username: 'login@example.com' }, 'login@example.com'],
    [{ Username: 'teacher' }, ''], [{ Username: 'teacher@example' }, ''],
    [{ Username: 'teacher @example.com' }, ''], [{}, '']
  ]) {
    const before = JSON.stringify(row);
    assert.equal(staffDeliveryEmail(row), expected);
    assert.equal(JSON.stringify(row), before, 'must not change the staff account or login');
  }
});

function directorySearch(staff) {
  const start = source.indexOf('function searchText(');
  const end = source.indexOf('async function authoritativeRecipientTokens(', start);
  assert.ok(start >= 0 && end > start);
  const helpers = source.slice(source.indexOf('function boundText('), source.indexOf('function unknownTemplateTokens('))
    .replace('export function', 'function');
  return runInNewContext(`${helpers}\n${source.slice(start, end)}\nsearchDirectory`, {
    clean, lower, visibleExecutiveStaffRow,
    TOKEN_SET: new Set(EXECUTIVE_TEMPLATE_TOKENS),
    inputError: (message) => new Error(message),
    listCollection: async (_env, path) => {
      assert.equal(path, 'staffUsers');
      return staff;
    }
  });
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition} staff search returns username delivery email without changing scope or exposing credentials`, async () => {
    const staff = [
      { Username: 'staff@example.com', DisplayName: 'Staff Member', OrganisationEdition: edition, BranchId: 'main',
        SchoolSectionAccess: 'All', PasswordHash: 'must-not-leak', Salt: 'private' },
      { Username: 'another-branch@example.com', DisplayName: 'Staff Member', OrganisationEdition: edition, BranchId: 'elsewhere' },
      { Username: 'another-edition@example.com', DisplayName: 'Staff Member', OrganisationEdition: edition === 'school' ? 'faith' : 'school', BranchId: 'main' }
    ];
    const user = { role: 'Super Admin', edition, username: 'admin' };
    const scope = { edition, branchId: 'main', schoolSection: edition === 'school' ? 'secondary' : '' };
    const search = directorySearch(staff);
    const result = await search({}, { type: 'staff', query: 'staff' }, executiveOfficeCapabilities(user, edition), scope, user);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].id, 'staff@example.com');
    assert.equal(result.results[0].email, 'staff@example.com');
    assert.equal(result.results[0].branchId, 'main');
    assert.doesNotMatch(JSON.stringify(result), /must-not-leak|private|another-branch|another-edition/);
    assert.equal(Object.hasOwn(staff[0], 'Email'), false);
    staff[0].Email = 'office@example.com';
    assert.equal((await search({}, { type: 'staff', query: 'staff@example.com' }, executiveOfficeCapabilities(user, edition), scope, user)).results[0].email, 'office@example.com');
  });
}

test('web compose reads the resolved staff email and keeps manual delivery-email overrides', () => {
  const start = adminSource.indexOf('function executiveRecordEmail(');
  const end = adminSource.indexOf('function executiveRecordType(', start);
  const readEmail = runInNewContext(`${adminSource.slice(start, end)}\nexecutiveRecordEmail`, {
    clean, pick: (row, keys) => keys.map((key) => row[key]).find((value) => clean(value)) || ''
  });
  assert.equal(readEmail({ type: 'staff', email: staffDeliveryEmail({ Username: 'staff@example.com' }) }), 'staff@example.com');
  assert.equal(readEmail({ type: 'student', ParentEmail: 'parent@example.com', Username: 'unrelated@example.com' }), 'parent@example.com');
  assert.match(adminSource, /payload\.recipientEmail = clean\(payload\.directoryRecipientEmail\) \|\| executiveRecordEmail\(executiveSelectedRecipient\)/);
  const draft = normalizeCorrespondenceDraft({
    CorrespondenceId: 'COR-TEST', Kind: 'official-letter', Subject: 'Notice', Body: 'Body',
    RecipientType: 'staff', RecipientId: 'staff@example.com', RecipientName: 'Staff Member',
    RecipientEmail: 'override@example.com'
  }, { edition: 'school' });
  assert.equal(draft.RecipientEmail, 'override@example.com');
});
