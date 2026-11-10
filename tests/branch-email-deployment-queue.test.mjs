import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const stamp = '2026-11-10T10:00:00.000Z';
const clone = value => structuredClone(value);
async function fixture(kind = 'tenant') {
  const records = new Map(), writes = [], reads = [];
  let version = 0, beforeCommit = null;
  const key = `emailQueue_${randomUUID().replaceAll('-', '')}`;
  const put = (collection, id, data) => records.set(`${collection}/${id}`, { ...data, __id: id, __updateTime: `v${++version}` });
  const get = (collection, id) => clone(records.get(`${collection}/${id}`));
  const check = (collection, id, current) => {
    if (!current?.__updateTime || records.get(`${collection}/${id}`)?.__updateTime !== current.__updateTime) {
      throw Object.assign(new Error('Revision changed'), { code: 'FIRESTORE_WRITE_CONFLICT', status: 409 });
    }
  };
  const runHook = () => { if (beforeCommit) { const fn = beforeCommit; beforeCommit = null; fn(); } };
  globalThis[key] = {
    async getDocument(_env, collection, id) { reads.push(`${collection}/${id}`); return get(collection, id) || null; },
    async listCollection() { throw new Error('Unexpected catalogue scan'); },
    async patchDocumentFieldsIfCurrent(_env, collection, id, fields, current) {
      runHook(); check(collection, id, current); writes.push([{ collection, id, fields: clone(fields) }]);
      put(collection, id, { ...get(collection, id), ...fields });
    },
    async batchCommitDocuments(_env, items) {
      runHook();
      items.forEach(item => check(item.collectionPath, item.documentId, { __updateTime: item.updateTime }));
      writes.push(clone(items));
      items.forEach(item => put(item.collectionPath, item.documentId, item.data));
    }
  };
  const shim = `const adapter=globalThis[${JSON.stringify(key)}];export const {getDocument,listCollection,patchDocumentFieldsIfCurrent,batchCommitDocuments}=adapter;export const queryCollection=()=>{throw Error('unexpected query')},createDocumentIfAbsent=()=>{throw Error('unexpected create')},deleteDocumentIfCurrent=()=>{throw Error('unexpected delete')},upsertDocument=()=>{throw Error('unexpected upsert')};`;
  const shimUrl = `data:text/javascript;base64,${Buffer.from(shim).toString('base64')}`;
  const file = kind === 'tenant' ? 'tenant-project-pool.js' : 'managed-organisations.js';
  const fileUrl = new URL(`../functions/lib/${file}`, import.meta.url);
  const source = (await readFile(fileUrl, 'utf8')).replace(/from '\.\/([^']+)'/g,
    (_match, path) => `from '${path === 'firestore.js' ? shimUrl : new URL(path, fileUrl).href}'`);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const module = await import(moduleUrl);
  const providerUrl = new URL('../functions/lib/tenant-email-provider.js', import.meta.url);
  const providerSource = (await readFile(providerUrl, 'utf8')).replace(/from '\.\/([^']+)'/g,
    (_match, path) => `from '${path === 'firestore.js' ? shimUrl : (path === 'tenant-project-pool.js' && kind === 'tenant') || (path === 'managed-organisations.js' && kind === 'managed') ? moduleUrl : new URL(path, providerUrl).href}'`);
  const providerModule = await import(`data:text/javascript;base64,${Buffer.from(providerSource).toString('base64')}`);
  const collection = kind === 'tenant' ? 'tenantProjectPool' : 'managedOrganisations';
  put(collection, 'demo-school', { Id: 'demo-school', CloudflareProject: 'demo-school', WorkspaceId: 'demo', Status: 'Assigned',
    AssignedRegistrationReference: 'REG-1', EmailProvider: 'brevo', GmailConnectedEmail: 'global@example.org' });
  if (kind === 'tenant') put('tenantRegistrations', 'REG-1', { Reference: 'REG-1', WorkspaceId: 'demo', EmailProvider: 'brevo', GmailConnectedEmail: 'global@example.org' });
  const assignment = branch => ({ registrationReference: 'REG-1', workspaceId: 'demo', emailBranchId: branch });
  const queue = (branch = 'north', provider = 'gmail') => module[kind === 'tenant' ? 'queueTenantEmailDeployment' : 'queueManagedOrganisationEmailDeployment']({}, 'demo-school', stamp, provider, assignment(branch));
  const stage = (branch = 'north', provider = 'gmail') => {
    const coll = kind === 'tenant' ? 'tenantRegistrations' : collection, id = kind === 'tenant' ? 'REG-1' : 'demo-school';
    put(coll, id, { ...get(coll, id), EmailDeploymentBranchId: branch, EmailDeploymentRequestedAt: stamp, EmailDeploymentQueued: true,
      EmailProviderPending: provider, GmailConnectedEmailPending: provider === 'gmail' ? 'north@example.org' : '', EmailProviderConnectedByPending: 'Authorised manager' });
  };
  const complete = (branch = 'north', provider = 'gmail') => module[kind === 'tenant' ? 'completeTenantEmailDeployment' : 'completeManagedOrganisationEmailDeployment']({}, 'demo-school', stamp, provider, branch);
  const cancel = (branch = 'north', provider = 'gmail') => module[kind === 'tenant' ? 'cancelTenantEmailDeployment' : 'cancelManagedOrganisationEmailDeployment']({}, 'demo-school', stamp, provider, assignment(branch));
  const metadataTarget = () => ({ collection: kind === 'tenant' ? 'tenantRegistrations' : collection, id: kind === 'tenant' ? 'REG-1' : 'demo-school' });
  const metadataRegistration = () => {
    const target = metadataTarget(), old = get(target.collection, target.id);
    put(target.collection, target.id, { ...old, Status: 'Trialing', Plan: 'Free', TrialEndsAt: '2999-01-01T00:00:00.000Z', CloudflareProject: 'demo-school' });
    return { ...get(target.collection, target.id), __controlCollection: target.collection, __managedOrganisation: kind === 'managed', __emailBranchId: 'north' };
  };
  const metadataValues = { EmailProviderPending: 'gmail', GmailConnectedEmailPending: 'north@example.org', EmailDeploymentQueued: true,
    EmailDeploymentRequestedAt: stamp, EmailDeploymentBranchId: 'north' };
  return { module, providerModule, records, writes, reads, collection, put, get, queue, stage, complete, cancel, assignment,
    metadataRegistration, metadataValues, saveMetadata: registration => providerModule.updateTenantEmailProviderMetadata({}, registration, metadataValues),
    hook: fn => { beforeCommit = fn; }, cleanup: () => { delete globalThis[key]; },
    metadata: () => get(kind === 'tenant' ? 'tenantRegistrations' : collection, kind === 'tenant' ? 'REG-1' : 'demo-school') };
}

for (const kind of ['managed', 'tenant']) {
  test(`${kind}: metadata staging is guarded, bounded and idempotent`, async () => {
    const f = await fixture(kind);
    try {
      await f.queue(); const registration = f.metadataRegistration();
      await f.saveMetadata(registration);
      assert.equal(f.metadata().EmailDeploymentBranchId, 'north');
      const before = f.writes.length;
      await f.saveMetadata(registration); assert.equal(f.writes.length, before);
      assert.ok(f.reads.every(path => /^(managedOrganisations|tenantProjectPool|tenantRegistrations)\//.test(path)));
      f.put(f.collection, 'demo-school', { ...f.get(f.collection, 'demo-school'), EmailDeploymentBranchId: 'south' });
      await assert.rejects(f.saveMetadata(registration), error => error.code === 'EMAIL_PROVIDER_TRANSITION_SUPERSEDED');
      assert.equal(f.writes.length, before);
    } finally { f.cleanup(); }
  });
  test(`${kind}: a late metadata retry cannot overwrite a newly queued branch`, async () => {
    const f = await fixture(kind);
    try {
      await f.queue(); const registration = f.metadataRegistration(), before = f.writes.length;
      f.hook(() => f.put(f.collection, 'demo-school', { ...f.get(f.collection, 'demo-school'), EmailDeploymentBranchId: 'south' }));
      await assert.rejects(f.saveMetadata(registration), error => error.code === 'FIRESTORE_WRITE_CONFLICT');
      await assert.rejects(f.saveMetadata(registration), error => error.code === 'EMAIL_PROVIDER_TRANSITION_SUPERSEDED');
      assert.equal(f.writes.length, before);
      assert.equal(f.get(f.collection, 'demo-school').EmailDeploymentBranchId, 'south');
      assert.notEqual(f.metadata().GmailConnectedEmailPending, 'north@example.org');
    } finally { f.cleanup(); }
  });
  test(`${kind}: late OAuth staging cannot patch secrets or cancel a newer branch transition`, async () => {
    const f = await fixture(kind);
    try {
      const registration = f.metadataRegistration();
      let secretPatches = 0, revocations = 0, changed = false;
      await assert.rejects(f.providerModule.stageGoogleEmailProviderTransition({}, {}, registration, {
        clientId: 'fake-id', clientSecret: 'fake-secret', refreshToken: 'fake-refresh', connectedEmail: 'north@example.org'
      }, {
        connectedAt: stamp,
        updateMetadata: async (env, row, values) => {
          if (!changed) {
            changed = true;
            f.hook(() => f.put(f.collection, 'demo-school', { ...f.get(f.collection, 'demo-school'), EmailDeploymentBranchId: 'south' }));
          }
          return f.providerModule.updateTenantEmailProviderMetadata(env, row, values);
        },
        patchSecrets: async () => { secretPatches++; }, revokeRefreshToken: async () => { revocations++; }
      }), error => error.code === 'GOOGLE_EMAIL_CONNECTION_OUTBOX_FAILED' && error.refreshTokenHandled === true);
      assert.equal(secretPatches, 0); assert.equal(revocations, 0);
      const current = f.get(f.collection, 'demo-school');
      assert.equal(current.EmailDeploymentPending, true);
      assert.equal(current.EmailDeploymentBranchId, 'south');
      assert.equal(f.metadata().EmailProvider, 'brevo');
    } finally { f.cleanup(); }
  });
}

for (const kind of ['managed', 'tenant']) {
  test(`${kind}: branch completion preserves global provider, repeats without writes, and retains unrelated data`, async () => {
    const f = await fixture(kind);
    try {
      assert.equal((await f.queue()).EmailDeploymentBranchId, 'north');
      const before = f.writes.length; await f.queue(); assert.equal(f.writes.length, before);
      await assert.rejects(f.queue('south'), error => error.code === 'EMAIL_PROVIDER_TRANSITION_IN_PROGRESS');
      f.stage();
      assert.equal((await f.complete('south')).completed, false);
      assert.equal(f.writes.length, before);
      assert.equal((await f.complete()).completed, true);
      const meta = f.metadata();
      assert.equal(meta.EmailProvider, 'brevo'); assert.equal(meta.GmailConnectedEmail, 'global@example.org');
      assert.equal(meta.EmailBranchDeploymentCompletedProvider, 'gmail');
      assert.equal(meta.EmailBranchDeploymentCompletedBranchId, 'north');
      assert.equal(meta.EmailBranchDeploymentCompletedEmail, 'north@example.org');
      assert.equal(meta.WorkspaceId, 'demo'); assert.equal(meta.EmailProviderPending, '');
      const completedWrites = f.writes.length;
      assert.equal((await f.complete()).completed, true); assert.equal(f.writes.length, completedWrites);
    } finally { f.cleanup(); }
  });
  test(`${kind}: inheritance is branch-only and organisation transitions retain old behavior`, async () => {
    const f = await fixture(kind);
    try {
      await assert.rejects(f.queue('', 'inherit'), error => error.status === 400);
      assert.equal(f.writes.length, 0);
      await f.queue('north', 'inherit'); f.stage('north', 'inherit');
      assert.equal((await f.complete('north', 'inherit')).completed, true);
      assert.equal(f.metadata().EmailProvider, 'brevo');
      await f.queue('', 'gmail'); f.stage('', 'gmail');
      assert.equal((await f.complete('', 'gmail')).completed, true);
      assert.equal(f.metadata().EmailProvider, 'gmail');
      assert.equal(f.metadata().GmailConnectedEmail, 'north@example.org');
    } finally { f.cleanup(); }
  });
  test(`${kind}: cancellation cannot cancel another branch and is idempotent`, async () => {
    const f = await fixture(kind);
    try {
      await f.queue(); f.stage(); const before = f.writes.length;
      await assert.rejects(f.cancel('south'), error => error.code === 'EMAIL_PROVIDER_TRANSITION_SUPERSEDED');
      assert.equal(f.writes.length, before);
      assert.equal((await f.cancel()).cancelled, true);
      assert.equal(f.metadata().EmailProvider, 'brevo'); assert.equal(f.metadata().EmailDeploymentBranchId, '');
      const cancelledWrites = f.writes.length;
      assert.equal((await f.cancel()).alreadyCancelled, true);
      assert.equal((await f.cancel('south')).alreadyCancelled, false);
      assert.equal(f.writes.length, cancelledWrites);
    } finally { f.cleanup(); }
  });
  test(`${kind}: a newer branch transition wins a concurrent completion race`, async () => {
    const f = await fixture(kind);
    try {
      await f.queue(); f.stage(); const before = f.writes.length;
      f.hook(() => f.put(f.collection, 'demo-school', { ...f.get(f.collection, 'demo-school'), EmailDeploymentBranchId: 'south' }));
      assert.equal((await f.complete()).completed, false);
      assert.equal(f.writes.length, before);
      assert.equal(f.metadata().EmailProvider, 'brevo');
      assert.equal(f.metadata().EmailProviderPending, 'gmail');
    } finally { f.cleanup(); }
  });
}

test('tenant credential staging and completion require the exact branch and unchanged assignment', async () => {
  const f = await fixture();
  try {
    await f.queue(); f.stage();
    await assert.rejects(f.module.assertTenantEmailDeploymentCurrent({}, 'demo-school', { ...f.assignment('south'), requestedAt: stamp, provider: 'gmail' }),
      error => error.code === 'EMAIL_PROVIDER_TRANSITION_SUPERSEDED');
    const before = f.writes.length;
    f.hook(() => f.put(f.collection, 'demo-school', { ...f.get(f.collection, 'demo-school'), WorkspaceId: 'new-owner' }));
    await assert.rejects(f.complete(), error => error.code === 'TENANT_PROJECT_ASSIGNMENT_CHANGED');
    assert.equal(f.writes.length, before); assert.equal(f.metadata().EmailProviderPending, 'gmail');
    assert.equal(f.metadata().EmailProvider, 'brevo');
  } finally { f.cleanup(); }
});

test('tenant registration and queue complete atomically with both revision guards', async () => {
  const f = await fixture();
  try {
    await f.queue(); f.stage(); await f.complete();
    const final = f.writes.at(-1);
    assert.equal(final.length, 2);
    assert.deepEqual(final.map(write => write.collectionPath).sort(), ['tenantProjectPool', 'tenantRegistrations']);
    assert.ok(final.every(write => /^v\d+$/.test(write.updateTime)));
  } finally { f.cleanup(); }
});
