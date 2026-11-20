import test from 'node:test';
import assert from 'node:assert/strict';
import { exportBranchBackup } from '../functions/lib/branch-backup.js';
import { collectBranchBackup } from '../js/branch-backup.js';
import { previewBranchBackup } from '../js/branch-restore.js';
import { requiredDeploymentIdentity } from '../functions/lib/deployment-identity.js';

for (const edition of ['school', 'faith', 'organization', 'hospital']) {
  const env = { DYNAMAX_WORKSPACE_ID: 'tenant', ORGANISATION_EDITION: edition };
  let supported = true;
  try { requiredDeploymentIdentity(env); } catch { supported = false; }
  test('Encrypted-backup payload isolates ' + edition + ' branch records across pages', { skip: !supported }, async () => {
    const branchId = 'west', user = { branchId };
    const nested = edition === 'school' ? 'schoolBranches/west/sections/primary/students'
      : 'organisationBranches/west/staffDailyAttendance';
    const sibling = nested.replace('/west/', '/east/');
    const clinical = 'hospitalWorkspaces/tenant/hospitalAppointments';
    const paths = ['payments', nested, sibling, clinical, 'staffUsers', 'settings', 'invoices'];
    const reads = [];
    const db = {
      getDocument: async () => ({ Branches: ['west', 'east'] }),
      organizationBackupDescriptors: async () => paths.map(path => ({ path })),
      queryCollection: async (_, path, options) => {
        assert.ok(options.readTime);
        reads.push([path, options.readTime]);
        if (path === nested) {
          assert.equal(options.filters, undefined);
          return [{ __id: 'nested', Label: '0123' }, { __id: 'conflict', Nested: { ToBranchId: 'east' } }];
        }
        assert.deepEqual(options.filters.map(f => f.value), ['west', 'west']);
        if (path === 'invoices') return [];
        if (path === clinical) return [{ __id: 'visit', BranchId: 'west' }, { __id: 'shared' }];
        assert.equal(path, 'payments');
        if (!options.startAfterName) return Array.from({ length: 250 }, (_, i) =>
          ({ __id: String(i), __name: 'payments/' + i, BranchId: 'west', ToBranchId: 'east' }));
        assert.equal(options.startAfterName, 'payments/249');
        return [{ __id: 'paid', __updateTime: 'version', branchId: 'west', Amount: 12 },
          { __id: 'other-workspace', WorkspaceId: 'another', BranchId: 'west' }];
      }
    };
    const request = (action, body) => exportBranchBackup(env, user, action, body, db);
    const backup = await collectBranchBackup(branchId, request, () => {});
    assert.equal(backup.branchId, branchId);
    assert.equal(backup.scope, 'branch');
    assert.equal(backup.workspaceId, 'tenant');
    assert.deepEqual(backup.collections.payments, [{ __id: 'paid', branchId: 'west', Amount: 12 }]);
    assert.deepEqual(backup.collections[nested], [{ __id: 'nested', Label: '0123' }]);
    assert.deepEqual(backup.collections.invoices, []);
    assert.equal(backup.collections[clinical]?.length, edition === 'hospital' ? 1 : undefined);
    assert.equal(new Set(reads.map(([, stamp]) => stamp)).size, 1);
    for (const path of ['settings', sibling, 'staffUsers']) {
      assert.ok(!Object.hasOwn(backup.collections, path));
      await assert.rejects(request('export-branch-page', { branchId, collectionPath: path }), /outside/);
    }
    await assert.rejects(request('plan-branch-backup', { branchId: 'east' }), /working branch/);
    await assert.rejects(exportBranchBackup(env, { branchId: 'all' }, 'plan-branch-backup', { branchId: 'missing' }, db), /configured/);
    await assert.rejects(previewBranchBackup(backup, 'east', 'merge'), /different branch/);
  });
}

test('the browser aborts a mis-scoped response rather than creating a partial backup', async () => {
  const plan = { scope: 'branch', branchId: 'west', edition: 'school', workspaceId: 'demo', createdAt: '2026-01-01',
    format: 'dynamax-organization-backup', paths: ['payments'] };
  const request = async action => action === 'plan-branch-backup' ? plan : { ...plan, branchId: 'east', documents: [], cursor: '' };
  await assert.rejects(collectBranchBackup('west', request, () => {}), /does not match/);
});
