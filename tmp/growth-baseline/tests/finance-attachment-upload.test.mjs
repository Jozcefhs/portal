import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateFinanceAttachment } from '../functions/lib/finance-attachments.js';

const portalRoot = new URL('../', import.meta.url);
const [adminJs, portalCss, uploadApi] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('functions/api/finance-attachment.js', portalRoot), 'utf8')
]);

const base64 = (text) => Buffer.from(text, 'binary').toString('base64');

test('finance attachment validation accepts genuine receipt PDFs and rejects disguised files', () => {
  const valid = validateFinanceAttachment({
    kind: 'imprest-receipt',
    fileName: 'taxi-receipt.pdf',
    fileBase64: base64('%PDF-1.7\nreceipt')
  });
  assert.equal(valid.mimeType, 'application/pdf');
  assert.equal(valid.definition.label, 'Imprest retirement receipt');

  assert.throws(() => validateFinanceAttachment({
    kind: 'expense-requisition',
    fileName: 'not-a-receipt.pdf',
    fileBase64: base64('<html>not a pdf</html>')
  }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'INVALID_FINANCE_ATTACHMENT');
    assert.match(error.message, /contents do not match/i);
    return true;
  });
  assert.throws(() => validateFinanceAttachment({
    kind: 'supplier-invoice',
    fileName: 'receipt.pdf',
    fileBase64: base64('%PDF-1.7\nreceipt')
  }), /valid finance document type/i);
});

test('finance upload endpoint is authenticated, branch-aware, idempotent and audit logged', () => {
  assert.match(uploadApi, /requireStaffSession\(env, request\)/);
  assert.match(uploadApi, /resolveDocumentStorage\(env\)/);
  assert.match(uploadApi, /putStoredDocument\(env/);
  assert.match(uploadApi, /category: 'finance'/);
  assert.match(uploadApi, /beginIdempotentRequest\(env, request, body/);
  assert.match(uploadApi, /completeIdempotentRequest\(env, idempotency, data, 200\)/);
  assert.match(uploadApi, /accountingImprests/);
  assert.match(uploadApi, /does not belong to the active branch/);
  assert.match(uploadApi, /Only the imprest custodian or Accounts/);
  assert.match(uploadApi, /accountingAudit/);
  assert.match(uploadApi, /maxBytes: 12 \* 1024 \* 1024/);
});

test('web finance forms use upload buttons instead of asking users for document URLs', () => {
  assert.match(adminJs, /financeAttachmentField\('expense-requisition'\)/);
  assert.match(adminJs, /financeAttachmentField\('material-requisition'\)/);
  assert.match(adminJs, /data-finance-attachment-kind="imprest-receipt"/);
  assert.match(adminJs, /Uploading receipt \$\{index \+ 1\} of \$\{rows\.length\} to private storage/);
  assert.match(adminJs, /Uploading the supporting document to private storage/);
  assert.doesNotMatch(adminJs, /Every expense line requires a receipt URL/);
  assert.doesNotMatch(adminJs, /<th>Receipt URL<\/th>/);
  assert.match(portalCss, /\.finance-attachment-button/);
  assert.match(portalCss, /\.finance-attachment-compact/);
});
