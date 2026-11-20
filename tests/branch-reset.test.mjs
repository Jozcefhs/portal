import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as policy from '../functions/lib/branch-reset.js';
import { branchResetFilePrefixes } from '../functions/lib/document-storage.js';
import { requiredDeploymentIdentity } from '../functions/lib/deployment-identity.js';
import { normalizeSchoolStructure } from '../functions/lib/school-scope.js';
import { buildStructuredQuery } from '../functions/lib/firestore.js';

const source = (await readFile(new URL('../functions/lib/organization-backup.js', import.meta.url), 'utf8'))
  .replace(/^import\s+[\s\S]*?from '[^']+';\r?$/gm, '').replace(/^export /gm, '');
const user = { username: 'admin', role: 'Super Admin', branchAccess: 'all' };
const students = branch => 'schoolBranches/' + branch + '/sections/primary/students';
const envId = { DYNAMAX_WORKSPACE_ID: 'test-school', ORGANISATION_EDITION: 'school' };
const identity = requiredDeploymentIdentity(envId);

function fixture() {
  const records = new Map(), objects = new Map(), storageReads = [];
  const descriptors = [students('west'), students('east'), 'payments', 'settings', 'staffUsers', 'unknown'];
  let version = 0;
  function put(path, id, fields = {}) {
    records.set(path + '/' + id, { ...fields, __id: id, __updateTime: 'version-' + ++version });
  }
  put('settings', 'schoolStructure', { Branches: ['main', 'east', 'west', 'west-end'] });
  put(students('west'), 'same id');
  put(students('east'), 'same id');
  put('payments', 'west @1', { BranchId: 'west' });
  put('payments', 'east', { BranchId: 'east' });
  put('payments', 'legacy');
  put('payments', 'shared', { BranchId: 'west', BranchIds: ['west', 'east'] });
  put('payments', 'transfer', { BranchId: 'west', Lines: [{ DestinationBranchId: 'east' }] });
  put('staffUsers', 'admin', { BranchId: 'west' });
  put('unknown', 'shared', { BranchId: 'west' });
  const rows = path => [...records.entries()].filter(([key, row]) => key === path + '/' + row.__id).map(([, row]) => row);
  const getDocument = async (_, path, id) => records.get(path + '/' + id);
  const commit = async (_, writes) => {
    for (const write of writes) {
      const current = await getDocument(null, write.collectionPath, write.documentId);
      assert.ok(write.updateTime);
      assert.equal(write.updateTime, current?.__updateTime);
    }
    for (const write of writes) {
      const key = write.collectionPath + '/' + write.documentId;
      if (write.operation === 'delete') records.delete(key);
      else put(write.collectionPath, write.documentId, { ...records.get(key), ...write.data });
    }
  };
  const db = { getDocuments: async (_, path, ids) => ids.map(id => records.get(path + '/' + id)), batchCommitLiteralDocuments: commit };
  function file(branch, id, metadata, uploaded = new Date(0)) {
    const key = branchResetFilePrefixes(identity, branch)[0] + 'primary/pupil/document/' + id;
    objects.set(key, { key, uploaded, customMetadata: metadata });
    return key;
  }
  const env = { ...envId, DYNAMAX_DOCUMENTS: {
    list: async ({ prefix }) => {
      storageReads.push(prefix);
      return { objects: [...objects.values()].filter(row => row.key.startsWith(prefix)) };
    },
    head: async key => objects.get(key),
    delete: async keys => keys.forEach(key => objects.delete(key))
  }};
  const api = vm.createContext({ crypto: { randomUUID }, ...policy, branchResetFilePrefixes, normalizeSchoolStructure,
    requiredDeploymentIdentity, hasFullModuleAccess: () => false, assignedStaffBranches: () => null,
    getDocument, batchCommitDocuments: commit, upsertDocument: async (_, path, id, data) => put(path, id, data),
    clearBranchResetRecords: (...args) => policy.clearBranchResetRecords(...args, db),
    listCollectionPage: async (_, path) => ({ documents: rows(path) }),
    queryCollection: async (_, path, options) => {
      buildStructuredQuery(path, options);
      if (path.includes('/')) return rows(path);
      assert.equal(options.filterJoin, 'OR');
      assert.deepEqual(Array.from(options.filters, f => f.field), ['BranchId', 'branchId']);
      return rows(path).filter(row => options.filters.some(f => row[f.field] === f.value));
    },
    descriptors: descriptors.map(path => ({ path }))
  });
  vm.runInContext(source + '\norganizationBackupDescriptors = async () => descriptors;', api);
  async function preview(includeFiles = false) {
    const scope = { branchId: 'west', includeFiles };
    const plan = await api.previewOrganizationReset(env, user, scope);
    const selection = [];
    let recordCount = 0, uncertain = 0;
    for (let cursor = 0; cursor < descriptors.length; cursor++) {
      const page = await api.exportOrganizationBackupPage(env, { cursor, resetBranchId: 'west' });
      if (page.resetSelection.length) selection.push({ collectionPath: page.backup.currentCollection, selection: page.resetSelection });
      recordCount += page.resetSelection.length;
      uncertain += page.resetUncertain;
    }
    return { ...scope, ...plan, safetyBackupCreated: true, recordCount, selection, uncertain };
  }
  return { env, api, preview, records, objects, storageReads, put, file };
}

test('counts-only preview returns eligible branch counts without exporting records, creating jobs or reading private files', async () => {
  const { env, api, records, storageReads } = fixture();
  const before = new Map(records);
  const plan = await api.previewOrganizationReset(env, user, { branchId: 'west', countsOnly: true });
  assert.deepEqual(Array.from(plan.paths), [students('west'), 'payments']);
  let count = 0;
  for (const collectionPath of plan.paths) {
    const page = await api.previewBranchResetCountPage(env, user, { branchId: 'west', collectionPath });
    assert.deepEqual(Object.keys(page).sort(), ['branchId', 'count', 'cursor', 'ok']);
    count += page.count;
  }
  assert.equal(count, 2);
  await assert.rejects(api.previewBranchResetCountPage(env, user, { branchId: 'west', collectionPath: students('east') }));
  assert.deepEqual(records, before);
  assert.equal(storageReads.length, 0);
});

test('a confirmed branch reset preserves sibling, shared and organisation records and tolerates a retried batch', async () => {
  const { env, api, preview, records, storageReads } = fixture();
  const before = new Map(records);
  const plan = await preview();
  assert.equal(plan.recordCount, 2);
  assert.equal(plan.uncertain, 3);
  assert.deepEqual(records, before);
  assert.equal(storageReads.length, 0);
  const { jobId } = await api.prepareOrganizationReset(env, user, plan);
  await assert.rejects(api.completeOrganizationReset(env, user, jobId, 'west'), /not finished/);
  for (const group of plan.selection) {
    const body = { ...group, jobId, branchId: 'west' };
    assert.equal((await api.clearOrganizationResetRecords(env, user, body)).removed, 1);
    assert.equal((await api.clearOrganizationResetRecords(env, user, body)).removed, 0);
  }
  await assert.rejects(api.clearOrganizationResetObjects(env, user, jobId, 'west'), /outside/);
  const result = await api.completeOrganizationReset(env, user, jobId, 'west');
  assert.equal(result.removedRecords, 2);
  for (const key of [students('west') + '/same id', 'payments/west @1']) {
    assert.equal(records.has(key), false);
    before.delete(key);
  }
  for (const [key, row] of before) assert.deepEqual(records.get(key), row);
});

test('cached clients, wrong branches, other workspaces and edited records cannot clear a collection', async () => {
  const { env, api, preview, records, put } = fixture();
  for (const id of ['', 'all', 'nonexistent', '../east', 'west/east']) {
    await assert.rejects(api.previewOrganizationReset(env, user, { branchId: id }));
  }
  const plan = await preview();
  await assert.rejects(api.prepareOrganizationReset(env, user, { ...plan, confirmation: 'RESET TEST-SCHOOL' }), /confirm/);
  await assert.rejects(api.prepareOrganizationReset(env, { ...user, branchId: 'east' }, plan), /working branch/);
  const { jobId } = await api.prepareOrganizationReset(env, user, plan);
  const body = { ...plan.selection[1], jobId, branchId: 'west' };
  await assert.rejects(api.clearOrganizationRestoreCollection(env, user, jobId, 'payments'), /require a verified branch/);
  await assert.rejects(api.clearOrganizationResetRecords(env, user, { ...body, branchId: 'east' }), /does not match/);
  await assert.rejects(api.clearOrganizationResetRecords({ ...env, DYNAMAX_WORKSPACE_ID: 'another-school' }, user, body), /does not match/);
  await assert.rejects(api.clearOrganizationResetRecords(env, user, { ...body, collectionPath: students('east') }), /outside/);
  put('payments', 'west @1', { BranchId: 'west', Amount: 12 });
  await assert.rejects(api.clearOrganizationResetRecords(env, user, body), /changed/);
  assert.equal(records.get('payments/west @1').Amount, 12);
  const east = records.get('payments/east');
  await assert.rejects(api.clearOrganizationResetRecords(env, user, { ...body, selection: [{ id: east.__id, version: east.__updateTime }] }), /changed/);
  assert.equal(records.get('systemRestoreJobs/' + jobId).RemovedRecords, 0);
  assert.equal(policy.branchResetPathAllowed('organisationBranches/east/churchDonations', 'west', 'faith'), false);
  assert.equal(policy.branchResetPathAllowed('organisationBranches/west/churchDonations', 'west', 'faith'), true);
});

test('file removal requires an explicit choice and matching path, metadata, workspace and age', async () => {
  const { env, api, preview, objects, file } = fixture();
  const metadata = { ...identity, branchId: 'west' };
  const allowed = file('west', 'old', metadata);
  const replaced = file('west', 'replaced', metadata);
  file('west', 'unknown', {});
  file('west', 'conflict', { ...metadata, branchId: 'east' });
  file('west', 'foreign', { ...metadata, workspaceId: 'another-school' });
  file('west', 'later', metadata, new Date(Date.now() + 3_600_000));
  file('west-end', 'old', { ...metadata, branchId: 'west-end' });
  file('east', 'old', { ...metadata, branchId: 'east' });
  const preserved = new Map(objects);
  preserved.delete(allowed);
  await assert.rejects(api.previewOrganizationReset(env, user, { branchId: 'main', includeFiles: true }), /unassigned uploads/);
  const plan = await preview(true);
  assert.equal(plan.r2ObjectCount, 2);
  const { jobId } = await api.prepareOrganizationReset(env, user, plan);
  for (const group of plan.selection) await api.clearOrganizationResetRecords(env, user, { ...group, jobId, branchId: 'west' });
  await assert.rejects(api.completeOrganizationReset(env, user, jobId, 'west'), /not finished/);
  await api.clearOrganizationResetObjects(env, user, jobId, 'west');
  const replacement = { ...objects.get(replaced), uploaded: new Date(Date.now() + 10000) };
  objects.set(replaced, replacement);
  preserved.set(replaced, replacement);
  let more = true;
  for (let i = 0; more && i < 20; i++) ({ more } = await api.clearOrganizationResetObjects(env, user, jobId, 'west'));
  assert.equal(more, false);
  assert.deepEqual(objects, preserved);
  assert.equal((await api.completeOrganizationReset(env, user, jobId, 'west')).removedObjects, 1);
});

test('Hospital resets retain workspace-wide clinical histories and isolate attendance by branch', () => {
  const env = { ...envId, ORGANISATION_EDITION: 'hospital' };
  for (const name of ['Patients', 'Visits', 'ClinicalEntries', 'Invoices', 'Payments', 'PortalGrants']) {
    assert.equal(policy.branchOwnsResetRecord('hospitalWorkspaces/test-school/hospital' + name, {BranchId:'west'}, 'west', 'hospital'), false);
  }
  const path = 'organisationBranches/west/staffDailyAttendance';
  assert.equal(policy.branchOwnsResetRecord(path, { BranchId:'west' }, 'west', 'hospital'), true);
  assert.equal(policy.branchOwnsResetRecord(path, { BranchId:'east' }, 'west', 'hospital'), false);
  assert.equal(policy.assertResetJobScope(env, {BranchId:'west', JobType:'Reset', Edition:'hospital', WorkspaceId:'test-school'}, 'west', 'west'), 'west');
});
