import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function clean(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return clean(value).toLowerCase();
}

export function validateDeploymentPayload(payload, expected = {}) {
  if (!payload?.ok || !payload?.profile) {
    throw new Error('The deployment settings endpoint did not return an organisation profile.');
  }
  const actualWorkspace = clean(payload.profile.WorkspaceId);
  const actualEdition = normalized(payload.profile.OrganisationEdition);
  const expectedWorkspace = clean(expected.workspaceId);
  const expectedEdition = normalized(expected.edition);

  if (normalized(actualWorkspace) !== normalized(expectedWorkspace)) {
    throw new Error(`Deployment workspace mismatch: expected ${expectedWorkspace}, received ${actualWorkspace || 'blank'}.`);
  }
  if (actualEdition !== expectedEdition) {
    throw new Error(`Deployment edition mismatch: expected ${expectedEdition}, received ${actualEdition || 'blank'}.`);
  }
  return { workspaceId: actualWorkspace, edition: actualEdition };
}

export function validateSubscriptionBridgePayload(payload) {
  if (!payload?.ok || !payload?.catalog || typeof payload.catalog !== 'object') {
    throw new Error('The deployment cannot reach the central Dynamax subscription service. Check the three subscription bridge variables in Cloudflare.');
  }
  return payload.catalog;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

export async function verifyOrganisationDeployment(options = {}) {
  const baseUrl = new URL(requiredOption(options.url, 'Deployment URL'));
  const expected = {
    workspaceId: requiredOption(options.workspaceId, 'Expected workspace ID'),
    edition: requiredOption(options.edition, 'Expected edition')
  };
  const attempts = Math.max(1, Number(options.attempts || 6));
  const delayMs = Math.max(0, Number(options.delayMs ?? 5000));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const cacheKey = `deployment=${Date.now()}-${attempt}`;
      const versionUrl = new URL(`/version.json?${cacheKey}`, baseUrl);
      const settingsUrl = new URL(`/api/settings?${cacheKey}`, baseUrl);
      const subscriptionUrl = new URL(`/api/plan-catalog?${cacheKey}`, baseUrl);
      const [version, settings, subscription] = await Promise.all([
        fetchJson(versionUrl),
        fetchJson(settingsUrl),
        fetchJson(subscriptionUrl)
      ]);
      const identity = validateDeploymentPayload(settings, expected);
      validateSubscriptionBridgePayload(subscription);
      return { ...identity, version: clean(version.version) };
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
    }
  }
  throw lastError || new Error('The deployment could not be verified.');
}

function requiredOption(value, label) {
  const result = clean(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? clean(process.argv[index + 1]) : '';
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    const result = await verifyOrganisationDeployment({
      url: argumentValue('--url'),
      workspaceId: argumentValue('--workspace'),
      edition: argumentValue('--edition')
    });
    process.stdout.write(`Verified ${result.workspaceId} (${result.edition}) on version ${result.version || 'unknown'}.\n`);
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
