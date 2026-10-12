import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { featureFlagsForEdition } from '../functions/lib/organization-config.js';
import { allowedSectionsFor, sectionAccessFor } from '../functions/lib/staff-auth.js';
import {
  configuredModulesForUser, defaultModulesForRole, roleAccessView, rolesForEdition,
  withRoleModules, withoutRoleModules
} from '../functions/lib/role-module-access.js';

const editions = ['school', 'faith', 'organization'];
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');

for (const edition of editions) {
  const flags = featureFlagsForEdition(edition);
  const organization = { Edition: edition, FeatureFlags: flags, PlanFeatureFlags: flags };
  test(`${edition}: account additions preserve every system role default`, () => {
    for (const role of rolesForEdition(edition).filter(role => !['Vendor User', 'External Auditor'].includes(role))) {
      const user = { role, department: edition === 'school' ? 'Clinic' : 'Catering', tabAccess: ['incomeAnalytics'] };
      const before = JSON.stringify(user);
      const actual = allowedSectionsFor(user, flags, { edition });
      const defaults = defaultModulesForRole(role, { edition, featureFlags: flags, department: user.department });
      for (const key of defaults) assert.ok(actual.includes(key), `${role}: lost ${key}`);
      assert.ok(actual.includes('incomeAnalytics'));
      assert.equal(new Set(actual).size, actual.length);
      assert.equal(JSON.stringify(user), before, 'inherited modules must not be persisted as individual extras');
    }
  });

  test(`${edition}: saved role changes reach officers who already have extra modules`, () => {
    const user = { role: 'Procurement Officer', branchId: 'main', tabAccess: ['incomeAnalytics'] };
    const initial = { Scopes: { global: { [user.role]: ['staffAttendance'] }, main: { [user.role]: ['humanResources'] } } };
    const before = JSON.stringify(initial);
    const first = sectionAccessFor(user, organization, initial).allowedSections;
    assert.ok(first.includes('procurement'), 'legacy saved policy still inherits core Procurement');
    assert.ok(first.includes('humanResources'));
    assert.ok(first.includes('incomeAnalytics'));
    assert.ok(!first.includes('staffAttendance'), 'branch policy overrides global policy');

    const updated = { Scopes: withRoleModules(initial, 'main', user.role, ['staffAttendance'], edition, flags) };
    const next = sectionAccessFor(user, organization, updated).allowedSections;
    assert.ok(next.includes('staffAttendance'));
    assert.ok(next.includes('incomeAnalytics'));
    assert.ok(next.includes('procurement'));
    assert.ok(!next.includes('humanResources'), 'removed inherited modules are not pinned by extras');
    assert.equal(JSON.stringify(initial), before);

    const reset = { Scopes: withoutRoleModules(updated, 'main', user.role) };
    assert.deepEqual(sectionAccessFor(user, organization, reset).allowedSections, next);
    const otherBranch = sectionAccessFor({ ...user, branchId: 'east' }, organization, initial).allowedSections;
    assert.ok(otherBranch.includes('staffAttendance'));
    assert.ok(!otherBranch.includes('humanResources'));
  });

  test(`${edition}: explicit empty role policy is respected and Recruitment stays distinct`, () => {
    const role = 'Recruitment Officer';
    const policy = { Scopes: { main: { [role]: [] } } };
    const user = { role, branchId: 'main', TabAccess: ['incomeAnalytics'] };
    const sections = sectionAccessFor(user, organization, policy).allowedSections;
    assert.deepEqual(new Set(sections), new Set(['incomeAnalytics', 'financeRequests', 'payroll']));
    assert.ok(!defaultModulesForRole(role, { edition, featureFlags: flags }).includes('procurement'));
    const extra = sectionAccessFor({ ...user, TabAccess: ['procurement'] }, organization, policy).allowedSections;
    assert.ok(extra.includes('procurement'), 'administrators may explicitly grant an extra module');
    assert.ok(!extra.includes('humanResources'), 'custom selection must not silently add HR');
  });

  test(`${edition}: required Procurement follows feature, plan and subscription limits`, () => {
    const role = 'Procurement Officer';
    const user = { role, branchId: 'main', tabAccess: ['procurement', 'incomeAnalytics'] };
    const policy = { Scopes: { main: { [role]: [] } } };
    const off = { ...flags, procurement: false };
    const disabled = sectionAccessFor(user, { ...organization, FeatureFlags: off }, policy);
    assert.ok(!disabled.allowedSections.includes('procurement'));
    assert.ok(disabled.disabledSections.includes('procurement'));
    const restricted = sectionAccessFor(user, { ...organization, FeatureFlags: off, PlanFeatureFlags: off }, policy);
    assert.ok(restricted.restrictedSections.includes('procurement'));
    assert.deepEqual(sectionAccessFor(user, { ...organization, SubscriptionActive: false }, policy).allowedSections, []);
    const modules = configuredModulesForUser(policy, user, role, edition, flags);
    assert.ok(modules.includes('procurement'));
    assert.ok(roleAccessView(policy, user, edition, flags).roles[role].modules.includes('procurement'));
    assert.ok(!roleAccessView(policy, user, edition, off).roles[role].modules.includes('procurement'));
  });

  test(`${edition}: additional grants preserve restricted account boundaries`, () => {
    const extras = ['procurement', 'staffUsers', 'dataBackup', 'securityAudit', 'students', 'offerings'];
    for (const role of ['Vendor User', 'External Auditor']) {
      assert.deepEqual(allowedSectionsFor({ assignedRole: role, role, tabAccess: extras }, flags, { edition, roleModules: extras }),
        defaultModulesForRole(role, { edition, featureFlags: flags }));
    }
    for (const role of ['Admin', 'Management']) {
      const sections = allowedSectionsFor({ role, assignedRole: 'Admin', tabAccess: extras }, flags, { edition, roleModules: extras });
      for (const key of ['staffUsers', 'dataBackup', 'securityAudit']) assert.ok(!sections.includes(key));
      assert.ok(!sections.includes(edition === 'school' ? 'offerings' : 'students'));
    }
  });
}

test('legacy delimited extras are additive and invalid/duplicate modules are ignored', () => {
  const modules = allowedSectionsFor({ Role: 'Teacher', TabAccess: 'library; incomeAnalytics, library, bogus' }, featureFlagsForEdition('school'));
  assert.ok(modules.includes('academics'));
  assert.ok(modules.includes('library'));
  assert.ok(modules.includes('incomeAnalytics'));
  assert.ok(!modules.includes('bogus'));
  assert.equal(modules.filter(key => key === 'library').length, 1);
});

test('role editor shows mandatory Procurement, distinguishes Recruitment, and locks restricted roles', () => {
  const inputs = ['procurement', 'humanResources', 'payroll', 'financeRequests', 'externalAudit', 'vendorSettlements', 'tuckShop']
    .map(value => ({ value, checked: false, disabled: false, closest: () => ({ setAttribute() {}, removeAttribute() {} }) }));
  const elements = { roleAccessRole: {}, roleAccessSource: {}, resetRoleAccess: {} };
  const context = vm.createContext({
    staffRoleAccessSelectedRole: '',
    staffRoleAccessData: roleAccessView(null, { branchId: 'main' }, 'school', featureFlagsForEdition('school')),
    document: { getElementById: id => elements[id], querySelectorAll: () => inputs }
  });
  vm.runInContext(admin.slice(admin.indexOf('function renderRoleAccessEditor('), admin.indexOf('function syncSchoolLeadershipRoleOptions(')), context);
  context.renderRoleAccessEditor('Procurement Officer');
  assert.ok(inputs[0].checked && inputs[0].disabled);
  assert.match(elements.roleAccessSource.textContent, /Procurement is always included/);
  context.renderRoleAccessEditor('Recruitment Officer');
  assert.ok(!inputs[0].checked && !inputs[0].disabled);
  assert.match(elements.roleAccessSource.textContent, /Recruitment Officer is an HR role/);
  context.renderRoleAccessEditor('Vendor User');
  assert.ok(inputs.every(input => input.disabled));
  assert.deepEqual(inputs.filter(input => input.checked).map(input => input.value), ['vendorSettlements', 'tuckShop']);
  context.renderRoleAccessEditor('External Auditor');
  assert.deepEqual(inputs.filter(input => input.checked).map(input => input.value), ['externalAudit']);
});

test('staff editor describes and saves only explicit extras using the edition-aware catalogue', () => {
  assert.match(admin, /Additional module access/);
  assert.match(admin, /Unchecked boxes do not remove role access/);
  assert.doesNotMatch(admin, /Optional user-specific override/);
  assert.match(admin, /const permissionTabs = policyModules\.map/);
  assert.match(admin, /payload\.TabAccess = Array\.from\(form\.querySelectorAll\('\[name="TabAccessOption"\]:checked'\)\)\.map/);
});
