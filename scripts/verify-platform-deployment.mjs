import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
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

export function validateTutorialCatalogPayload(payload) {
  if (!payload?.ok || typeof payload.published !== 'boolean'
      || !payload.catalog || typeof payload.catalog !== 'object'
      || typeof payload.catalog.ChannelUrl !== 'string'
      || !['school', 'faith', 'organization'].every((edition) =>
        payload.catalog.Editions?.[edition]?.Links
        && typeof payload.catalog.Editions[edition].Links === 'object')) {
    throw new Error('The central Dynamax tutorial catalogue did not return a valid response.');
  }
  return { tutorialPublished: payload.published };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

export async function verifyRegistrationCheckout(baseUrl) {
  const get = async (url) => {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Registration checkout returned HTTP ' + response.status);
    return response;
  };
  const pageUrl = new URL('/register-organization', baseUrl);
  const html = await (await get(pageUrl)).text();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(match => new URL(match[1], pageUrl));
  for (const file of ['js/payment-methods.js', 'js/register-organization.js']) {
    const asset = scripts.find(url => url.origin === pageUrl.origin && url.pathname === '/' + file);
    if (!asset) throw new Error('Registration checkout is missing ' + file);
    const expected = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    const actual = await (await get(asset)).text();
    if (actual.replaceAll('\r\n', '\n') !== expected.replaceAll('\r\n', '\n')) {
      throw new Error('Registration checkout is serving a different version of ' + file);
    }
  }
  const response = await get(new URL('/api/platform-payment-methods', baseUrl));
  const { ok, methods } = await response.json();
  if (!ok || typeof methods?.online?.enabled !== 'boolean' || typeof methods?.directTransfer?.enabled !== 'boolean'
      || !/\bno-store\b/i.test(response.headers.get('cache-control') || '')) {
    throw new Error('Registration checkout could not verify the current payment settings.');
  }
  return { online: methods.online.enabled, directTransfer: methods.directTransfer.enabled };
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
      const tutorialUrl = new URL(`/api/tutorial-catalog?${cacheKey}`, baseUrl);
      const plan = validatePlatformCatalogPayload(await fetchJson(catalogUrl));
      const tutorial = validateTutorialCatalogPayload(await fetchJson(tutorialUrl));
      return { ...plan, ...tutorial, checkout: await verifyRegistrationCheckout(baseUrl) };
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
      `Verified Dynamax platform catalogue v${result.version} and owner tutorial API (published: ${result.tutorialPublished}).\n`
    );
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
