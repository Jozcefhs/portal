import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import {
  academicCbtPaperDigest,
  validateAcademicCbtPaper
} from '../functions/lib/academic-cbt-papers.js';
import { ACADEMIC_CBT_OPTION_STYLES } from '../functions/lib/academic-management.js';

const portalRoot = new URL('../', import.meta.url);
const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('CBT lists every assigned subject, deduplicates arms and retains subjects with an empty roster', async () => {
  const source = await readFile(new URL('js/admin.js', portalRoot), 'utf8');
  const context = vm.createContext({ clean: value => String(value || '').trim(),
    academicIsActive: row => row.Status === 'Active', academicFind: (rows, id) => rows.find(row => row.SubjectId === id),
    academicLabel: (_rows, id) => id });
  vm.runInContext(source.slice(source.indexOf('function academicCbtContexts('), source.indexOf('function academicCbtStatus(')), context);
  const allocation = { Status: 'Active', AllocationRole: 'Subject Teacher', TeacherUsername: 'teacher', ClassId: 'grade10' };
  const rows = { teacherAllocations: [
    { ...allocation, SubjectId: 'english', ArmId: 'a' }, { ...allocation, SubjectId: 'english', ArmId: 'b' },
    { ...allocation, SubjectId: 'history' }, { ...allocation, SubjectId: 'printing' },
    { ...allocation, SubjectId: 'assembly' }, { ...allocation, SubjectId: 'old', Status: 'Inactive' },
    { ...allocation, SubjectId: 'music', ClassId: 'grade11' }
  ], subjects: [{ SubjectId: 'assembly', AssessmentCategory: 'TimetableOnly' }],
  studentMemberships: [{ Status: 'Active', ClassId: 'grade10', SubjectIds: ['english', 'history'] }], classes: [] };
  const contexts = context.academicCbtContexts({ staff: [] }, rows);
  assert.deepEqual(Array.from(contexts, row => row.subjectId), ['english', 'history', 'printing', 'music']);
  assert.equal(contexts.find(row => row.subjectId === 'printing').rosterCount, 0);
  assert.match(source, /resetAcademicCbtDraft\(\);\s*academicCbtDraft.classroomId = context.classId;\s*academicManagementTaskViews.cbt = 'create'/);
  assert.match(source, /if \(!context.rosterCount\) return setStatus/);
});

test('server accepts each of a teacher’s subjects independently and rejects other teachers and empty rosters', async () => {
  const source = await readFile(new URL('functions/lib/academic-management.js', portalRoot), 'utf8');
  const active = { Status: 'Active', SchoolSection: 'secondary' };
  const period = { SessionId: 'session', TermId: 'term', ClassId: 'class' };
  const state = { classes: [{ ...active, ClassId: 'class' }],
    subjects: ['english', 'history', 'printing'].map(SubjectId => ({ ...active, SubjectId })),
    teacherAllocations: ['english', 'history', 'printing'].map(SubjectId => ({ ...active, ...period, SubjectId, TeacherUsername: 'teacher', AllocationRole: 'Subject Teacher' })),
    studentMemberships: [{ ...active, ...period, SubjectIds: ['english', 'history'] }] };
  const context = vm.createContext({
    ACADEMIC_CBT_STATE_KEYS: [],
    academicOperationalContext: async () => ({ state, scope: { section: 'secondary' }, permissions: { teacherView: true }, session: { SessionId: 'session' }, term: { TermId: 'term' } }),
    findById: (rows, id) => rows.find(row => row.ClassId === id || row.SubjectId === id),
    assertReference: row => { assert.ok(row); return row; }, statusActive: row => row.Status === 'Active',
    lower: value => String(value || '').toLowerCase(), actorUsername: user => user.username,
    failure: (message, status, code) => Object.assign(new Error(message), { status, code }),
    academicAssessmentForPeriod: async () => ({ Ready: true })
  });
  vm.runInContext(source.slice(source.indexOf('async function academicCbtClassContext('), source.indexOf('async function academicCbtPackageDigest(')), context);
  for (const SubjectId of ['english', 'history']) {
    const result = await context.academicCbtClassContext({}, { username: 'teacher' }, { ClassId: 'class', SubjectId });
    assert.equal(result.subject.SubjectId, SubjectId);
    assert.equal(result.roster.length, 1);
  }
  await assert.rejects(context.academicCbtClassContext({}, { username: 'other' }, { ClassId: 'class', SubjectId: 'history', TeacherUsername: 'teacher' }), { code: 'ACADEMIC_CBT_ALLOCATION_FORBIDDEN' });
  await assert.rejects(context.academicCbtClassContext({}, { username: 'teacher' }, { ClassId: 'class', SubjectId: 'printing' }), { code: 'ACADEMIC_CBT_ROSTER_EMPTY' });
});

test('teacher subject menu spans assigned classes and selecting a different class keeps the correct subject', async () => {
  const source = await readFile(new URL('js/admin.js', portalRoot), 'utf8');
  const base = { Status: 'Active', AllocationRole: 'Subject Teacher', TeacherUsername: 'teacher' };
  const rows = { teacherAllocations: [{ ...base, ClassId: 'grade10', SubjectId: 'english' }, { ...base, ClassId: 'grade11', SubjectId: 'history' }],
    studentMemberships: [{ Status: 'Active', ClassId: 'grade10', SubjectIds: ['english'] }, { Status: 'Active', ClassId: 'grade11', SubjectIds: ['history'] }],
    subjects: [], classes: [], cbtTests: [] };
  const context = vm.createContext({ clean: value => String(value || '').trim(), escapeHtml: value => String(value ?? ''),
    academicIsActive: row => row.Status === 'Active', academicFind: () => null, academicLabel: (_rows, id) => id,
    academicSelectOptions: (rows, selected) => rows.map(row => `<option value="${row.RecordId}"${row.RecordId === selected ? ' selected' : ''}>${row.Name}</option>`).join(''),
    ACADEMIC_CBT_OPTION_STYLES, ACADEMIC_CBT_MAX_PAPER_FILES: 12, table: () => '', academicCbtPaperPreviewMarkup: () => '',
    academicCbtDraft: { clientRequestId: 'new', classroomId: 'grade10', contextKey: '', answerKey: [], files: [], theoryFiles: [], step: 1, questionCount: 1 }
  });
  vm.runInContext(source.slice(source.indexOf('function academicCbtContexts('), source.indexOf('function academicFinanceClearanceWorkspace(')), context);
  const data = { permissions: { teacherView: true }, assessmentScheme: { Ready: true, Components: [{ Id: 'test', Name: 'Test', MaximumScore: 20 }] }, staff: [] };
  const menu = html => html.match(/<select name="ContextKey"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.match(menu(context.academicCbtWorkspace(data, rows)), /history · grade11/);
  context.academicCbtDraft.classroomId = 'grade11';
  context.academicCbtDraft.contextKey = 'grade11|history|teacher';
  assert.match(menu(context.academicCbtWorkspace(data, rows)), /value="grade11\|history\|teacher" selected/);
  assert.doesNotMatch(menu(context.academicCbtWorkspace({ ...data, permissions: {} }, rows)), /english/);
  assert.match(source, /if \(selected\) cbtForm.elements.ClassroomId.value = selected.classId;/);
});

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
  assert.match(styles, /\.academic-cbt-paper-grid\{grid-template-columns:max-content minmax\(0,1fr\)\}/);
  assert.match(styles, /\.academic-cbt-answer-key\{width:max-content;min-width:0;max-width:100%\}/);
  assert.match(styles, /\.academic-cbt-answer-row>div\{flex-wrap:nowrap\}/);
  assert.match(styles, /flex:0 0 auto;width:max-content;min-width:34px/);
  assert.match(styles, /\.academic-cbt-answer-row input\{position:absolute/);
  assert.match(styles, /\.academic-cbt-paper-preview-page object/);
  assert.match(styles, /\.academic-cbt-paper-preview-page img/);
  assert.match(admin, /type="file" multiple accept=/);
  assert.match(admin, /academicCbtPaperPreviewMarkup/);
  assert.match(admin, /Choose one PDF by itself, or choose several PNG\/JPG image pages/);
  assert.match(admin, /Files: paperFiles/);
  assert.match(admin, /TheoryFiles: theoryPaperFiles/);
  assert.match(admin, /Paper 1, Paper 2 and correct answers/);
  assert.match(admin, /data-academic-cbt-theory-paper/);
  assert.match(admin, /Paper 2 duration \(minutes\)/);
  assert.match(admin, /No typed theory response is stored/);
  assert.match(admin, /data-academic-cbt-reschedule/);
  assert.match(admin, /data-academic-cbt-remove-cloud-paper/);
  assert.match(admin, /Remove paper files from Cloudflare R2/);
  assert.match(admin, /removeAcademicCbtCloudPapers/);
  assert.match(admin, /Only the activation date and time will change/);
  assert.match(admin, /New schedule to pull/);
  assert.match(backend, /cbt: ACADEMIC_CBT_STATE_KEYS/);
  assert.match(backend, /const focusedStateKeys = academicManagementViewStateKeys/);
  assert.match(backend, /downloadAcademicCbtTestPackage/);
  assert.match(backend, /prepareLocalCbtIdentityPackage/);
  assert.match(backend, /syncLocalCbtStudentPasswords/);
  assert.match(backend, /ArmId: ''/);
  assert.match(backend, /PaperFiles: paperFiles/);
  assert.match(backend, /Papers: papers/);
  assert.match(backend, /TheoryPaperFiles: theoryPaperFiles/);
  assert.match(backend, /TheoryPapers: theoryPapers/);
  assert.match(backend, /PaperMode: splitPaper \? 'split' : 'single'/);
  assert.match(backend, /durationMinutes \+ theoryDurationMinutes/);
  assert.match(backend, /rescheduleAcademicCbtTest/);
  assert.match(backend, /removeAcademicCbtCloudPapers/);
  assert.match(backend, /DELETE_CLOUD_PAPERS/);
  assert.match(backend, /await deleteAcademicCbtPapers\(env, record\)/);
  assert.match(backend, /ACADEMIC_CBT_CLOUD_PAPER_REMOVED/);
  assert.match(backend, /completed local attempts preserved/);
  assert.match(backend, /replacementCandidates/);
  assert.match(backend, /SupersededByCbtTestId/);
  assert.doesNotMatch(backend, /ACADEMIC_CBT_LOCAL_ONLY/);
  assert.match(endpoint, /putStoredDocument\(env/);
  assert.match(endpoint, /category: 'academic-cbt'/);
  assert.match(endpoint, /Array\.isArray\(body\[key\]\)/);
  assert.match(endpoint, /theory-paper/);
  assert.match(endpoint, /uploadPaperSet/);
  assert.match(endpoint, /TheoryPaperFiles: theoryPaperFiles/);
  assert.match(endpoint, /Paper 1 and Paper 2 together exceed the 32 MB upload limit/);
  assert.match(endpoint, /preview\.replacementCandidates/);
  assert.doesNotMatch(endpoint, /GOOGLE_APPS_SCRIPT/);
  assert.doesNotMatch(endpoint, /ACADEMIC_CBT_LOCAL_ONLY/);
  assert.doesNotMatch(backend, /ACADEMIC_CBT_SPLIT_REQUIRES_LOCAL_SERVER/);
});
