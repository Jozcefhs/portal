import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createGoogleOAuthStart,
  exchangeGoogleAuthorizationCode,
  fetchVerifiedGoogleEmail,
  revokeGoogleRefreshToken,
  unprotectPkceVerifier
} from '../functions/lib/google-email-oauth.js';
import { patchPagesProductionSecrets } from '../functions/lib/cloudflare-pages-secrets.js';
import {
  signTenantControlRequest,
  verifyTenantControlRequest
} from '../functions/lib/tenant-control-plane.js';
import {
  activeTenantControlRecord,
  stageBrevoEmailProviderTransition,
  stageGoogleEmailProviderTransition
} from '../functions/lib/tenant-email-provider.js';
import { tenantProjectAssignmentMatches } from '../functions/lib/tenant-project-pool.js';
import { emailProviderReadiness } from '../functions/api/email-provider-readiness.js';
import { shouldRevokeIssuedGoogleToken } from '../functions/api/google-email-callback.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const localApi = await readFile(new URL('../functions/api/email-provider-connection.js', import.meta.url), 'utf8');
const centralApi = await readFile(new URL('../functions/api/tenant-email-provider.js', import.meta.url), 'utf8');
const callbackApi = await readFile(new URL('../functions/api/google-email-callback.js', import.meta.url), 'utf8');
const middleware = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const pool = await readFile(new URL('../functions/lib/tenant-project-pool.js', import.meta.url), 'utf8');
const managed = await readFile(new URL('../functions/lib/managed-organisations.js', import.meta.url), 'utf8');
const tenantProvider = await readFile(new URL('../functions/lib/tenant-email-provider.js', import.meta.url), 'utf8');
const tenantWorkflow = await readFile(new URL('../.github/workflows/deploy-tenant-pool.yml', import.meta.url), 'utf8');
const managedWorkflow = await readFile(new URL('../.github/workflows/deploy-organisation.yml', import.meta.url), 'utf8');

const oauthEnv = {
  CANONICAL_PORTAL_URL: 'https://dynamaxms.pages.dev',
  GOOGLE_OAUTH_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'central-google-client-secret'
};

function controlKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

test('Google email authorization uses PKCE, send-only scope, offline consent and a short one-use state', async () => {
  const start = await createGoogleOAuthStart(oauthEnv, 'https://dynamaxms.pages.dev/api/tenant-email-provider', 2_000_000);
  const url = new URL(start.authorizationUrl);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://dynamaxms.pages.dev/api/google-email-callback');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.has('include_granted_scopes'), false);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /openid/);
  assert.match(url.searchParams.get('scope'), /email/);
  assert.match(url.searchParams.get('scope'), /https:\/\/www\.googleapis\.com\/auth\/gmail\.send/);
  assert.ok(Date.parse(start.expiresAt) - Date.parse(start.createdAt) <= 10 * 60 * 1000);
  assert.notEqual(start.codeVerifierCiphertext, url.searchParams.get('code_challenge'));
  const verifier = await unprotectPkceVerifier(
    oauthEnv.GOOGLE_OAUTH_CLIENT_SECRET,
    start.stateHash,
    start.codeVerifierCiphertext,
    start.codeVerifierIv
  );
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(start.authorizationUrl.includes(verifier), false);
});

test('Google token exchange requires a refresh token and userinfo requires a verified email', async () => {
  let tokenBody = '';
  const tokens = await exchangeGoogleAuthorizationCode(oauthEnv, {
    code: 'one-use-code',
    codeVerifier: 'a'.repeat(64),
    redirectUri: 'https://dynamaxms.pages.dev/api/google-email-callback'
  }, async (_url, options) => {
    tokenBody = String(options.body);
    return Response.json({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      scope: 'openid email https://www.googleapis.com/auth/gmail.send',
      token_type: 'Bearer',
      expires_in: 3600
    });
  });
  assert.equal(tokens.refreshToken, 'refresh-token');
  assert.match(tokenBody, /code_verifier=/);
  assert.match(tokenBody, /grant_type=authorization_code/);
  const email = await fetchVerifiedGoogleEmail(tokens.accessToken, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer access-token');
    return Response.json({ email: 'ADMIN@EXAMPLE.COM', email_verified: true });
  });
  assert.equal(email, 'admin@example.com');
  await assert.rejects(
    exchangeGoogleAuthorizationCode(oauthEnv, {
      code: 'one-use-code',
      codeVerifier: 'a'.repeat(64),
      redirectUri: 'https://dynamaxms.pages.dev/api/google-email-callback'
    }, async () => Response.json({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      scope: 'openid email'
    })),
    /offline email permission/i
  );
  await assert.rejects(
    fetchVerifiedGoogleEmail('access-token', async () => Response.json({ email: 'admin@example.com', email_verified: false })),
    /verified email/i
  );
});

test('callback cleanup revokes only an issued token that was not staged or already handled', () => {
  assert.equal(shouldRevokeIssuedGoogleToken('issued-token', false, {}), true);
  assert.equal(shouldRevokeIssuedGoogleToken('issued-token', true, {}), false);
  assert.equal(shouldRevokeIssuedGoogleToken('issued-token', false, { refreshTokenHandled: true }), false);
  assert.equal(shouldRevokeIssuedGoogleToken('', false, {}), false);
});

test('switching away from Google revokes best-effort without preventing secure cleanup', async () => {
  let sentToken = '';
  const result = await revokeGoogleRefreshToken('refresh-token', async (_url, options) => {
    sentToken = new URLSearchParams(String(options.body)).get('token');
    return new Response('', { status: 200 });
  });
  assert.equal(sentToken, 'refresh-token');
  assert.deepEqual(result, { attempted: true, revoked: true });
  assert.deepEqual(await revokeGoogleRefreshToken('', async () => { throw new Error('not called'); }), {
    attempted: false,
    revoked: false
  });
});

test('Brevo transition stages a durable outbox without revoking the live Gmail grant', async () => {
  const events = [];
  const registration = { CloudflareProject: 'tenant-school-1' };
  const result = await stageBrevoEmailProviderTransition({}, {}, { gmailRefreshToken: 'refresh-token' }, registration, {
    requestedAt: '2026-09-17T12:00:00.000Z',
    patchSecrets: async (_env, _project, values) => {
      events.push('secrets');
      assert.equal(values.EMAIL_PROVIDER, 'brevo');
      assert.equal(values.EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT, '2026-09-17T12:00:00.000Z');
      assert.equal(values.GMAIL_REFRESH_TOKEN, null);
    },
    queueDeployment: async (_platformEnv, _registration, requestedAt, provider) => {
      events.push('queue');
      assert.equal(requestedAt, '2026-09-17T12:00:00.000Z');
      assert.equal(provider, 'brevo');
    },
    updateMetadata: async (_platformEnv, _registration, values) => {
      events.push(`metadata:${values.EmailProviderTransitionStatus}`);
    },
    assertAssignment: async () => { events.push('assignment'); },
    assertTransition: async () => { events.push('transition'); },
    revokeRefreshToken: async () => { events.push('revoke'); }
  });
  assert.deepEqual(events, ['assignment', 'queue', 'metadata:Queued', 'transition', 'secrets']);
  assert.equal(result.provider, 'brevo');

  const failedEvents = [];
  await assert.rejects(stageBrevoEmailProviderTransition({}, {}, { gmailRefreshToken: 'live-token' }, registration, {
    requestedAt: '2026-09-17T12:01:00.000Z',
    patchSecrets: async () => { failedEvents.push('secrets'); },
    queueDeployment: async () => {
      failedEvents.push('queue');
      throw new Error('queue unavailable');
    },
    updateMetadata: async () => { failedEvents.push('metadata'); },
    assertAssignment: async () => { failedEvents.push('assignment'); },
    assertTransition: async () => { failedEvents.push('transition'); },
    revokeRefreshToken: async () => { failedEvents.push('revoke'); }
  }), /queue unavailable/);
  assert.deepEqual(failedEvents, ['assignment', 'queue']);
});

test('a Brevo metadata failure cancels only its queued transition so a retry can proceed', async () => {
  const registration = { CloudflareProject: 'tenant-school-1' };
  const events = [];
  let queued = '';
  const queueDeployment = async (_platformEnv, _registration, requestedAt, provider) => {
    if (queued && queued !== `${provider}:${requestedAt}`) throw new Error('transition still locked');
    queued = `${provider}:${requestedAt}`;
    events.push(`queue:${requestedAt}`);
  };
  const cancelDeployment = async (_platformEnv, _registration, requestedAt, provider) => {
    assert.equal(queued, `${provider}:${requestedAt}`);
    queued = '';
    events.push(`cancel:${requestedAt}`);
  };

  await assert.rejects(stageBrevoEmailProviderTransition({}, {}, {}, registration, {
    requestedAt: '2026-09-17T12:01:30.000Z',
    assertAssignment: async () => {},
    queueDeployment,
    updateMetadata: async () => { throw new Error('metadata unavailable'); },
    cancelDeployment,
    assertTransition: async () => {},
    patchSecrets: async () => { events.push('unexpected-secrets'); }
  }), /metadata unavailable/);
  assert.equal(queued, '');

  const retry = await stageBrevoEmailProviderTransition({}, {}, {}, registration, {
    requestedAt: '2026-09-17T12:01:31.000Z',
    assertAssignment: async () => {},
    queueDeployment,
    updateMetadata: async () => { events.push('metadata:retry'); },
    cancelDeployment,
    assertTransition: async () => {},
    patchSecrets: async () => { events.push('secrets:retry'); }
  });
  assert.equal(retry.deploymentQueued, true);
  assert.deepEqual(events, [
    'queue:2026-09-17T12:01:30.000Z',
    'cancel:2026-09-17T12:01:30.000Z',
    'queue:2026-09-17T12:01:31.000Z',
    'metadata:retry',
    'secrets:retry'
  ]);
});

test('post-stage Google state failures remain queued and never roll back a working Gmail tenant', async () => {
  const events = [];
  const secretWrites = [];
  const queueTargets = [];
  const result = await stageGoogleEmailProviderTransition({}, {}, {
    CloudflareProject: 'tenant-school-1',
    EmailProvider: 'gmail',
    GmailConnectedEmail: 'old@example.com'
  }, {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'new-refresh-token',
    connectedEmail: 'admin@example.com'
  }, {
    connectedAt: '2026-09-17T12:02:00.000Z',
    patchSecrets: async (_env, _project, values) => {
      events.push(`secrets:${values.EMAIL_PROVIDER}`);
      secretWrites.push(values);
    },
    queueDeployment: async (_platformEnv, _registration, _requestedAt, provider) => {
      events.push(`queue:${provider}`);
      queueTargets.push(provider);
    },
    updateMetadata: async (_platformEnv, _registration, values) => {
      events.push(`metadata:${values.EmailProviderTransitionStatus}`);
    },
    assertAssignment: async () => { events.push('assignment'); },
    assertTransition: async () => { events.push('transition'); },
    markConnected: async () => {
      events.push('state:connected');
      throw new Error('state write failed');
    },
    markFailed: async () => { events.push('state:failed'); },
    revokeRefreshToken: async (token) => {
      events.push('revoke');
      assert.equal(token, 'new-refresh-token');
    }
  });
  assert.deepEqual(queueTargets, ['gmail']);
  assert.equal(secretWrites[0].EMAIL_PROVIDER, 'gmail');
  assert.equal(secretWrites[0].EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT, '2026-09-17T12:02:00.000Z');
  assert.equal(secretWrites.length, 1);
  assert.equal(events.includes('secrets:brevo'), false);
  assert.equal(events.includes('revoke'), false);
  assert.equal(events.includes('state:failed'), false);
  assert.equal(result.deploymentQueued, true);
  assert.equal(result.oauthStateFinalizationPending, true);
});

test('a Google outbox failure preserves the deployed provider and revokes only the unused new grant', async () => {
  const events = [];
  let failureCode = '';
  await assert.rejects(stageGoogleEmailProviderTransition({}, {}, { CloudflareProject: 'tenant-school-1' }, {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'unused-new-refresh-token',
    connectedEmail: 'admin@example.com'
  }, {
    connectedAt: '2026-09-17T12:02:30.000Z',
    updateMetadata: async () => { events.push('metadata'); },
    queueDeployment: async () => {
      events.push('queue');
      throw new Error('queue unavailable');
    },
    assertAssignment: async () => { events.push('assignment'); },
    assertTransition: async () => { events.push('transition'); },
    patchSecrets: async () => { events.push('secrets'); },
    revokeRefreshToken: async (token) => {
      events.push('revoke');
      assert.equal(token, 'unused-new-refresh-token');
    },
    markFailed: async (code) => {
      events.push('state:failed');
      failureCode = code;
    }
  }), (error) => error.code === 'GOOGLE_EMAIL_CONNECTION_OUTBOX_FAILED'
    && error.failureStatePersisted === true);
  assert.deepEqual(events, ['assignment', 'queue', 'queue', 'queue', 'revoke', 'state:failed']);
  assert.equal(events.includes('secrets'), false);
  assert.equal(failureCode, 'GOOGLE_EMAIL_CONNECTION_OUTBOX_FAILED');
});

test('a Gmail metadata failure cancels its queue before revocation so a new OAuth attempt can proceed', async () => {
  const registration = { CloudflareProject: 'tenant-school-1' };
  const connection = {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'unused-refresh-token',
    connectedEmail: 'admin@example.com'
  };
  const events = [];
  let queued = '';
  const queueDeployment = async (_platformEnv, _registration, requestedAt, provider) => {
    if (queued && queued !== `${provider}:${requestedAt}`) throw new Error('transition still locked');
    queued = `${provider}:${requestedAt}`;
    events.push(`queue:${requestedAt}`);
  };
  const cancelDeployment = async (_platformEnv, _registration, requestedAt, provider) => {
    assert.equal(queued, `${provider}:${requestedAt}`);
    queued = '';
    events.push(`cancel:${requestedAt}`);
  };

  await assert.rejects(stageGoogleEmailProviderTransition({}, {}, registration, connection, {
    connectedAt: '2026-09-17T12:02:35.000Z',
    assertAssignment: async () => {},
    queueDeployment,
    updateMetadata: async () => { throw new Error('metadata unavailable'); },
    cancelDeployment,
    assertTransition: async () => {},
    patchSecrets: async () => { events.push('unexpected-secrets'); },
    revokeRefreshToken: async () => { events.push('revoke:first'); },
    markFailed: async () => {}
  }), (error) => error.code === 'GOOGLE_EMAIL_CONNECTION_OUTBOX_FAILED');
  assert.equal(queued, '');

  const retry = await stageGoogleEmailProviderTransition({}, {}, registration, {
    ...connection,
    refreshToken: 'retry-refresh-token'
  }, {
    connectedAt: '2026-09-17T12:02:36.000Z',
    assertAssignment: async () => {},
    queueDeployment,
    updateMetadata: async () => { events.push('metadata:retry'); },
    cancelDeployment,
    assertTransition: async () => {},
    patchSecrets: async () => { events.push('secrets:retry'); },
    revokeRefreshToken: async () => { events.push('unexpected-revoke'); },
    markConnected: async () => { events.push('state:connected'); }
  });
  assert.equal(retry.deploymentQueued, true);
  assert.deepEqual(events, [
    'queue:2026-09-17T12:02:35.000Z',
    'cancel:2026-09-17T12:02:35.000Z',
    'revoke:first',
    'queue:2026-09-17T12:02:36.000Z',
    'metadata:retry',
    'secrets:retry',
    'state:connected'
  ]);
});

test('an ambiguous Pages patch remains pending without rollback, revocation or a retry invitation', async () => {
  const events = [];
  const result = await stageGoogleEmailProviderTransition({}, {}, {
    CloudflareProject: 'tenant-school-1',
    EmailProvider: 'gmail'
  }, {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'possibly-staged-token',
    connectedEmail: 'admin@example.com'
  }, {
    connectedAt: '2026-09-17T12:02:45.000Z',
    assertAssignment: async () => { events.push('assignment'); },
    queueDeployment: async () => { events.push('queue'); },
    updateMetadata: async () => { events.push('metadata'); },
    assertTransition: async () => { events.push('transition'); },
    patchSecrets: async () => {
      events.push('secrets');
      throw new TypeError('network result unknown');
    },
    markPending: async (code) => {
      events.push(`state:${code}`);
    },
    revokeRefreshToken: async () => { events.push('revoke'); }
  });
  assert.deepEqual(events, [
    'assignment',
    'queue',
    'metadata',
    'transition',
    'secrets',
    'state:GOOGLE_EMAIL_SECRET_STAGING_UNCONFIRMED'
  ]);
  assert.equal(result.stagingUnconfirmed, true);
  assert.equal(result.deploymentQueued, true);
  assert.equal(events.includes('revoke'), false);
});

test('an authoritative Pages rejection cancels the Gmail queue and revokes the unstaged grant', async () => {
  const events = [];
  const rejection = new Error('Cloudflare rejected the update');
  rejection.patchOutcomeUncertain = false;
  await assert.rejects(stageGoogleEmailProviderTransition({}, {}, {
    CloudflareProject: 'tenant-school-1'
  }, {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'unstaged-token',
    connectedEmail: 'admin@example.com'
  }, {
    connectedAt: '2026-09-17T12:02:46.000Z',
    assertAssignment: async () => { events.push('assignment'); },
    queueDeployment: async () => { events.push('queue'); },
    updateMetadata: async () => { events.push('metadata'); },
    assertTransition: async () => { events.push('transition'); },
    patchSecrets: async () => {
      events.push('secrets:rejected');
      throw rejection;
    },
    cancelDeployment: async (_platformEnv, _registration, requestedAt, provider) => {
      events.push(`cancel:${provider}:${requestedAt}`);
    },
    revokeRefreshToken: async (token) => { events.push(`revoke:${token}`); },
    markFailed: async (code) => { events.push(`state:${code}`); }
  }), (error) => error.code === 'GOOGLE_EMAIL_SECRET_STAGING_REJECTED'
    && error.refreshTokenHandled === true);
  assert.deepEqual(events, [
    'assignment',
    'queue',
    'metadata',
    'transition',
    'secrets:rejected',
    'cancel:gmail:2026-09-17T12:02:46.000Z',
    'revoke:unstaged-token',
    'state:GOOGLE_EMAIL_SECRET_STAGING_REJECTED'
  ]);
});

test('an authoritative Pages rejection cancels the Brevo queue but an ambiguous failure keeps it', async () => {
  const registration = { CloudflareProject: 'tenant-school-1' };
  const rejectedEvents = [];
  const rejection = new Error('Cloudflare rejected the update');
  rejection.patchOutcomeUncertain = false;
  await assert.rejects(stageBrevoEmailProviderTransition({}, {}, {}, registration, {
    requestedAt: '2026-09-17T12:02:47.000Z',
    assertAssignment: async () => {},
    queueDeployment: async () => { rejectedEvents.push('queue'); },
    updateMetadata: async () => { rejectedEvents.push('metadata'); },
    assertTransition: async () => { rejectedEvents.push('transition'); },
    patchSecrets: async () => {
      rejectedEvents.push('secrets:rejected');
      throw rejection;
    },
    cancelDeployment: async () => { rejectedEvents.push('cancel'); }
  }), /Cloudflare rejected/);
  assert.deepEqual(rejectedEvents, ['queue', 'metadata', 'transition', 'secrets:rejected', 'cancel']);

  const ambiguousEvents = [];
  const ambiguous = await stageBrevoEmailProviderTransition({}, {}, {}, registration, {
    requestedAt: '2026-09-17T12:02:48.000Z',
    assertAssignment: async () => {},
    queueDeployment: async () => { ambiguousEvents.push('queue'); },
    updateMetadata: async () => { ambiguousEvents.push('metadata'); },
    assertTransition: async () => { ambiguousEvents.push('transition'); },
    patchSecrets: async () => {
      ambiguousEvents.push('secrets:ambiguous');
      throw new TypeError('network result unknown');
    },
    cancelDeployment: async () => { ambiguousEvents.push('cancel'); }
  });
  assert.equal(ambiguous.stagingUnconfirmed, true);
  assert.equal(ambiguous.deploymentQueued, true);
  assert.deepEqual(ambiguousEvents, ['queue', 'metadata', 'transition', 'secrets:ambiguous']);
});

test('central email control fails closed for subscription access and exact pool assignment', () => {
  const trial = {
    Plan: 'Free',
    Status: 'Trialing',
    SubscriptionStatus: 'Trialing',
    TrialEndsAt: '2026-09-18T00:00:00.000Z'
  };
  assert.equal(activeTenantControlRecord(trial, Date.parse('2026-09-17T00:00:00.000Z')), true);
  assert.equal(activeTenantControlRecord(trial, Date.parse('2026-09-19T00:00:00.000Z')), false);
  assert.equal(activeTenantControlRecord({ Status: 'Payment Grace', SubscriptionStatus: 'Payment Grace' }), false);
  assert.equal(activeTenantControlRecord({ Status: 'Suspended', SubscriptionStatus: 'Suspended' }), false);
  assert.equal(activeTenantControlRecord({ Status: 'Active', LifecycleStage: 'Suspended' }), false);
  assert.equal(activeTenantControlRecord({ Status: 'Active', SubscriptionStatus: 'Pending Trial Activation' }), false);
  assert.equal(activeTenantControlRecord({}), false);

  const assigned = {
    Status: 'Assigned',
    AssignedRegistrationReference: 'REG-ONE',
    WorkspaceId: 'tenant-one'
  };
  assert.equal(tenantProjectAssignmentMatches(assigned, {
    registrationReference: 'REG-ONE',
    workspaceId: 'tenant-one'
  }), true);
  assert.equal(tenantProjectAssignmentMatches(assigned, {
    registrationReference: 'REG-TWO',
    workspaceId: 'tenant-one'
  }), false);
  assert.equal(tenantProjectAssignmentMatches({ ...assigned, Status: 'Ready' }, {
    registrationReference: 'REG-ONE',
    workspaceId: 'tenant-one'
  }), false);
});

test('readiness returns only provider, boolean readiness and deployment timestamp', async () => {
  const gmail = await emailProviderReadiness({
    EMAIL_PROVIDER: 'gmail',
    EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT: '2026-09-17T12:03:00.000Z',
    GMAIL_OAUTH_CLIENT_ID: 'client-id',
    GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
    GMAIL_REFRESH_TOKEN: 'refresh-token',
    GMAIL_CONNECTED_EMAIL: 'admin@example.com'
  });
  assert.deepEqual(gmail, {
    provider: 'gmail',
    ready: true,
    requestedAt: '2026-09-17T12:03:00.000Z'
  });
  assert.equal(JSON.stringify(gmail).includes('admin@example.com'), false);
  assert.equal(JSON.stringify(gmail).includes('refresh-token'), false);
  assert.deepEqual(await emailProviderReadiness({
    EMAIL_PROVIDER: 'brevo',
    EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT: '2026-09-17T12:04:00.000Z',
    BREVO_API_KEY: 'legacy-or-secret-key'
  }), {
    provider: 'brevo',
    ready: true,
    requestedAt: '2026-09-17T12:04:00.000Z'
  });
  assert.deepEqual(await emailProviderReadiness({
    EMAIL_PROVIDER: 'smtp-typo',
    EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT: '2026-09-17T12:05:00.000Z',
    BREVO_API_KEY: 'must-not-mask-invalid-provider'
  }), {
    provider: 'unsupported',
    ready: false,
    requestedAt: '2026-09-17T12:05:00.000Z'
  });
});

test('Cloudflare email credentials are patched together and Gmail credentials can be deleted', async () => {
  const calls = [];
  const saved = await patchPagesProductionSecrets({
    CLOUDFLARE_ACCOUNT_ID: 'account-1',
    CLOUDFLARE_PAGES_API_TOKEN: 'control-token'
  }, 'tenant-school-1', {
    EMAIL_PROVIDER: 'brevo',
    GMAIL_OAUTH_CLIENT_ID: null,
    GMAIL_OAUTH_CLIENT_SECRET: null,
    GMAIL_REFRESH_TOKEN: null,
    GMAIL_CONNECTED_EMAIL: null
  }, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true });
  });
  const envVars = JSON.parse(calls[0].options.body).deployment_configs.production.env_vars;
  assert.deepEqual(envVars.EMAIL_PROVIDER, { type: 'secret_text', value: 'brevo' });
  assert.equal(envVars.GMAIL_REFRESH_TOKEN, null);
  assert.equal(envVars.GMAIL_OAUTH_CLIENT_SECRET, null);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(saved).includes('control-token'), false);

  await assert.rejects(patchPagesProductionSecrets({
    CLOUDFLARE_ACCOUNT_ID: 'account-1',
    CLOUDFLARE_PAGES_API_TOKEN: 'control-token'
  }, 'tenant-school-1', { EMAIL_PROVIDER: 'gmail' }, async () => (
    Response.json({ success: false }, { status: 403 })
  )), (error) => error.code === 'CLOUDFLARE_SECRET_UPDATE_FAILED'
    && error.patchOutcomeUncertain === false);
});

test('the signed switch-to-Brevo request binds the refresh token without exposing it in canonical metadata', async () => {
  const pair = controlKeyPair();
  const details = {
    action: 'use-brevo',
    workspaceId: 'tenant-school-1',
    portalHost: 'tenant-school-1.pages.dev',
    requestId: '91a158ab-0ef4-4270-9151-3e49529a6614',
    issuedAt: new Date().toISOString(),
    gmailRefreshToken: 'google-refresh-token'
  };
  const signature = await signTenantControlRequest(pair.privateKey, details);
  assert.equal(await verifyTenantControlRequest(pair.publicKey, details, signature), true);
  assert.equal(await verifyTenantControlRequest(pair.publicKey, { ...details, gmailRefreshToken: 'substituted' }, signature), false);
});

test('email-provider endpoints preserve tenant authority, replay protection and secret boundaries', () => {
  assert.match(localApi, /requireSetupAdministrator/);
  assert.match(localApi, /access\.scope !== 'organisation'/);
  assert.match(localApi, /assertSameOrigin/);
  assert.match(localApi, /TENANT_CONTROL_PLANE_PRIVATE_KEY/);
  assert.match(localApi, /sendConfiguredEmail/);
  assert.match(localApi, /BREVO_EMAIL_NOT_CONFIGURED/);
  assert.match(localApi, /stagingUnconfirmed/);
  assert.match(localApi, /getDocument\(env, 'settings', 'brevo'\)/);
  assert.doesNotMatch(localApi, /gmailRefreshToken|GMAIL_REFRESH_TOKEN/);
  assert.equal((localApi.match(/await sendConfiguredEmail\(/g) || []).length, 1);
  assert.match(centralApi, /verifyTenantControlRequest/);
  assert.match(centralApi, /tenantControlRequests/);
  assert.match(centralApi, /tenantEmailOAuthStates/);
  assert.match(centralApi, /stagingUnconfirmed/);
  assert.match(centralApi, /CodeVerifierCiphertext/);
  assert.doesNotMatch(centralApi, /RefreshToken:\s*details\.gmailRefreshToken/);
  assert.match(tenantProvider, /GMAIL_OAUTH_CLIENT_ID/);
  assert.match(tenantProvider, /GMAIL_OAUTH_CLIENT_SECRET/);
  assert.match(tenantProvider, /GMAIL_REFRESH_TOKEN/);
  assert.match(tenantProvider, /GMAIL_CONNECTED_EMAIL/);
  assert.match(callbackApi, /emailConnection/);
  assert.match(callbackApi, /emailMessage/);
  assert.doesNotMatch(callbackApi, /searchParams\.set\(['"](?:token|code|connectedEmail|gmailConnectedEmail)['"]/i);
  assert.match(middleware, /PLATFORM_SUBSCRIPTION_PROXY_PATHS[\s\S]*?'\/api\/tenant-email-provider'/);
  assert.match(middleware, /PLATFORM_SUBSCRIPTION_PROXY_PATHS[\s\S]*?'\/api\/google-email-callback'/);
});

test('pooled and managed tenants expose independent email deployment queue metadata', () => {
  assert.match(pool, /EmailDeploymentPending/);
  assert.match(pool, /EmailDeploymentRequestedAt/);
  assert.match(pool, /EmailDeploymentProvider/);
  assert.match(pool, /queueTenantEmailDeployment/);
  assert.match(pool, /completeTenantEmailDeployment/);
  assert.match(pool, /queueTenantEmailDeployment[\s\S]*?expectedAssignment/);
  assert.match(pool, /EMAIL_PROVIDER_TRANSITION_IN_PROGRESS/);
  assert.match(managed, /EmailDeploymentPending/);
  assert.match(managed, /EmailDeploymentRequestedAt/);
  assert.match(managed, /EmailDeploymentProvider/);
  assert.match(managed, /EmailDeploymentQueued:\s*false/);
  assert.match(managed, /queueManagedOrganisationEmailDeployment/);
  assert.match(managed, /completeManagedOrganisationEmailDeployment/);
  for (const workflow of [tenantWorkflow, managedWorkflow]) {
    assert.match(workflow, /api\/email-provider-readiness/);
    assert.match(workflow, /\.ready == true/);
    assert.match(workflow, /\.provider == \$provider/);
    assert.match(workflow, /\.requestedAt == \$requestedAt/);
  }
  const completion = pool.slice(
    pool.indexOf('export async function completeTenantEmailDeployment'),
    pool.indexOf('export async function resetTenantPaystackConnection')
  );
  assert.ok(
    completion.indexOf("patchDocumentFieldsIfCurrent(\n        platformEnv,\n        'tenantRegistrations'")
      < completion.indexOf('TENANT_PROJECT_POOL_COLLECTION, slotDocumentId'),
    'registration metadata must finalize before the pool pending flag is cleared'
  );
});
