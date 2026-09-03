import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePlatformCatalogPayload } from '../scripts/verify-platform-deployment.mjs';
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
