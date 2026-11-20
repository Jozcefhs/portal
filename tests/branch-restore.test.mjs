import test from 'node:test';
import assert from 'node:assert/strict';
import { branchRestoreRequest, putRestoreFile } from '../functions/lib/branch-restore.js';
import { requiredDeploymentIdentity } from '../functions/lib/deployment-identity.js';
import { previewBranchBackup, previewRestoreFiles } from '../js/branch-restore.js';
import { backupJsonValue } from '../functions/lib/firestore.js';

test('chunked browser upload reaches storage with the archived length and cancels on a collision', async () => {
  let length;
  const previous = globalThis.FixedLengthStream;
  globalThis.FixedLengthStream = class extends TransformStream {
    constructor(size) { super(); length = size; }
  };
  try {
    const file = {key:'test',size:5};
    const options = {onlyIf:new Headers({'If-None-Match':'*'})};
    const bucket = {put:async (key, stream, received) => {
      assert.equal(key,file.key); assert.equal(received,options);
      assert.equal(await new Response(stream).text(),'hello'); return {size:5};
    }};
    assert.deepEqual(await putRestoreFile(bucket,file,new Blob(['hello']).stream(),options),{size:5});
    assert.equal(length,5);
    bucket.put = async () => null;
    assert.equal(await putRestoreFile(bucket,file,new Blob(['hello']).stream(),options),null);
  } finally {
    if (previous) globalThis.FixedLengthStream = previous;
    else delete globalThis.FixedLengthStream;
  }
});

function fixture(edition) {
  const env = { DYNAMAX_WORKSPACE_ID: 'test-org', ORGANISATION_EDITION: edition };
  const user = { username: 'owner', branchId: 'west' };
  const path = edition === 'hospital' ? 'hospitalWorkspaces/test-org/hospitalAppointments' : 'payments';
  const store = new Map();
  let sequence = 0;
  function put(collection, id, data) {
    store.set(collection + '/' + id, { ...data, __id: id, __updateTime: 'v' + ++sequence });
  }
  const get = (collection, id) => store.get(collection + '/' + id);
  put('settings', 'schoolStructure', { Branches: ['west', 'east'] });
  put(path, 'collision', { BranchId: 'east', Amount: 900 });
  put(path, 'later', { BranchId: 'west', Amount: 10 });
  put(path, 'edit', { BranchId: 'west', Amount: 1 });
  put(path, 'steady', { Amount: 3, BranchId: 'west' });
  put(path, 'shared', { BranchId: 'west', ToBranchId: 'east' });
  put(path, 'unclassified', { Amount: 8 });
  put('invoices', 'unlisted', { BranchId: 'west' });
  put('staffUsers', 'owner', { BranchId: 'west' });
  const other = 'schoolBranches/east/sections/primary/students';
  put(other, 'same', { Test: 'keep' });
  const nested = (edition === 'school' ? 'schoolBranches' : 'organisationBranches') + '/west/staffDailyAttendance';
  put(nested.replace('/west/', '/east/'), 'same', { Test: 'keep sibling' });
  const db = {
    getDocument: async (_, p, id) => get(p, id),
    getDocuments: async (_, p, ids) => ids.map(id => get(p, id)),
    queryCollection: async (_, p, options) => [...store.values()].filter(row => get(p, row.__id) === row &&
      (!options.filters || options.filters.some(f => row[f.field] === f.value))),
    commit: async (_, writes) => {
      for (const w of writes) {
        const row = get(w.collectionPath, w.documentId);
        if (w.exists === false) assert.equal(row, undefined);
        else { assert.ok(w.updateTime); assert.equal(row?.__updateTime, w.updateTime); }
      }
      for (const w of writes) {
        if (w.operation === 'delete') store.delete(w.collectionPath + '/' + w.documentId);
        else put(w.collectionPath, w.documentId, { ...(w.updateMask && get(w.collectionPath, w.documentId)), ...w.data });
      }
    }
  };
  const payload = { format: 'dynamax-organization-backup', formatVersion: 3, edition, workspaceId: 'test-org', collections: {
    [path]: [{ __id: 'collision', BranchId: 'west', Amount: 7 }, { __id: 'edit', BranchId: 'west', Amount: 5 },
      { __id: 'added @1', BranchId: 'west', Amount: 4 }, { __id: 'steady', BranchId: 'west', Amount: 3 }],
    [other]: [{ __id: 'same', Test: 'other branch' }], [nested]: [{ __id: 'same', Test: 'restored' }],
    staffUsers: [{ __id: 'owner', Active: false }], settings: [{ __id: 'schoolStructure', Branches: [] }]
  } };
  const call = (action, body) => branchRestoreRequest(env, user, action, body, db);
  const preview = mode => previewBranchBackup(payload, 'west', mode, call, rows => rows.length ? [rows] : [], () => {});
  const prepare = (plan, extra) => call('prepare-branch-restore', { ...plan.scope, confirmation: plan.phrase, safetyBackupCreated: true, hashes: plan.batches.map(batch => batch.hash), ...extra });
  return { env, db, user, preview, prepare, get, put, store, payload, path, call, nested };
}

for (const edition of ['school','faith','organization','hospital']) {
  test(edition + ' restores selected files once, keeps conflicts, and resumes an interrupted write', async t => {
    try { requiredDeploymentIdentity({ORGANISATION_EDITION:edition, DYNAMAX_WORKSPACE_ID:'test-org'}); } catch { return t.skip(); }
    const f = fixture(edition);
    const objects = new Map(), reads = [], writes = [];
    const base = 'v1/' + edition + '/test-org/finance/';
    const entry = (id, branch = 'west') => ({key:base + branch + '/all/person/receipt/' + id,
      size:4, name:id, type:'application/pdf', version:'original', etag:'original'});
    const missing = entry('missing.pdf'), same = entry('same.pdf'), conflict = entry('conflict.pdf'), sibling = entry('sibling.pdf','east');
    const files = [missing, same, conflict, sibling, missing];
    const payload = {...f.payload, documentArchive:{files, missing:[entry('missing-at-export.pdf').key]}};
    objects.set(same.key, same);
    objects.set(conflict.key, {...conflict, etag:'changed', version:'changed'});
    objects.set(sibling.key, sibling);
    f.env.DYNAMAX_DOCUMENTS = {
      head: async key => { reads.push(key); return objects.get(key); },
      put: async (key, bytes, options) => {
        assert.equal(options.onlyIf.get('If-None-Match'), '*');
        if (objects.has(key)) return null;
        assert.equal(options.sha256, Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex'));
        writes.push(key);
        const object = {size:4, customMetadata:options.customMetadata, checksums:{toJSON:()=>({sha256:options.sha256})}};
        objects.set(key,object); return object;
      }
    };
    const plan = await f.preview('merge');
    const before = new Map(f.store);
    const read = async n => { assert.notEqual(n,3); return new Blob(['data']); };
    const summary = await previewRestoreFiles(plan,{payload,offsets:[]},new Set(),f.call,read);
    assert.match(summary,/to restore: 1.*Already present: 1.*missing: 2/);
    assert.deepEqual(reads,[missing.key,same.key,conflict.key]); assert.equal(writes.length,0); assert.deepEqual(f.store,before);
    const {jobId} = await f.prepare(plan);
    for (const [index,batch] of plan.batches.entries()) {
      const body = {...plan.scope, ...batch, jobId,index};
      if (!batch.file) { await f.call('apply-branch-restore',body); continue; }
      Object.assign(body,{binary:new TextEncoder().encode('data'),byteLength:4});
      for (const change of [{branchId:'east'},{byteLength:3},{file:{...body.file,key:sibling.key}}]) {
        await assert.rejects(f.call('apply-branch-restore-document',{...body,...change}));
      }
      const commit = f.db.commit;
      f.db.commit = async () => { throw Error('interrupted'); };
      await assert.rejects(f.call('apply-branch-restore-document',body),/interrupted/);
      f.db.commit = commit;
      assert.ok((await f.call('apply-branch-restore-document',body)).complete);
      assert.ok((await f.call('apply-branch-restore-document',body)).complete);
    }
    assert.deepEqual(writes,[missing.key]); assert.equal(objects.get(sibling.key),sibling);
    const again = await f.preview('merge');
    await previewRestoreFiles(again,{payload,offsets:[]},new Set(),f.call,read);
    assert.equal(again.batches.length,0);
    const main = {...plan.scope,branchId:'main'};
    f.user.branchId = 'main'; f.put('settings','schoolStructure',{Branches:['main','east','west']});
    const [candidate] = plan.batches.filter(b=>b.file);
    const forged = {...candidate.file, key:entry('x.pdf','main').key};
    const check = await f.call('preview-branch-restore-documents',{...main,files:[forged, {...forged,key:sibling.key}]});
    assert.deepEqual(check.details.map(d=>d.state),['unverified','unverified']);
    assert.ok(!reads.includes(sibling.key));
  });
}

for (const edition of ['school','faith','organization','hospital']) {
  // Hospital has a separate deployment identity and runs this same suite in its own source tree.
  if (edition === 'hospital') {
    try { requiredDeploymentIdentity({ ORGANISATION_EDITION: edition, DYNAMAX_WORKSPACE_ID: 'test-org' }); } catch { continue; }
  }
  for (const mode of ['merge', 'exact']) test(edition + ' ' + mode + ' previews and restores only eligible branch records', async () => {
    const f = fixture(edition), before = new Map(f.store);
    const plan = await f.preview(mode);
    assert.deepEqual(f.store, before);
    assert.deepEqual([plan.totals.create, plan.totals.update, plan.totals.remove, plan.totals.unchanged, plan.totals.conflict],
      [2, 1, mode === 'exact' ? 1 : 0, 1, 1]);
    await assert.rejects(f.prepare(plan, { confirmation: 'RESTORE EAST EXACT' }));
    const { jobId } = await f.prepare(plan);
    for (const [index, batch] of plan.batches.entries()) {
      const body = { ...plan.scope, ...batch, jobId, index };
      await assert.rejects(f.call('apply-branch-restore', { ...body, branchId: 'east' }));
      const result = await f.call('apply-branch-restore', body);
      const snapshot = new Map(f.store);
      assert.deepEqual(await f.call('apply-branch-restore', body), result);
      assert.deepEqual(f.store, snapshot);
    }
    assert.equal(f.get(f.path, 'added @1').Amount, 4);
    assert.equal(f.get(f.path, 'edit').Amount, 5);
    assert.equal(f.get(f.nested, 'same').Test, 'restored');
    const changed = [f.path + '/edit'];
    if (mode === 'exact') { assert.equal(f.get(f.path, 'later'), undefined); changed.push(f.path + '/later'); }
    for (const [key, row] of before) if (!changed.includes(key)) assert.deepEqual(f.store.get(key), row, key);
    const again = await f.preview(mode);
    assert.equal(again.batches.length, 0);
  });
}

test('ownership changes, altered backup data and altered versions stop a confirmed batch atomically', async () => {
  const f = fixture('school'), plan = await f.preview('merge'), { jobId } = await f.prepare(plan);
  const body = { ...plan.scope, ...plan.batches[0], jobId, index: 0 };
  await assert.rejects(f.call('apply-branch-restore', { ...body, documents: body.documents.map(row => ({ ...row, Amount: 1000 })) }), /changed/);
  f.put(f.path, 'edit', { BranchId: 'east', Amount: 70 });
  await assert.rejects(f.call('apply-branch-restore', body), /changed/);
  assert.equal(f.get(f.path,'edit').Amount, 70);
  assert.equal(f.get(f.path,'added @1'), undefined);
  await assert.rejects(f.call('apply-branch-restore', { ...body, remove: true }), /removals/);
});

test('invalid backups and duplicate IDs cannot prepare a restore', async () => {
  const f = fixture('school');
  f.payload.workspaceId = 'another-org';
  await assert.rejects(f.preview('exact'), /different organisation/);
  f.payload.workspaceId = 'test-org';
  f.payload.collections[f.path].push(f.payload.collections[f.path][0]);
  await assert.rejects(f.preview('exact'), /duplicate/);
});

test('a row created after an exact preview is never silently added to its removal list', async () => {
  const f = fixture('school');
  f.payload.collections = { [f.path]: [] };
  const plan = await f.preview('exact');
  assert.equal(plan.totals.remove, 3);
  f.put(f.path, 'arrived-after-preview', { BranchId: 'west' });
  const { jobId } = await f.prepare(plan);
  await f.call('apply-branch-restore', { ...plan.scope, ...plan.batches[0], index: 0, jobId });
  assert.ok(f.get(f.path, 'arrived-after-preview'));
  assert.ok(f.get('invoices', 'unlisted'));
});

test('restore retains the JSON field types and whitespace in the backup', () => {
  assert.deepEqual(backupJsonValue({ mixed: [' 123 ', 123, false, null] }), { mapValue: { fields: {
    mixed: { arrayValue: { values: [{ stringValue: ' 123 ' }, { integerValue: '123' }, { booleanValue: false }, { nullValue: null }] } }
  } } });
});
