import test from 'node:test';
import assert from 'node:assert/strict';

import {
  featureFlagsForEdition,
  filterSectionsForFeatures,
  normalizeOrganizationEdition,
  organizationProfileDocument,
  resolveOrganizationConfig
} from '../functions/lib/organization-config.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';
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

test('church edition enables church boundaries while retaining shared finance modules', () => {
  const flags = featureFlagsForEdition('church');
  assert.equal(flags.accounting, true);
  assert.equal(flags.payroll, true);
  assert.equal(flags.approvals, true);
  assert.equal(flags.executiveOffice, true);
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
      ['admissions', 'students', 'financeRequests', 'payroll', 'staffUsers'],
      flags
    ),
    ['financeRequests', 'payroll', 'staffUsers']
  );
  assert.deepEqual(
    allowedSectionsFor({ role: 'Super Admin' }, flags),
    ['recordsDesk', 'executiveOffice', 'incomeAnalytics', 'members', 'services', 'funds', 'offerings', 'donations', 'financeRequests', 'payroll', 'organizationStore', 'restaurant', 'staffUsers']
  );
});

test('church staff role defaults respect the membership privacy boundary', () => {
  const flags = featureFlagsForEdition('church');
  assert.deepEqual(allowedSectionsFor({ role: 'Membership Officer' }, flags), ['recordsDesk', 'members', 'services']);
  assert.equal(allowedSectionsFor({ role: 'Pastor' }, flags).includes('members'), true);
  assert.equal(allowedSectionsFor({ role: 'Treasurer' }, flags).includes('members'), false);
  assert.equal(allowedSectionsFor({ role: 'Auditor' }, flags).includes('members'), false);
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

test('organisation document stores canonical edition identity and flags', () => {
  const document = organizationProfileDocument({
    Edition: 'church',
    Name: 'Grace Assembly',
    Code: 'grace-01'
  }, { UpdatedAt: '2026-07-24T10:00:00.000Z', UpdatedBy: 'Admin' });
  assert.equal(document.Edition, 'church');
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
