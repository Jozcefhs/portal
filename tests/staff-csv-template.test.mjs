import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { inferStaffNameParts, staffImportIdentity } from '../functions/api/staff-users.js';

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

test('legacy staff display names can be conservatively split using the configured order', () => {
  assert.deepEqual(
    inferStaffNameParts('Okafor Ada Grace', { NameFormat: 'Surname, first name, middle name' }),
    { FirstName: 'Ada', MiddleName: 'Grace', Surname: 'Okafor' }
  );
  assert.deepEqual(
    inferStaffNameParts('Ada Okafor', { NameFormat: 'First name, middle name, surname' }),
    { FirstName: 'Ada', MiddleName: '', Surname: 'Okafor' }
  );
});

test('ambiguous legacy staff display names are left for manual review', () => {
  assert.equal(inferStaffNameParts('Ada'), null);
  assert.equal(inferStaffNameParts('Dr Ada Grace Nneka Okafor'), null);
});

test('downloadable staff templates use separate name columns', async () => {
  const [template, adminSource] = await Promise.all([
    readFile(new URL('../templates/staff_import_template.csv', import.meta.url), 'utf8'),
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
  ]);
  const expectedNames = 'Username,FirstName,Surname,MiddleName';
  assert.ok(template.startsWith(expectedNames));
  assert.match(adminSource, /Username,FirstName,Surname,MiddleName,Role/);
  assert.doesNotMatch(template.split(/\r?\n/, 1)[0], /DisplayName/);
  assert.match(adminSource, /name="FirstName"[^>]*required/);
  assert.match(adminSource, /name="Surname"[^>]*required/);
  assert.match(adminSource, /name="MiddleName"/);
  assert.match(adminSource, /staffUserRequest\('migrate-names'\)/);
});
