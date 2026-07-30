import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  admissionApplicationScopePath,
  admissionThumbnailDocumentId,
  safeStoredDocument,
  validateAdmissionDocumentFile,
  validateAdmissionThumbnail
} from '../functions/lib/document-files.js';

function encoded(bytes) {
  return Buffer.from(bytes).toString('base64');
}

test('admission uploads derive a canonical MIME type from an allowed extension and signature', () => {
  const pdf = validateAdmissionDocumentFile({
    fileName: 'birth-certificate.pdf',
    fileBase64: encoded('%PDF-1.7\nsample'),
    documentType: 'BirthCertificate'
  });
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.equal(pdf.inlineSafe, true);

  const docx = validateAdmissionDocumentFile({
    fileName: 'report.docx',
    fileBase64: encoded([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]),
    documentType: 'PreviousSchoolReport'
  });
  assert.equal(docx.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(docx.inlineSafe, false);
});

test('active and signature-mismatched uploads are rejected server-side', () => {
  assert.throws(() => validateAdmissionDocumentFile({
    fileName: 'attack.svg',
    fileBase64: encoded('<svg><script>alert(1)</script></svg>'),
    documentType: 'MedicalReport'
  }), /Only PDF, JPG, PNG, DOC and DOCX/);
  assert.throws(() => validateAdmissionDocumentFile({
    fileName: 'attack.pdf',
    fileBase64: encoded('<html><script>alert(1)</script></html>'),
    documentType: 'MedicalReport'
  }), /do not match the PDF file type/);
  assert.throws(() => validateAdmissionDocumentFile({
    fileName: 'passport.docx',
    fileBase64: encoded([0x50, 0x4b, 0x03, 0x04, 0x01]),
    documentType: 'PassportPhotograph'
  }), /Passport photographs must be JPG or PNG/);
});

test('passport thumbnails accept only bounded JPG or PNG bytes', () => {
  assert.equal(
    validateAdmissionThumbnail(encoded([0xff, 0xd8, 0xff, 0xe0, 0x01])).mimeType,
    'image/jpeg'
  );
  assert.throws(
    () => validateAdmissionThumbnail(encoded('<svg></svg>')),
    /must be a JPG or PNG/
  );
});

test('legacy unsafe stored files are forced to binary attachment handling', () => {
  const stored = safeStoredDocument(
    'legacy.html',
    encoded('<html><script>alert(1)</script></html>')
  );
  assert.equal(stored.valid, false);
  assert.equal(stored.inlineSafe, false);
  assert.equal(stored.mimeType, 'application/octet-stream');
});

test('passport thumbnail identities are isolated by validated application scope', async () => {
  const reference = 'DCA/26/0042';
  const primaryScope = admissionApplicationScopePath(
    'schoolBranches/west/sections/primary/students'
  );
  const secondaryScope = admissionApplicationScopePath(
    'schoolBranches/main/sections/secondary/applications'
  );
  assert.equal(primaryScope, 'schoolBranches/west/sections/primary/applications');
  assert.equal(secondaryScope, 'schoolBranches/main/sections/secondary/applications');
  assert.equal(admissionApplicationScopePath('../../applications'), '');
  assert.notEqual(
    await admissionThumbnailDocumentId(reference, primaryScope),
    await admissionThumbnailDocumentId(reference, secondaryScope)
  );
});

test('staff document responses canonicalize stored types and force unsafe formats to attachment', async () => {
  const source = await readFile(new URL('../functions/api/staff-document.js', import.meta.url), 'utf8');
  assert.match(source, /safeStoredDocument/);
  assert.match(source, /stored\.valid && stored\.inlineSafe \? mode : 'attachment'/);
  assert.match(source, /Content-Security-Policy/);
  assert.match(source, /applicationScopePath/);
  assert.match(source, /admissionThumbnailDocumentId/);
});

test('passport photo retrieval prefers scoped thumbnails and validates legacy fallback bytes', async () => {
  const source = await readFile(new URL('../functions/api/passport-photo.js', import.meta.url), 'utf8');
  assert.match(source, /admissionThumbnailDocumentId/);
  assert.match(source, /legacyThumbnailBelongsToApplication/);
  assert.match(source, /validateAdmissionThumbnail\(thumbnail\.FileBase64\)/);
});

test('staff document clients carry the selected application scope for view and delete', async () => {
  const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(source, /scopePath=\$\{encodeURIComponent\(scopePath\)\}/);
  assert.match(source, /data-application-scope=/);
  assert.match(source, /JSON\.stringify\(\{ action: 'delete', applicationReference, scopePath, documentType \}\)/);
});
