import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { annotateProvisioningRequests, normalizeTenantPoolPolicy } from '../functions/lib/tenant-project-pool.js';
import { BILLING_QUOTA_BLOCK_CODE, provisioningFailure, isBillingQuotaBlockedRequest } from '../functions/lib/provisioning-failures.js';
import { onRequestPost } from '../functions/api/tenant-project-pool.js';

const pool = await readFile(new URL('../functions/lib/tenant-project-pool.js', import.meta.url), 'utf8');
const provisioner = await readFile(new URL('../scripts/provision-tenant-projects.mjs', import.meta.url), 'utf8');
const api = await readFile(new URL('../functions/api/tenant-project-pool.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../js/plan-management.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../plan-management.html', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/provision-tenant-pool.yml', import.meta.url), 'utf8');
const quotaText = 'FAILED_PRECONDITION: Precondition check failed. google.rpc.QuotaFailure Cloud billing quota exceeded: https://support.google.com/code/contact/billing_quota_increase';
const base = { Reference: 'POOL-1', Edition: 'organization', Mode: 'pool', Count: 1, Status: 'Pending', RequestedAt: '2026-10-03T00:00:00Z' };
const blocked = { ...base, Status: 'Blocked', BlockedCode: BILLING_QUOTA_BLOCK_CODE, LastError: 'Google quota exhausted', NextAttemptAt: '' };
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end)).replaceAll('export async function', 'async function');

test('quota classification requires an explicit billing quota diagnostic and follows wrapped causes', () => {
  for (const error of [new Error(quotaText), Object.assign(new Error('Command failed: gcloud billing projects link'), { stderr: Buffer.from(quotaText) }), new Error('Wrapped', { cause: new Error(quotaText) })]) {
    assert.equal(provisioningFailure(error).code, BILLING_QUOTA_BLOCK_CODE);
    assert.equal(provisioningFailure(error).blocked, true);
  }
  for (const message of ['FAILED_PRECONDITION: API not enabled', 'PERMISSION_DENIED', '429 Too many requests', '503 Service unavailable', 'ECONNRESET', 'Datastore quota exceeded']) {
    assert.equal(provisioningFailure(new Error(message)).blocked, false);
  }
});

test('blocked requests hold new provisioning across editions without changing ready slots', () => {
  const slots = [{ Edition: 'school', Status: 'Ready' }];
  const rows = annotateProvisioningRequests([blocked, { ...base, Reference: 'POOL-2', Edition: 'school' }, { ...base, Reference: 'CUSTOM', Mode: 'branded' }], slots, {});
  assert.equal(rows[0].Status, 'Blocked');
  assert.equal(rows[0].ActionRequired, false);
  assert.equal(rows[1].ActionRequired, false);
  assert.match(rows[1].HoldReason, /Google quota increase required/);
  assert.equal(rows[2].ActionRequired, false);
  assert.equal(slots[0].Status, 'Ready');
  const resumed = annotateProvisioningRequests([{ ...base, Reference: 'POOL-1' }], slots, {});
  assert.equal(resumed[0].ActionRequired, true);
});

function queueHarness(initial = blocked) {
  let saved = { ...initial, __id: initial.Reference, __updateTime: 'version-1', ProvisionedProjectIds: ['existing-project'] };
  const writes = [];
  let created = 0;
  const ctx = vm.createContext({ BILLING_QUOTA_BLOCK_CODE, isBillingQuotaBlockedRequest,
    annotateProvisioningRequests, normalizeTenantPoolPolicy, Date,
    clean: value => String(value ?? '').trim(), lower: value => String(value ?? '').trim().toLowerCase(),
    positiveInteger: (value, fallback = 1) => Number(value) || fallback, poolEdition: value => value,
    TENANT_PROVISIONING_REQUEST_COLLECTION: 'tenantProvisioningRequests', TENANT_PROJECT_POOL_COLLECTION: 'tenantProjectPool',
    getDocument: async () => saved,
    listCollection: async (_env, collection) => collection === 'tenantProvisioningRequests' ? [saved] : [],
    loadTenantPoolPolicy: async () => normalizeTenantPoolPolicy({}),
    requestTenantProjectProvisioning: async () => { created++; },
    patchDocumentFieldsIfCurrent: async (_env, _collection, _id, fields, expected) => {
      assert.equal(expected.__updateTime, saved.__updateTime);
      writes.push(fields); saved = { ...saved, ...fields, __updateTime: 'version-2' };
    } });
  vm.runInContext(section(pool, 'function withoutFirestoreMetadata(', 'function safeKey(')
    + section(pool, 'function publicProvisioningRequest(', 'export async function claimNextTenantProvisioningRequest(')
    + section(pool, 'export async function claimNextTenantProvisioningRequest(', 'async function queueCapacityRequest('), ctx);
  return { ctx, writes, saved: () => saved, created: () => created,
    run: expression => vm.runInContext(expression, ctx) };
}

test('blocked requests cannot be claimed or replaced by automatic capacity replenishment', async () => {
  const h = queueHarness();
  assert.equal(await h.run("claimNextTenantProvisioningRequest({}, 'runner')"), null);
  await h.run('ensureTenantPoolCapacity({})');
  assert.equal(h.created(), 0);
  assert.equal(h.writes.length, 0);
});

test('resume requires explicit confirmation and retains request identity, attempts and partial projects', async () => {
  const h = queueHarness({ ...blocked, Attempts: 12 });
  await assert.rejects(h.run("resumeTenantProvisioningRequest({}, 'POOL-1', false)"), /Confirm that Google/);
  const result = await h.run("resumeTenantProvisioningRequest({}, 'POOL-1', true)");
  assert.equal(result.Reference, 'POOL-1');
  assert.equal(result.Status, 'Pending');
  assert.equal(result.Attempts, 12);
  assert.equal(result.BlockedCode, '');
  assert.equal(h.saved().LastBlockedReason, 'Google quota exhausted');
  assert.deepEqual(h.saved().ProvisionedProjectIds, ['existing-project']);
  await assert.rejects(h.run("resumeTenantProvisioningRequest({}, 'POOL-1', true)"), /Only a billing-quota-blocked/);
});

test('finish persists the hold with no retry time and cannot be used to unblock it', async () => {
  const h = queueHarness(base);
  const result = await h.run(`finishTenantProvisioningRequest({}, {Reference:'POOL-1', Status:'Blocked', BlockedCode:'${BILLING_QUOTA_BLOCK_CODE}', LastError:'quota', NextAttemptAt:'2099-01-01'})`);
  assert.equal(result.Status, 'Blocked');
  assert.equal(result.NextAttemptAt, '');
  assert.equal(result.CompletedAt, '');
  assert.ok(result.BlockedAt);
  assert.deepEqual(h.saved().ProvisionedProjectIds, ['existing-project']);
  await assert.rejects(h.run("finishTenantProvisioningRequest({}, {Reference:'POOL-1', Status:'Pending'})"), /administrator action/);
});

test('resume action is administrator-only and ordinary temporary retry state is preserved', async () => {
  const actions = api.slice(api.indexOf('const PROVISIONER_ACTIONS'), api.indexOf('function requireTenantPoolAccess'));
  assert.doesNotMatch(actions, /resume-request/);
  assert.match(api, /requirePlatformAdmin\(env, password\)/);
  assert.match(api, /body\.quotaResolved/);
  const h = queueHarness(base);
  const result = await h.run("finishTenantProvisioningRequest({}, {Reference:'POOL-1', Status:'Pending', NextAttemptAt:'2099-01-01T00:00:00Z', LastError:'Network unavailable'})");
  assert.equal(result.Status, 'Pending');
  assert.equal(result.NextAttemptAt, '2099-01-01T00:00:00.000Z');
  assert.equal(result.BlockedCode, '');
});

test('the live API handler rejects provisioner credentials for administrator resume', async () => {
  const response = await onRequestPost({
    request: new Request('https://test.invalid/api/tenant-project-pool', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume-request', reference: 'POOL-1', quotaResolved: true, password: 'provisioner-only' })
    }),
    env: { TENANT_PROVISIONER_SECRET: 'provisioner-only', ADMIN_WEB_PASSWORD: 'administrator-only' }
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).ok, false);
});

test('concurrent updates cannot release a hold and unavailable queues cannot create replacements', async () => {
  const h = queueHarness();
  h.ctx.patchDocumentFieldsIfCurrent = async () => { throw new Error('Concurrent update conflict'); };
  await assert.rejects(h.run("resumeTenantProvisioningRequest({}, 'POOL-1', true)"), /Concurrent update/);
  assert.equal(h.saved().Status, 'Blocked');
  h.ctx.listCollection = async () => { throw new Error('Queue unavailable'); };
  await assert.rejects(h.run('ensureTenantPoolCapacity({})'), /Queue unavailable/);
  assert.equal(h.created(), 0);
});

test('administrator rendering shows the hold, escapes diagnostics and clears the alert after resume', () => {
  const elements = new Map();
  const ctx = vm.createContext({ Date,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    document: { getElementById: id => {
      if (!elements.has(id)) elements.set(id, { hidden: false, innerHTML: '', value: '' });
      return elements.get(id);
    } },
    tenantPoolSummary: {}, tenantPoolRows: {}, tenantRequestRows: {}, tenantRetirementRows: null,
    tenantPoolState: { slots: [], requests: [
      { ...blocked, LastError: '<script>unsafe</script>' },
      { ...base, Reference: 'POOL-2', ActionRequired: false, HoldReason: 'Google quota hold' }
    ] }
  });
  vm.runInContext(section(client, 'function editionLabel(', 'async function tenantPoolRequest('), ctx);
  vm.runInContext('renderTenantPool()', ctx);
  assert.equal(elements.get('tenantProvisioningAlert').hidden, false);
  assert.match(ctx.tenantRequestRows.innerHTML, /Waiting—billing quota blocked/);
  assert.doesNotMatch(ctx.tenantRequestRows.innerHTML, /Capacity met|<script>/);
  assert.match(ctx.tenantRequestRows.innerHTML, /&lt;script>/);
  assert.equal((ctx.tenantRequestRows.innerHTML.match(/data-resume-tenant-request/g) || []).length, 1);
  ctx.tenantPoolState.requests = [base];
  vm.runInContext('renderTenantPool()', ctx);
  assert.equal(elements.get('tenantProvisioningAlert').hidden, true);
  assert.equal(elements.get('tenantProvisioningAlert').innerHTML, '');
});

test('resume button performs no action without confirmation and sends confirmation only after approval', async () => {
  let handler;
  let confirmed = false;
  const calls = [];
  const ctx = vm.createContext({ tenantRequestRows: { addEventListener: (_event, callback) => { handler = callback; } },
    window: { DynamaxDialogs: { confirm: async () => confirmed },
      DynamaxActionFeedback: { begin: () => true, end() {} } },
    tenantPoolRequest: async payload => { calls.push(payload); return { message: 'Resumed' }; },
    loadTenantPool: async () => {}, setStatus() {}, tenantPoolStatus: {}
  });
  vm.runInContext(client.slice(client.indexOf("tenantRequestRows?.addEventListener('click'")), ctx);
  const event = { target: { closest: () => ({ dataset: { resumeTenantRequest: 'POOL-1' } }) } };
  await handler(event);
  assert.equal(calls.length, 0);
  confirmed = true;
  await handler(event);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'resume-request');
  assert.equal(calls[0].reference, 'POOL-1');
  assert.equal(calls[0].quotaResolved, true);
});

async function failingProvisioning(diagnostic) {
  const requests = [];
  const files = new Map();
  let links = 0;
  const ctx = vm.createContext({ createHash, resolve, provisioningFailure, Buffer, Date, URL,
    process: { platform: 'linux', execPath: '/node', cwd: () => process.cwd(), stdout: { write() {} }, stderr: { write() {} }, env: {
      TENANT_PROVISION_APPLY: 'true', TENANT_PROVISIONING_REQUEST_JSON: JSON.stringify(base),
      DYNAMAX_TENANT_PROVISIONER_SECRET: 'test-only', CLOUDFLARE_ACCOUNT_ID: 'test-only', CLOUDFLARE_API_TOKEN: 'test-only',
      DYNAMAX_GCP_BILLING_ACCOUNT: 'test-billing', DYNAMAX_GCP_PARENT: 'folders/123'
    } },
    existsSync: () => false, mkdirSync() {}, cpSync() {}, rmSync() {},
    writeFileSync: (path, value) => files.set(path, JSON.parse(value)),
    Atomics: { wait() {} }, SharedArrayBuffer, Int32Array,
    execFileSync: (_program, args) => {
      if (args[0] === 'auth') return 'test-token';
      if (args[0] === 'projects' && args[1] === 'describe') return args[2];
      if (args[0] === 'billing') { links++; throw Object.assign(new Error('Command failed: gcloud billing projects link'), { stderr: diagnostic }); }
      return '';
    },
    fetch: async (url, options = {}) => {
      if (url.includes('cloudbilling.googleapis.com')) return Response.json({ permissions: ['billing.resourceAssociations.create'] });
      const payload = JSON.parse(options.body); requests.push(payload);
      return Response.json({ ok: true, slots: [] });
    } });
  vm.runInContext(provisioner.slice(0, provisioner.indexOf('const invokedDirectly'))
    .replace(/^import .*;\r?\n/gm, '').replaceAll('export function', 'function').replaceAll('export async function', 'async function'), ctx);
  await assert.rejects(vm.runInContext('main()', ctx), /Command failed/);
  return { requests, files, links };
}

test('a real subprocess billing diagnostic stops the first attempt and records a blocked result', async () => {
  const run = await failingProvisioning(quotaText);
  assert.equal(run.links, 1);
  const finish = run.requests.find(row => row.action === 'finish-request');
  assert.equal(finish.request.Status, 'Blocked');
  assert.equal(finish.request.BlockedCode, BILLING_QUOTA_BLOCK_CODE);
  assert.equal(finish.request.NextAttemptAt, '');
  assert.match(finish.request.LastError, /Google quota increase required/);
  assert.equal(run.files.get('tenant-provision-result.json').status, 'Blocked');
  assert.equal(run.requests.some(row => row.action === 'register'), false);
});

test('temporary billing command failures retry five times then schedule backoff, not a quota hold', async () => {
  const run = await failingProvisioning('503 Service unavailable');
  assert.equal(run.links, 5);
  const finish = run.requests.find(row => row.action === 'finish-request');
  assert.equal(finish.request.Status, 'Pending');
  assert.equal(finish.request.BlockedCode, '');
  assert.ok(Date.parse(finish.request.NextAttemptAt) > Date.now());
});

test('administrator UI and no-op workflow summaries distinguish holds from successful provisioning', () => {
  assert.match(html, /id="tenantProvisioningAlert".*role="alert"/);
  assert.match(client, /Blocked—Google quota increase required/);
  assert.match(client, /data-resume-tenant-request/);
  assert.match(client, /Quota resolved—resume/);
  assert.match(client, /quotaResolved: true/);
  assert.match(workflow, /This run does not confirm successful provisioning/);
  assert.match(workflow, /blocked_count/);
});
