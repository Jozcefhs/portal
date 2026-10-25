import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeEntranceSubjects } from '../functions/lib/entrance-subjects.js';

const read = (path) => fs.readFile(new URL(`../functions/lib/${path}`, import.meta.url), 'utf8');
const branchSource = await read('branch-profile-settings.js');
const backupSource = await read('organization-backup.js');
const unmodule = (source) => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');

function branchHarness(current, { failure = null, changeDuringSave = false } = {}) {
  const writes = [];
  const context = vm.createContext({ Date, normalizeEntranceSubjects, safeScopeId: value => value,
    getSchoolStructure: async () => ({ Branches: [{ Id: 'main', Name: 'Main' }] }),
    getDocument: async () => { if (failure) throw failure; return structuredClone(current); },
    upsertDocument: async (_env, path, id, data, condition) => {
      if (changeDuringSave || (current && condition.updateTime !== current.__updateTime)) {
        throw Object.assign(new Error('Concurrent change'), { status: 412 });
      }
      writes.push({ path, id, data, condition });
    },
    deleteDocument: async (_env, path, id, condition) => writes.push({ path, id, condition, deleted: true })
  });
  vm.runInContext(unmodule(branchSource), context);
  return { context, writes };
}

test('R04 an unavailable branch settings read fails closed for read, save and reset', async () => {
  const h = branchHarness(null, { failure: Object.assign(new Error('Synthetic database outage'), { status: 503 }) });
  await assert.rejects(h.context.effectiveBranchProfile({}, { SchoolPhone: 'default' }, 'main'), /outage/);
  await assert.rejects(h.context.saveBranchProfileOverrides({}, { branchId: 'main', submittedProfile: { SchoolPhone: 'new' } }), /outage/);
  await assert.rejects(h.context.resetBranchProfileOverrides({}, 'main'), /outage/);
  assert.equal(h.writes.length, 0);
});

test('R04 a partial branch save preserves omitted values and uses a version precondition', async () => {
  const h = branchHarness({ Values: { SchoolPhone: 'old', PaymentAccountName: 'Existing branch' }, __updateTime: 'v1' });
  await h.context.saveBranchProfileOverrides({}, { branchId: 'main', submittedProfile: { SchoolPhone: 'new' } });
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].data.Values)), { SchoolPhone: 'new', PaymentAccountName: 'Existing branch' });
  assert.equal(h.writes[0].condition.updateTime, 'v1');
});

test('R04 confirmed absence supports a create-only override; concurrent updates are not overwritten', async () => {
  const fresh = branchHarness(null);
  await fresh.context.saveBranchProfileOverrides({}, { branchId: 'main', submittedProfile: { SchoolPhone: 'new' } });
  assert.equal(fresh.writes[0].condition.exists, false);
  const concurrent = branchHarness({ Values: { SchoolPhone: 'old' }, __updateTime: 'v1' }, { changeDuringSave: true });
  await assert.rejects(concurrent.context.saveBranchProfileOverrides({}, { branchId: 'main', submittedProfile: { SchoolPhone: 'new' } }), /Concurrent/);
  assert.equal(concurrent.writes.length, 0);
});

function backupHarness(current, failure = null) {
  const writes = [];
  const context = vm.createContext({
    clean: value => String(value ?? '').trim(), lower: value => String(value ?? '').trim().toLowerCase(),
    getDocument: async () => { if (failure) throw failure; return structuredClone(current); },
    restoreError: (message, status) => Object.assign(new Error(message), { status }),
    restoreActor: user => user, currentRestoreJob: async () => ({}), jobAllowsCollection: (_job, path) => path,
    MAX_RESTORE_DOCUMENTS: 200, batchCommitDocuments: async (_env, batch) => writes.push(...batch)
  });
  const slice = (a, b) => backupSource.slice(backupSource.indexOf(a), backupSource.indexOf(b, backupSource.indexOf(a)));
  vm.runInContext(slice('const SUBSCRIPTION_IDENTITY_SETTING_FIELDS =', 'const RESET_PRESERVED_ROOT_COLLECTIONS ='), context);
  vm.runInContext(slice('function withoutTransportMetadata(', 'export function sanitizeBackupDocument('), context);
  vm.runInContext(unmodule(slice('async function protectedRestoreDocument(', 'export async function completeOrganizationRestore(')), context);
  return { context, writes };
}

test('R05 live settings read failures abort the complete restore chunk before any commit', async () => {
  const h = backupHarness(null, new Error('Synthetic unavailable live settings'));
  await assert.rejects(h.context.writeOrganizationRestoreChunk({}, { username: 'owner' }, 'job', 'settings', [
    { __id: 'organisationProfile', WorkspaceId: 'old', Edition: 'faith' }
  ]), /unavailable live settings/);
  assert.equal(h.writes.length, 0);
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`R05 ${edition}: restore keeps live identity and absent protected fields, with conditional commit`, async () => {
    const h = backupHarness({ __updateTime: 'v1', Edition: edition, WorkspaceId: 'live', Plan: 'Starter' });
    await h.context.writeOrganizationRestoreChunk({}, { username: 'owner' }, 'job', 'settings', [
      { __id: 'organisationProfile', WorkspaceId: 'old', Edition: 'faith', Plan: 'Professional',
        SubscriptionActive: true, PlanModuleCatalogVersion: 11, Name: 'Restored name' }
    ]);
    assert.equal(h.writes[0].updateTime, 'v1');
    assert.equal(h.writes[0].data.WorkspaceId, 'live');
    assert.equal(h.writes[0].data.Edition, edition);
    assert.equal(h.writes[0].data.Plan, 'Starter');
    assert.equal(h.writes[0].data.Name, 'Restored name');
    assert.equal(Object.hasOwn(h.writes[0].data, 'SubscriptionActive'), false);
    assert.equal(Object.hasOwn(h.writes[0].data, 'PlanModuleCatalogVersion'), false);
  });
}

test('R05 missing identity or redacted credential settings cannot be restored; ordinary new settings can', async () => {
  const h = backupHarness(null);
  await assert.rejects(h.context.protectedRestoreDocument({}, 'settings', { __id: 'organisationProfile' }, {}), /Protected live settings are missing/);
  await assert.rejects(h.context.protectedRestoreDocument({}, 'settings', { __id: 'mail', __redactedFields: ['ApiKey'] }, {}), /Protected live settings are missing/);
  const ordinary = await h.context.protectedRestoreDocument({}, 'settings', { __id: 'preferences', Theme: 'light' }, {});
  assert.equal(ordinary.exists, false);
});

test('R05 restore preserves current redacted credentials instead of blank backup values', async () => {
  const h = backupHarness({ __updateTime: 'v1', ApiKey: 'synthetic-live' });
  const restored = await h.context.protectedRestoreDocument({}, 'settings', {
    __id: 'mail', ApiKey: '', OtherSecret: 'old', __redactedFields: ['ApiKey', 'OtherSecret'], Sender: 'Restored sender'
  }, {});
  assert.equal(restored.data.ApiKey, 'synthetic-live');
  assert.equal(Object.hasOwn(restored.data, 'OtherSecret'), false);
  assert.equal(restored.data.Sender, 'Restored sender');
});
