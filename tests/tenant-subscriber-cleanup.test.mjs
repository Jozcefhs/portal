import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildNonCoreSubscriberCleanupPlan,
  CORE_TENANT_PROJECTS,
  TENANT_SUBSCRIBER_CLEANUP_CONFIRMATION
} from '../functions/lib/tenant-subscriber-cleanup.js';

const workflow = await readFile(new URL('../.github/workflows/cleanup-subscribed-tenants.yml', import.meta.url), 'utf8');
const script = await readFile(new URL('../scripts/cleanup-subscribed-tenants.mjs', import.meta.url), 'utf8');

test('cleanup preserves the two managed organisations and unassigned ready capacity', () => {
  const plan = buildNonCoreSubscriberCleanupPlan({
    tenantRegistrations: [
      { __id: 'CORE-SCHOOL', OrganisationName: 'Destiny Christian Academy', WorkspaceId: 'school' },
      { __id: 'CORE-CHURCH', OrganisationName: 'Dunamis International Gospel Centre', WorkspaceId: 'faith' },
      { __id: 'TEST-PAID', OrganisationName: 'Jozcelues Ltd', WorkspaceId: 'dynamax-tenant-005', TrialFingerprint: 'fingerprint-1' },
      { __id: 'TEST-PENDING', OrganisationName: 'Another Test', Status: 'Pending Activation' }
    ],
    tenantProjectPool: [
      { __id: 'slot-005', Status: 'Assigned', FirebaseProjectId: 'dynamax-tenant-005', CloudflareProject: 'dynamax-tenant-005', AssignedRegistrationReference: 'TEST-PAID' },
      { __id: 'slot-006', Status: 'Ready', FirebaseProjectId: 'dynamax-tenant-006', CloudflareProject: 'dynamax-tenant-006' }
    ],
    tenantActivations: [{ __id: 'activation-1', RegistrationReference: 'TEST-PAID' }],
    subscriptionPayments: [{ __id: 'payment-1', RegistrationReference: 'TEST-PAID' }],
    tenantTrialTombstones: [{ __id: 'fingerprint-1', TrialFingerprint: 'fingerprint-1' }]
  });
  assert.deepEqual(plan.PreservedProjects, CORE_TENANT_PROJECTS);
  assert.deepEqual(plan.Registrations.map((row) => row.Reference), ['TEST-PAID', 'TEST-PENDING']);
  assert.deepEqual(plan.ExternalProjects.map((row) => row.FirebaseProjectId), ['dynamax-tenant-005']);
  assert.equal(plan.DeleteCounts.tenantRegistrations, 2);
  assert.equal(plan.DeleteCounts.tenantProjectPool, 1);
  assert.equal(plan.DeleteCounts.subscriptionPayments, 1);
  assert.equal(plan.DeleteCounts.tenantTrialTombstones, 1);
  assert.equal(plan.writes.some((row) => row.documentId === 'slot-006'), false);
  assert.equal(plan.writes.some((row) => row.documentId === 'CORE-SCHOOL'), false);
  assert.equal(plan.writes.some((row) => row.documentId === 'CORE-CHURCH'), false);
});

test('workflow requires an explicit confirmation and scripts restrict project deletion', () => {
  assert.equal(TENANT_SUBSCRIBER_CLEANUP_CONFIRMATION, 'DELETE ALL NONCORE SUBSCRIBERS');
  assert.match(workflow, /apply:/);
  assert.match(workflow, /DELETE ALL NONCORE SUBSCRIBERS/);
  assert.match(workflow, /id-token: write/);
  assert.match(script, /\^dynamax-tenant-/);
  assert.match(script, /complete-noncore-subscriber-cleanup/);
  assert.match(script, /pruneCloudflareDeployments/);
  assert.match(script, /per_page=20/);
  assert.match(script, /deployments.*force=true/s);
  assert.match(script, /gcloud', \['projects', 'delete'/);
});
