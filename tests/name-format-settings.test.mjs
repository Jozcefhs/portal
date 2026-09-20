import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { displayNameForProfile } from '../functions/api/admin.js';
import { sessionStaffDisplayName } from '../functions/api/staff-session.js';
import { staffDisplayName } from '../functions/api/staff-users.js';
import {
  DEFAULT_NAME_FORMAT,
  formatPersonName,
  personNameFormatProfile
} from '../functions/lib/person-name-format.js';
import { organizationProfileDocument, resolveOrganizationConfig } from '../functions/lib/organization-config.js';

const [adminSource, backendSource, staffSource, sessionSource, settingsSource, organizationNameSource] = await Promise.all([
  readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/staff-session.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/organization-name-format.js', import.meta.url), 'utf8')
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

test('signed-in staff header uses the configured order without changing identity fields', () => {
  const original = structuredClone(person);
  assert.equal(
    sessionStaffDisplayName(person, { NameFormat: 'First name, middle name, surname' }),
    'Ada Grace Okafor'
  );
  assert.equal(
    sessionStaffDisplayName(person, { NameFormat: 'Surname, first name, middle name' }),
    'Okafor Ada Grace'
  );
  assert.deepEqual(person, original);
});

test('the organisation name format is edition-neutral and takes precedence over the legacy profile', () => {
  for (const edition of ['school', 'faith', 'organization']) {
    const organizationProfile = {
      Edition: edition,
      NameFormat: 'First name, middle name, surname'
    };
    assert.equal(
      personNameFormatProfile({
        organizationProfile,
        legacyProfile: { NameFormat: 'Surname, first name, middle name' }
      }).NameFormat,
      'First name, middle name, surname'
    );
    assert.equal(
      resolveOrganizationConfig({ organizationProfile }).NameFormat,
      'First name, middle name, surname'
    );
    assert.equal(
      organizationProfileDocument(organizationProfile).NameFormat,
      'First name, middle name, surname'
    );
    assert.equal(
      formatPersonName(person, personNameFormatProfile({ organizationProfile })),
      'Ada Grace Okafor'
    );
  }
});

test('legacy organisations retain their saved format until it is copied to the canonical profile', () => {
  assert.equal(
    personNameFormatProfile({ legacyProfile: { NameFormat: 'Middle name, surname, first name' } }).NameFormat,
    'Middle name, surname, first name'
  );
  assert.equal(personNameFormatProfile().NameFormat, DEFAULT_NAME_FORMAT);
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

test('all staff entry points resolve the edition-neutral organisation name format', () => {
  assert.match(organizationNameSource, /'organisationProfile'/);
  assert.match(organizationNameSource, /'schoolProfile'/);
  assert.match(staffSource, /loadOrganizationNameProfile\(env\)/);
  assert.match(sessionSource, /loadOrganizationNameProfile\((?:env|context\.env)\)/);
  assert.match(backendSource, /getStaffUsersForDesktop[\s\S]*loadOrganizationNameProfile\(env\)/);
  assert.match(backendSource, /saveStaffUserFromDesktop[\s\S]*loadOrganizationNameProfile\(env\)/);
  assert.match(settingsSource, /NameFormat: profile\.NameFormat/);
});

test('staff identity fields are never inferred from a formatted display name', () => {
  assert.doesNotMatch(staffSource, /inferStaffNameParts/);
  assert.match(staffSource, /Automatic splitting is disabled because the name-format setting only controls display order/);
  assert.doesNotMatch(adminSource, /inferStaffNameFields/);
});
