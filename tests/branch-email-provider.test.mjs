import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { branchEmailSecretName, branchEmailSecretValues, resolveBranchEmailEnvironment } from '../functions/lib/branch-email-provider.js';
import { stageBrevoEmailProviderTransition, stageGoogleEmailProviderTransition } from '../functions/lib/tenant-email-provider.js';
import { signTenantControlRequest, verifyTenantControlRequest } from '../functions/lib/tenant-control-plane.js';
import { emailProviderReadiness } from '../functions/api/email-provider-readiness.js';
import { emailProviderProfile } from '../functions/api/settings.js';
import { resolveSetupSettingsAccess } from '../functions/lib/setup-auth.js';

const requestedAt = '2026-11-10T18:00:00.000Z';
const base = { DYNAMAX_WORKSPACE_ID: 'school', EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'organization-key' };
const google = { clientId: 'branch-client', clientSecret: 'branch-secret', refreshToken: 'branch-refresh', connectedEmail: 'branch@example.test' };

test('all editions inherit existing delivery until an explicit branch override is configured', async () => {
  for (const edition of ['school', 'faith', 'organization', 'hospital']) {
    const env = { ...base, ORGANISATION_EDITION: edition };
    assert.equal((await resolveBranchEmailEnvironment(env, 'area-1')).env, env);
    assert.equal((await resolveBranchEmailEnvironment(env, '')).env, env);
  }
});

test('branch credentials are isolated by stable hash and workspace identity', async () => {
  const secrets = await branchEmailSecretValues('school', 'area-1', 'gmail', requestedAt, google);
  const key = await branchEmailSecretName('area-1');
  assert.match(key, /^BRANCH_EMAIL_[A-F0-9]{64}$/);
  assert.notEqual(key, await branchEmailSecretName('main'));
  assert.equal(Object.keys(secrets).length, 1);
  const env = { ...base, ...secrets };
  const scoped = await resolveBranchEmailEnvironment(env, 'area-1');
  assert.equal(scoped.env.EMAIL_PROVIDER, 'gmail');
  assert.equal(scoped.env.GMAIL_REFRESH_TOKEN, 'branch-refresh');
  assert.equal(scoped.env.BREVO_API_KEY, '');
  assert.equal(env.EMAIL_PROVIDER, 'brevo');
  assert.equal((await resolveBranchEmailEnvironment(env, 'main')).env.BREVO_API_KEY, 'organization-key');
  await assert.rejects(resolveBranchEmailEnvironment({ ...env, DYNAMAX_WORKSPACE_ID: 'another' }, 'area-1'), /workspace/);
  await assert.rejects(resolveBranchEmailEnvironment({ ...base, [key]: '{broken' }, 'area-1'), /invalid/);
  await assert.rejects(branchEmailSecretName('../main'), /valid configured branch/);
});

test('returning a branch to inherit retains deployment proof without altering organization credentials', async () => {
  const env = { ...base, ...await branchEmailSecretValues('school', 'area-1', 'inherit', requestedAt) };
  const scoped = await resolveBranchEmailEnvironment(env, 'area-1');
  assert.equal(scoped.mode, 'inherit');
  assert.equal(scoped.env, env);
  assert.deepEqual(await emailProviderReadiness(env, 'area-1'), { provider: 'inherit', ready: true, requestedAt, branchId: 'area-1' });
  assert.equal(JSON.stringify(await emailProviderReadiness(env, 'area-1')).includes('organization-key'), false);
});

test('branch public provider status contains no OAuth or Brevo secrets', async () => {
  const env = { ...base, ...await branchEmailSecretValues('school', 'area-1', 'gmail', requestedAt, google) };
  const scoped = await resolveBranchEmailEnvironment(env, 'area-1');
  const status = emailProviderProfile(scoped.env);
  assert.equal(status.EmailProvider, 'gmail');
  assert.equal(status.GmailConnectedEmail, 'branch@example.test');
  assert.doesNotMatch(JSON.stringify(status), /branch-secret|branch-refresh|organization-key/);
  assert.deepEqual(await emailProviderReadiness(env, 'area-1'), { provider: 'gmail', ready: true, requestedAt, branchId: 'area-1' });
});

test('branch email control signature prevents branch, scope and credential replacement', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const details = { action: 'use-brevo', workspaceId: 'school', portalHost: 'school.pages.dev', requestId: 'test-request-1234567890', issuedAt: requestedAt, settingsScope: 'branch', branchId: 'area-1', brevoApiKey: 'branch-brevo' };
  const signature = await signTenantControlRequest(keys.privateKey, details);
  assert.equal(await verifyTenantControlRequest(keys.publicKey, details, signature), true);
  for (const changed of [{ branchId: 'main' }, { settingsScope: 'organisation' }, { brevoApiKey: 'replacement' }, { branchId: '', settingsScope: '' }]) {
    assert.equal(await verifyTenantControlRequest(keys.publicKey, { ...details, ...changed }, signature), false);
  }
});

test('branch administrators cannot change another branch or organization delivery', () => {
  const actor = { source: 'staff-session', assignedBranchId: 'area-1', role: 'Super Admin' };
  assert.equal(resolveSetupSettingsAccess(actor, 'organisation', '').scope, 'branch');
  assert.throws(() => resolveSetupSettingsAccess(actor, 'branch', 'main'), /cannot change another branch/);
});

test('branch transitions patch only that branch secret and bind queued metadata to the same branch', async () => {
  for (const provider of ['brevo', 'inherit', 'gmail']) {
    const patches = [], metadata = [], queues = [];
    const registration = { __id: 'R1', WorkspaceId: 'school', CloudflareProject: 'school-web', __emailBranchId: 'area-1' };
    const options = { requestedAt, connectedAt: requestedAt,
      assertAssignment: async () => true, assertTransition: async (_e, row) => assert.equal(row.__emailBranchId, 'area-1'),
      queueDeployment: async (_e, row, at, value) => queues.push({ row, at, value }),
      updateMetadata: async (_e, _row, data) => metadata.push(data),
      patchSecrets: async (_e, _project, data) => patches.push(data) };
    if (provider === 'gmail') await stageGoogleEmailProviderTransition({}, {}, registration, google, options);
    else await stageBrevoEmailProviderTransition({}, {}, { action: provider === 'inherit' ? 'inherit-email' : 'use-brevo', brevoApiKey: 'area-key' }, registration, options);
    assert.equal(queues.length, 1);
    assert.equal(queues[0].value, provider);
    assert.equal(metadata[0].EmailDeploymentBranchId, 'area-1');
    assert.equal(patches.length, 1);
    assert.deepEqual(Object.keys(patches[0]), [await branchEmailSecretName('area-1')]);
    assert.equal(JSON.parse(Object.values(patches[0])[0]).Provider, provider);
  }
});

test('OAuth state and redirect preserve the signed branch without exposing credentials', async () => {
  const central = await readFile(new URL('../functions/api/tenant-email-provider.js', import.meta.url), 'utf8');
  const callback = await readFile(new URL('../functions/api/google-email-callback.js', import.meta.url), 'utf8');
  assert.match(central, /BranchId: registration\.__emailBranchId/);
  assert.match(callback, /registration\.__emailBranchId = emailProviderBranchId\(record\.BranchId\)/);
  assert.match(callback, /target\.searchParams\.set\('branch', emailProviderBranchId\(record\.BranchId\)\)/);
  assert.doesNotMatch(callback, /searchParams\.set\([^\n]*(refreshToken|clientSecret)/);
});

test('delivery uses the branch credential without changing another branch and does not send on corrupt configuration', async () => {
  const location = new URL('../functions/lib/email-service.js', import.meta.url);
  const source = (await readFile(location, 'utf8'))
    .replace("import { getDocument } from './firestore.js';", 'const getDocument = async () => ({});')
    .replace("import { effectiveBranchProfile } from './branch-profile-settings.js';", 'const effectiveBranchProfile = async (_env, profile) => profile;')
    .replace(/from '(\.\/[^']+)'/g, (_match, relative) => `from '${new URL(relative, location).href}'`);
  const { sendConfiguredEmail } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const env = { ...base, ORGANISATION_EDITION: 'school', BREVO_SENDER_EMAIL: 'office@example.test',
    ...await branchEmailSecretValues('school', 'area-1', 'brevo', requestedAt, { brevoApiKey: 'area-key' }) };
  const previous = globalThis.fetch, keys = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    keys.push(init.headers['api-key']);
    return Response.json({ messageId: 'synthetic-only' });
  };
  try {
    const message = { toEmail: 'synthetic@example.invalid', subject: 'Test', textContent: 'Test' };
    await sendConfiguredEmail(env, { ...message, branchId: 'area-1' });
    await sendConfiguredEmail(env, { ...message, branchId: 'main' });
    assert.deepEqual(keys, ['area-key', 'organization-key']);
    await assert.rejects(sendConfiguredEmail({ ...env, [await branchEmailSecretName('area-1')]: 'corrupt' }, { ...message, branchId: 'area-1' }), /invalid/);
    assert.equal(keys.length, 2);
  } finally { globalThis.fetch = previous; }
});

test('connection endpoint signs the authorized branch and refuses cross-branch or unconfigured scope before staging', async () => {
  const location = new URL('../functions/api/email-provider-connection.js', import.meta.url);
  const source = (await readFile(location, 'utf8'))
    .replace("import { requireSetupAdministrator, resolveSetupSettingsAccess } from '../lib/setup-auth.js';", "import { resolveSetupSettingsAccess } from '../lib/setup-auth.js'; const requireSetupAdministrator = async () => globalThis.__emailTestActor;")
    .replace("import { assertConfiguredProfileBranch } from '../lib/branch-profile-settings.js';", "const assertConfiguredProfileBranch = async (_env, branch) => { if (!['area-1', 'main'].includes(branch)) throw Object.assign(new Error('Branch not configured'), {status:404}); };")
    .replace(/from '(\.\.?\/[^']+)'/g, (_match, relative) => `from '${new URL(relative, location).href}'`);
  const { onRequestPost } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const env = { ...base, ORGANISATION_EDITION: 'school', TENANT_CONTROL_PLANE_PRIVATE_KEY: keys.privateKey, CANONICAL_PORTAL_URL: 'https://control.example.test' };
  const previous = globalThis.fetch, calls = [];
  globalThis.__emailTestActor = { source: 'staff-session', assignedBranchId: 'area-1', role: 'Super Admin' };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://control.example.test/api/tenant-email-provider');
    const details = JSON.parse(init.body);
    assert.equal(await verifyTenantControlRequest(keys.publicKey, details, init.headers['X-Dynamax-Tenant-Signature']), true);
    calls.push(details);
    return Response.json({ ok: true, deploymentQueued: true });
  };
  const invoke = (body, targetEnv = env) => onRequestPost({ env: targetEnv, request: new Request('https://school.pages.dev/api/email-provider-connection', { method: 'POST', headers: { Origin: 'https://school.pages.dev', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  try {
    assert.equal((await invoke({ action: 'use-brevo', SettingsScope: 'branch', BranchId: 'main', brevoApiKey: 'x' })).status, 403);
    assert.equal(calls.length, 0);
    const accepted = await invoke({ action: 'use-brevo', SettingsScope: 'organisation', brevoApiKey: 'branch-key' });
    assert.equal(accepted.status, 200);
    assert.equal(calls[0].branchId, 'area-1');
    assert.equal(calls[0].settingsScope, 'branch');
    assert.equal(JSON.stringify(await accepted.json()).includes('branch-key'), false);
    globalThis.__emailTestActor = { source: 'staff-session', role: 'Super Admin' };
    assert.equal((await invoke({ action: 'use-brevo', SettingsScope: 'branch', BranchId: 'unknown', brevoApiKey: 'x' })).status, 404);
    assert.equal((await invoke({ action: 'inherit-email', SettingsScope: 'branch', BranchId: 'area-1' }, { ...env, EMAIL_PROVIDER: 'unsupported' })).status, 409);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previous; delete globalThis.__emailTestActor; }
});
