import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHURCH_STAFF_ROLES,
  membershipCapabilities,
  normalizeChurchHousehold,
  normalizeChurchMember,
  publicChurchMember,
  resolveMembershipBranch
} from '../functions/lib/church-membership.js';

test('church roles are explicit and finance-only roles cannot browse member records', () => {
  assert.deepEqual(CHURCH_STAFF_ROLES, [
    'Pastor', 'Church Administrator', 'Membership Officer', 'Treasurer', 'Auditor'
  ]);
  assert.equal(membershipCapabilities({ role: 'Pastor' }).canViewPastoralNotes, true);
  assert.equal(membershipCapabilities({ role: 'Membership Officer' }).canEditMembers, true);
  assert.equal(membershipCapabilities({ role: 'Membership Officer' }).canViewPastoralNotes, false);
  assert.equal(membershipCapabilities({ role: 'Treasurer' }).canView, false);
  assert.equal(membershipCapabilities({ role: 'Auditor' }).canView, false);
});

test('assigned staff branch overrides an omitted request and rejects cross-branch access', () => {
  assert.equal(resolveMembershipBranch({ branchId: 'Lagos Mainland' }, ''), 'lagos-mainland');
  assert.equal(resolveMembershipBranch({}, 'Abuja'), 'abuja');
  assert.throws(
    () => resolveMembershipBranch({ branchId: 'main' }, 'another-branch'),
    /restricted to another church branch/i
  );
});

test('member records normalize identity, contact and membership fields', () => {
  const member = normalizeChurchMember({
    MemberId: 'MEM-001',
    FirstName: 'Ada',
    Surname: 'Okafor',
    Email: ' ADA@EXAMPLE.COM ',
    MembershipStatus: 'Active',
    HouseholdId: 'HH-001'
  }, 'Main');
  assert.equal(member.DisplayName, 'Ada Okafor');
  assert.equal(member.Email, 'ada@example.com');
  assert.equal(member.BranchId, 'main');
  assert.equal(member.HouseholdId, 'HH-001');
});

test('member validation requires stable ID, name and valid email', () => {
  assert.throws(() => normalizeChurchMember({ DisplayName: 'Ada' }), /MemberId/);
  assert.throws(() => normalizeChurchMember({ MemberId: 'MEM-1' }), /name/);
  assert.throws(
    () => normalizeChurchMember({ MemberId: 'MEM-1', DisplayName: 'Ada', Email: 'invalid' }),
    /valid member email/
  );
});

test('pastoral notes are hidden from non-pastoral membership roles', () => {
  const row = { MemberId: 'MEM-1', DisplayName: 'Ada', PastoralNotes: 'Private care note' };
  const membershipOfficer = publicChurchMember(row, membershipCapabilities({ role: 'Membership Officer' }));
  const pastor = publicChurchMember(row, membershipCapabilities({ role: 'Pastor' }));
  assert.equal(Object.hasOwn(membershipOfficer, 'PastoralNotes'), false);
  assert.equal(pastor.PastoralNotes, 'Private care note');
});

test('households require a stable ID and display name', () => {
  const household = normalizeChurchHousehold({
    HouseholdId: 'HH-001',
    HouseholdName: 'Okafor Family',
    Email: ' FAMILY@EXAMPLE.COM '
  }, 'Main');
  assert.equal(household.BranchId, 'main');
  assert.equal(household.Email, 'family@example.com');
  assert.throws(() => normalizeChurchHousehold({ HouseholdName: 'No ID' }), /HouseholdId/);
});
