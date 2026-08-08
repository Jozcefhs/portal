import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const applyChanges = lower(process.env.TENANT_PROVISION_APPLY) === 'true';
const platformUrl = clean(process.env.DYNAMAX_PLATFORM_URL || 'https://dynamaxms.pages.dev').replace(/\/$/, '');
const platformPassword = clean(process.env.DYNAMAX_ADMIN_WEB_PASSWORD);
const cloudflareAccountId = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
const cloudflareToken = clean(process.env.CLOUDFLARE_API_TOKEN);
const billingAccount = clean(process.env.DYNAMAX_GCP_BILLING_ACCOUNT);
const projectParent = clean(process.env.DYNAMAX_GCP_PARENT);
const region = clean(process.env.DYNAMAX_TENANT_REGION || 'eur3');
const projectPrefix = (slug(process.env.DYNAMAX_TENANT_PROJECT_PREFIX || 'dynamax-tenant') || 'dynamax-tenant').slice(0, 17);
const encodedRequest = clean(process.env.TENANT_PROVISIONING_REQUEST_BASE64);
const request = JSON.parse(encodedRequest
  ? Buffer.from(encodedRequest, 'base64').toString('utf8')
  : clean(process.env.TENANT_PROVISIONING_REQUEST_JSON) || '{}');
const requestReference = clean(request.Reference);
const edition = normalizeEdition(request.Edition);
const mode = lower(request.Mode) === 'branded' ? 'branded' : 'pool';
const count = mode === 'branded' ? 1 : boundedInteger(request.Count, 1, 20);
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const deployDirectory = resolve('.tenant-pages-deploy');
const createdProjects = [];

function boundedInteger(value, fallback, maximum) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(maximum, number) : fallback;
}

function slug(value) {
  return lower(value)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeEdition(value) {
  const normalized = lower(value);
  if (normalized === 'church') return 'faith';
  if (['school', 'faith', 'organization'].includes(normalized)) return normalized;
  throw new Error('Provisioning edition must be school, faith or organization.');
}

function editionCode(value) {
  return value === 'school' ? 'sch' : value === 'faith' ? 'chr' : 'org';
}

function editionLabel(value) {
  return value === 'school' ? 'School' : value === 'faith' ? 'Church' : 'Other Organisation';
}

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function generatedProjectId(sequence) {
  if (mode === 'branded') {
    const requested = slug(request.RequestedProjectId);
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(requested)) {
      throw new Error('The branded project ID must be 6-30 lowercase letters, numbers or internal hyphens, and start with a letter.');
    }
    return requested;
  }
  const unique = `${Date.now().toString(36)}${sequence.toString(36)}${randomBytes(2).toString('hex')}`;
  return `${projectPrefix}-${editionCode(edition)}-${unique}`.slice(0, 30).replace(/-$/, '0');
}

function requireConfiguration() {
  const missing = [];
  if (!requestReference) missing.push('TENANT_PROVISIONING_REQUEST_JSON.Reference');
  if (!platformPassword) missing.push('DYNAMAX_ADMIN_WEB_PASSWORD');
  if (!cloudflareAccountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!cloudflareToken) missing.push('CLOUDFLARE_API_TOKEN');
  if (applyChanges && !billingAccount) missing.push('DYNAMAX_GCP_BILLING_ACCOUNT');
  if (missing.length) throw new Error(`Missing provisioning configuration: ${missing.join(', ')}.`);
}

function command(program, args, options = {}) {
  const printable = `${program} ${args.map((item) => JSON.stringify(String(item))).join(' ')}`;
  if (!options.quiet) process.stdout.write(`$ ${printable}\n`);
  if (!applyChanges && options.allowDuringDryRun !== true) return '';
  return execFileSync(program, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
  }) || '';
}

function accessToken() {
  return clean(command('gcloud', ['auth', 'print-access-token'], { capture: true, quiet: true }));
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.errors?.[0]?.message || `${options.method || 'GET'} ${url} failed (${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function googleRequest(url, options = {}) {
  return jsonRequest(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

async function waitForGoogleOperation(operation, serviceBase, timeoutMs = 240000) {
  if (!operation?.name || operation.done) {
    if (operation?.error) throw new Error(operation.error.message || 'Google Cloud operation failed.');
    return operation;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 4000));
    const current = await googleRequest(`${serviceBase}/${operation.name}`);
    if (!current.done) continue;
    if (current.error) throw new Error(current.error.message || 'Google Cloud operation failed.');
    return current;
  }
  throw new Error(`Google Cloud operation ${operation.name} did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
}

async function addFirebase(projectId) {
  const operation = await googleRequest(`https://firebase.googleapis.com/v1beta1/projects/${projectId}:addFirebase`, {
    method: 'POST',
    body: '{}'
  });
  await waitForGoogleOperation(operation, 'https://firebase.googleapis.com/v1beta1');
}

async function createFirestoreDatabase(projectId) {
  try {
    const operation = await googleRequest(`https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=${encodeURIComponent('(default)')}`, {
      method: 'POST',
      body: JSON.stringify({ type: 'FIRESTORE_NATIVE', locationId: region })
    });
    await waitForGoogleOperation(operation, 'https://firestore.googleapis.com/v1');
  } catch (error) {
    if (Number(error.status) !== 409) throw error;
  }
}

async function createFirebaseWebApp(projectId) {
  const displayName = 'Dynamax tenant web app';
  const operation = await googleRequest(`https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`, {
    method: 'POST',
    body: JSON.stringify({ displayName })
  });
  await waitForGoogleOperation(operation, 'https://firebase.googleapis.com/v1beta1');
  const applications = await googleRequest(`https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps?pageSize=100`);
  const application = (applications.apps || []).find((item) => clean(item.displayName) === displayName) || applications.apps?.[0];
  const appId = clean(application?.appId);
  if (!appId) throw new Error(`Firebase did not return a web application for ${projectId}.`);
  return googleRequest(`https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps/${encodeURIComponent(appId)}/config`);
}

function deploymentVariables(projectId, serviceAccount, webConfig, privateKey) {
  const portalUrl = `https://${projectId}.pages.dev`;
  const plain = (value) => ({ type: 'plain_text', value: clean(value) });
  const secret = (value) => ({ type: 'secret_text', value: clean(value) });
  return {
    FIREBASE_PROJECT_ID: plain(projectId),
    FIREBASE_CLIENT_EMAIL: plain(serviceAccount),
    FIREBASE_PRIVATE_KEY: secret(privateKey),
    FIREBASE_WEB_API_KEY: plain(webConfig.apiKey),
    FIREBASE_APP_ID: plain(webConfig.appId),
    FIREBASE_MESSAGING_SENDER_ID: plain(webConfig.messagingSenderId),
    DYNAMAX_WORKSPACE_ID: plain(projectId),
    ORGANISATION_EDITION: plain(edition),
    ORGANISATION_NAME: plain(`Dynamax ${editionLabel(edition)} Workspace`),
    ORGANISATION_CODE: plain(projectId),
    ALLOW_CANONICAL_API_PROXY: plain('true'),
    CANONICAL_API_PROXY_SCOPE: plain('platform-subscriptions'),
    CANONICAL_PORTAL_URL: plain(platformUrl),
    PUBLIC_PORTAL_URL: plain(portalUrl),
    PORTAL_BASE_URL: plain(portalUrl),
    WEBAUTHN_ORIGIN: plain(portalUrl),
    WEBAUTHN_RP_ID: plain(`${projectId}.pages.dev`),
    BACKEND_SHARED_SECRET: secret(randomSecret()),
    STAFF_SESSION_SECRET: secret(randomSecret()),
    PARENT_SESSION_SECRET: secret(randomSecret()),
    NOTIFICATION_SCHEDULER_SECRET: secret(randomSecret()),
    FACE_TEMPLATE_ENCRYPTION_KEY: secret(randomSecret())
  };
}

async function configureCloudflareProject(projectId, variables) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/pages/projects`;
  const headers = { Authorization: `Bearer ${cloudflareToken}`, 'Content-Type': 'application/json' };
  const deploymentConfig = {
    compatibility_date: new Date().toISOString().slice(0, 10),
    env_vars: variables
  };
  const existingResponse = await fetch(`${endpoint}/${encodeURIComponent(projectId)}`, { headers });
  if (existingResponse.ok) {
    await jsonRequest(`${endpoint}/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ deployment_configs: { preview: deploymentConfig, production: deploymentConfig } })
    });
    return;
  }
  if (existingResponse.status !== 404) {
    const data = await existingResponse.json().catch(() => ({}));
    throw new Error(data?.errors?.[0]?.message || `Cloudflare could not inspect ${projectId} (${existingResponse.status}).`);
  }
  await jsonRequest(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: projectId,
      production_branch: 'main',
      deployment_configs: { preview: deploymentConfig, production: deploymentConfig }
    })
  });
}

function preparePagesDeployment() {
  const resolvedRoot = resolve(process.cwd());
  if (!deployDirectory.startsWith(`${resolvedRoot}\\`) && !deployDirectory.startsWith(`${resolvedRoot}/`)) {
    throw new Error('Refusing to prepare a deployment directory outside the repository.');
  }
  rmSync(deployDirectory, { recursive: true, force: true });
  mkdirSync(deployDirectory, { recursive: true });
  for (const directory of ['css', 'functions', 'images', 'js', 'vendor']) {
    if (existsSync(directory)) cpSync(directory, resolve(deployDirectory, directory), { recursive: true });
  }
  for (const file of ['_headers', '_routes.json', 'app-icon.svg', 'manifest.webmanifest', 'sw.js', 'version.json']) {
    if (existsSync(file)) cpSync(file, resolve(deployDirectory, file));
  }
  for (const file of command(process.execPath, ['-e', "const fs=require('node:fs');process.stdout.write(fs.readdirSync('.').filter(x=>x.endsWith('.html')).join('\\n'))"], {
    capture: true,
    quiet: true,
    allowDuringDryRun: true
  }).split(/\r?\n/).filter(Boolean)) {
    cpSync(file, resolve(deployDirectory, file));
  }
}

async function platformApi(payload) {
  return jsonRequest(`${platformUrl}/api/tenant-project-pool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: platformPassword, ...payload })
  });
}

async function provisionProject(projectId) {
  const displayName = `Dynamax ${editionLabel(edition)} ${projectId.slice(-8)}`.slice(0, 30);
  const createArgs = ['projects', 'create', projectId, `--name=${displayName}`, '--quiet'];
  if (projectParent.startsWith('folders/')) createArgs.push(`--folder=${projectParent.slice('folders/'.length)}`);
  if (projectParent.startsWith('organizations/')) createArgs.push(`--organization=${projectParent.slice('organizations/'.length)}`);
  command('gcloud', createArgs);
  command('gcloud', ['billing', 'projects', 'link', projectId, `--billing-account=${billingAccount}`, '--quiet']);
  command('gcloud', [
    'services', 'enable',
    'firebase.googleapis.com',
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'fcm.googleapis.com',
    'iam.googleapis.com',
    'serviceusage.googleapis.com',
    '--project', projectId,
    '--quiet'
  ]);
  await addFirebase(projectId);
  await createFirestoreDatabase(projectId);

  const runtimeAccountName = 'dynamax-runtime';
  const runtimeEmail = `${runtimeAccountName}@${projectId}.iam.gserviceaccount.com`;
  command('gcloud', ['iam', 'service-accounts', 'create', runtimeAccountName, '--display-name=Dynamax tenant runtime', '--project', projectId, '--quiet']);
  for (const role of ['roles/datastore.user', 'roles/firebasecloudmessaging.admin']) {
    command('gcloud', ['projects', 'add-iam-policy-binding', projectId, `--member=serviceAccount:${runtimeEmail}`, `--role=${role}`, '--quiet']);
  }

  const keyFile = resolve(`.tenant-runtime-${projectId}.json`);
  try {
    command('gcloud', ['iam', 'service-accounts', 'keys', 'create', keyFile, `--iam-account=${runtimeEmail}`, '--project', projectId, '--quiet']);
    const serviceAccountKey = JSON.parse(readFileSync(keyFile, 'utf8'));
    const webConfig = await createFirebaseWebApp(projectId);
    const variables = deploymentVariables(projectId, runtimeEmail, webConfig, serviceAccountKey.private_key);
    await configureCloudflareProject(projectId, variables);

    const firebaseConfig = edition === 'school'
      ? 'firebase.school.json'
      : edition === 'faith'
        ? 'firebase.church.json'
        : 'firebase.organization.json';
    command(npxCommand, ['--yes', 'firebase-tools@15.24.0', 'deploy', '--only', 'firestore:indexes', '--project', projectId, '--config', firebaseConfig, '--force', '--non-interactive']);
    command(npxCommand, [
      '--yes', 'wrangler@4.61.0', 'pages', 'deploy', deployDirectory,
      `--project-name=${projectId}`,
      '--branch=main',
      `--commit-hash=${clean(process.env.GITHUB_SHA || 'tenant-pool')}`,
      '--commit-dirty=false'
    ], { env: { CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId, CLOUDFLARE_API_TOKEN: cloudflareToken } });

    const slot = {
      Edition: edition,
      FirebaseProjectId: projectId,
      CloudflareProject: projectId,
      WorkspaceId: projectId,
      PortalUrl: `https://${projectId}.pages.dev`,
      Region: region,
      Status: 'Ready',
      ProvisioningBatchId: requestReference
    };
    await platformApi({ action: 'register', slot });
    return slot;
  } finally {
    rmSync(keyFile, { force: true });
  }
}

async function main() {
  requireConfiguration();
  const plannedIds = Array.from({ length: count }, (_, index) => generatedProjectId(index + 1));
  process.stdout.write(`${applyChanges ? 'Provisioning' : 'Dry run for'} ${plannedIds.length} ${editionLabel(edition)} project(s): ${plannedIds.join(', ')}\n`);
  if (!applyChanges) {
    writeFileSync('tenant-provision-result.json', JSON.stringify({ dryRun: true, requestReference, plannedIds }, null, 2));
    return;
  }
  preparePagesDeployment();
  try {
    for (const projectId of plannedIds) {
      createdProjects.push(await provisionProject(projectId));
    }
    await platformApi({
      action: 'finish-request',
      request: {
        Reference: requestReference,
        Status: 'Completed',
        ProvisionedProjectIds: createdProjects.map((slot) => slot.FirebaseProjectId)
      }
    });
    writeFileSync('tenant-provision-result.json', JSON.stringify({ dryRun: false, requestReference, projects: createdProjects }, null, 2));
  } catch (error) {
    await platformApi({
      action: 'finish-request',
      request: { Reference: requestReference, Status: 'Failed', LastError: error.message || String(error) }
    }).catch(() => null);
    throw error;
  } finally {
    rmSync(deployDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
