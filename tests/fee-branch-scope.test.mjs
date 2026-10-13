import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { feeBranchId, feeRowsForBranch, feeMatchesBranch, feeSetupBranch, scopedFeeDocumentId, resolveFeeDocument, feeDocumentWrite } from '../functions/lib/fee-branch-scope.js';
import { feeMatchesApplication, feeCodeRenameAllowed, getAccountsOverview } from '../functions/api/backend.js';

test('legacy fees belong only to Main; empty branches do not inherit charges', () => {
  const rows = [{ FeeCode: 'OLD' }, { FeeCode: 'GLOBAL-OLD', BranchId: 'all' }, { FeeCode: 'MAIN', BranchId: 'main' }, { FeeCode: 'NORTH', BranchId: 'north' }];
  assert.deepEqual(feeRowsForBranch(rows, 'north').map(row => row.FeeCode), ['NORTH']);
  assert.deepEqual(feeRowsForBranch(rows, 'south'), []);
  assert.equal(feeRowsForBranch(rows, 'Main Branch').length, 3);
  assert.equal(feeRowsForBranch(rows, 'all').length, 4);
  assert.equal(feeMatchesBranch(rows[0], { BranchId: 'north' }), false);
  assert.equal(feeMatchesApplication({ FeeCode: 'F', Amount: 100 }, { BranchId: 'north' }), false);
});

test('fee writes require one branch and respect both verified staff and device scope', () => {
  assert.equal(feeSetupBranch({ BranchId: 'north', UserBranchId: 'all' }), 'north');
  assert.equal(feeSetupBranch({ UserBranchId: 'north' }), 'north');
  assert.equal(feeSetupBranch({ BranchId: 'Main Branch', UserBranchId: 'main' }), 'main');
  for (const body of [{ BranchId: 'south', UserBranchId: 'north' }, { BranchId: 'main', DeviceBranchId: 'north' }]) {
    assert.throws(() => feeSetupBranch(body), error => error.status === 403);
  }
  assert.throws(() => feeSetupBranch({ BranchId: 'all' }), error => error.status === 400);
});

test('Accounts response isolates fee setup for every branch and preserves legacy main records', async () => {
  const fees = [{ FeeCode: 'TUITION', Amount: 100 }, { FeeCode: 'TUITION', BranchId: 'north', Amount: 200 }];
  const inputs = { accounts: [], students: [], applications: [], payments: [], invoices: [], ledger: [], accountSummaries: [], billingCategories: [], schoolProfile: {}, feeItems: fees };
  for (const [branch, expected] of [['main', [100]], ['north', [200]], ['south', []]]) {
    const result = await getAccountsOverview({}, inputs, { BranchId: branch, UserBranchId: 'all' });
    assert.deepEqual(result.feeItems.map(row => row.Amount), expected);
    assert.ok(result.feeItems.every(row => row.BranchId === branch));
  }
  assert.deepEqual(inputs.feeItems, fees);
});

function database(initial = []) {
  const records = new Map(initial.map(row => [row.__id, row]));
  const calls = [];
  const db = {
    getDocument: async (_env, collection, id) => { assert.equal(collection, 'feeItems'); return records.get(id) || null; },
    queryCollection: async (_env, collection, options) => {
      assert.equal(collection, 'feeItems'); assert.equal(options.limit, 101);
      return [...records.values()].filter(row => row.FeeCode === options.filters[0].value || row.feeCode === options.filters[0].value);
    },
    commit: async (_env, writes) => {
      for (const write of writes) {
        const old = records.get(write.documentId);
        assert.equal(write.literalDocumentId, true);
        assert.ok(old ? write.updateTime === old.__updateTime : write.exists === false);
      }
      for (const write of writes) {
        calls.push(write);
        if (write.operation === 'delete') records.delete(write.documentId);
        else records.set(write.documentId, { ...write.data, __id: write.documentId, __updateTime: 'v2' });
      }
    }
  };
  return { records, calls, db };
}

test('identical fee codes in different branches have separate safe storage identities', async () => {
  const { db } = database([{ __id: 'TUITION', FeeCode: 'TUITION', Amount: 100, __updateTime: 'v1' }]);
  const main = await resolveFeeDocument({}, 'main', 'TUITION', db);
  const north = await resolveFeeDocument({}, 'north', 'TUITION', db);
  assert.equal(main.documentId, 'TUITION'); assert.equal(main.existing.Amount, 100);
  assert.equal(north.existing, null); assert.notEqual(north.documentId, main.documentId);
  assert.equal(north.documentId, await scopedFeeDocumentId('north', 'tuition'));
  assert.notEqual(await scopedFeeDocumentId('north', 'A/B'), await scopedFeeDocumentId('north', 'A-B'));
  assert.equal(feeDocumentWrite(north, {}).exists, false);
  assert.equal(feeDocumentWrite(main, {}).updateTime, 'v1');
  assert.throws(() => feeDocumentWrite({ ...main, existing: {} }, {}));
});

test('old imported branch fees retain their IDs; ambiguous records and read failures fail closed', async () => {
  const { db, records } = database([{ __id: 'random-id', FeeCode: 'F', BranchId: 'north', __updateTime: 'v1' }]);
  assert.equal((await resolveFeeDocument({}, 'north', 'F', db)).documentId, 'random-id');
  records.set('duplicate', { __id: 'duplicate', FeeCode: 'F', BranchId: 'north' });
  await assert.rejects(resolveFeeDocument({}, 'north', 'F', db), /Duplicate/);
  await assert.rejects(resolveFeeDocument({}, 'north', 'F', { ...db, getDocument: async () => { throw new Error('offline'); } }), /offline/);
});

test('actual single, bulk, delete and seed actions cannot change Main from another branch', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('async function saveFeeItem('), source.indexOf('export async function queryAccountRows('));
  const main = { __id: 'TUITION', __updateTime: 'v1', FeeCode: 'TUITION', Amount: 100, CreatedAt: 'old' };
  const { records, calls, db } = database([main]);
  const clean = value => String(value ?? '').trim();
  const context = {
    feeSetupBranch, feeBranchId, feeRowsForBranch, feeCodeRenameAllowed, feeDocumentWrite,
    resolveFeeDocument: (env, branch, code) => resolveFeeDocument(env, branch, code, db),
    configuredClassNames: async (_env, scope) => { assert.equal(scope.BranchId, 'north'); return []; },
    canonicalConfiguredClass: value => value, normalizeFeeItem: row => row,
    normalizeFeeBillingCategories: value => value || ['All'], feeBillingCategoryText: values => values.join(', '),
    requireAccountingRole: (body, roles) => { if (!roles.includes(body.UserRole)) throw Object.assign(new Error('role'), { status: 403 }); },
    clean, asMoneyNumber: value => Number(value) || 0, yesNo: value => clean(value).toUpperCase(), nowIso: () => 'now',
    batchCommitDocuments: db.commit,
    loadBranchFinanceRows: async (_env, collection, branch) => { assert.equal(collection, 'feeItems'); return feeRowsForBranch([...records.values()], branch); }
  };
  const actions = vm.runInNewContext(`${block}; ({saveFeeItem, saveFeeItems, deleteFeeItem, seedDefaultFeeItems})`, context);
  const scope = { BranchId: 'north', UserBranchId: 'north', DeviceBranchId: 'north', UserRole: 'Accounts Officer' };
  await actions.saveFeeItem({}, { ...scope, FeeCode: 'TUITION', Amount: 200 });
  const northId = await scopedFeeDocumentId('north', 'TUITION');
  assert.equal(records.get(northId).BranchId, 'north'); assert.equal(records.get(northId).Amount, 200);
  await actions.saveFeeItems({}, { ...scope, Items: [{ FeeCode: 'TUITION', Amount: 300 }, { FeeCode: 'BOOKS', Amount: 25 }] });
  assert.equal(records.get(northId).Amount, 300);
  assert.equal(records.get(northId).CreatedAt, 'now');
  await assert.rejects(actions.saveFeeItems({}, { ...scope, Items: [{ FeeCode: 'F', BranchId: 'main' }] }), error => error.status === 403);
  await assert.rejects(actions.saveFeeItem({}, { ...scope, BranchId: 'main', FeeCode: 'TUITION' }), error => error.status === 403);
  await assert.rejects(actions.saveFeeItem({}, { ...scope, UserRole: 'Teacher', FeeCode: 'TUITION' }), error => error.status === 403);
  await actions.seedDefaultFeeItems({}, scope);
  assert.equal(records.get(northId).Amount, 300);
  assert.ok([...records.values()].some(row => row.BranchId === 'north' && row.FeeCode === 'ACCEPTANCE_FEE'));
  await actions.deleteFeeItem({}, { ...scope, FeeCode: 'TUITION' });
  await assert.rejects(actions.deleteFeeItem({}, { ...scope, FeeCode: 'TUITION' }), error => error.status === 404);
  assert.deepEqual(records.get('TUITION'), main);
  assert.ok(calls.every(write => write.documentId !== 'TUITION'));
});
