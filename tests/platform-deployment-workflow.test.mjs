import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePlatformCatalogPayload, validateTutorialCatalogPayload, verifyPlatformDeployment } from '../scripts/verify-platform-deployment.mjs';
import {
  SUBSCRIPTION_MODULE_CATALOG_VERSION,
  subscriptionModulesForEdition
} from '../functions/lib/subscription-plans.js';

const workflow = await readFile(
  new URL('../.github/workflows/deploy-platform.yml', import.meta.url),
  'utf8'
);

test('the central Dynamax platform deploys to Cloudflare Pages on main', () => {
  assert.match(workflow, /name: Deploy Dynamax platform/);
  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /CLOUDFLARE_PROJECT: dynamaxms/);
  assert.match(workflow, /cloudflare\/wrangler-action@v3/);
  assert.match(workflow, /wranglerVersion: "4\.125\.0"/);
  assert.match(workflow, /pages deploy \.pages-deploy/);
  assert.match(workflow, /verify-platform-deployment\.mjs/);
  assert.match(workflow, /GOOGLE_OAUTH_CLIENT_ID/);
  assert.match(workflow, /GOOGLE_OAUTH_CLIENT_SECRET/);
  assert.match(workflow, /pages secret bulk/);
  assert.match(workflow, /GOOGLE_OAUTH_CLIENT_ID":null/);
  assert.match(workflow, /GOOGLE_OAUTH_CLIENT_SECRET":null/);
  assert.match(workflow, /stale central OAuth secrets were removed/);
  assert.doesNotMatch(workflow, /DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY|PAYSTACK_SECRET_KEY|ADMIN_WEB_PASSWORD/);
});

test('the live platform verifier requires Hotel Services for Church and Other Organisation', () => {
  const moduleCatalog = Object.fromEntries(
    ['school', 'faith', 'organization'].map((edition) => [
      edition,
      subscriptionModulesForEdition(edition)
    ])
  );
  const result = validatePlatformCatalogPayload({
    ok: true,
    catalog: {
      ModuleCatalogVersion: SUBSCRIPTION_MODULE_CATALOG_VERSION,
      ModuleCatalog: moduleCatalog
    }
  });
  assert.equal(result.version, SUBSCRIPTION_MODULE_CATALOG_VERSION);
  assert.ok(result.faithModules > 0);
  assert.ok(result.organizationModules > 0);

  const withoutHotel = structuredClone(moduleCatalog);
  withoutHotel.faith = withoutHotel.faith.filter((module) => module.Key !== 'hotel');
  assert.throws(
    () => validatePlatformCatalogPayload({
      ok: true,
      catalog: {
        ModuleCatalogVersion: SUBSCRIPTION_MODULE_CATALOG_VERSION,
        ModuleCatalog: withoutHotel
      }
    }),
    /faith module catalogue does not match|Hotel Services is missing/
  );
});

test('the live platform verifier rejects an unavailable or malformed owner tutorial API', () => {
  const catalog = {
    ChannelUrl: '',
    Editions: Object.fromEntries(['school', 'faith', 'organization'].map((edition) => [
      edition, { Links: {} }
    ]))
  };
  assert.deepEqual(validateTutorialCatalogPayload({ ok: true, published: false, catalog }), {
    tutorialPublished: false
  });
  assert.throws(() => validateTutorialCatalogPayload({ ok: false, message: 'The API backend is not configured for this deployment.' }), /tutorial catalogue/);
  assert.throws(() => validateTutorialCatalogPayload({ ok: true, published: false, catalog: {} }), /tutorial catalogue/);
});

test('deployment verification reads both the plan and owner tutorial APIs', async () => {
  const originalFetch = globalThis.fetch;
  const requestedPaths = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    requestedPaths.push(path);
    if (path === '/api/plan-catalog') {
      return Response.json({ ok: true, catalog: {
        ModuleCatalogVersion: SUBSCRIPTION_MODULE_CATALOG_VERSION,
        ModuleCatalog: Object.fromEntries(['school', 'faith', 'organization'].map((edition) => [
          edition, subscriptionModulesForEdition(edition)
        ]))
      } });
    }
    return Response.json({ ok: true, published: false, catalog: {
      ChannelUrl: '',
      Editions: Object.fromEntries(['school', 'faith', 'organization'].map((edition) => [edition, { Links: {} }]))
    } });
  };
  try {
    const result = await verifyPlatformDeployment({ url: 'https://dynamax.example', attempts: 1, delayMs: 0 });
    assert.equal(result.tutorialPublished, false);
    assert.deepEqual(requestedPaths, ['/api/plan-catalog', '/api/tutorial-catalog']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
