import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDITIONS = new Set(['school', 'faith', 'organization']);
const INDEX_CONFIGS = Object.freeze({
  school: 'firebase.school.json',
  church: 'firebase.church.json',
  organization: 'firebase.organization.json'
});

function clean(value) {
  return String(value ?? '').trim();
}

function normalizedKey(value) {
  return clean(value).toLowerCase();
}

function requiredString(row, key, label) {
  const value = clean(row?.[key]);
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function assertUnique(seen, category, value, organisationId) {
  const key = normalizedKey(value);
  if (seen.has(key)) {
    throw new Error(`${category} "${value}" is used by both ${seen.get(key)} and ${organisationId}.`);
  }
  seen.set(key, organisationId);
}

export function validateOrganisationRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('The organisation registry must be a JSON object.');
  }
  if (Number(registry.schemaVersion) !== 1) {
    throw new Error('Unsupported organisation registry schema version.');
  }
  if (!Array.isArray(registry.organisations) || registry.organisations.length === 0) {
    throw new Error('The organisation registry must contain at least one organisation.');
  }

  const seen = {
    id: new Map(),
    githubEnvironment: new Map(),
    cloudflareProject: new Map(),
    workspaceId: new Map()
  };

  const organisations = registry.organisations.map((row, index) => {
    const label = `Organisation ${index + 1}`;
    const id = requiredString(row, 'id', `${label} id`).toLowerCase();
    const name = requiredString(row, 'name', `${label} name`);
    const edition = requiredString(row, 'edition', `${label} edition`).toLowerCase();
    const indexProfile = requiredString(row, 'indexProfile', `${label} index profile`).toLowerCase();
    const githubEnvironment = requiredString(row, 'githubEnvironment', `${label} GitHub environment`);
    const cloudflareAccountId = requiredString(row, 'cloudflareAccountId', `${label} Cloudflare account ID`).toLowerCase();
    const cloudflareProject = requiredString(row, 'cloudflareProject', `${label} Cloudflare project`).toLowerCase();
    const workspaceId = requiredString(row, 'workspaceId', `${label} workspace ID`);
    const rolloutOrder = Number(row.rolloutOrder ?? 100);

    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(id)) {
      throw new Error(`${label} id must contain only lowercase letters, numbers and internal hyphens.`);
    }
    if (!EDITIONS.has(edition)) {
      throw new Error(`${label} edition must be school, faith or organization.`);
    }
    if (!INDEX_CONFIGS[indexProfile]) {
      throw new Error(`${label} index profile must be school, church or organization.`);
    }
    if (edition === 'school' && indexProfile !== 'school') {
      throw new Error(`${label} must use the school index profile.`);
    }
    if (edition === 'faith' && indexProfile !== 'church') {
      throw new Error(`${label} must use the church index profile.`);
    }
    if (edition === 'organization' && indexProfile !== 'organization') {
      throw new Error(`${label} must use the organization index profile.`);
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(cloudflareProject)) {
      throw new Error(`${label} Cloudflare project must be a lowercase Pages project name.`);
    }
    if (!/^[a-f0-9]{32}$/.test(cloudflareAccountId)) {
      throw new Error(`${label} Cloudflare account ID must be a 32-character hexadecimal identifier.`);
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,118}[A-Za-z0-9])?$/.test(workspaceId)) {
      throw new Error(`${label} workspace ID contains unsupported characters.`);
    }
    if (!Number.isFinite(rolloutOrder) || rolloutOrder < 0) {
      throw new Error(`${label} rollout order must be a non-negative number.`);
    }

    assertUnique(seen.id, 'Organisation id', id, id);
    assertUnique(seen.githubEnvironment, 'GitHub environment', githubEnvironment, id);
    assertUnique(seen.cloudflareProject, 'Cloudflare Pages project', cloudflareProject, id);
    assertUnique(seen.workspaceId, 'Workspace ID', workspaceId, id);

    return {
      id,
      name,
      edition,
      indexProfile,
      firebaseConfig: INDEX_CONFIGS[indexProfile],
      githubEnvironment,
      cloudflareAccountId,
      cloudflareProject,
      workspaceId,
      enabled: row.enabled !== false,
      rolloutOrder
    };
  });

  return organisations.sort((left, right) => (
    left.rolloutOrder - right.rolloutOrder || left.id.localeCompare(right.id)
  ));
}

export function buildDeploymentMatrix(registry, options = {}) {
  const target = normalizedKey(options.target || 'all');
  const organisations = validateOrganisationRegistry(registry);
  if (target === 'all') return organisations.filter((row) => row.enabled);

  const selected = organisations.find((row) => normalizedKey(row.id) === target);
  if (!selected) throw new Error(`Unknown organisation "${options.target}".`);
  if (!selected.enabled && options.includeDisabled !== true) {
    throw new Error(`Organisation "${selected.id}" is disabled.`);
  }
  return [selected];
}

async function loadRegistry() {
  const source = await readFile(new URL('../deploy/organisations.json', import.meta.url), 'utf8');
  return JSON.parse(source);
}

function argumentValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? clean(process.argv[index + 1]) : fallback;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    const registry = await loadRegistry();
    const organisations = validateOrganisationRegistry(registry);
    if (process.argv.includes('--validate-only')) {
      process.stdout.write(`Validated ${organisations.length} organisation(s).\n`);
    } else {
      const target = argumentValue('--target', 'all');
      const matrix = buildDeploymentMatrix(registry, {
        target,
        includeDisabled: process.argv.includes('--include-disabled')
      });
      process.stdout.write(JSON.stringify(matrix));
    }
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
