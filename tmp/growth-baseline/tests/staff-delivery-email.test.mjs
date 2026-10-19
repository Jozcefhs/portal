import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import {
  staffDeliveryEmail, studentParentDeliveryEmail, executiveOfficeCapabilities, visibleExecutiveStaffRow,
  normalizeCorrespondenceDraft, EXECUTIVE_TEMPLATE_TOKENS
} from '../functions/lib/executive-correspondence.js';
import { schoolSectionFor } from '../functions/lib/school-scope.js';

const source = await readFile(new URL('../functions/lib/executive-correspondence.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

test('staff delivery prefers a valid saved email and falls back only to email-style usernames', () => {
  for (const [row, expected] of [
    [{ Username: ' Teacher@Example.com ' }, 'teacher@example.com'],
    [{ Email: ' Saved@Example.com ', Username: 'login@example.com' }, 'saved@example.com'],
    [{ StaffEmail: 'staff@example.com', Username: 'login@example.com' }, 'staff@example.com'],
    [{ WorkEmail: 'work@example.com', Username: 'login@example.com' }, 'work@example.com'],
    [{ OfficialEmail: 'office@example.com', Username: 'login@example.com' }, 'office@example.com'],
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

function directorySearch(staff, students = []) {
  const start = source.indexOf('function searchText(');
  const end = source.indexOf('async function authoritativeRecipientTokens(', start);
  assert.ok(start >= 0 && end > start);
  const helpers = source.slice(source.indexOf('function boundText('), source.indexOf('function unknownTemplateTokens('))
    .replace(/^export /gm, '');
  const visibility = source.slice(source.indexOf('function visibleSchoolRow('), source.indexOf('export function visibleExecutiveStaffRow('));
  return runInNewContext(`${helpers}\n${visibility}\n${source.slice(start, end)}\nsearchDirectory`, {
    clean, lower, visibleExecutiveStaffRow, schoolSectionFor,
    TOKEN_SET: new Set(EXECUTIVE_TEMPLATE_TOKENS),
    inputError: (message) => new Error(message),
    listCollection: async (_env, path) => {
      assert.equal(path, 'staffUsers');
      return staff;
    },
    listSchoolCollection: async (_env, path) => { assert.equal(path, 'students'); return students; }
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

test('web compose resolves staff and parent emails without accepting ordinary usernames', () => {
  const start = adminSource.indexOf('function executiveValidEmail(');
  const end = adminSource.indexOf('function executiveRecordType(', start);
  const readEmail = runInNewContext(`${adminSource.slice(start, end)}\nexecutiveRecordEmail`, {
    clean, pick: (row, keys) => keys.map((key) => row[key]).find((value) => clean(value)) || ''
  });
  assert.equal(readEmail({ type: 'staff', email: staffDeliveryEmail({ Username: 'staff@example.com' }) }), 'staff@example.com');
  assert.equal(readEmail({ type: 'staff', Email: 'saved@example.com', Username: 'login@example.com' }), 'saved@example.com');
  assert.equal(readEmail({ type: 'staff', Email: 'admin', Username: 'login@example.com' }), 'login@example.com');
  assert.equal(readEmail({ type: 'staff', Username: 'admin' }), '');
  assert.equal(readEmail({ type: 'student', ParentEmail: 'parent@example.com', Email: 'child@example.com', Username: 'unrelated@example.com' }), 'parent@example.com');
  assert.equal(readEmail({ type: 'student', ParentEmail: 'invalid', VerificationEmail: 'verified-parent@example.com', Email: 'child@example.com' }), 'verified-parent@example.com');
  assert.equal(readEmail({ type: 'student', Email: 'child@example.com', Username: 'unrelated@example.com' }), '');
  assert.equal(readEmail({ type: 'student', email: 'resolved-parent@example.com' }), 'resolved-parent@example.com');
  assert.match(adminSource, /payload\.recipientEmail = executiveDeliveryEmail\(form, 'directoryRecipientEmail', executiveRecordEmail\(executiveSelectedRecipient\)\)/);
  const draft = normalizeCorrespondenceDraft({
    CorrespondenceId: 'COR-TEST', Kind: 'official-letter', Subject: 'Notice', Body: 'Body',
    RecipientType: 'staff', RecipientId: 'staff@example.com', RecipientName: 'Staff Member',
    RecipientEmail: 'override@example.com'
  }, { edition: 'school' });
  assert.equal(draft.RecipientEmail, 'override@example.com');
});

test('student directory resolves valid parent contacts and never uses the student login', async () => {
  for (const [fields, expected] of [
    [{ ParentEmail: ' Parent@Example.com ', Email: 'student@example.com' }, 'parent@example.com'],
    [{ ParentEmail: 'invalid', VerificationEmail: 'verified-parent@example.com' }, 'verified-parent@example.com'],
    [{ FatherEmail: 'father@example.com' }, 'father@example.com'],
    [{ MotherEmail: 'mother@example.com' }, 'mother@example.com'],
    [{ GuardianEmail: 'guardian@example.com' }, 'guardian@example.com'],
    [{ parentEmail: 'parent@example.com' }, 'parent@example.com'],
    [{ Email: 'student@example.com', Username: 'student-login@example.com' }, '']
  ]) {
    assert.equal(studentParentDeliveryEmail(fields), expected);
    const students = [
      { AdmissionNo: 'STUDENT-1', DisplayName: 'Example Student', BranchId: 'main', SchoolSection: 'Secondary', ...fields },
      { AdmissionNo: 'STUDENT-2', DisplayName: 'Example Student', BranchId: 'annex', SchoolSection: 'Secondary', ParentEmail: 'other-branch@example.com' },
      { AdmissionNo: 'STUDENT-3', DisplayName: 'Example Student', BranchId: 'main', SchoolSection: 'Primary', ParentEmail: 'other-section@example.com' }
    ];
    const user = { role: 'Principal', edition: 'school', username: 'admin' };
    const result = await directorySearch([], students)({}, { type: 'student', query: 'Example' }, executiveOfficeCapabilities(user, 'school'),
      { edition: 'school', branchId: 'main', schoolSection: 'secondary' }, user);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].email, expected);
    assert.equal(result.results[0].id, 'STUDENT-1');
  }
});

function deliveryField(initialEmail) {
  const field = { value: initialEmail, defaultValue: initialEmail, readOnly: false, listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; }, focus() {} };
  const button = { addEventListener(_type, callback) { this.click = callback; } };
  const form = { elements: { directoryRecipientEmail: field }, querySelector: () => button };
  const start = adminSource.indexOf('function executiveValidEmail(');
  const end = adminSource.indexOf('function executiveRecordMeta(', start);
  const helpers = runInNewContext(`${adminSource.slice(start, end)}\n({bindExecutiveDeliveryEmail, executiveDeliveryEmail, setExecutiveDeliveryEmail});`, { clean });
  helpers.bindExecutiveDeliveryEmail(form, 'directoryRecipientEmail');
  return { form, field, button, ...helpers };
}

test('saved login autofill cannot replace the selected staff or parent delivery address', () => {
  for (const address of ['staff@example.com', 'parent@example.com', '']) {
    const f = deliveryField(address);
    assert.equal(f.field.readOnly, true);
    f.field.value = 'admin';
    f.field.listeners.input();
    assert.equal(f.field.value, address);
    f.field.value = 'operator@example.com'; // Silent password-manager insertion is also ignored.
    assert.equal(f.executiveDeliveryEmail(f.form, 'directoryRecipientEmail'), address);
    assert.equal(f.field.value, address);
  }
});

test('explicit email changes are kept, validated, and reset when another recipient is selected', () => {
  const f = deliveryField('staff@example.com');
  f.button.click();
  assert.equal(f.field.readOnly, false);
  f.field.value = ' Override@Example.com ';
  f.field.listeners.input();
  f.field.listeners.blur();
  assert.equal(f.field.readOnly, true);
  assert.equal(f.executiveDeliveryEmail(f.form, 'directoryRecipientEmail'), 'override@example.com');
  f.button.click(); f.field.value = 'admin'; f.field.listeners.change(); f.field.listeners.blur();
  assert.throws(() => f.executiveDeliveryEmail(f.form, 'directoryRecipientEmail'), /valid delivery email/);
  f.setExecutiveDeliveryEmail(f.form, 'directoryRecipientEmail', 'parent@example.com');
  assert.equal(f.executiveDeliveryEmail(f.form, 'directoryRecipientEmail'), 'parent@example.com');
  assert.match(adminSource, /name="directoryRecipientEmail" readonly autocomplete="off"/);
  assert.match(adminSource, /bindExecutiveDeliveryEmail\(composer, 'directoryRecipientEmail'\)/);
  assert.match(adminSource, /payload\.recipientEmail = executiveDeliveryEmail\(form, 'recipientEmail'\)/);
});
