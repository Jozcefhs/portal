import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  FAITH_ONLY_STAFF_ROLES,
  NON_SCHOOL_OPERATION_ROLES,
  SCHOOL_ONLY_SECTION_KEYS,
  SCHOOL_ONLY_STAFF_ROLES,
  featureFlagsForEdition,
  featureFlagsForPlan,
  filterSectionsForFeatures,
  normalizeOrganizationEdition,
  organizationProfileDocument,
  resolveOrganizationConfig,
  staffRoleAllowedForEdition
} from '../functions/lib/organization-config.js';
import {
  allowedSectionsFor,
  sectionAccessFor,
  staffUserForAccess
} from '../functions/lib/staff-auth.js';
import {
  buildOfferingJournalDraft,
  CHURCH_ACCOUNTING_TARGET,
  CHURCH_COLLECTIONS,
  churchCollectionPath,
  normalizeOfferingDraft
} from '../functions/lib/church-foundation.js';

test('missing and invalid editions remain school for backward compatibility', () => {
  assert.equal(normalizeOrganizationEdition(), 'school');
  assert.equal(normalizeOrganizationEdition('invalid'), 'school');
  const config = resolveOrganizationConfig({
    legacyProfile: { SchoolName: 'Existing School', SchoolCode: 'DCA' }
  });
  assert.equal(config.Edition, 'school');
  assert.equal(config.Name, 'Existing School');
  assert.equal(config.Code, 'DCA');
  assert.equal(config.FeatureFlags.admissions, true);
  assert.equal(config.FeatureFlags.offerings, false);
});

test('environment edition is authoritative over the database organisation profile', () => {
  assert.throws(
    () => resolveOrganizationConfig({
      env: { ORGANISATION_EDITION: 'school' },
      organizationProfile: { Edition: 'church', Name: 'Wrong workspace' }
    }),
    (error) => error.status === 503 && error.code === 'DEPLOYMENT_PROFILE_EDITION_CONFLICT'
  );
  assert.equal(resolveOrganizationConfig({
    env: { ORGANISATION_EDITION: 'faith' },
    organizationProfile: { Edition: 'church', Name: 'Grace Assembly' }
  }).Edition, 'faith');
});

test('church is canonicalized to faith while retaining shared finance modules', () => {
  assert.equal(normalizeOrganizationEdition('church'), 'faith');
  const flags = featureFlagsForEdition('church');
  assert.equal(flags.accounting, true);
  assert.equal(flags.payroll, true);
  assert.equal(flags.approvals, true);
  assert.equal(flags.executiveOffice, true);
  assert.equal(flags.humanResources, true);
  assert.equal(flags.members, true);
  assert.equal(flags.services, true);
  assert.equal(flags.funds, true);
  assert.equal(flags.offerings, true);
  assert.equal(flags.donations, true);
  assert.equal(flags.retail, true);
  assert.equal(flags.restaurant, true);
  assert.equal(flags.admissions, false);
  assert.deepEqual(
    filterSectionsForFeatures(
      ['admissions', 'students', 'humanResources', 'financeRequests', 'payroll', 'staffUsers'],
      flags
    ),
    ['humanResources', 'financeRequests', 'payroll', 'staffUsers']
  );
  assert.deepEqual(
    allowedSectionsFor({ role: 'Super Admin' }, flags),
    ['recordsDesk', 'executiveOffice', 'incomeAnalytics', 'members', 'services', 'funds', 'offerings', 'donations', 'financeRequests', 'payroll', 'organizationStore', 'restaurant', 'staffUsers', 'humanResources']
  );
});

test('church staff role defaults respect the membership privacy boundary', () => {
  const flags = featureFlagsForEdition('church');
  assert.deepEqual(allowedSectionsFor({ role: 'Membership Officer' }, flags), ['recordsDesk', 'members', 'services', 'humanResources']);
  assert.equal(allowedSectionsFor({ role: 'Pastor' }, flags).includes('members'), true);
  assert.equal(allowedSectionsFor({ role: 'Treasurer' }, flags).includes('members'), false);
  assert.equal(allowedSectionsFor({ role: 'Auditor' }, flags).includes('members'), false);
  assert.equal(allowedSectionsFor({ role: 'HR Manager' }, flags).includes('humanResources'), true);
});

test('known feature overrides are normalized and unknown flags are discarded', () => {
  const flags = featureFlagsForEdition('church', {
    payroll: 'NO',
    offerings: 'YES',
    inventedFeature: true
  });
  assert.equal(flags.payroll, false);
  assert.equal(flags.offerings, true);
  assert.equal(flags.donations, true);
  assert.equal(Object.hasOwn(flags, 'inventedFeature'), false);
});

test('subscription plans enforce module entitlements in addition to organisation edition', () => {
  const starterSchool = featureFlagsForPlan('school', 'Starter');
  assert.equal(starterSchool.students, true);
  assert.equal(starterSchool.parentPortal, true);
  assert.equal(starterSchool.accounting, false);
  assert.equal(starterSchool.payroll, false);

  const standardChurch = featureFlagsForPlan('faith', 'Standard');
  assert.equal(standardChurch.members, true);
  assert.equal(standardChurch.offerings, true);
  assert.equal(standardChurch.accounting, true);
  assert.equal(standardChurch.payroll, false);
  assert.equal(standardChurch.retail, false);

  const professionalChurch = featureFlagsForPlan('faith', 'Professional');
  assert.equal(professionalChurch.payroll, true);
  assert.equal(professionalChurch.retail, true);
  assert.equal(professionalChurch.admissions, false);
});

test('a plan upgrade is not blocked by calculated flags saved by an older release', () => {
  const upgraded = resolveOrganizationConfig({
    organizationProfile: {
      Edition: 'school',
      Plan: 'Standard',
      FeatureFlags: { accounting: false, humanResources: false }
    }
  });
  assert.equal(upgraded.FeatureFlags.accounting, true);
  assert.equal(upgraded.FeatureFlags.humanResources, true);

  const explicitlyDisabled = resolveOrganizationConfig({
    organizationProfile: {
      Edition: 'school',
      Plan: 'Standard',
      FeatureOverrides: { accounting: false }
    }
  });
  assert.equal(explicitlyDisabled.FeatureFlags.accounting, false);
});

test('staff access separates plan-restricted modules from role-denied modules', () => {
  const starterSchool = resolveOrganizationConfig({
    organizationProfile: {
      Edition: 'school',
      Plan: 'Starter',
      Name: 'Starter School'
    }
  });
  const access = sectionAccessFor({ role: 'Super Admin' }, starterSchool);
  assert.equal(access.subscriptionPlan, 'Starter');
  assert.equal(access.allowedSections.includes('students'), true);
  assert.equal(access.allowedSections.includes('accounts'), false);
  assert.equal(access.restrictedSections.includes('accounts'), true);
  assert.equal(access.restrictedSections.includes('incomeAnalytics'), true);
  assert.equal(access.restrictedSections.includes('staffUsers'), false);

  const principal = sectionAccessFor({ role: 'Principal' }, starterSchool);
  assert.equal(principal.availableSections.includes('accounts'), false);
  assert.equal(principal.restrictedSections.includes('accounts'), false);
});

test('web staff navigation displays plan restrictions as disabled grey modules', async () => {
  const [adminSource, css] = await Promise.all([
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);
  assert.match(adminSource, /restrictedSections/);
  assert.match(adminSource, /disabled aria-disabled="true"/);
  assert.match(adminSource, /Upgrade plan/);
  assert.match(css, /\.subscription-restricted/);
});

test('school-only modules cannot be re-enabled by church feature overrides', () => {
  const flags = featureFlagsForEdition('church', {
    admissions: true,
    students: true,
    stores: true,
    clinic: true,
    kitchen: true
  });
  for (const feature of ['admissions', 'students', 'stores', 'clinic', 'kitchen']) {
    assert.equal(flags[feature], false);
  }
});

test('church staff configuration rejects school-only roles and section permissions', () => {
  for (const role of SCHOOL_ONLY_STAFF_ROLES) {
    assert.equal(staffRoleAllowedForEdition(role, 'faith'), false);
    assert.equal(staffRoleAllowedForEdition(role, 'school'), true);
  }
  assert.equal(staffRoleAllowedForEdition('Church Administrator', 'faith'), true);
  const flags = featureFlagsForEdition('faith');
  const scoped = staffUserForAccess({
    schoolSectionAccess: 'Primary',
    approvalAccounts: ['1100', '4140'],
    biometricLookupEnabled: true,
    tabAccess: [...SCHOOL_ONLY_SECTION_KEYS, 'offerings']
  }, {
    edition: 'faith',
    featureFlags: flags,
    allowedSections: ['offerings']
  });
  assert.equal(scoped.schoolSectionAccess, '');
  assert.deepEqual(scoped.approvalAccounts, ['4140']);
  assert.equal(scoped.biometricLookupEnabled, false);
  assert.deepEqual(scoped.tabAccess, ['offerings']);
});

test('school and church role catalogues reject each others terminology', () => {
  for (const role of FAITH_ONLY_STAFF_ROLES) {
    assert.equal(staffRoleAllowedForEdition(role, 'school'), false);
    assert.equal(staffRoleAllowedForEdition(role, 'faith'), true);
  }
  for (const role of NON_SCHOOL_OPERATION_ROLES) {
    assert.equal(staffRoleAllowedForEdition(role, 'school'), false);
    assert.equal(staffRoleAllowedForEdition(role, 'faith'), true);
  }
  assert.equal(staffRoleAllowedForEdition('Principal', 'faith'), false);
  assert.equal(staffRoleAllowedForEdition('Senior Pastor', 'school'), false);
  assert.equal(staffRoleAllowedForEdition('Church Administrator', 'school'), false);
});

test('organisation document stores canonical edition identity and flags', () => {
  const document = organizationProfileDocument({
    Edition: 'church',
    WorkspaceId: 'grace-faith',
    Name: 'Grace Assembly',
    Code: 'grace-01'
  }, { UpdatedAt: '2026-07-24T10:00:00.000Z', UpdatedBy: 'Admin' });
  assert.equal(document.WorkspaceId, 'grace-faith');
  assert.equal(document.Edition, 'faith');
  assert.equal(document.Name, 'Grace Assembly');
  assert.equal(document.Code, 'GRACE01');
  assert.equal(document.FeatureFlags.offerings, true);
  assert.equal(document.UpdatedBy, 'Admin');
});

test('church records use branch-aware organisation paths', () => {
  assert.equal(
    churchCollectionPath(CHURCH_COLLECTIONS.services, 'Lagos Mainland'),
    'organisationBranches/lagos-mainland/churchServices'
  );
  assert.throws(() => churchCollectionPath('ledger', 'main'), /Unknown church collection/);
});

test('offering drafts target the existing accounting journal contract', () => {
  const offering = normalizeOfferingDraft({
    OfferingId: 'OFF-001',
    BranchId: 'Main',
    ServiceId: 'SUN-AM',
    FundId: 'GENERAL',
    Date: '2026-07-24',
    Amount: '25,000',
    RecordedBy: 'Treasurer'
  });
  assert.equal(offering.AccountingStatus, 'Unposted');
  assert.equal(offering.TotalAmount, 25000);
  assert.equal(CHURCH_ACCOUNTING_TARGET, 'accountingJournals');

  const journal = buildOfferingJournalDraft(offering, {
    DebitAccountCode: '1010',
    CreditAccountCode: '4100'
  });
  assert.equal(journal.Source, 'Church Offering');
  assert.equal(journal.SourceId, 'OFF-001');
  assert.equal(journal.Status, 'Draft');
  assert.deepEqual(journal.Lines.map((line) => [line.Debit, line.Credit]), [
    [25000, 0],
    [0, 25000]
  ]);
});

test('public organisation registration stays aligned and legible in both themes', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../register-organization.html', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);
  assert.match(html, /name="theme-color"/);
  assert.match(html, /20260806-pricing-book-download/);
  assert.match(css, /\.auth-page\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.organisation-registration-card\s+\.inline-check\s*\{[^}]*white-space:\s*normal/s);
  assert.match(css, /html\[data-theme="dark"\]\s+\.organisation-registration-card\s*\{[^}]*background:\s*#111e2e/s);
  assert.match(css, /html\[data-theme="dark"\]\s+\.organisation-registration-card\s+\.settings-field label/);
  assert.match(css, /html\[data-theme="dark"\]\s+\.plan-choice-card/);
  assert.match(css, /@media \(max-width:\s*700px\)[\s\S]*?\.plan-choice-grid\s*\{[^}]*grid-auto-flow:\s*column[^}]*overflow-x:\s*auto/);
});
