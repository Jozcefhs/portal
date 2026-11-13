import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULT_BILLING_CATEGORIES } from '../functions/lib/billing-category-discounts.js';

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

for (const category of [...DEFAULT_BILLING_CATEGORIES, 'Community Bursary']) {
  test(`optional services: ${category} respects every branch, section, rate and compulsory exemption`, async () => {
    for (const branch of ['main', 'area-1-primary', 'the-lord-s-garden-primary']) for (const section of ['primary', 'secondary']) {
      const student = {...pupil,BranchId:branch,SchoolSection:section,BillingCategory:category,
        __scopePath:`schoolBranches/${branch}/sections/${section}/students`};
      const common = {...defaults,BranchId:branch,SchoolSection:section};
      const rules = [
        {...common,FeeCode:'CLUB',FeeName:'Chess',FeeCategory:'Club'},
        {...common,FeeCode:'BUS',FeeName:'Bus',FeeCategory:'Bus Service'},
        {...common,FeeCode:'BUS_CATEGORY',FeeName:'Bus',FeeCategory:'Bus Service',BillingCategory:category,Amount:2500},
        {...common,FeeCode:'TUITION',FeeName:'Tuition',FeeCategory:'School Fee',Amount:90000},
        {...common,FeeCode:'SCHOLARSHIP_ONLY',FeeName:'Assigned fee',FeeCategory:'School Fee',BillingCategory:'Full Scholarship',Amount:100},
        ...[
          {FeeCode:'FOREIGN_BRANCH',BranchId:'other-branch'},
          {FeeCode:'FOREIGN_SECTION',SchoolSection:section==='primary'?'secondary':'primary'},
          {FeeCode:'FOREIGN_CATEGORY',BillingCategory:'A different private category'},
          {FeeCode:'FOREIGN_CLASS',ClassName:'Grade 12'},
          {FeeCode:'FOREIGN_TERM',Term:'Second Term'},
          {FeeCode:'INACTIVE',Active:'NO'}, {FeeCode:'OFFLINE',PayableOnline:'NO'}
        ].map(row=>({...common,FeeCategory:'Club',FeeName:row.FeeCode,...row}))
      ];
      const before=JSON.stringify({student,rules});const reads=[];
      const rejectWrite=()=>{throw Error('Viewing payment options must not write');};
      const run=vm.runInNewContext(`${code}
        getSchoolProfile=async()=>({profile:{}});queryAccountRows=readAccountRows;getPayableFees;`,{
        ...imports,URL,Date,crypto,fetch:()=>{throw Error('Unexpected network');},
        getDocument:async(_env,path)=>{assert.equal(path,student.__scopePath);reads.push(path);return structuredClone(student);},
        loadBranchFinanceRows:async(_env,path,id)=>{assert.equal(path,'feeItems');assert.equal(id,branch);reads.push(path);return structuredClone(rules);},
        readAccountRows:async(_env,path,ref)=>{assert.equal(ref,student.AdmissionNo);reads.push(path);return [];},
        loadBillingDiscount:async()=>null,loadSchoolFeePaymentPlans:async()=>[],
        upsertDocument:rejectWrite,patchDocumentFields:rejectWrite,deleteDocument:rejectWrite,
        createDocumentIfAbsent:rejectWrite,batchCommitDocuments:rejectWrite,batchCommitLiteralDocuments:rejectWrite,batchUpsertDocuments:rejectWrite
      });
      const response=await run({}, {AccountRef:student.AdmissionNo,SourceType:'Student',ScopePath:student.__scopePath,
        Email:student.ParentEmail,AuthenticatedParentEmail:student.ParentEmail});
      assert.equal(response.ok,true);
      assert.deepEqual(Array.from(response.fees,row=>row.FeeCode).sort(),
        ['CLUB','BUS_CATEGORY',category==='Full Scholarship'?'SCHOLARSHIP_ONLY':'TUITION'].sort(),`${branch}/${section}`);
      assert.equal(response.fees.find(row=>row.FeeCode==='BUS_CATEGORY').Amount,2500);
      assert.equal(response.schoolFeeTotal,category==='Full Scholarship'?100:90000);
      assert.equal(response.schoolFeeBreakdown.length,1,'elective services never enter compulsory billing');
      assert.equal(reads.length,5,'category checks reuse the bounded payable reads');
      assert.equal(JSON.stringify({student,rules}),before);
    }
  });
}
