import { generateKeyPairSync } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const clean = (value) => String(value ?? '').trim();
const platformUrl = clean(process.env.DYNAMAX_PLATFORM_URL || 'https://dynamaxms.pages.dev').replace(/\/$/, '');
const platformPassword = clean(process.env.DYNAMAX_TENANT_PROVISIONER_SECRET);
const cloudflareAccountId = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const cloudflareToken = clean(process.env.CLOUDFLARE_API_TOKEN);
const centralProject = clean(process.env.DYNAMAX_PLATFORM_PROJECT || 'dynamaxms').toLowerCase();
const selectedProject = clean(process.env.DYNAMAX_TENANT_PROJECT || 'all').toLowerCase();
const clearTenantPaystackKeys = clean(process.env.DYNAMAX_CLEAR_TENANT_PAYSTACK_KEYS).toLowerCase() === 'true';
const includeManagedOrganisations = clean(process.env.DYNAMAX_INCLUDE_MANAGED_ORGANISATIONS || 'true').toLowerCase() === 'true';

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

function managedOrganisationRegistry() {
  if (!includeManagedOrganisations) return [];
  const registry = JSON.parse(readFileSync(new URL('../deploy/organisations.json', import.meta.url), 'utf8'));
  return (registry.organisations || []).filter((organisation) => organisation.enabled !== false);
}

function writeWorkflowOutputs(values = {}) {
  const outputPath = clean(process.env.GITHUB_OUTPUT);
  if (!outputPath) return;
  appendFileSync(outputPath, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
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
  const managedInventory = includeManagedOrganisations
    ? await platformApi({ action: 'load-managed-organisations' })
    : { organisations: [] };
  const slots = (inventory.slots || []).filter((slot) => {
    const active = ['ready', 'assigned'].includes(clean(slot.Status).toLowerCase());
    const selected = selectedProject === 'all' || clean(slot.CloudflareProject).toLowerCase() === selectedProject;
    return active && selected;
  });
  const managedStateByProject = new Map((managedInventory.organisations || []).map((organisation) => [
    clean(organisation.CloudflareProject).toLowerCase(),
    organisation
  ]));
  const managedOrganisations = managedOrganisationRegistry().filter((organisation) => (
    selectedProject === 'all' || clean(organisation.cloudflareProject).toLowerCase() === selectedProject
  ));
  if (selectedProject !== 'all' && !slots.length && !managedOrganisations.length) {
    throw new Error(`Active tenant or managed organisation project ${selectedProject} was not found.`);
  }
  let updatedPool = 0;
  let updatedManaged = 0;
  for (const slot of slots) {
    const project = clean(slot.CloudflareProject).toLowerCase();
    const variables = {};
    let keyPair = null;
    if (slot.TenantControlKeyConfigured !== true) {
      keyPair = tenantControlKeyPair();
      variables.TENANT_CONTROL_PLANE_PRIVATE_KEY = { type: 'secret_text', value: keyPair.privateKey };
    }
    if (clearTenantPaystackKeys) variables.PAYSTACK_SECRET_KEY = null;
    if (Object.keys(variables).length) await patchProductionVariables(project, variables);
    if (keyPair) {
      await platformApi({ action: 'set-control-key', projectId: project, publicKey: keyPair.publicKey });
    }
    if (clearTenantPaystackKeys) {
      await platformApi({
        action: 'reset-paystack-connection',
        projectId: project,
        requestedAt: new Date().toISOString()
      });
    }
    if (keyPair || clearTenantPaystackKeys) {
      updatedPool += 1;
      const changes = [keyPair ? 'secure onboarding key added' : '', clearTenantPaystackKeys ? 'Paystack key cleared' : '']
        .filter(Boolean)
        .join('; ');
      process.stdout.write(`${project}: ${changes}.\n`);
    }
  }
  for (const organisation of managedOrganisations) {
    const project = clean(organisation.cloudflareProject).toLowerCase();
    const current = managedStateByProject.get(project) || {};
    const variables = {};
    let keyPair = null;
    if (current.TenantControlKeyConfigured !== true) {
      keyPair = tenantControlKeyPair();
      variables.TENANT_CONTROL_PLANE_PRIVATE_KEY = { type: 'secret_text', value: keyPair.privateKey };
    }
    if (clearTenantPaystackKeys) variables.PAYSTACK_SECRET_KEY = null;
    if (Object.keys(variables).length) await patchProductionVariables(project, variables);
    if (keyPair || clearTenantPaystackKeys) {
      const requestedAt = new Date().toISOString();
      await platformApi({
        action: 'register-managed-organisation',
        organisation: {
          OrganisationName: clean(organisation.name),
          Edition: clean(organisation.edition),
          WorkspaceId: clean(organisation.workspaceId),
          CloudflareProject: project,
          PortalUrl: `https://${project}.pages.dev`,
          TenantControlPublicKey: keyPair?.publicKey || '',
          markDeploymentPending: true,
          resetPaystackConnection: clearTenantPaystackKeys,
          requestedAt
        }
      });
      updatedManaged += 1;
      const changes = [keyPair ? 'secure onboarding key added' : '', clearTenantPaystackKeys ? 'Paystack key cleared' : '']
        .filter(Boolean)
        .join('; ');
      process.stdout.write(`${project}: ${changes}.\n`);
    }
  }
  process.stdout.write(`Updated ${updatedPool} of ${slots.length} active pooled tenant project(s).\n`);
  process.stdout.write(`Updated ${updatedManaged} of ${managedOrganisations.length} managed organisation project(s).\n`);
  writeWorkflowOutputs({
    pool_updated: updatedPool > 0,
    managed_updated: updatedManaged > 0,
    pool_target: selectedProject === 'all' ? 'all' : selectedProject,
    managed_target: selectedProject === 'all' ? 'all' : selectedProject
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
