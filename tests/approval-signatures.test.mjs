import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createStaffApprovalProof,
  readStaffApprovalProof,
  staffApprovalProofCookie
} from '../functions/lib/staff-auth.js';
import {
  approvalProfileId,
  publicStaffApprovalProfile,
  validateApprovalImage
} from '../functions/lib/staff-approval-profile.js';

const portalRoot = new URL('../', import.meta.url);
const [adminHtml, adminJs, workflowApi, profileApi] = await Promise.all([
  readFile(new URL('admin.html', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/finance-workflow.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-approval-profile.js', portalRoot), 'utf8')
]);

test('decision officials can save private signature and stamp settings', () => {
  assert.match(adminHtml, /id="staffApprovalSettings"/);
  assert.match(adminHtml, /id="staffSignatureFile"/);
  assert.match(adminHtml, /id="staffStampFile"/);
  assert.match(adminHtml, /name="ApplySignatureOnApproval"/);
  assert.match(adminHtml, /name="ApplyStampOnPosting"/);
  assert.match(profileApi, /requireStaffSession/);
  assert.match(adminJs, /approvalImageDataUrl/);
});

test('approval images accept supported data URLs and reject unrelated payloads', () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(validateApprovalImage(image, 'Signature'), image);
  assert.throws(() => validateApprovalImage('data:text/html;base64,PHNjcmlwdD4=', 'Signature'), /PNG, JPG or WebP/);
  assert.equal(approvalProfileId('Jane Officer'), 'jane_officer');
  assert.deepEqual(publicStaffApprovalProfile({
    SignatureDataUrl: image,
    ApplySignatureOnApproval: true
  }), {
    SignatureDataUrl: image,
    StampDataUrl: '',
    HasSignature: true,
    HasStamp: false,
    ApplySignatureOnApproval: true,
    ApplyStampOnApproval: false,
    ApplySignatureOnPosting: false,
    ApplyStampOnPosting: false,
    UpdatedAt: ''
  });
});

test('approval and posting require password or fresh biometric proof', () => {
  assert.match(workflowApi, /requireDecisionAuthorization/);
  assert.match(workflowApi, /verifyStaffApprovalPassword/);
  assert.match(workflowApi, /readStaffApprovalProof/);
  assert.match(workflowApi, /Confirm this decision[\s\S]*?err\.status = 403/);
  assert.match(workflowApi, /decision === 'Approved'[\s\S]*?requireDecisionAuthorization/);
  assert.match(workflowApi, /accountsReview[\s\S]*?requireDecisionAuthorization/);
  assert.match(adminHtml, /name="approvalPassword"/);
  assert.match(adminHtml, /id="financeDecisionBiometric"/);
});

test('biometric approval proof is signed, scoped to the officer and short lived', async () => {
  const env = { STAFF_SESSION_SECRET: 'test-only-approval-proof-secret' };
  const scope = { recordId: 'WEB-MAT-1', recordType: 'requisition', action: 'review:Approved' };
  const token = await createStaffApprovalProof(env, { username: 'jane.officer' }, scope);
  const cookie = staffApprovalProofCookie(token);
  const request = new Request('https://example.com/api/finance-workflow', {
    headers: { Cookie: cookie.split(';')[0] }
  });
  assert.equal(await readStaffApprovalProof(env, request, 'jane.officer', scope), true);
  const headerRequest = new Request('https://example.com/api/finance-workflow', {
    headers: { 'X-DIGC-Approval-Proof': token }
  });
  assert.equal(await readStaffApprovalProof(env, headerRequest, 'jane.officer', scope), true);
  const malformedHeaderRequest = new Request('https://example.com/api/finance-workflow', {
    headers: { 'X-DIGC-Approval-Proof': '~.~', Cookie: cookie.split(';')[0] }
  });
  assert.equal(await readStaffApprovalProof(env, malformedHeaderRequest, 'jane.officer', scope), false);
  assert.equal(await readStaffApprovalProof(env, request, 'jane.officer', { ...scope, recordId: 'WEB-MAT-2' }), false);
  assert.equal(await readStaffApprovalProof(env, request, 'another.officer', scope), false);
});

test('approved officer and selected endorsements appear on printable documents', () => {
  assert.match(workflowApi, /ApprovedBy: existing\.ApprovedBy \|\| actor\(user\)/);
  assert.match(workflowApi, /financeDocumentEndorsements/);
  assert.match(adminJs, /<th>Approved By<\/th>/);
  assert.match(adminJs, /approvalEndorsementBlock\('Approved by'/);
  assert.match(adminJs, /approvalEndorsementBlock\('Accounts review \/ posting'/);
});
