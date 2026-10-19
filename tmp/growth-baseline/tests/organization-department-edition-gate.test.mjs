import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertOrganizationDepartmentWorkspaceAccess
} from '../functions/lib/organization-department-gate.js';

const endpointSource = await readFile(
  new URL('../functions/api/staff-organization-departments.js', import.meta.url),
  'utf8'
);
const backendSource = await readFile(
  new URL('../functions/api/backend.js', import.meta.url),
  'utf8'
);

const enabledFeatures = Object.freeze({ members: true, departments: true });

test('faith and generic organisation deployments may use department operations', () => {
  assert.deepEqual(
    assertOrganizationDepartmentWorkspaceAccess(
      { workspaceId: 'ministry-main', edition: 'faith' },
      { edition: 'faith', featureFlags: enabledFeatures }
    ),
    { workspaceId: 'ministry-main', edition: 'faith' }
  );
  assert.deepEqual(
    assertOrganizationDepartmentWorkspaceAccess(
      { workspaceId: 'association-main', edition: 'organization' },
      { edition: 'organization', featureFlags: enabledFeatures }
    ),
    { workspaceId: 'association-main', edition: 'organization' }
  );
});

test('church and other aliases remain compatible at the gate', () => {
  assert.deepEqual(
    assertOrganizationDepartmentWorkspaceAccess(
      { workspaceId: 'church-main', edition: 'church' },
      { edition: 'religious organisation', featureFlags: enabledFeatures }
    ),
    { workspaceId: 'church-main', edition: 'faith' }
  );
  assert.deepEqual(
    assertOrganizationDepartmentWorkspaceAccess(
      { workspaceId: 'club-main', edition: 'other' },
      { edition: 'organisation', featureFlags: enabledFeatures }
    ),
    { workspaceId: 'club-main', edition: 'organization' }
  );
});

test('school deployments fail closed before department list or mutation handlers run', () => {
  assert.throws(
    () => assertOrganizationDepartmentWorkspaceAccess(
      { workspaceId: 'destiny-school', edition: 'school' },
      { edition: 'school', role: 'Super Admin' }
    ),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'ORGANIZATION_DEPARTMENT_EDITION_FORBIDDEN');
      return true;
    }
  );
});

test('missing deployment identity, mismatched sessions and disabled features fail closed', () => {
  assert.throws(
    () => assertOrganizationDepartmentWorkspaceAccess(
      { workspaceId: '', edition: 'faith' },
      { edition: 'faith' }
    ),
    (error) => error.status === 503 && error.code === 'ORGANIZATION_DEPARTMENT_IDENTITY_REQUIRED'
  );
  assert.throws(
    () => assertOrganizationDepartmentWorkspaceAccess(
      { workspaceId: 'faith-main', edition: 'faith' },
      { edition: 'school' }
    ),
    (error) => error.status === 403
      && error.code === 'ORGANIZATION_DEPARTMENT_SESSION_EDITION_MISMATCH'
  );
  assert.throws(
    () => assertOrganizationDepartmentWorkspaceAccess(
      { workspaceId: 'faith-main', edition: 'faith' },
      { edition: 'faith', featureFlags: { members: true, departments: false } }
    ),
    (error) => error.status === 403
      && error.code === 'ORGANIZATION_DEPARTMENT_FEATURE_DISABLED'
  );
});

test('web and desktop request boundaries use the authoritative deployment gate', () => {
  assert.match(endpointSource, /loadDeploymentIdentity\(env\)/);
  assert.match(
    endpointSource,
    /assertOrganizationDepartmentWorkspaceAccess\(deploymentIdentity, user\)[\s\S]*?handleOrganizationDepartmentAction/
  );
  assert.match(
    backendSource,
    /edition:\s*deploymentIdentity\?\.edition[\s\S]*?assertOrganizationDepartmentWorkspaceAccess\(deploymentIdentity, departmentActor\)[\s\S]*?handleOrganizationDepartmentAction/
  );
  assert.match(
    backendSource,
    /const departmentAction = \(\{[\s\S]*?getOrganizationDepartments: 'list'[\s\S]*?Action: departmentAction,[\s\S]*?action: departmentAction/
  );
});
