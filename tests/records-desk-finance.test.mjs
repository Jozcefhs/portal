import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadRecordsDeskStudentFinance, recordsDeskFinanceQueries } from '../functions/lib/records-desk-finance.js';
import * as records from '../functions/lib/records-desk.js';
import { schoolSectionFor } from '../functions/lib/school-scope.js';
import { effectiveInvoiceAfterReversal } from '../functions/lib/invoice-charge-reversal.js';

const student = { AdmissionNo: 'DCA/25/0131', AccountRef: 'DCA/25/0131', __id: 'DCA-25-0131',
  ApplicationReference: 'APP-1', DisplayName: 'Test Student', BranchId: 'main', SchoolSection: 'secondary' };
const capabilities = { canViewStudentFinance: true, canViewStudentWallet: true };
const source = await readFile(new URL('../functions/api/staff-records.js', import.meta.url), 'utf8');

test('student finance queries target only selected references and fit Firestore OR limits', () => {
  const queries = recordsDeskFinanceQueries(student);
  assert.ok(queries.length > 0 && queries.length <= 4);
  for (const options of queries) {
    assert.equal(options.filterJoin, 'OR');
    assert.ok(options.filters.length <= 30);
    assert.equal(options.pageSize, 1000);
    assert.equal(options.maxRows, 2000);
    assert.ok(options.filters.every(filter => filter.op === '==' && filter.value));
  }
  const filters = queries.flatMap(query => query.filters);
  assert.ok(filters.some(filter => filter.field === 'AccountRefNormalized' && filter.value === 'dca250131'));
  assert.ok(filters.some(filter => filter.field === 'accountRef' && filter.value === 'dca/25/0131'));
  assert.ok(filters.some(filter => filter.field === 'StudentRef' && filter.value === 'DCA-25-0131'));
  assert.ok(filters.some(filter => filter.field === 'ApplicationReference' && filter.value === 'APP-1'));
  assert.deepEqual(recordsDeskFinanceQueries({}), []);
});

test('targeted paginated reads deduplicate overlapping aliases without a whole-school scan', async () => {
  const calls = [];
  const row = { __name: 'documents/invoices/one', AccountRef: student.AdmissionNo, Amount: 100 };
  const result = await loadRecordsDeskStudentFinance({}, student, capabilities, {
    queryRows: async (_env, collection, options) => { calls.push({ collection, options }); return [row]; }
  });
  assert.equal(result.invoices.length, 1);
  assert.equal(result.payments.length, 1);
  assert.equal(result.ledger.length, 1);
  assert.equal(calls.length, recordsDeskFinanceQueries(student).length * 3);
  assert.ok(calls.every(call => call.options.filters.length));
});

test('edition and role permissions still gate every finance collection', async () => {
  for (const edition of ['school', 'faith', 'organization']) {
    const calls = [];
    const permissions = records.recordsDeskCapabilities({ edition, role: 'Front Desk', allowedSections: ['recordsDesk'] });
    const result = await loadRecordsDeskStudentFinance({}, student, permissions, {
      queryRows: async (_env, collection) => { calls.push(collection); return []; }
    });
    assert.equal(calls.length, 0);
    assert.equal(result.invoices.length, 0);
  }
  const calls = [];
  await loadRecordsDeskStudentFinance({}, student, { canViewStudentWallet: true }, {
    queryRows: async (_env, collection) => { calls.push(collection); return []; }
  });
  assert.deepEqual([...new Set(calls)], ['ledger']);
});

test('a failed page or query never yields partial financial totals', async () => {
  let calls = 0;
  await assert.rejects(loadRecordsDeskStudentFinance({}, student, capabilities, {
    queryRows: async () => {
      if (++calls > 3) throw new Error('read failed');
      return [{ __id: 'one', Amount: 100 }];
    }
  }), /read failed/);
  await assert.rejects(loadRecordsDeskStudentFinance({}, student, capabilities, {
    queryRows: async () => Array.from({ length: 2001 }, (_, index) => ({ __id: String(index) }))
  }), /no partial totals/);
});

function detailHandler(overrides = {}) {
  const { studentDetail } = vm.runInNewContext(source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '')
    .replace(/^export /gm, '') + '\n({ studentDetail })', {
    ...records, schoolSectionFor, effectiveInvoiceAfterReversal,
    console: { warn: () => {} },
    loadRecordsDeskStudentFinance: async () => ({ payments: [], invoices: [], ledger: [] }),
    listCollection: async () => [], listSchoolCollection: async () => [],
    ...overrides
  });
  return studentDetail;
}
const user = { edition: 'school', role: 'Super Admin', username: 'admin', biometricLookupEnabled: true,
  allowedSections: ['recordsDesk', 'students', 'accounts'] };

test('finance failure leaves the permitted student profile and face-enrollment action accessible', async () => {
  const detail = await detailHandler({ loadRecordsDeskStudentFinance: async () => { throw new Error('invoice query failed'); } })
    ({}, user, student, records.recordsDeskCapabilities(user));
  assert.equal(detail.id, student.AdmissionNo);
  assert.ok(detail.actions.some(action => action.id === 'student-face-enroll'));
  assert.ok(detail.sections.some(section => section.key === 'finance-unavailable'));
  assert.equal(detail.metrics.length, 0, 'unavailable finance must never look like zero balances');
  assert.equal(detail.activities.length, 0);
});

test('queried rows remain isolated by student, branch and section before totals are rendered', async () => {
  const invoice = { __id: 'ours', AccountRefNormalized: 'dca250131', BranchId: 'main', SchoolSection: 'secondary', Amount: 100, Balance: 100 };
  const invoices = [invoice,
    { ...invoice, __id: 'other-branch', BranchId: 'annex', Amount: 900 },
    { ...invoice, __id: 'camel-branch', BranchId: '', branchId: 'annex', Amount: 900 },
    { ...invoice, __id: 'other-section', SchoolSection: 'primary', Amount: 900 },
    { ...invoice, __id: 'other-student', AccountRefNormalized: 'dca250132', Amount: 900 },
    { ...invoice, __id: 'unscoped', BranchId: '', SchoolSection: '', Amount: 900 }];
  const detail = await detailHandler({ loadRecordsDeskStudentFinance: async () => ({ payments: [], invoices, ledger: [] }) })
    ({}, user, student, records.recordsDeskCapabilities(user));
  assert.equal(detail.metrics.find(metric => metric.label === 'Invoiced').value, 100);
  assert.equal(detail.metrics.find(metric => metric.label === 'Outstanding').value, 100);
  assert.ok(!detail.sections.some(section => section.key === 'finance-unavailable'));
});
