import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollTaxPhase2MigrationPlan, migratePayrollTaxPhase2, PAYROLL_TAX_COLLECTIONS } from '../../functions/lib/payroll/tax-config-service.js';

function fixture() {
  return {
    markers: [],
    profiles: [{
      __id: 'EMP-1', __updateTime: 'v1', EmployeeId: 'EMP-1', Username: 'peter', BasicSalary: 100000,
      TaxRate: 5, PensionRate: 8,
      Allowances: [{ Name: 'Housing', Amount: 25000 }],
      Deductions: [{ Name: 'Union Due', Amount: 1500 }]
    }],
    runs: [{ __id: 'PAY-202601', __updateTime: 'v2', RunId: 'PAY-202601', TotalGross: 125000, TotalDeductions: 17750, TotalNet: 107250 }],
    items: [{ __id: 'PAY-202601-EMP-1', __updateTime: 'v3', ItemId: 'PAY-202601-EMP-1', GrossPay: 125000, TaxAmount: 6250, NetPay: 107250 }],
    existingComponents: [], existingTaxProfiles: []
  };
}

test('migration dry-run plans additive writes without requiring a backup', () => {
  const plan = buildPayrollTaxPhase2MigrationPlan(fixture(), { Apply: 'NO' });
  assert.equal(plan.report.Apply, false);
  assert.ok(plan.report.DocumentsPlanned > 0);
  assert.equal(plan.report.PayrollProfiles, 1);
  assert.equal(plan.report.LegacyItemsToMark, 1);
});

test('migration apply requires a verified backup reference', () => {
  assert.throws(
    () => buildPayrollTaxPhase2MigrationPlan(fixture(), { Apply: 'YES' }),
    (error) => error.code === 'PAYROLL_BACKUP_REQUIRED' && error.status === 409
  );
});

test('migration preserves historical amounts and adds legacy trace markers', () => {
  const source = fixture();
  const plan = buildPayrollTaxPhase2MigrationPlan(source, { Apply: 'YES', BackupReference: 'backup-2026-07-22.zip', RecordedBy: 'Admin' });
  const runWrite = plan.writes.find((write) => write.collectionPath === 'payrollRuns');
  const itemWrite = plan.writes.find((write) => write.collectionPath === 'payrollItems');
  const run = { ...source.runs[0], ...runWrite.data };
  const item = { ...source.items[0], ...itemWrite.data };
  assert.equal(runWrite.updateTime, 'v2'); assert.equal(itemWrite.updateTime, 'v3');
  assert.deepEqual(runWrite.updateMask, Object.keys(runWrite.data));
  assert.equal(runWrite.data.TotalGross, undefined); assert.equal(itemWrite.data.NetPay, undefined);
  assert.equal(run.TotalGross, 125000);
  assert.equal(run.TotalDeductions, 17750);
  assert.equal(run.TotalNet, 107250);
  assert.equal(item.GrossPay, 125000);
  assert.equal(item.TaxAmount, 6250);
  assert.equal(item.NetPay, 107250);
  assert.equal(item.TaxTraceStatus, 'LEGACY_UNAVAILABLE');
  assert.equal(item.LegacyTaxAmount, 6250);
  assert.equal(plan.marker.BackupReference, 'backup-2026-07-22.zip');
});

test('migration is idempotent after its marker exists', () => {
  const input = fixture();
  input.markers = [{ __id: 'PAYE-PHASE2-V1', MigrationId: 'PAYE-PHASE2-V1', Status: 'APPLIED' }];
  const plan = buildPayrollTaxPhase2MigrationPlan(input, { Apply: 'YES', BackupReference: 'backup.zip' });
  assert.equal(plan.alreadyApplied, true);
  assert.deepEqual(plan.writes, []);
});

test('existing tax profiles are never overwritten by migration seeds', () => {
  const input = fixture();
  input.existingTaxProfiles = [{ __id: 'CUSTOM-V1', ProfileId: 'CUSTOM-V1', Name: 'School Verified Rules' }];
  const plan = buildPayrollTaxPhase2MigrationPlan(input, { Apply: 'YES', BackupReference: 'backup.zip' });
  assert.equal(plan.writes.some((write) => write.collectionPath === 'payrollTaxProfiles'), false);
});

function migrationStore(input = fixture()) {
  const collections = { markers: PAYROLL_TAX_COLLECTIONS.migrations, profiles: 'payrollProfiles', runs: 'payrollRuns', items: 'payrollItems', existingComponents: PAYROLL_TAX_COLLECTIONS.components, existingTaxProfiles: PAYROLL_TAX_COLLECTIONS.profiles };
  const documents = new Map(); const commits = []; const hooks = {}; let version = 10;
  const put = (collection, id, data) => documents.set(`${collection}/${id}`, { ...structuredClone(data), __id: id, __updateTime: `v${++version}` });
  for (const [key, collection] of Object.entries(collections)) for (const row of input[key] || []) put(collection, row.__id, row);
  const rows = collection => [...documents].filter(([key]) => key.startsWith(`${collection}/`)).map(([, data]) => structuredClone(data));
  const get = (collection, id) => structuredClone(documents.get(`${collection}/${id}`));
  const db = {
    listCollection: async (_env, collection) => { if (hooks.failRead === collection) throw new Error('Read failed'); return rows(collection); },
    batchCommitLiteralDocuments: async (_env, writes) => {
      if (hooks.beforeCommit) await hooks.beforeCommit(writes);
      for (const write of writes) {
        const current = get(write.collectionPath, write.documentId);
        if (write.exists === false && current || write.updateTime && current?.__updateTime !== write.updateTime) throw Object.assign(new Error('Concurrent modification'), { status: 409 });
      }
      for (const write of writes) {
        const current = get(write.collectionPath, write.documentId);
        put(write.collectionPath, write.documentId, write.updateMask ? { ...current, ...write.data } : write.data);
      }
      commits.push(structuredClone(writes));
    }
  };
  return { put, get, rows, commits, hooks, db };
}

const apply = { Apply: 'YES', BackupReference: 'verified-backup.zip', RecordedBy: 'Admin' };

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: migration cannot replace concurrent payroll payments, lifecycle state or profile edits`, async () => {
    const f = migrationStore(); let changed = false;
    f.hooks.beforeCommit = writes => {
      if (!changed && writes.some(write => write.collectionPath === 'payrollRuns')) {
        changed = true;
        f.put('payrollRuns', 'PAY-202601', { ...f.get('payrollRuns', 'PAY-202601'), Status: 'Paid', PaidAmount: 107250, FinalizedAt: '2026-10-11T12:00:00Z' });
        f.put('payrollItems', 'PAY-202601-EMP-1', { ...f.get('payrollItems', 'PAY-202601-EMP-1'), PaidAmount: 107250, PaymentStatus: 'Paid' });
        f.put('payrollProfiles', 'EMP-1', { ...f.get('payrollProfiles', 'EMP-1'), BasicSalary: 150000, BankAccountNumber: 'updated-bank' });
      }
    };
    await assert.rejects(migratePayrollTaxPhase2({ ORGANISATION_EDITION: edition }, apply, f.db), /Concurrent modification/);
    assert.equal(f.rows(PAYROLL_TAX_COLLECTIONS.migrations).length, 0);
    assert.equal(f.get('payrollRuns', 'PAY-202601').Status, 'Paid'); assert.equal(f.get('payrollItems', 'PAY-202601-EMP-1').PaidAmount, 107250);
    const result = await migratePayrollTaxPhase2({ ORGANISATION_EDITION: edition }, apply, f.db);
    assert.equal(result.ok, true);
    assert.equal(f.get('payrollRuns', 'PAY-202601').Status, 'Paid'); assert.equal(f.get('payrollRuns', 'PAY-202601').PaidAmount, 107250);
    assert.equal(f.get('payrollItems', 'PAY-202601-EMP-1').PaymentStatus, 'Paid'); assert.equal(f.get('payrollItems', 'PAY-202601-EMP-1').PaidAmount, 107250);
    assert.equal(f.get('payrollProfiles', 'EMP-1').BasicSalary, 150000); assert.equal(f.get('payrollProfiles', 'EMP-1').BankAccountNumber, 'updated-bank');
    assert.equal(f.get('payrollProfiles', 'EMP-1').ComponentAssignments[0].Amount, 150000);
    assert.equal(f.commits.at(-1)[0].collectionPath, PAYROLL_TAX_COLLECTIONS.migrations);
    const committed = f.commits.length; await migratePayrollTaxPhase2({}, apply, f.db); assert.equal(f.commits.length, committed);
  });
}

test('migration read failures never write metadata, defaults or an applied marker', async () => {
  for (const collection of ['payrollProfiles', 'payrollRuns', 'payrollItems', PAYROLL_TAX_COLLECTIONS.migrations, PAYROLL_TAX_COLLECTIONS.components, PAYROLL_TAX_COLLECTIONS.profiles]) {
    const f = migrationStore(); f.hooks.failRead = collection;
    await assert.rejects(migratePayrollTaxPhase2({}, apply, f.db), /Read failed/);
    assert.equal(f.commits.length, 0);
  }
});

test('migration guarded chunks resume after interruption without reverting completed records', async () => {
  const input = fixture(); input.profiles = []; input.runs = [];
  input.items = Array.from({ length: 501 }, (_, index) => ({ __id: `ITEM-${index}`, ItemId: `ITEM-${index}`, NetPay: 100, PaidAmount: 10, Status: 'Part Paid' }));
  const f = migrationStore(input); let chunks = 0;
  f.hooks.beforeCommit = writes => { if (writes.some(write => write.collectionPath === 'payrollItems') && ++chunks === 2) throw new Error('Interrupted chunk'); };
  await assert.rejects(migratePayrollTaxPhase2({}, apply, f.db), /Interrupted chunk/);
  assert.ok(f.rows('payrollItems').some(row => row.CalculationVersion)); assert.ok(f.rows('payrollItems').some(row => !row.CalculationVersion));
  assert.equal(f.rows(PAYROLL_TAX_COLLECTIONS.migrations).length, 0);
  f.put('payrollItems', 'ITEM-0', { ...f.get('payrollItems', 'ITEM-0'), PaidAmount: 100, Status: 'Paid' });
  f.hooks.beforeCommit = null; await migratePayrollTaxPhase2({}, apply, f.db);
  assert.equal(f.rows('payrollItems').filter(row => row.CalculationVersion).length, 501);
  assert.equal(f.get('payrollItems', 'ITEM-0').PaidAmount, 100); assert.equal(f.get('payrollItems', 'ITEM-0').Status, 'Paid');
  assert.ok(f.commits.every(writes => writes.length <= 450));
  const seedBatch = f.commits.find(writes => writes.some(write => write.collectionPath === PAYROLL_TAX_COLLECTIONS.profiles));
  assert.ok(seedBatch.some(write => write.collectionPath === PAYROLL_TAX_COLLECTIONS.bands));
  assert.ok(seedBatch.some(write => write.collectionPath === PAYROLL_TAX_COLLECTIONS.reliefs));
});

test('migration preserves custom salary components and requires source versions before apply', () => {
  const input = fixture(); input.existingComponents = [{ __id: 'COMP-BASIC', ComponentId: 'COMP-BASIC', Formula: 'Basic * 2', CalculationType: 'formula' }];
  const plan = buildPayrollTaxPhase2MigrationPlan(input, apply);
  assert.equal(plan.writes.some(write => write.documentId === 'COMP-BASIC'), false);
  delete input.items[0].__updateTime;
  assert.throws(() => buildPayrollTaxPhase2MigrationPlan(input, apply), error => error.code === 'PAYROLL_MIGRATION_STALE_DATA');
  assert.doesNotThrow(() => buildPayrollTaxPhase2MigrationPlan(input, { Apply: 'NO' }));
});
