import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { canonicalConfiguredClassRule } from '../functions/lib/class-names.js';
import { feeMatchesApplication, normalizeFeeItem, feeCodeRenameAllowed } from '../functions/api/backend.js';
import { feeSetupBranch, feeBranchId, feeDocumentWrite } from '../functions/lib/fee-branch-scope.js';

const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('async function saveFeeItem('), source.indexOf('async function deleteFeeItem('));
const configured = [1, 2, 3, 4, 5, 6].map(number => `Grade ${number}`);
const branch = 'area-1-primary';
const clean = value => String(value ?? '').trim();
const terms = ['First Term', 'Second Term', 'Third Term'];
const codes = terms.map(term => `TUITION123_GRADE_3_TO_GRADE_6_${term.replaceAll(' ', '_').toUpperCase()}`);
const fee = (index, extra = {}) => ({ BranchId: branch, FeeCode: codes[index], FeeName: 'Tuition', FeeCategory: 'School Fee',
  ClassName: 'Grade 3', Amount: [123000, 321000, 432000][index], AcademicSession: '2026/2027', Term: terms[index],
  StudentType: 'All', BillingCategory: 'All', Gender: 'All', Active: 'YES', ...extra });
const student = (grade, term = 'First Term', selectedBranch = branch) => ({ BranchId: selectedBranch, SchoolSection: 'primary',
  ClassName: `Grade ${grade}`, StudentType: 'Day Student', BillingCategory: 'Regular', Gender: 'Male', AcademicSession: '2026/2027', Term: term });

function fixture() {
  const records = new Map(codes.map((code, index) => [code, { ...fee(index), __id: `saved-id-${index}`, __updateTime: `v${index}`,
    CreatedAt: 'original-created', HistoricalCustomField: 'preserve' }]));
  const commits = [], reads = [];
  const invoices = [{ InvoiceId: 'KEEP-INVOICE', Amount: 123000, PaidAmount: 100000 }];
  const payments = [{ PaymentId: 'KEEP-PAYMENT', Amount: 100000 }];
  let version = 10;
  const actions = vm.runInNewContext(`${block}; ({saveFeeItem, saveFeeItems})`, {
    feeSetupBranch, feeBranchId, feeDocumentWrite, feeCodeRenameAllowed, canonicalConfiguredClassRule, normalizeFeeItem,
    requireAccountingRole: () => {}, clean, asMoneyNumber: value => Number(value) || 0, yesNo: value => clean(value).toUpperCase(), nowIso: () => 'new-time',
    normalizeFeeBillingCategories: value => Array.isArray(value) ? value : [value || 'All'], feeBillingCategoryText: values => values.join(', '),
    configuredClassNames: async (_env, options) => { reads.push(options); return configured; },
    resolveFeeDocument: async (_env, selectedBranch, code) => {
      assert.equal(selectedBranch, branch);
      const existing = records.get(code);
      return { existing: existing ? structuredClone(existing) : null, documentId: existing?.__id || `new-${code}` };
    },
    batchCommitDocuments: async (_env, writes) => {
      for (const write of writes) {
        assert.equal(write.collectionPath, 'feeItems');
        const existing = records.get(write.data.FeeCode);
        assert.ok(existing ? write.documentId === existing.__id && write.updateTime === existing.__updateTime : write.exists === false);
      }
      commits.push(structuredClone(writes));
      for (const write of writes) records.set(write.data.FeeCode, { ...structuredClone(write.data), __id: write.documentId, __updateTime: `v${++version}` });
    }
  });
  return { actions, records, commits, reads, invoices, payments };
}

test('fee rule canonicalization preserves every CSV or array selection and singleton aliases', () => {
  assert.equal(canonicalConfiguredClassRule('Grade 3, Grade 4, Grade 5, Grade 6', configured), 'Grade 3, Grade 4, Grade 5, Grade 6');
  assert.equal(canonicalConfiguredClassRule(['primary 3', 'grade 4', 'Grade 6', 'PRIMARY 3'], configured), 'Grade 3, Grade 4, Grade 6');
  assert.equal(canonicalConfiguredClassRule('primary three', configured), 'Grade 3');
  assert.equal(canonicalConfiguredClassRule('', configured), 'All');
  assert.equal(canonicalConfiguredClassRule('*', configured), 'All');
  assert.throws(() => canonicalConfiguredClassRule('All, Grade 3', configured), /not both/);
  for (const range of ['Grade 3 to Grade 6', 'Grade 3-6', 'Grade 3 – Grade 6', 'Grade 3 & Grade 6', 'Grade three to six', 'Grade 3 and Grade 6', 'Grade three through six', 'Grade three-six', 'Grade 3 / Grade 6', 'Grade 3 + Grade 6']) {
    assert.throws(() => canonicalConfiguredClassRule(range, configured), /Class ranges are not supported/);
  }
  assert.throws(() => canonicalConfiguredClassRule('Grade 3 to Grade 6', [...configured, 'Grade 3 to Grade 6']), /Class ranges are not supported/, 'a catalogue label cannot bypass fee matcher range validation');
  assert.throws(() => canonicalConfiguredClassRule('Grade 3 & Grade 6', [...configured, 'Grade 3 & Grade 6']), /comma-separated class names/);
});

test('actual bulk save retains all four selected grades in every term, original IDs and financial records', async () => {
  const f = fixture(), beforeInvoices = structuredClone(f.invoices), beforePayments = structuredClone(f.payments);
  const Items = terms.map((_term, index) => fee(index, { ClassName: 'Grade 3, Grade 4, Grade 5, Grade 6' }));
  const result = await f.actions.saveFeeItems({}, { BranchId: branch, Items });
  assert.equal(result.saved, 3); assert.equal(f.records.size, 3); assert.equal(f.commits.length, 1);
  for (let index = 0; index < codes.length; index += 1) {
    const saved = f.records.get(codes[index]);
    assert.equal(saved.ClassName, 'Grade 3, Grade 4, Grade 5, Grade 6');
    assert.equal(saved.__id, `saved-id-${index}`); assert.equal(saved.CreatedAt, 'original-created');
    assert.equal(saved.HistoricalCustomField, 'preserve'); assert.equal(saved.Amount, [123000, 321000, 432000][index]);
    for (const grade of [3, 4, 5, 6]) assert.equal(feeMatchesApplication(saved, student(grade, terms[index])), true, `${grade}/${terms[index]}`);
    for (const grade of [1, 2, 7]) assert.equal(feeMatchesApplication(saved, student(grade, terms[index])), false);
    assert.equal(feeMatchesApplication(saved, student(3, terms[(index + 1) % 3])), false);
    assert.equal(feeMatchesApplication(saved, student(3, terms[index], 'main')), false);
  }
  assert.deepEqual(f.invoices, beforeInvoices); assert.deepEqual(f.payments, beforePayments);
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].IncludeArms, false);
  await f.actions.saveFeeItems({}, { BranchId: branch, Items });
  assert.equal(f.records.size, 3, 'retry updates the same fee documents without duplicating them');
});

test('single save accepts explicit selected-class array and subsequent single-class edit replaces the selection', async () => {
  const f = fixture();
  await f.actions.saveFeeItem({}, { ...fee(0), ClassNames: ['Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'] });
  let saved = f.records.get(codes[0]);
  assert.equal(saved.ClassName, 'Grade 3, Grade 4, Grade 5, Grade 6');
  assert.equal(saved.ClassNames, undefined, 'persist one compatible class rule, without a competing array field');
  await f.actions.saveFeeItem({}, { ...fee(0), ClassName: 'Primary 4' });
  saved = f.records.get(codes[0]);
  assert.equal(saved.ClassName, 'Grade 4'); assert.equal(saved.__id, 'saved-id-0');
  assert.equal(feeMatchesApplication(saved, student(3)), false); assert.equal(feeMatchesApplication(saved, student(4)), true);
  assert.ok(f.reads.every(options => options.IncludeArms === false));
});

test('a first_TO_last fee code never expands noncontiguous selected classes', async () => {
  const f = fixture();
  await f.actions.saveFeeItems({}, { BranchId: branch, Items: [fee(0, { ClassName: 'Grade 3, Grade 6' })] });
  const saved = f.records.get(codes[0]);
  assert.equal(saved.FeeCode, codes[0]); assert.equal(saved.ClassName, 'Grade 3, Grade 6');
  assert.equal(feeMatchesApplication(saved, student(3)), true); assert.equal(feeMatchesApplication(saved, student(6)), true);
  assert.equal(feeMatchesApplication(saved, student(4)), false); assert.equal(feeMatchesApplication(saved, student(5)), false);
});

test('invalid mixed All and selected-class input aborts the entire batch before writes', async () => {
  const f = fixture(), before = structuredClone([...f.records.entries()]);
  await assert.rejects(f.actions.saveFeeItems({}, { BranchId: branch, Items: [fee(0), fee(1, { ClassName: 'All, Grade 3' })] }), /not both/);
  assert.equal(f.commits.length, 0); assert.deepEqual([...f.records.entries()], before);
});

test('legacy lowercase className cannot override an explicitly updated selected-class rule', async () => {
  const f = fixture();
  f.records.get(codes[0]).className = 'Grade 3';
  await f.actions.saveFeeItems({}, { BranchId: branch, Items: [fee(0, { ClassName: 'Grade 3, Grade 4' })] });
  assert.equal(f.records.get(codes[0]).ClassName, 'Grade 3, Grade 4');
  assert.equal(normalizeFeeItem(f.records.get(codes[0])).ClassName, 'Grade 3, Grade 4');
  await f.actions.saveFeeItem({}, fee(0, { ClassName: 'Grade 6' }));
  assert.equal(normalizeFeeItem(f.records.get(codes[0])).ClassName, 'Grade 6');
  assert.equal(f.records.get(codes[0]).__id, 'saved-id-0');
});

test('unseparated ranges are rejected before writing any batch rows', async () => {
  const f = fixture(), before = structuredClone([...f.records.entries()]);
  await assert.rejects(f.actions.saveFeeItems({}, { BranchId: branch, Items: [fee(0), fee(1, { ClassName: 'Grade 3 to Grade 6' })] }), /Class ranges are not supported/);
  assert.equal(f.commits.length, 0); assert.deepEqual([...f.records.entries()], before);
});

test('explicit empty selections never broaden an existing fee to All classes in either save handler', async () => {
  for (const ClassNames of [[], [''], [' ', ',']]) {
    const f = fixture(), before = structuredClone([...f.records.entries()]);
    const item = fee(0, { ClassName: 'Grade 3, Grade 4', ClassNames });
    await assert.rejects(f.actions.saveFeeItem({}, item), /Select at least one applicable class/);
    await assert.rejects(f.actions.saveFeeItems({}, { BranchId: branch, Items: [item] }), /Select at least one applicable class/);
    assert.equal(f.commits.length, 0); assert.deepEqual([...f.records.entries()], before);
  }
});

test('unconfigured compound class names cannot silently narrow a fee to the first grade', async () => {
  for (const ClassName of ['Grade 3 & Grade 6', 'Grade three to six', 'Grade 3 and Grade 6', 'Grade three through six']) {
    const f = fixture(), before = structuredClone([...f.records.entries()]);
    await assert.rejects(f.actions.saveFeeItem({}, fee(0, { ClassName })), /comma-separated class names/);
    await assert.rejects(f.actions.saveFeeItems({}, { BranchId: branch, Items: [fee(0, { ClassName })] }), /comma-separated class names/);
    assert.equal(f.commits.length, 0); assert.deepEqual([...f.records.entries()], before);
  }
});
