import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
  for (const organisationEdition of ['school', 'faith', 'organization']) {
    assert.equal(staffCanAccessFinanceDocument({
      role: 'Accounts Officer',
      organisationEdition,
      branchId: 'main',
      schoolSectionAccess: 'All'
    }, record), true, organisationEdition);
  }
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
