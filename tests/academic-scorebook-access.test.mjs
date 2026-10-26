import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { assertAcademicScoreSheetAuthority, academicScorebookSnapshot, ACADEMIC_SCOREBOOK_STATE_KEYS } from '../functions/lib/academic-management.js';
import { academicComponentReviews } from '../functions/lib/academic-component-review.js';

const context = { SessionId: 'session', TermId: 'term', ClassId: 'grade8', ArmId: 'brilliance', SubjectId: 'math' };
const sheet = { ...context, SheetId: 'sheet', TeacherUsername: 'old.teacher', Status: 'Draft' };
const allocation = { ...context, TeacherUsername: 'new.teacher', AllocationRole: 'Subject Teacher', Status: 'Active' };
const state = { teacherAllocations: [allocation] };

test('current teacher opens a historical sheet without changing its original teacher or scores', () => {
  const before = structuredClone({ state, sheet });
  assert.equal(assertAcademicScoreSheetAuthority({ username: 'NEW.TEACHER' }, { teacherView: true }, state,
    { ...context, TeacherUsername: 'old.teacher' }, sheet), allocation);
  assert.deepEqual({ state, sheet }, before);
});

test('academic manager uses current allocation, including an old desktop sheet selection', () => {
  for (const TeacherUsername of ['new.teacher', 'old.teacher', '']) {
    assert.equal(assertAcademicScoreSheetAuthority({ username: 'admin' }, {}, state,
      { ...context, TeacherUsername }, sheet), allocation);
  }
});

test('historical sheet ownership and supplied usernames do not give former or unrelated teachers access', () => {
  for (const username of ['old.teacher', 'unallocated', '']) {
    assert.throws(() => assertAcademicScoreSheetAuthority({ username }, { teacherView: true }, state,
      { ...context, TeacherUsername: 'new.teacher' }, sheet), { code: 'ACADEMIC_SCORE_ALLOCATION_FORBIDDEN' });
  }
});

test('current authority remains isolated by period, class, arm and subject, and excludes inactive allocations', () => {
  for (const patch of [{ SessionId: 'other' }, { TermId: 'other' }, { ClassId: 'other' },
    { ArmId: 'other' }, { SubjectId: 'other' }]) {
    assert.throws(() => assertAcademicScoreSheetAuthority({ username: 'new.teacher' }, { teacherView: true },
      state, { ...context, ...patch }, sheet), { code: 'ACADEMIC_SCORE_TEACHER_REQUIRED' });
  }
  assert.throws(() => assertAcademicScoreSheetAuthority({ username: 'new.teacher' }, { teacherView: true },
    { teacherAllocations: [{ ...allocation, Status: 'Inactive' }] }, context, sheet), { code: 'ACADEMIC_SCORE_TEACHER_REQUIRED' });
  assert.throws(() => assertAcademicScoreSheetAuthority({}, {}, state,
    { ...context, TeacherUsername: 'unallocated' }, null), { code: 'ACADEMIC_SCORE_ALLOCATION_FORBIDDEN' });
});

test('authorised snapshot contains only its sheet and preserves marks, locks and original attempt identity', () => {
  const score = { SheetId: 'sheet', ScoreId: 's1', StudentRef: 'student',
    ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 85 }],
    CbtScoreSources: [{ CellId: 'ca1', AttemptId: 'first', SigningKeyId: 'server1' }], LockedScoreCellIds: ['ca1'] };
  const full = { SheetId: 'sheet', existing: sheet,
    state: { studentScores: [score, { SheetId: 'other', ScoreId: 'private' }] } };
  const before = structuredClone(full);
  const snapshot = academicScorebookSnapshot(full);
  assert.equal(snapshot.sheet.TeacherUsername, 'old.teacher');
  assert.equal(snapshot.scores.length, 1);
  assert.deepEqual(snapshot.scores[0].ComponentScores, score.ComponentScores);
  assert.deepEqual(snapshot.scores[0].CbtScoreSources, score.CbtScoreSources);
  assert.deepEqual(snapshot.scores[0].LockedScoreCellIds, ['ca1']);
  assert.deepEqual(full, before);
  assert.deepEqual(academicScorebookSnapshot({ ...full, existing: null }), { SheetId: 'sheet', sheet: null, scores: [] });
});

const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const mergeBody = adminSource.match(/function mergeAcademicScorebookSnapshot\([\s\S]*?\n}/)[0];
const browser = vm.createContext({ clean: value => String(value ?? '').trim() });
vm.runInContext(mergeBody, browser);

test('web context refresh replaces stale selected marks, keeps unrelated sheets, and never mutates cached input', () => {
  const data = { scoreSheets: [{ SheetId: 'sheet', Status: 'Old' }, { SheetId: 'other' }],
    studentScores: [{ SheetId: 'sheet', RawScore: 0 }, { SheetId: 'other', RawScore: 70 }] };
  const before = structuredClone(data);
  const result = browser.mergeAcademicScorebookSnapshot(data, { SheetId: 'sheet', sheet,
    scores: [{ SheetId: 'sheet', RawScore: 85 }, { SheetId: 'unexpected', RawScore: 99 }] });
  assert.equal(result.scoreSheets.length, 2);
  assert.equal(result.studentScores.length, 2);
  assert.equal(result.studentScores.find(r => r.SheetId === 'sheet').RawScore, 85);
  assert.equal(result.studentScores.find(r => r.SheetId === 'other').RawScore, 70);
  assert.deepEqual(data, before);
  const empty = browser.mergeAcademicScorebookSnapshot(data, { SheetId: 'sheet', sheet: null, scores: [] });
  assert.equal(empty.scoreSheets.length, 1);
  assert.equal(empty.studentScores.length, 1);
  assert.equal(browser.mergeAcademicScorebookSnapshot(data, null), data);
});

test('late context replies cannot overwrite a different classroom selection', () => {
  const loader = adminSource.match(/async function loadAcademicScorebookContext\([\s\S]*?\n}/)[0];
  assert.match(loader, /const current = academicScorebookContextPayload\(\)/);
  assert.match(loader, /join\('\|'\) !== key\) return/);
});

test('opening a scorebook returns fresh selected marks and the historical scheme without writing data', async () => {
  const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
  const body = source.match(/export async function getAcademicScorebookContext\([\s\S]*?\n}/)[0].replace('export ', '');
  const scheme = { Ready: true, RevisionId: 'historic' };
  const score = { SheetId: 'sheet', ScoreId: 'saved', ComponentScores: [{ ComponentId: 'ca1', RawScore: 85 }] };
  const selected = { SheetId: 'sheet', existing: sheet, scheme, activeScheme: { Ready: true, RevisionId: 'new' },
    state: { studentScores: [score, { SheetId: 'another' }] },
    session: { SessionId: 'session' }, term: { TermId: 'term' }, schoolClass: { ClassId: 'grade8' },
    arm: { ArmId: 'brilliance' }, subject: { SubjectId: 'math' }, allocation, roster: [{}] };
  const before = structuredClone(selected);
  const runtime = vm.createContext({
    ACADEMIC_SCOREBOOK_STATE_KEYS, academicComponentReviews,
    academicScoreSheetContext: async (_env, _user, _input, _capability, keys) => {
      assert.ok(keys.includes('studentScores'));
      assert.ok(!keys.includes('scoreSyncBatches'));
      assert.ok(!keys.includes('scoreImports'));
      return selected;
    },
    academicScorebookSnapshot, clean: v => String(v ?? '').trim(), lower: v => String(v ?? '').toLowerCase()
  });
  vm.runInContext(body, runtime);
  const result = await runtime.getAcademicScorebookContext({}, {}, context);
  assert.equal(result.assessmentScheme.RevisionId, 'historic');
  assert.equal(result.scorebookSnapshot.scores[0].ComponentScores[0].RawScore, 85);
  assert.equal(result.scorebookSnapshot.scores.length, 1);
  assert.equal(result.scorebookContext.TeacherUsername, 'new.teacher');
  assert.equal(result.scorebookContext.SessionId, 'session');
  assert.equal(result.scorebookContext.TermId, 'term');
  assert.equal(result.scorebookContext.LayoutUpdateAvailable, true);
  assert.deepEqual(selected, before);
});

test('review register distinguishes entered marks from fully completed term sheets', () => {
  assert.match(adminSource, /label: 'Entered', value: \(row\) => `\$\{row.EnteredCount/);
  assert.match(adminSource, /label: 'Complete', value: \(row\) => `\$\{row.CompleteCount/);
});
