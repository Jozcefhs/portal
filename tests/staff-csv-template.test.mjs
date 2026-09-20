import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  STAFF_IMPORT_REQUIRED_COLUMNS,
  requiredStaffImportIdentity,
  staffImportIdentity
} from '../functions/api/staff-users.js';

test('staff CSV split names follow the configured display-name order', () => {
  assert.deepEqual(
    staffImportIdentity(
      { FirstName: 'Ada', Surname: 'Okafor', MiddleName: 'Grace' },
      {},
      { NameFormat: 'First name, middle name, surname' }
    ),
    {
      FirstName: 'Ada',
      MiddleName: 'Grace',
      Surname: 'Okafor',
      DisplayName: 'Ada Grace Okafor'
    }
  );
});

test('staff CSV keeps legacy DisplayName uploads compatible', () => {
  assert.deepEqual(
    staffImportIdentity({ DisplayName: 'Example User' }),
    { FirstName: '', MiddleName: '', Surname: '', DisplayName: 'Example User' }
  );
});

test('staff CSV accepts LastName as a Surname alias', () => {
  assert.deepEqual(
    staffImportIdentity({ FirstName: 'Ada', LastName: 'Okafor', OtherName: 'Grace' }),
    { FirstName: 'Ada', MiddleName: 'Grace', Surname: 'Okafor', DisplayName: 'Okafor Ada Grace' }
  );
});

test('legacy staff display names are never reinterpreted using the display order', () => {
  assert.deepEqual(
    staffImportIdentity(
      { DisplayName: 'Okafor Ada Grace' },
      {},
      { NameFormat: 'First name, middle name, surname' }
    ),
    { FirstName: '', MiddleName: '', Surname: '', DisplayName: 'Okafor Ada Grace' }
  );
});

test('downloadable staff templates require only username, first name and surname', async () => {
  const [template, adminSource, apiSource] = await Promise.all([
    readFile(new URL('../templates/staff_import_template.csv', import.meta.url), 'utf8'),
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8')
  ]);
  const expectedNames = 'Username,FirstName,Surname,MiddleName';
  assert.ok(template.startsWith(expectedNames));
  assert.match(adminSource, /Username,FirstName,Surname,MiddleName,Role/);
  assert.doesNotMatch(template.split(/\r?\n/, 1)[0], /DisplayName/);
  assert.match(adminSource, /name="FirstName"[^>]*required/);
  assert.match(adminSource, /name="Surname"[^>]*required/);
  assert.match(adminSource, /name="MiddleName"/);
  assert.doesNotMatch(adminSource, /inferStaffNameFields/);
  assert.doesNotMatch(adminSource, /id="migrateStaffNames"/);
  assert.deepEqual(STAFF_IMPORT_REQUIRED_COLUMNS, ['Username', 'FirstName', 'Surname']);
  assert.deepEqual(requiredStaffImportIdentity({
    Username: 'ada.okafor', FirstName: 'Ada', Surname: 'Okafor'
  }), { Username: 'ada.okafor', FirstName: 'Ada', Surname: 'Okafor' });
  assert.throws(
    () => requiredStaffImportIdentity({ Username: 'ada.okafor', FirstName: 'Ada' }),
    /Surname is required/
  );
  assert.match(adminSource, /STAFF_IMPORT_REQUIRED_COLUMNS = \['Username', 'FirstName', 'Surname'\]/);
  const importSource = apiSource.slice(apiSource.indexOf('async function importUsers'), apiSource.indexOf('async function deleteUser'));
  assert.doesNotMatch(importSource, /Password is required for a new staff account/);
  assert.doesNotMatch(importSource, /Department is required for a Department User/);
  assert.match(importSource, /PasswordSetupRequired: password \? false/);
  assert.match(importSource, /clean\(existing\?\.Role \|\| existing\?\.role\) \|\| 'Front Desk'/);
  assert.match(importSource, /clean\(row\.Active\) === ''/);
  assert.match(adminSource, /Staff CSV imports require only Username, FirstName and Surname/);
});
