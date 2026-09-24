import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  annotateProvisioningRequests,
  normalizeTenantPoolPolicy,
  publicTenantProjectSlot
} from '../functions/lib/tenant-project-pool.js';

const poolSource = await readFile(new URL('../functions/lib/tenant-project-pool.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../functions/api/tenant-project-pool.js', import.meta.url), 'utf8');
const paymentSource = await readFile(new URL('../functions/api/verify-subscription-payment.js', import.meta.url), 'utf8');
const provisionerSource = await readFile(new URL('../scripts/provision-tenant-projects.mjs', import.meta.url), 'utf8');
const sanitizerSource = await readFile(new URL('../scripts/sanitize-tenant-pool-projects.mjs', import.meta.url), 'utf8');

test('pool policy maintains a safe ready target for every organisation edition', () => {
  assert.deepEqual(normalizeTenantPoolPolicy({}), {
    TargetReadyPerEdition: { school: 2, faith: 2, organization: 2 },
    DefaultRegion: 'africa-south1',
    ProjectPrefix: 'dynamax-tenant',
    PrecreatedProjectIds: [],
    UpdatedAt: ''
  });
  assert.deepEqual(normalizeTenantPoolPolicy({
    TargetReadyPerEdition: { school: 4, faith: 0, organization: 99 },
    DefaultRegion: 'us-central1',
    ProjectPrefix: 'My Project Pool'
  }).TargetReadyPerEdition, { school: 4, faith: 2, organization: 20 });
  assert.deepEqual(normalizeTenantPoolPolicy({
    PrecreatedProjectIds: 'DYNAMAX-TENANT-001, invalid project\ndynamax-tenant-002\ndynamax-tenant-001'
  }).PrecreatedProjectIds, ['dynamax-tenant-001', 'dynamax-tenant-002']);
});

test('public project slots expose assignment state without credentials', () => {
  const result = publicTenantProjectSlot({
    __id: 'slot-1',
    Edition: 'church',
    Status: 'Ready',
    FirebaseProjectId: 'tenant-1',
    FIREBASE_PRIVATE_KEY: 'must-not-leak'
  });
  assert.equal(result.Id, 'slot-1');
  assert.equal(result.Edition, 'faith');
  assert.equal(result.FirebaseProjectId, 'tenant-1');
  assert.equal(result.TenantControlKeyConfigured, false);
  assert.equal(result.PaystackDeploymentPending, false);
  assert.equal('FIREBASE_PRIVATE_KEY' in result, false);
});

test('provisioning queue ignores stale pool requests after ready capacity is restored', () => {
  const requests = annotateProvisioningRequests([
    { Reference: 'POOL-1', Edition: 'organization', Mode: 'pool', Count: 1, Status: 'Pending', RequestedAt: '2026-09-16T22:10:51.000Z' },
    { Reference: 'BRANDED-1', Edition: 'organization', Mode: 'branded', Count: 1, Status: 'Pending', RequestedProjectId: 'custom-project', RequestedAt: '2026-09-16T22:11:51.000Z' }
  ], [
    { Edition: 'organization', Status: 'Ready' },
    { Edition: 'organization', Status: 'Ready' }
  ], normalizeTenantPoolPolicy({}));
  assert.equal(requests[0].ActionRequired, false);
  assert.equal(requests[0].EffectiveCount, 0);
  assert.equal(requests[1].ActionRequired, true);
});

test('provisioning queue caps a pool request to the current shortfall', () => {
  const [request] = annotateProvisioningRequests([
    { Reference: 'POOL-2', Edition: 'school', Mode: 'pool', Count: 3, Status: 'Pending', RequestedAt: '2026-09-16T22:10:51.000Z' }
  ], [
    { Edition: 'school', Status: 'Ready' }
  ], normalizeTenantPoolPolicy({}));
  assert.equal(request.ActionRequired, true);
  assert.equal(request.EffectiveCount, 1);
});

test('a delayed retry keeps its project capacity reserved and becomes claimable when due', () => {
  const nowMs = Date.parse('2026-09-24T12:00:00.000Z');
  const requests = annotateProvisioningRequests([
    { Reference: 'POOL-RETRY', Edition: 'school', Mode: 'pool', Count: 1, Status: 'Pending', RequestedAt: '2026-09-24T10:00:00.000Z', NextAttemptAt: '2026-09-24T12:15:00.000Z' },
    { Reference: 'POOL-LATER', Edition: 'school', Mode: 'pool', Count: 1, Status: 'Pending', RequestedAt: '2026-09-24T11:00:00.000Z' }
  ], [{ Edition: 'school', Status: 'Ready' }], normalizeTenantPoolPolicy({}), nowMs);
  assert.equal(requests[0].ActionRequired, false);
  assert.equal(requests[0].EffectiveCount, 1);
  assert.equal(requests[1].ActionRequired, false);
  assert.equal(requests[1].EffectiveCount, 0);
  const [due] = annotateProvisioningRequests([requests[0]], [{ Edition: 'school', Status: 'Ready' }], normalizeTenantPoolPolicy({}), nowMs + 900001);
  assert.equal(due.ActionRequired, true);
});

test('a partially provisioned request resumes only its unregistered projects', () => {
  const [request] = annotateProvisioningRequests([
    { Reference: 'POOL-PARTIAL', Edition: 'school', Mode: 'pool', Count: 2, Status: 'Pending', RequestedAt: '2026-09-24T10:00:00.000Z' }
  ], [
    { Edition: 'school', Status: 'Ready', ProvisioningBatchId: 'POOL-PARTIAL' }
  ], normalizeTenantPoolPolicy({ TargetReadyPerEdition: { school: 2 } }));
  assert.equal(request.ActionRequired, true);
  assert.equal(request.EffectiveCount, 1);
});

test('a request with all projects registered remains claimable for finalization only', () => {
  const [request] = annotateProvisioningRequests([
    { Reference: 'POOL-FINALIZE', Edition: 'school', Mode: 'pool', Count: 1, Status: 'Pending', RequestedAt: '2026-09-24T10:00:00.000Z' }
  ], [
    { Edition: 'school', Status: 'Ready', ProvisioningBatchId: 'POOL-FINALIZE' }
  ], normalizeTenantPoolPolicy({ TargetReadyPerEdition: { school: 1 } }));
  assert.equal(request.ActionRequired, true);
  assert.equal(request.EffectiveCount, 0);
});

test('assignment is concurrency-safe and payment remains recoverable when capacity is empty', () => {
  assert.match(poolSource, /batchCommitDocuments/);
  assert.match(poolSource, /updateTime: candidate\.__updateTime/);
  assert.match(poolSource, /updateTime: registration\.__updateTime/);
  assert.match(poolSource, /FIRESTORE_WRITE_CONFLICT/);
  assert.match(poolSource, /Waiting for ready project/);
  assert.match(poolSource, /ensureTenantPoolCapacity/);
  assert.match(paymentSource, /reserveTenantProjectSlot/);
  assert.match(paymentSource, /workspacePending/);
});

test('tenant pool administration is protected and supports worker lifecycle states', () => {
  assert.match(apiSource, /requirePlatformAdmin/);
  assert.match(apiSource, /TENANT_PROVISIONER_SECRET/);
  assert.match(apiSource, /PROVISIONER_ACTIONS/);
  assert.match(apiSource, /reset-paystack-connection/);
  assert.match(apiSource, /claim-next/);
  assert.match(apiSource, /body\.reference/);
  assert.match(apiSource, /finish-request/);
  assert.match(apiSource, /ensure-capacity/);
  assert.match(apiSource, /quarantine/);
  assert.match(apiSource, /remove-quarantined-slot/);
  assert.match(apiSource, /issueTenantActivation/);
});

test('unassigned pool sanitation stays quarantined until verification completes', () => {
  assert.match(poolSource, /Only an unassigned Ready or Maintenance project can enter maintenance/);
  assert.match(poolSource, /Only an unassigned Maintenance project can be removed from the pool/);
  assert.match(poolSource, /PrecreatedProjectIds\.filter/);
  assert.match(sanitizerSource, /SANITIZE \$\{preservedProjectId\} DELETE \$\{deletedProjectId\}/);
  assert.match(sanitizerSource, /status: 'Maintenance'/);
  assert.match(sanitizerSource, /await verifyFirestoreEmpty\(preservedProjectId\)/);
  assert.match(sanitizerSource, /await verifyFirebaseAuthEmpty\(preservedProjectId\)/);
  assert.match(sanitizerSource, /CONFIGURATION_NOT_FOUND/);
  assert.match(sanitizerSource, /refusing an unverified resume/);
  assert.match(sanitizerSource, /objects\?per_page=1000/);
  assert.match(sanitizerSource, /encodedR2ObjectKey/);
  assert.ok(
    sanitizerSource.indexOf("status: 'Maintenance'") < sanitizerSource.indexOf("Status: 'Ready'"),
    'the sanitized project must remain unavailable until every empty-state check passes'
  );
});

test('provisioning plans are repeatable and can resume from a user-precreated project', () => {
  assert.match(provisionerSource, /createHash\('sha256'\)\.update\(`\$\{requestReference\}:\$\{sequence\}`\)/);
  assert.match(provisionerSource, /gcloud', \['projects', 'describe'/);
  assert.match(provisionerSource, /Using pre-created Google Cloud project/);
  assert.match(provisionerSource, /DYNAMAX_PRECREATED_PROJECT_IDS/);
  assert.match(provisionerSource, /Pre-created Google Cloud project .* is no longer accessible/);
  assert.match(provisionerSource, /DYNAMAX_TENANT_PROVISIONER_SECRET/);
  assert.match(provisionerSource, /DYNAMAX_GCP_BILLING_REQUIRED/);
  assert.match(provisionerSource, /TENANT_CONTROL_PLANE_PRIVATE_KEY/);
  assert.match(provisionerSource, /STUDENT_FACE_LOOKUP_ENABLED: plain\(edition === 'school' \? 'true' : 'false'\)/);
  assert.match(provisionerSource, /TenantControlPublicKey/);
  assert.match(provisionerSource, /billing\.resourceAssociations\.create/);
  assert.match(provisionerSource, /Grant Billing Account User to the provisioner service account/);
  assert.match(provisionerSource, /info\.billingEnabled === true && clean\(info\.billingAccountName\) === expectedAccount/);
  assert.match(provisionerSource, /The tenant was not registered as Ready/);
  assert.match(provisionerSource, /NextAttemptAt: new Date\(Date\.now\(\) \+ retryMinutes \* 60000\)/);
  assert.match(provisionerSource, /function commandWithRetry/);
  assert.match(provisionerSource, /Using existing tenant runtime account/);
  assert.match(provisionerSource, /Using existing Firestore database/);
  assert.match(provisionerSource, /Firebase is already enabled/);
  assert.doesNotMatch(provisionerSource, /DYNAMAX_ADMIN_WEB_PASSWORD/);
});
