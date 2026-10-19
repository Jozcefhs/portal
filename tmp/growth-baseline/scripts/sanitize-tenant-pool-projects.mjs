import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { r2BucketNameForProject } from './cloudflare-r2.mjs';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const applyChanges = lower(process.env.TENANT_POOL_MAINTENANCE_APPLY) === 'true';
const preservedProjectId = lower(process.env.PRESERVE_TENANT_PROJECT_ID);
const deletedProjectId = lower(process.env.DELETE_TENANT_PROJECT_ID);
const confirmation = clean(process.env.TENANT_POOL_MAINTENANCE_CONFIRMATION);
const platformUrl = clean(process.env.DYNAMAX_PLATFORM_URL || 'https://dynamax.cc').replace(/\/$/, '');
const platformPassword = clean(process.env.DYNAMAX_TENANT_PROVISIONER_SECRET);
const cloudflareAccountId = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const cloudflareToken = clean(process.env.CLOUDFLARE_API_TOKEN);
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const resultFile = 'tenant-pool-maintenance-result.json';

function expectedConfirmation() {
  return `SANITIZE ${preservedProjectId} DELETE ${deletedProjectId}`;
}

function requireConfiguration() {
  const projectPattern = /^dynamax-tenant-[a-z0-9-]+$/;
  const googleProjectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
  const missing = [];
  if (!projectPattern.test(preservedProjectId) || !googleProjectPattern.test(preservedProjectId)) missing.push('valid PRESERVE_TENANT_PROJECT_ID');
  if (!projectPattern.test(deletedProjectId) || !googleProjectPattern.test(deletedProjectId)) missing.push('valid DELETE_TENANT_PROJECT_ID');
  if (preservedProjectId === deletedProjectId) missing.push('two different tenant project IDs');
  if (!clean(process.env.DYNAMAX_TENANT_PROVISIONER_SECRET)) missing.push('DYNAMAX_TENANT_PROVISIONER_SECRET');
  if (applyChanges && !cloudflareAccountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (applyChanges && !cloudflareToken) missing.push('CLOUDFLARE_API_TOKEN');
  if (missing.length) throw new Error(`Missing tenant maintenance configuration: ${missing.join(', ')}.`);
  if (applyChanges && confirmation !== expectedConfirmation()) {
    throw new Error(`Enter ${expectedConfirmation()} to confirm this maintenance.`);
  }
}

function command(program, args, options = {}) {
  const completed = spawnSync(program, args, {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (completed.error) throw completed.error;
  if (completed.status !== 0 && !options.allowFailure) {
    throw new Error(clean(completed.stderr || completed.stdout) || `${program} failed with exit ${completed.status}.`);
  }
  return clean(completed.stdout);
}

function accessToken() {
  return command('gcloud', ['auth', 'print-access-token'], { capture: true });
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false || data?.ok === false) {
    const error = new Error(
      data?.error?.message
      || data?.errors?.map((row) => row.message).filter(Boolean).join('; ')
      || data?.message
      || `${options.method || 'GET'} ${url} failed (${response.status}).`
    );
    error.status = response.status;
    throw error;
  }
  return data.result ?? data;
}

async function googleRequest(url, options = {}) {
  return jsonRequest(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

async function cloudflareRequest(path, options = {}) {
  return jsonRequest(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${cloudflareToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }
  );
}

async function platformApi(payload) {
  return jsonRequest(`${platformUrl}/api/tenant-project-pool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: platformPassword, ...payload })
  });
}

function encodedR2ObjectKey(value) {
  return String(value ?? '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

function assertMaintainableSlot(slot, projectId) {
  if (!slot || lower(slot.FirebaseProjectId) !== projectId || lower(slot.CloudflareProject) !== projectId) {
    throw new Error(`${projectId} is not an exact Firebase-and-Cloudflare tenant pool slot.`);
  }
  if (clean(slot.AssignedRegistrationReference) || !['ready', 'maintenance'].includes(lower(slot.Status))) {
    throw new Error(`${projectId} is not an unassigned Ready or Maintenance project.`);
  }
  return slot;
}

function firebaseAuthConfigurationMissing(error) {
  return /CONFIGURATION_NOT_FOUND/i.test(clean(error?.message));
}

async function emptyR2Bucket(projectId, { removeBucket = false } = {}) {
  const bucket = r2BucketNameForProject(projectId);
  const bucketPath = `/r2/buckets/${encodeURIComponent(bucket)}`;
  try {
    await cloudflareRequest(bucketPath);
  } catch (error) {
    if (Number(error.status) === 404) return { bucket, deletedObjects: 0, removed: false };
    throw error;
  }
  let deletedObjects = 0;
  for (let pass = 0; pass < 10000; pass += 1) {
    const listing = await cloudflareRequest(`${bucketPath}/objects?per_page=1000`);
    const objects = (Array.isArray(listing) ? listing : listing.objects || []).filter((row) => clean(row.key));
    if (!objects.length) break;
    for (let index = 0; index < objects.length; index += 25) {
      await Promise.all(objects.slice(index, index + 25).map((object) => (
        cloudflareRequest(`${bucketPath}/objects/${encodedR2ObjectKey(object.key)}`, { method: 'DELETE' })
      )));
    }
    deletedObjects += objects.length;
    if (pass === 9999) throw new Error(`R2 sanitation exceeded the safe pass limit for ${bucket}.`);
  }
  const verification = await cloudflareRequest(`${bucketPath}/objects?per_page=1`);
  const remaining = Array.isArray(verification) ? verification : verification.objects || [];
  if (remaining.length) {
    throw new Error(`R2 bucket ${bucket} was not empty after sanitation.`);
  }
  if (removeBucket) await cloudflareRequest(bucketPath, { method: 'DELETE' });
  return { bucket, deletedObjects, removed: removeBucket };
}

async function deleteFirebaseAuthUsers(projectId) {
  let deletedUsers = 0;
  for (let pass = 0; pass < 10000; pass += 1) {
    let page;
    try {
      page = await googleRequest(
        `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:batchGet?maxResults=1000`
      );
    } catch (error) {
      if (firebaseAuthConfigurationMissing(error)) return deletedUsers;
      throw error;
    }
    const localIds = (Array.isArray(page.users) ? page.users : []).map((user) => clean(user.localId)).filter(Boolean);
    if (!localIds.length) return deletedUsers;
    if (localIds.length) {
      const response = await googleRequest(
        `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:batchDelete`,
        { method: 'POST', body: JSON.stringify({ localIds, force: true }) }
      );
      if (Array.isArray(response.errors) && response.errors.length) {
        throw new Error(`Firebase Authentication rejected ${response.errors.length} account deletion(s).`);
      }
      deletedUsers += localIds.length;
    }
    if (pass === 9999) {
      throw new Error(`Firebase Authentication sanitation exceeded the safe pass limit for ${projectId}.`);
    }
  }
  return deletedUsers;
}

async function verifyFirebaseAuthEmpty(projectId) {
  let verification;
  try {
    verification = await googleRequest(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:batchGet?maxResults=1`
    );
  } catch (error) {
    if (firebaseAuthConfigurationMissing(error)) return;
    throw error;
  }
  if (Array.isArray(verification.users) && verification.users.length) {
    throw new Error(`Firebase Authentication still contains users in ${projectId}.`);
  }
}

async function verifyFirestoreEmpty(projectId) {
  const verification = await googleRequest(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/%28default%29/documents:listCollectionIds`,
    { method: 'POST', body: JSON.stringify({ pageSize: 100 }) }
  );
  if (Array.isArray(verification.collectionIds) && verification.collectionIds.length) {
    throw new Error(`Firestore still contains collection IDs in ${projectId}: ${verification.collectionIds.join(', ')}.`);
  }
}

async function deleteFirestoreDocuments(projectId) {
  execFileSync(npxCommand, [
    '--yes', 'firebase-tools@15.24.0', 'firestore:delete',
    '--all-collections', '--force', '--project', projectId
  ], { stdio: 'inherit', env: process.env });
  await verifyFirestoreEmpty(projectId);
}

async function emptyGoogleStorage(projectId) {
  const response = await googleRequest(
    `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(projectId)}&maxResults=1000`
  );
  const buckets = (Array.isArray(response.items) ? response.items : []).map((row) => clean(row.name)).filter(Boolean);
  let deletedObjects = 0;
  for (const bucket of buckets) {
    for (let pass = 0; pass < 10000; pass += 1) {
      const page = await googleRequest(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?versions=true&maxResults=1000`
      );
      const objects = (Array.isArray(page.items) ? page.items : []).filter((row) => clean(row.name));
      if (!objects.length) break;
      for (let index = 0; index < objects.length; index += 25) {
        await Promise.all(objects.slice(index, index + 25).map((object) => {
          const generation = clean(object.generation);
          const suffix = generation ? `?generation=${encodeURIComponent(generation)}` : '';
          return googleRequest(
            `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object.name)}${suffix}`,
            { method: 'DELETE' }
          );
        }));
      }
      deletedObjects += objects.length;
      if (pass === 9999) throw new Error(`Cloud Storage sanitation exceeded the safe pass limit for ${bucket}.`);
    }
    const verification = await googleRequest(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?versions=true&maxResults=1`
    );
    if (Array.isArray(verification.items) && verification.items.length) {
      throw new Error(`Cloud Storage bucket ${bucket} was not empty after sanitation.`);
    }
  }
  return { buckets: buckets.length, deletedObjects };
}

function deleteRuntimeKeys(projectId) {
  const serviceAccount = `dynamax-runtime@${projectId}.iam.gserviceaccount.com`;
  const keys = command('gcloud', [
    'iam', 'service-accounts', 'keys', 'list',
    `--iam-account=${serviceAccount}`, '--managed-by=user', '--format=value(name)'
  ], { capture: true }).split(/\r?\n/).map(clean).filter(Boolean);
  for (const key of keys) {
    command('gcloud', [
      'iam', 'service-accounts', 'keys', 'delete', key.split('/').at(-1),
      `--iam-account=${serviceAccount}`, `--project=${projectId}`, '--quiet'
    ]);
  }
  return keys.length;
}

function countRuntimeKeys(projectId) {
  const serviceAccount = `dynamax-runtime@${projectId}.iam.gserviceaccount.com`;
  return command('gcloud', [
    'iam', 'service-accounts', 'keys', 'list',
    `--iam-account=${serviceAccount}`, '--managed-by=user', '--format=value(name)'
  ], { capture: true }).split(/\r?\n/).map(clean).filter(Boolean).length;
}

async function pruneCloudflareDeployments(projectId) {
  const projectPath = `/pages/projects/${encodeURIComponent(projectId)}`;
  const base = `${projectPath}/deployments`;
  let deleted = 0;
  for (let pass = 0; pass < 200; pass += 1) {
    const project = await cloudflareRequest(projectPath);
    const canonicalId = clean(project.canonical_deployment?.id);
    const listing = await cloudflareRequest(`${base}?page=1&per_page=20`);
    const deployments = (Array.isArray(listing) ? listing : []).filter((row) => clean(row.id));
    if (deployments.length <= 1) return deleted;
    const candidates = deployments.filter((row) => clean(row.id) !== canonicalId);
    let deletedThisPass = 0;
    for (const deployment of candidates) {
      try {
        await cloudflareRequest(`${base}/${encodeURIComponent(deployment.id)}?force=true`, { method: 'DELETE' });
        deletedThisPass += 1;
      } catch (error) {
        if (!/active production deployment/i.test(clean(error.message))) throw error;
      }
    }
    deleted += deletedThisPass;
    if (!deletedThisPass) throw new Error(`No removable Pages deployment remained for ${projectId}.`);
  }
  throw new Error(`Pages deployment cleanup exceeded the safe pass limit for ${projectId}.`);
}

async function deleteCloudflareProject(projectId) {
  const path = `/pages/projects/${encodeURIComponent(projectId)}`;
  try {
    await cloudflareRequest(path, { method: 'DELETE' });
    return;
  } catch (error) {
    if (Number(error.status) === 404) return;
    if (!/too many deployments/i.test(clean(error.message))) throw error;
  }
  await pruneCloudflareDeployments(projectId);
  await cloudflareRequest(path, { method: 'DELETE' });
}

function deleteGoogleProject(projectId) {
  const state = command('gcloud', ['projects', 'describe', projectId, '--format=value(lifecycleState)'], {
    capture: true,
    allowFailure: true
  });
  if (!state || lower(state) === 'delete_requested') return;
  command('gcloud', ['projects', 'delete', projectId, '--quiet']);
}

async function verifyProjectExists(projectId) {
  const found = command('gcloud', ['projects', 'describe', projectId, '--format=value(projectId)'], {
    capture: true,
    allowFailure: true
  });
  if (found !== projectId) throw new Error(`${projectId} is not accessible to the maintenance identity.`);
}

async function main() {
  requireConfiguration();
  const inventory = await platformApi({ action: 'load' });
  const preserveSlot = assertMaintainableSlot(
    inventory.slots?.find((slot) => lower(slot.FirebaseProjectId) === preservedProjectId),
    preservedProjectId
  );
  const deleteCandidate = inventory.slots?.find((slot) => lower(slot.FirebaseProjectId) === deletedProjectId);
  const deleteSlot = deleteCandidate ? assertMaintainableSlot(deleteCandidate, deletedProjectId) : null;
  if (!deleteSlot && lower(preserveSlot.Status) !== 'maintenance') {
    throw new Error(`${deletedProjectId} is absent, but ${preservedProjectId} is not in Maintenance; refusing an unverified resume.`);
  }
  const preservedEdition = lower(preserveSlot.Edition);
  if (!['school', 'faith', 'organization'].includes(preservedEdition)) {
    throw new Error(`${preservedProjectId} has an unsupported tenant edition.`);
  }
  const report = {
    apply: applyChanges,
    confirmationRequired: expectedConfirmation(),
    preserve: preserveSlot,
    delete: deleteSlot,
    completed: false
  };
  writeFileSync(resultFile, JSON.stringify(report, null, 2));
  if (!applyChanges) {
    process.stdout.write(`Validated maintenance preview for ${preservedProjectId} and ${deletedProjectId}.\n`);
    return;
  }

  process.env.TENANT_PROVISION_APPLY = 'true';
  process.env.TENANT_PROVISIONING_REQUEST_JSON = JSON.stringify({
    Reference: `MAINTENANCE-${clean(process.env.GITHUB_RUN_ID || Date.now())}-${clean(process.env.GITHUB_RUN_ATTEMPT || '1')}`,
    Edition: preservedEdition,
    Mode: 'branded',
    Count: 1,
    RequestedProjectId: preservedProjectId
  });
  const { preparePagesDeployment, provisionProject } = await import('./provision-tenant-projects.mjs');

  const quarantine = [
    platformApi({ action: 'quarantine', projectId: preservedProjectId, reason: 'Sanitize and reprovision unassigned project' })
  ];
  if (deleteSlot) {
    quarantine.push(platformApi({ action: 'quarantine', projectId: deletedProjectId, reason: 'Delete unassigned data-bearing project' }));
  }
  await Promise.all(quarantine);
  const projectChecks = [verifyProjectExists(preservedProjectId)];
  if (deleteSlot) projectChecks.push(verifyProjectExists(deletedProjectId));
  await Promise.all(projectChecks);

  const deletedR2 = await emptyR2Bucket(deletedProjectId, { removeBucket: true });
  await deleteCloudflareProject(deletedProjectId);
  deleteGoogleProject(deletedProjectId);
  report.deletedProject = {
    googleDeletionRequested: true,
    cloudflareDeleted: true,
    r2: deletedR2,
    poolEntryRemoved: !deleteSlot
  };
  writeFileSync(resultFile, JSON.stringify(report, null, 2));

  const preservedR2 = await emptyR2Bucket(preservedProjectId, { removeBucket: true });
  await deleteCloudflareProject(preservedProjectId);
  const deletedUsers = await deleteFirebaseAuthUsers(preservedProjectId);
  await deleteFirestoreDocuments(preservedProjectId);
  const googleStorage = await emptyGoogleStorage(preservedProjectId);
  const deletedRuntimeKeys = deleteRuntimeKeys(preservedProjectId);
  const sanitizedAt = new Date().toISOString();
  preparePagesDeployment();
  const reprovisioned = await provisionProject(preservedProjectId, { sanitizedAt, status: 'Maintenance' });
  await verifyFirestoreEmpty(preservedProjectId);
  await verifyFirebaseAuthEmpty(preservedProjectId);
  const finalR2 = await emptyR2Bucket(preservedProjectId);
  const runtimeKeys = countRuntimeKeys(preservedProjectId);
  if (finalR2.deletedObjects !== 0 || runtimeKeys !== 1) {
    throw new Error(`Post-provision verification failed for ${preservedProjectId}.`);
  }
  if (deleteSlot) {
    await platformApi({ action: 'remove-quarantined-slot', projectId: deletedProjectId });
    report.deletedProject.poolEntryRemoved = true;
    writeFileSync(resultFile, JSON.stringify(report, null, 2));
  }
  const ready = await platformApi({
    action: 'register',
    slot: { ...reprovisioned, Status: 'Ready', SanitizedAt: sanitizedAt }
  });
  report.preservedProject = {
    sanitizedAt,
    firestoreEmpty: true,
    authUsersDeleted: deletedUsers,
    r2: preservedR2,
    googleStorage,
    runtimeKeysDeleted: deletedRuntimeKeys,
    runtimeKeysActive: runtimeKeys,
    reprovisioned: ready.slot,
    assignments: ready.assignments || []
  };
  report.completed = true;
  report.completedAt = new Date().toISOString();
  writeFileSync(resultFile, JSON.stringify(report, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
