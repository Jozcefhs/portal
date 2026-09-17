import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const applyChanges = lower(process.env.TENANT_SUBSCRIBER_CLEANUP_APPLY) === 'true';
const confirmation = clean(process.env.TENANT_SUBSCRIBER_CLEANUP_CONFIRMATION);
const requiredConfirmation = 'DELETE ALL NONCORE SUBSCRIBERS';
const platformUrl = clean(process.env.DYNAMAX_PLATFORM_URL || 'https://dynamaxms.pages.dev').replace(/\/$/, '');
const platformPassword = clean(process.env.DYNAMAX_TENANT_PROVISIONER_SECRET);
const cloudflareAccountId = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const cloudflareToken = clean(process.env.CLOUDFLARE_API_TOKEN);

function requireConfiguration() {
  const missing = [];
  if (!platformPassword) missing.push('DYNAMAX_TENANT_PROVISIONER_SECRET');
  if (applyChanges && !cloudflareAccountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (applyChanges && !cloudflareToken) missing.push('CLOUDFLARE_API_TOKEN');
  if (missing.length) throw new Error(`Missing tenant cleanup configuration: ${missing.join(', ')}.`);
  if (applyChanges && confirmation !== requiredConfirmation) {
    throw new Error(`Set the confirmation input to exactly ${requiredConfirmation}.`);
  }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false || data?.success === false) {
    throw new Error(data?.message || data?.errors?.[0]?.message || `${options.method || 'GET'} ${url} failed (${response.status}).`);
  }
  return data;
}

async function platformApi(payload) {
  return jsonRequest(`${platformUrl}/api/tenant-project-pool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: platformPassword, ...payload })
  });
}

function assertSafeProject(project = {}) {
  const firebaseProjectId = lower(project.FirebaseProjectId);
  const cloudflareProject = lower(project.CloudflareProject || firebaseProjectId);
  if (!/^dynamax-tenant-[a-z0-9-]{1,64}$/.test(firebaseProjectId)) {
    throw new Error(`Refusing to delete unexpected Firebase project ID "${firebaseProjectId}".`);
  }
  if (cloudflareProject !== firebaseProjectId) {
    throw new Error(`Refusing to delete ${firebaseProjectId} because its Cloudflare project differs.`);
  }
  return { firebaseProjectId, cloudflareProject };
}

async function deleteCloudflareProject(projectId) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/pages/projects/${encodeURIComponent(projectId)}`;
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cloudflareToken}`, 'Content-Type': 'application/json' }
  });
  if (response.ok || response.status === 404) return;
  const data = await response.json().catch(() => ({}));
  throw new Error(data?.errors?.[0]?.message || `Cloudflare Pages deletion failed (${response.status}).`);
}

function deleteGoogleProject(projectId) {
  const lookup = spawnSync('gcloud', ['projects', 'describe', projectId, '--format=value(lifecycleState)'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (lookup.error) throw lookup.error;
  if (lookup.status !== 0) {
    const detail = clean(lookup.stderr || lookup.stdout);
    if (/not[_ ]found|could not find|was not found/i.test(detail)) return;
    throw new Error(`Google Cloud project lookup failed for ${projectId}: ${detail || `exit ${lookup.status}`}`);
  }
  const lifecycleState = clean(lookup.stdout);
  if (!lifecycleState || lower(lifecycleState) === 'delete_requested') return;
  execFileSync('gcloud', ['projects', 'delete', projectId, '--quiet'], { stdio: 'inherit' });
}

async function main() {
  requireConfiguration();
  const preview = await platformApi({ action: 'preview-noncore-subscriber-cleanup' });
  const projects = Array.isArray(preview.plan?.ExternalProjects) ? preview.plan.ExternalProjects : [];
  const result = {
    apply: applyChanges,
    preservedProjects: preview.plan?.PreservedProjects || [],
    registrations: preview.plan?.Registrations || [],
    externalProjects: projects,
    deleteCounts: preview.plan?.DeleteCounts || {},
    completed: false
  };
  writeFileSync('tenant-subscriber-cleanup-result.json', JSON.stringify(result, null, 2));
  process.stdout.write(`${applyChanges ? 'Applying' : 'Previewing'} cleanup for ${result.registrations.length} non-core subscriber registration(s) and ${projects.length} assigned tenant project(s).\n`);
  if (!applyChanges) return;
  const externalProjectIds = [];
  for (const project of projects) {
    const { firebaseProjectId, cloudflareProject } = assertSafeProject(project);
    process.stdout.write(`Deleting isolated subscriber project ${firebaseProjectId}.\n`);
    await deleteCloudflareProject(cloudflareProject);
    deleteGoogleProject(firebaseProjectId);
    externalProjectIds.push(firebaseProjectId);
  }
  const completed = await platformApi({
    action: 'complete-noncore-subscriber-cleanup',
    confirmation,
    externalProjects: externalProjectIds
  });
  result.completed = true;
  result.completedAt = new Date().toISOString();
  result.deleted = completed.plan || {};
  writeFileSync('tenant-subscriber-cleanup-result.json', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
