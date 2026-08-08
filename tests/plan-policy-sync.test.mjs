import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCanonicalPlanCatalog, loadCanonicalSubscriptionPolicy } from '../functions/lib/plan-policy-sync.js';

test('subscriber deployments load plan entitlements through the canonical bridge', async () => {
  let requestedUrl = '';
  let requestedWorkspace = '';
  const catalog = await loadCanonicalPlanCatalog({
    ALLOW_CANONICAL_API_PROXY: 'true',
    CANONICAL_PORTAL_URL: 'https://dynamax.example/some/path',
    CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions',
    DYNAMAX_WORKSPACE_ID: 'church-main'
  }, async (url, options) => {
    requestedUrl = String(url);
    requestedWorkspace = options.headers['X-Dynamax-Workspace'];
    return Response.json({
      ok: true,
      catalog: {
        Currency: 'NGN',
        ModuleCatalogVersion: 2,
        Plans: [
          {
            Name: 'Starter',
            EntitlementsByEdition: {
              faith: ['humanResources', 'staffAttendance']
            }
          }
        ]
      }
    });
  });
  assert.equal(requestedUrl, 'https://dynamax.example/api/plan-catalog');
  assert.equal(requestedWorkspace, 'church-main');
  assert.deepEqual(catalog.Plans.Starter.EntitlementsByEdition.faith, ['humanResources', 'staffAttendance']);
});

test('subscriber deployments load their active subscription through the canonical bridge', async () => {
  let requestedUrl = '';
  const policy = await loadCanonicalSubscriptionPolicy({
    ALLOW_CANONICAL_API_PROXY: 'true',
    CANONICAL_PORTAL_URL: 'https://dynamax.example',
    CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions'
  }, 'church-main', async (url, options) => {
    requestedUrl = String(url);
    assert.equal(options.headers['X-Dynamax-Workspace'], 'church-main');
    return Response.json({ ok: true, policy: { WorkspaceId: 'church-main', Plan: 'Professional', UserLimit: 50 } });
  });
  assert.equal(requestedUrl, 'https://dynamax.example/api/subscription-policy');
  assert.equal(policy.Plan, 'Professional');
  assert.equal(policy.UserLimit, 50);
});

test('plan-policy bridge fails closed when subscriber bridge variables are missing', async () => {
  await assert.rejects(
    () => loadCanonicalPlanCatalog({}, async () => Response.json({ ok: true })),
    (error) => error?.code === 'DYNAMAX_PLAN_POLICY_BRIDGE_NOT_CONFIGURED'
  );
});
