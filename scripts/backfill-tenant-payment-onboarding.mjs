import { generateKeyPairSync } from 'node:crypto';

const clean = (value) => String(value ?? '').trim();
const platformUrl = clean(process.env.DYNAMAX_PLATFORM_URL || 'https://dynamaxms.pages.dev').replace(/\/$/, '');
const platformPassword = clean(process.env.DYNAMAX_TENANT_PROVISIONER_SECRET);
const cloudflareAccountId = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const cloudflareToken = clean(process.env.CLOUDFLARE_API_TOKEN);
const centralProject = clean(process.env.DYNAMAX_PLATFORM_PROJECT || 'dynamaxms').toLowerCase();
const selectedProject = clean(process.env.DYNAMAX_TENANT_PROJECT || 'all').toLowerCase();

function requireConfiguration() {
  const missing = [];
  if (!platformPassword) missing.push('DYNAMAX_TENANT_PROVISIONER_SECRET');
  if (!cloudflareAccountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!cloudflareToken) missing.push('CLOUDFLARE_API_TOKEN');
  if (missing.length) throw new Error(`Missing payment-onboarding configuration: ${missing.join(', ')}.`);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false || data?.ok === false) {
    throw new Error(data?.message || data?.errors?.[0]?.message || `${options.method || 'GET'} ${url} failed (${response.status}).`);
  }
  return data;
}

function cloudflareEndpoint(project, suffix = '') {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/pages/projects/${encodeURIComponent(project)}${suffix}`;
}

function cloudflareHeaders() {
  return { Authorization: `Bearer ${cloudflareToken}`, 'Content-Type': 'application/json' };
}

async function patchProductionVariables(project, envVars) {
  await jsonRequest(cloudflareEndpoint(project), {
    method: 'PATCH',
    headers: cloudflareHeaders(),
    body: JSON.stringify({ deployment_configs: { production: { env_vars: envVars } } })
  });
}

async function platformApi(payload) {
  return jsonRequest(`${platformUrl}/api/tenant-project-pool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: platformPassword, ...payload })
  });
}

function tenantControlKeyPair() {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { publicKey: clean(pair.publicKey), privateKey: clean(pair.privateKey) };
}

async function configureCentralControlPlane() {
  await patchProductionVariables(centralProject, {
    CLOUDFLARE_ACCOUNT_ID: { type: 'plain_text', value: cloudflareAccountId },
    CLOUDFLARE_PAGES_API_TOKEN: { type: 'secret_text', value: cloudflareToken }
  });
  process.stdout.write('Central payment control plane variables configured.\n');
}

async function main() {
  requireConfiguration();
  await configureCentralControlPlane();
  const inventory = await platformApi({ action: 'load' });
  const slots = (inventory.slots || []).filter((slot) => {
    const active = ['ready', 'assigned'].includes(clean(slot.Status).toLowerCase());
    const selected = selectedProject === 'all' || clean(slot.CloudflareProject).toLowerCase() === selectedProject;
    return active && selected && slot.TenantControlKeyConfigured !== true;
  });
  if (selectedProject !== 'all' && !slots.length) {
    const existing = (inventory.slots || []).find((slot) => clean(slot.CloudflareProject).toLowerCase() === selectedProject);
    if (!existing) throw new Error(`Tenant project ${selectedProject} was not found in the managed pool.`);
    process.stdout.write(`Tenant project ${selectedProject} already has secure payment onboarding.\n`);
    return;
  }
  for (const slot of slots) {
    const project = clean(slot.CloudflareProject).toLowerCase();
    const keyPair = tenantControlKeyPair();
    await patchProductionVariables(project, {
      TENANT_CONTROL_PLANE_PRIVATE_KEY: { type: 'secret_text', value: keyPair.privateKey }
    });
    await platformApi({ action: 'set-control-key', projectId: project, publicKey: keyPair.publicKey });
    process.stdout.write(`${project}: secure payment onboarding keys configured.\n`);
  }
  process.stdout.write(`Updated ${slots.length} tenant project(s).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
