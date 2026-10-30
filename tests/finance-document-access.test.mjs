import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { hasPrincipalApprovalGrant } from '../functions/lib/requisition-workflow.js';
import { storedDocumentResponse } from '../functions/lib/document-storage.js';
import * as documentAccess from '../functions/lib/finance-document-access.js';

import {
  financeDocumentDefinition,
  financeDocumentReferenceMatches,
  safeFinanceDocumentId,
  staffCanAccessFinanceDocument,
  storedFinanceDocumentUrl
} from '../functions/lib/finance-document-access.js';

const portalRoot = new URL('../', import.meta.url);
const [adminJs, endpoint, storage] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/finance-document.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/document-storage.js', portalRoot), 'utf8')
]);

test('finance document definitions resolve only authoritative record locations', () => {
  assert.equal(financeDocumentDefinition('expense-requisition').collection, 'accountingExpenses');
  assert.equal(financeDocumentDefinition('material-requisition').collection, 'accountingExpenses');
  assert.equal(financeDocumentDefinition('supplier-bill').collection, 'accountingSupplierBills');
  assert.equal(financeDocumentDefinition('imprest-receipt').collection, 'accountingImprests');
  assert.equal(financeDocumentDefinition('drive-url'), null);
  assert.equal(safeFinanceDocumentId('WEB/REQ?#1'), 'WEB-REQ--1');
});

test('finance document lookup never accepts an arbitrary caller-supplied Drive URL', () => {
  const requisition = {
    __id: 'WEB-REQ-001',
    ExpenseNo: 'WEB-REQ-001',
    AttachmentUrl: 'https://drive.google.com/file/d/requisition/view'
  };
  const requisitionType = financeDocumentDefinition('expense-requisition');
  assert.equal(financeDocumentReferenceMatches(requisition, requisitionType, 'WEB-REQ-001'), true);
  assert.equal(storedFinanceDocumentUrl(requisition, requisitionType), requisition.AttachmentUrl);

  const imprest = {
    ImprestNo: 'IMP-001',
    RetirementLines: [
      { ReceiptUrl: 'https://drive.google.com/file/d/receipt-one/view' },
      { ReceiptUrl: 'https://drive.google.com/file/d/receipt-two/view' }
    ]
  };
  const receiptType = financeDocumentDefinition('imprest-receipt');
  assert.equal(storedFinanceDocumentUrl(imprest, receiptType, '1'), imprest.RetirementLines[1].ReceiptUrl);
  assert.equal(storedFinanceDocumentUrl(imprest, receiptType, '../../1'), '');
  assert.equal(storedFinanceDocumentUrl(imprest, receiptType, '9'), '');
});

test('finance document access enforces branch, section and finance visibility', () => {
  const record = { BranchId: 'main', SchoolSection: 'secondary', Department: 'Administration' };
  assert.equal(staffCanAccessFinanceDocument({ role: 'Super Admin', branchId: 'main', schoolSectionAccess: 'All' }, record), true);
  assert.equal(staffCanAccessFinanceDocument({ role: 'Accounts Officer', branchId: 'main', schoolSectionAccess: 'Secondary' }, record), true);
  assert.equal(staffCanAccessFinanceDocument({ role: 'Front Desk', department: 'Administration', branchId: 'main', schoolSectionAccess: 'Secondary' }, record), true);
  assert.equal(staffCanAccessFinanceDocument({ role: 'Front Desk', department: 'Front Desk', branchId: 'main', schoolSectionAccess: 'Secondary' }, record), false);
  assert.equal(staffCanAccessFinanceDocument({ role: 'Super Admin', branchId: 'west', schoolSectionAccess: 'All' }, record), false);
  assert.equal(staffCanAccessFinanceDocument({ role: 'Super Admin', branchId: 'main', schoolSectionAccess: 'Primary' }, record), false);
});

test('protected finance documents use the same access path in every edition', () => {
  const record = {
    BranchId: 'main',
    SchoolSection: 'Secondary',
    Department: 'Accounts'
  };
  for (const organisationEdition of ['school', 'faith', 'organization', 'hospital']) {
    assert.equal(staffCanAccessFinanceDocument({
      role: 'Accounts Officer',
      organisationEdition,
      branchId: 'main',
      schoolSectionAccess: 'All'
    }, record), true, organisationEdition);
  }
});

test('attachment permissions match requisition visibility for read-only officers and locked requests', async () => {
  const workflow = await readFile(new URL('functions/api/finance-workflow.js', portalRoot), 'utf8');
  const declaration = name => workflow.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
  const clean = v => String(v ?? '').trim(), lower = v => clean(v).toLowerCase();
  const scopedRows = vm.runInNewContext(`${declaration('userDepartment')}\n(${declaration('scopedRows')})`, {
    clean, lower, same: (a,b) => lower(a) === lower(b), hasPrincipalApprovalGrant
  });
  const users = [
    {role:'Super Admin'}, {role:'Management'}, {role:'Accounts Officer'},
    {role:'Management',assignedRole:'Director'}, {role:'Management',assignedRole:'Admin'},
    {role:'Department User',department:'ICT'}, {role:'Department User',department:'Clinic'},
    {role:'Principal',department:'Management',approvalEnabled:true},
    {role:'Vendor User',department:'Vendor',approvalEnabled:true},
    {role:'External Auditor',department:'Audit',approvalEnabled:true},
    {role:'Super Admin',branchId:'east'}, {role:'Super Admin',schoolSectionAccess:'Primary'},
    {role:'Super Admin',branchId:'all'}
  ];
  for (const edition of ['school','faith','organization','hospital']) {
    for (const Status of ['Submitted','Accounts Confirmed','Admin Reviewed','Approved','Posted','Paid','Rejected','Cancelled']) {
      const record = {ExpenseNo:'REQ-1',BranchId:'main',SchoolSection:'Secondary',Department:'ICT',Status};
      for (const extra of users) {
        const user = {branchId:'main',schoolSectionAccess:'All',organisationEdition:edition,requisitionEditEnabled:false,...extra};
        const access = {canViewAll:['Super Admin','Director','Admin','Management','Accounts Officer'].includes(user.assignedRole || user.role)};
        assert.equal(staffCanAccessFinanceDocument(user,record),scopedRows([record],user,access).length===1,JSON.stringify({user,Status}));
      }
    }
  }
  assert.equal(staffCanAccessFinanceDocument({role:'Principal',approvalEnabled:true}, {BillNo:'B1',Department:'ICT'}),false,'requisition approval grant does not grant other departments bill access');
});

test('protected attachment GET streams only the authorized file, at all statuses, without writes', async () => {
  const record = {ExpenseNo:'REQ-1',AttachmentUrl:'r2://dynamax-documents/private-file',Department:'ICT',BranchId:'main',SchoolSection:'Secondary'};
  let user = {role:'Department User',department:'ICT',branchId:'main',schoolSectionAccess:'All',requisitionEditEnabled:false};
  let recordReads=0, fileReads=0, signedIn=true;
  const get = vm.runInNewContext(endpoint.replace(/import[\s\S]*?;\r?\n/g,'').replaceAll('export ', '')+'\nonRequestGet', {
    ...documentAccess, URL, Response, storedDocumentResponse,
    requireFirestoreEnv:()=>{}, requireStaffSession:async()=>{if(!signedIn)throw Object.assign(new Error('Sign in'),{status:401});return user;},
    getDocument:async(_env,collection,id)=>{recordReads++;assert.equal(collection,'accountingExpenses');return id==='REQ-1'?record:null;},
    getStoredDocument:async(_env,url)=>{fileReads++;assert.equal(url,record.AttachmentUrl);return {fileName:'Supporting.pdf',mimeType:'application/pdf',object:{body:'%PDF-1.7\nfixture'}};}
  });
  const request = mode => ({request:new Request(`https://example.test/api/finance-document?recordType=expense-requisition&recordId=REQ-1&mode=${mode}`),env:{}});
  for (const Status of ['Submitted','Approved','Posted','Paid','Rejected']) {
    record.Status=Status;const before=structuredClone(record);
    for (const mode of ['view','download']) {
      const reads=[recordReads,fileReads],res=await get(request(mode));assert.equal(res.status,200);
      assert.equal(await res.text(),'%PDF-1.7\nfixture');assert.match(res.headers.get('Content-Disposition'),mode==='download'?/^attachment/:/^inline/);
      assert.equal(res.headers.get('Cache-Control'),'private, no-store');
      assert.deepEqual([recordReads,fileReads],[reads[0]+1,reads[1]+1]);assert.deepEqual(record,before);
    }
  }
  user={...user,branchId:'east'};const files=fileReads;
  assert.equal((await get(request('view'))).status,403);assert.equal(fileReads,files);
  signedIn=false;const reads=recordReads;
  assert.equal((await get(request('view'))).status,401);assert.equal(recordReads,reads);
});

test('finance document endpoint requires a staff session and returns hardened private files', () => {
  assert.match(endpoint, /requireStaffSession\(env, request\)/);
  assert.match(endpoint, /getDocument\(env, definition\.collection, safeFinanceDocumentId\(recordId\)\)/);
  assert.match(endpoint, /staffCanAccessFinanceDocument\(user, record\)/);
  assert.match(endpoint, /getStoredDocument\(env, storedUrl\)/);
  assert.match(endpoint, /storedDocumentResponse/);
  assert.match(storage, /'Cache-Control', 'private, no-store'/);
  assert.match(storage, /'Cross-Origin-Resource-Policy', 'same-origin'/);
  assert.match(storage, /'X-Content-Type-Options', 'nosniff'/);
  assert.doesNotMatch(endpoint, /searchParams\.get\(['"](?:url|documentUrl)['"]\)/);
});

test('finance UI opens only protected attachment URLs', () => {
  assert.match(adminJs, /function protectedFinanceDocumentUrl/);
  assert.match(adminJs, /\/api\/finance-document\?/);
  assert.match(adminJs, /recordType: 'imprest-receipt'/);
  assert.match(adminJs, /recordType: isMaterial \? 'material-requisition' : 'expense-requisition'/);
  assert.doesNotMatch(adminJs, /link\.href = clean\(url\)/);
  assert.doesNotMatch(adminJs, /href="\$\{escapeHtml\(line\.ReceiptUrl\)\}"/);
});
