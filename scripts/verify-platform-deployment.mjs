import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SUBSCRIPTION_MODULE_CATALOG_VERSION,
  subscriptionModulesForEdition
} from '../functions/lib/subscription-plans.js';

function clean(value) {
  return String(value ?? '').trim();
}

function moduleKeys(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => clean(row?.Key))
    .filter(Boolean)
    .sort();
}

export function validatePlatformCatalogPayload(payload) {
  if (!payload?.ok || !payload?.catalog || typeof payload.catalog !== 'object') {
    throw new Error('The central Dynamax plan catalogue did not return a valid response.');
  }

  const catalog = payload.catalog;
  const actualVersion = Number(catalog.ModuleCatalogVersion || 0);
  if (actualVersion !== SUBSCRIPTION_MODULE_CATALOG_VERSION) {
    throw new Error(
      `Platform catalogue version mismatch: expected ${SUBSCRIPTION_MODULE_CATALOG_VERSION}, received ${actualVersion || 'blank'}.`
    );
  }

  for (const edition of ['school', 'faith', 'organization']) {
    const expected = moduleKeys(subscriptionModulesForEdition(edition));
    const actual = moduleKeys(catalog.ModuleCatalog?.[edition]);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Platform ${edition} module catalogue does not match the deployed source.`);
    }
  }

  for (const edition of ['faith', 'organization']) {
    if (!moduleKeys(catalog.ModuleCatalog?.[edition]).includes('hotel')) {
      throw new Error(`Hotel Services is missing from the ${edition} plan catalogue.`);
    }
  }

  return {
    version: actualVersion,
    faithModules: moduleKeys(catalog.ModuleCatalog.faith).length,
    organizationModules: moduleKeys(catalog.ModuleCatalog.organization).length
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

export async function verifyPlatformDeployment(options = {}) {
  const baseUrl = new URL(requiredOption(options.url, 'Platform URL'));
  const attempts = Math.max(1, Number(options.attempts || 8));
  const delayMs = Math.max(0, Number(options.delayMs ?? 5000));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const cacheKey = `deployment=${Date.now()}-${attempt}`;
      const catalogUrl = new URL(`/api/plan-catalog?${cacheKey}`, baseUrl);
      return validatePlatformCatalogPayload(await fetchJson(catalogUrl));
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
    }
  }
  throw lastError || new Error('The central Dynamax deployment could not be verified.');
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
    const result = await verifyPlatformDeployment({
      url: argumentValue('--url')
    });
    process.stdout.write(
      `Verified Dynamax platform catalogue v${result.version} with Hotel Services for Church and Other Organisation plans.\n`
    );
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

