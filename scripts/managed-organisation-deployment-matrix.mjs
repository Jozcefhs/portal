import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDeploymentMatrix } from './organisation-deployment-matrix.mjs';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function argumentValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? clean(process.argv[index + 1]) : fallback;
}

async function platformApi() {
  const platformUrl = clean(process.env.DYNAMAX_PLATFORM_URL || 'https://dynamax.cc').replace(/\/$/, '');
  const password = clean(process.env.DYNAMAX_TENANT_PROVISIONER_SECRET);
  if (!password) throw new Error('DYNAMAX_TENANT_PROVISIONER_SECRET is required to load managed deployments.');
  const response = await fetch(`${platformUrl}/api/tenant-project-pool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, action: 'load-managed-organisations' })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || `Managed deployment inventory failed (${response.status}).`);
  }
  return data.organisations || [];
}

export function buildManagedOrganisationDeploymentMatrix(registry, managedOrganisations, options = {}) {
  const target = lower(options.target || 'all');
  const pendingOnly = options.pendingOnly === true;
  const configured = buildDeploymentMatrix(registry, { target });
  const managedByProject = new Map((managedOrganisations || []).map((row) => [lower(row.CloudflareProject), row]));
  return configured
    .map((organisation) => {
      const managed = managedByProject.get(lower(organisation.cloudflareProject));
      return {
        ...organisation,
        paystackDeploymentPending: managed?.PaystackDeploymentPending === true,
        paystackDeploymentRequestedAt: clean(managed?.PaystackDeploymentRequestedAt),
        emailDeploymentPending: managed?.EmailDeploymentPending === true,
        emailDeploymentRequestedAt: clean(managed?.EmailDeploymentRequestedAt),
        emailDeploymentProvider: lower(managed?.EmailDeploymentProvider)
      };
    })
    .filter((organisation) => !pendingOnly
      || organisation.paystackDeploymentPending
      || organisation.emailDeploymentPending);
}

async function main() {
  const registry = JSON.parse(await readFile(new URL('../deploy/organisations.json', import.meta.url), 'utf8'));
  const managedOrganisations = await platformApi();
  const matrix = buildManagedOrganisationDeploymentMatrix(registry, managedOrganisations, {
    target: argumentValue('--target', 'all'),
    pendingOnly: process.argv.includes('--pending-only')
  });
  process.stdout.write(JSON.stringify(matrix));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
