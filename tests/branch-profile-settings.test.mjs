import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  applyBranchProfileOverrides,
  BRANCH_PROFILE_OVERRIDE_FIELDS,
  deriveBranchProfileOverrides,
  mergeBranchProfileSubmission
} from '../functions/lib/branch-profile-settings.js';

test('branch profiles store only differences from organisation defaults', () => {
  const defaults = {
    SchoolName: 'Dynamax Academy',
    SchoolEmail: 'office@example.org',
    SchoolPhone: '08000000000',
    SubscriptionPlan: 'Professional'
  };
  const values = deriveBranchProfileOverrides(defaults, {
    SchoolName: 'Dynamax Academy',
    SchoolEmail: 'branch@example.org',
    SchoolPhone: '08000000000',
    SubscriptionPlan: 'Free'
  });

  assert.deepEqual(values, { SchoolEmail: 'branch@example.org' });
  assert.equal(BRANCH_PROFILE_OVERRIDE_FIELDS.includes('SubscriptionPlan'), false);
});

test('effective branch settings preserve explicit blank overrides and inheritance metadata', () => {
  const effective = applyBranchProfileOverrides({
    SchoolEmail: 'office@example.org',
    SchoolPhone: '08000000000',
    SchoolSignatoryName: 'Organisation Signatory'
  }, {
    OverrideFields: ['SchoolEmail', 'SchoolSignatoryName', 'SubscriptionPlan'],
    Values: {
      SchoolEmail: 'branch@example.org',
      SchoolSignatoryName: '',
      SubscriptionPlan: 'Free'
    }
  }, 'North Campus');

  assert.equal(effective.SchoolEmail, 'branch@example.org');
  assert.equal(effective.SchoolPhone, '08000000000');
  assert.equal(effective.SchoolSignatoryName, '');
  assert.equal(effective.SubscriptionPlan, undefined);
  assert.equal(effective.SettingsScope, 'branch');
  assert.equal(effective.EffectiveBranchId, 'north-campus');
  assert.deepEqual(effective.BranchOverrideFields, ['SchoolEmail', 'SchoolSignatoryName']);
});

test('partial branch updates preserve previously saved web-only content', () => {
  const submitted = mergeBranchProfileSubmission({
    OverrideFields: ['PortalNotice', 'SchoolEmail'],
    Values: {
      PortalNotice: 'Admission closes on Friday.',
      SchoolEmail: 'branch@example.org'
    }
  }, {
    SchoolEmail: 'new-branch@example.org'
  });

  assert.deepEqual(submitted, {
    PortalNotice: 'Admission closes on Friday.',
    SchoolEmail: 'new-branch@example.org'
  });
});

test('organisation editions tolerate a missing legacy school profile', () => {
  const effective = applyBranchProfileOverrides(null, null, 'Main Branch');

  assert.equal(effective.SettingsScope, 'branch');
  assert.equal(effective.EffectiveBranchId, 'main-branch');
  assert.equal(effective.SchoolName, undefined);
  assert.equal(effective.OrganisationDefaults.SchoolName, '');
  assert.deepEqual(effective.BranchOverrideFields, []);
});

test('web and desktop settings use the same branch-effective profile contract', async () => {
  const [settingsApi, backendApi, setupScript, desktopSource] = await Promise.all([
    readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/setup.js', import.meta.url), 'utf8'),
    readFile(new URL('../../suite/main.py', import.meta.url), 'utf8')
  ]);

  assert.match(settingsApi, /saveBranchProfileOverrides/);
  assert.match(settingsApi, /resetBranchProfileOverrides/);
  assert.match(backendApi, /case 'resetBranchProfileOverrides'/);
  assert.match(setupScript, /SettingsScope: settingsScopeField\.value/);
  assert.match(desktopSource, /"SettingsScope": "branch" if branch_settings else "organisation"/);
  assert.match(desktopSource, /def reset_selected_branch_settings/);
});
