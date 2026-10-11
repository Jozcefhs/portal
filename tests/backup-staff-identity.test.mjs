import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const readSource = (path) => readFile(new URL(`../functions/lib/${path}`, import.meta.url), 'utf8');
const [backupSource, integritySource] = await Promise.all([
  readSource('organization-backup.js'), readSource('staff-account-integrity.js')
]);
const unmodule = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');

function harness(edition = 'school', options = {}) {
  let revision = 0;
  const docs = new Map();
  const batches = [];
  let beforeCommit = null;
  let onPage = null;
  let directoryFailure = null;
  const actor = { username: 'owner@example.invalid', role: 'Super Admin', edition };
  const actorId = 'legacy@owner';
  const env = { DYNAMAX_EDITION: edition };
  const seed = (path, id, data) => docs.set(`${path}/${id}`, { ...structuredClone(data), __updateTime: `v${++revision}` });
  const rows = (path) => [...docs].filter(([key]) => key.startsWith(`${path}/`))
    .map(([key, row]) => ({ ...structuredClone(row), __id: key.slice(path.length + 1) }));
  const get = (path, id) => docs.has(`${path}/${id}`) ? { ...structuredClone(docs.get(`${path}/${id}`)), __id: id } : null;
  seed('systemRestoreJobs', 'JOB', {
    ActorUsername: actor.username, ExpiresAt: '2099-01-01T00:00:00.000Z', Status: 'Prepared',
    CollectionPaths: ['staffUsers', 'students', 'settings'], WorkspaceId: 'synthetic', Edition: edition,
    ...(options.job || {})
  });
  if (!options.withoutActor) seed('staffUsers', actorId, {
    Username: actor.username, LoginUsername: 'current-owner-login', Role: 'Super Admin', Active: true
  });
  const batch = async (_env, writes, { literal = false } = {}) => {
    beforeCommit?.();
    const normalized = writes.map((write) => ({ ...write, documentId: literal ? write.documentId : encodeURIComponent(write.documentId) }));
    for (const write of normalized) {
      const current = get(write.collectionPath, write.documentId);
      if ((write.exists === false && current) || (write.exists === true && !current)
          || (write.updateTime && current?.__updateTime !== write.updateTime)) {
        throw Object.assign(new Error('Synthetic concurrent write'), { status: 412 });
      }
    }
    batches.push(structuredClone(normalized));
    for (const write of normalized) {
      if (write.operation === 'delete') docs.delete(`${write.collectionPath}/${write.documentId}`);
      else seed(write.collectionPath, write.documentId, write.data);
    }
  };
  const database = {
    getDocument: async (_env, path, id) => get(path, id),
    listCollection: async (_env, path) => { if (directoryFailure) throw directoryFailure; return rows(path); },
    listCollectionPage: async (_env, path, { pageSize }) => {
      const documents = rows(path).slice(0, pageSize);
      return { documents: onPage ? onPage(documents) : documents };
    },
    batchCommitDocuments: batch,
    batchCommitLiteralDocuments: (env, writes) => batch(env, writes, { literal: true }),
    upsertDocument: async (_env, path, id, data) => seed(path, id, data)
  };
  const core = vm.createContext({ ...database, crypto, Date });
  vm.runInContext(unmodule(integritySource), core);
  const context = vm.createContext({
    ...database, crypto, Date,
    ...Object.fromEntries(['beginStaffAccountChange', 'commitStaffAccountChanges', 'staffAccountCondition', 'staffAccountDocumentId']
      .map((name) => [name, core[name]]))
  });
  vm.runInContext(unmodule(backupSource), context);
  return {
    context, actor, actorId, env, docs, batches, seed, get,
    beforeCommit: (callback) => { beforeCommit = callback; },
    onPage: (callback) => { onPage = callback; },
    failDirectory: () => { directoryFailure = new Error('Synthetic directory unavailable'); }
  };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: staff restore protects actual actor document ID even when backup Username is different`, async () => {
    const h = harness(edition);
    const original = h.get('staffUsers', h.actorId);
    const result = await h.context.writeOrganizationRestoreChunk(h.env, h.actor, 'JOB', 'staffUsers', [
      { __id: h.actorId, Username: 'somebody-else', Role: 'Front Desk', Active: false, PasswordHash: 'old-unknown-value' },
      { __id: 'old-owner-id', Username: h.actor.username, Role: 'Admin' },
      { __id: 'alias-conflict', Username: 'different-user', LoginUsername: 'current-owner-login', Role: 'Admin' },
      { __id: 'index-conflict', Username: 'different-user', LoginUsernameKey: 'current-owner-login', Role: 'Admin' },
      { __id: 'owner-example.invalid', Username: 'renamed', Role: 'Admin' },
      { __id: 'other@literal', Username: 'other', Role: 'Front Desk', Active: true }
    ]);
    assert.equal(result.restored, 1);
    assert.deepEqual(h.get('staffUsers', h.actorId), original);
    assert.equal(h.get('staffUsers', 'old-owner-id'), null);
    assert.equal(h.get('staffUsers', 'alias-conflict'), null);
    assert.equal(h.get('staffUsers', 'index-conflict'), null);
    assert.equal(h.get('staffUsers', 'owner-example.invalid'), null);
    assert.equal(h.get('staffUsers', 'other@literal').Username, 'other');
    assert.equal(h.get('staffUsers', 'other%40literal'), null);
    assert.equal(h.batches[0].some((write) => write.documentId === 'staffAccountIntegrity'), true);
  });

  test(`${edition}: clear/reset preserves the verified destination ID and deletes other literal staff IDs`, async () => {
    const h = harness(edition, { job: { JobType: 'Reset' } });
    h.seed('staffUsers', 'other@literal', { Username: 'other', Role: 'Front Desk', Active: true });
    const original = h.get('staffUsers', h.actorId);
    // The clear page must not decide actor identity from its mutable Username.
    h.onPage((rows) => rows.map((row) => row.__id === h.actorId ? { ...row, Username: 'old-backup-name', LoginUsername: '' } : row));
    const result = await h.context.clearOrganizationRestoreCollection(h.env, h.actor, 'JOB', 'staffUsers');
    assert.equal(result.removed, 1);
    assert.deepEqual(h.get('staffUsers', h.actorId), original);
    assert.equal(h.get('staffUsers', 'other@literal'), null);
    assert.equal(h.batches[0][0].documentId, 'other@literal');
    assert.ok(h.batches[0][0].updateTime);
  });
}

test('staff restore fails closed on unavailable, missing or ambiguous current actor identity', async () => {
  for (const mode of ['unavailable', 'missing', 'ambiguous']) {
    const h = harness('school', { withoutActor: mode === 'missing' });
    if (mode === 'unavailable') h.failDirectory();
    if (mode === 'ambiguous') h.seed('staffUsers', 'duplicate', { Username: h.actor.username, Role: 'Super Admin' });
    await assert.rejects(h.context.writeOrganizationRestoreChunk(h.env, h.actor, 'JOB', 'staffUsers', [
      { __id: 'other', Username: 'other', Role: 'Admin' }
    ]), /unavailable|could not be verified|conflicting account/);
    await assert.rejects(h.context.clearOrganizationRestoreCollection(h.env, h.actor, 'JOB', 'staffUsers'),
      /unavailable|could not be verified|conflicting account/);
    assert.equal(h.batches.length, 0, mode);
  }
});

test('environment bootstrap administrator remains supported and its reserved ID cannot be overwritten', async () => {
  const h = harness('school', { withoutActor: true });
  h.env.ADMIN_WEB_USERNAME = h.actor.username;
  const result = await h.context.writeOrganizationRestoreChunk(h.env, h.actor, 'JOB', 'staffUsers', [
    { __id: 'owner-example.invalid', Username: 'renamed', Role: 'Admin' },
    { __id: 'other', Username: 'other', Role: 'Front Desk' }
  ]);
  assert.equal(result.restored, 1);
  assert.equal(h.get('staffUsers', 'owner-example.invalid'), null);
  assert.equal(h.get('staffUsers', 'other').Username, 'other');
});

test('restore cannot bypass the last-active-admin invariant when its actor session is stale', async () => {
  for (const action of ['clear', 'write']) {
    const h = harness();
    h.seed('staffUsers', h.actorId, { Username: h.actor.username, Role: 'Admin', Active: true });
    h.seed('staffUsers', 'last-admin', { Username: 'last-admin', Role: 'Super Admin', Active: true });
    const pending = action === 'clear'
      ? h.context.clearOrganizationRestoreCollection(h.env, h.actor, 'JOB', 'staffUsers')
      : h.context.writeOrganizationRestoreChunk(h.env, h.actor, 'JOB', 'staffUsers', [
        { __id: 'last-admin', Username: 'last-admin', Role: 'Front Desk', Active: false }
      ]);
    await assert.rejects(pending, /active Super Admin/);
    assert.equal(h.batches.length, 0);
    assert.equal(h.get('staffUsers', 'last-admin').Role, 'Super Admin');
  }
});

test('concurrent account changes abort restore instead of overwriting a newer directory', async () => {
  const h = harness();
  h.seed('staffUsers', 'other', { Username: 'other', Role: 'Admin', Active: true });
  h.beforeCommit(() => {
    h.beforeCommit(null);
    h.seed('settings', 'staffAccountIntegrity', { Revision: 'concurrent-management-change' });
  });
  await assert.rejects(h.context.writeOrganizationRestoreChunk(h.env, h.actor, 'JOB', 'staffUsers', [
    { __id: 'other', Username: 'other', Role: 'Front Desk', Active: false }
  ]), /changed while saving/);
  assert.equal(h.get('staffUsers', 'other').Role, 'Admin');
  assert.equal(h.batches.length, 0);
});

test('non-staff restores remain independent of the staff directory', async () => {
  const h = harness('school', { withoutActor: true });
  h.failDirectory();
  const result = await h.context.writeOrganizationRestoreChunk(h.env, h.actor, 'JOB', 'students', [
    { __id: 'S1', FullName: 'Synthetic Student' }
  ]);
  assert.equal(result.restored, 1);
  assert.equal(h.get('students', 'S1').FullName, 'Synthetic Student');
});
