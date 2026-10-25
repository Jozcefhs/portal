import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { assignedStaffBranches } from '../functions/lib/staff-branch-access.js';
import { accountingChartForEdition, accountingChartChoicesForEdition, accountingCodeAllowedForEdition } from '../functions/lib/accounting-edition-scope.js';
import { buildIncomeAnalytics } from '../functions/lib/income-analytics.js';

const source = (await readFile(new URL('../functions/lib/revenue-account-names.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const user = { username: 'treasurer', role: 'Treasurer', branchAccess: 'all', branchId: 'main', allowedSections: ['incomeAnalytics', 'funds'] };
const originals = {
  chartOfAccounts: { 'legacy-account%id': { __id: 'legacy-account%id', __updateTime: 'v1', Code: '4210', Name: 'Building Fund Income', Type: 'Revenue',
    Group: 'Church Revenue', NormalBalance: 'Credit', Active: 'YES', System: 'YES', CreatedAt: '2020-01-01', ExtraField: { retain: true } } },
  accountingJournals: [{ JournalNo: 'J1', Date: '2026-10-24', Status: 'Posted', BranchId: 'main', Currency: 'NGN', Lines: [
    { AccountCode: '1000', Debit: 5000, Credit: 0 }, { AccountCode: '4210', Debit: 0, Credit: 5000 }
  ] }], payments: [{ PaymentId: 'P1', Amount: 5000, RevenueAccountCode: '4210', Status: 'Paid' }],
  givingTypes: [{ GivingTypeId: 'BUILDING-FUND', RevenueAccountCode: '4210', Name: 'Building Fund' }],
  fundMappings: [{ IncomeAccountCode: '4210', DebitAccountCode: '1000' }], accountingAudit: {}
};
function fixture(edition = 'organization') {
  const db = structuredClone(originals), writes = [], reads = [];
  let invalidations = 0, conflict = false;
  const context = vm.createContext({ Date, crypto: webcrypto, assignedStaffBranches, accountingChartForEdition, accountingCodeAllowedForEdition,
    resolveOrganizationConfig: () => ({ Edition: edition, FeatureFlags: { accounting: true } }),
    getDocument: async (_env, collection, id) => { reads.push([collection, id]); return structuredClone(db[collection]?.[id] || null); },
    getAccountingChartRows: async (_env, options) => { assert.equal(options.fresh, true); reads.push(['chartOfAccounts']); return structuredClone(Object.values(db.chartOfAccounts)); },
    invalidateAccountingChartRows: () => invalidations++,
    batchCommitLiteralDocuments: async (_env, batch) => {
      const copy = structuredClone(batch); writes.push(copy);
      // Validate every precondition before applying any writes, like Firestore commit.
      for (const write of copy) {
        const current = db[write.collectionPath]?.[write.documentId];
        if (conflict || write.exists === false && current || write.updateTime && write.updateTime !== current?.__updateTime) {
          throw Object.assign(new Error('Concurrent write'), { status: 412 });
        }
      }
      for (const write of copy) {
        const collection = db[write.collectionPath];
        collection[write.documentId] = write.updateMask
          ? { ...collection[write.documentId], ...Object.fromEntries(write.updateMask.map(key => [key, write.data[key]])), __updateTime: 'v2' }
          : write.data;
      }
      return { writeResults: [{ updateTime: 'v2' }, { updateTime: 'v2' }] };
    }
  });
  vm.runInContext(`${source};globalThis.handle=handleRevenueAccountNames;`, context);
  return { db, writes, reads, run: (body, actor = user) => context.handle({}, actor, body),
    get invalidations() { return invalidations; }, set conflict(value) { conflict = value; } };
}
const rename = { action: 'rename', documentId: 'legacy-account%id', code: '4210', name: 'Community Projects Income', recordVersion: 'v1' };

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: name-only web rename preserves codes, transactions, mappings and revenue totals`, async () => {
    const f = fixture(edition), before = structuredClone(f.db);
    const report = () => buildIncomeAnalytics(Object.values(f.db.chartOfAccounts), f.db.accountingJournals, { dateFrom: '2026-10-01', dateTo: '2026-10-31', period: 'custom', branchId: 'main' });
    const oldTotal = report().summary.totalIncome;
    const listed = await f.run({ action: 'list' });
    assert.equal(listed.accounts.length, 1); assert.equal(f.writes.length, 0);
    const result = await f.run(rename);
    assert.equal(result.account.code, '4210'); assert.equal(result.account.recordVersion, 'v2');
    assert.equal(result.account.name, rename.name); assert.equal(f.invalidations, 1);
    const account = f.db.chartOfAccounts[rename.documentId];
    for (const [key, value] of Object.entries(before.chartOfAccounts[rename.documentId])) {
      if (!['Name', '__updateTime'].includes(key)) assert.deepEqual(account[key], value, key);
    }
    for (const collection of ['payments', 'accountingJournals', 'givingTypes', 'fundMappings']) assert.deepEqual(f.db[collection], before[collection]);
    assert.equal(report().summary.totalIncome, oldTotal); assert.equal(oldTotal, 5000);
    const [batch] = f.writes;
    assert.deepEqual(batch.map(write => write.collectionPath), ['chartOfAccounts', 'accountingAudit']);
    assert.deepEqual(batch[0].updateMask, ['Name', 'NameCustomized', 'UpdatedAt', 'UpdatedBy']);
    assert.equal(batch[0].documentId, rename.documentId); assert.equal(batch[0].updateTime, 'v1');
    const audit = Object.values(f.db.accountingAudit)[0];
    assert.equal(audit.PreviousName, 'Building Fund Income'); assert.equal(audit.NewName, rename.name); assert.equal(audit.ActorUsername, user.username);
    assert.equal((await f.run(rename)).changed, false); assert.equal(f.writes.length, 1, 'Lost-response retry does not add an audit or change records');
    assert.ok(f.reads.every(([collection]) => ['settings', 'chartOfAccounts'].includes(collection)), 'No transaction history scans');
  });
}

test('denies unauthorised, branch-scoped and read-only users before any database reads', async () => {
  for (const override of [{ role: 'Auditor' }, { role: 'Department User' }, { role: 'Management' }, { username: '' }, { allowedSections: [] },
    { branchAccess: 'selected', assignedBranchIds: ['main'] }, { branchAccess: 'selected', assignedBranchIds: ['main', 'north'] },
    { subscriptionReadOnly: true }, { subscriptionActive: false }]) {
    const f = fixture(); await assert.rejects(f.run(rename, { ...user, ...override }), { status: 403 });
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
  for (const role of ['Super Admin', 'Director', 'Accounts Officer', 'Treasurer']) {
    assert.equal((await fixture().run({ action: 'list' }, { ...user, assignedRole: role })).ok, true);
  }
});

test('cannot modify codes, other financial fields, non-revenue accounts or nonexistent accounts', async () => {
  for (const override of [{ code: '9999' }, { Type: 'Asset' }, { Group: 'changed' }, { Active: 'NO' }, { Lines: [] },
    { documentId: '../payment' }, { documentId: 'missing' }, { name: '' }, { name: 'x'.repeat(121) }, { name: 'Bad\nName' }, { name: {} }]) {
    const f = fixture(), before = structuredClone(f.db);
    await assert.rejects(f.run({ ...rename, ...override })); assert.deepEqual(f.db, before); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.db.chartOfAccounts[rename.documentId].Type = 'Asset';
  await assert.rejects(f.run(rename), { status: 403 }); assert.equal(f.writes.length, 0);
  const org = fixture(); org.db.chartOfAccounts[rename.documentId].Code = '4000';
  await assert.rejects(org.run({ ...rename, code: '4000' }), { status: 403 });
});

test('stale edits and simultaneous saves cannot overwrite another rename or leave partial audit entries', async () => {
  const f = fixture(); await f.run(rename);
  await assert.rejects(f.run({ ...rename, name: 'Stale name' }), { status: 409 });
  assert.equal(f.writes.length, 1); assert.equal(f.db.chartOfAccounts[rename.documentId].Name, rename.name);
  const concurrent = fixture(), before = structuredClone(concurrent.db); concurrent.conflict = true;
  await assert.rejects(concurrent.run(rename), { status: 409 }); assert.deepEqual(concurrent.db, before); assert.equal(concurrent.invalidations, 0);
});

test('deliberately customised names are respected even when they match old edition defaults', () => {
  const faithName = { Code: '4160', Name: 'Tithe Income', Type: 'Revenue', NameCustomized: true };
  assert.equal(accountingChartForEdition([faithName], 'organization')[0].Name, faithName.Name);
  const schoolName = { Code: '4040', Name: 'Books and Uniform Revenue', Type: 'Revenue', NameCustomized: true };
  assert.equal(accountingChartChoicesForEdition([schoolName], 'school')[0].Name, schoolName.Name);
});
