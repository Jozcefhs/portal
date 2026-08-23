import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  academicCbtPaperDigest,
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

test('teachers may author online packages that are pulled onto the local desktop network', async () => {
  assert.deepEqual(ACADEMIC_CBT_OPTION_STYLES.ABCD, ['A', 'B', 'C', 'D']);
  assert.deepEqual(ACADEMIC_CBT_OPTION_STYLES.TRUE_FALSE, ['True', 'False']);
  const [admin, styles, backend, endpoint] = await Promise.all([
    readFile(new URL('js/admin.js', portalRoot), 'utf8'),
    readFile(new URL('css/style.css', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/academic-management.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/staff-cbt-paper.js', portalRoot), 'utf8')
  ]);
  assert.match(admin, /\['cbt', 'Online CBT'\]/);
  assert.match(admin, /cbt: 'create'/);
  assert.match(admin, /data-academic-cbt-editor/);
  assert.match(admin, /New online test/);
  assert.match(admin, /Every student in that class who offers the subject is included across all arms/);
  assert.match(styles, /\.academic-cbt-editor/);
  assert.match(styles, /\.academic-cbt-answer-row label:has\(input:checked\)/);
  assert.match(styles, /flex:0 0 34px/);
  assert.match(styles, /\.academic-cbt-answer-row input\{position:absolute/);
  assert.match(backend, /cbt: ACADEMIC_CBT_STATE_KEYS/);
  assert.match(backend, /const focusedStateKeys = academicManagementViewStateKeys/);
  assert.match(backend, /downloadAcademicCbtTestPackage/);
  assert.match(backend, /prepareLocalCbtIdentityPackage/);
  assert.match(backend, /syncLocalCbtStudentPasswords/);
  assert.match(backend, /ArmId: ''/);
  assert.doesNotMatch(backend, /ACADEMIC_CBT_LOCAL_ONLY/);
  assert.match(endpoint, /putStoredDocument\(env/);
  assert.match(endpoint, /category: 'academic-cbt'/);
  assert.doesNotMatch(endpoint, /GOOGLE_APPS_SCRIPT/);
  assert.doesNotMatch(endpoint, /ACADEMIC_CBT_LOCAL_ONLY/);
});
