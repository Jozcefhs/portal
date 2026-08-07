import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequest, onRequestWithIdentityLoader } from '../functions/_middleware.js';

const middleware = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const routes = JSON.parse(await readFile(new URL('../_routes.json', import.meta.url), 'utf8'));

test('Dynamax Pages fail closed unless an API proxy is explicitly configured', () => {
  assert.match(middleware, /env\.FIREBASE_PROJECT_ID/);
  assert.match(middleware, /hasPlatformFirestoreConfiguration/);
  assert.match(middleware, /loadDeploymentIdentity/);
  assert.match(middleware, /if \(!isApi\) return next\(\)/);
  assert.match(middleware, /platformPath && hasPlatformBackend/);
  assert.match(middleware, /env\.ALLOW_CANONICAL_API_PROXY/);
  assert.match(middleware, /env\.CANONICAL_PORTAL_URL/);
  assert.match(middleware, /env\.CANONICAL_API_PROXY_SCOPE/);
  assert.match(middleware, /PLATFORM_SUBSCRIPTION_PROXY_PATHS/);
  assert.match(middleware, /if \(!proxyAllowed \|\| !configuredOrigin\)/);
  assert.doesNotMatch(middleware, /https:\/\/digc-suite\.pages\.dev/);
  assert.doesNotMatch(middleware, /PRIVATE_KEY|SHARED_SECRET|SESSION_SECRET/);
});

test('only real API paths invoke Pages Functions', () => {
  assert.deepEqual(routes, {
    version: 1,
    include: ['/api', '/api/*'],
    exclude: []
  });
  assert.equal(routes.include.some((route) => route.includes('.html')), false);
  assert.equal(routes.include.some((route) => /\/(?:css|js|images|icons|fonts)\//.test(route)), false);
});

test('an API request without local Firebase or explicit proxy opt-in fails closed', async () => {
  let nextCalled = false;
  const response = await onRequest({
    request: new Request('https://school.example/api/settings'),
    env: {},
    next: async () => {
      nextCalled = true;
      return Response.json({ ok: true });
    }
  });
  assert.equal(response.status, 503);
  assert.equal(nextCalled, false);
  assert.deepEqual(await response.json(), {
    ok: false,
    message: 'The API backend is not configured for this deployment.'
  });
});

test('a deployment with a local Firebase backend continues to its own Pages Function', async () => {
  let nextCalled = false;
  let identityCalled = false;
  const response = await onRequestWithIdentityLoader({
    request: new Request('https://school.example/api/settings'),
    env: { FIREBASE_PROJECT_ID: 'school-project' },
    next: async () => {
      nextCalled = true;
      return Response.json({ ok: true, local: true });
    }
  }, async () => {
    identityCalled = true;
    return { workspaceId: 'school', edition: 'school' };
  });
  assert.equal(response.status, 200);
  assert.equal(identityCalled, true);
  assert.equal(nextCalled, true);
  assert.deepEqual(await response.json(), { ok: true, local: true });
});

test('an expired trial blocks operational APIs but preserves sign-in and upgrade recovery routes', async () => {
  const identity = async () => ({
    workspaceId: 'school',
    edition: 'school',
    subscriptionPlan: 'Free',
    subscriptionActive: false,
    subscriptionState: 'trial_expired',
    trialEndsAt: '2026-08-01T00:00:00.000Z',
    subscriptionMessage: 'Your 7-day full-access trial has ended. Choose a paid subscription to continue.'
  });
  let operationalNextCalled = false;
  const blocked = await onRequestWithIdentityLoader({
    request: new Request('https://school.example/api/students'),
    env: { FIREBASE_PROJECT_ID: 'school-project' },
    next: async () => {
      operationalNextCalled = true;
      return Response.json({ ok: true });
    }
  }, identity);
  assert.equal(blocked.status, 402);
  assert.equal(operationalNextCalled, false);
  assert.equal((await blocked.json()).code, 'SUBSCRIPTION_REQUIRED');

  for (const path of ['/api/admin', '/api/staff-session']) {
    const allowed = await onRequestWithIdentityLoader({
      request: new Request(`https://school.example${path}`),
      env: { FIREBASE_PROJECT_ID: 'school-project' },
      next: async () => Response.json({ ok: true })
    }, identity);
    assert.equal(allowed.status, 200, path);
  }

  for (const path of ['/api/plan-catalog', '/api/register-organization']) {
    const allowed = await onRequestWithIdentityLoader({
      request: new Request(`https://dynamax.example${path}`),
      env: { DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID: 'dynamax-platform' },
      next: async () => Response.json({ ok: true })
    }, async () => {
      throw new Error('Platform routes must not load tenant deployment identity.');
    });
    assert.equal(allowed.status, 200, path);
  }
});

test('the central Dynamax backend serves subscriber APIs without a tenant Firebase identity', async () => {
  let identityCalled = false;
  let nextCalled = false;
  const response = await onRequestWithIdentityLoader({
    request: new Request('https://dynamax.example/api/plan-catalog'),
    env: {
      DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID: 'dynamax-platform',
      DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL: 'runtime@dynamax-platform.iam.gserviceaccount.com',
      DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY: 'encrypted-at-runtime'
    },
    next: async () => {
      nextCalled = true;
      return Response.json({ ok: true, platform: true });
    }
  }, async () => {
    identityCalled = true;
    return {};
  });
  assert.equal(response.status, 200);
  assert.equal(nextCalled, true);
  assert.equal(identityCalled, false);
  assert.deepEqual(await response.json(), { ok: true, platform: true });
});

test('staff sign-in uses environment deployment identity without an extra Firestore profile read', async () => {
  let nextCalled = false;
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('Firestore should not be called by middleware for this path.');
  };
  try {
    const response = await onRequest({
      request: new Request('https://school.example/api/staff-session', { method: 'POST' }),
      env: {
        FIREBASE_PROJECT_ID: 'school-project',
        DYNAMAX_WORKSPACE_ID: 'school-main',
        ORGANISATION_EDITION: 'school'
      },
      next: async () => {
        nextCalled = true;
        return Response.json({ ok: true });
      }
    });
    assert.equal(response.status, 200);
    assert.equal(nextCalled, true);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Firestore resource limits are not mislabeled as daily read quota or deployment identity failures', async () => {
  const response = await onRequestWithIdentityLoader({
    request: new Request('https://school.example/api/settings'),
    env: { FIREBASE_PROJECT_ID: 'school-project' },
    next: async () => Response.json({ ok: true })
  }, async () => {
    const error = new Error('Quota exceeded.');
    error.code = 'FIRESTORE_QUOTA_EXHAUSTED';
    error.upstreamCode = 'RESOURCE_EXHAUSTED';
    throw error;
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.message, /resource limit was reached/i);
  assert.match(payload.message, /not necessarily the daily read quota/i);
  assert.doesNotMatch(payload.message, /deployment identity/i);
});

test('a local backend with missing deployment identity fails closed before its Pages Function', async () => {
  let nextCalled = false;
  const response = await onRequest({
    request: new Request('https://school.example/api/settings'),
    env: { FIREBASE_PROJECT_ID: 'school-project' },
    next: async () => {
      nextCalled = true;
      return Response.json({ ok: true });
    }
  });
  assert.equal(response.status, 503);
  assert.equal(nextCalled, false);
  assert.deepEqual(await response.json(), {
    ok: false,
    message: 'Deployment identity is not configured. Add DYNAMAX_WORKSPACE_ID in Cloudflare.'
  });
});

test('a local profile conflict returns 503 without invoking a Pages Function or proxy fallback', async () => {
  let nextCalled = false;
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({ ok: true, proxied: true });
  };
  try {
    const response = await onRequestWithIdentityLoader({
      request: new Request('https://school.example/api/backend'),
      env: {
        FIREBASE_PROJECT_ID: 'school-project',
        ALLOW_CANONICAL_API_PROXY: 'true',
        CANONICAL_PORTAL_URL: 'https://canonical.example'
      },
      next: async () => {
        nextCalled = true;
        return Response.json({ ok: true });
      }
    }, async () => {
      const error = new Error('The database organisation profile belongs to a different workspace.');
      error.code = 'DEPLOYMENT_PROFILE_WORKSPACE_CONFLICT';
      throw error;
    });
    assert.equal(response.status, 503);
    assert.equal(nextCalled, false);
    assert.equal(fetchCalled, false);
    assert.deepEqual(await response.json(), {
      ok: false,
      message: 'The database organisation profile belongs to a different workspace.'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unexpected identity verification failures do not expose secrets', async () => {
  const secret = 'PRIVATE_KEY=do-not-expose';
  const originalError = console.error;
  const errorLines = [];
  console.error = (...values) => errorLines.push(values.join(' '));
  try {
    const response = await onRequestWithIdentityLoader({
      request: new Request('https://school.example/api/backend'),
      env: { FIREBASE_PROJECT_ID: 'school-project' },
      next: async () => Response.json({ ok: true })
    }, async () => {
      throw new Error(`Credential failure: ${secret}`);
    });
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.message, 'The deployment identity could not be verified.');
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.doesNotMatch(errorLines.join('\n'), /PRIVATE_KEY|do-not-expose/i);
  } finally {
    console.error = originalError;
  }
});

test('proxy opt-in still rejects a missing, malformed, insecure, or self-referencing target', async () => {
  for (const canonicalUrl of ['', 'not-a-url', 'http://backend.example', 'https://school.example']) {
    const response = await onRequest({
      request: new Request('https://school.example/api/backend'),
      env: {
        ALLOW_CANONICAL_API_PROXY: 'true',
        CANONICAL_PORTAL_URL: canonicalUrl
      },
      next: async () => Response.json({ ok: true })
    });
    assert.equal(response.status, 503);
  }
});

test('the public subscription bridge forwards billing APIs but blocks tenant staff APIs', async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (request) => {
    forwarded.push(request.url);
    return Response.json({ ok: true, proxied: true });
  };
  const env = {
    ALLOW_CANONICAL_API_PROXY: 'true',
    CANONICAL_PORTAL_URL: 'https://canonical.example',
    CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions'
  };
  try {
    const pricing = await onRequest({
      request: new Request('https://dynamax.example/api/plan-catalog'),
      env,
      next: async () => Response.json({ ok: false })
    });
    assert.equal(pricing.status, 200);
    assert.deepEqual(await pricing.json(), { ok: true, proxied: true });
    assert.deepEqual(forwarded, ['https://canonical.example/api/plan-catalog']);

    const pricingBook = await onRequest({
      request: new Request('https://dynamax.example/api/pricing-book-pdf?edition=faith'),
      env,
      next: async () => Response.json({ ok: false })
    });
    assert.equal(pricingBook.status, 200);
    assert.deepEqual(forwarded, [
      'https://canonical.example/api/plan-catalog',
      'https://canonical.example/api/pricing-book-pdf?edition=faith'
    ]);

    const staff = await onRequest({
      request: new Request('https://dynamax.example/api/staff-session', { method: 'POST' }),
      env,
      next: async () => Response.json({ ok: false })
    });
    assert.equal(staff.status, 503);
    assert.match((await staff.json()).message, /not available on the public Dynamax deployment/i);
    assert.equal(forwarded.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an organisation backend proxies platform subscription routes instead of using its tenant database', async () => {
  let identityCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => Response.json({ ok: true, target: request.url });
  try {
    const response = await onRequestWithIdentityLoader({
      request: new Request('https://church.example/api/register-organization', { method: 'POST', body: '{}' }),
      env: {
        FIREBASE_PROJECT_ID: 'subscriber-church',
        ALLOW_CANONICAL_API_PROXY: 'true',
        CANONICAL_PORTAL_URL: 'https://dynamax.example',
        CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions'
      },
      next: async () => Response.json({ ok: false })
    }, async () => {
      identityCalled = true;
      return {};
    });
    assert.equal(response.status, 200);
    assert.equal(identityCalled, false);
    assert.deepEqual(await response.json(), {
      ok: true,
      target: 'https://dynamax.example/api/register-organization'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
