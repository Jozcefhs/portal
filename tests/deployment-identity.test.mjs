import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertDeploymentEditionSelection,
  assertExpectedDeploymentIdentity,
  deploymentIdentityDetails,
  normalizeWorkspaceId,
  requiredDeploymentIdentity
} from '../functions/lib/deployment-identity.js';

const schoolEnv = {
  DYNAMAX_WORKSPACE_ID: 'Destiny-School',
  ORGANISATION_EDITION: 'school',
  ORGANISATION_NAME: 'Destiny Christian Academy',
  ORGANISATION_CODE: 'DCA'
};

const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8');

test('deployment identity requires an explicit workspace and edition', () => {
  assert.throws(
    () => requiredDeploymentIdentity({ ORGANISATION_EDITION: 'school' }),
    (error) => error.status === 503 && error.code === 'DEPLOYMENT_WORKSPACE_NOT_CONFIGURED'
  );
  assert.throws(
    () => requiredDeploymentIdentity({ DYNAMAX_WORKSPACE_ID: 'school-main' }),
    (error) => error.status === 503 && error.code === 'DEPLOYMENT_EDITION_NOT_CONFIGURED'
  );
  assert.throws(
    () => requiredDeploymentIdentity({
      DYNAMAX_WORKSPACE_ID: 'school-main',
      ORGANISATION_EDITION: 'school',
      ORGANIZATION_EDITION: 'faith'
    }),
    (error) => error.status === 503 && error.code === 'DEPLOYMENT_EDITION_CONFLICT'
  );
});

test('workspace IDs are case-insensitive and church is the faith alias', () => {
  assert.equal(normalizeWorkspaceId(' Destiny-School '), 'destiny-school');
  assert.deepEqual(
    requiredDeploymentIdentity({
      DYNAMAX_WORKSPACE_ID: 'Ministry-Main',
      ORGANIZATION_EDITION: 'church'
    }),
    { workspaceId: 'ministry-main', edition: 'faith' }
  );
});

test('authenticated backend expectations are mandatory and must match deployment identity', () => {
  assert.throws(
    () => assertExpectedDeploymentIdentity(schoolEnv, {}),
    (error) => error.status === 400 && error.code === 'EXPECTED_WORKSPACE_REQUIRED'
  );
  assert.throws(
    () => assertExpectedDeploymentIdentity(schoolEnv, {
      ExpectedWorkspaceId: 'another-school',
      ExpectedOrganisationEdition: 'school'
    }),
    (error) => error.status === 409 && error.code === 'DEPLOYMENT_WORKSPACE_MISMATCH'
  );
  assert.throws(
    () => assertExpectedDeploymentIdentity(schoolEnv, {
      ExpectedWorkspaceId: 'destiny-school',
      ExpectedOrganisationEdition: 'faith'
    }),
    (error) => error.status === 409 && error.code === 'DEPLOYMENT_EDITION_MISMATCH'
  );
  assert.deepEqual(
    assertExpectedDeploymentIdentity(schoolEnv, {
      ExpectedWorkspaceId: 'DESTINY-SCHOOL',
      ExpectedOrganisationEdition: 'school'
    }),
    { workspaceId: 'destiny-school', edition: 'school' }
  );
});

test('database organisation profile cannot conflict with deployment identity', () => {
  const identity = requiredDeploymentIdentity(schoolEnv);
  assert.throws(
    () => deploymentIdentityDetails({
      env: schoolEnv,
      identity,
      organizationProfile: { WorkspaceId: 'faith-main', Edition: 'school' }
    }),
    (error) => error.status === 503 && error.code === 'DEPLOYMENT_PROFILE_WORKSPACE_CONFLICT'
  );
  assert.throws(
    () => deploymentIdentityDetails({
      env: schoolEnv,
      identity,
      organizationProfile: { WorkspaceId: 'destiny-school', Edition: 'church' }
    }),
    (error) => error.status === 503 && error.code === 'DEPLOYMENT_PROFILE_EDITION_CONFLICT'
  );
});

test('identity details expose only non-secret organisation metadata', () => {
  const details = deploymentIdentityDetails({
    env: schoolEnv,
    organizationProfile: {
      WorkspaceId: 'destiny-school',
      Edition: 'school',
      Name: 'Destiny Christian Academy',
      Code: 'DCA'
    }
  });
  assert.deepEqual(details, {
    workspaceId: 'destiny-school',
    edition: 'school',
    organisationName: 'Destiny Christian Academy',
    organisationCode: 'DCA',
    subscriptionPlan: 'Professional',
    subscriptionActive: true,
    subscriptionReadOnly: false,
    subscriptionState: 'active',
    subscriptionStatus: 'Active',
    trialStartedAt: '',
    trialEndsAt: '',
    trialDaysRemaining: 0,
    paidThroughAt: '',
    renewalDueAt: '',
    gracePeriodEndsAt: '',
    dataRetentionEndsAt: '',
    subscriptionMessage: ''
  });
  assert.equal(Object.hasOwn(details, 'secret'), false);
});

test('settings cannot change the deployment-bound edition', () => {
  const identity = requiredDeploymentIdentity(schoolEnv);
  assert.equal(assertDeploymentEditionSelection(identity, 'school'), 'school');
  assert.throws(
    () => assertDeploymentEditionSelection(identity, 'church'),
    (error) => error.status === 409 && error.code === 'DEPLOYMENT_EDITION_BOUND'
  );
});

test('backend validates authenticated expected identity before database-backed routing', () => {
  const secretCheck = backendSource.indexOf('requireBackendSecret(env, body);');
  const expectedCheck = backendSource.indexOf('assertExpectedDeploymentIdentity(env, expectedIdentity);');
  const profileCheck = backendSource.indexOf('await loadDeploymentIdentity(env, { identity: configuredIdentity });');
  const actorCheck = backendSource.indexOf('await verifyDesktopActor(env, action, body);');
  const route = backendSource.indexOf(
    'await routeAction(env, action, body, deploymentIdentity, new URL(request.url).origin);'
  );
  assert.ok(secretCheck >= 0);
  assert.ok(expectedCheck > secretCheck);
  assert.ok(profileCheck > expectedCheck);
  assert.ok(actorCheck > profileCheck);
  assert.ok(route > actorCheck);
  assert.match(backendSource, /url\.searchParams\.get\('ExpectedWorkspaceId'\)/);
  assert.match(backendSource, /url\.searchParams\.get\('ExpectedOrganisationEdition'\)/);
  assert.match(backendSource, /workspaceKey: deploymentIdentity\?\.edition/);
  assert.match(backendSource, /workspaceId: deploymentIdentity\?\.workspaceId/);
  assert.match(backendSource, /firebaseProjectId: clean\(env\.FIREBASE_PROJECT_ID\)/);
  assert.match(backendSource, /organisationName: deploymentIdentity\?\.organisationName/);
  assert.match(backendSource, /saveSchoolProfile\(env, body, deploymentIdentity\)/);
  assert.match(backendSource, /WorkspaceId: deploymentIdentity\?\.workspaceId/);
  assert.match(backendSource, /identity\s*\n\s*\};/);
});

test('settings persist deployment identity rather than accepting an edition change', () => {
  assert.match(settingsSource, /assertDeploymentEditionSelection\(/);
  assert.match(settingsSource, /Edition: deployment\.edition/);
  assert.match(settingsSource, /WorkspaceId: deployment\.workspaceId/);
  assert.match(settingsSource, /invalidateDeploymentIdentityCache\(\)/);
});
