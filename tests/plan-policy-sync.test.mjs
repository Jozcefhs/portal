import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalSubscriptionBridgeConfigured,
  loadCanonicalPlanCatalog,
  loadCanonicalSubscriptionPolicy,
  refreshOrganizationPlanPolicy
} from '../functions/lib/plan-policy-sync.js';

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

test('a confirmed missing central subscription is distinguishable from a bridge outage', async () => {
  const configured = {
    ALLOW_CANONICAL_API_PROXY: 'true',
    CANONICAL_PORTAL_URL: 'https://dynamax.example',
    CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions'
  };
  assert.equal(canonicalSubscriptionBridgeConfigured(configured), true);
  await assert.rejects(
    () => loadCanonicalSubscriptionPolicy(configured, 'retired-workspace', async () =>
      Response.json({ ok: false, message: 'No active subscription record was found for this workspace.' }, { status: 404 })),
    (error) => error?.status === 404 && error?.code === 'DYNAMAX_SUBSCRIPTION_NOT_FOUND'
  );
});

test('a tenant with no central registration is converted from a stale active snapshot to terminated', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).endsWith('/api/plan-catalog')
    ? Response.json({ ok: true, catalog: { Plans: [{ Name: 'Starter', EntitlementsByEdition: { faith: ['members'] } }] } })
    : Response.json({ ok: false, message: 'No active subscription record was found for this workspace.' }, { status: 404 });
  try {
    const refreshed = await refreshOrganizationPlanPolicy({
      FIREBASE_PROJECT_ID: 'retired-workspace',
      ALLOW_CANONICAL_API_PROXY: 'true',
      CANONICAL_PORTAL_URL: 'https://retirement-test.example',
      CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions'
    }, {
      WorkspaceId: 'retired-workspace',
      Edition: 'faith',
      Plan: 'Starter',
      PlanEntitlements: ['members'],
      SubscriptionStatus: 'Active'
    });
    assert.equal(refreshed.SubscriptionStatus, 'Terminated');
    assert.deepEqual(refreshed.PlanEntitlements, []);
    assert.match(refreshed.SubscriptionMessage, /no longer registered/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a temporary central outage keeps the last tenant subscription snapshot', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('temporary network outage'); };
  const snapshot = {
    WorkspaceId: 'outage-workspace',
    Edition: 'faith',
    Plan: 'Starter',
    PlanEntitlements: ['members'],
    SubscriptionStatus: 'Active'
  };
  try {
    const refreshed = await refreshOrganizationPlanPolicy({
      FIREBASE_PROJECT_ID: 'outage-workspace',
      ALLOW_CANONICAL_API_PROXY: 'true',
      CANONICAL_PORTAL_URL: 'https://outage-test.example',
      CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions'
    }, snapshot);
    assert.deepEqual(refreshed, snapshot);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
