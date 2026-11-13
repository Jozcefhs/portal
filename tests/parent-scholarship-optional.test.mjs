import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the full payable loader, retaining its real identity checks and fee
// calculations. Only persistence/configuration boundaries use in-memory data.
const backendUrl = new URL('../functions/api/backend.js', import.meta.url);
const source = await readFile(backendUrl, 'utf8');
const imports = {};
const pattern = /^import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];\r?$/gm;
for (const match of source.matchAll(pattern)) {
  const module = await import(new URL(match[2], backendUrl));
  for (const name of match[1].split(',').map(value => value.trim()).filter(Boolean)) {
    const [original, local = original] = name.split(/\s+as\s+/);
    imports[local] = module[original];
  }
}
const code = source.replace(pattern, '')
  .replace(/^export\s+\{[\s\S]*?\}(?:\s+from\s+['"][^'"]+['"])?;\r?$/gm, '')
  .replace(/^export /gm, '');
const pupil = { __id: 'DEMO-25-001', __scopePath: 'schoolBranches/main/sections/secondary/students',
  AdmissionNo: 'DEMO/25/001', DisplayName: 'Test Learner', ParentEmail: 'parent@example.org',
  BranchId: 'main', SchoolSection: 'secondary', ClassName: 'Grade 9', StudentType: 'Day Student',
  BillingCategory: 'Full Scholarship', AcademicSession: '2026/2027', Term: 'First Term', Status: 'Active' };
const defaults = { Active: 'YES', PayableOnline: 'YES', BillingCategory: 'All', BranchId: 'main',
  SchoolSection: 'secondary', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'First Term',
  Amount: 5000, Currency: 'NGN', AllowInstallment: 'NO' };

test('parent payable loader returns optional services with no school bill or additional writes', async () => {
  const rules = ['Club', 'Bus Service', 'Others', 'Optional', 'Transport', 'School Fee'].map((category, index) => ({
    ...defaults, FeeCategory: category, FeeCode: `ITEM_${index}`, FeeName: `Service ${index}`
  }));
  rules.push(...[
    { FeeCode: 'OTHER_BRANCH', BranchId: 'area-1-primary' },
    { FeeCode: 'OTHER_SECTION', SchoolSection: 'primary' },
    { FeeCode: 'OTHER_CLASS', ClassName: 'Grade 7' },
    { FeeCode: 'OTHER_TERM', Term: 'Second Term' },
    { FeeCode: 'OFFLINE_ONLY', PayableOnline: 'NO' },
    { FeeCode: 'INACTIVE', Active: 'NO' }
  ].map(overrides => ({ ...defaults, FeeCategory: 'Club', FeeName: overrides.FeeCode, ...overrides })));
  const before = JSON.stringify({ pupil, rules });
  const reads = [];
  const rejectWrite = () => { throw Error('Payable loading must not write records'); };
  const run = vm.runInNewContext(`${code}
    getSchoolProfile = async () => ({ profile: {} });
    queryAccountRows = readAccountRows;
    getPayableFees;`, {
    ...imports, URL, Date, crypto,
    fetch: () => { throw Error('Unexpected network request'); },
    getDocument: async (_env, collection) => {
      reads.push(collection); assert.equal(collection, pupil.__scopePath); return structuredClone(pupil);
    },
    loadBranchFinanceRows: async (_env, collection, branch) => {
      reads.push(collection); assert.equal(collection, 'feeItems'); assert.equal(branch, 'main'); return structuredClone(rules);
    },
    readAccountRows: async (_env, collection, reference) => {
      reads.push(collection); assert.equal(reference, pupil.AdmissionNo); return [];
    },
    loadBillingDiscount: async () => null, loadSchoolFeePaymentPlans: async () => [],
    upsertDocument: rejectWrite, patchDocumentFields: rejectWrite, deleteDocument: rejectWrite,
    createDocumentIfAbsent: rejectWrite, batchCommitDocuments: rejectWrite,
    batchCommitLiteralDocuments: rejectWrite, batchUpsertDocuments: rejectWrite
  });
  const body = { AccountRef: pupil.AdmissionNo, SourceType: 'Student', ScopePath: pupil.__scopePath,
    Email: pupil.ParentEmail, AuthenticatedParentEmail: pupil.ParentEmail };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await run({}, body);
    assert.equal(response.ok, true);
    assert.deepEqual(Array.from(response.fees, row => row.FeeCode), ['ITEM_0', 'ITEM_1', 'ITEM_2', 'ITEM_3', 'ITEM_4']);
    assert.ok(response.fees.every(row => row.Amount === 5000 && row.PaidAmount === 0));
    assert.equal(response.schoolFeeTotal, 0);
    assert.equal(response.schoolFeeBreakdown.length, 0);
    assert.equal(response.account.BillingCategory, 'Full Scholarship');
  }
  assert.deepEqual(reads, Array(2).fill([pupil.__scopePath, 'feeItems', 'payments', 'invoices', 'ledger']).flat());
  assert.equal(JSON.stringify({ pupil, rules }), before);
});
