import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { displayNameForProfile } from '../functions/api/admin.js';
import { staffDisplayName } from '../functions/api/staff-users.js';

const [adminSource, backendSource, staffSource] = await Promise.all([
  readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8')
]);

const person = {
  FirstName: 'Ada',
  MiddleName: 'Grace',
  Surname: 'Okafor',
  DisplayName: 'stale stored name'
};

test('student names follow every configured split-name order without rewriting the record', () => {
  assert.equal(
    displayNameForProfile(person, { NameFormat: 'First name, middle name, surname' }),
    'Ada Grace Okafor'
  );
  assert.equal(
    displayNameForProfile(person, { NameFormat: 'Surname, first name, middle name' }),
    'Okafor Ada Grace'
  );
  assert.equal(
    displayNameForProfile(person, { NameFormat: 'Middle name, surname, first name' }),
    'Grace Okafor Ada'
  );
});

test('staff names use the same configured order', () => {
  const original = structuredClone(person);
  assert.equal(
    staffDisplayName(person, { NameFormat: 'First name, surname, middle name' }),
    'Ada Okafor Grace'
  );
  assert.equal(
    staffDisplayName(person, { NameFormat: 'Surname, middle name, first name' }),
    'Okafor Grace Ada'
  );
  assert.deepEqual(person, original);
});

test('legacy unsplit names remain intact instead of being guessed', () => {
  const legacy = { DisplayName: 'Dr Ada N. Okafor' };
  assert.equal(
    displayNameForProfile(legacy, { NameFormat: 'Surname, first name, middle name' }, legacy.DisplayName),
    'Dr Ada N. Okafor'
  );
  assert.equal(
    staffDisplayName(legacy, { NameFormat: 'First name, middle name, surname' }),
    'Dr Ada N. Okafor'
  );
});

test('web and desktop student/staff reads apply the current saved profile', () => {
  assert.match(adminSource, /studentWithConfiguredName\(row, schoolProfile \|\| \{\}\)/);
  assert.match(backendSource, /normalizeStudent\(row, profile \|\| \{\}\)/);
  assert.match(backendSource, /DisplayName: formatPersonName\(row, profile \|\| \{\}/);
  assert.match(staffSource, /listUsers\(staffRows, actor, profile \|\| \{\}\)/);
});

test('staff identity fields are never inferred from a formatted display name', () => {
  assert.doesNotMatch(staffSource, /inferStaffNameParts/);
  assert.match(staffSource, /Automatic splitting is disabled because the name-format setting only controls display order/);
  assert.doesNotMatch(adminSource, /inferStaffNameFields/);
});
