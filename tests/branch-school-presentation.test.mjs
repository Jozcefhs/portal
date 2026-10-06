import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeSchoolStructure } from '../functions/lib/school-scope.js';
import { mergeSchoolBranchMetadata, withBranchSchoolSection } from '../functions/lib/branch-school-presentation.js';
import { configuredStaffBranches, applyStaffBranchContext } from '../functions/lib/staff-branch-context.js';

const branches = [
  { Id: 'stable-primary', Name: 'Renamed Campus', SchoolSectionMode: 'primary' },
  { Id: 'main', Name: 'Main Branch', SchoolSectionMode: 'secondary' },
  { Id: 'mixed', Name: 'Both', SchoolSectionMode: 'mixed' }
];
test('normalization and staff responses retain explicit branch type without guessing from names', () => {
  assert.deepEqual(normalizeSchoolStructure({ Branches: branches }).Branches, branches);
  assert.equal(configuredStaffBranches({ Branches: branches })[0].schoolSectionMode, 'primary');
  assert.equal(normalizeSchoolStructure({ Branches: [{ Id: 'old', Name: 'Primary Campus' }] }).Branches[0].SchoolSectionMode, undefined);
});
test('old CSV and object profile saves preserve saved IDs and section settings', () => {
  assert.deepEqual(mergeSchoolBranchMetadata(['Renamed Campus', 'Main Branch', 'Both'], branches), branches);
  assert.equal(mergeSchoolBranchMetadata([{ Id: 'stable-primary', Name: 'Another Name' }], branches)[0].SchoolSectionMode, 'primary');
  assert.equal(mergeSchoolBranchMetadata(null, branches)[0].Id, 'stable-primary');
  assert.throws(() => mergeSchoolBranchMetadata(['Different Campus'], branches), /saved branch IDs/);
  assert.throws(() => mergeSchoolBranchMetadata([{ Id: 'x', Name: 'X', SchoolSectionMode: 'bad' }], branches), /Choose/);
  assert.throws(() => mergeSchoolBranchMetadata([{ Id: 'main', Name: 'Main Branch', SchoolSectionMode: 'primary' }], branches), /Reload/);
});
test('single branch changes retain all identities, global sections and staff authorization', () => {
  const structure = { Branches: branches, ActiveBranchId: 'main', Sections: ['primary', 'secondary'] };
  const changed = withBranchSchoolSection(structure, { Id: 'main', SchoolSectionMode: 'primary' });
  assert.equal(changed.Branches[1].SchoolSectionMode, 'primary');
  assert.deepEqual(changed.Sections, structure.Sections);
  assert.equal(changed.ActiveBranchId, 'main');
  assert.deepEqual(changed.Branches[0], branches[0]);
  assert.throws(() => withBranchSchoolSection(structure, { Id: 'unknown', SchoolSectionMode: 'primary' }), /configured/);
  assert.throws(() => withBranchSchoolSection(structure, { Id: 'main', SchoolSectionMode: 'bad' }), /Choose/);
  assert.throws(() => withBranchSchoolSection(structure, null), /configured/);
  assert.equal(withBranchSchoolSection(structure, { Id: 'main', SchoolSectionMode: '' }).Branches[1].SchoolSectionMode, '');
  const user = applyStaffBranchContext({ branchId: 'main', schoolSectionAccess: 'secondary' }, '', changed);
  assert.equal(user.schoolSectionAccess, 'secondary');
  assert.throws(() => applyStaffBranchContext(user, 'stable-primary', changed), /cannot switch/);
});

const source = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
function context(edition = 'school') {
  const ctx = vm.createContext({ clean: (v) => String(v || '').trim(), selectedBranchId: 'stable-primary',
    availableBranches: configuredStaffBranches({ Branches: branches }), currentUser: { role: 'Super Admin', schoolSectionAccess: 'all' },
    document: { documentElement: { dataset: { edition } } }, requestedWorkspace: edition, organizationTabLabels: { students: 'Personnel' }
  });
  vm.runInContext(source.slice(source.indexOf('function resolveDashboardEdition('), source.indexOf('function schoolInsightsAvailable(')), ctx);
  return ctx;
}
test('web branch switching immediately resolves primary, secondary and mixed labels', () => {
  const ctx = context();
  assert.equal(ctx.staffTabLabel('students', 'Students'), 'Pupils');
  assert.equal(ctx.executiveOfficeTitle(), "Head Teacher's Office");
  ctx.selectedBranchId = 'main';
  assert.equal(ctx.staffTabLabel('students', 'Students'), 'Students');
  assert.equal(ctx.executiveOfficeTitle(), "Principal's Office");
  ctx.currentUser.role = 'Head Teacher';
  assert.equal(ctx.executiveOfficeTitle(), "Principal's Office");
  ctx.selectedBranchId = 'mixed';
  assert.equal(ctx.staffLearnerTerms().Plural, 'Learners');
  assert.equal(ctx.executiveOfficeTitle(), 'Executive Office');
  ctx.currentUser.schoolSectionAccess = 'primary';
  assert.equal(ctx.staffLearnerTerms().Plural, 'Pupils');
});
test('church and organisation vocabulary ignores school branch type', () => {
  for (const edition of ['church', 'faith', 'organization']) {
    const ctx = context(edition);
    assert.equal(ctx.executiveOfficeTitle(), 'Executive Office');
    assert.equal(ctx.staffTabLabel('students', 'Students'), edition === 'organization' ? 'Personnel' : 'Students');
  }
});

test('both settings paths guard section edits; a profile save cannot replace the explicit type', () => {
  const backend = fs.readFileSync(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../functions/api/settings.js', import.meta.url), 'utf8');
  assert.match(backend, /if \(Object.hasOwn\(body, 'BranchSchoolSectionUpdate'\)\)[\s\S]*?deploymentIdentity.edition !== 'school'[\s\S]*?resolveAuthoritativeDesktopActorForEnv\(env, body\)[\s\S]*?actor.assignedBranchId/);
  assert.match(settings, /settingsAccess.scopeLocked \|\| settingsScope === 'branch'/);
  assert.match(settings, /deployment.edition !== 'school'/);
  assert.equal(mergeSchoolBranchMetadata([{ Id: 'main', Name: 'Main Branch', schoolSectionMode: 'primary' }], branches)[0].SchoolSectionMode, 'secondary');
});
