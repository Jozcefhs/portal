import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  academicCbtPaperDigest,
  academicCbtPaperStoragePayload,
  validateAcademicCbtPaper
} from '../functions/lib/academic-cbt-papers.js';
import {
  ACADEMIC_CBT_OPTION_STYLES,
  handleAcademicManagementAction,
  saveAcademicCbtTest
} from '../functions/lib/academic-management.js';

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

test('CBT is authored and conducted only on the local desktop network', async () => {
  assert.deepEqual(ACADEMIC_CBT_OPTION_STYLES.ABCD, ['A', 'B', 'C', 'D']);
  assert.deepEqual(ACADEMIC_CBT_OPTION_STYLES.TRUE_FALSE, ['True', 'False']);
  const [admin, styles, backend, endpoint] = await Promise.all([
    readFile(new URL('js/admin.js', portalRoot), 'utf8'),
    readFile(new URL('css/style.css', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/academic-management.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/staff-cbt-paper.js', portalRoot), 'utf8')
  ]);
  assert.match(admin, /\['cbt', 'CBT'\]/);
  assert.match(admin, /cbt: 'local'/);
  assert.match(admin, /data-academic-local-cbt-only/);
  assert.match(admin, /CBT runs on Dynamax Desktop/);
  assert.match(admin, /Candidate devices do not need Internet access/);
  assert.match(admin, /Push approved scores afterwards/);
  assert.match(styles, /\.academic-cbt-offline-only/);
  assert.match(styles, /\.academic-cbt-offline-steps/);
  assert.match(backend, /focusedCbt[\s\S]{0,250}No online examination records were read/);
  assert.match(backend, /ACADEMIC_CBT_LOCAL_ONLY/);
  assert.match(endpoint, /ACADEMIC_CBT_LOCAL_ONLY/);
  assert.match(endpoint, /status: 409/);
  await assert.rejects(
    () => saveAcademicCbtTest({}, {}, {}),
    (error) => error.code === 'ACADEMIC_CBT_LOCAL_ONLY' && error.status === 409
  );
  for (const action of [
    'downloadAcademicCbtTestPackage',
    'acknowledgeAcademicCbtImport',
    'prepareLocalCbtIdentityPackage'
  ]) {
    await assert.rejects(
      () => handleAcademicManagementAction({}, {}, { Action: action }),
      (error) => error.code === 'ACADEMIC_CBT_LOCAL_ONLY' && error.status === 409
    );
  }
});
