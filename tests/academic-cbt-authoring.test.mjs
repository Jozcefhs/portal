import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  academicCbtPaperDigest,
  academicCbtPaperStoragePayload,
  validateAcademicCbtPaper
} from '../functions/lib/academic-cbt-papers.js';
import { ACADEMIC_CBT_OPTION_STYLES } from '../functions/lib/academic-management.js';

const portalRoot = new URL('../', import.meta.url);
const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('CBT papers accept only safe PDF/JPEG/PNG content and retain an upload digest', async () => {
  const paper = validateAcademicCbtPaper({ FileName: 'first-test.png', FileBase64: onePixelPng });
  assert.equal(paper.mimeType, 'image/png');
  assert.ok(paper.byteLength > 0);
  assert.match(await academicCbtPaperDigest(onePixelPng), /^[a-f0-9]{64}$/);
  assert.throws(() => validateAcademicCbtPaper({ FileName: 'questions.docx', FileBase64: 'UEsDBA==' }), /PDF, JPG or PNG/);
});

test('CBT Drive uploads use storage-only compatibility and an isolated CBT reference', () => {
  const payload = academicCbtPaperStoragePayload({
    Secret: 'secret', OperationId: 'operation-1', UploadAttemptId: 'attempt-1',
    BranchId: 'Main Branch', CbtTestId: 'test-1', FileName: 'paper.pdf',
    MimeType: 'application/pdf', FileBase64: 'JVBERi0xLjQK'
  });
  assert.equal(payload.Action, 'uploadParentDocument');
  assert.equal(payload.StorageOnly, 'YES');
  assert.equal(payload.ReplaceExisting, 'NO');
  assert.match(payload.ApplicationReference, /^CBT-main-branch-test-1-/i);
  assert.match(payload.FileName, /^CBT-test-1-/);
});

test('CBT option styles and the two-step web authoring contract stay aligned', async () => {
  assert.deepEqual(ACADEMIC_CBT_OPTION_STYLES.ABCD, ['A', 'B', 'C', 'D']);
  assert.deepEqual(ACADEMIC_CBT_OPTION_STYLES.TRUE_FALSE, ['True', 'False']);
  const [admin, backend, endpoint] = await Promise.all([
    readFile(new URL('js/admin.js', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/academic-management.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/staff-cbt-paper.js', portalRoot), 'utf8')
  ]);
  assert.match(admin, /\['cbt', 'CBT'\]/);
  assert.match(admin, /Step 1 of 2/);
  assert.match(admin, /Step 2 of 2/);
  assert.match(admin, /data-academic-cbt-paper/);
  assert.match(admin, /data-academic-cbt-answer/);
  assert.match(admin, /data-academic-cbt-edit/);
  assert.match(admin, /data-academic-cbt-delete/);
  assert.match(backend, /academicScoreSheetContext\(env, user, input, 'canCreateCbt'\)/);
  assert.match(backend, /LocalDownloadedAt/);
  assert.doesNotMatch(backend, /\['saveacademiccbttest', 'savecbttest'\]/);
  assert.match(endpoint, /requireStaffSession/);
  assert.match(endpoint, /validateAcademicCbtTestInput/);
  assert.match(endpoint, /saveAcademicCbtTest/);
  assert.match(endpoint, /Idempotency key is required/i);
});
