import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { studentBillingReviewRoster, studentBillingReviewBatch } from '../functions/lib/student-billing-review.js';
import { studentBillingReconciliationPlan } from '../functions/api/backend.js';

const user = { role: 'Super Admin', edition: 'school', branchId: 'main', schoolSectionAccess: 'All', allowedSections: ['students', 'accounts'] };
const secondaryPath = 'schoolBranches/main/sections/secondary/students';
const primaryPath = 'schoolBranches/main/sections/primary/students';
const profile = (overrides = {}) => ({ __id: 'student', __updateTime: 'revision-1', __scopePath: secondaryPath,
  AdmissionNo: 'TEST/001', DisplayName: 'Test Student', ClassName: 'Grade 7', StudentType: 'Day Student',
  Gender: 'Male', BillingCategory: 'Regular', BranchId: 'main', SchoolSection: 'secondary',
  AcademicSession: '2026/2027', Term: 'First Term', EnrollmentCategory: 'Returning', ProfileCompletionStatus: 'Complete', ...overrides });
const fee = (overrides = {}) => ({ __id: 'tuition', FeeCode: 'TUITION', FeeName: 'Tuition', Amount: 100,
  FeeCategory: 'School Fee', Active: 'YES', PayableOnline: 'YES', ClassName: 'All', StudentType: 'All',
  Gender: 'All', BillingCategory: 'All', AcademicSession: '2026/2027', Term: 'First Term', ...overrides });
const invoice = (overrides = {}) => ({ __id: 'invoice', InvoiceId: 'INV-1', AccountRef: 'TEST/001', BranchId: 'main',
  SchoolSection: 'secondary', FeeCode: 'TUITION', FeeCategory: 'School Fee', Amount: 100,
  AcademicSession: '2026/2027', Term: 'First Term', ...overrides });

function fixture({ students = [profile()], feeItems = [fee()], invoices = [invoice()], summaries = [], schoolProfile = {}, overrides = {} } = {}) {
  const calls = [];
  const deps = {
    schoolCollectionPaths: async () => ['students', primaryPath, secondaryPath],
    getDocument: async (_env, collection, id) => { assert.equal(collection, 'settings'); assert.equal(id, 'schoolProfile'); return schoolProfile; },
    listCollectionForReport: async (_env, path) => {
      calls.push({ type: 'list', path });
      assert.ok(['students', primaryPath, secondaryPath, 'feeItems'].includes(path), 'no full-school financial scans');
      return path === 'feeItems' ? feeItems : students.filter((row) => row.__scopePath === path);
    },
    querySchoolCollection: async (_env, collection, options) => {
      calls.push({ type: 'students', options });
      assert.equal(collection, 'students');
      assert.deepEqual(options.scope, { branchId: 'main', schoolSectionAccess: 'All' });
      const filter = options.filters[0];
      return students.filter((row) => filter.value.includes(row[filter.field]));
    },
    queryCollectionPages: async (_env, collection, options) => {
      calls.push({ type: collection, options });
      assert.ok(['invoices', 'accountSummaries'].includes(collection));
      assert.equal(options.filters.length, 1);
      assert.equal(options.filters[0].op, 'in');
      assert.ok(options.filters[0].value.length <= 10);
      assert.equal(options.pageSize, 250);
      assert.equal(options.maxRows, 2000);
      const filter = options.filters[0];
      return (collection === 'invoices' ? invoices : summaries).filter((row) => filter.value.includes(row[filter.field]));
    }, ...overrides
  };
  return { calls, deps, students, feeItems, invoices, summaries };
}
async function batch(f, profiles, actor = user, token) {
  const roster = await studentBillingReviewRoster({}, actor, f.deps);
  return studentBillingReviewBatch({}, actor, { Profiles: profiles || roster.pendingProfiles, ConfigurationToken: token || roster.configurationToken }, f.deps);
}

test('roster resolves legacy/scoped copies and excludes other branches or incomplete profiles without any financial reads', async () => {
  const f = fixture({ students: [profile(), profile({ __scopePath: 'students', __updateTime: 'old', ProfileCompletionStatus: 'Needs completion' }),
    profile({ AdmissionNo: 'TEST/002', __id: 'two', ProfileCompletionStatus: 'Needs completion' }),
    profile({ AdmissionNo: 'OTHER/001', __scopePath: 'students', BranchId: 'annex' })] });
  const roster = await studentBillingReviewRoster({}, user, f.deps);
  assert.equal(roster.total, 2);
  assert.equal(roster.incomplete, 1);
  assert.deepEqual(roster.pendingProfiles, [{ AccountRef: 'TEST/001', revision: 'revision-1' }]);
  assert.ok(f.calls.every((row) => row.type === 'list'));
  assert.equal(roster.readOnly, true);
});

test('same admission number across primary/secondary is flagged, not silently reconciled', async () => {
  const f = fixture({ students: [profile(), profile({ __scopePath: primaryPath, SchoolSection: 'primary', ClassName: 'Primary 1' })] });
  const roster = await studentBillingReviewRoster({}, user, f.deps);
  assert.equal(roster.total, 2);
  assert.equal(roster.pendingProfiles.length, 0);
  assert.equal(roster.review, 2);
  assert.ok(roster.rows.every((row) => !row.ready && /Ambiguous/.test(row.reason)));
});

test('primary-only roster does not expose secondary profiles', async () => {
  const f = fixture({ students: [profile(), profile({ __scopePath: primaryPath, AdmissionNo: 'PRIMARY/1', SchoolSection: 'primary', ClassName: 'Primary 1' })] });
  const roster = await studentBillingReviewRoster({}, { ...user, schoolSectionAccess: 'primary' }, f.deps);
  assert.equal(roster.total, 1);
  assert.equal(roster.pendingProfiles[0].AccountRef, 'PRIMARY/1');
});

test('billing batches query only requested identities, deduplicate aliases, and keep other branches/sections out', async () => {
  const f = fixture({ invoices: [invoice(), invoice({ __id: 'annex', BranchId: 'annex' }),
    invoice({ __id: 'primary', SchoolSection: 'primary' }), invoice({ __id: 'sibling', AccountRef: 'OTHER/001', AdmissionNo: 'TEST/001' }),
    invoice({ __id: 'alias', InvoiceId: 'INV-ALIAS', AccountRef: '', accountRef: 'TEST/001', FeeCode: 'BOOK', Amount: 20 })],
    overrides: { studentBillingReconciliationPlan: async (student, data) => {
      assert.equal(student.AccountRef, 'TEST/001');
      assert.deepEqual(data.invoices.map((row) => row.__id), ['invoice', 'alias']);
      assert.deepEqual(data.payments, []);
      assert.deepEqual(data.ledger, []);
      return { profile: { AccountRef: student.AccountRef }, ready: false, rows: [{ difference: -20, invoiceIds: ['INV-1'] }] };
    } } });
  const result = await batch(f);
  assert.equal(result.checked, 1);
  assert.equal(result.review, 1);
  assert.equal(f.calls.filter((row) => row.type === 'invoices').length, 6);
  assert.ok(f.calls.filter((row) => row.options?.filters && row.type !== 'students').every((row) => row.options.filters[0].value[0] === 'TEST/001'));
});

test('batch preview uses the existing fee rules and produces the same guarded token as the individual preview', async () => {
  const f = fixture({ feeItems: [fee(), fee({ __id: 'books', FeeCode: 'BOOK', Amount: 20 })] });
  const result = await batch(f);
  const expected = await studentBillingReconciliationPlan(profile(), { schoolProfile: {}, feeItems: f.feeItems, invoices: f.invoices, payments: [], ledger: [], accountSummaries: [] });
  assert.equal(result.ready, 1);
  assert.equal(result.rows[0].difference, 20);
  assert.equal(result.rows[0].previewToken, expected.previewToken);
});

test('full scholarship still follows the existing exemption rule in batch reviews', async () => {
  const f = fixture({ students: [profile({ BillingCategory: 'Full scholarship' })], invoices: [] });
  const result = await batch(f);
  assert.equal(result.matched, 1);
  assert.equal(result.rows.length, 0);
});

test('invalid, duplicate or oversized batches fail before any database read', async () => {
  const f = fixture();
  for (const Profiles of [[], [{ AccountRef: '' }], [{ AccountRef: 'TEST/1', revision: '' }, { AccountRef: 'test/1', revision: '' }],
    Array.from({ length: 11 }, (_, index) => ({ AccountRef: `TEST/${index}`, revision: 'rev' }))]) {
    await assert.rejects(studentBillingReviewBatch({}, user, { Profiles }, f.deps), (error) => error.status === 400);
  }
  assert.equal(f.calls.length, 0);
});

test('profile, scope or fee configuration changes stop the batch before loading finances', async () => {
  const f = fixture();
  const initial = await studentBillingReviewRoster({}, user, f.deps);
  for (const body of [
    { Profiles: [{ AccountRef: 'MISSING/001', revision: 'revision-1' }], ConfigurationToken: initial.configurationToken },
    { Profiles: [{ AccountRef: 'TEST/001', revision: 'outdated' }], ConfigurationToken: initial.configurationToken },
    { Profiles: initial.pendingProfiles, ConfigurationToken: 'old-settings' }
  ]) await assert.rejects(studentBillingReviewBatch({}, user, body, f.deps), (error) => error.status === 409);
  assert.ok(f.calls.every((row) => !['invoices', 'accountSummaries'].includes(row.type)));
});

test('a failed bounded financial query fails the whole batch, never returns partial counts', async () => {
  const f = fixture({ overrides: { queryCollectionPages: async () => { throw new Error('Read limit reached; no partial totals.'); } } });
  await assert.rejects(batch(f), /no partial totals/);
});

test('unchanged configuration fingerprint is stable across object and document ordering', async () => {
  const original = fixture({ schoolProfile: { CurrentTerm: 'First Term', Names: { family: 'last', given: 'first' } },
    feeItems: [fee(), fee({ __id: 'books', FeeCode: 'BOOK', Amount: 20 })] });
  const reversed = fixture({ schoolProfile: { Names: { given: 'first', family: 'last' }, CurrentTerm: 'First Term' },
    feeItems: original.feeItems.toReversed().map((row) => Object.fromEntries(Object.entries(row).toReversed())) });
  const first = await studentBillingReviewRoster({}, user, original.deps);
  const second = await studentBillingReviewRoster({}, user, reversed.deps);
  assert.equal(first.configurationToken, second.configurationToken);
});

test('overflowing targeted student queries cannot hide ambiguous profile copies', async () => {
  const f = fixture({ overrides: { querySchoolCollection: async () => Array.from({ length: 21 }, (_, index) => profile({ __id: `copy-${index}` })) } });
  await assert.rejects(batch(f), /Too many copies/);
  assert.ok(f.calls.every((row) => !['invoices', 'accountSummaries'].includes(row.type)));
});

test('preview route retains school-only, branch and finance authority across all three editions', async () => {
  const source = await readFile(new URL('../functions/api/student-billing-reconciliation.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('const clean')).replace('export async function', 'async function');
  for (const actor of [{ ...user, edition: 'church' }, { ...user, edition: 'organisation' },
    { ...user, role: 'Accounts Officer' }, { ...user, branchId: '' }, { ...user, allowedSections: ['students'] }]) {
    let calls = 0;
    const handler = vm.runInNewContext(`${body}; onRequestPost`, { Response,
      requireFirestoreEnv: () => {}, requireStaffSession: async () => actor,
      readJsonBody: async () => ({ action: 'previewAll', paged: true }),
      studentBillingReviewRoster: async () => { calls += 1; return { ok: true }; }
    });
    const response = await handler({ request: {}, env: {} });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  }
  assert.doesNotMatch(source, /listCollectionForReport\(env, '(?:invoices|accountSummaries)'\)/);
});

test('an older cached client gets an explicit refresh instruction rather than a false empty billing report', async () => {
  const source = await readFile(new URL('../functions/api/student-billing-reconciliation.js', import.meta.url), 'utf8');
  const handler = vm.runInNewContext(`${source.slice(source.indexOf('const clean')).replace('export async function', 'async function')}; onRequestPost`, {
    Response, requireFirestoreEnv: () => {}, requireStaffSession: async () => user,
    readJsonBody: async () => ({ action: 'previewAll' })
  });
  const response = await handler({ request: {}, env: {} });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /Refresh Students/);
});
