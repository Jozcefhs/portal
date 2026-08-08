import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const applyChanges = lower(process.env.TENANT_RETIRE_APPLY) === 'true';
const platformUrl = clean(process.env.DYNAMAX_PLATFORM_URL || 'https://dynamaxms.pages.dev').replace(/\/$/, '');
const platformPassword = clean(process.env.DYNAMAX_TENANT_PROVISIONER_SECRET);
const cloudflareAccountId = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const cloudflareToken = clean(process.env.CLOUDFLARE_API_TOKEN);
const maximum = Math.min(20, Math.max(1, Number(process.env.TENANT_RETIRE_MAXIMUM || 5) || 5));
const runnerId = clean(process.env.TENANT_RETIRE_RUNNER_ID || `local-${Date.now()}`);
const completed = [];
const failed = [];

function requireConfiguration() {
  const missing = [];
  if (!platformPassword) missing.push('DYNAMAX_TENANT_PROVISIONER_SECRET');
  if (!cloudflareAccountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!cloudflareToken) missing.push('CLOUDFLARE_API_TOKEN');
  if (missing.length) throw new Error(`Missing retirement configuration: ${missing.join(', ')}.`);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.errors?.[0]?.message || `${options.method || 'GET'} ${url} failed (${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
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

function assertSafeTenantProject(retirement) {
  const firebaseProjectId = lower(retirement.FirebaseProjectId);
  const cloudflareProject = lower(retirement.CloudflareProject);
  if (!/^dynamax-tenant-[a-z0-9-]{1,64}$/.test(firebaseProjectId)) {
    throw new Error(`Refusing to delete unexpected Firebase project ID "${firebaseProjectId}".`);
  }
  if (cloudflareProject !== firebaseProjectId) {
    throw new Error('Refusing retirement because the Firebase and Cloudflare tenant project IDs differ.');
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
  const existing = clean(execFileSync('gcloud', ['projects', 'describe', projectId, '--format=value(lifecycleState)'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }));
  if (!existing || lower(existing) === 'delete_requested') return;
  execFileSync('gcloud', ['projects', 'delete', projectId, '--quiet'], { stdio: 'inherit' });
}

async function finish(retirement, status, lastError = '') {
  return platformApi({
    action: 'finish-retirement',
    retirement: {
      Reference: clean(retirement.Reference),
      LeaseId: clean(retirement.LeaseId),
      Status: status,
      LastError: clean(lastError).slice(0, 1000)
    }
  });
}

async function main() {
  requireConfiguration();
  if (!applyChanges) {
    writeFileSync('tenant-retirement-result.json', JSON.stringify({ dryRun: true, message: 'No tenant project was changed.' }, null, 2));
    return;
  }
  for (let index = 0; index < maximum; index += 1) {
    const claim = await platformApi({ action: 'claim-retirement', runnerId });
    const retirement = claim.retirement;
    if (!retirement) break;
    try {
      const { firebaseProjectId, cloudflareProject } = assertSafeTenantProject(retirement);
      process.stdout.write(`Retiring isolated tenant project ${firebaseProjectId}.\n`);
      await deleteCloudflareProject(cloudflareProject);
      deleteGoogleProject(firebaseProjectId);
      await finish(retirement, 'Completed');
      completed.push(firebaseProjectId);
    } catch (error) {
      const message = clean(error?.message || error);
      failed.push({ reference: clean(retirement.Reference), message });
      await finish(retirement, 'Failed', message).catch(() => null);
    }
  }
  writeFileSync('tenant-retirement-result.json', JSON.stringify({ dryRun: false, completed, failed }, null, 2));
  if (failed.length) throw new Error(`${failed.length} tenant retirement(s) failed. See tenant-retirement-result.json.`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
